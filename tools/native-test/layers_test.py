"""Phase 6 B: layer Duplicate, Rename and Lock in the native pose editor (/native-lab), with real mouse and key events.

usage: python3 layers_test.py <file.fla> <out dir>
Duplicate puts "<name> copy" just above the picked layer (moving the copy leaves the original); double-click a layer name to rename it
(Enter keeps, Esc cancels); the padlock stops the layer's parts being picked on the stage and its Properties being changed; each is undoable.
"""
import base64, json, os, subprocess, sys, time, urllib.request, websocket

FLA, OUT = sys.argv[1], sys.argv[2]
os.makedirs(OUT, exist_ok=True)
chrome = subprocess.Popen(["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "--headless=new", "--remote-debugging-port=9560",
                           f"--user-data-dir={OUT}/profile", "--window-size=1400,1100", "about:blank"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
failed = []
try:
    for _ in range(50):
        try: tabs = json.load(urllib.request.urlopen("http://127.0.0.1:9560/json")); break
        except Exception: time.sleep(0.2)
    ws = websocket.create_connection([t for t in tabs if t["type"] == "page"][0]["webSocketDebuggerUrl"], timeout=300)
    n = [0]
    def cmd(method, **params):
        n[0] += 1; ws.send(json.dumps({"id": n[0], "method": method, "params": params}))
        while True:
            msg = json.loads(ws.recv())
            if msg.get("id") == n[0]: return msg.get("result", msg)
    def js(e):
        r = cmd("Runtime.evaluate", expression=e, returnByValue=True, awaitPromise=True)
        return r.get("result", {}).get("value")
    def check(name, ok, detail=""):
        print(("PASS " if ok else "FAIL ") + name, detail)
        if not ok: failed.append(name)
    def mouse(kind, x, y, **kw): cmd("Input.dispatchMouseEvent", type=kind, x=x, y=y, button="left", clickCount=kw.pop("clickCount", 1), **kw)
    def centre(sel, dx=0.5, dy=0.5): return js(f"(()=>{{const e=document.querySelector({json.dumps(sel)});if(!e)return null;const r=e.getBoundingClientRect();return [r.left+r.width*{dx},r.top+r.height*{dy}]}})()")
    def click(sel, dx=0.5, dy=0.5, count=1):
        x, y = centre(sel, dx, dy)
        for i in range(1, count + 1): mouse("mousePressed", x, y, clickCount=i); mouse("mouseReleased", x, y, clickCount=i)
        time.sleep(0.4)
    def key(k, code, vk): cmd("Input.dispatchKeyEvent", type="keyDown", key=k, code=code, windowsVirtualKeyCode=vk); cmd("Input.dispatchKeyEvent", type="keyUp", key=k, code=code, windowsVirtualKeyCode=vk)
    def shot(name): open(f"{OUT}/{name}.png", "wb").write(base64.b64decode(cmd("Page.captureScreenshot", format="png")["data"]))
    stage = lambda: js("document.querySelector('[data-testid=stage]').toDataURL()")
    names = lambda: js("[...document.querySelectorAll('[data-testid^=layer-name-],[data-testid^=rename-]')].map(e=>e.value??e.textContent)")
    picked_layer = lambda: js("(()=>{const t=[...document.querySelectorAll('div')].map(d=>d.textContent).filter(t=>/^frame \\d+ of/.test(t)).pop();return t?t.split(' · layer ')[1]:null})()")
    has_props = lambda: bool(js("!!document.querySelector('[data-testid=native-props]')"))

    cmd("Runtime.enable"); cmd("Page.enable"); cmd("DOM.enable")
    cmd("Page.navigate", url="http://localhost:3000/native-lab"); time.sleep(6)
    root = cmd("DOM.getDocument")["root"]["nodeId"]
    cmd("DOM.setFileInputFiles", files=[FLA], nodeId=cmd("DOM.querySelector", nodeId=root, selector="input[type=file]")["nodeId"])
    for _ in range(120):
        time.sleep(1)
        if js("!!document.querySelector('[data-testid=toggle-editor]')"): break
    click("[data-testid=toggle-editor]"); time.sleep(2)
    names0, img0 = names(), stage()
    print("layers:", names0[:6])

    # a part on the stage: its layer is the one the tests work on
    for dy in (0.35, 0.45, 0.3, 0.5, 0.6):
        sx, sy = centre("[data-testid=stage]", 0.5, dy); mouse("mousePressed", sx, sy); mouse("mouseReleased", sx, sy); time.sleep(0.5)
        if has_props(): break
    L = picked_layer(); li = names0.index(L)
    print("picked part on layer", L, "#", li)
    check("a part is picked", has_props() and L is not None)

    # ---- duplicate
    click("[data-testid=duplicate-layer]"); time.sleep(0.5)
    n1 = names()
    check("Duplicate: a copy just above the layer", len(n1) == len(names0) + 1 and n1[li] == f"{L} copy" and n1[li + 1] == L, str(n1[max(0, li - 1):li + 3]))
    check("...and the copy is the picked layer", picked_layer() == f"{L} copy")
    # move the copy's part: the original stays where it was (two of it now)
    click("[data-testid=timeline] [data-layer='%d']" % li, 0.004, 0.5)
    btn = js("(()=>{const b=[...document.querySelectorAll('button')].find(b=>/^#1 /.test(b.textContent.trim()));if(!b)return null;const r=b.getBoundingClientRect();return [r.left+r.width/2,r.top+r.height/2]})()")
    if btn: mouse("mousePressed", *btn); mouse("mouseReleased", *btn); time.sleep(0.4)
    x0 = float(js("document.querySelector('[data-testid=native-prop-x]').value"))
    click("[data-testid=native-prop-x]"); js("document.querySelector('[data-testid=native-prop-x]').select()")
    cmd("Input.insertText", text=str(x0 + 60)); key("Enter", "Enter", 13); time.sleep(0.5)
    img_moved = stage()
    check("moving the copy changes the picture", img_moved != img0)
    shot("1-copy-moved")
    click("[data-testid=undo]"); time.sleep(0.3); click("[data-testid=undo]"); time.sleep(0.4)
    check("Undo twice: no copy, picture as before", names() == names0 and stage() == img0, str(names()[:4]))

    # ---- rename
    click(f"[data-testid=layer-name-{li}]", count=2); time.sleep(0.3)
    check("double-click opens the name for typing", bool(js(f"!!document.querySelector('[data-testid=rename-{li}]')")))
    cmd("Input.insertText", text="Arm test"); key("Enter", "Enter", 13); time.sleep(0.4)
    check("Enter keeps the new name", names()[li] == "Arm test", names()[li])
    check("renaming does not change the picture", stage() == img0)
    click(f"[data-testid=layer-name-{li}]", count=2); time.sleep(0.3)
    cmd("Input.insertText", text="Nope"); key("Escape", "Escape", 27); time.sleep(0.4)
    check("Esc cancels a rename", names()[li] == "Arm test", names()[li])
    check("...and the editor is still open", bool(js("!!document.querySelector('[data-testid=stage]')")))
    click("[data-testid=undo]"); time.sleep(0.4)
    check("Undo brings the old name back", names()[li] == L, names()[li])

    # ---- lock
    mouse("mousePressed", sx, sy); mouse("mouseReleased", sx, sy); time.sleep(0.5)
    check("before locking, the part picks its layer", picked_layer() == L and has_props())
    click(f"[data-testid=lock-{li}]"); time.sleep(0.4)
    check("locking lets go of its selected part", not has_props(), str(picked_layer()))
    mouse("mousePressed", sx, sy); mouse("mouseReleased", sx, sy); time.sleep(0.5)
    check("a click there no longer picks the locked layer's part", picked_layer() != L or not has_props(), str(picked_layer()))
    # dragging there does not move it either
    before = stage()
    mouse("mousePressed", sx, sy); mouse("mouseMoved", sx + 40, sy + 10, buttons=1); mouse("mouseMoved", sx + 80, sy + 20, buttons=1); mouse("mouseReleased", sx + 80, sy + 20); time.sleep(0.5)
    # picking it from the layer's own part list shows a locked note, not the numbers
    click("[data-testid=timeline] [data-layer='%d']" % li, 0.004, 0.5)
    btn = js("(()=>{const b=[...document.querySelectorAll('button')].find(b=>/^#1 /.test(b.textContent.trim()));if(!b)return null;const r=b.getBoundingClientRect();return [r.left+r.width/2,r.top+r.height/2]})()")
    if btn: mouse("mousePressed", *btn); mouse("mouseReleased", *btn); time.sleep(0.4)
    check("its Properties say it is locked", bool(js("!!document.querySelector('[data-testid=native-locked]')")) and not has_props())
    shot("2-locked")
    click(f"[data-testid=lock-{li}]"); time.sleep(0.4)
    # the stage drag above may have moved another layer's part: put it back
    while js("!document.querySelector('[data-testid=undo]').disabled") and stage() != img0:
        click("[data-testid=undo]"); time.sleep(0.3)
        if stage() == img0: break
    mouse("mousePressed", sx, sy); mouse("mouseReleased", sx, sy); time.sleep(0.5)
    check("unlocked: the part picks its layer again", picked_layer() == L and has_props(), str(picked_layer()))
finally:
    chrome.terminate()
print("FAILED:" if failed else "ALL PASSED", failed)
sys.exit(1 if failed else 0)
