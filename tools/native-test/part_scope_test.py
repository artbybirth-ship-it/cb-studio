"""Plain part-name colour rules ("head", "symbol3"): the native drawing recolours the same pixels as the Animate player.

usage: python3 part_scope_test.py <throwaway project id> <out dir>
The first character needs native edits (run swap_part_test.py). For several of the player's own part keys, a rule turning every colour of the character
green is scoped to that part and drawn twice on the render page: by the player (no native edits) and natively (native edits with no changes).
The two green areas must cover the same pixels (and some part must not be the whole figure). Use a throwaway project.
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
    # These checks are about the older pose timeline (kept for characters without a .fla): Sardar is opened in it, not in the native editor.
    cmd("Page.addScriptToEvaluateOnNewDocument", source="window.__CBS_OLD_POSE_TIMELINE__=true")

    from PIL import Image
    import io
    sc = scene(); base = json.loads(json.dumps(sc["editor_data"])); o = base["objects"][0]
    native = json.loads(json.dumps(o["nativePose"])); check("the character has native pose edits", bool(native))
    o.pop("nativePoseFit", None); o.pop("colorReplacements", None)
    plain = json.loads(json.dumps(base)); plain["objects"][0].pop("nativePose", None); patch(sc, plain)
    cmd("Page.navigate", url=f"http://localhost:3000/editor/{PROJECT}"); time.sleep(10)
    FR = "document.querySelector('iframe.cb-character-source-frame').contentWindow"
    for _ in range(40):
        if js(f"!!document.querySelector('iframe.cb-character-source-frame') && typeof {FR}.cbPartsByStack==='function'"): break
        time.sleep(0.5)
    time.sleep(3)
    parts = [p["key"] for p in json.loads(js(f"JSON.stringify({FR}.cbPartsByStack())"))]
    colours = [e["color"] for e in json.loads(js(f"JSON.stringify({FR}.cbColorPalette(''))"))]
    print("parts:", parts)
    check("the player lists rig parts and colours", len(parts) > 5 and len(colours) > 5, f"{len(parts)} parts, {len(colours)} colours")
    empty = {k: {**v, "symbols": {}} for k, v in native.items()}
    def rules(scope): return [{"id": f"r{i}", "from": c, "to": "#00ff00", "target": "both", "scope": scope, "match": "exact"} for i, c in enumerate(colours)]
    def frame(ed, scope):
        ed = json.loads(json.dumps(ed)); ed["objects"][0]["colorReplacements"] = rules(scope); patch(scene(), ed)
        cmd("Page.navigate", url=f"http://localhost:3000/render/scene/{sc['id']}"); time.sleep(3)
        for _ in range(120):
            if js("window.__CBS_RENDER_READY__ === true"): break
            time.sleep(0.5)
        js("window.__CBS_SET_TIME__(0.3)"); time.sleep(0.8)
        im = Image.open(io.BytesIO(base64.b64decode(cmd("Page.captureScreenshot", format="png")["data"]))).convert("RGB")
        return {(x, y) for x in range(0, im.width, 2) for y in range(0, im.height, 2) if (lambda p: p[1] > 200 and p[0] < 70 and p[2] < 70)(im.getpixel((x, y)))}
    nat = json.loads(json.dumps(plain)); nat["objects"][0]["nativePose"] = empty
    whole_p = frame(plain, "*"); whole_n = frame(nat, "*")
    check("a whole-character rule gives the same area in both", len(whole_p) > 500 and abs(len(whole_p) - len(whole_n)) < 0.1 * len(whole_p), f"player {len(whole_p)} native {len(whole_n)}")
    tested = 0
    for key in [k for k in parts if k in ("head", "torso", "symbol3", "leftarm", "rightarm", "chest", "neck", "belt")][:5] or parts[:4]:
        a = frame(plain, key); b = frame(nat, key)
        iou = len(a & b) / max(1, len(a | b)); tested += 1
        check(f"part {key!r}: the same pixels in both ({len(a)} player, {len(b)} native)", len(a) > 20 and iou > 0.9, f"overlap {iou:.2f}")
        check(f"part {key!r}: it is only that part, not the whole figure", len(b) < 0.8 * len(whole_n), f"{len(b)} of {len(whole_n)}")
    patch(scene(), base)
finally:
    chrome.terminate()
print("FAILED:" if failed else "ALL PASSED", failed)
sys.exit(1 if failed else 0)
