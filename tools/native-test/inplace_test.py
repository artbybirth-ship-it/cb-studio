"""Phase 6 C: the native pose editor in place in the scene editor (single timeline), with real mouse and key events.

usage: python3 inplace_test.py <throwaway project id> <out dir> <source project id>
The throwaway scene gets the source's first character (Sardar, plain). A double-click opens its pose IN PLACE (native stage over the canvas,
its timeline in the timeline row; no older pose timeline, no beta window). Arrow nudges are saved on the character at once, each one step of
the scene's one Undo (⌘Z / ⌘⇧Z). Light/Dark inside the pose recolours the native stage, and ⌘Z undoes that colour, not the pose edits.
Esc first puts Light/Dark away, the next goes back to the scene, which draws the edit; opening again shows it; a double-click on empty stage steps out.
"""
import base64, io, json, os, subprocess, sys, time, urllib.request, websocket
from PIL import Image

PROJECT, OUT, SOURCE = sys.argv[1], sys.argv[2], sys.argv[3]
os.makedirs(OUT, exist_ok=True)
chrome = subprocess.Popen(["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "--headless=new", "--remote-debugging-port=9564",
                           f"--user-data-dir={OUT}/profile", "--window-size=1600,1000", "about:blank"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
failed = []
def get(u): return json.load(urllib.request.urlopen(u))
try:
    for _ in range(50):
        try: tabs = json.load(urllib.request.urlopen("http://127.0.0.1:9564/json")); break
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
    def mouse(kind, x, y, **kw): cmd("Input.dispatchMouseEvent", type=kind, x=x, y=y, button="left", clickCount=kw.pop("clickCount", 1), **kw)
    def click_at(x, y, count=1):
        for i in range(1, count + 1): mouse("mousePressed", x, y, clickCount=i); mouse("mouseReleased", x, y, clickCount=i)
        time.sleep(0.5)
    def centre(sel, dx=0.5, dy=0.5): return js(f"(()=>{{const e=document.querySelector({json.dumps(sel)});if(!e)return null;const r=e.getBoundingClientRect();return [r.left+r.width*{dx},r.top+r.height*{dy}]}})()")
    def key(k, code, vk, mods=0): cmd("Input.dispatchKeyEvent", type="keyDown", key=k, code=code, windowsVirtualKeyCode=vk, modifiers=mods); cmd("Input.dispatchKeyEvent", type="keyUp", key=k, code=code, windowsVirtualKeyCode=vk, modifiers=mods); time.sleep(0.4)
    def wait(expr, seconds=30):
        for _ in range(seconds * 4):
            if js(expr): return True
            time.sleep(0.25)
        return False
    def shot(name): open(f"{OUT}/{name}.png", "wb").write(base64.b64decode(cmd("Page.captureScreenshot", format="png")["data"]))
    def scene(): return [p for p in get("http://localhost:3000/api/projects") if p["id"] == PROJECT][0]["scenes"][0]
    def obj(): return scene()["editor_data"]["objects"][0]
    val = lambda f: js(f"(()=>{{const i=document.querySelector('[data-testid=native-prop-{f}]');return i?parseFloat(i.value):null}})()")
    IN = "!!document.querySelector('[data-testid=native-stage-host] [data-testid=stage]')"
    def enter():
        js("""(()=>{const e=document.querySelector('[title*="step inside it"]');const r=e.getBoundingClientRect();e.dispatchEvent(new MouseEvent('dblclick',{bubbles:true,cancelable:true,clientX:r.left+r.width/2,clientY:r.top+r.height*0.4,view:window}))})()""")
        return wait(IN, 60)
    def scene_char():
        r = js("(()=>{const e=document.querySelector('[data-editor-object-id]');const r=e.getBoundingClientRect();return [r.left,r.top,r.width,r.height]})()")
        return Image.open(io.BytesIO(base64.b64decode(cmd("Page.captureScreenshot", format="png", clip={"x": r[0], "y": r[1], "width": r[2], "height": r[3], "scale": 1})["data"]))).convert("RGB")
    def stage_px(x, y):
        return js(f"(()=>{{const c=document.querySelector('[data-testid=native-stage-host] [data-testid=stage]');const r=c.getBoundingClientRect();const d=c.getContext('2d').getImageData(Math.round(({x}-r.left)*c.width/r.width),Math.round(({y}-r.top)*c.height/r.height),1,1).data;return [d[0],d[1],d[2]]}})()")

    cmd("Runtime.enable"); cmd("Page.enable")
    src = [p for p in get("http://localhost:3000/api/projects") if p["id"] == SOURCE][0]["scenes"][0]["editor_data"]["objects"][0]
    sc = scene(); ed = sc["editor_data"]; o = json.loads(json.dumps(src))
    for k in ("symbolKeys", "symbolValues", "symbolEases", "symbolLayers", "colorReplacements", "colorOverrides", "nativePose", "nativePoseFit", "partOverrides", "partKeyframes", "partReplacements", "onlyParts", "strokeScale"): o.pop(k, None)
    ed["objects"] = [o]; ed["background"] = "#ffffff"
    urllib.request.urlopen(urllib.request.Request(f"http://localhost:3000/api/scenes/{sc['id']}", data=json.dumps({"editor_data": ed}).encode(), method="PATCH", headers={"Content-Type": "application/json"})).read()
    cmd("Page.navigate", url="http://localhost:3000/"); time.sleep(1)
    js("Object.keys(localStorage).filter(k=>k.startsWith('cb-symbol-view')).forEach(k=>localStorage.removeItem(k))")
    cmd("Page.navigate", url=f"http://localhost:3000/editor/{PROJECT}"); time.sleep(12)
    plain = scene_char()

    # ---- opens in place
    check("a double-click opens the pose in place", enter())
    check("no older pose timeline, no beta window or button", not js("!!document.querySelector('.cb-symbol-counter,[data-testid=native-dialog],[data-testid=open-native]')"))
    check("its timeline is in the timeline row", bool(js("!!document.querySelector('[data-testid=native-timeline-host] [data-testid=timeline]')")))
    crumbs = js("document.querySelector('[data-testid=native-crumbs]').textContent")
    check("the crumbs say where you are", "Scene" in crumbs and (o.get("name") or "") in crumbs, crumbs)
    shot("1-in-place")

    # ---- a part nudged: saved at once, the scene's undo
    for dy in (0.5, 0.45, 0.55, 0.4):  # well inside a part, so the same spot still hits it after it moves
        x, y = centre("[data-testid=native-stage-host] [data-testid=stage]", 0.5, dy); click_at(x, y)
        if js("!!document.querySelector('[data-testid=native-props]')"): break
    x0 = val("x")
    check("a part is picked (its Properties show)", x0 is not None, str(x0))
    js("document.activeElement && document.activeElement.blur()")
    for _ in range(5): key("ArrowRight", "ArrowRight", 39)
    check("arrows move it", abs(val("x") - (x0 + 5)) < 0.11, str(val("x")))
    saved = False
    for _ in range(40):
        if obj().get("nativePose"): saved = True; break
        time.sleep(0.5)
    check("the change is saved on the character at once (no Done)", saved)
    key("z", "KeyZ", 90, 4)
    check("⌘Z (the scene's undo) takes back one nudge", abs(val("x") - (x0 + 4)) < 0.11, str(val("x")))
    key("z", "KeyZ", 90, 4 | 8)
    check("⌘⇧Z brings it back", abs(val("x") - (x0 + 5)) < 0.11, str(val("x")))

    # ---- Light/Dark inside the pose: the native stage changes colour; ⌘Z undoes the colour only.
    # Nothing picked first (a picked part would scope the colour tools to it; inplace_scope_test.py covers that).
    click_at(*centre("[data-testid=native-stage-host] [data-testid=stage]", 0.05, 0.9))
    check("a click on empty stage drops the pick", not js("!!document.querySelector('[data-testid=native-props]')"))
    spot = js("""(()=>{const c=document.querySelector('[data-testid=native-stage-host] [data-testid=stage]');const r=c.getBoundingClientRect();const g=c.getContext('2d');
      for(let fy=0.5;fy<0.95;fy+=0.03){const d=g.getImageData(Math.round(c.width*0.5),Math.round(c.height*fy),1,1).data;if(d[3]>200&&(d[0]+d[1]+d[2])<600)return [r.left+r.width*0.5,r.top+r.height*fy]}return null})()""")
    check("found a coloured spot on the native stage", bool(spot), str(spot))
    key("l", "KeyL", 76, 4)
    check("Light/Dark opens inside the pose", bool(js("!!document.querySelector('.cb-light-dark')")))
    js("(()=>{const b=[...document.querySelectorAll('.cb-light-dark-toggle button')].find(b=>b.textContent==='Dark'); b&&b.click()})()")
    before = stage_px(*spot)
    click_at(*spot); time.sleep(0.8)
    after = stage_px(*spot)
    check("a Light/Dark click recolours the native stage", after != before, f"{before} -> {after}")
    rules = obj().get("colorReplacements") or []
    for _ in range(20):
        if rules: break
        time.sleep(0.5); rules = obj().get("colorReplacements") or []
    check("...as a colour rule on the character", bool(rules), str(rules[:1]))
    shot("2-dark")
    js("document.activeElement && document.activeElement.blur()")
    key("z", "KeyZ", 90, 4); time.sleep(0.6)
    check("⌘Z undoes the colour", stage_px(*spot) == before, f"{stage_px(*spot)} vs {before}")
    check("...and not the pose edits", val("x") is None or abs(val("x") - (x0 + 5)) < 0.11, str(val("x")))

    # ---- Esc: first puts Light/Dark away (still in the pose), then goes back to the scene, which draws the edit; in again, it is there
    key("Escape", "Escape", 27)
    check("Esc with Light/Dark open closes it and stays in the pose", js(IN) and not js("!!document.querySelector('.cb-light-dark')"))
    key("Escape", "Escape", 27)
    check("the next Esc goes back to the scene", wait(f"!({IN})", 10))
    time.sleep(3)
    nowimg = scene_char()
    diff = sum(1 for a, b in zip(plain.resize((240, 320)).getdata(), nowimg.resize((240, 320)).getdata()) if sum(abs(p - q) for p, q in zip(a, b)) > 60)
    check("the scene draws the edited pose", diff > 30, f"{diff} pixels differ from before")
    shot("3-scene")
    check("in again", enter())
    for dy in (0.5, 0.45, 0.55, 0.4):
        x, y = centre("[data-testid=native-stage-host] [data-testid=stage]", 0.5, dy); click_at(x, y)
        if js("!!document.querySelector('[data-testid=native-props]')"): break
    if val("x") is None:
        shot("4-reentered"); print("DEBUG cursor:", js("getComputedStyle(document.querySelector('[data-testid=native-stage-host] [data-testid=stage]')).cursor"), "| light/dark open:", js("!!document.querySelector('.cb-light-dark')"), "| note:", js("document.querySelector('[data-testid=note]')?.textContent"))
    check("the edit is still there", val("x") is not None and abs(val("x") - (x0 + 5)) < 0.11, str(val("x")))
    ex, ey = centre("[data-testid=native-stage-host] [data-testid=stage]", 0.05, 0.9)
    click_at(ex, ey, count=2)
    check("a double-click on empty stage steps out", wait(f"!({IN})", 10))
finally:
    chrome.terminate()
print("FAILED:" if failed else "ALL PASSED", failed)
sys.exit(1 if failed else 0)
