"""A part pasted or swapped in from another character can be stepped into, and its pieces picked and edited like a pose's own.

usage: python3 pasted_part_test.py <throwaway project id> <out dir> <source project id>
<source project id> is a project whose Sardar has Rajkumar's head pasted in the old way (a "Head" layer, a clone from another character's
library). Steps into the pose, the symbol the head sits in, and the head; clicks pieces, box-selects several, moves one and checks the edit
is saved under a key of its own (not Sardar's classes) and survives a reload. Use a throwaway project.
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

    import collections
    SOURCE = sys.argv[3]
    src = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "pasted_head_fixture.json"))) if SOURCE == "fixture" else [p for p in json.load(urllib.request.urlopen("http://localhost:3000/api/projects")) if p["id"] == SOURCE][0]["scenes"][0]["editor_data"]
    sc = scene(); ed = json.loads(json.dumps(sc["editor_data"])); ed["objects"] = [json.loads(json.dumps(src["objects"][0]))]; ed["background"] = "#ffffff"
    for k in ("nativePose", "nativePoseFit", "colorReplacements"): ed["objects"][0].pop(k, None)
    patch(sc, ed)
    def clk(x, y, n=1):
        for i in range(1, n + 1):
            for kind in ("mousePressed", "mouseReleased"): cmd("Input.dispatchMouseEvent", type=kind, x=x, y=y, button="left", clickCount=i)
        time.sleep(1.5 if n == 2 else 1.0)
    level = lambda: js("(document.body.innerText.match(/\\d+ layers · [^\\n]*/)||[])[0]") or ""
    selected = lambda: js("[...document.querySelectorAll('.cb-symbol-row.is-selected')].map(e=>(e.textContent||'').trim().slice(0,22))") or []
    def step_in():
        cmd("Page.navigate", url=f"http://localhost:3000/editor/{PROJECT}"); time.sleep(10)
        js("""(()=>{const e=document.querySelector('[title*="step inside it"]');const r=e.getBoundingClientRect();e.dispatchEvent(new MouseEvent('dblclick',{bubbles:true,cancelable:true,clientX:r.left+r.width/2,clientY:r.top+r.height*0.2,view:window}))})()"""); time.sleep(3)
        clk(840, 235, 2); clk(840, 235, 2)
    CLONE = """(()=>{const w=document.querySelector('iframe.cb-character-source-frame').contentWindow, root=w.exportRoot, seen=new Set(); let c=null;
      (function walk(n){ if(!n||seen.has(n)||typeof n!=='object'||c) return; seen.add(n); if(n.cbnew1){c=n.cbnew1;return} Object.keys(n).forEach(k=>{ if(k!=='parent'&&n[k]&&typeof n[k]==='object'&&n[k].timeline) walk(n[k])})})(root);
      if(!c) return null; const o={}; Object.keys(c).forEach(k=>{const v=c[k]; if(v&&typeof v==='object'&&v.timeline&&v.gotoAndStop) o[k]=[Math.round(v.x*100)/100,Math.round(v.y*100)/100]}); return o})()"""
    cmd("Page.navigate", url=f"http://localhost:3000/editor/{PROJECT}"); time.sleep(12)
    canvas_hash = lambda: js("(()=>{const c=document.querySelector('iframe.cb-character-source-frame').contentDocument.querySelector('canvas'); const u=c.toDataURL(); let h=0; for(let i=0;i<u.length;i+=7) h=(h*31+u.charCodeAt(i))|0; return h})()")
    h_before = canvas_hash()
    step_in()
    check("double-clicking the pasted head steps into it", "Head copy" in level(), level())
    shot("1-in-head")
    seen = collections.defaultdict(list)
    for y in range(190, 290, 11):
        for x in range(800, 880, 11):
            clk(x, y); got = tuple(selected())
            if got: seen[got].append((x, y))
            clk(620, 250)
    pieces = {k[0] for k in seen if len(k) == 1}
    check("clicking picks different pieces (hair, face, nose, ear…)", len(pieces) >= 4, str(sorted(pieces)))
    # a box over the head picks several pieces at once
    for kind, x, y in (("mousePressed", 780, 175), ("mouseMoved", 840, 230), ("mouseMoved", 900, 300), ("mouseReleased", 900, 300)):
        cmd("Input.dispatchMouseEvent", type=kind, x=x, y=y, button="left" if kind != "mouseMoved" else "none", buttons=1 if kind != "mouseReleased" else 0, clickCount=1); time.sleep(0.3)
    time.sleep(1.2); many = selected(); shot("2-box")
    check("a box over the head selects several pieces", len(many) >= 3, str(many))
    clk(620, 250); time.sleep(1.5)
    # move one piece: pick the nose, drag it
    # move the hair: a big, clearly visible piece with room to press away from its pivot handle (a press on the handle moves the pivot, not the piece)
    target = next((pt for want in ("Layer_10", "Left_ear", "face_shape") for k, pts in seen.items() if k == (want,) for pt in pts[:1]), None) or next(iter(seen.values()))[0]
    clk(*target)
    name = selected()
    before = scene()["editor_data"]["objects"][0].get("symbolValues") or {}
    pos0 = js(CLONE)
    canvas_hash = lambda: js("(()=>{const c=document.querySelector('iframe.cb-character-source-frame').contentDocument.querySelector('canvas'); const u=c.toDataURL(); let h=0; for(let i=0;i<u.length;i+=7) h=(h*31+u.charCodeAt(i))|0; return h})()")
    h0 = canvas_hash()
    def save_canvas(tag):
        import base64 as b64
        u = js("document.querySelector('iframe.cb-character-source-frame').contentDocument.querySelector('canvas').toDataURL('image/png')"); open(f"{OUT}/canvas-{tag}.png", "wb").write(b64.b64decode(u.split(",")[1]))
    save_canvas("before-drag")
    px, py = target
    for kind, x, y in (("mousePressed", px, py), ("mouseMoved", px + 8, py + 3), ("mouseMoved", px + 18, py + 8), ("mouseReleased", px + 18, py + 8)):
        cmd("Input.dispatchMouseEvent", type=kind, x=x, y=y, button="left" if kind != "mouseMoved" else "none", buttons=1 if kind != "mouseReleased" else 0, clickCount=1); time.sleep(0.3)
    time.sleep(3)
    pos1 = js(CLONE)
    moved = {k: (pos0[k], pos1[k]) for k in (pos0 or {}) if pos1 and pos0[k] != pos1.get(k)}
    h1 = canvas_hash(); save_canvas("after-drag")
    check("the piece moved in the player", len(moved) == 1 and name and True, f"{moved}")
    after = scene()["editor_data"]["objects"][0].get("symbolValues") or {}
    newkeys = [k for k in after if k not in before or after[k] != before.get(k)]
    print("selected:", name, "changed symbolValues keys:", newkeys)
    check("moving a piece is saved under the pasted character's own key", any("~" in k for k in newkeys), str(newkeys))
    check("it does not touch Sardar's own classes", not any("~" not in k for k in newkeys), str(newkeys))
    shot("3-moved")
    step_in(); check("after a reload the head can be stepped into again", "Head copy" in level(), level()); shot("4-reloaded")
    time.sleep(2); h2 = canvas_hash(); pos2 = js(CLONE)
    check("after a reload the piece is where it was left", bool(pos2) and any(abs(v[0] - w[1][0]) < 0.05 for v in [pos2[k] for k in moved] for w in [next(iter(moved.values()))]), f"{pos2 and {k: pos2[k] for k in moved}}")
    plain_view = lambda: (cmd("Page.navigate", url=f"http://localhost:3000/editor/{PROJECT}"), time.sleep(12), canvas_hash())[-1]
    h_after = plain_view()
    check("and the character is drawn with the piece moved (normal view, against the view before any edit)", h_after != h_before, f"{h_before} -> {h_after}")
finally:
    chrome.terminate()
print("FAILED:" if failed else "ALL PASSED", failed)
sys.exit(1 if failed else 0)
