"""Point editing (A) on a drawn shape in the native pose editor (/native-lab), with real mouse and key events.

usage: python3 point_edit_test.py <file.fla> <out dir>
Steps into the pose until a drawn shape is under the pointer, selects it, switches point editing on, drags one anchor point and checks the picture
changed and the point moved; Undo puts it back. Needs the dev server on :3000 and `websocket-client`.
"""
import base64, json, os, subprocess, sys, time, urllib.request, websocket

FLA, OUT = sys.argv[1], sys.argv[2]
os.makedirs(OUT, exist_ok=True)
chrome = subprocess.Popen(["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "--headless=new", "--remote-debugging-port=9556",
                           f"--user-data-dir={OUT}/profile", "--window-size=1400,1100", "about:blank"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
failed = []
try:
    for _ in range(50):
        try: tabs = json.load(urllib.request.urlopen("http://127.0.0.1:9556/json")); break
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
        if r.get("exceptionDetails"): print("JS error:", r["exceptionDetails"].get("exception", {}).get("description", "")[:400])
        return r.get("result", {}).get("value")
    def check(name, ok, detail=""):
        print(("PASS " if ok else "FAIL ") + name, detail)
        if not ok: failed.append(name)
    def mouse(kind, x, y, **kw): cmd("Input.dispatchMouseEvent", type=kind, x=x, y=y, button="left", clickCount=kw.pop("clickCount", 1), **kw)
    def centre(sel, dx=0.5, dy=0.5): return js(f"(()=>{{const r=document.querySelector({json.dumps(sel)}).getBoundingClientRect();return [r.left+r.width*{dx},r.top+r.height*{dy}]}})()")
    def click(sel): x, y = centre(sel); mouse("mousePressed", x, y); mouse("mouseReleased", x, y); time.sleep(0.4)
    def shot(name): open(f"{OUT}/{name}.png", "wb").write(base64.b64decode(cmd("Page.captureScreenshot", format="png")["data"]))
    stage = lambda: js("document.querySelector('[data-testid=stage]').toDataURL()")
    pts = lambda: json.loads(js("document.querySelector('[data-testid=stage]').dataset.points || 'null'") or "null")
    def to_client(p):
        r = js("(()=>{const c=document.querySelector('[data-testid=stage]');const r=c.getBoundingClientRect();return [r.left,r.top,r.width/c.width,r.height/c.height]})()")
        return r[0] + p[0] * r[2], r[1] + p[1] * r[3]

    cmd("Runtime.enable"); cmd("Page.enable"); cmd("DOM.enable")
    cmd("Page.navigate", url="http://localhost:3000/native-lab"); time.sleep(6)
    root = cmd("DOM.getDocument")["root"]["nodeId"]
    cmd("DOM.setFileInputFiles", files=[FLA], nodeId=cmd("DOM.querySelector", nodeId=root, selector="input[type=file]")["nodeId"])
    for _ in range(120):
        time.sleep(1)
        if js("!!document.querySelector('[data-testid=toggle-editor]')"): break
    click("[data-testid=toggle-editor]"); time.sleep(2)
    check("editor opens", bool(js("!!document.querySelector('[data-testid=stage]')")))
    # Step in at a point on the character until the layer under the pointer holds a drawn shape.
    found = False
    for dy in (0.35, 0.3, 0.45, 0.25, 0.5):
        for attempt in range(6):
            x, y = centre("[data-testid=stage]", 0.5, dy)
            mouse("mousePressed", x, y); mouse("mouseReleased", x, y); time.sleep(0.5)
            shape_btn = js("(()=>{const b=[...document.querySelectorAll('button')].find(b=>/^#\\d+ shape$/.test(b.textContent.trim()));if(!b)return null;const r=b.getBoundingClientRect();return [r.left+r.width/2,r.top+r.height/2]})()")
            if shape_btn: found = True; break
            before = js("document.querySelector('[data-testid=stage]').toDataURL().length")
            mouse("mousePressed", x, y, clickCount=2); mouse("mouseReleased", x, y, clickCount=2); time.sleep(0.8)
        if found: break
    check("reached a drawn shape", found)
    if found:
        mouse("mousePressed", *shape_btn); mouse("mouseReleased", *shape_btn); time.sleep(0.4)
        click("[data-testid=point-mode]"); time.sleep(0.6)
        p0 = pts()
        check("point editing shows the shape's points", bool(p0) and any(p["k"] == "anchor" for p in p0), f"{len(p0 or [])} points")
        shot("1-points")
        if p0:
            anchors = [p for p in p0 if p["k"] == "anchor"]
            a = anchors[0]["p"]
            ax, ay = to_client(a)
            img0 = stage()
            mouse("mousePressed", ax, ay); time.sleep(0.2)
            for i in range(1, 9): mouse("mouseMoved", ax + i * 4, ay + i * 3, buttons=1); time.sleep(0.05)
            mouse("mouseReleased", ax + 32, ay + 24); time.sleep(0.8)
            img1 = stage(); p1 = pts()
            moved = p1 and anchors and [q for q in p1 if q["k"] == "anchor"][0]["p"]
            check("dragging an anchor changes the picture", img1 != img0)
            check("the anchor moved with the pointer", moved and abs((moved[0] - a[0]) - 32 * (760 / 570)) < 6 and abs((moved[1] - a[1]) - 24 * (560 / 420)) < 6, f"{a} -> {moved}")
            shot("2-dragged")
            click("[data-testid=undo]"); time.sleep(0.5)
            check("Undo puts the shape back", stage() == img0)
            click("[data-testid=redo]"); time.sleep(0.5)
            check("Redo applies the move again", stage() == img1)

            # a curve handle bends the curve
            controls = [q for q in (pts() or []) if q["k"] == "control"]
            if controls:
                c = controls[0]["p"]; cx0, cy0 = to_client(c); imgc = stage()
                mouse("mousePressed", cx0, cy0); time.sleep(0.2)
                for i in range(1, 7): mouse("mouseMoved", cx0 - i * 5, cy0 + i * 2, buttons=1); time.sleep(0.05)
                mouse("mouseReleased", cx0 - 30, cy0 + 12); time.sleep(0.8)
                newc = [q for q in (pts() or []) if q["k"] == "control"][0]["p"]
                check("dragging a curve handle bends the curve", stage() != imgc and abs((newc[0] - c[0]) + 30 * (760 / 570)) < 6, f"{c} -> {newc}")
            # a shape tween: editing inside the span makes a keyframe there, and the tween plays on with the new shape
            green = js("""(()=>{const rows=[...document.querySelectorAll('[data-layer]')];for(const r of rows){const k=[...r.querySelectorAll('[data-key]')].find(k=>getComputedStyle(k).backgroundColor==='rgb(191, 232, 191)'&&parseInt(k.style.width)>=60);if(k){const b=r.getBoundingClientRect();return {layer:+r.dataset.layer,key:k.dataset.key,left:parseInt(k.style.left),y:b.top+b.height/2,x:b.left}}}return null})()""")
            check("found a shape tween on the timeline", green is not None, str(green))
            if green:
                keys_before = js("[...document.querySelectorAll('[data-key^=\"%d:\"]')].length" % green["layer"])
                fx = green["x"] + green["left"] + 4 * 12 + 6
                mouse("mousePressed", fx, green["y"]); mouse("mouseReleased", fx, green["y"]); time.sleep(0.5)
                shape_btn = js("(()=>{const b=[...document.querySelectorAll('button')].find(b=>/^#\\d+ shape$/.test(b.textContent.trim()));if(!b)return null;const r=b.getBoundingClientRect();return [r.left+r.width/2,r.top+r.height/2]})()")
                check("the tween's layer has a drawn shape", shape_btn is not None)
                if shape_btn:
                    mouse("mousePressed", *shape_btn); mouse("mouseReleased", *shape_btn); time.sleep(0.5)
                    tp = [q for q in (pts() or []) if q["k"] == "anchor"]
                    if tp:
                        tx0, ty0 = to_client(tp[0]["p"]); imgt = stage()
                        mouse("mousePressed", tx0, ty0); time.sleep(0.2)
                        for i in range(1, 7): mouse("mouseMoved", tx0 + i * 4, ty0 + i * 4, buttons=1); time.sleep(0.05)
                        mouse("mouseReleased", tx0 + 24, ty0 + 24); time.sleep(0.8)
                        keys_after = js("[...document.querySelectorAll('[data-key^=\"%d:\"]')].length" % green["layer"])
                        check("editing inside a shape tween makes a keyframe there", keys_after == keys_before + 1 and stage() != imgt, f"{keys_before} -> {keys_after}")
                        shot("3-tween")
                        click("[data-testid=undo]"); time.sleep(0.5)
                        check("Undo takes the keyframe away again", js("[...document.querySelectorAll('[data-key^=\"%d:\"]')].length" % green["layer"]) == keys_before)
finally:
    chrome.terminate()
print("FAILED:" if failed else "ALL PASSED", failed)
sys.exit(1 if failed else 0)
