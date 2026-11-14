"""The colour picker and masks: a shape hidden by a mask is not what is picked there.

usage: python3 mask_pick_test.py <throwaway project id> <out dir>
The first character needs native edits (run swap_part_test.py). The test replaces its pose with a huge red shape under a mask
that covers only the left of it, found by trying boundaries until the canvas is part red; then checks the picker reports red where the
mask lets it show and nothing where the mask hides it. Use a throwaway project.
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

    sc = scene(); base = json.loads(json.dumps(sc["editor_data"])); o = base["objects"][0]
    check("the character has native pose edits", bool(o.get("nativePose")))
    cls, edit = next(iter(o["nativePose"].items())); item = next(iter(edit["symbols"]))
    length = max(1, edit["symbols"][item]["length"])
    box = lambda x0, x1: [["M", x0, -6000], ["L", x1, -6000], ["L", x1, 6000], ["L", x0, 6000], ["L", x0, -6000]]
    shape = lambda color, x0, x1: {"k": "shape", "m": [1, 0, 0, 1, 0, 0], "fills": [{"style": {"t": "solid", "color": color, "alpha": 1}, "paths": [box(x0, x1)]}], "strokes": [], "fillStyles": {}, "strokeStyles": {}}
    layer = lambda name, typ, parent, el: {"name": name, "type": typ, "parent": parent, "hidden": False, "frames": [{"i": 0, "d": length, "elements": [el]}]}
    def make(boundary, masked=True):
        layers = [layer("red", "normal", 1 if masked else None, shape("#ff0000", -6000, 6000))] + ([layer("mask", "mask", None, shape("#000000", -6000, boundary))] if masked else [])
        ed = json.loads(json.dumps(base)); ed["objects"][0]["nativePose"][cls]["symbols"][item] = {"name": item, "length": length, "layers": layers}
        for k in ("nativePoseFit",): ed["objects"][0].pop(k, None)
        return ed
    CANVAS = f"document.querySelector('[data-native-character=\"{o['id']}\"]')"
    FRAME = f"window.__CBS_COLOUR_FRAME__('{o['id']}')"
    def load():
        cmd("Page.navigate", url=f"http://localhost:3000/editor/{PROJECT}"); time.sleep(9)
        for _ in range(60):
            if js(f"!!{CANVAS} && {CANVAS}.style.visibility!=='hidden'"): break
            time.sleep(0.5)
        time.sleep(1.5)
    red_cols = lambda: js("""(()=>{const c=%s,x=c.getContext('2d');const d=x.getImageData(0,Math.floor(c.height/2),c.width,1).data;const cols=[];for(let i=0;i<c.width;i++)if(d[i*4+3]>250&&d[i*4]>240&&d[i*4+1]<20)cols.push(i);return [cols.length?cols[0]:-1,cols.length?cols[cols.length-1]:-1,c.width,c.height]})()""" % CANVAS)
    patch(sc, make(0, masked=False)); load()
    full = red_cols()
    check("with no mask the red shape covers the canvas", full[0] == 0 and full[1] == full[2] - 1, str(full))
    edge = None
    for boundary in (-200, 0, 200, 400, 600, 800, 1000, 1400, 1800):
        patch(scene(), make(boundary)); load(); r = red_cols()
        if r[0] >= 0 and r[1] < r[2] - 20: edge = (boundary, r); break
    check("a mask boundary falls inside the canvas", edge is not None, str(edge))
    if edge:
        _, (x0, x1, W, H) = edge
        pick = lambda px: js(f"{FRAME}.contentWindow.cbColorAt({px / W},0.5,'')")
        inside = pick(max(0, x1 - 6)); outside = pick(min(W - 1, x1 + 12))
        check("where the mask lets the shape show, the picker reports it", bool(inside) and inside["original"] == "#ff0000", str(inside))
        check("where the mask hides it, the picker does not report it", not outside or outside["original"] != "#ff0000", str(outside))
        shot("1-masked")
    patch(scene(), base)
finally:
    chrome.terminate()
print("FAILED:" if failed else "ALL PASSED", failed)
sys.exit(1 if failed else 0)
