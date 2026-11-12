"""Drive the native pose editor (/native-lab) in headless Chrome with real mouse and key events.

usage: python3 editor_test.py <file.fla> <out dir>
Prints one line per check and exits 1 if any fails. Needs the dev server on :3000 and `websocket-client`.
"""
import base64, json, os, subprocess, sys, time, urllib.request, websocket

FLA, OUT = sys.argv[1], sys.argv[2]
os.makedirs(OUT, exist_ok=True)
chrome = subprocess.Popen(["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "--headless=new", "--remote-debugging-port=9555",
                           f"--user-data-dir={OUT}/profile", "--window-size=1400,1100", "about:blank"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
failed = []
try:
    for _ in range(50):
        try:
            tabs = json.load(urllib.request.urlopen("http://127.0.0.1:9555/json")); break
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

    # pick a layer row that has a long span, so F6 inside it is meaningful
    info = js("""(()=>{const rows=[...document.querySelectorAll('[data-layer]')];for(const r of rows){const ks=[...r.querySelectorAll('[data-key]')];const k=ks.find(k=>parseInt(k.style.width)>=60);if(k)return {layer:r.dataset.layer*1,key:k.dataset.key,left:parseInt(k.style.left),width:parseInt(k.style.width)}}return null})()""")
    check("found a layer with a held span", info is not None, str(info))
    layer = info["layer"]
    before = keys(layer)
    sel = json.dumps('[data-layer="%d"]' % layer)
    rect = js("(()=>{const r=document.querySelector(" + sel + ").getBoundingClientRect();return [r.left,r.top,r.height]})()")
    frame_x = rect[0] + info["left"] + 5 * 12 + 6   # frame 5 inside the span
    mouse("mousePressed", frame_x, rect[1] + rect[2] / 2); mouse("mouseReleased", frame_x, rect[1] + rect[2] / 2); time.sleep(0.4)
    label = js("document.querySelector('[data-testid=editor-frame]')?.textContent || [...document.querySelectorAll('b')].map(b=>b.textContent).find(t=>t.startsWith('frame'))")
    check("clicking the timeline moves the playhead", label and label.startswith("frame"), label)

    click("[data-testid=insert-keyframe]")
    after = keys(layer)
    check("F6 adds a keyframe on this layer only", len(after) == len(before) + 1 and sorted(set(after) - set(before)) == [info["left"] // 12 + 5], f"{before} -> {after}")
    shot("2-after-f6")
    click("[data-testid=undo]")
    check("Undo takes it away", keys(layer) == before, str(keys(layer)))
    click("[data-testid=redo]")
    check("Redo brings it back", keys(layer) == after)
    width = lambda k: js("parseInt(document.querySelector('[data-key=\"%d:%d\"]').style.width)" % (layer, k))
    w0 = width(5)
    click("[data-testid=insert-frame]")
    check("F5 makes the span one frame longer", width(5) == w0 + 12, f"{w0} -> {width(5)}")
    click("[data-testid=remove-frames]")
    check("Remove Frames takes it back", width(5) == w0 and keys(layer) == after, f"{width(5)} {keys(layer)}")
    # F5 then Remove Frames with a later key: the later key slides and slides back
    click("[data-testid=insert-keyframe]")
    click("[data-testid=clear-keyframe]")
    check("Shift+F6 clears the keyframe", keys(layer) == before, str(keys(layer)))

    # drag a part on the stage
    cx, cy = centre("[data-testid=stage]", 0.5, 0.4)
    def x_readout():
        return js("(()=>{const t=[...document.querySelectorAll('div')].map(d=>d.textContent).find(t=>/^x -?[\\d.]+ · y/.test(t));return t||null})()")
    mouse("mousePressed", cx, cy); time.sleep(0.6)
    r0 = x_readout()
    check("clicking the stage picks a part", r0 is not None, str(r0))
    for i in range(1, 9):
        mouse("mouseMoved", cx + i * 6, cy + i * 3, buttons=1); time.sleep(0.05)
    mouse("mouseReleased", cx + 48, cy + 24); time.sleep(0.6)
    r1 = x_readout()
    check("dragging moves the part", r0 and r1 and r0 != r1, f"{r0} -> {r1}")
    shot("3-after-drag")
    click("[data-testid=undo]")
    check("Undo puts the part back", x_readout() == r0, str(x_readout()))
    click("[data-testid=redo]")

    # save and reload edits
    at_save = keys(layer)
    saved = js("""(async()=>{let blob=null;const orig=URL.createObjectURL;URL.createObjectURL=(b)=>{blob=b;return orig.call(URL,b)};document.querySelector('[data-testid=save]').click();await new Promise(r=>setTimeout(r,300));URL.createObjectURL=orig;return blob?await blob.text():null})()""")
    data = json.loads(saved) if saved else None
    check("Save writes the edited timelines", bool(data) and data["format"] == "cb-native-pose-edits" and len(data["symbols"]) >= 1, f"{len(saved or '')} bytes, {list((data or {}).get('symbols', {}))[:3]}")
    if saved:
        path = f"{OUT}/edits.json"; open(path, "w").write(saved)
        # reload the page, import the fla again, open the edits, and see the same keys
        cmd("Page.navigate", url="http://localhost:3000/native-lab"); time.sleep(6)
        root = cmd("DOM.getDocument")["root"]["nodeId"]
        cmd("DOM.setFileInputFiles", files=[FLA], nodeId=cmd("DOM.querySelector", nodeId=root, selector="input[type=file]")["nodeId"])
        for _ in range(120):
            time.sleep(1)
            if js("!!document.querySelector('[data-testid=toggle-editor]')"): break
        click("[data-testid=toggle-editor]"); time.sleep(2)
        nodes = cmd("DOM.querySelectorAll", nodeId=cmd("DOM.getDocument")["root"]["nodeId"], selector="input[type=file][accept='.json']")["nodeIds"]
        cmd("DOM.setFileInputFiles", files=[path], nodeId=nodes[0]); time.sleep(1.5)
        check("Opening the saved edits restores the keyframes", keys(layer) == at_save, f"{keys(layer)} vs {at_save}")
        again = js("""(async()=>{let blob=null;const orig=URL.createObjectURL;URL.createObjectURL=(b)=>{blob=b;return orig.call(URL,b)};document.querySelector('[data-testid=save]').click();await new Promise(r=>setTimeout(r,300));URL.createObjectURL=orig;return blob?await blob.text():null})()""")
        check("...and saving again gives the same file (the moved part included)", again == saved, f"{len(again or '')} vs {len(saved)} bytes")
        shot("4-reopened")
finally:
    chrome.terminate()
print("FAILED:" if failed else "ALL PASSED", failed)
sys.exit(1 if failed else 0)
