"""A pose open in place (Animate's Edit in Place), its view and its keys, with real key, mouse and wheel events.

usage: python3 zoom_test.py <throwaway project id> <out dir> <source project id>
The throwaway scene gets the source's first character (Sardar, plain). Its pose opens IN PLACE: drawn exactly where the character stands
on the scene, with the scene's canvas (its size, the stage and the pasteboard) showing around it, and the scene's own drawing of the
character standing aside. ⌘+ / ⌘− / ⌘0 / ⌘1, the zoom box, the wheel and Space-drag move the scene's canvas and the pose with it; a part
is picked and dragged where it shows at any zoom. A part stepped into opens where it sits. Leaving the pose keeps the canvas's zoom.
Enter / Return plays and pauses the pose (the scene outside it).
"""
import base64, io, json, math, os, subprocess, sys, time, urllib.request, websocket
from pose_view import pose_rect
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
    def click_at(x, y, count=1):
        for i in range(1, count + 1): mouse("mousePressed", x, y, clickCount=i); mouse("mouseReleased", x, y, clickCount=i)
        time.sleep(0.6)
    def drag(x0, y0, x1, y1, steps=8):
        mouse("mousePressed", x0, y0)
        for i in range(1, steps + 1): mouse("mouseMoved", x0 + (x1 - x0) * i / steps, y0 + (y1 - y0) * i / steps)
        mouse("mouseReleased", x1, y1); time.sleep(0.6)
    def key(k, code, vk, mods=0): cmd("Input.dispatchKeyEvent", type="keyDown", key=k, code=code, windowsVirtualKeyCode=vk, modifiers=mods); cmd("Input.dispatchKeyEvent", type="keyUp", key=k, code=code, windowsVirtualKeyCode=vk, modifiers=mods); time.sleep(0.6)
    def wait(expr, seconds=30):
        for _ in range(seconds * 4):
            if js(expr): return True
            time.sleep(0.25)
        return False
    def scene(): return [p for p in get("http://localhost:3000/api/projects") if p["id"] == PROJECT][0]["scenes"][0]
    STAGE = "[data-testid=native-stage-host] [data-testid=stage]"
    IN = f"!!document.querySelector('{STAGE}')"
    PLACED = "(()=>{const v=document.querySelector('[data-testid=native-editor]')?.dataset.view;return !!v&&JSON.parse(v).placed})()"
    picked = lambda: js("(()=>{const p=document.querySelector('[data-testid=native-editor]')?.dataset.picked;return p?JSON.parse(p):null})()")
    view = lambda: js("JSON.parse(document.querySelector('[data-testid=native-editor]').dataset.view)")
    percent = lambda: int((js("document.querySelector('.cb-canvas-zoom-value').textContent") or "0").split()[-1].rstrip("%"))
    rect_of = lambda sel: js(f"(()=>{{const e=document.querySelector({json.dumps(sel)});if(!e)return null;const r=e.getBoundingClientRect();return [r.left,r.top,r.width,r.height]}})()")
    box = lambda: rect_of(".cb-stage-character")
    centre_of = lambda r: (r[0] + r[2] / 2, r[1] + r[3] / 2)
    def grab(r):
        return Image.open(io.BytesIO(base64.b64decode(cmd("Page.captureScreenshot", format="png", clip={"x": r[0], "y": r[1], "width": r[2], "height": r[3], "scale": 1})["data"]))).convert("RGB")
    def diff(a, b): return ImageStat.Stat(ImageChops.difference(a, b).convert("L")).mean[0]
    # Screen point <-> point of the open level, through the stage's view (data-view: level -> canvas pixels, canvas pixels per CSS pixel).
    def level_at(x, y):
        v, r = view(), rect_of(STAGE); m, k = v["m"], v["k"]
        cx, cy = (x - r[0]) * k - m[4], (y - r[1]) * k - m[5]
        det = m[0] * m[3] - m[1] * m[2]
        return ((m[3] * cx - m[2] * cy) / det, (-m[1] * cx + m[0] * cy) / det)
    def screen_of(p):
        v, r = view(), rect_of(STAGE); m, k = v["m"], v["k"]
        return (r[0] + (m[0] * p[0] + m[2] * p[1] + m[4]) / k, r[1] + (m[1] * p[0] + m[3] * p[1] + m[5]) / k)
    units_per_px = lambda: (lambda v: v["k"] / math.sqrt(abs(v["m"][0] * v["m"][3] - v["m"][1] * v["m"][2])))(view())
    near = lambda a, b, tol=1.5: math.hypot(a[0] - b[0], a[1] - b[1]) <= tol
    def enter():
        js("""(()=>{const e=document.querySelector('[title*="step inside it"]');const r=e.getBoundingClientRect();e.dispatchEvent(new MouseEvent('dblclick',{bubbles:true,cancelable:true,clientX:r.left+r.width/2,clientY:r.top+r.height*0.4,view:window}))})()""")
        return wait(IN, 60) and wait(PLACED, 20)
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

    # ---- opens in place: where the character stands, the canvas around it
    fit_percent = percent()
    host = rect_of(".studio-stage-host")
    before = grab(host)
    box0 = box()
    check("the pose opens in place", enter())
    time.sleep(1.5)
    after = grab(host)
    before.save(f"{OUT}/0-scene.png"); after.save(f"{OUT}/1-in-place.png")
    check("it is drawn where the character stands on the scene (same picture over the canvas)", diff(before, after) < 1.5, f"{diff(before, after):.2f}")
    check("the canvas shows around it (the stage is see-through)", js("getComputedStyle(document.querySelector('[data-testid=native-editor]')).backgroundColor") == "rgba(0, 0, 0, 0)")
    corner = (int(host[2] * 0.02), int(host[3] * 0.5))
    check("...the pasteboard and the stage's edge are as on the scene", before.getpixel(corner) == after.getpixel(corner), f"{before.getpixel(corner)} / {after.getpixel(corner)}")
    check("the scene's own drawing of the character stands aside", bool(js("(()=>{const b=document.querySelector('.cb-stage-character[data-native-editing]');const f=b&&b.querySelector('iframe');return !!f&&getComputedStyle(f).visibility==='hidden'})()")))
    check("the canvas keeps its zoom", percent() == fit_percent, f"{fit_percent} -> {percent()}")

    # ---- a part picked where it shows
    b = box(); spot = None
    for fy in (0.35, 0.45, 0.55, 0.3, 0.25):
        x, y = b[0] + b[2] * 0.5, b[1] + b[3] * fy
        click_at(x, y)
        if picked(): spot = (x, y); break
    check("a part is picked where it shows", bool(spot), str(spot))
    first = picked(); L = level_at(*spot)
    click_at(host[0] + 10, host[1] + 10)  # pasteboard: drops the pick
    Lc = level_at(*centre_of(box()))

    # ---- ⌘+ zooms the canvas, and the pose with it
    blur(); key("=", "Equal", 187, 4); time.sleep(0.6)
    check("⌘+ zooms the canvas (×1.25)", abs(percent() - fit_percent * 1.25) <= 1, f"{fit_percent} -> {percent()}")
    check("...and the pose stays on the character's place", near(screen_of(Lc), centre_of(box())), f"{screen_of(Lc)} / {centre_of(box())}")
    click_at(*screen_of(L))
    again = picked()
    check("the same part is picked where it now shows", bool(again) and again["layer"] == first["layer"] and again["el"] == first["el"], f"{first} / {again}")

    # ---- a drag moves it by the pointer's distance at this zoom
    x_before = again["x"]; blur()
    p0 = screen_of(L)
    drag(p0[0], p0[1], p0[0] + 50, p0[1])
    moved, units = picked()["x"] - x_before, 50 * units_per_px()
    check("a 50 px drag moves the part 50 px on screen at this zoom", abs(moved - units) < abs(units) * 0.06, f"moved {moved:.2f}, expected {units:.2f}")
    key("z", "KeyZ", 90, 4)
    check("⌘Z takes the drag back", abs(picked()["x"] - x_before) < 0.05, str(picked()["x"]))

    # ---- the wheel zooms the canvas about the pointer
    px, py = p0[0] + 40, p0[1] - 30
    at = level_at(px, py); was = percent()
    cmd("Input.dispatchMouseEvent", type="mouseWheel", x=px, y=py, deltaX=0, deltaY=-100); time.sleep(0.8)
    check("the wheel over the pose zooms the canvas in", percent() > was, f"{was} -> {percent()}")
    check("...about the pointer (the pose's point under it stays)", near(screen_of(at), (px, py)), f"{screen_of(at)} / {(px, py)}")
    check("...and the pose stays on the character's place", near(screen_of(Lc), centre_of(box())), f"{screen_of(Lc)} / {centre_of(box())}")

    # ---- Space-drag moves the canvas, not the part
    held = picked(); b1 = box(); hx, hy = host[0] + host[2] * 0.2, host[1] + host[3] * 0.5
    cmd("Input.dispatchKeyEvent", type="keyDown", key=" ", code="Space", windowsVirtualKeyCode=32); time.sleep(0.3)
    drag(hx, hy, hx + 80, hy)
    cmd("Input.dispatchKeyEvent", type="keyUp", key=" ", code="Space", windowsVirtualKeyCode=32); time.sleep(0.4)
    b2 = box()
    check("Space-drag over the pose moves the canvas 80 px", abs(b2[0] - b1[0] - 80) < 2, f"{b2[0] - b1[0]:.1f}")
    check("...and the pose with it", near(screen_of(Lc), centre_of(b2)), f"{screen_of(Lc)} / {centre_of(b2)}")
    check("...and does not move the part", picked() and abs(picked()["x"] - held["x"]) < 0.01, f"{held} / {picked()}")

    # ---- ⌘− / ⌘1 / ⌘0, the zoom box
    blur(); was = percent(); key("-", "Minus", 189, 4)
    check("⌘− zooms the canvas out", percent() < was, f"{was} -> {percent()}")
    key("1", "Digit1", 49, 4)
    check("⌘1 shows the canvas at 100%", percent() == 100, str(percent()))
    key("0", "Digit0", 48, 4); time.sleep(0.5)
    check("⌘0 fits the canvas again", percent() == fit_percent, str(percent()))
    check("...with the pose back where the character stands", near(screen_of(Lc), centre_of(box())) and near(centre_of(box()), centre_of(box0), 2), f"{centre_of(box())} / {centre_of(box0)}")
    js("document.querySelector('.cb-zoom-stepper button[aria-label=\"Zoom in\"]').click()"); time.sleep(0.5)
    check("the zoom box's ▲ zooms the canvas", abs(percent() - fit_percent * 1.25) <= 1, str(percent()))
    js("document.querySelector('.cb-canvas-zoom-value').click()"); time.sleep(0.4)
    js("[...document.querySelectorAll('.cb-canvas-zoom-menu button')].find(b=>b.textContent.trim()==='Fit in Window').click()"); time.sleep(0.6)
    check("Fit in Window fits it again", percent() == fit_percent, str(percent()))

    # ---- a part stepped into opens where it sits, the rest of the character around it dimmed (Animate's Edit in Place)
    # The stage's own pixels (alpha too): opaque where the pose is drawn in full, partly see-through where it is dimmed.
    alpha_at = lambda x, y: js(f"(()=>{{const c=document.querySelector('{STAGE}');const r=c.getBoundingClientRect();const k=c.width/r.width;return c.getContext('2d').getImageData(Math.round(({x}-r.left)*k),Math.round(({y}-r.top)*k),1,1).data[3]}})()")
    fr = pose_rect(js)
    others_at = [(fr[0] + fr[2] * fx, fr[1] + fr[3] * fy) for fx, fy in ((0.5, 0.1), (0.48, 0.14), (0.53, 0.12), (0.5, 0.85), (0.47, 0.9), (0.53, 0.9), (0.45, 0.8), (0.55, 0.8))]
    others_at = [p for p in others_at if (alpha_at(*p) or 0) > 230]
    sx, sy = screen_of(L)
    whole = grab(host)
    colour_before = whole.getpixel((int(sx - host[0]), int(sy - host[1])))
    m_root = view()["m"]
    click_at(sx, sy, 2); time.sleep(1.5)
    stepped = view()["m"] != m_root
    check("a double-click on a part steps into it", stepped, str(view()["m"]))
    inside = grab(host)
    colour_after = inside.getpixel((int(sx - host[0]), int(sy - host[1])))
    check("...and it opens where it sits (same colour under the pointer)", stepped and max(abs(a - b) for a, b in zip(colour_before, colour_after)) < 40, f"{colour_before} / {colour_after}")
    inside.save(f"{OUT}/2-stepped-in.png")
    check("...drawn in full", (alpha_at(sx, sy) or 0) > 230, str(alpha_at(sx, sy)))
    dimmed = [p for p in others_at if 40 <= (alpha_at(*p) or 0) <= 160]
    check("the rest of the character still shows around it, dimmed", bool(dimmed), str([(round(p[0]), round(p[1]), alpha_at(*p)) for p in others_at]))
    if dimmed:
        dx, dy = dimmed[0]
        c_in = inside.getpixel((int(dx - host[0]), int(dy - host[1]))); c_out = whole.getpixel((int(dx - host[0]), int(dy - host[1])))
        check("...lighter than in full, but there", sum(c_in) > sum(c_out) + 60 and c_in != (255, 255, 255), f"{c_out} -> {c_in}")
        click_at(dx, dy)
        check("a click on the dimmed part picks nothing", not picked(), str(picked()))
    click_at(host[0] + 10, host[1] + 10, 2); time.sleep(1)
    check("a double-click on the pasteboard steps back out to the pose, in place", view()["m"] == m_root, str(view()["m"]))
    check("...where the whole character is in full again", all((alpha_at(*p) or 0) > 230 for p in others_at), str([alpha_at(*p) for p in others_at]))

    # ---- leaving: the character is drawn by the scene again, the canvas keeps the zoom it has
    blur(); key("=", "Equal", 187, 4); inside_percent = percent()
    key("Escape", "Escape", 27); key("Escape", "Escape", 27)
    check("Esc steps out of the pose", wait(f"!{IN}", 10))
    time.sleep(0.5)
    check("the scene draws the character again", not js("!!document.querySelector('.cb-stage-character[data-native-editing]')"))
    check("the canvas keeps the zoom it had in the pose (as in Animate)", percent() == inside_percent, f"{inside_percent} -> {percent()}")
    key("0", "Digit0", 48, 4)

    # ---- Enter / Return plays and pauses the pose, as its timeline's play button does; outside it plays the scene
    check("the pose opens again", enter())
    time.sleep(1)
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
