"""Phase 6 B: the Free Transform handles and arrow-key nudging in the native pose editor (/native-lab), with real mouse and key events.

usage: python3 handles_test.py <file.fla> <out dir>
A picked part shows a box with 8 scale handles, 4 rotate zones, 4 skew edges and its transformation point. Dragging a corner scales from the
opposite corner (which stays), Shift keeps the shape; rotating turns about the transformation point (Shift: 15° steps); skewing slants it;
the transformation point moves without moving the artwork and double-click puts it back; arrows nudge 1 (Shift 10). Each is one undo step.
Two parts selected: one box around both, scaling changes both.
"""
import base64, json, math, os, subprocess, sys, time, urllib.request, websocket

FLA, OUT = sys.argv[1], sys.argv[2]
os.makedirs(OUT, exist_ok=True)
chrome = subprocess.Popen(["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "--headless=new", "--remote-debugging-port=9562",
                           f"--user-data-dir={OUT}/profile", "--window-size=1400,1100", "about:blank"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
failed = []
try:
    for _ in range(50):
        try: tabs = json.load(urllib.request.urlopen("http://127.0.0.1:9562/json")); break
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
    def drag(sel, dx, dy, mods=0, steps=4, at=(0.5, 0.5)):
        x, y = centre(sel, *at)
        mouse("mousePressed", x, y, modifiers=mods)
        for k in range(1, steps + 1): mouse("mouseMoved", x + dx * k / steps, y + dy * k / steps, buttons=1, modifiers=mods); time.sleep(0.05)
        mouse("mouseReleased", x + dx, y + dy, modifiers=mods); time.sleep(0.5)
    def drag_to(sel, tx, ty, mods=0, steps=8):
        x, y = centre(sel)
        mouse("mousePressed", x, y, modifiers=mods)
        for k in range(1, steps + 1): mouse("mouseMoved", x + (tx - x) * k / steps, y + (ty - y) * k / steps, buttons=1, modifiers=mods); time.sleep(0.04)
        mouse("mouseReleased", tx, ty, modifiers=mods); time.sleep(0.5)
    def key(k, code, vk, mods=0): cmd("Input.dispatchKeyEvent", type="keyDown", key=k, code=code, windowsVirtualKeyCode=vk, modifiers=mods); cmd("Input.dispatchKeyEvent", type="keyUp", key=k, code=code, windowsVirtualKeyCode=vk, modifiers=mods); time.sleep(0.3)
    def shot(name): open(f"{OUT}/{name}.png", "wb").write(base64.b64decode(cmd("Page.captureScreenshot", format="png")["data"]))
    stage = lambda: js("document.querySelector('[data-testid=stage]').toDataURL()")
    val = lambda f: js(f"(()=>{{const i=document.querySelector('[data-testid=native-prop-{f}]');return i?parseFloat(i.value):null}})()")
    vals = lambda: {f: val(f) for f in ("x", "y", "w", "h", "rotation", "skew")}
    undo = lambda: (click("[data-testid=undo]"), time.sleep(0.2))
    can_undo = lambda: js("!document.querySelector('[data-testid=undo]').disabled")

    cmd("Runtime.enable"); cmd("Page.enable"); cmd("DOM.enable")
    cmd("Page.navigate", url="http://localhost:3000/native-lab"); time.sleep(6)
    root = cmd("DOM.getDocument")["root"]["nodeId"]
    cmd("DOM.setFileInputFiles", files=[FLA], nodeId=cmd("DOM.querySelector", nodeId=root, selector="input[type=file]")["nodeId"])
    for _ in range(120):
        time.sleep(1)
        if js("!!document.querySelector('[data-testid=toggle-editor]')"): break
    click("[data-testid=toggle-editor]"); time.sleep(2)
    check("no handles before a part is picked", not js("!!document.querySelector('[data-testid=handles]')"))
    for dy in (0.35, 0.45, 0.3, 0.5, 0.6):
        sx, sy = centre("[data-testid=stage]", 0.5, dy); mouse("mousePressed", sx, sy); mouse("mouseReleased", sx, sy); time.sleep(0.5)
        if js("!!document.querySelector('[data-testid=native-props]')"): break
    check("a picked part shows the handles", js("document.querySelectorAll('[data-testid=handles] [data-testid^=handle-]').length") >= 17)
    v0, img0 = vals(), stage()
    # the picture alone (the selection's marks are drawn on the stage too): nothing selected
    def plain():
        cx, cy = centre("[data-testid=stage]", 0.02, 0.03); mouse("mousePressed", cx, cy); mouse("mouseReleased", cx, cy); time.sleep(0.4)
        img = stage(); mouse("mousePressed", sx, sy); mouse("mouseReleased", sx, sy); time.sleep(0.5)
        return img
    plain0 = plain()
    print("part", v0)
    shot("1-handles")

    # corner scale: the opposite corner stays
    nw0 = centre("[data-testid=handle-nw]")
    drag("[data-testid=handle-se]", 40, 30)
    v1, nw1 = vals(), centre("[data-testid=handle-nw]")
    check("dragging a corner scales the part", v1["w"] > v0["w"] + 5 and v1["h"] > v0["h"] + 5 and stage() != img0, f"{v0['w']}x{v0['h']} -> {v1['w']}x{v1['h']}")
    check("...from the opposite corner, which stays", abs(nw1[0] - nw0[0]) < 1.5 and abs(nw1[1] - nw0[1]) < 1.5, f"{nw0} -> {nw1}")
    shot("2-scaled")
    undo()
    check("one Undo takes back the whole drag", vals() == v0 and stage() == img0 and not can_undo(), str(vals()))
    # Shift keeps the shape
    drag("[data-testid=handle-se]", 50, 10, mods=8)
    v2 = vals()
    check("Shift on a corner keeps the shape", abs(v2["w"] / v0["w"] - v2["h"] / v0["h"]) < 0.02 and v2["w"] > v0["w"], f"{v2['w']} / {v2['h']}")
    undo()
    # a side: only one way
    drag("[data-testid=handle-e]", 30, 0)
    v3 = vals()
    check("a side handle scales one way only", abs(v3["h"] - v0["h"]) < 0.2 and abs(v3["w"] - v0["w"]) > 3, f"{v3['w']} x {v3['h']}")
    undo()

    # rotate about the transformation point, Shift snaps to 15°
    px, py = centre("[data-testid=handle-pivot]")
    rx, ry = centre("[data-testid=handle-rotate-ne]")
    ang = math.atan2(ry - py, rx - px) + math.radians(40); rad = math.hypot(rx - px, ry - py)
    drag_to("[data-testid=handle-rotate-ne]", px + rad * math.cos(ang), py + rad * math.sin(ang), mods=8)
    v4 = vals()
    turned = (v4["rotation"] - v0["rotation"] + 540) % 360 - 180
    check("rotate turns the part (Shift: a multiple of 15°)", abs(turned) > 10 and abs(turned / 15 - round(turned / 15)) < 0.02, f"{v0['rotation']} -> {v4['rotation']}")
    check("...about its transformation point", abs(v4["x"] - v0["x"]) < 0.3 and abs(v4["y"] - v0["y"]) < 0.3, str(v4))
    shot("3-rotated")
    undo()

    # skew along the top edge
    drag("[data-testid=handle-skew-n]", 30, 0, at=(0.2, 0.5))  # along the edge, away from the middle scale handle
    v5 = vals()
    check("dragging the top edge skews the part", abs(v5["skew"] - v0["skew"]) > 3 and stage() != img0, f"skew {v0['skew']} -> {v5['skew']}")
    undo()

    # transformation point: moves, the artwork does not; double-click puts it back in the middle
    drag("[data-testid=handle-pivot]", 25, 0)
    v6 = vals()
    check("moving the transformation point changes X / Y", abs(v6["x"] - v0["x"]) > 3, f"{v0['x']} -> {v6['x']}")
    check("...but not the picture", plain() == plain0)
    x, y = centre("[data-testid=handle-pivot]")
    mouse("mousePressed", x, y); mouse("mouseReleased", x, y); mouse("mousePressed", x, y, clickCount=2); mouse("mouseReleased", x, y, clickCount=2); time.sleep(0.5)
    v7 = vals()
    check("double-click puts it in the middle of the part", abs(v7["x"] - v6["x"]) > 0.5 or abs(v7["y"] - v6["y"]) > 0.5, f"{v6['x']},{v6['y']} -> {v7['x']},{v7['y']}")
    while can_undo(): undo()
    check("back to the start", stage() == img0 and vals() == v0)

    # arrows
    js("document.activeElement && document.activeElement.blur()")
    key("ArrowRight", "ArrowRight", 39); key("ArrowRight", "ArrowRight", 39); key("ArrowDown", "ArrowDown", 40, mods=8)
    v8 = vals()
    check("arrows nudge 1, Shift 10", abs(v8["x"] - (v0["x"] + 2)) < 0.11 and abs(v8["y"] - (v0["y"] + 10)) < 0.11, f"{v0['x']},{v0['y']} -> {v8['x']},{v8['y']}")
    undo()
    check("each nudge is its own undo step", abs(val("x") - (v0["x"] + 2)) < 0.11 and abs(val("y") - v0["y"]) < 0.11)
    while can_undo(): undo()

    # two parts: one box around both, scaling changes both
    w_one = js("(()=>{const r=document.querySelector('[data-testid=handle-se]').getBoundingClientRect();return r.left})()")
    found2 = False
    for dx in (-0.15, 0.15, -0.25, 0.25, 0, -0.1, 0.1):
        for dy in (0.55, 0.7, 0.45, 0.8, 0.25):
            ox, oy = centre("[data-testid=stage]", 0.5 + dx, dy)
            mouse("mousePressed", ox, oy, modifiers=8); mouse("mouseReleased", ox, oy, modifiers=8); time.sleep(0.4)
            if js("!!document.querySelector('[data-testid=handle-se]') && !document.querySelector('[data-testid=handle-pivot]')"):
                found2 = True; break
            if not js("!!document.querySelector('[data-testid=handle-se]')"):  # the click let go of the first part: pick it again
                mouse("mousePressed", sx, sy); mouse("mouseReleased", sx, sy); time.sleep(0.4)
        if found2: break
    check("shift-click a second part: the box grows around both", found2)
    if found2:
        before = stage()
        check("several parts: no transformation point to drag", not js("!!document.querySelector('[data-testid=handle-pivot]')"))
        drag("[data-testid=handle-e]", 30, 0)
        check("scaling the box changes the picture", stage() != before)
        undo()
        check("one Undo for both", stage() == before)
finally:
    chrome.terminate()
print("FAILED:" if failed else "ALL PASSED", failed)
sys.exit(1 if failed else 0)
