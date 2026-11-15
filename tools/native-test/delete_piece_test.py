"""Delete inside a symbol takes out what is picked, not the whole layer it sits in (one shape of a nose, not the nose).

usage: python3 delete_piece_test.py <throwaway project id> <out dir> <source project id>
Like pasted_part_test.py: steps into Sardar's pasted Rajkumar head, then into its ear symbol (198 drawn shapes), picks one drawn shape, presses Delete, and checks that only
that shape is hidden (the layer it sits in stays, the rest of the nose is still drawn) and that this survives a reload. Use a throwaway project.
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
    # step into the nose from the timeline: double-click the keyframe of the Nose layer
    ok = js("""(()=>{const r=[...document.querySelectorAll('.cb-symbol-row')].find(e=>(e.querySelector('.cb-symbol-layer')||e).textContent.trim().startsWith('Left_ear')); if(!r) return false;
      r.scrollIntoView({block:'center'}); const track=[...r.children].find(c=>!c.classList.contains('cb-symbol-layer')); const b=track.getBoundingClientRect();
      track.dispatchEvent(new MouseEvent('dblclick',{bubbles:true,cancelable:true,clientX:b.left+40,clientY:b.top+b.height/2,view:window})); return true})()"""); time.sleep(3)
    check("the Left_ear layer is listed", bool(ok), str(ok))
    lvl = level(); print("LEVEL after double-clicking the Left_ear layer:", lvl, "| notice:", js("(document.body.innerText.match(/can.t be opened[^\\n]*|That.s drawn[^\\n]*|Couldn.t load[^\\n]*|no longer in your library[^\\n]*/)||['none'])[0]"))
    check("stepped into the ear", "ear" in lvl.lower(), lvl)
    shot("1-in-nose")
    def find_point(x0, y0, x1, y1, step=2, prefix="shape"):
        """A screen point in the region where the player says there is an object whose name starts with `prefix` (asked through SYMBOL_HIT, which is quick).
        The player takes a moment to follow the editor into a symbol, so it is asked again for a few seconds."""
        script = """(async()=>{const f=document.querySelector('iframe.cb-character-source-frame'); const r=f.getBoundingClientRect();
          const ask=(x,y)=>new Promise(res=>{const h=e=>{const d=e.data||{}; if(d.source==='characterbazaarstudio-animate'&&d.type==='SYMBOL_HIT'){window.removeEventListener('message',h);res(d.prop)}};window.addEventListener('message',h);f.contentWindow.postMessage({source:'characterbazaarstudio-editor',type:'SYMBOL_HIT',normalizedX:(x-r.left)/r.width,normalizedY:(y-r.top)/r.height},'*');setTimeout(()=>res(null),2000)});
          for(let y=%d;y<%d;y+=%d) for(let x=%d;x<%d;x+=%d){ const p=await ask(x,y); if(p&&p.indexOf(%s)===0) return JSON.stringify([x,y,p]) } return null})()""" % (y0, y1, step, x0, x1, step, json.dumps(prefix))
        for _ in range(8):
            r = js(script)
            if r: return json.loads(r)
            time.sleep(1)
        return None
    def marquee(x0, y0, x1, y1):
        for kind, x, y in (("mousePressed", x0, y0), ("mouseMoved", (x0 + x1) / 2, (y0 + y1) / 2), ("mouseMoved", x1, y1), ("mouseReleased", x1, y1)):
            cmd("Input.dispatchMouseEvent", type=kind, x=x, y=y, button="left" if kind != "mouseMoved" else "none", buttons=1 if kind != "mouseReleased" else 0, clickCount=1); time.sleep(0.25)
        time.sleep(2.0)
    nlayers = len(rows())
    # pick one drawn shape: try points over the nose until a single row is selected, then see what is picked
    before = canvas(); picked = None
    # a box over a few of the earring's beads (drawn shapes), from empty stage
    marquee(930, 230, 900, 262)
    got = selected(); print("selected after the box:", got)
    if len(got) == 1: picked = (930, 230, got[0])
    print("picked:", picked, "row count:", nlayers)
    check("a drawn shape of the ear is picked", bool(picked), str(picked))
    layers_before = edit_now()
    key("Delete", "Delete", 46); time.sleep(2)
    after_edit = edit_now(); ks = [k for k in after_edit if k not in layers_before or after_edit[k] != layers_before.get(k)]
    print("changed layer edits:", {k: {f: after_edit[k].get(f) for f in ("deleted", "deletedProps")} for k in ks})
    rec = after_edit[ks[0]] if ks else {}
    gone = canvas()
    diff = sum(1 for p in ImageChops.difference(before, gone).convert("L").getdata() if p > 30)
    shot("2-after-delete")
    check("only part of the layer was taken out (deletedProps), not the layer", bool(rec.get("deletedProps")) and not rec.get("deleted"), json.dumps({f: rec.get(f) for f in ("deleted", "deletedProps")}))
    check("the rest of the ear (and the earring) is still there: the stage changed only a little", 0 < diff < 1500, f"{diff} px changed")
    # Cut with only part of a layer picked refuses (a copy holds whole layers), and changes nothing
    marquee(934, 247, 897, 268)
    for kind in ("rawKeyDown", "keyUp"): cmd("Input.dispatchKeyEvent", type=kind, key="x", code="KeyX", windowsVirtualKeyCode=88, modifiers=4)
    time.sleep(1.5)
    notice = js("(document.body.innerText.match(/Cut takes whole layers[^\\n]*/)||[''])[0]")
    cut_edit = edit_now().get(ks[0], {})
    check("Cut with part of a layer picked says so and changes nothing", bool(notice) and cut_edit.get("deletedProps") == rec.get("deletedProps") and not cut_edit.get("deleted"), notice[:70] + " | " + json.dumps(cut_edit.get("deletedProps")))
    # the badge on the layer row brings the removed shape back
    badge = js("(document.querySelector('[data-testid=restore-0]')||{}).textContent")
    check("the layer shows how many shapes were removed", (badge or "").strip().endswith(str(len(rec.get("deletedProps") or []))), f"{badge} for {len(rec.get('deletedProps') or [])} removed")
    js("document.querySelector('[data-testid=restore-0]').click()"); time.sleep(2)
    back = edit_now().get(ks[0]); restored = canvas()
    check("clicking it brings the shape back", not (back or {}).get("deletedProps"), json.dumps(back and back.get("deletedProps")))
    d2 = sum(1 for p in ImageChops.difference(before, restored).convert("L").getdata() if p > 30)
    check("and the ear looks as it did before the delete", d2 < 40, f"{d2} px differ")
    # a reload keeps it
    cmd("Page.navigate", url=f"http://localhost:3000/editor/{PROJECT}"); time.sleep(12)
    again = canvas(); nodiff = sum(1 for p in ImageChops.difference(restored, again).convert("L").getdata() if p > 30)
    check("after a reload the view matches the one before it", nodiff < 60, f"{nodiff} px differ")
finally:
    chrome.terminate()
print("FAILED:" if failed else "ALL PASSED", failed)
sys.exit(1 if failed else 0)
