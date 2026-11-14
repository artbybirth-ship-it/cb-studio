"""Phase 4c: native colour (the character's Recolour rules drawn by the native drawing, in the scene and in the pose editor), in headless Chrome against :3000.

usage: python3 colour_test.py <throwaway project id> <out dir>
The project's first character must already have native pose edits (run swap_part_test.py on it first). Reads the colour
most used by the native drawing, adds a Recolour rule turning it green, and checks the scene's native canvas and the
pose editor's stage both show it, that removing the rule brings the original back, and that a rule limited to a part
that is not there changes nothing. Use a throwaway project.
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

    sc = scene(); ed = json.loads(json.dumps(sc["editor_data"])); o = ed["objects"][0]
    check("the character has native pose edits", bool(o.get("nativePose")))
    o.pop("colorReplacements", None); patch(sc, ed)
    CANVAS = "document.querySelector('[data-native-character]')"
    def load_scene():
        cmd("Page.navigate", url=f"http://localhost:3000/editor/{PROJECT}"); time.sleep(9)
        for _ in range(60):
            if js(f"!!{CANVAS} && {CANVAS}.style.visibility!=='hidden'"): break
            time.sleep(0.5)
        time.sleep(1.5)
    HIST = """(sel)=>{const c=document.querySelector(sel);const x=c.getContext('2d');const d=x.getImageData(0,0,c.width,c.height).data;const h={};for(let i=0;i<d.length;i+=4){if(d[i+3]<250)continue;const k=((d[i]>>3)<<10)|((d[i+1]>>3)<<5)|(d[i+2]>>3);h[k]=(h[k]||0)+1}return h}"""
    def hist(sel): return js(f"({HIST})({json.dumps(sel)})") or {}
    def dominant(h):
        k = max(h, key=lambda z: h[z]); k = int(k)
        return "#%02x%02x%02x" % (((k >> 10) & 31) << 3, ((k >> 5) & 31) << 3, (k & 31) << 3)
    def green(h): return sum(v for k, v in h.items() if (int(k) >> 5) & 31 > 24 and (int(k) >> 10) & 31 < 6 and int(k) & 31 < 6)

    load_scene(); shot("1-scene")
    h0 = hist("[data-native-character]")
    check("the scene shows the native drawing", sum(h0.values()) > 1000, f"{sum(h0.values())} px")
    # an exact rule needs the exact colour: read it back from the file's own colours through the editor's stage hist is bucketed,
    # so use a shades rule from the dominant bucket instead (the family moves with it)
    d = dominant(h0)
    rule = {"id": "t1", "from": d, "to": "#00ff00", "target": "both", "scope": "*", "match": "shades"}
    ed2 = json.loads(json.dumps(ed)); ed2["objects"][0]["colorReplacements"] = [rule]; patch(scene(), ed2)
    load_scene(); shot("2-scene-recoloured")
    h1 = hist("[data-native-character]")
    check("a Recolour rule changes the scene's native drawing", green(h1) > green(h0) + 200, f"green px {green(h0)} -> {green(h1)} (rule from {d})")
    check("the picture is otherwise still there", sum(h1.values()) > 0.9 * sum(h0.values()), f"{sum(h0.values())} vs {sum(h1.values())}")

    # a rule for a part that does not exist changes nothing
    ed3 = json.loads(json.dumps(ed)); ed3["objects"][0]["colorReplacements"] = [dict(rule, scope="no-such-part")]; patch(scene(), ed3)
    load_scene()
    h3 = hist("[data-native-character]")
    check("a rule for a part that is not there changes nothing", green(h3) == green(h0), f"green px {green(h3)}")

    # a part made in the pose view is scoped "@<pose class>/<instance name>": the player's names for the file's unnamed instances
    whole = green(h1); found = None
    for nm in ["instance"] + [f"instance_{i}" for i in range(1, 19)]:
        e4 = json.loads(json.dumps(ed)); e4["objects"][0]["colorReplacements"] = [dict(rule, scope=f"@Sardar_01/{nm}")]; patch(scene(), e4)
        load_scene(); g = green(hist("[data-native-character]"))
        if g > 50: found = (nm, g); break
    check("a rule for one part of the pose recolours only that part", bool(found) and found[1] < whole, f"{found} of {whole} whole-character")
    e5 = json.loads(json.dumps(ed)); e5["objects"][0]["colorReplacements"] = [dict(rule, scope="@Sardar_01/instance_99")]; patch(scene(), e5)
    load_scene()
    check("a pose-part rule for an instance that is not there changes nothing", green(hist("[data-native-character]")) == green(h0))
    e6 = json.loads(json.dumps(ed)); e6["objects"][0]["colorReplacements"] = [dict(rule, scope=f"@Other_Class/{found[0] if found else 'instance'}")]; patch(scene(), e6)
    load_scene()
    check("the same name under another pose class changes nothing", green(hist("[data-native-character]")) == green(h0))

    # the pose editor draws in the character's colours too
    patch(scene(), ed2)
    check("the pose opens in the native editor", open_pose())
    time.sleep(1)
    hp = hist("[data-testid=stage]")
    check("the pose editor shows the colour rule", green(hp) > 200, f"green px {green(hp)}")
    shot("3-editor")
    click("[data-testid=native-cancel]"); time.sleep(1)
    # and without the rule the editor is back to the file's colours
    patch(scene(), ed)
    check("without the rule the pose editor has the file's colours", open_pose() and green(hist("[data-testid=stage]")) < 50)
    click("[data-testid=native-cancel]")
finally:
    chrome.terminate()
print("FAILED:" if failed else "ALL PASSED", failed)
sys.exit(1 if failed else 0)
