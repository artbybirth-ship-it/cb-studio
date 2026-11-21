"""Point editing (A) on a drawn shape in the native pose editor (/native-lab), with real mouse and key events.

usage: python3 point_edit_test.py <file.fla> <out dir>
Steps into the pose until a drawn shape is under the pointer, selects it, switches point editing on, drags one anchor point and checks the picture
changed and the point moved; Undo puts it back. Then several points: Shift-click and a box select them, a drag and the arrow keys move them all,
Delete removes them, a double-click on an edge adds one without changing the picture, Option-click switches a point between corner and curve. Needs the dev server on :3000 and `websocket-client`.
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

    def key(k, code, vk, mods=0): cmd("Input.dispatchKeyEvent", type="keyDown", key=k, code=code, windowsVirtualKeyCode=vk, modifiers=mods); cmd("Input.dispatchKeyEvent", type="keyUp", key=k, code=code, windowsVirtualKeyCode=vk, modifiers=mods); time.sleep(0.4)
    count = lambda: int(js("document.querySelector('[data-testid=stage]').dataset.pointCount || '-1'"))
    nsel = lambda: int(js("document.querySelector('[data-testid=stage]').dataset.pointSel || '-1'"))
    steps = lambda: js("document.querySelector('[data-testid=undo]').dataset.steps")
    anchors_now = lambda: [q["p"] for q in (pts() or []) if q["k"] == "anchor"]
    # The stage's pixels are read from a copy of it (its image), never from the stage canvas itself: reading a canvas back repeatedly makes
    # Chrome draw it in software from then on, which anti-aliases every outline a little differently.
    COPY = """(async()=>{const c=document.querySelector('[data-testid=stage]');const i=new Image();await new Promise(r=>{i.onload=r;i.src=c.toDataURL()});
      const k=document.createElement('canvas');k.width=c.width;k.height=c.height;const g=k.getContext('2d',{willReadFrequently:true});g.drawImage(i,0,0);return g.getImageData(0,0,k.width,k.height).data})()"""
    def pixels(): js(f"(async()=>{{window.__px=await {COPY};return 1}})()")
    def changed(): return js(f"""(async()=>{{const d=await {COPY},b=window.__px;let n=0;for(let i=0;i<d.length;i+=4)if(Math.abs(d[i]-b[i])+Math.abs(d[i+1]-b[i+1])+Math.abs(d[i+2]-b[i+2])>40)n++;return n}})()""")
    def press(x, y, mods=0, n=1):
        for i in range(1, n + 1): cmd("Input.dispatchMouseEvent", type="mousePressed", x=x, y=y, button="left", clickCount=i, modifiers=mods); cmd("Input.dispatchMouseEvent", type="mouseReleased", x=x, y=y, button="left", clickCount=i, modifiers=mods)
        time.sleep(0.6)
    def drag(x0, y0, x1, y1, steps=8):
        mouse("mousePressed", x0, y0); time.sleep(0.15)
        for i in range(1, steps + 1): mouse("mouseMoved", x0 + (x1 - x0) * i / steps, y0 + (y1 - y0) * i / steps, buttons=1); time.sleep(0.04)
        mouse("mouseReleased", x1, y1); time.sleep(0.7)
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
            img1 = stage(); p1 = pts(); moved_anchors = anchors_now()
            moved = p1 and anchors and [q for q in p1 if q["k"] == "anchor"][0]["p"]
            check("dragging an anchor changes the picture", img1 != img0)
            check("the anchor moved with the pointer", moved and abs((moved[0] - a[0]) - 32 * (760 / 570)) < 6 and abs((moved[1] - a[1]) - 24 * (560 / 420)) < 6, f"{a} -> {moved}")
            shot("2-dragged")
            click("[data-testid=undo]"); time.sleep(0.5)
            check("Undo puts the shape back", stage() == img0)
            click("[data-testid=redo]"); time.sleep(0.5)
            check("Redo applies the move again", anchors_now() == moved_anchors)

            # a curve handle bends the curve
            controls = [q for q in (pts() or []) if q["k"] == "control"]
            if controls:
                c = controls[0]["p"]; cx0, cy0 = to_client(c); imgc = stage()
                mouse("mousePressed", cx0, cy0); time.sleep(0.2)
                for i in range(1, 7): mouse("mouseMoved", cx0 - i * 5, cy0 + i * 2, buttons=1); time.sleep(0.05)
                mouse("mouseReleased", cx0 - 30, cy0 + 12); time.sleep(0.8)
                newc = [q for q in (pts() or []) if q["k"] == "control"][0]["p"]
                check("dragging a curve handle bends the curve", stage() != imgc and abs((newc[0] - c[0]) + 30 * (760 / 570)) < 6, f"{c} -> {newc}")
            # ---- several points
            base_n = count(); A = anchors_now()
            check("the shape has enough points to work with", base_n >= 4 and len(A) >= 3, f"{base_n} anchors")
            i0, i1 = 0, len(A) // 2
            press(*to_client(A[i0])); press(*to_client(A[i1]), mods=8)
            check("click then ⇧-click selects two points", nsel() == 2, str(nsel()))
            press(*to_client(A[i1]), mods=8)
            check("⇧-click again takes one out", nsel() == 1, str(nsel()))
            press(*to_client(A[i1]), mods=8)
            img = stage(); ax, ay = to_client(A[i0])
            drag(ax, ay, ax + 20, ay + 15)
            B = anchors_now()
            d0 = (B[i0][0] - A[i0][0], B[i0][1] - A[i0][1]); d1 = (B[i1][0] - A[i1][0], B[i1][1] - A[i1][1])
            check("dragging one selected point moves both", abs(d0[0] - d1[0]) < 2 and abs(d0[1] - d1[1]) < 2 and abs(d0[0]) > 10, f"{d0} {d1}")
            check("...and they stay selected", nsel() == 2, str(nsel()))
            click("[data-testid=undo]"); time.sleep(0.5)
            check("Undo puts both back", anchors_now()[i0] == A[i0] and anchors_now()[i1] == A[i1])
            check("...and the points no longer there drop out of the selection", nsel() == 0, str(nsel()))
            press(*to_client(A[i0])); press(*to_client(A[i1]), mods=8)
            img = stage()
            js("document.activeElement && document.activeElement.blur()")
            key("ArrowRight", "ArrowRight", 39, 8)
            C = anchors_now()
            e0, e1 = C[i0][0] - A[i0][0], C[i1][0] - A[i1][0]
            check("⇧→ nudges the selected points right together", e0 > 3 and abs(e0 - e1) < 1 and abs(C[i0][1] - A[i0][1]) < 1, f"{e0:.1f} {e1:.1f}")
            click("[data-testid=undo]"); time.sleep(0.5)
            check("Undo takes the nudge back", anchors_now()[i0] == A[i0] and anchors_now()[i1] == A[i1])

            # ---- a box over the shape selects its points; a click on empty stage drops them
            r = js("(()=>{const r=document.querySelector('[data-testid=stage]').getBoundingClientRect();return [r.left,r.top,r.width,r.height]})()")
            drag(r[0] + 3, r[1] + 3, r[0] + r[2] - 3, r[1] + r[3] - 3, steps=10)
            check("a box over the whole stage selects every point of the shape", nsel() == count(), f"{nsel()} of {count()}")
            press(r[0] + 3, r[1] + r[3] - 3)
            check("a click on empty stage drops the points", nsel() == 0 and count() == base_n, f"{nsel()} selected, {count()} shown")

            # ---- Delete removes the selected point
            press(*to_client(A[i1]))
            img1 = stage(); before_del = anchors_now(); key("Delete", "Delete", 46)
            check("Delete removes the selected point", count() == base_n - 1, f"{base_n} -> {count()}")
            check("...and changes the picture", stage() != img1)
            check("...and the shape is still there (not its layer)", count() > 0)
            click("[data-testid=undo]"); time.sleep(0.5)
            check("Undo brings the point back", count() == base_n and anchors_now() == before_del, f"{count()} points")

            # ---- a double-click on an edge adds a point, the picture stays
            # the middle of a curve, well clear of every point (a click on a point picks it instead)
            mids = [[0.25 * c["a"][0] + 0.5 * c["p"][0] + 0.25 * c["b"][0], 0.25 * c["a"][1] + 0.5 * c["p"][1] + 0.25 * c["b"][1]] for c in (pts() or []) if c["k"] == "control"]
            clear = lambda m: min(min(((m[0] - a[0]) ** 2 + (m[1] - a[1]) ** 2) ** 0.5 for a in anchors_now()), min(((m[0] - q["p"][0]) ** 2 + (m[1] - q["p"][1]) ** 2) ** 0.5 for q in pts() if q["k"] == "control"))
            mid = max(mids, key=clear) if mids else None
            check("found the middle of a curve clear of the points", bool(mid) and clear(mid) > 10, f"{mid and clear(mid):.1f} px clear")
            click("[data-testid=point-mode]"); pixels(); img2 = stage(); click("[data-testid=point-mode]")  # the drawing alone, without the points on it
            steps0 = steps()
            press(*to_client(mid), n=2)
            check("a double-click on an edge adds a point", count() == base_n + 1, f"{base_n} -> {count()}")
            check("...which is selected", nsel() == 1, str(nsel()))
            newp = [q["p"] for q in pts() if q["k"] == "anchor" and q.get("sel")]
            click("[data-testid=point-mode]"); still = changed(); click("[data-testid=point-mode]")
            check("...and the drawing does not change", still < 60, f"{still} pixels")
            shot("4-added")

            # ---- ⌥-click: corner <-> curve on the new point (it sits on a curve when there was one)
            if newp:
                pixels(); n_ctrl = len([q for q in pts() if q["k"] == "control"])
                press(*to_client(newp[0]), mods=1)
                check("⌥-click switches the point (the picture changes)", changed() > 0, f"{changed()} pixels")
                n2 = len([q for q in pts() if q["k"] == "control"])
                check("...between corner and curve (the curve handles change)", n2 != n_ctrl, f"{n_ctrl} -> {n2} handles")
                press(*to_client(newp[0]), mods=1)
                n3 = len([q for q in pts() if q["k"] == "control"])
                check("⌥-click again switches it back", n3 != n2, f"{n2} -> {n3} handles")
                for _ in range(3): click("[data-testid=undo]"); time.sleep(0.4)
                # Undo steps back exactly, and the drawing with it.
                same_points = count() == base_n and anchors_now() == before_del and steps() == steps0
                click("[data-testid=point-mode]"); same_drawing = stage() == img2; click("[data-testid=point-mode]")
                check("Undo (3×) takes add and both switches back", same_points and same_drawing, f"{count()} points, same points and steps {same_points}, same drawing {same_drawing}")

            # ---- ⌥-drag on an edge bends it: a straight edge becomes a curve (found among the middles between two points), undone in one step
            anchors0 = anchors_now(); ctrl0 = len([q for q in pts() if q["k"] == "control"]); bent_ok = None
            tried = 0
            for i in range(len(anchors0)):
                for j in range(i + 1, len(anchors0)):
                    if bent_ok or tried >= 40: break
                    m = [(anchors0[i][0] + anchors0[j][0]) / 2, (anchors0[i][1] + anchors0[j][1]) / 2]
                    others = [a for k, a in enumerate(anchors0) if k not in (i, j)]
                    if min(((m[0] - a[0]) ** 2 + (m[1] - a[1]) ** 2) ** 0.5 for a in others + [q["p"] for q in pts() if q["k"] == "control"]) < 12: continue
                    tried += 1
                    x0, y0 = to_client(m)
                    mouse("mousePressed", x0, y0, modifiers=1); time.sleep(0.15)
                    for k in range(1, 7): mouse("mouseMoved", x0 + 3 * k, y0 + 3 * k, buttons=1, modifiers=1); time.sleep(0.04)
                    mouse("mouseReleased", x0 + 18, y0 + 18, modifiers=1); time.sleep(0.7)
                    if len([q for q in pts() if q["k"] == "control"]) > ctrl0: bent_ok = (i, j)
                if bent_ok: break
            check("⌥-drag on a straight edge bends it into a curve", bool(bent_ok), f"{ctrl0} -> {len([q for q in pts() if q['k'] == 'control'])} handles after {tried} tries")
            if bent_ok:
                click("[data-testid=undo]"); time.sleep(0.5)
                check("...and one Undo makes it straight again", len([q for q in pts() if q["k"] == "control"]) == ctrl0 and anchors_now() == anchors0)

            # a shape tween: editing inside the span makes a keyframe there, and the tween plays on with the new shape
            js("document.querySelector('[data-layer]')?.scrollIntoView({block:'center'})"); time.sleep(0.3)
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
                        mode_on = js("document.querySelector('[data-testid=point-mode]').getAttribute('aria-pressed')")
                        check("editing inside a shape tween makes a keyframe there", keys_after == keys_before + 1 and stage() != imgt, f"{keys_before} -> {keys_after}, picture changed {stage() != imgt}, {len(tp)} points, point mode {mode_on}")
                        shot("3-tween")
                        click("[data-testid=undo]"); time.sleep(0.5)
                        check("Undo takes the keyframe away again", js("[...document.querySelectorAll('[data-key^=\"%d:\"]')].length" % green["layer"]) == keys_before)
finally:
    chrome.terminate()
print("FAILED:" if failed else "ALL PASSED", failed)
sys.exit(1 if failed else 0)
