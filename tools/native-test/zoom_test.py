"""Zoom inside a pose open in place, with real key, mouse and wheel events.

usage: python3 zoom_test.py <throwaway project id> <out dir> <source project id>
The throwaway scene gets the source's first character (Sardar, plain). Its pose opens in place, fitted. ⌘+ / ⌘− zoom the POSE's stage (about
its middle) and the zoom box shows it; a part picked at the fitted view is picked again where it now shows; a drag moves it by the pointer's
distance at the new zoom. The wheel zooms about the pointer. Space-drag moves the view, not the part. ⌘1 is 100%, ⌘0 fits again. Leaving the
pose leaves the scene's own zoom as it was; opening it again starts fitted. Enter / Return plays and pauses the pose (the scene outside it).
"""
import base64, io, json, os, subprocess, sys, time, urllib.request, websocket
from PIL import Image, ImageChops, ImageStat

PROJECT, OUT, SOURCE = sys.argv[1], sys.argv[2], sys.argv[3]
os.makedirs(OUT, exist_ok=True)
chrome = subprocess.Popen(["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "--headless=new", "--remote-debugging-port=9565",
                           f"--user-data-dir={OUT}/profile", "--window-size=1600,1000", "about:blank"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
failed = []
def get(u): return json.load(urllib.request.urlopen(u))
try:
    for _ in range(50):
        try: tabs = json.load(urllib.request.urlopen("http://127.0.0.1:9565/json")); break
        except Exception: time.sleep(0.2)
    ws = websocket.create_connection([t for t in tabs if t["type"] == "page"][0]["webSocketDebuggerUrl"], timeout=300)
    n = [0]
    def cmd(method, **params):
        n[0] += 1; ws.send(json.dumps({"id": n[0], "method": method, "params": params}))
        while True:
            msg = json.loads(ws.recv())
            if msg.get("method") == "Runtime.exceptionThrown": print("EXC", msg["params"]["exceptionDetails"].get("exception", {}).get("description", "")[:300])
            if msg.get("id") == n[0]: return msg.get("result", msg)
    def js(e):
        r = cmd("Runtime.evaluate", expression=e, returnByValue=True, awaitPromise=True)
        return r.get("result", {}).get("value")
    def check(name, ok, detail=""):
        print(("PASS " if ok else "FAIL ") + name, detail)
        if not ok: failed.append(name)
    def mouse(kind, x, y, **kw): cmd("Input.dispatchMouseEvent", type=kind, x=x, y=y, button=kw.pop("button", "left"), clickCount=kw.pop("clickCount", 1), **kw)
    def click_at(x, y):
        mouse("mousePressed", x, y); mouse("mouseReleased", x, y); time.sleep(0.5)
    def drag(x0, y0, x1, y1, steps=8):
        mouse("mousePressed", x0, y0)
        for i in range(1, steps + 1): mouse("mouseMoved", x0 + (x1 - x0) * i / steps, y0 + (y1 - y0) * i / steps)
        mouse("mouseReleased", x1, y1); time.sleep(0.6)
    def key(k, code, vk, mods=0): cmd("Input.dispatchKeyEvent", type="keyDown", key=k, code=code, windowsVirtualKeyCode=vk, modifiers=mods); cmd("Input.dispatchKeyEvent", type="keyUp", key=k, code=code, windowsVirtualKeyCode=vk, modifiers=mods); time.sleep(0.5)
    def wait(expr, seconds=30):
        for _ in range(seconds * 4):
            if js(expr): return True
            time.sleep(0.25)
        return False
    def scene(): return [p for p in get("http://localhost:3000/api/projects") if p["id"] == PROJECT][0]["scenes"][0]
    STAGE = "[data-testid=native-stage-host] [data-testid=stage]"
    IN = f"!!document.querySelector('{STAGE}')"
    picked = lambda: js("(()=>{const p=document.querySelector('[data-testid=native-editor]')?.dataset.picked;return p?JSON.parse(p):null})()")
    view = lambda: js("JSON.parse(document.querySelector('[data-testid=native-editor]').dataset.view)")
    percent = lambda: int((js("document.querySelector('.cb-canvas-zoom-value').textContent") or "0").split()[-1].rstrip("%"))
    rect = lambda: js(f"(()=>{{const r=document.querySelector('{STAGE}').getBoundingClientRect();return [r.left,r.top,r.width,r.height]}})()")
    def stage_img():
        r = rect()
        return Image.open(io.BytesIO(base64.b64decode(cmd("Page.captureScreenshot", format="png", clip={"x": r[0], "y": r[1], "width": r[2], "height": r[3], "scale": 1})["data"]))).convert("L")
    def diff(a, b): return ImageStat.Stat(ImageChops.difference(a, b)).mean[0]
    # A screen point -> a point of the open level, through the stage's own view.
    def level_at(x, y):
        v, r = view(), rect()
        return ((x - r[0]) * v["k"] - v["tx"]) / v["s"], ((y - r[1]) * v["k"] - v["ty"]) / v["s"]
    def enter():
        js("""(()=>{const e=document.querySelector('[title*="step inside it"]');const r=e.getBoundingClientRect();e.dispatchEvent(new MouseEvent('dblclick',{bubbles:true,cancelable:true,clientX:r.left+r.width/2,clientY:r.top+r.height*0.4,view:window}))})()""")
        return wait(IN, 60) and wait("!!document.querySelector('[data-testid=native-editor]')?.dataset.view", 20)
    blur = lambda: js("document.activeElement && document.activeElement.blur()")

    cmd("Runtime.enable"); cmd("Page.enable")
    src = [p for p in get("http://localhost:3000/api/projects") if p["id"] == SOURCE][0]["scenes"][0]["editor_data"]["objects"][0]
    sc = scene(); ed = sc["editor_data"]; o = json.loads(json.dumps(src))
    for k in ("symbolKeys", "symbolValues", "symbolEases", "symbolLayers", "colorReplacements", "colorOverrides", "nativePose", "nativePoseFit", "partOverrides", "partKeyframes", "partReplacements", "onlyParts", "strokeScale"): o.pop(k, None)
    ed["objects"] = [o]; ed["background"] = "#ffffff"
    urllib.request.urlopen(urllib.request.Request(f"http://localhost:3000/api/scenes/{sc['id']}", data=json.dumps({"editor_data": ed}).encode(), method="PATCH", headers={"Content-Type": "application/json"})).read()
    cmd("Page.navigate", url="http://localhost:3000/"); time.sleep(1)
    js("Object.keys(localStorage).filter(k=>k.startsWith('cb-symbol-view')||k.startsWith('cb-canvas-view')).forEach(k=>localStorage.removeItem(k))")
    cmd("Page.navigate", url=f"http://localhost:3000/editor/{PROJECT}"); time.sleep(12)

    scene_percent = percent()
    check("the pose opens in place", enter())
    time.sleep(1.5)
    fit_percent, fit_view = percent(), view()
    check("it opens fitted (zoom 1)", abs(fit_view["zoom"] - 1) < 1e-6, str(fit_view))
    r = rect(); cx, cy = r[0] + r[2] / 2, r[1] + r[3] / 2

    # ---- a part picked at the fitted view, off the middle
    spot = None
    for dx, dy in ((0, -60), (0, 40), (0, -100), (20, 0), (0, 0)):
        click_at(cx + dx, cy + dy)
        if picked(): spot = (dx, dy); break
    check("a part is picked at the fitted view", bool(spot), str(spot))
    first = picked()
    click_at(r[0] + 8, r[1] + r[3] - 8)  # empty corner: drop the pick
    before = stage_img()

    # ---- ⌘+ zooms the pose's stage about its middle
    blur(); key("=", "Equal", 187, 4)
    time.sleep(0.8)
    v = view()
    check("⌘+ zooms the pose (×1.25)", abs(v["zoom"] - 1.25) < 1e-6, str(v["zoom"]))
    check("...and the zoom box shows it", abs(percent() - fit_percent * 1.25) <= 1, f"{fit_percent} -> {percent()}")
    after = stage_img()
    w, h = before.size
    grown = before.resize((round(w * 1.25), round(h * 1.25)), Image.BILINEAR)
    gx, gy = (grown.size[0] - w) // 2, (grown.size[1] - h) // 2
    expected = grown.crop((gx, gy, gx + w, gy + h))
    check("the drawing is the same picture, 1.25× bigger about the middle", diff(expected, after) < diff(before, after) * 0.5,
          f"zoomed-vs-expected {diff(expected, after):.2f}, before-vs-after {diff(before, after):.2f}")
    Image.merge("RGB", (expected, after, after)).save(f"{OUT}/1-zoom-overlay.png")

    # ---- picking follows the zoom: the same part sits 1.25× further from the middle now
    click_at(cx + spot[0] * 1.25, cy + spot[1] * 1.25)
    again = picked()
    check("the same part is picked where it now shows", bool(again) and again["layer"] == first["layer"] and again["el"] == first["el"], f"{first} / {again}")

    # ---- a drag moves it by the pointer's distance at this zoom
    x_before = again["x"]
    blur()
    drag(cx + spot[0] * 1.25, cy + spot[1] * 1.25, cx + spot[0] * 1.25 + 50, cy + spot[1] * 1.25)
    moved = picked()["x"] - x_before
    units = 50 / (percent() / 100)
    check("a 50 px drag moves the part 50 px on screen at this zoom", abs(moved - units) < units * 0.06, f"moved {moved:.2f}, expected {units:.2f}")
    key("z", "KeyZ", 90, 4)
    check("⌘Z takes the drag back", abs(picked()["x"] - x_before) < 0.05, str(picked()["x"]))

    # ---- the wheel zooms about the pointer
    px, py = cx + 120, cy - 80
    at = level_at(px, py)
    cmd("Input.dispatchMouseEvent", type="mouseWheel", x=px, y=py, deltaX=0, deltaY=-100)
    time.sleep(0.8)
    now = level_at(px, py)
    check("the wheel zooms in (×1.15)", abs(view()["zoom"] - 1.25 * 1.15) < 1e-6, str(view()["zoom"]))
    check("...about the pointer (the point under it stays)", abs(now[0] - at[0]) < 0.5 and abs(now[1] - at[1]) < 0.5, f"{at} -> {now}")

    # ---- Space-drag moves the view, not the part
    held = picked()
    tx0 = view()["tx"]
    cmd("Input.dispatchKeyEvent", type="keyDown", key=" ", code="Space", windowsVirtualKeyCode=32)
    time.sleep(0.3)
    drag(cx - 100, cy, cx - 20, cy)
    cmd("Input.dispatchKeyEvent", type="keyUp", key=" ", code="Space", windowsVirtualKeyCode=32)
    time.sleep(0.3)
    v = view()
    check("Space-drag moves the view 80 px", abs((v["tx"] - tx0) / v["k"] - 80) < 2, f"{(v['tx'] - tx0) / v['k']:.1f}")
    check("...and does not move the part", picked() and abs(picked()["x"] - held["x"]) < 0.01, f"{held} / {picked()}")

    # ---- ⌘− zooms out, ⌘1 is 100%, ⌘0 fits again (and back in the middle)
    blur(); key("-", "Minus", 189, 4)
    check("⌘− zooms out (÷1.25)", abs(view()["zoom"] - 1.15) < 1e-6, str(view()["zoom"]))
    key("1", "Digit1", 49, 4)
    check("⌘1 shows the pose at 100%", percent() == 100, str(percent()))
    key("0", "Digit0", 48, 4)
    time.sleep(0.5)
    v = view()
    check("⌘0 fits it again, in the middle", abs(v["zoom"] - 1) < 1e-6 and abs(v["tx"] - fit_view["tx"]) < 0.5 and abs(v["ty"] - fit_view["ty"]) < 0.5 and percent() == fit_percent, f"{v} / {fit_view}")

    # ---- the zoom box's buttons and menu act on the pose too
    js("document.querySelector('.cb-zoom-stepper button[aria-label=\"Zoom in\"]').click()"); time.sleep(0.5)
    check("the zoom box's ▲ zooms the pose", abs(view()["zoom"] - 1.25) < 1e-6, str(view()["zoom"]))
    js("document.querySelector('.cb-canvas-zoom-value').click()"); time.sleep(0.4)
    js("[...document.querySelectorAll('.cb-canvas-zoom-menu button')].find(b=>b.textContent.trim()==='200%').click()"); time.sleep(0.5)
    check("the zoom menu's 200% shows the pose at 200%", percent() == 200, str(percent()))

    # ---- leaving the pose: the scene's own zoom is as it was; opening again starts fitted
    blur(); key("Escape", "Escape", 27); key("Escape", "Escape", 27)
    check("Esc steps out of the pose", wait(f"!{IN}", 10))
    time.sleep(0.5)
    check("the scene's zoom is as it was before the pose opened", percent() == scene_percent, f"{scene_percent} -> {percent()}")
    check("the pose opens again", enter())
    time.sleep(1)
    check("...fitted", abs(view()["zoom"] - 1) < 1e-6 and percent() == fit_percent, f"{view()['zoom']} {percent()}")

    # ---- Enter / Return plays and pauses the pose, as its timeline's play button does; outside the pose it plays the scene
    POSE_PLAY = "document.querySelector('[data-testid=native-timeline-host] button.play')?.getAttribute('aria-label')"
    POSE_FRAME = "document.querySelector('[data-testid=native-timeline-host] .cb-symbol-counter')?.textContent"
    blur()
    f0 = js(POSE_FRAME)
    key("Enter", "Enter", 13)
    check("Enter inside the pose plays it", js(POSE_PLAY) == "Pause", str(js(POSE_PLAY)))
    time.sleep(1)
    check("...and its frame moves on", js(POSE_FRAME) != f0, f"{f0} -> {js(POSE_FRAME)}")
    key("Enter", "Enter", 13)
    held_frame = js(POSE_FRAME); time.sleep(0.6)
    check("Enter again pauses it", js(POSE_PLAY) == "Play" and js(POSE_FRAME) == held_frame, f"{js(POSE_PLAY)} {held_frame} -> {js(POSE_FRAME)}")
    # A press on the play button leaves it focused: Enter then still toggles once (not the button's click as well).
    js("document.querySelector('[data-testid=native-timeline-host] button.play').click()"); time.sleep(0.3)
    js("document.querySelector('[data-testid=native-timeline-host] button.play').focus()")
    key("Enter", "Enter", 13)
    check("with the play button focused, Enter pauses once", js(POSE_PLAY) == "Play", str(js(POSE_PLAY)))
    blur(); key("Escape", "Escape", 27); key("Escape", "Escape", 27)
    wait(f"!{IN}", 10); time.sleep(0.5)
    SCENE_PLAY = "document.querySelector('button.play[title=\"Play / Stop (Enter)\"]')?.getAttribute('aria-label')"
    blur(); key("Enter", "Enter", 13)
    check("outside the pose Enter plays the scene", js(SCENE_PLAY) == "Pause", str(js(SCENE_PLAY)))
    key("Enter", "Enter", 13)
    check("...and Enter stops it", js(SCENE_PLAY) == "Play", str(js(SCENE_PLAY)))
finally:
    chrome.kill()
print("FAILED: " + ", ".join(failed) if failed else "ALL PASSED")
