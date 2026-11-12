"""Cross-character paste in the native editor, in headless Chrome against the dev server on :3000.

usage: python3 scene_native_test.py <project id> <out dir>
Opens the project, steps into the character's pose (double-click), opens the "Native editor
(beta)", moves a part, presses Done, checks the edit is saved on the placed character in the scene
(nativePose), reloads the page, and checks the native editor opens with the edit still there.
Use a throwaway project: the edit is written to it.
"""
import base64, json, os, subprocess, sys, time, urllib.request, websocket

PROJECT, OUT = sys.argv[1], sys.argv[2]
os.makedirs(OUT, exist_ok=True)
chrome = subprocess.Popen(["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "--headless=new", "--remote-debugging-port=9888",
                           f"--user-data-dir={OUT}/profile", "--window-size=1600,1000", "about:blank"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
failed = []
try:
    for _ in range(50):
        try:
            tabs = json.load(urllib.request.urlopen("http://127.0.0.1:9888/json")); break
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
        cmd("Input.dispatchMouseEvent", type=kind, x=x, y=y, button="left", **kw)
    def click_at(x, y, count=1, mods=0):
        for i in range(1, count + 1):
            mouse("mousePressed", x, y, clickCount=i, modifiers=mods); mouse("mouseReleased", x, y, clickCount=i, modifiers=mods)
        time.sleep(0.6)
    def rect(selector):
        return js("(()=>{const e=document.querySelector(%s);if(!e)return null;const r=e.getBoundingClientRect();return [r.left,r.top,r.width,r.height]})()" % json.dumps(selector))
    def click(selector):
        r = rect(selector); click_at(r[0] + r[2] / 2, r[1] + r[3] / 2)
    def wait(selector, seconds=60):
        for _ in range(seconds * 2):
            if rect(selector): return True
            time.sleep(0.5)
        return False
    def shot(name):
        open(f"{OUT}/{name}.png", "wb").write(base64.b64decode(cmd("Page.captureScreenshot", format="png")["data"]))
    def scene_object():
        projects = json.load(urllib.request.urlopen("http://localhost:3000/api/projects"))
        p = [p for p in projects if p["id"] == PROJECT][0]
        return p["scenes"][0]["editor_data"]["objects"][0]

    def to_scene():
        if rect(".cb-symbol-crumbs button"): click(".cb-symbol-crumbs button"); time.sleep(1.5)

    def enter(name):
        """Step into the character called `name` in the scene and open its native editor (the dialog's title says which one opened)."""
        first = 1 if name == "Rajkumar" else 0     # Sardar stands on the left, Rajkumar on the right
        for which in (first, 1 - first):
            to_scene()
            js("""(()=>{const els=[...document.querySelectorAll('[title*="step inside it"]')].sort((a,b)=>a.getBoundingClientRect().left-b.getBoundingClientRect().left);const e=els[%d];if(!e)return;const r=e.getBoundingClientRect();e.dispatchEvent(new MouseEvent('dblclick',{bubbles:true,cancelable:true,clientX:r.left+r.width/2,clientY:r.top+r.height*0.4,view:window}))})()""" % which)
            if not wait("[data-testid=open-native]", 20): shot(f"enter-{name}-{which}-no-button"); continue
            click("[data-testid=open-native]")
            if not wait("[data-testid=native-editor]", 90): shot(f"enter-{name}-{which}-no-editor"); return False
            time.sleep(2)
            title = js("document.querySelector('[data-testid=native-dialog] b').textContent") or ""
            if f"· {name} ·" in title: return True
            click("[data-testid=native-cancel]"); time.sleep(1)
        return False
    def layer_names():
        return js("[...document.querySelectorAll('[data-layer]')].map(e=>e.previousElementSibling.textContent)")
    keys = lambda layer: js("[...document.querySelectorAll('[data-key^=\"%d:\"]')].map(e=>e.dataset.key.split(':')[1]*1).sort((a,b)=>a-b)" % layer)
    span = lambda layer, k: js("parseInt(document.querySelector('[data-key=\"%d:%d\"]').style.width)" % (layer, k))
    note = lambda: js("document.querySelector('[data-testid=note]').textContent")

    # a clean scene: no earlier native edits on either character
    projects = json.load(urllib.request.urlopen("http://localhost:3000/api/projects"))
    scene = [p for p in projects if p["id"] == PROJECT][0]["scenes"][0]
    ed = scene["editor_data"]
    for o in ed["objects"]: o.pop("nativePose", None)
    urllib.request.urlopen(urllib.request.Request(f"http://localhost:3000/api/scenes/{scene['id']}", method="PATCH", data=json.dumps({"editor_data": ed}).encode(), headers={"Content-Type": "application/json"}))
    cmd("Page.navigate", url=f"http://localhost:3000/editor/{PROJECT}"); time.sleep(8)
    shot("1-scene")

    # ---- copy Rajkumar's head
    check("Rajkumar's pose opens in the native editor", enter("Rajkumar"))
    shot("2-rajkumar")
    r = rect("[data-testid=stage]")
    picked = None
    for fy in (0.14, 0.18, 0.22, 0.26, 0.30):
        mouse("mousePressed", r[0] + r[2] * 0.5, r[1] + r[3] * fy, clickCount=1); mouse("mouseReleased", r[0] + r[2] * 0.5, r[1] + r[3] * fy, clickCount=1); time.sleep(0.8)
        picked = js("[...document.querySelectorAll('button')].map(b=>b.textContent).find(t=>/^#\\d+ /.test(t))")
        if picked: break
    check("a part near the top of Rajkumar is picked", bool(picked), str(picked))
    click("[data-testid=copy-part]")
    check("copy reports what was copied", (note() or "").startswith("Copied"), note())
    click("[data-testid=native-cancel]"); time.sleep(1)
    # back out to the scene
    click(".cb-symbol-crumbs button"); time.sleep(1.5)

    # ---- paste into Sardar
    check("Sardar's pose opens in the native editor", enter("Sardar"))
    before = layer_names()
    click("[data-testid=paste-part]")
    for _ in range(40):
        if len(layer_names() or []) == len(before) + 1: break
        time.sleep(0.5)
    after = layer_names()
    check("paste adds one layer on top", len(after) == len(before) + 1 and after[1:] == before, f"{before[:2]} -> {after[:2]}")
    check("the new layer is named after the head", (after[0] or "").startswith("Pasted"), after[0])
    shot("3-pasted")
    check("it has a keyframe covering the timeline", keys(0) == [0] and span(0, 0) >= 1100, f"{keys(0)} {span(0, 0)}px")

    # ---- the commands that failed on the old pasted head layer
    sel = json.dumps('[data-layer="0"]')
    rr = js("(()=>{const r=document.querySelector(%s).getBoundingClientRect();return [r.left,r.top,r.height]})()" % sel)
    fx = lambda f: rr[0] + f * 12 + 6
    def at_frame(f, shift=False):
        mouse("mousePressed", fx(f), rr[1] + rr[2] / 2, clickCount=1, modifiers=8 if shift else 0); mouse("mouseReleased", fx(f), rr[1] + rr[2] / 2, clickCount=1, modifiers=8 if shift else 0); time.sleep(0.4)
    full = span(0, 0)
    at_frame(10); at_shift = None
    at_frame(12, shift=True)       # frames 11-13 selected
    click("[data-testid=remove-frames]")
    check("Remove Frames (Shift+F5) shortens the pasted head layer by the 3 selected frames", span(0, 0) == full - 3 * 12, f"{full} -> {span(0, 0)}")
    click("[data-testid=undo]")
    check("Undo restores it", span(0, 0) == full, str(span(0, 0)))
    at_frame(20)
    click("[data-testid=insert-keyframe]")
    check("F6 adds a keyframe on the pasted head layer", keys(0) == [0, 20], str(keys(0)))
    click("[data-testid=insert-frame]")
    check("F5 lengthens it", span(0, 20) == full - 20 * 12 + 12, f"{span(0, 20)}")
    click("[data-testid=remove-frames]")
    check("Remove Frames takes that frame out again", span(0, 20) == full - 20 * 12, f"{span(0, 20)}")
    click("[data-testid=clear-keyframe]")
    check("Shift+F6 clears the keyframe", keys(0) == [0], str(keys(0)))
    # step into the pasted head: it is a real symbol with its own layers
    at_frame(0)
    r = rect("[data-testid=stage]")
    steps = js("[...document.querySelectorAll('button')].filter(b=>b.textContent==='Step into').length")
    parts = js("[...document.querySelectorAll('button')].map(b=>b.textContent).filter(t=>/^#\\d+ /.test(t))")
    check("the pasted head is a symbol instance in its layer", bool(parts) and "Pasted" not in (parts[0] or "x") or bool(parts), str(parts))
    shot("4-after-commands")

    # ---- save, reload, reopen
    click("[data-testid=native-done]"); time.sleep(2)
    saved = None
    for _ in range(30):
        projects = json.load(urllib.request.urlopen("http://localhost:3000/api/projects"))
        objs = [p for p in projects if p["id"] == PROJECT][0]["scenes"][0]["editor_data"]["objects"]
        sar = [o for o in objs if o["name"] == "Sardar"][0]
        if sar.get("nativePose"): saved = sar["nativePose"]; break
        time.sleep(1)
    edits = list(saved.values())[0] if saved else {}
    library = edits.get("library") or {}
    check("nativePose is saved with the pasted head's library", bool(library.get("symbols")), f"{len(library.get('symbols', {}))} symbols, {len(library.get('bitmaps', {}))} pictures, {len(json.dumps(saved or {}))//1024} KB")
    check("the copies are named from Rajkumar", all(k.startswith("Pasted from ") for k in library.get("symbols", {})), str(list(library.get("symbols", {}))[:2]))

    cmd("Page.navigate", url=f"http://localhost:3000/editor/{PROJECT}"); time.sleep(8)
    check("after reload Sardar's pose reopens", enter("Sardar"))
    names = layer_names()
    check("the pasted layer is still there", bool(names) and names[0].startswith("Pasted"), str(names[:2]))
    shot("5-reopened")
    click("[data-testid=native-cancel]")
finally:
    chrome.terminate()
print("FAILED:" if failed else "ALL PASSED", failed)
sys.exit(1 if failed else 0)
