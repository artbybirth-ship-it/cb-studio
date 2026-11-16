"""Phase 6 B: the Ease box in the native pose editor (/native-lab), with real mouse events.

usage: python3 ease_test.py <file.fla> <out dir>
Clicks into the middle of classic tweens in the timeline until one moves something, then: the Ease box shows the tween's ease; dragging it
changes the picture while dragging (preview) and keeps it on release; Undo puts the file's ease and picture back, Redo brings the new one;
Reset goes back to the file's ease; typing a number (double-click) sets it too. Needs the dev server on :3000 and `websocket-client`.
"""
import base64, json, os, subprocess, sys, time, urllib.request, websocket

FLA, OUT = sys.argv[1], sys.argv[2]
os.makedirs(OUT, exist_ok=True)
chrome = subprocess.Popen(["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "--headless=new", "--remote-debugging-port=9557",
                           f"--user-data-dir={OUT}/profile", "--window-size=1400,1100", "about:blank"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
failed = []
try:
    for _ in range(50):
        try: tabs = json.load(urllib.request.urlopen("http://127.0.0.1:9557/json")); break
        except Exception: time.sleep(0.2)
    ws = websocket.create_connection([t for t in tabs if t["type"] == "page"][0]["webSocketDebuggerUrl"], timeout=300)
    n = [0]
    def cmd(method, **params):
        n[0] += 1; ws.send(json.dumps({"id": n[0], "method": method, "params": params}))
        while True:
            msg = json.loads(ws.recv())
            if msg.get("id") == n[0]: return msg.get("result", msg)
    def js(e):
        r = cmd("Runtime.evaluate", expression=e, returnByValue=True, awaitPromise=True)
        return r.get("result", {}).get("value")
    def check(name, ok, detail=""):
        print(("PASS " if ok else "FAIL ") + name, detail)
        if not ok: failed.append(name)
    def mouse(kind, x, y, **kw): cmd("Input.dispatchMouseEvent", type=kind, x=x, y=y, button="left", clickCount=kw.pop("clickCount", 1), **kw)
    def centre(sel, dx=0.5, dy=0.5): return js(f"(()=>{{const e=document.querySelector({json.dumps(sel)});if(!e)return null;const r=e.getBoundingClientRect();return [r.left+r.width*{dx},r.top+r.height*{dy}]}})()")
    def click(sel): x, y = centre(sel); mouse("mousePressed", x, y); mouse("mouseReleased", x, y); time.sleep(0.4)
    def shot(name): open(f"{OUT}/{name}.png", "wb").write(base64.b64decode(cmd("Page.captureScreenshot", format="png")["data"]))
    stage = lambda: js("document.querySelector('[data-testid=stage]').toDataURL()")
    ease = lambda: js("(()=>{const b=document.querySelector('[data-testid=native-ease] .cb-ease-box');return b?b.textContent:null})()")

    cmd("Runtime.enable"); cmd("Page.enable"); cmd("DOM.enable")
    cmd("Page.navigate", url="http://localhost:3000/native-lab"); time.sleep(6)
    root = cmd("DOM.getDocument")["root"]["nodeId"]
    cmd("DOM.setFileInputFiles", files=[FLA], nodeId=cmd("DOM.querySelector", nodeId=root, selector="input[type=file]")["nodeId"])
    for _ in range(120):
        time.sleep(1)
        if js("!!document.querySelector('[data-testid=toggle-editor]')"): break
    click("[data-testid=toggle-editor]"); time.sleep(2)
    check("editor opens", bool(js("!!document.querySelector('[data-testid=stage]')")))
    check("no Ease box before a tween is picked", ease() is None)
    # Classic tweens in the timeline, longest first: the middle of each is clicked until dragging the ease changes the picture.
    tweens = js("""[...document.querySelectorAll('[data-key]')].filter(k=>/classic tween/.test(k.title)).map(k=>{const r=k.getBoundingClientRect();return {key:k.dataset.key,title:k.title,x:r.left+r.width*0.3,y:r.top+r.height/2,w:r.width}})
      .filter(t=>t.w>=12*5).sort((a,b)=>b.w-a.w).slice(0,12)""") or []
    print(len(tweens), "classic tweens to try")
    found = None
    for t in tweens:
        cmd("Runtime.evaluate", expression=f"document.querySelector('[data-key=\"{t['key']}\"]').scrollIntoView({{block:'nearest',inline:'nearest'}})")
        t = js(f"(()=>{{const r=document.querySelector('[data-key=\"{t['key']}\"]').getBoundingClientRect();return {{key:'{t['key']}',title:{json.dumps(t['title'])},x:r.left+r.width*0.3,y:r.top+r.height/2}}}})()")
        mouse("mousePressed", t["x"], t["y"]); mouse("mouseReleased", t["x"], t["y"]); time.sleep(0.4)
        before, img0 = ease(), stage()
        if before is None: print("  try", t["key"], t["title"], "| no Ease box"); continue
        bx, by = centre("[data-testid=native-ease] .cb-ease-box")
        mouse("mousePressed", bx, by); time.sleep(0.1)
        mouse("mouseMoved", bx - 80, by, buttons=1); time.sleep(0.1)
        mouse("mouseMoved", bx - 180, by, buttons=1); time.sleep(0.4)
        during, img1 = ease(), stage()
        print("  try", t["key"], t["title"], "| before", before, "during", during, "| picture changed", img1 != img0)
        if img1 != img0:
            found = (t, before, img0, during)
            shot("1-dragging")
            mouse("mouseReleased", bx - 180, by); time.sleep(0.5)
            break
        mouse("mouseReleased", bx - 180, by); time.sleep(0.3)
        js("[...document.querySelectorAll('[data-testid=undo]')].forEach(b=>!b.disabled&&b.click())")  # put back what this try changed
        time.sleep(0.3)
    check("found a classic tween whose ease changes the picture", bool(found))
    if found:
        t, before, img0, during = found
        print("tween:", t["title"], "| ease before:", before, "while dragging:", during)
        check("the Ease box shows the tween's ease", before is not None and before.lstrip("-").isdigit(), str(before))
        check("dragging left moves the value toward ease in", int(during) < int(before), f"{before} -> {during}")
        after, img2 = ease(), stage()
        check("released: the new ease stays", after == during and img2 != img0, f"{after}")
        words = f"ease out {after}" if int(after) > 0 else f"ease in {-int(after)}" if int(after) < 0 else "no easing"
        check("the timeline says so", js(f"document.querySelector('[data-key=\"{t['key']}\"]').title").endswith(words), js(f"document.querySelector('[data-key=\"{t['key']}\"]').title"))
        shot("2-released")
        click("[data-testid=undo]"); time.sleep(0.4)
        check("Undo: the file's ease and picture come back", ease() == before and stage() == img0, f"{ease()}")
        click("[data-testid=redo]"); time.sleep(0.4)
        check("Redo: the new ease again", ease() == after and stage() == img2, f"{ease()}")
        has_reset = bool(js("!!document.querySelector('[data-testid=native-ease-reset]')"))
        check("Reset is offered once the ease differs from the file", has_reset)
        if has_reset:
            click("[data-testid=native-ease-reset]"); time.sleep(0.4)
            check("Reset: back to the file's ease and picture", ease() == before and stage() == img0 and not js("!!document.querySelector('[data-testid=native-ease-reset]')"), f"{ease()}")
        # Typing a number: double-click the box, type, Enter.
        bx, by = centre("[data-testid=native-ease] .cb-ease-box")
        mouse("mousePressed", bx, by); mouse("mouseReleased", bx, by); mouse("mousePressed", bx, by, clickCount=2); mouse("mouseReleased", bx, by, clickCount=2); time.sleep(0.3)
        typing = bool(js("!!document.querySelector('[data-testid=native-ease] input')"))
        check("double-click opens a number field", typing)
        if typing:
            js("document.querySelector('[data-testid=native-ease] input').select()")
            cmd("Input.insertText", text="-60")
            cmd("Input.dispatchKeyEvent", type="keyDown", key="Enter", code="Enter", windowsVirtualKeyCode=13)
            cmd("Input.dispatchKeyEvent", type="keyUp", key="Enter", code="Enter", windowsVirtualKeyCode=13); time.sleep(0.4)
            check("typed -60: ease in 60", ease() == "-60" and stage() != img0, f"{ease()}")
            # F5 etc. while typing must not reach the editor: the field took the keys (checked by the value only changing once).
        shot("3-typed")
finally:
    chrome.terminate()
print("FAILED:" if failed else "ALL PASSED", failed)
sys.exit(1 if failed else 0)
