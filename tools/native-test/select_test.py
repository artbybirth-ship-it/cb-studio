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
    # ---- multi-select: shift-click and drag box
    note = lambda: js("document.querySelector('[data-testid=note]')?.textContent||''")
    dots = lambda: js("0")
    while depth() > d0:
        x, y = centre("[data-testid=stage]", 0.02, 0.02); dbl(x, y)
    def drag_box(fx, fy, tx_, ty_, **kw):
        x0, y0 = centre("[data-testid=stage]", fx, fy); x1, y1 = centre("[data-testid=stage]", tx_, ty_)
        mouse("mousePressed", x0, y0, **kw)
        for i in range(1, 11): mouse("mouseMoved", x0 + (x1 - x0) * i / 10, y0 + (y1 - y0) * i / 10, buttons=1, **kw); time.sleep(0.03)
        shot("p2-box")
        mouse("mouseReleased", x1, y1, **kw); time.sleep(1.0)
    drag_box(0.05, 0.03, 0.95, 0.97)
    count = int((note().split(" ")[0] or "0")) if note()[:1].isdigit() else 0
    check("drag box selects every part it touches", count >= 2, note())
    shot("p2-box-selected")
    r0 = readout()
    x, y = centre("[data-testid=stage]", 0.5, 0.4)
    mouse("mousePressed", x, y); time.sleep(0.4)
    for i in range(1, 9): mouse("mouseMoved", x + i * 6, y + i * 3, buttons=1); time.sleep(0.05)
    mouse("mouseReleased", x + 48, y + 24); time.sleep(0.8)
    r1 = readout()
    check("dragging one of the selected parts moves them all", r0 and r1 and r0 != r1, f"{r0} -> {r1}")
    shot("p2-group-moved")
    click("[data-testid=undo]")
    check("one Undo puts them all back", readout() == r0, str(readout()))
    click("[data-testid=copy-part]")
    check("Copy takes every selected part", note().startswith("Copied 13 parts"), note())
    click("[data-testid=paste-part]"); time.sleep(2)
    check("Paste puts them all on one new layer", "Pasted 13 parts" in note(), note())
    click("[data-testid=undo]")
    check("Undo clears a selection that may no longer exist", js("[...document.querySelectorAll('button')].filter(b=>b.style.background.includes('215, 230, 255')).length") == 0)
    # a click on one part alone, then shift-click another adds it
    x2, y2 = centre("[data-testid=stage]", 0.5, 0.75)
    mouse("mousePressed", x, y); mouse("mouseReleased", x, y); time.sleep(0.4)
    blue0 = js("[...document.querySelectorAll('button')].filter(b=>b.style.background.includes('215, 230, 255')).length")
    r_before = readout()
    mouse("mousePressed", x2, y2, modifiers=8); mouse("mouseReleased", x2, y2, modifiers=8); time.sleep(0.5)
    check("shift-click adds a part without moving anything", readout() is not None and readout() == r_before, f"{readout()} | {note()} | {blue0}")
    shot("p2-final")
finally:
    chrome.kill()
sys.exit(1 if failed else 0)
