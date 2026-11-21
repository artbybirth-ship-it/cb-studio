"""Phase 4b in the native editor: Swap with copied part, in headless Chrome against :3000.

usage: python3 swap_part_test.py <throwaway project id> <out dir>
Opens the first character's pose in the native editor, copies one part, picks a different part and swaps it for the
copy (the stage changes, the swapped layer keeps its place), undoes and redoes it, presses Done, reloads and checks
the swap stayed. Use a throwaway project: the edits are written to it. CB_BACKEND_ORIGIN of the frontend must be http://backend:8000.
"""
import base64, json, os, subprocess, sys, time, urllib.request, websocket
from pose_view import empty_spot, pose_point, pose_rect

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
    # The layers as the timeline panel lists them; messages and the picked part from the stage's markers.
    layer_count = lambda: js("document.querySelectorAll('.cb-symbol-timeline [data-symbol-row]').length")
    layer_names = lambda: js("[...document.querySelectorAll('.cb-symbol-timeline [data-symbol-row] .cb-symbol-layer-name')].map(e=>e.textContent)")
    note = lambda: js("document.querySelector('[data-testid=native-editor]').dataset.note")
    def press(k, code, vk, mods=0):
        js("document.activeElement && document.activeElement.blur()")
        cmd("Input.dispatchKeyEvent", type="keyDown", key=k, code=code, windowsVirtualKeyCode=vk, modifiers=mods); cmd("Input.dispatchKeyEvent", type="keyUp", key=k, code=code, windowsVirtualKeyCode=vk, modifiers=mods); time.sleep(0.8)
    def menu_pick(x, y, action):
        """Right-click at (x, y) on the stage and choose `action` from the part menu."""
        cmd("Input.dispatchMouseEvent", type="mousePressed", x=x, y=y, button="right", clickCount=1); cmd("Input.dispatchMouseEvent", type="mouseReleased", x=x, y=y, button="right", clickCount=1); time.sleep(0.5)
        item = js(f"(()=>{{const b=document.querySelector('.cb-symbol-menu [data-action={action}]');if(!b)return null;const r=b.getBoundingClientRect();return [r.left+r.width/2,r.top+r.height/2]}})()")
        if item: click_at(*item)
        return bool(item)
    def scene():
        return [p for p in json.load(urllib.request.urlopen("http://localhost:3000/api/projects")) if p["id"] == PROJECT][0]["scenes"][0]
    def patch(sc, ed):
        req = urllib.request.Request(f"http://localhost:3000/api/scenes/{sc['id']}", data=json.dumps({"editor_data": ed}).encode(), method="PATCH", headers={"Content-Type": "application/json"})
        urllib.request.urlopen(req).read()
    def open_pose():
        cmd("Page.navigate", url=f"http://localhost:3000/editor/{PROJECT}"); time.sleep(9)
        js("""(()=>{const e=document.querySelector('[title*="step inside it"]');const r=e.getBoundingClientRect();e.dispatchEvent(new MouseEvent('dblclick',{bubbles:true,cancelable:true,clientX:r.left+r.width/2,clientY:r.top+r.height*0.4,view:window}))})()""")
        ok = wait("[data-testid=native-editor]", 90); time.sleep(2); return ok
    cmd("Runtime.enable"); cmd("Page.enable")

    sc = scene(); ed = json.loads(json.dumps(sc["editor_data"])); o = ed["objects"][0]
    for k in ("nativePose", "nativePoseFit", "symbolKeys", "symbolValues", "symbolEases", "symbolLayers"): o.pop(k, None)
    patch(sc, ed)
    check("the pose opens in the native editor", open_pose())
    r = pose_rect(js)
    before = stage(); shot("1-open")
    spots = [(0.5, 0.45), (0.5, 0.3), (0.5, 0.6), (0.45, 0.5), (0.55, 0.5), (0.5, 0.2), (0.4, 0.4), (0.6, 0.4), (0.5, 0.75)]
    # the layer row the editor highlights is the selected part's layer
    def sel():
        got = js("document.querySelector('[data-testid=native-editor]').dataset.picked")
        return layer_names()[json.loads(got)["layer"]] if got else None
    def pick(skip_layer=None):
        for fx, fy in spots:
            click_at(r[0] + r[2] * fx, r[1] + r[3] * fy)
            layer = sel()
            if layer and layer != skip_layer: return layer, (fx, fy)
        return None, None
    def plain():
        click_at(*empty_spot(js))  # the pasteboard: nothing on it
        return stage()

    # copy one part, then pick a different part to replace
    src_layer, _ = pick()
    check("a part is picked to copy", bool(src_layer), str(src_layer))
    press("c", "KeyC", 67, 4)
    check("it is copied", "Copied" in (note() or ""), note())
    target_layer, spot = pick(skip_layer=src_layer)
    check("a different part is picked to replace", bool(target_layer) and target_layer != src_layer, f"{target_layer}")
    count0 = layer_count()
    prior = plain()
    check("the part menu offers Swap with Copied Part", menu_pick(r[0] + r[2] * spot[0], r[1] + r[3] * spot[1], "swap")); time.sleep(1.5)
    check("Swap reports it", "Swapped" in (note() or ""), note())
    shot("2-swapped")
    swapped = plain()
    check("the picture changed", swapped != prior)
    check("the layer count is unchanged", layer_count() == count0)
    press("z", "KeyZ", 90, 4)
    check("Undo brings the old part back exactly", plain() == prior)
    press("z", "KeyZ", 90, 4 | 8)
    check("Redo swaps again", plain() == swapped)
    # a second swap on whatever is under that spot now (another part) works too, and one Undo takes just it back
    menu_pick(r[0] + r[2] * spot[0], r[1] + r[3] * spot[1], "swap"); time.sleep(1.5)
    press("z", "KeyZ", 90, 4)
    check("a second swap is one undo step", plain() == swapped, note())
    click(".cb-symbol-crumbs button"); time.sleep(2)
    saved = {}
    for _ in range(20):
        saved = scene()["editor_data"]["objects"][0].get("nativePose") or {}
        if saved: break
        time.sleep(1)
    check("the swap was saved with the scene", bool(saved))
    check("after a reload the pose reopens", open_pose())
    check("the swap is still there", plain() == swapped)
    click(".cb-symbol-crumbs button")
finally:
    chrome.terminate()
print("FAILED:" if failed else "ALL PASSED", failed)
sys.exit(1 if failed else 0)
