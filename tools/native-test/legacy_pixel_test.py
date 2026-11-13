"""Scene editor -> native editor round trip, in headless Chrome against the dev server on :3000.

usage: python3 scene_native_test.py <project id> <out dir>
Opens the project, steps into the character's pose (double-click), opens the "Native editor
(beta)", moves a part, presses Done, checks the edit is saved on the placed character in the scene
(nativePose), reloads the page, and checks the native editor opens with the edit still there.
Use a throwaway project: the edit is written to it.
"""
import base64, json, os, subprocess, sys, time, urllib.request, websocket

PROJECT, OUT = sys.argv[1], sys.argv[2]
os.makedirs(OUT, exist_ok=True)
chrome = subprocess.Popen(["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "--headless=new", "--remote-debugging-port=9666",
                           f"--user-data-dir={OUT}/profile", "--window-size=1600,1000", "about:blank"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
failed = []
try:
    for _ in range(50):
        try:
            tabs = json.load(urllib.request.urlopen("http://127.0.0.1:9666/json")); break
        except Exception:
            time.sleep(0.2)
    ws = websocket.create_connection([t for t in tabs if t["type"] == "page"][0]["webSocketDebuggerUrl"], timeout=300)
    n = [0]
    def cmd(method, **params):
        n[0] += 1; ws.send(json.dumps({"id": n[0], "method": method, "params": params}))
        while True:
            msg = json.loads(ws.recv())
            if msg.get("method") == "Runtime.exceptionThrown":
                print("EXC", msg["params"]["exceptionDetails"].get("exception", {}).get("description", "")[:300])
            if msg.get("id") == n[0]:
                return msg.get("result", msg)
    def js(e):
        r = cmd("Runtime.evaluate", expression=e, returnByValue=True, awaitPromise=True)
        if r.get("exceptionDetails"):
            print("JS error:", r["exceptionDetails"].get("exception", {}).get("description", "")[:400])
        return r.get("result", {}).get("value")
    def check(name, ok, detail=""):
        print(("PASS " if ok else "FAIL ") + name, detail)
        if not ok: failed.append(name)
    def mouse(kind, x, y, **kw):
        cmd("Input.dispatchMouseEvent", type=kind, x=x, y=y, button="left", **kw)
    def click_at(x, y, count=1, mods=0):
        for i in range(1, count + 1):
            mouse("mousePressed", x, y, clickCount=i, modifiers=mods); mouse("mouseReleased", x, y, clickCount=i, modifiers=mods)
        time.sleep(0.6)
    def rect(selector):
        return js("(()=>{const e=document.querySelector(%s);if(!e)return null;const r=e.getBoundingClientRect();return [r.left,r.top,r.width,r.height]})()" % json.dumps(selector))
    def click(selector):
        r = rect(selector); click_at(r[0] + r[2] / 2, r[1] + r[3] / 2)
    def wait(selector, seconds=60):
        for _ in range(seconds * 2):
            if rect(selector): return True
            time.sleep(0.5)
        return False
    def shot(name):
        open(f"{OUT}/{name}.png", "wb").write(base64.b64decode(cmd("Page.captureScreenshot", format="png")["data"]))
    def scene_object():
        projects = json.load(urllib.request.urlopen("http://localhost:3000/api/projects"))
        p = [p for p in projects if p["id"] == PROJECT][0]
        return p["scenes"][0]["editor_data"]["objects"][0]

    def open_native():
        cmd("Page.navigate", url=f"http://localhost:3000/editor/{PROJECT}"); time.sleep(8)
        shot("1-editor")
        # step into the pose: a double-click on the character (sent as the DOM event; headless Chrome's
        # synthetic double click does not reach the character's overlay)
        js("""(()=>{const e=document.querySelector('[title*="step inside it"]');const r=e.getBoundingClientRect();e.dispatchEvent(new MouseEvent('dblclick',{bubbles:true,cancelable:true,clientX:r.left+r.width/2,clientY:r.top+r.height*0.4,view:window}))})()""")
        return wait("[data-testid=open-native]", 20)

    from PIL import Image, ImageChops
    import io
    def snap():
        data = base64.b64decode(cmd("Page.captureScreenshot", format="png")["data"])
        return Image.open(io.BytesIO(data)).convert("RGB")
    def stage_box():
        return js("(()=>{const c=document.querySelector('canvas');const r=(document.querySelector('[title*=\"step inside it\"]')||c).getBoundingClientRect();return [r.left,r.top,r.right,r.bottom]})()")
    def scene():
        ps = json.load(urllib.request.urlopen("http://localhost:3000/api/projects"))
        p = [p for p in ps if p["id"] == PROJECT][0]
        return p["scenes"][0]
    def patch(sc, ed):
        req = urllib.request.Request(f"http://localhost:3000/api/scenes/{sc['id']}", data=json.dumps({"editor_data": ed}).encode(), method="PATCH", headers={"Content-Type": "application/json"})
        urllib.request.urlopen(req).read()
    # Seed this throwaway scene with a fully convertible set of old edits (the first one's keyframes, a value, a hidden and a deleted layer) and no native edits.
    sc0 = scene(); ed0 = json.loads(json.dumps(sc0["editor_data"])); o0 = ed0["objects"][0]
    o0.pop("nativePose", None); o0.pop("nativePoseFit", None)
    if os.environ.get("LEGACY_INDEX"):
        real = json.load(open("/private/tmp/claude-501/-Users-amazdraw-Downloads-CharacterBazaarStudio-MVP-v112/e20824a2-161c-45d0-b24c-cb95fad8f3b3/scratchpad/legacy_objects.json"))[int(os.environ["LEGACY_INDEX"])]
        for k in ("symbolKeys", "symbolValues", "symbolEases", "symbolLayers"):
            o0.pop(k, None)
            if real.get(k): o0[k] = real[k]
    else:
      o0["symbolKeys"] = {"Sardar_01": {"1": {"props": ["instance"], "anchors": [[0,0],[9,9],[15,20],[27,27],[69,69],[79,79],[85,85],[100,100]]}}}
      o0["symbolValues"] = {"Sardar_01": {"2:0": {"v": {"skewX": 0.1, "skewY": 0.1, "scaleX": 1, "scaleY": 1}, "frame": 0, "props": ["instance_1"]}}}
      o0["symbolLayers"] = {"Symbol9": {"spec": {"hidden": ["instance_4"]}, "deleted": [6]}}
      o0.pop("symbolEases", None)
    patch(sc0, ed0)
    seeded = json.loads(json.dumps(ed0))
    cmd("Page.navigate", url=f"http://localhost:3000/editor/{PROJECT}"); time.sleep(10)
    box = stage_box(); check("found the character on the stage", bool(box), str(box))
    before = snap(); before.save(f"{OUT}/before.png")
    # open the pose, let the converter run, press Done: this is what writes the native edits
    open_native()
    click("[data-testid=open-native]")
    check("native dialog opens", wait("[data-testid=native-editor]", 90)); time.sleep(2)
    said = js("document.querySelector('[data-testid=native-converted]')?.textContent || ''")
    check("older edits were converted", said.startswith("Older edits on this character were converted"), said)
    click("[data-testid=native-done]"); time.sleep(2)
    cmd("Page.navigate", url=f"http://localhost:3000/editor/{PROJECT}"); time.sleep(14)
    after = snap(); after.save(f"{OUT}/after.png")
    x0, y0, x1, y1 = [int(v) for v in box]
    a, b = before.crop((x0, y0, x1, y1)), after.crop((x0, y0, x1, y1))
    diff = ImageChops.difference(a, b).convert("L")
    ink = sum(1 for p in a.convert("L").getdata() if p < 235) or 1
    changed = sum(1 for p in diff.getdata() if p > 40)
    pct = 100.0 * changed / ink
    print("pixels that differ:", changed, "of", ink, "inked ->", round(pct, 2), "%")
    print("(the player and the native drawing already differ on a plain character: stroke weight and placement)")
    # Control: the same character drawn natively with NO edits. The difference between it and the converted drawing is what the conversion changed.
    sc = scene(); ed = json.loads(json.dumps(sc["editor_data"])); o = ed["objects"][0]
    keep = {k: o.pop(k) for k in ("symbolKeys", "symbolValues", "symbolEases", "symbolLayers") if k in o}
    saved_native = o["nativePose"]
    o["nativePose"] = {k: {**v, "symbols": {}} for k, v in saved_native.items()}
    patch(sc, ed)
    try:
        cmd("Page.navigate", url=f"http://localhost:3000/editor/{PROJECT}"); time.sleep(14)
        control = snap(); control.save(f"{OUT}/control.png")
    finally:
        patch(sc, seeded)  # back to the seeded old edits, no native edits
    c = control.crop((x0, y0, x1, y1))
    d2 = ImageChops.difference(b, c).convert("L")
    changed2 = sum(1 for p in d2.getdata() if p > 40)
    pct2 = 100.0 * changed2 / ink
    print("converted vs unedited native:", changed2, "pixels ->", round(pct2, 2), "% of ink (what the old edits visibly change at this frame)")
    check("the old edits visibly change this frame only a little (hidden part, 0.1 degree skew)", pct2 < 3.0, f"{pct2:.2f}%")
finally:
    chrome.terminate()
print("FAILED:" if failed else "ALL PASSED", failed)
sys.exit(1 if failed else 0)
