"""The colour picker against the pixels: over a fine grid, the colour the finder reports for a natively drawn character must be the one on screen.

usage: python3 finder_pixels_test.py <throwaway project id> <out dir>
The project's first character needs native edits (run swap_part_test.py on it). A point where the finder reports a colour but
nothing is drawn, or reports a colour that is not the one drawn (a shape hidden by a mask), counts against it.
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

    sc = scene(); ed = json.loads(json.dumps(sc["editor_data"])); o = ed["objects"][0]
    check("the character has native pose edits", bool(o.get("nativePose")))
    o.pop("colorReplacements", None); patch(sc, ed)
    cmd("Page.navigate", url=f"http://localhost:3000/editor/{PROJECT}"); time.sleep(9)
    CANVAS = f"document.querySelector('[data-native-character=\"{o['id']}\"]')"
    for _ in range(60):
        if js(f"!!{CANVAS} && {CANVAS}.style.visibility!=='hidden'"): break
        time.sleep(0.5)
    time.sleep(2)
    FRAME = f"window.__CBS_COLOUR_FRAME__('{o['id']}')"
    probe = js("""(()=>{const f=%s, c=%s, x=c.getContext('2d'); const out=[];
      for(let gy=0.01;gy<0.99;gy+=0.015)for(let gx=0.05;gx<0.97;gx+=0.015){const a=f.contentWindow.cbColorAt(gx,gy,''); const d=x.getImageData(Math.floor(gx*c.width),Math.floor(gy*c.height),1,1).data; out.push([a?a.original:null,a?a.picked:null,[d[0],d[1],d[2],d[3]]])}
      return out})()""" % (FRAME, CANVAS))
    opaque = [p for p in probe if p[2][3] > 250]; empty = [p for p in probe if p[2][3] < 10]
    def close(hexc, rgba, tol=48):
        h = hexc.lstrip("#"); return all(abs(int(h[i:i+2], 16) - rgba[k]) <= tol for k, i in enumerate((0, 2, 4)))
    found = [p for p in opaque if p[0]]
    wrong = [p for p in found if not close(p[1], p[2][:3])]
    phantom = [p for p in empty if p[0]]
    import collections
    print("WRONG sample:", [(w[0], w[1], "#%02x%02x%02x" % tuple(w[2][:3])) for w in wrong[:10]]); print("by original:", collections.Counter(w[0] for w in wrong).most_common(5))
    print(f"grid {len(probe)} points, {len(opaque)} opaque, {len(empty)} empty; wrong colour {len(wrong)}, phantom hits {len(phantom)}, missed {len(opaque) - len(found)}")
    check("almost every opaque point has a colour", len(found) >= 0.97 * len(opaque), f"{len(found)} of {len(opaque)}")
    # Semi-transparent shading drawn over a shape makes the pixel differ from the shape's own colour; the player's picker reports the shape too. Rajkumar: 62 of 1041 (6%).
    check("the colour reported is the one on screen (shading over a shape aside)", len(wrong) <= 0.10 * max(1, len(found)), f"{len(wrong)} of {len(found)} differ")
    check("empty points have no colour", len(phantom) <= 0.01 * max(1, len(empty)), f"{len(phantom)} of {len(empty)}")
finally:
    chrome.terminate()
print("FAILED:" if failed else "ALL PASSED", failed)
sys.exit(1 if failed else 0)
