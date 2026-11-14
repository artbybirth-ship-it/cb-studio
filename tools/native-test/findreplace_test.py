"""Find and Replace colour on the old editor's pasted head (a clone of another character's head), via the real dialog.

usage: python3 findreplace_test.py <throwaway project id> <out dir> <source project id> <find hex> <replace hex>
Copies the first character of <source project id> (with its pasted/clone parts) into the throwaway scene, opens Find and Replace
(Shift+Cmd+F), enters the two colours and presses Replace, and reports the dialog's message and the colour rules saved.
"""
import base64, json, os, subprocess, sys, time, urllib.request, websocket

PROJECT, OUT = sys.argv[1], sys.argv[2]
SOURCE, FIND, REPL = sys.argv[3], sys.argv[4], sys.argv[5]
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

    src = [p for p in json.load(urllib.request.urlopen("http://localhost:3000/api/projects")) if p["id"] == SOURCE][0]["scenes"][0]["editor_data"]
    sc = scene(); ed = json.loads(json.dumps(sc["editor_data"]))
    ed["objects"] = [json.loads(json.dumps(src["objects"][0]))]
    ed["objects"][0].pop("nativePose", None); ed["objects"][0].pop("colorReplacements", None)
    patch(sc, ed)
    cmd("Page.navigate", url=f"http://localhost:3000/editor/{PROJECT}"); time.sleep(10)
    shot("1-scene")
    if len(sys.argv) > 6 and sys.argv[6] == "inside":
        js("""(()=>{const e=document.querySelector('[title*="step inside it"]');const r=e.getBoundingClientRect();e.dispatchEvent(new MouseEvent('dblclick',{bubbles:true,cancelable:true,clientX:r.left+r.width/2,clientY:r.top+r.height*0.4,view:window}))})()""")
        time.sleep(3); shot("1b-inside")
        print("CRUMBS:", js("[...document.querySelectorAll('.cb-symbol-crumbs button')].map(b=>b.textContent)"))
    if len(sys.argv) > 6 and sys.argv[6] == "inside" and FIND == "debug":
        print("ELEMENTS:", js("""(()=>{const pts=[[835,215],[835,230]];return pts.map(([x,y])=>document.elementsFromPoint(x,y).slice(0,8).map(e=>e.tagName+'.'+(e.className&&e.className.baseVal===undefined?String(e.className).slice(0,40):'')+(e.getAttribute('data-editor-object-id')?'[obj]':'')+(e.closest('[data-editor-object-id]')?'(in obj)':'')))})()"""))
        print("IFRAMES:", js("[...document.querySelectorAll('iframe')].map(f=>[f.className.slice(0,40), JSON.stringify(f.getBoundingClientRect()), getComputedStyle(f).opacity, getComputedStyle(f).pointerEvents])"))
        raise SystemExit(0)
    for kind in ("rawKeyDown", "keyUp"): cmd("Input.dispatchKeyEvent", type=kind, key="F", code="KeyF", windowsVirtualKeyCode=70, modifiers=12)
    time.sleep(1.5)
    check("Find and Replace opens", bool(rect(".cb-fr-dialog")))
    def set_colour(label, hexv):
        click(f"[aria-label^='{label}:']"); time.sleep(0.6)
        js("""((v)=>{const i=document.querySelector("input[aria-label='Colour code']");const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;set.call(i,v);i.dispatchEvent(new Event('input',{bubbles:true}))})(%s)""" % json.dumps(hexv.lstrip("#")))
        time.sleep(0.5)
    if FIND == "pick-both":
        # the real flow, stepped into the pose: eyedrop the head (Find), eyedrop the jacket (Replace), press Replace
        px, py = (835, 215), (760, 420)
        lbl = lambda: js("[...document.querySelectorAll('.cb-fr-swatch')].map(b=>b.getAttribute('aria-label'))")
        pip = js("[...document.querySelectorAll('.cb-fr-pipette')].length")
        click(".cb-fr-colour:nth-of-type(1) .cb-fr-pipette"); time.sleep(0.4); click_at(*px); time.sleep(1.2)
        got_find = lbl()[0].split(": ")[1]
        check("the eyedropper picks the head's colour while stepped into the pose", got_find == "#fbb057", got_find)
        click(".cb-fr-colour:nth-of-type(2) .cb-fr-pipette"); time.sleep(0.4); click_at(*py); time.sleep(1.2)
        got_rep = lbl()[1].split(": ")[1]
        check("and the colour to replace with, from the jacket", got_rep not in ("#ffffff", "#93562a") and got_rep != got_find, got_rep)
        js("document.querySelector('.cb-fr-replace').click()"); time.sleep(4)
        status = js("(document.querySelector('.cb-fr-status')||{}).textContent")
        got = [p for p in json.load(urllib.request.urlopen("http://localhost:3000/api/projects")) if p["id"] == PROJECT][0]["scenes"][0]["editor_data"]["objects"][0].get("colorReplacements") or []
        check("Replace saves the rule", not status and any(r["from"] == got_find and r["to"] == got_rep for r in got), str(status or got))
        shot("4-pick-both")
        chrome.terminate(); print("FAILED:" if failed else "ALL PASSED", failed); sys.exit(1 if failed else 0)
    if FIND == "pick":
        r0 = rect("[data-editor-object-id]") if len(sys.argv) <= 6 else rect("[data-editor-object-id]")
        print("OBJECT RECT:", r0)
        if len(sys.argv) > 6:
            for px, py in ((835, 215), (830, 235), (845, 245), (822, 205), (850, 228)):
                click(".cb-fr-pipette"); time.sleep(0.4)
                click_at(px, py); time.sleep(1.2)
                print("PICK px", px, py, "->", js("[...document.querySelectorAll('.cb-fr-swatch')].map(b=>b.getAttribute('aria-label'))"))
            shot("2-picked"); raise SystemExit(0)
        for fx, fy in ((0.5, 0.14), (0.45, 0.18), (0.55, 0.2), (0.5, 0.1), (0.42, 0.14), (0.58, 0.16)):
            click(".cb-fr-pipette"); time.sleep(0.4)
            click_at(r0[0] + r0[2] * fx, r0[1] + r0[3] * fy); time.sleep(1.2)
            print("PICK at", fx, fy, "->", js("[...document.querySelectorAll('.cb-fr-swatch')].map(b=>b.getAttribute('aria-label'))"))
        shot("2-picked")
        raise SystemExit(0)
    set_colour("Find colour", FIND); set_colour("Replace with", REPL)
    print("SWATCHES:", js("[...document.querySelectorAll('.cb-fr-swatch')].map(b=>b.getAttribute('aria-label'))"))
    shot("2-dialog")
    js("document.querySelector('.cb-fr-replace').click()"); time.sleep(4)
    status = js("(document.querySelector('.cb-fr-status')||{}).textContent")
    print("STATUS:", status)
    shot("3-after")
    got = [p for p in json.load(urllib.request.urlopen("http://localhost:3000/api/projects")) if p["id"] == PROJECT][0]["scenes"][0]["editor_data"]["objects"][0].get("colorReplacements")
    print("RULES:", got)
    check("it replaced something (the dialog closes and the rule is saved)", not status and any(r["from"] == FIND.lower() and r["to"] == REPL.lower() for r in (got or [])), str(status or got))
finally:
    chrome.terminate()
print("FAILED:" if failed else "ALL PASSED", failed)
sys.exit(1 if failed else 0)
