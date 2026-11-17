"""Box-selecting drawn shapes inside a symbol: everything the box covers is picked in one go (the earring beads of Rajkumar's ear).

usage: python3 box_select_test.py <throwaway project id> <out dir> <source project id>
Like delete_piece_test.py: steps into Sardar's pasted Rajkumar head and into the ear symbol (198 drawn shapes, the earring beads among them), then drags
real boxes on the stage. For each box the ground truth is made independently: every shape drawn alone, magnified, and checked for any pixel inside
the box. The player must pick all of them (it used to miss the tiny beads, and before that nearly all of the shapes). Use a throwaway project.
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
    cmd("Page.navigate", url=f"http://localhost:3000/editor/{PROJECT}"); time.sleep(10)
    js("""(()=>{const e=document.querySelector('[title*="step inside it"]');const r=e.getBoundingClientRect();e.dispatchEvent(new MouseEvent('dblclick',{bubbles:true,cancelable:true,clientX:r.left+r.width/2,clientY:r.top+r.height*0.2,view:window}))})()"""); time.sleep(3)
    clk(840, 235, 2); clk(840, 235, 2)
    check("inside the pasted head", "Head copy" in level(), level())
    def into(name):
        ok = js("""(()=>{const r=[...document.querySelectorAll('.cb-symbol-row')].find(e=>(e.querySelector('.cb-symbol-layer')||e).textContent.trim().startsWith(%s)); if(!r) return false;
          r.scrollIntoView({block:'center'}); const track=[...r.children].find(c=>!c.classList.contains('cb-symbol-layer')); const b=track.getBoundingClientRect();
          track.dispatchEvent(new MouseEvent('dblclick',{bubbles:true,cancelable:true,clientX:b.left+40,clientY:b.top+b.height/2,view:window})); return true})()""" % json.dumps(name)); time.sleep(3); return ok
    def into(name):
        ok = js("""(()=>{const r=[...document.querySelectorAll('.cb-symbol-row')].find(e=>(e.querySelector('.cb-symbol-layer')||e).textContent.trim().startsWith(%s)); if(!r) return false;
          r.scrollIntoView({block:'center'}); const track=[...r.children].find(c=>!c.classList.contains('cb-symbol-layer')); const b=track.getBoundingClientRect();
          track.dispatchEvent(new MouseEvent('dblclick',{bubbles:true,cancelable:true,clientX:b.left+40,clientY:b.top+b.height/2,view:window})); return true})()""" % json.dumps(name)); time.sleep(3); return ok
    into("Left_ear")
    check("stepped into the ear", "ear" in level().lower(), level())
    js("""window.__rects=[]; window.addEventListener('message',e=>{const d=e.data||{}; if(d.source==='characterbazaarstudio-animate'&&d.type==='SYMBOL_PARTS_RECT') window.__rects.push(d.props)})""")
    # ground truth: every shape of the ear level drawn alone, magnified, and checked for any pixel inside the marquee
    TRUTH = """(fr)=>{const f=document.querySelector('iframe.cb-character-source-frame'), w=f.contentWindow, root=w.exportRoot, st=w.stage, seen=new Set(); let c=null;
      (function walk(n){ if(!n||seen.has(n)||c) return; seen.add(n); if(n.shape_197){c=n;return} (n.children||[]).forEach(walk); Object.keys(n).forEach(k=>{ if(k!=='parent'&&n[k]&&typeof n[k]==='object'&&n[k].timeline) walk(n[k])})})(root);
      const W=720,H=960, x0=Math.min(fr[0],fr[2])*W, x1=Math.max(fr[0],fr[2])*W, y0=Math.min(fr[1],fr[3])*H, y1=Math.max(fr[1],fr[3])*H, rw=x1-x0, rh=y1-y0, k=Math.min(24,900/Math.max(rw,rh));
      const out=[]; for(const key of Object.keys(c).filter(k=>/^shape/.test(k))){ const o=c[key]; if(o.parent!==c||o.visible===false) continue;
        const cv=document.createElement('canvas'); cv.width=Math.max(1,Math.ceil(rw*k)); cv.height=Math.max(1,Math.ceil(rh*k)); const ctx=cv.getContext('2d');
        let m=o.getConcatenatedMatrix(); const inv=st.getMatrix(); inv.invert(); m=m.clone().prependMatrix(inv);
        ctx.setTransform(k,0,0,k,-x0*k,-y0*k); ctx.transform(m.a,m.b,m.c,m.d,m.tx,m.ty); try{o.draw(ctx,true)}catch(e){continue}
        const d=ctx.getImageData(0,0,cv.width,cv.height).data; let hit=false; for(let i=3;i<d.length;i+=4) if(d[i]>0){hit=true;break} if(hit) out.push(key) }
      return JSON.stringify({visible:Object.keys(c).filter(k=>/^shape/.test(k)&&c[k].parent===c&&c[k].visible!==false).length, truth:out})}"""
    fr = json.loads(js("(()=>{const r=document.querySelector('iframe.cb-character-source-frame').getBoundingClientRect(); return JSON.stringify([r.left,r.top,r.width,r.height])})()"))
    def drag(x0, y0, x1, y1):
        js("window.__rects.length=0")
        for kind, x, y in (("mousePressed", x0, y0), ("mouseMoved", (x0 + x1) / 2, (y0 + y1) / 2), ("mouseMoved", x1, y1), ("mouseReleased", x1, y1)):
            cmd("Input.dispatchMouseEvent", type=kind, x=x, y=y, button="left" if kind != "mouseMoved" else "none", buttons=1 if kind != "mouseReleased" else 0, clickCount=1); time.sleep(0.25)
        time.sleep(2.5)
        got = js("window.__rects[window.__rects.length-1]") or []
        fracs = [(x0 - fr[0]) / fr[2], (y0 - fr[1]) / fr[3], (x1 - fr[0]) / fr[2], (y1 - fr[1]) / fr[3]]
        t = json.loads(js("(%s)(%s)" % (TRUTH, json.dumps(fracs))))
        return got, t
    boxes = ((940, 214, 903, 300), (940, 214, 892, 300), (935, 225, 880, 255), (950, 205, 880, 310), (934, 247, 897, 268), (930, 230, 900, 262), (925, 240, 905, 290))
    for (x0, y0, x1, y1) in boxes:
        got, t = drag(x0, y0, x1, y1); missing = sorted(set(t["truth"]) - set(got))
        check(f"box {(x0, y0, x1, y1)}: everything drawn in it is picked ({len(t['truth'])} shapes)", len(t["truth"]) > 0 and not missing, f"selected {len(got)}, missing {missing}")
        clk(960, 330)
finally:
    chrome.terminate()
print("FAILED:" if failed else "ALL PASSED", failed)
sys.exit(1 if failed else 0)
