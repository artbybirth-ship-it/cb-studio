"""One timeline UI: inside a native pose the scene editor's own timeline panel (components/SymbolTimeline.tsx) shows the native timeline and
its controls edit it, with real mouse and key events.

usage: python3 panel_native_test.py <throwaway project id> <out dir> <source project id>
The throwaway scene gets the source's first character (Sardar, plain). Its pose opens in place: the panel (breadcrumb, layer rows with colour,
eye and padlock, the audio row's sound) and none of the native editor's own controls. Then on the panel: F6 / F7 / ⇧F6 / F5 / ⇧F5 on a
selected frame, Reverse Frames from the right-click menu, dragging and ⌥-dragging a keyframe, ⌥⌘C / ⌥⌘V, the eye, the padlock, renaming,
the header's New layer / New folder / Duplicate / Delete, the Opacity box, stepping into a symbol and back by the breadcrumb, and ⌘Z
(the scene's Undo) after each change.
"""
import base64, json, os, subprocess, sys, time, urllib.request, websocket

PROJECT, OUT, SOURCE = sys.argv[1], sys.argv[2], sys.argv[3]
os.makedirs(OUT, exist_ok=True)
chrome = subprocess.Popen(["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "--headless=new", "--remote-debugging-port=9681",
                           f"--user-data-dir={OUT}/profile", "--window-size=1600,1000", "about:blank"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
failed = []
def get(u): return json.load(urllib.request.urlopen(u))
try:
    for _ in range(50):
        try: tabs = json.load(urllib.request.urlopen("http://127.0.0.1:9681/json")); break
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
        if r.get("exceptionDetails"): print("JS error:", r["exceptionDetails"].get("exception", {}).get("description", "")[:300])
        return r.get("result", {}).get("value")
    def check(name, ok, detail=""):
        print(("PASS " if ok else "FAIL ") + name, detail)
        if not ok: failed.append(name)
    def mouse(kind, x, y, mods=0, count=1, button="left"):
        cmd("Input.dispatchMouseEvent", type=kind, x=x, y=y, button=button, clickCount=count, modifiers=mods, buttons=1 if kind == "mouseMoved" else 0)
    def click(x, y, mods=0, count=1, button="left"):
        for c in range(1, count + 1): mouse("mousePressed", x, y, mods, c, button); mouse("mouseReleased", x, y, mods, c, button)
        time.sleep(0.5)
    def drag(x0, y0, x1, y1, mods=0, steps=8):
        mouse("mousePressed", x0, y0, mods); time.sleep(0.1)
        for i in range(1, steps + 1): cmd("Input.dispatchMouseEvent", type="mouseMoved", x=x0 + (x1 - x0) * i / steps, y=y0 + (y1 - y0) * i / steps, button="left", buttons=1, modifiers=mods); time.sleep(0.04)
        mouse("mouseReleased", x1, y1, mods); time.sleep(0.7)
    def key(k, code, vk, mods=0):
        js("document.activeElement && document.activeElement.blur()")
        cmd("Input.dispatchKeyEvent", type="keyDown", key=k, code=code, windowsVirtualKeyCode=vk, modifiers=mods)
        cmd("Input.dispatchKeyEvent", type="keyUp", key=k, code=code, windowsVirtualKeyCode=vk, modifiers=mods); time.sleep(0.6)
    undo = lambda: key("z", "KeyZ", 90, 4)
    def wait(expr, seconds=30):
        for _ in range(seconds * 4):
            if js(expr): return True
            time.sleep(0.25)
        return False
    def shot(name): open(f"{OUT}/{name}.png", "wb").write(base64.b64decode(cmd("Page.captureScreenshot", format="png")["data"]))
    def scene(): return [p for p in get("http://localhost:3000/api/projects") if p["id"] == PROJECT][0]["scenes"][0]
    PANEL = ".cb-symbol-timeline"
    CELL = lambda: js(f"parseFloat(getComputedStyle(document.querySelector('{PANEL}')).getPropertyValue('--cb-sym-cell'))")
    def keys(row):
        """The keyframes of a row as the panel draws them: (first frame, frames, kind)."""
        return js(f"""(()=>{{const c=parseFloat(getComputedStyle(document.querySelector('{PANEL}')).getPropertyValue('--cb-sym-cell'));
          return [...document.querySelectorAll('[data-symbol-row="{row}"] .cb-symbol-span')].map(s=>[Math.round(parseFloat(s.style.left)/c),Math.round(parseFloat(s.style.width)/c),s.className.replace('cb-symbol-span','').trim().split(' ')[0]])}})()""")
    def starts(row): return [k[0] for k in keys(row)]
    def lane_at(row, frame):
        """Where frame `frame` of a row is on screen: the grid is scrolled so that it is clear of the sticky layer names and of the right edge."""
        return js(f"""(()=>{{const lane=document.querySelector('[data-symbol-row="{row}"] .cb-symbol-lane');const box=document.querySelector('.cb-symbol-grid');
          const c=parseFloat(getComputedStyle(document.querySelector('{PANEL}')).getPropertyValue('--cb-sym-cell'));
          lane.scrollIntoView({{block:'nearest'}});
          const g=box.getBoundingClientRect(), x=lane.getBoundingClientRect().left+({frame}+0.5)*c;
          if(x<g.left+260)box.scrollLeft-=g.left+300-x; else if(x>g.left+box.clientWidth-40)box.scrollLeft+=x-(g.left+box.clientWidth-120);
          const r=lane.getBoundingClientRect();return [r.left+({frame}+0.5)*c,r.top+r.height/2]}})()""")
    def cell_xy(row, frame):
        """Where frame `frame` of a row is now (no scrolling)."""
        return js(f"""(()=>{{const lane=document.querySelector('[data-symbol-row="{row}"] .cb-symbol-lane');const c=parseFloat(getComputedStyle(document.querySelector('{PANEL}')).getPropertyValue('--cb-sym-cell'));const r=lane.getBoundingClientRect();return [r.left+({frame}+0.5)*c,r.top+r.height/2]}})()""")
    def row_names(): return js("[...document.querySelectorAll('[data-symbol-row] .cb-symbol-layer-name')].map(e=>e.textContent)")
    def header(label): return js(f"""(()=>{{const b=document.querySelector('.cb-symbol-layer-tools [aria-label="{label}"]');if(!b)return null;const r=b.getBoundingClientRect();return [r.left+r.width/2,r.top+r.height/2]}})()""")
    def notice(): return js("document.querySelector('.cb-canvas-notice')?.textContent || ''")
    def saved_pose():
        o = scene()["editor_data"]["objects"][0]
        e = next(iter((o.get("nativePose") or {}).values()), None)
        return e and e["symbols"].get(e.get("pose") or "")

    cmd("Runtime.enable"); cmd("Page.enable")
    src = [p for p in get("http://localhost:3000/api/projects") if p["id"] == SOURCE][0]["scenes"][0]["editor_data"]["objects"][0]
    sc = scene(); ed = sc["editor_data"]; o = json.loads(json.dumps(src))
    for k in ("symbolKeys", "symbolValues", "symbolEases", "symbolLayers", "colorReplacements", "colorOverrides", "nativePose", "nativePoseFit", "partOverrides", "partKeyframes", "partReplacements", "onlyParts", "strokeScale"): o.pop(k, None)
    ed["objects"] = [o]; ed["background"] = "#ffffff"
    urllib.request.urlopen(urllib.request.Request(f"http://localhost:3000/api/scenes/{sc['id']}", data=json.dumps({"editor_data": ed}).encode(), method="PATCH", headers={"Content-Type": "application/json"})).read()
    cmd("Page.navigate", url="http://localhost:3000/"); time.sleep(1)
    js("Object.keys(localStorage).filter(k=>k.startsWith('cb-')).forEach(k=>localStorage.removeItem(k))")
    cmd("Page.navigate", url=f"http://localhost:3000/editor/{PROJECT}"); time.sleep(12)
    js("""(()=>{const e=document.querySelector('[title*="step inside it"]');const r=e.getBoundingClientRect();e.dispatchEvent(new MouseEvent('dblclick',{bubbles:true,cancelable:true,clientX:r.left+r.width/2,clientY:r.top+r.height*0.4,view:window}))})()""")
    IN = "!!document.querySelector('[data-testid=native-stage-host] [data-testid=stage]')"
    check("the pose opens in place with the timeline panel", wait(f"{IN} && !!document.querySelector('{PANEL} [data-symbol-row]')", 90))
    time.sleep(1.5)

    # ---- the panel, and none of the native editor's own controls
    check("none of the native editor's own controls", not js("!!document.querySelector('[data-testid=point-mode],[data-testid=native-side],[data-testid=native-crumbs],[data-testid=insert-frame],[data-testid=timeline],[data-testid=open-native]')"))
    crumbs = js(f"[...document.querySelectorAll('{PANEL} .cb-symbol-crumbs span')].map(s=>s.textContent.replace('›','').trim())")
    check("the breadcrumb: scene › character › pose", crumbs and len(crumbs) == 3 and crumbs[1] == o.get("name"), str(crumbs))
    names = row_names()
    check("the pose's layers are listed", len(names) >= 10 and "Audio" in names, f"{len(names)} rows")
    check("layer colours show", js(f"document.querySelectorAll('{PANEL} .cb-symbol-swatch').length") >= 10)
    check("the audio row shows its sound", "untitled.wav" in (js(f"document.querySelector('{PANEL} .cb-symbol-sound')?.textContent") or ""))
    check("no 'reset layers' while the layers are as the file has them", not header("Reset layers"))
    shot("1-panel")

    # A row with a long hold (no key inside it) and a few keyframes to work on.
    rows = js("[...document.querySelectorAll('[data-symbol-row]')].map(r=>+r.dataset.symbolRow)")
    def pick_row():
        for r in rows:
            k = keys(r)
            if len(k) >= 4 and any(w >= 6 for _, w, _ in k[1:]): return r, k
        return None, None
    ROW, K = pick_row()
    check("found a layer with keyframes to work on", ROW is not None, str(K)[:120])
    hold = next((s, w) for s, w, _ in K[1:] if w >= 6)
    F = hold[0] + 3  # inside a span, not a keyframe

    # ---- F6 / F7 / ⇧F6 on a selected frame, each undone with ⌘Z
    click(*lane_at(ROW, F)); key("F6", "F6", 117)
    check("F6 on a selected frame makes a keyframe there", F in starts(ROW), str(starts(ROW))[:120])
    saved = False
    for _ in range(20):
        p = saved_pose()
        if p and any(fr["i"] == F for fr in p["layers"][ROW]["frames"]): saved = True; break
        time.sleep(0.5)
    check("...saved on the character at once", saved)
    undo()
    check("⌘Z takes it back", F not in starts(ROW), str(starts(ROW))[:120])
    click(*lane_at(ROW, F)); key("F7", "F7", 118)
    check("F7 makes a blank keyframe", any(s == F and kind == "blank" for s, _, kind in keys(ROW)), str(keys(ROW))[:160])
    undo()
    K2 = hold[0]
    click(*lane_at(ROW, K2)); key("F6", "F6", 117, 8)
    check("⇧F6 on a keyframe clears it", K2 not in starts(ROW), str(starts(ROW))[:120])
    undo()
    check("...⌘Z brings it back", K2 in starts(ROW))

    # ---- F5 / ⇧F5: the keyframes after the frame slide
    after = [s for s in starts(ROW) if s > F]
    click(*lane_at(ROW, F)); key("F5", "F5", 116)
    check("F5 pushes the later keyframes one frame on", [s for s in starts(ROW) if s > F] == [s + 1 for s in after], f"{after[:5]} -> {[s for s in starts(ROW) if s > F][:5]}")
    click(*lane_at(ROW, F)); key("F5", "F5", 116, 8)
    check("⇧F5 pulls them back", [s for s in starts(ROW) if s > F] == after)

    # ---- Reverse Frames (right-click menu) on a selection holding several keyframes
    ks = [s for s, _, kind in keys(ROW) if s > 0 and kind != "blank"][:4]
    if len(ks) >= 3:
        before = starts(ROW)
        click(*lane_at(ROW, ks[0])); click(*lane_at(ROW, ks[-1]), mods=8)
        x, y = lane_at(ROW, ks[1]); click(x, y, button="right")
        rev = js("(()=>{const b=[...document.querySelectorAll('.cb-frame-menu button')].find(b=>b.textContent.startsWith('Reverse Frames'));if(!b)return null;const r=b.getBoundingClientRect();return [r.left+r.width/2,r.top+r.height/2]})()")
        check("the right-click menu offers Reverse Frames", bool(rev))
        if rev:
            click(*rev)
            mirrored = sorted(ks[0] + ks[-1] - s for s in before if ks[0] <= s <= ks[-1])
            now = [s for s in starts(ROW) if ks[0] <= s <= ks[-1]]
            check("Reverse Frames mirrors the keyframes in the selection", now == mirrored, f"{[s for s in before if ks[0] <= s <= ks[-1]]} -> {now}")
            undo()
            check("...⌘Z puts them back", starts(ROW) == before)

    # ---- dragging a keyframe; ⌥-drag drops a copy
    movable = js(f"""(()=>{{const c=parseFloat(getComputedStyle(document.querySelector('{PANEL}')).getPropertyValue('--cb-sym-cell'));
      return [...document.querySelectorAll('[data-symbol-row="{ROW}"] .cb-symbol-span')].map(s=>[Math.round(parseFloat(s.style.left)/c),Math.round(parseFloat(s.style.width)/c),!!s.querySelector('.cb-symbol-key.movable')])}})()""")
    target = next(((s, w) for s, w, mv in movable if mv and s > 0 and w >= 4), None)
    if target:
        s0 = target[0]; c = CELL()
        x0, y0 = lane_at(ROW, s0); x0 = x0 - c / 2 + 2
        drag(x0, y0, x0 + 2 * c, y0)
        check("dragging a keyframe moves it", (s0 + 2) in starts(ROW) and s0 not in starts(ROW), f"{s0} -> {starts(ROW)[:12]}")
        undo()
        check("...⌘Z moves it back", s0 in starts(ROW))
        other = next((r for r in rows if r != ROW and len(keys(r)) >= 1 and keys(r)[0][1] > 20), None)
        if other is not None:
            x0, y0 = lane_at(ROW, s0); x0 = x0 - c / 2 + 2
            x1, y1 = cell_xy(other, s0 + 1)
            before_other = starts(other)
            drag(x0, y0, x1, y1, mods=1)
            check("⌥-dragging a keyframe drops a copy on another layer", (s0 + 1) in starts(other) and s0 in starts(ROW), f"{before_other[:6]} -> {starts(other)[:6]}")
            undo()
    else:
        check("found a keyframe that can be dragged", False)

    # ---- ⌥⌘C / ⌥⌘V
    click(*lane_at(ROW, hold[0])); key("c", "KeyC", 67, 4 | 1)
    click(*lane_at(ROW, F)); key("v", "KeyV", 86, 4 | 1)
    check("⌥⌘C then ⌥⌘V pastes the keyframe at the selected frame", F in starts(ROW), str(starts(ROW))[:120])
    undo()

    # ---- the eye and the padlock
    eye = js(f"""(()=>{{const b=document.querySelector('[data-symbol-row="{ROW}"] .cb-symbol-eye');b.scrollIntoView({{block:'nearest'}});const r=b.getBoundingClientRect();return [r.left+r.width/2,r.top+r.height/2]}})()""")
    click(*eye)
    check("the eye hides the layer", js(f"document.querySelector('[data-symbol-row=\"{ROW}\"] .cb-symbol-eye').getAttribute('aria-pressed')") == "true")
    off = False
    for _ in range(20):
        p = saved_pose()
        if p and p["layers"][ROW].get("off"): off = True; break
        time.sleep(0.5)
    check("...and that is saved (the native layer is switched off)", off)
    check("...and now 'reset layers' is offered", bool(header("Reset layers")))
    click(*eye)
    check("the eye shows it again", js(f"document.querySelector('[data-symbol-row=\"{ROW}\"] .cb-symbol-eye').getAttribute('aria-pressed')") == "false")
    lock = js(f"""(()=>{{const b=document.querySelector('[data-symbol-row="{ROW}"] .cb-symbol-lock');const r=b.getBoundingClientRect();return [r.left+r.width/2,r.top+r.height/2]}})()""")
    click(*lock)
    check("the padlock locks the layer", js(f"document.querySelector('[data-symbol-row=\"{ROW}\"]').classList.contains('is-locked')"))
    click(*lane_at(ROW, F)); key("F6", "F6", 117)
    check("...and a locked layer takes no keyframe", F not in starts(ROW))
    click(*lock)

    # ---- renaming
    name0 = row_names()[rows.index(ROW)]
    nm = js(f"""(()=>{{const e=document.querySelector('[data-symbol-row="{ROW}"] .cb-symbol-layer-name');const r=e.getBoundingClientRect();return [r.left+8,r.top+r.height/2]}})()""")
    click(*nm, count=2); time.sleep(0.3)
    js("(()=>{const i=document.querySelector('.cb-symbol-rename');i.value='Renamed arm';})()")
    cmd("Input.dispatchKeyEvent", type="keyDown", key="Enter", code="Enter", windowsVirtualKeyCode=13); cmd("Input.dispatchKeyEvent", type="keyUp", key="Enter", code="Enter", windowsVirtualKeyCode=13); time.sleep(0.8)
    check("double-click a layer's name renames it", "Renamed arm" in row_names(), str(row_names()[:5]))
    undo()
    check("...⌘Z gives it its name back", name0 in row_names())

    # ---- the header: New layer, New folder, Duplicate, Delete
    count0 = len(row_names())
    click(*header("New layer"))
    check("New layer adds a row", len(row_names()) == count0 + 1, f"{count0} -> {len(row_names())}")
    undo()
    click(*header("New folder"))
    check("New folder adds a folder row", len(row_names()) == count0 + 1 and js(f"!!document.querySelector('{PANEL} .cb-symbol-row.is-folder')"))
    undo()
    lname = js(f"""(()=>{{const e=document.querySelector('[data-symbol-row="{ROW}"] .cb-symbol-layer');const r=e.getBoundingClientRect();return [r.left+40,r.top+r.height/2]}})()""")
    click(*lname)
    click(*header("Duplicate layer"))
    check("Duplicate layer adds a copy", len(row_names()) == count0 + 1, f"{count0} -> {len(row_names())}")
    undo()
    click(*lname)
    click(*header("Delete layer"))
    check("Delete layer removes the picked layer", len(row_names()) == count0 - 1, f"{count0} -> {len(row_names())}")
    undo()
    check("...⌘Z brings it back", len(row_names()) == count0)

    # ---- the Opacity box of a picked keyframe
    click(*lane_at(ROW, hold[0]))
    op = js("(()=>{const i=[...document.querySelectorAll('.cb-symbol-value input')].find(i=>i.getAttribute('aria-label')==='Opacity');if(!i)return null;const r=i.getBoundingClientRect();return [r.left+r.width/2,r.top+r.height/2]})()")
    check("picking a keyframe shows its Opacity", bool(op))
    if op:
        click(*op); time.sleep(0.2)
        js("(()=>{const i=[...document.querySelectorAll('.cb-symbol-value input')].find(i=>i.getAttribute('aria-label')==='Opacity');const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;set.call(i,'40');i.dispatchEvent(new Event('input',{bubbles:true}));})()")
        cmd("Input.dispatchKeyEvent", type="keyDown", key="Enter", code="Enter", windowsVirtualKeyCode=13); cmd("Input.dispatchKeyEvent", type="keyUp", key="Enter", code="Enter", windowsVirtualKeyCode=13); time.sleep(1)
        alpha = None
        for _ in range(20):
            p = saved_pose()
            fr = p and next((f for f in p["layers"][ROW]["frames"] if f["i"] == hold[0]), None)
            el = fr and next((e for e in fr["elements"] if e.get("k") == "instance"), None)
            if el and el.get("alpha") is not None and abs(el["alpha"] - 0.4) < 0.01: alpha = el["alpha"]; break
            time.sleep(0.5)
        check("Opacity 40 makes that keyframe's part 40% opaque", alpha is not None, str(alpha))
        undo()

    # ---- stepping into a symbol by double-clicking its frames, and back by the breadcrumb
    # A layer's frames that hold a symbol (their tooltip says so).
    into = js(f"""(()=>{{const c=parseFloat(getComputedStyle(document.querySelector('{PANEL}')).getPropertyValue('--cb-sym-cell'));
      const s=[...document.querySelectorAll('{PANEL} .cb-symbol-span')].find(s=>/double-click to step inside/.test(s.title)&&parseFloat(s.style.width)>=3*c);
      return s?[+s.closest('[data-symbol-row]').dataset.symbolRow,Math.round(parseFloat(s.style.left)/c)]:null}})()""")
    check("found frames that hold a symbol", bool(into))
    if into:
        x, y = lane_at(into[0], into[1] + 1); click(x, y, count=2); time.sleep(1.5)
        crumbs2 = js(f"[...document.querySelectorAll('{PANEL} .cb-symbol-crumbs span')].length")
        check("double-clicking a layer's frames steps into its symbol", crumbs2 == 4, f"{crumbs2} crumbs")
        shot("2-inside")
        # ---- Create Shape Tween (right-click menu) on a keyframe of drawn shapes, then its Ease box
        made = None; item = None
        inrows = js("[...document.querySelectorAll('[data-symbol-row]')].map(r=>+r.dataset.symbolRow)")
        for r in inrows:
            if (keys(r) or [[0, 9]])[0][1] < 3:  # a one-frame drawing: stretch it so a second keyframe fits
                click(*lane_at(r, 0))
                for _ in range(3): key("F5", "F5", 116)
            k = [x for x in (keys(r) or []) if x[2] == "frames" and x[1] >= 3]
            if not k: continue
            at = k[0][0]
            click(*lane_at(r, at + 2)); key("F6", "F6", 117)  # a second keyframe holding the same drawing
            click(*lane_at(r, at)); x, y = lane_at(r, at); click(x, y, button="right")
            item = js("(()=>{const b=[...document.querySelectorAll('.cb-frame-menu button')].find(b=>b.textContent==='Create Shape Tween');if(!b)return null;const r=b.getBoundingClientRect();return [r.left+r.width/2,r.top+r.height/2]})()")
            if not item: break
            click(*item); time.sleep(0.8)
            if any(kk[2] == "shape" for kk in (keys(r) or [])): made = (r, at); break
            undo()
        check("the right-click menu offers Create Shape Tween", bool(item))
        if made:
            r, at = made
            check("Create Shape Tween makes a green shape tween", any(kk[2] == "shape" for kk in (keys(r) or [])), str(keys(r))[:120])
            click(*lane_at(r, at + 1))
            box = js("!!document.querySelector('.cb-symbol-ease .cb-symbol-ease-label') && !/view only/.test(document.querySelector('.cb-symbol-timeline').textContent)")
            check("a shape tween has the Ease box (not 'view only')", box)
            undo()
            check("...⌘Z takes the shape tween away", not any(kk[2] == "shape" for kk in (keys(r) or [])))
            undo()
        else:
            check("Create Shape Tween found a layer of drawn shapes to tween", False)

        back = js(f"(()=>{{const b=[...document.querySelectorAll('{PANEL} .cb-symbol-crumbs button')][2];if(!b)return null;const r=b.getBoundingClientRect();return [r.left+r.width/2,r.top+r.height/2]}})()")
        if back: click(*back); time.sleep(1)
        check("the pose's crumb steps back out to it", js(f"[...document.querySelectorAll('{PANEL} .cb-symbol-crumbs span')].length") == 3)

    # ---- the scene's crumb leaves the pose
    sc_crumb = js(f"(()=>{{const b=document.querySelector('{PANEL} .cb-symbol-crumbs button');const r=b.getBoundingClientRect();return [r.left+r.width/2,r.top+r.height/2]}})()")
    click(*sc_crumb)
    check("the scene's crumb goes back to the scene", wait(f"!({IN})", 10))
    shot("3-scene")
finally:
    chrome.terminate()
print("FAILED:" if failed else "ALL PASSED", failed)
sys.exit(1 if failed else 0)
