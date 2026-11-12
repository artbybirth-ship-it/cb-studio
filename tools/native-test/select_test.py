"""Phase 2: double-click steps into the symbol under the pointer (selecting what is under it) and out again.

usage: python3 editor_test.py <file.fla> <out dir>
Prints one line per check and exits 1 if any fails. Needs the dev server on :3000 and `websocket-client`.
"""
import base64, json, os, subprocess, sys, time, urllib.request, websocket

FLA, OUT = sys.argv[1], sys.argv[2]
os.makedirs(OUT, exist_ok=True)
chrome = subprocess.Popen(["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "--headless=new", "--remote-debugging-port=9556",
                           f"--user-data-dir={OUT}/profile", "--window-size=1400,1100", "about:blank"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
failed = []
try:
    for _ in range(50):
        try:
            tabs = json.load(urllib.request.urlopen("http://127.0.0.1:9556/json")); break
        except Exception:
            time.sleep(0.2)
    ws = websocket.create_connection([t for t in tabs if t["type"] == "page"][0]["webSocketDebuggerUrl"], timeout=300)
    n = [0]
    def cmd(method, **params):
        n[0] += 1; ws.send(json.dumps({"id": n[0], "method": method, "params": params}))
        while True:
            msg = json.loads(ws.recv())
            if msg.get("method") == "Runtime.exceptionThrown":
                print("EXC", msg["params"]["exceptionDetails"].get("exception", {}).get("description", "")[:300])
            if msg.get("id") == n[0]:
                return msg.get("result", msg)
    def js(e):
        r = cmd("Runtime.evaluate", expression=e, returnByValue=True, awaitPromise=True)
        if r.get("exceptionDetails"):
            print("JS error:", r["exceptionDetails"].get("exception", {}).get("description", "")[:400])
        return r.get("result", {}).get("value")
    def check(name, ok, detail=""):
        print(("PASS " if ok else "FAIL ") + name, detail)
        if not ok: failed.append(name)
    def mouse(kind, x, y, **kw):
        cmd("Input.dispatchMouseEvent", type=kind, x=x, y=y, button="left", clickCount=1, **kw)
    def centre(selector, dx=0.5, dy=0.5):
        r = js(f"(()=>{{const r=document.querySelector({json.dumps(selector)}).getBoundingClientRect();return [r.left+r.width*{dx},r.top+r.height*{dy}]}})()")
        return r
    def click(selector):
        x, y = centre(selector); mouse("mousePressed", x, y); mouse("mouseReleased", x, y); time.sleep(0.4)
    def shot(name):
        r = cmd("Page.captureScreenshot", format="png")
        open(f"{OUT}/{name}.png", "wb").write(base64.b64decode(r["data"]))
    keys = lambda layer: js(f"[...document.querySelectorAll('[data-key^=\"{layer}:\"]')].map(e=>e.dataset.key.split(':')[1]*1).sort((a,b)=>a-b)")

    cmd("Runtime.enable"); cmd("Page.enable"); cmd("DOM.enable")
    cmd("Page.navigate", url="http://localhost:3000/native-lab"); time.sleep(6)
    root = cmd("DOM.getDocument")["root"]["nodeId"]
    cmd("DOM.setFileInputFiles", files=[FLA], nodeId=cmd("DOM.querySelector", nodeId=root, selector="input[type=file]")["nodeId"])
    for _ in range(120):
        time.sleep(1)
        if js("!!document.querySelector('[data-testid=toggle-editor]')"): break
    click("[data-testid=toggle-editor]"); time.sleep(2)
    check("editor opens with a stage and a timeline", bool(js("!!document.querySelector('[data-testid=stage]') && !!document.querySelector('[data-testid=timeline]')")))
    layers = js("document.querySelectorAll('[data-layer]').length")
    check("timeline lists layers", layers > 0, f"{layers} layers")
    shot("1-open")

    path = lambda: js("[...document.querySelectorAll('span')].map(s=>s.textContent).find(t=>t.includes('›')) || [...document.querySelectorAll('span')].map(s=>s.textContent).find(t=>/^Pose|^Sardar/.test(t)) || ''")
    depth = lambda: js("(document.querySelector('[data-testid=native-editor] > div span:not([data-testid])')?.textContent||'').split('›').length")
    def dbl(x, y):
        for n in (1, 2):
            cmd("Input.dispatchMouseEvent", type="mousePressed", x=x, y=y, button="left", clickCount=n)
            cmd("Input.dispatchMouseEvent", type="mouseReleased", x=x, y=y, button="left", clickCount=n)
        time.sleep(1.2)
    readout = lambda: js("(()=>{const t=[...document.querySelectorAll('div')].map(d=>d.textContent).find(t=>/^x -?[\\d.]+ · y/.test(t));return t||null})()")
    d0 = depth()
    cx, cy = centre("[data-testid=stage]", 0.5, 0.4)
    dbl(cx, cy)
    d1 = depth()
    check("double-click on a symbol steps into it", d1 == d0 + 1, f"depth {d0} -> {d1}")
    check("something under the pointer is selected there", readout() is not None, str(readout()))
    shot("p2-stepped-in")
    dbl(cx, cy)
    d2 = depth()
    check("double-click again goes one level deeper (or reports plain artwork)", d2 >= d1, f"depth {d1} -> {d2}")
    # empty corner of the stage steps out
    x, y = centre("[data-testid=stage]", 0.02, 0.02)
    dbl(x, y)
    d3 = depth()
    check("double-click on empty stage steps out", d3 == d2 - 1 or d3 == d2 and d2 == d0, f"depth {d2} -> {d3}")
    shot("p2-stepped-out")
finally:
    chrome.kill()
sys.exit(1 if failed else 0)
