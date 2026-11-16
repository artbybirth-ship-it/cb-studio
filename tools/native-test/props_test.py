"""Phase 6 B: the Properties number boxes in the native pose editor (/native-lab), with real mouse and key events.

usage: python3 props_test.py <file.fla> <out dir>
Selects a part on the stage, then: typing X moves it (and only X changes); Undo puts it back; dragging W is shown live and kept as ONE
undo step; Esc during a drag puts the number back and keeps nothing; typing Rotate and Opacity change the picture.
Needs the dev server on :3000 and `websocket-client`.
"""
import base64, json, os, subprocess, sys, time, urllib.request, websocket

FLA, OUT = sys.argv[1], sys.argv[2]
os.makedirs(OUT, exist_ok=True)
chrome = subprocess.Popen(["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "--headless=new", "--remote-debugging-port=9558",
                           f"--user-data-dir={OUT}/profile", "--window-size=1400,1100", "about:blank"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
failed = []
try:
    for _ in range(50):
        try: tabs = json.load(urllib.request.urlopen("http://127.0.0.1:9558/json")); break
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
    def key(k, code, vk): cmd("Input.dispatchKeyEvent", type="keyDown", key=k, code=code, windowsVirtualKeyCode=vk); cmd("Input.dispatchKeyEvent", type="keyUp", key=k, code=code, windowsVirtualKeyCode=vk)
    def shot(name): open(f"{OUT}/{name}.png", "wb").write(base64.b64decode(cmd("Page.captureScreenshot", format="png")["data"]))
    stage = lambda: js("document.querySelector('[data-testid=stage]').toDataURL()")
    val = lambda f: js(f"(()=>{{const i=document.querySelector('[data-testid=native-prop-{f}]');return i?parseFloat(i.value):null}})()")
    vals = lambda: {f: val(f) for f in ("x", "y", "w", "h", "rotation", "skew")}
    undo_steps = lambda: js("document.querySelector('[data-testid=undo]').disabled") is False
    def type_into(f, text):
        click(f"[data-testid=native-prop-{f}]")
        js(f"document.querySelector('[data-testid=native-prop-{f}]').select()")
        cmd("Input.insertText", text=text); key("Enter", "Enter", 13); time.sleep(0.4)

    cmd("Runtime.enable"); cmd("Page.enable"); cmd("DOM.enable")
    cmd("Page.navigate", url="http://localhost:3000/native-lab"); time.sleep(6)
    root = cmd("DOM.getDocument")["root"]["nodeId"]
    cmd("DOM.setFileInputFiles", files=[FLA], nodeId=cmd("DOM.querySelector", nodeId=root, selector="input[type=file]")["nodeId"])
    for _ in range(120):
        time.sleep(1)
        if js("!!document.querySelector('[data-testid=toggle-editor]')"): break
    click("[data-testid=toggle-editor]"); time.sleep(2)
    check("editor opens", bool(js("!!document.querySelector('[data-testid=stage]')")))
    check("no Properties before a part is picked", not js("!!document.querySelector('[data-testid=native-props]')"))
    for dy in (0.35, 0.45, 0.3, 0.5, 0.6):
        x, y = centre("[data-testid=stage]", 0.5, dy); mouse("mousePressed", x, y); mouse("mouseReleased", x, y); time.sleep(0.5)
        if js("!!document.querySelector('[data-testid=native-props]')"): break
    check("picking a part shows its Properties", bool(js("!!document.querySelector('[data-testid=native-props]')")))
    v0, img0 = vals(), stage()
    print("part:", js("document.querySelector('[data-testid=native-props] b').parentElement.textContent"), v0)

    # typed X: only X changes, the picture moves; Undo puts it back
    type_into("x", str(round(v0["x"] + 25, 1)))
    v1, img1 = vals(), stage()
    check("typed X moves the part", abs(v1["x"] - (v0["x"] + 25)) < 0.11 and img1 != img0, f"{v0['x']} -> {v1['x']}")
    check("...and nothing else changes", all(abs(v1[k] - v0[k]) < 0.11 for k in ("y", "w", "h", "rotation", "skew")), str(v1))
    click("[data-testid=undo]"); time.sleep(0.4)
    check("Undo puts X and the picture back", abs(val("x") - v0["x"]) < 0.11 and stage() == img0, f"{val('x')}")

    # dragging W: live, then one undo step
    js("document.activeElement && document.activeElement.blur()")
    wx, wy = centre("[data-testid=native-prop-w]")
    mouse("mousePressed", wx, wy); time.sleep(0.05)
    for dx in (5, 15, 30, 45):
        mouse("mouseMoved", wx + dx, wy, buttons=1); time.sleep(0.08)
    time.sleep(0.3)
    live_w, live_img = val("w"), stage()
    check("dragging W shows the new size while dragging", live_w > v0["w"] + 20 and live_img != img0, f"{v0['w']} -> {live_w}")
    mouse("mouseReleased", wx + 45, wy); time.sleep(0.5)
    check("released: the size stays", abs(val("w") - live_w) < 0.11, f"{val('w')}")
    check("...the transformation point stays put", abs(val("x") - v0["x"]) < 0.2 and abs(val("y") - v0["y"]) < 0.2, str(vals()))
    shot("1-wider")
    click("[data-testid=undo]"); time.sleep(0.4)
    check("ONE Undo takes back the whole drag", abs(val("w") - v0["w"]) < 0.11 and stage() == img0, f"{val('w')}")
    check("...and nothing older was there to undo", not undo_steps())

    # Esc during a drag: back, nothing kept
    hx, hy = centre("[data-testid=native-prop-h]")
    mouse("mousePressed", hx, hy); time.sleep(0.05)
    for dx in (5, 20, 40): mouse("mouseMoved", hx + dx, hy, buttons=1); time.sleep(0.08)
    key("Escape", "Escape", 27); time.sleep(0.2)
    mouse("mouseReleased", hx + 40, hy); time.sleep(0.5)
    check("Esc during a drag puts H back and keeps nothing", abs(val("h") - v0["h"]) < 0.11 and stage() == img0 and not undo_steps(), f"{val('h')}")
    check("...and the editor is still open", bool(js("!!document.querySelector('[data-testid=stage]')")))

    # typed rotation and opacity
    type_into("rotation", str(round(v0["rotation"] + 30, 1)))
    vr = vals()
    check("typed Rotate turns the part", abs(vr["rotation"] - ((v0["rotation"] + 30 + 180) % 360 - 180)) < 0.11 and stage() != img0, str(vr))
    check("...about its transformation point", abs(vr["x"] - v0["x"]) < 0.2 and abs(vr["y"] - v0["y"]) < 0.2, str(vr))
    if js("!!document.querySelector('[data-testid=native-prop-alpha]')"):
        before = stage()
        type_into("alpha", "40")
        check("typed Opacity 40% fades the part", val("alpha") == 40 and stage() != before, f"{val('alpha')}")
    shot("2-turned")
    click("[data-testid=undo]"); time.sleep(0.3); click("[data-testid=undo]"); time.sleep(0.3)
    check("Undo twice: back to the start", stage() == img0, str(vals()))
    # Keys typed into a box stay in it: F-keys and letters are not editor commands while typing.
    click("[data-testid=native-prop-x]"); before_frames = js("document.querySelector('[data-testid=timeline]').innerHTML.length")
    cmd("Input.insertText", text="a"); key("F6", "F6", 117); time.sleep(0.3)
    check("typing in a box does not run F6 or A", js("document.querySelector('[data-testid=timeline]').innerHTML.length") == before_frames and not js("document.querySelector('[data-testid=point-mode]').getAttribute('aria-pressed')==='true'"))
    key("Escape", "Escape", 27)
finally:
    chrome.terminate()
print("FAILED:" if failed else "ALL PASSED", failed)
sys.exit(1 if failed else 0)
