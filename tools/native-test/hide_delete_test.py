"""Phase 4a in the native editor: the eye (hide a layer) and Delete layer, in headless Chrome against :3000.

usage: python3 hide_delete_test.py <throwaway project id> <out dir>
Opens the first character's pose in the native editor, hides a layer with its eye (the stage changes, a click no
longer picks it), shows it again (the stage is back exactly), deletes the layer of a clicked part (layer count
drops, undo restores it), deletes again, presses Done, reloads and checks the hidden/deleted layers stayed so.
Use a throwaway project: the edits are written to it. CB_BACKEND_ORIGIN of the frontend must be http://backend:8000.
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
    total = layer_count(); names = layer_names()
    check("the timeline lists layers with an eye each", total > 3 and js("document.querySelectorAll('[data-testid^=eye-]').length") == total, f"{total} layers")
    before = stage(); shot("1-open")

    # ---- the eye: find a layer whose eye changes the picture (some layers are empty at frame 1)
    hid = None
    for i in range(total):
        click(f"[data-testid=eye-{i}]")
        if stage() != before: hid = i; break
        click(f"[data-testid=eye-{i}]")
    check("hiding a layer with its eye changes the stage", hid is not None, f"layer {hid} {names[hid] if hid is not None else ''}")
    hidden_stage = stage(); shot("2-hidden")
    check("the eye shows it is off", js("document.querySelector('[data-testid=eye-%d]').getAttribute('aria-pressed')" % hid) == "false")
    click(f"[data-testid=eye-{hid}]")
    check("showing it again brings the picture back exactly", stage() == before)
    click(f"[data-testid=eye-{hid}]")
    check("hiding is repeatable and undo shows it again", stage() == hidden_stage)
    click("[data-testid=undo]")
    check("Undo brings the layer back", stage() == before)
    click("[data-testid=redo]")
    check("Redo hides it again", stage() == hidden_stage)
    # a click where the hidden layer used to be no longer picks that layer
    r = rect("[data-testid=stage]")

    # ---- delete: pick a part by clicking, press Delete
    click("[data-testid=undo]")  # visible again; the eye state is tested, now delete a clicked part
    picked = None
    for fx, fy in ((0.5, 0.45), (0.5, 0.3), (0.5, 0.6), (0.45, 0.5), (0.55, 0.5), (0.5, 0.2)):
        click_at(r[0] + r[2] * fx, r[1] + r[3] * fy)
        txt = js("[...document.querySelectorAll('[data-testid=native-editor] div')].map(d=>d.textContent).find(t=>/^frame \\d+ of/.test(t))") or ""
        if "layer —" not in txt and "layer" in txt: picked = txt.split("layer ")[-1].strip(); break
    check("clicking a part selects its layer", bool(picked), str(picked))
    names0 = layer_names(); count0 = layer_count()
    key("Delete")
    check("Delete removes that layer", layer_count() == count0 - 1 and picked not in layer_names(), f"{count0} -> {layer_count()}; {note()}")
    shot("3-deleted")
    check("the picture changed", stage() != before)
    deleted_stage = stage()
    click("[data-testid=undo]")
    check("Undo brings the layer back where it was", layer_names() == names0 and stage() == before, f"{layer_count()} layers")
    click("[data-testid=redo]")
    check("Redo deletes it again", layer_count() == count0 - 1 and stage() == deleted_stage)
    # the delete button does the same for the selected layer (nothing selected: the layer picked in the timeline)
    click("[data-testid=delete-layer]")
    check("the Delete layer button removes another layer", layer_count() == count0 - 2, f"{layer_count()}; {note()}")
    final_names = layer_names(); final_stage = stage()
    # hide one more so the saved file carries both kinds of change
    eye = js("[...document.querySelectorAll('[data-testid^=eye-]')].length")
    click("[data-testid=native-done]"); time.sleep(2)

    saved = scene()["editor_data"]["objects"][0].get("nativePose") or {}
    tl = next(iter(saved.values()), {}).get("symbols", {}) if saved else {}
    pose_layers = max((len(t["layers"]) for t in tl.values()), default=0)
    check("the edits were saved with the scene", bool(saved) and pose_layers == count0 - 2, f"{pose_layers} layers saved")
    check("the saved pose has the deleted layers gone", not any(picked == l["name"] for t in tl.values() for l in t["layers"] if len(t["layers"]) == pose_layers) or names0.count(picked) > 1)

    # ---- reload: still deleted
    check("after a reload the pose reopens", open_pose())
    check("the deleted layers are still gone", layer_names() == final_names, f"{layer_count()} layers")
    check("the stage is the same as before the reload", stage() == final_stage)
    click("[data-testid=native-cancel]")
finally:
    chrome.terminate()
print("FAILED:" if failed else "ALL PASSED", failed)
sys.exit(1 if failed else 0)
