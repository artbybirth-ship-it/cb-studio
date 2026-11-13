"""Phase 4b in the native editor: Swap with copied part, in headless Chrome against :3000.

usage: python3 swap_part_test.py <throwaway project id> <out dir>
Opens the first character's pose in the native editor, copies one part, picks a different part and swaps it for the
copy (the stage changes, the swapped layer keeps its place), undoes and redoes it, presses Done, reloads and checks
the swap stayed. Use a throwaway project: the edits are written to it. CB_BACKEND_ORIGIN of the frontend must be http://backend:8000.
"""
import base64, json, os, subprocess, sys, time, urllib.request, websocket

PROJECT, OUT = sys.argv[1], sys.argv[2]
os.makedirs(OUT, exist_ok=True)
chrome = subprocess.Popen(["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "--headless=new", "--remote-debugging-port=9668",
                           f"--user-data-dir={OUT}/profile", "--window-size=1600,1000", "about:blank"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
failed = []
try:
    for _ in range(50):
        try: tabs = json.load(urllib.request.urlopen("http://127.0.0.1:9668/json")); break
        except Exception: time.sleep(0.2)
    ws = websocket.create_connection([t for t in tabs if t["type"] == "page"][0]["webSocketDebuggerUrl"], timeout=300)
    n = [0]
    def cmd(method, **params):
        n[0] += 1; ws.send(json.dumps({"id": n[0], "method": method, "params": params}))
        while True:
            msg = json.loads(ws.recv())
            if msg.get("method") == "Runtime.exceptionThrown":
                print("EXC", msg["params"]["exceptionDetails"].get("exception", {}).get("description", "")[:300])
            if msg.get("id") == n[0]: return msg.get("result", msg)
    def js(e):
        r = cmd("Runtime.evaluate", expression=e, returnByValue=True, awaitPromise=True)
        if r.get("exceptionDetails"): print("JS error:", r["exceptionDetails"].get("exception", {}).get("description", "")[:400])
        return r.get("result", {}).get("value")
    def check(name, ok, detail=""):
        print(("PASS " if ok else "FAIL ") + name, detail)
        if not ok: failed.append(name)
    def rect(selector):
        return js("(()=>{const e=document.querySelector(%s);if(!e)return null;const r=e.getBoundingClientRect();return [r.left,r.top,r.width,r.height]})()" % json.dumps(selector))
    def click_at(x, y):
        for kind in ("mousePressed", "mouseReleased"): cmd("Input.dispatchMouseEvent", type=kind, x=x, y=y, button="left", clickCount=1)
        time.sleep(0.5)
    def click(selector):
        r = rect(selector); click_at(r[0] + r[2] / 2, r[1] + r[3] / 2)
    def wait(selector, seconds=60):
        for _ in range(seconds * 2):
            if rect(selector): return True
            time.sleep(0.5)
        return False
    def key(k):
        for kind in ("keyDown", "keyUp"): cmd("Input.dispatchKeyEvent", type=kind, key=k, code=k, windowsVirtualKeyCode={"Delete": 46}[k])
        time.sleep(0.5)
    def shot(name): open(f"{OUT}/{name}.png", "wb").write(base64.b64decode(cmd("Page.captureScreenshot", format="png")["data"]))
    stage = lambda: js("document.querySelector('[data-testid=stage]').toDataURL()")
    layer_count = lambda: js("document.querySelectorAll('[data-testid=timeline] [data-layer]').length")
    layer_names = lambda: js("[...document.querySelectorAll('[data-testid=timeline] [data-layer]')].map(r=>r.previousElementSibling.querySelector('span').textContent)")
    note = lambda: js("document.querySelector('[data-testid=note]').textContent")
    current_layer = lambda: js("(document.querySelector('[data-testid=native-editor] b + *')||{}).textContent")
    def scene():
        return [p for p in json.load(urllib.request.urlopen("http://localhost:3000/api/projects")) if p["id"] == PROJECT][0]["scenes"][0]
    def patch(sc, ed):
        req = urllib.request.Request(f"http://localhost:3000/api/scenes/{sc['id']}", data=json.dumps({"editor_data": ed}).encode(), method="PATCH", headers={"Content-Type": "application/json"})
        urllib.request.urlopen(req).read()
    def open_pose():
        cmd("Page.navigate", url=f"http://localhost:3000/editor/{PROJECT}"); time.sleep(9)
        js("""(()=>{const e=document.querySelector('[title*="step inside it"]');const r=e.getBoundingClientRect();e.dispatchEvent(new MouseEvent('dblclick',{bubbles:true,cancelable:true,clientX:r.left+r.width/2,clientY:r.top+r.height*0.4,view:window}))})()""")
        if not wait("[data-testid=open-native]", 20): return False
        click("[data-testid=open-native]")
        ok = wait("[data-testid=native-editor]", 90); time.sleep(2); return ok
    cmd("Runtime.enable"); cmd("Page.enable")

    sc = scene(); ed = json.loads(json.dumps(sc["editor_data"])); o = ed["objects"][0]
    for k in ("nativePose", "nativePoseFit", "symbolKeys", "symbolValues", "symbolEases", "symbolLayers"): o.pop(k, None)
    patch(sc, ed)
    check("the pose opens in the native editor", open_pose())
    r = rect("[data-testid=stage]")
    before = stage(); shot("1-open")
    spots = [(0.5, 0.45), (0.5, 0.3), (0.5, 0.6), (0.45, 0.5), (0.55, 0.5), (0.5, 0.2), (0.4, 0.4), (0.6, 0.4), (0.5, 0.75)]
    # the layer row the editor highlights is the selected part's layer
    sel = lambda: js("(()=>{const row=[...document.querySelectorAll('[data-testid=timeline] [data-layer]')].find(r=>getComputedStyle(r.parentElement).backgroundColor==='rgb(244, 248, 255)');return row?row.previousElementSibling.querySelector('span').textContent:null})()")
    def pick(skip_layer=None):
        for fx, fy in spots:
            click_at(r[0] + r[2] * fx, r[1] + r[3] * fy)
            layer = sel()
            if layer and layer != skip_layer: return layer, (fx, fy)
        return None, None
    def plain():
        click_at(r[0] + r[2] * 0.02, r[1] + r[3] * 0.02)
        return stage()

    # copy one part, then pick a different part to replace
    src_layer, _ = pick()
    check("a part is picked to copy", bool(src_layer), str(src_layer))
    click("[data-testid=copy-part]")
    check("it is copied", "Copied" in (note() or ""), note())
    target_layer, spot = pick(skip_layer=src_layer)
    check("a different part is picked to replace", bool(target_layer) and target_layer != src_layer, f"{target_layer}")
    count0 = layer_count()
    prior = plain(); click_at(r[0] + r[2] * spot[0], r[1] + r[3] * spot[1])
    click("[data-testid=swap-part]"); time.sleep(1.5)
    check("Swap reports it", "Swapped" in (note() or ""), note())
    shot("2-swapped")
    swapped = plain()
    check("the picture changed", swapped != prior)
    check("the layer count is unchanged", layer_count() == count0)
    click("[data-testid=undo]")
    check("Undo brings the old part back exactly", plain() == prior)
    click("[data-testid=redo]")
    check("Redo swaps again", plain() == swapped)
    # swapping a part for itself does nothing harmful
    click("[data-testid=swap-part]"); time.sleep(1)
    check("swapping again is a no-op or the same picture", plain() == swapped, note())
    click("[data-testid=native-done]"); time.sleep(2)
    saved = scene()["editor_data"]["objects"][0].get("nativePose") or {}
    check("the swap was saved with the scene", bool(saved))
    check("after a reload the pose reopens", open_pose())
    check("the swap is still there", plain() == swapped)
    click("[data-testid=native-cancel]")
finally:
    chrome.terminate()
print("FAILED:" if failed else "ALL PASSED", failed)
sys.exit(1 if failed else 0)
