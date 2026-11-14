"""Phase 4d: the colour tools (eyedropper, Find & Replace, Light/Dark, Adjust) on a character drawn natively, in headless Chrome against :3000.

usage: python3 colour_finder_test.py <throwaway project id> <out dir>
Run paste_native_test.py on the project first: its Sardar then has Rajkumar's head pasted under the pose. Calls the colour
tools' view of the character (window.__CBS_COLOUR_FRAME__, what EditorShell reads colours through) the way the tools do:
the palette, the colour under many points (checked against the pixel the canvas really shows), the colours that go with
one (outlines, shades), a rule applied through it, and the pasted head's own colours. Use a throwaway project.
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

    sc = scene(); ed = json.loads(json.dumps(sc["editor_data"]))
    sar = [o for o in ed["objects"] if o.get("name") == "Sardar"][0]
    check("Sardar has native edits with a pasted part", bool(sar.get("nativePose")) and "Pasted from" in json.dumps(sar["nativePose"])[:2000000])
    sar.pop("colorReplacements", None); patch(sc, ed)
    cmd("Page.navigate", url=f"http://localhost:3000/editor/{PROJECT}"); time.sleep(9)
    CANVAS = f"document.querySelector('[data-native-character=\"{sar['id']}\"]')"
    for _ in range(60):
        if js(f"!!{CANVAS} && {CANVAS}.style.visibility!=='hidden'"): break
        time.sleep(0.5)
    time.sleep(2)
    FRAME = f"window.__CBS_COLOUR_FRAME__('{sar['id']}')"
    check("the colour tools get a stand-in for the native drawing", js(f"!!{FRAME} && typeof {FRAME}.contentWindow.cbColorAt==='function'"))
    pal = js(f"{FRAME}.contentWindow.cbColorPalette('')") or []
    check("the palette lists the character's colours with counts", len(pal) >= 5 and all(e["fills"] + e["strokes"] > 0 and e["color"].startswith("#") for e in pal), f"{len(pal)} colours, first {pal[0] if pal else None}")
    check("with no rules each shows its own colour", all(e["current"] == e["color"] for e in pal))

    # the colour under points over the character, against the pixel the canvas really shows
    probe = js("""(()=>{const f=%s, c=%s, r=f.getBoundingClientRect(), x=c.getContext('2d'); const out=[];
      for(let gy=0.04;gy<0.98;gy+=0.04)for(let gx=0.1;gx<0.95;gx+=0.04){const a=f.contentWindow.cbColorAt(gx,gy,''); const d=x.getImageData(Math.floor(gx*c.width),Math.floor(gy*c.height),1,1).data; out.push([a?a.original:null,a?a.picked:null,[d[0],d[1],d[2],d[3]]])}
      return out})()""" % (FRAME, CANVAS))
    opaque = [p for p in probe if p[2][3] > 250]
    found = [p for p in opaque if p[0]]
    check("most opaque points have a colour", len(opaque) > 100 and len(found) >= 0.9 * len(opaque), f"{len(found)} of {len(opaque)}")
    empty = [p for p in probe if p[2][3] == 0]
    check("transparent points have none", sum(1 for p in empty if p[0]) <= 0.05 * max(1, len(empty)), f"{sum(1 for p in empty if p[0])} of {len(empty)}")
    def close(hexc, rgba, tol=40):
        h = hexc.lstrip("#"); return all(abs(int(h[i:i+2], 16) - rgba[k]) <= tol for k, i in enumerate((0, 2, 4)))
    good = [p for p in found if close(p[1], p[2][:3])]
    check("the colour it reports is the one on screen", len(good) >= 0.9 * len(found), f"{len(good)} of {len(found)}")
    inpal = {e["color"] for e in pal}
    check("every colour found is in the palette", all(p[0] in inpal for p in found))

    # relatives of the most used colour
    top = pal[0]["color"]
    rel = js(f"{FRAME}.contentWindow.cbColorRelatives('{top}','')")
    check("relatives answers with outlines and shades", isinstance(rel, dict) and "strokes" in rel and "shadows" in rel, str(rel)[:120])
    check("the shades and outlines are colours of the character", all(c in inpal for c in rel["strokes"] + rel["shadows"]))

    # a scope that holds nothing: nothing
    check("a part that is not there has no colours", (js(f"{FRAME}.contentWindow.cbColorPalette('@Sardar_01/instance_99')") or []) == [])
    check("and finds nothing at a point", js(f"{FRAME}.contentWindow.cbColorAt(0.5,0.5,'@Sardar_01/instance_99')") is None)

    # the pasted head's own colours: the library copied from Rajkumar
    lib = json.dumps(sar["nativePose"])
    check("the pose carries Rajkumar's head", "Pasted from Rajkumar" in lib)
    import re
    np = list(sar["nativePose"].values())[0]
    hexes = lambda o: set(re.findall(r'"#([0-9a-fA-F]{6})"', json.dumps(o)))
    pasted_only = {"#" + h.lower() for h in hexes(np.get("library", {}))} - {"#" + h.lower() for h in hexes(np.get("symbols", {}))}
    on_head = [p for p in found if p[0] in pasted_only]
    check("points on the pasted head report colours only the pasted head has", len(on_head) > 0, f"{len(on_head)} points, {len(pasted_only)} head-only colours")
    check("the palette lists the pasted head's colours too", any(e["color"] in pasted_only for e in pal) or any(c in inpal for c in pasted_only))
    # a rule made from a picked colour recolours exactly that colour
    pick = found[len(found) // 2]
    rule = {"id": "t1", "from": pick[0], "to": "#00ff00", "target": "both", "scope": "*", "match": "exact"}
    ed2 = json.loads(json.dumps(ed)); [o for o in ed2["objects"] if o["id"] == sar["id"]][0]["colorReplacements"] = [rule]; patch(scene(), ed2)
    cmd("Page.navigate", url=f"http://localhost:3000/editor/{PROJECT}"); time.sleep(9)
    for _ in range(60):
        if js(f"!!{CANVAS} && {CANVAS}.style.visibility!=='hidden'"): break
        time.sleep(0.5)
    time.sleep(2)
    pal2 = js(f"{FRAME}.contentWindow.cbColorPalette('')") or []
    mine = [e for e in pal2 if e["color"] == pick[0]]
    check("the palette shows the rule: original colour, new current", bool(mine) and mine[0]["current"] == "#00ff00", str(mine))
    gx = None
    for gy in [0.04 * i for i in range(1, 25)]:
        for gxx in [0.1 + 0.04 * i for i in range(0, 21)]:
            a = js(f"{FRAME}.contentWindow.cbColorAt({gxx},{gy},'')")
            if a and a["original"] == pick[0]: gx = (gxx, gy, a); break
        if gx: break
    check("the eyedropper reports the original, and what it shows now", bool(gx) and gx[2]["picked"] == "#00ff00", str(gx))
    shot("1-recoloured")
    patch(scene(), ed)
finally:
    chrome.terminate()
print("FAILED:" if failed else "ALL PASSED", failed)
sys.exit(1 if failed else 0)
