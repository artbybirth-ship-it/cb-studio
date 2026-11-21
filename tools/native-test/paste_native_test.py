"""Cross-character paste in the native editor, in headless Chrome against the dev server on :3000.

usage: python3 scene_native_test.py <project id> <out dir>
Opens the project, steps into the character's pose (double-click), opens the "Native editor
(beta)", moves a part, presses Done, checks the edit is saved on the placed character in the scene
(nativePose), reloads the page, and checks the native editor opens with the edit still there.
Use a throwaway project: the edit is written to it.
"""
import base64, json, os, subprocess, sys, time, urllib.request, websocket
from pose_view import empty_spot, pose_point, pose_rect

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
    def crumbs():
        return js("[...document.querySelectorAll('.cb-symbol-crumbs span')].map(s=>s.textContent.replace('›','').trim())") or []

    def enter(name):
        """Step into the character called `name` in the scene; its pose opens in place (the timeline panel's breadcrumb says which one)."""
        first = 1 if name == "Rajkumar" else 0     # Sardar stands on the left, Rajkumar on the right
        for which in (first, 1 - first):
            to_scene()
            js("""(()=>{const els=[...document.querySelectorAll('[title*="step inside it"]')].sort((a,b)=>a.getBoundingClientRect().left-b.getBoundingClientRect().left);const e=els[%d];if(!e)return;const r=e.getBoundingClientRect();e.dispatchEvent(new MouseEvent('dblclick',{bubbles:true,cancelable:true,clientX:r.left+r.width/2,clientY:r.top+r.height*0.4,view:window}))})()""" % which)
            if not wait("[data-testid=native-editor] [data-testid=stage]", 90): shot(f"enter-{name}-{which}-no-stage"); continue
            if not wait(".cb-symbol-timeline [data-symbol-row]", 30): shot(f"enter-{name}-{which}-no-panel"); return False
            time.sleep(2)
            c = crumbs()
            if len(c) > 1 and c[1].startswith(name): return True
            to_scene()
        return False
    PANEL = ".cb-symbol-timeline"
    def layer_names():
        return js(f"[...document.querySelectorAll('{PANEL} [data-symbol-row] .cb-symbol-layer-name')].map(e=>e.textContent)")
    def frames_of(row):
        """A row's keyframes as the panel draws them: {first frame: frames}."""
        return {a: b for a, b in (js(f"""(()=>{{const c=parseFloat(getComputedStyle(document.querySelector('{PANEL}')).getPropertyValue('--cb-sym-cell'));
          return [...document.querySelectorAll('[data-symbol-row="{row}"] .cb-symbol-span')].map(s=>[Math.round(parseFloat(s.style.left)/c),Math.round(parseFloat(s.style.width)/c)])}})()""") or [])}
    keys = lambda row: sorted(frames_of(row))
    span = lambda row, k: frames_of(row).get(k)
    note = lambda: js("document.querySelector('[data-testid=native-editor]')?.dataset.note || ''")
    def press_keys(k, code, vk, mods=0):
        js("document.activeElement && document.activeElement.blur()")
        cmd("Input.dispatchKeyEvent", type="keyDown", key=k, code=code, windowsVirtualKeyCode=vk, modifiers=mods); cmd("Input.dispatchKeyEvent", type="keyUp", key=k, code=code, windowsVirtualKeyCode=vk, modifiers=mods); time.sleep(0.8)
    def frame_xy(row, f):
        """Frame f of a row on screen, the grid scrolled so that it is clear of the layer names."""
        return js(f"""(()=>{{const lane=document.querySelector('[data-symbol-row="{row}"] .cb-symbol-lane');const box=document.querySelector('.cb-symbol-grid');
          const c=parseFloat(getComputedStyle(document.querySelector('{PANEL}')).getPropertyValue('--cb-sym-cell'));lane.scrollIntoView({{block:'nearest'}});
          const g=box.getBoundingClientRect(), x=lane.getBoundingClientRect().left+({f}+0.5)*c;
          if(x<g.left+260)box.scrollLeft-=g.left+300-x; else if(x>g.left+box.clientWidth-40)box.scrollLeft+=x-(g.left+box.clientWidth-120);
          const r=lane.getBoundingClientRect();return [r.left+({f}+0.5)*c,r.top+r.height/2]}})()""")

    # a clean scene: no earlier native edits on either character
    projects = json.load(urllib.request.urlopen("http://localhost:3000/api/projects"))
    scene = [p for p in projects if p["id"] == PROJECT][0]["scenes"][0]
    ed = scene["editor_data"]
    for o in ed["objects"]: o.pop("nativePose", None)
    urllib.request.urlopen(urllib.request.Request(f"http://localhost:3000/api/scenes/{scene['id']}", method="PATCH", data=json.dumps({"editor_data": ed}).encode(), headers={"Content-Type": "application/json"}))
    cmd("Page.navigate", url="http://localhost:3000/"); time.sleep(1)
    js("Object.keys(localStorage).filter(k=>k.startsWith('cb-')).forEach(k=>localStorage.removeItem(k))")
    cmd("Page.navigate", url=f"http://localhost:3000/editor/{PROJECT}"); time.sleep(8)
    shot("1-scene")

    # ---- copy Rajkumar's head (⌘C on a part picked on the stage)
    check("Rajkumar's pose opens in place", enter("Rajkumar"))
    shot("2-rajkumar")
    r = pose_rect(js)
    picked = None
    for fy in (0.14, 0.18, 0.22, 0.26, 0.30):
        mouse("mousePressed", r[0] + r[2] * 0.5, r[1] + r[3] * fy, clickCount=1); mouse("mouseReleased", r[0] + r[2] * 0.5, r[1] + r[3] * fy, clickCount=1); time.sleep(0.8)
        picked = js("document.querySelector('[data-testid=native-editor]').dataset.picked")
        if picked: break
    check("a part near the top of Rajkumar is picked", bool(picked), str(picked))
    press_keys("c", "KeyC", 67, 4)
    check("⌘C reports what was copied", note().startswith("Copied"), note())
    to_scene()

    # ---- paste into Sardar (⌘V on the stage)
    check("Sardar's pose opens in place", enter("Sardar"))
    before = layer_names()
    press_keys("v", "KeyV", 86, 4)
    for _ in range(40):
        if len(layer_names() or []) == len(before) + 1: break
        time.sleep(0.5)
    after = layer_names()
    check("paste adds one layer on top", len(after) == len(before) + 1 and after[1:] == before, f"{before[:2]} -> {after[:2]}")
    check("the new layer is named after the head", (after[0] or "").startswith("Pasted"), after[0])
    shot("3-pasted")
    full = span(0, 0)
    check("it has a keyframe covering the timeline", keys(0) == [0] and (full or 0) >= 90, f"{keys(0)} {full} frames")

    # ---- the frame commands on the pasted head layer: frames selected in the panel, then the keys
    def at_frame(f, shift=False):
        x, y = frame_xy(0, f); click_at(x, y, mods=8 if shift else 0)
    at_frame(10); at_frame(12, shift=True)       # frames 11-13 selected
    press_keys("F5", "F5", 116, 8)
    check("Remove Frames (⇧F5) shortens the pasted head layer by the 3 selected frames", span(0, 0) == full - 3, f"{full} -> {span(0, 0)}")
    press_keys("z", "KeyZ", 90, 4)
    check("Undo (⌘Z) restores it", span(0, 0) == full, str(span(0, 0)))
    at_frame(20)
    press_keys("F6", "F6", 117)
    check("F6 adds a keyframe on the pasted head layer", keys(0) == [0, 20], str(keys(0)))
    at_frame(20); press_keys("F5", "F5", 116)
    check("F5 lengthens it", span(0, 20) == full - 20 + 1, f"{span(0, 20)}")
    at_frame(20); press_keys("F5", "F5", 116, 8)
    check("Remove Frames takes that frame out again", span(0, 20) == full - 20, f"{span(0, 20)}")
    at_frame(20); press_keys("F6", "F6", 117, 8)
    check("⇧F6 clears the keyframe", keys(0) == [0], str(keys(0)))
    # the pasted head is a symbol: its frames offer to step inside it
    check("the pasted head is a symbol instance in its layer", bool(js(f"!!document.querySelector('[data-symbol-row=\"0\"] .cb-symbol-span[title*=\"step inside\"]')")))
    shot("4-after-commands")

    # ---- save, reload, reopen
    to_scene(); time.sleep(2)
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
    to_scene()
finally:
    chrome.terminate()
print("FAILED:" if failed else "ALL PASSED", failed)
sys.exit(1 if failed else 0)
