"""The Colour Dropper (I) inside a pose: it reads the colour under the pointer in the pose, in the head symbol and with a piece picked, and does not pick or move parts.

usage: python3 dropper_pose_test.py <throwaway project id> <out dir> <source project id>
Seeds Sardar with Rajkumar's head pasted in, selects the character, steps into its pose and into the head, and with the dropper clicks the jacket, the face and
the hair. The Fill box colour it reports must be the colour drawn there (checked against the pixel), and nothing must be picked or stepped into by those clicks.
"""
import base64, json, os, subprocess, sys, time, urllib.request, websocket

PROJECT, OUT = sys.argv[1], sys.argv[2]
os.makedirs(OUT, exist_ok=True)
chrome = subprocess.Popen(["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "--headless=new", "--remote-debugging-port=9668",
                           f"--user-data-dir={OUT}/profile-{os.getpid()}", "--window-size=1600,1000", "about:blank"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
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
    # These checks are about the older pose timeline (kept for characters without a .fla): Sardar is opened in it, not in the native editor.
    cmd("Page.addScriptToEvaluateOnNewDocument", source="window.__CBS_OLD_POSE_TIMELINE__=true")

    SOURCE = sys.argv[3]
    import io, base64 as b64
    from PIL import Image, ImageChops
    src = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "pasted_head_fixture.json"))) if SOURCE == "fixture" else [p for p in json.load(urllib.request.urlopen("http://localhost:3000/api/projects")) if p["id"] == SOURCE][0]["scenes"][0]["editor_data"]
    sc = scene(); ed = json.loads(json.dumps(sc["editor_data"])); ed["objects"] = [json.loads(json.dumps(src["objects"][0]))]; ed["background"] = "#ffffff"
    for k in ("nativePose", "nativePoseFit", "colorReplacements"): ed["objects"][0].pop(k, None)
    for edit in (ed["objects"][0].get("symbolLayers") or {}).values(): edit.pop("deletedProps", None); [edit["spec"]["hidden"].remove(h) for h in list(edit.get("spec", {}).get("hidden", [])) if h in ("shape",)]
    patch(sc, ed)
    def clk(x, y, n=1):
        for i in range(1, n + 1):
            for kind in ("mousePressed", "mouseReleased"): cmd("Input.dispatchMouseEvent", type=kind, x=x, y=y, button="left", clickCount=i)
        time.sleep(1.5 if n == 2 else 1.0)
    def key(k, code, vk):
        for kind in ("rawKeyDown", "keyUp"): cmd("Input.dispatchKeyEvent", type=kind, key=k, code=code, windowsVirtualKeyCode=vk)
        time.sleep(1.5)
    level = lambda: js("(document.body.innerText.match(/\\d+ layers · [^\\n]*/)||[])[0]") or ""
    rows = lambda: js("[...document.querySelectorAll('.cb-symbol-row')].map(e=>(e.textContent||'').trim().slice(0,18))") or []
    selected = lambda: js("[...document.querySelectorAll('.cb-symbol-row.is-selected')].map(e=>(e.textContent||'').trim().slice(0,18))") or []
    def canvas():
        u = js("document.querySelector('iframe.cb-character-source-frame').contentDocument.querySelector('canvas').toDataURL('image/png')")
        return Image.open(io.BytesIO(b64.b64decode(u.split(",")[1]))).convert("RGB")
    def edit_now():
        return (scene()["editor_data"]["objects"][0].get("symbolLayers") or {})
    notice = lambda: js("(document.body.innerText.match(/(Fill|Stroke) box: #[0-9a-fA-F]{6}/)||[''])[0]")
    key_v = lambda: [cmd("Input.dispatchKeyEvent", type=k, key="v", code="KeyV", windowsVirtualKeyCode=86) for k in ("rawKeyDown", "keyUp")]
    key_i = lambda: [cmd("Input.dispatchKeyEvent", type=k, key="i", code="KeyI", windowsVirtualKeyCode=73) for k in ("rawKeyDown", "keyUp")]
    def pixel(x, y):
        v = js("""(()=>{const f=document.querySelector('iframe.cb-character-source-frame'), r=f.getBoundingClientRect(), c=f.contentDocument.querySelector('canvas');
          const d=c.getContext('2d').getImageData(Math.floor((%f-r.left)/r.width*c.width),Math.floor((%f-r.top)/r.height*c.height),1,1).data; return [d[0],d[1],d[2],d[3]]})()""" % (x, y))
        return v
    lum = lambda rgb: 0.3 * rgb[0] + 0.59 * rgb[1] + 0.11 * rgb[2]
    def drop(x, y):
        key_i(); time.sleep(0.3); js("document.querySelector('.cb-symbol-overlay') && 0")
        clk(x, y); time.sleep(0.7); got = notice(); key_v(); time.sleep(0.3)
        return got.split("#")[-1] if got else ""
    hexrgb = lambda h: [int(h[i:i + 2], 16) for i in (0, 2, 4)] if h else None
    cmd("Page.navigate", url=f"http://localhost:3000/editor/{PROJECT}"); time.sleep(10)
    r0 = rect("[data-editor-object-id]"); clk(r0[0] + r0[2] * 0.5, r0[1] + r0[3] * 0.6); time.sleep(1)
    got = drop(r0[0] + r0[2] * 0.5, r0[1] + r0[3] * 0.45)
    check("scene view: the dropper reads the jacket", got.lower() == "65755c", got)
    js("""(()=>{const e=document.querySelector('[title*="step inside it"]');const r=e.getBoundingClientRect();e.dispatchEvent(new MouseEvent('dblclick',{bubbles:true,cancelable:true,clientX:r.left+r.width/2,clientY:r.top+r.height*0.2,view:window}))})()"""); time.sleep(3)
    check("stepped into the pose", "layers" in level(), level())
    got = drop(850, 420); check("pose: the dropper reads the jacket", got.lower() == "65755c", got)
    got = drop(840, 235); check("pose: the dropper reads the face", got.lower() == "fbb057", got)
    check("the dropper clicks picked nothing", not selected(), str(selected()))
    # step into the head (double-click with the dropper off), then read from the face and the hair
    clk(840, 235, 2); clk(840, 235, 2)
    check("stepped into the pasted head", "Head copy" in level(), level())
    got = drop(840, 250); check("head: the dropper reads the face", got.lower() == "fbb057", got)
    check("a dropper click does not step into a symbol", "Head copy" in level(), level())
    # a dark spot of the hair, found in the drawing itself
    # (read from a screenshot: inside a pose the drawing may be the native one, not the player's canvas)
    screen = Image.open(io.BytesIO(b64.b64decode(cmd("Page.captureScreenshot", format="png")["data"]))).convert("RGB")
    dark = next(((x, y) for y in range(188, 215, 3) for x in range(822, 870, 3) if lum(screen.getpixel((x, y))) < 50), None)
    check("a hair pixel was found", bool(dark), str(dark))
    clk(826, 250); picked = selected()
    check("a piece is picked in the head", len(picked) == 1, str(picked))
    got = drop(*dark); rgb = hexrgb(got)
    check("with a piece picked, the dropper still reads what is under the pointer (the hair, not the picked piece)", bool(rgb) and lum(rgb) < 90 and got.lower() != "fbb057", got)
    check("and the picked piece is still the one picked", selected() == picked, str(selected()))
finally:
    chrome.terminate()
print("FAILED:" if failed else "ALL PASSED", failed)
sys.exit(1 if failed else 0)
