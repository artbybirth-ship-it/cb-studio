"""Phase 6 B: Copy / Cut / Paste Frames and keyframe drag (move) / ⌥-drag (copy) in the native pose editor (/native-lab), with real events.

usage: python3 frames_test.py <file.fla> <out dir>
With "all layers": frames 11-15 copied (⌥⌘C) and pasted at frame 41 (⌥⌘V) look exactly like frames 11-15, frame 46 on looks as before;
Undo puts it back. ⌘C acts on frames after a press in the timeline, on parts after a press on the stage. Cut empties the frames.
A keyframe dragged moves; ⌥-dragged onto another layer leaves the original and puts a copy there.
"""
import base64, json, os, subprocess, sys, time, urllib.request, websocket

FLA, OUT = sys.argv[1], sys.argv[2]
os.makedirs(OUT, exist_ok=True)
chrome = subprocess.Popen(["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "--headless=new", "--remote-debugging-port=9561",
                           f"--user-data-dir={OUT}/profile", "--window-size=1500,1200", "about:blank"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
failed = []
CELL = 12
try:
    for _ in range(50):
        try: tabs = json.load(urllib.request.urlopen("http://127.0.0.1:9561/json")); break
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
    def click(sel): x, y = centre(sel); mouse("mousePressed", x, y); mouse("mouseReleased", x, y); time.sleep(0.4)
    def cell(layer, f):
        r = js(f"(()=>{{const e=document.querySelector('[data-testid=timeline] [data-layer=\"{layer}\"]');const r=e.getBoundingClientRect();return [r.left,r.top+r.height/2]}})()")
        return r[0] + f * CELL + CELL / 2, r[1]
    def click_cell(layer, f, mods=0):
        x, y = cell(layer, f); mouse("mousePressed", x, y, modifiers=mods); mouse("mouseReleased", x, y, modifiers=mods); time.sleep(0.25)
    def combo(code, key, mods):  # mods: 1 alt, 2 ctrl, 4 meta, 8 shift
        cmd("Input.dispatchKeyEvent", type="keyDown", key=key, code=code, modifiers=mods, windowsVirtualKeyCode=ord(code[-1]))
        cmd("Input.dispatchKeyEvent", type="keyUp", key=key, code=code, modifiers=mods, windowsVirtualKeyCode=ord(code[-1])); time.sleep(0.5)
    stage = lambda: js("document.querySelector('[data-testid=stage]').toDataURL()")
    note = lambda: js("document.querySelector('[data-testid=note]').textContent")
    keys_of = lambda layer: js(f"[...document.querySelectorAll('[data-key^=\"{layer}:\"]')].map(k=>+k.dataset.key.split(':')[1])")
    def at(layer, f): click_cell(layer, f); return stage()

    cmd("Runtime.enable"); cmd("Page.enable"); cmd("DOM.enable")
    cmd("Page.navigate", url="http://localhost:3000/native-lab"); time.sleep(6)
    root = cmd("DOM.getDocument")["root"]["nodeId"]
    cmd("DOM.setFileInputFiles", files=[FLA], nodeId=cmd("DOM.querySelector", nodeId=root, selector="input[type=file]")["nodeId"])
    for _ in range(120):
        time.sleep(1)
        if js("!!document.querySelector('[data-testid=toggle-editor]')"): break
    click("[data-testid=toggle-editor]"); time.sleep(2)
    length = int(js("(()=>{const t=[...document.querySelectorAll('div')].map(d=>d.textContent).filter(t=>/^frame \\d+ of \\d+/.test(t)).pop();return t.match(/of (\\d+)/)[1]})()"))
    print("pose length", length)
    # a layer with keyframes to work on (row 1 is usually the first art layer)
    rows = js("document.querySelectorAll('[data-testid=timeline] [data-layer]').length")
    L = next(i for i in range(rows) if len(keys_of(i) or []) >= 3)
    print("working layer", L, "keys", keys_of(L)[:8])

    # ---- copy / paste frames, all layers
    A, B, C = 10, 14, min(40, length - 8)
    orig = {f: at(L, f) for f in list(range(A, B + 1)) + list(range(C, C + 7))}
    js("[...document.querySelectorAll('label')].find(l=>/all layers/.test(l.textContent)).querySelector('input').click()"); time.sleep(0.3)
    click_cell(L, A); click_cell(L, B, mods=8)
    combo("KeyC", "c", 1 | 4)
    check("⌥⌘C copies the selected frames of all layers", note().startswith(f"Copied {B - A + 1} frames of"), note())
    click_cell(L, C)
    combo("KeyV", "v", 1 | 4)
    check("⌥⌘V pastes", note().startswith(f"Pasted {B - A + 1} frames"), note())
    same = [at(L, C + k) == orig[A + k] for k in range(B - A + 1)]
    check("each pasted frame looks exactly like the copied one", all(same), str(same))
    check("frames after the paste look as before", at(L, C + 5) == orig[C + 5] and at(L, C + 6) == orig[C + 6])
    js("document.querySelector('[data-testid=undo]').click()"); time.sleep(0.4)
    check("Undo: the frames as before", all(at(L, f) == orig[f] for f in range(C, C + 5)))
    js("[...document.querySelectorAll('label')].find(l=>/all layers/.test(l.textContent)).querySelector('input').click()"); time.sleep(0.3)

    # ---- ⌘C follows the last press: timeline -> frames, stage -> part
    click_cell(L, A)
    combo("KeyC", "c", 4)
    check("⌘C after a press in the timeline copies frames", note().startswith("Copied 1 frame"), note())
    for dy in (0.35, 0.45, 0.3, 0.5):
        sx, sy = centre("[data-testid=stage]", 0.5, dy); mouse("mousePressed", sx, sy); mouse("mouseReleased", sx, sy); time.sleep(0.4)
        if js("!!document.querySelector('[data-testid=native-props]')"): break
    combo("KeyC", "c", 4)
    check("⌘C after a press on the stage copies the part", note().startswith("Copied ") and " from " in note(), note())

    # ---- cut frames on one layer
    keysL = keys_of(L)
    k0 = keysL[1]
    img_before = at(L, k0)
    click_cell(L, k0); click_cell(L, k0 + 1, mods=8)
    click("[data-testid=cut-frames]")
    check("Cut frames: copied and left empty", note().startswith("Cut 2 frames") and at(L, k0) != img_before, note())
    js("document.querySelector('[data-testid=undo]').click()"); time.sleep(0.4)
    check("Undo brings them back", at(L, k0) == img_before)

    # ---- keyframe drag: move, and ⌥-drag copy onto another layer
    k = keysL[1]
    nxt = keysL[2]
    target = k + 1 if k + 1 < nxt else k
    x0, y0 = cell(L, k); x1, _ = cell(L, target)
    mouse("mousePressed", x0, y0); mouse("mouseMoved", (x0 + x1) / 2, y0, buttons=1); mouse("mouseMoved", x1, y0, buttons=1); mouse("mouseReleased", x1, y0); time.sleep(0.4)
    moved = keys_of(L)
    check("dragging a keyframe moves it", target != k and target in moved and k not in moved, f"{k} -> {target}: {moved[:6]}")
    check("...and only it: the keyframes after it stay where they were (as Animate)", [f for f in moved if f > target] == [f for f in keysL if f > k], f"{keysL[:6]} -> {moved[:6]}")
    js("document.querySelector('[data-testid=undo]').click()"); time.sleep(0.4)
    check("Undo puts it back", keys_of(L) == keysL)
    other = L + 1 if L + 1 < rows else L - 1
    drop = max(keys_of(other) or [0]) + 3 if False else 50 if length > 52 else length - 2
    xo, yo = cell(other, drop)
    mouse("mousePressed", x0, y0, modifiers=1); mouse("mouseMoved", x0 + 30, (y0 + yo) / 2, buttons=1, modifiers=1); mouse("mouseMoved", xo, yo, buttons=1, modifiers=1)
    time.sleep(0.2)
    check("⌥-drag shows where the copy will land", bool(js("!!document.querySelector('[data-testid=key-copy-ghost]')")))
    mouse("mouseReleased", xo, yo, modifiers=1); time.sleep(0.5)
    check("⌥-drag leaves the original", keys_of(L) == keysL, str(keys_of(L)[:6]))
    check("...and puts a copy on the other layer", drop in (keys_of(other) or []), f"{note()} | {keys_of(other)[:8]}")
finally:
    chrome.terminate()
print("FAILED:" if failed else "ALL PASSED", failed)
sys.exit(1 if failed else 0)
