"""Phase 6 C follow-up: inside a pose open in place, the colour tools work on the picked part, as in the old pose view.

usage: python3 inplace_scope_test.py <throwaway project id> <out dir> <source project id>
The throwaway scene gets the source's first character (Sardar, plain). In the pose, a part is picked, then a Light/Dark click on it
makes a rule scoped to that part ("@<class>/<names>"), and only stage pixels the same click changes with nothing picked can change.
A click on the same colour outside the picked part makes no rule. With nothing picked the rule covers the whole character ("*").
Esc with Light/Dark open puts the tool away and stays in the pose; the next Esc steps out, and the scene draws the scoped rule.
"""
import base64, io, json, os, subprocess, sys, time, urllib.request, websocket
from PIL import Image

PROJECT, OUT, SOURCE = sys.argv[1], sys.argv[2], sys.argv[3]
os.makedirs(OUT, exist_ok=True)
chrome = subprocess.Popen(["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "--headless=new", "--remote-debugging-port=9565",
                           f"--user-data-dir={OUT}/profile", "--window-size=1600,1000", "about:blank"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
failed = []
def get(u): return json.load(urllib.request.urlopen(u))
try:
    for _ in range(50):
        try: tabs = json.load(urllib.request.urlopen("http://127.0.0.1:9565/json")); break
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
        return r.get("result", {}).get("value")
    def check(name, ok, detail=""):
        print(("PASS " if ok else "FAIL ") + name, detail)
        if not ok: failed.append(name)
    def mouse(kind, x, y, **kw): cmd("Input.dispatchMouseEvent", type=kind, x=x, y=y, button="left", clickCount=kw.pop("clickCount", 1), **kw)
    def click_at(x, y, count=1):
        for i in range(1, count + 1): mouse("mousePressed", x, y, clickCount=i); mouse("mouseReleased", x, y, clickCount=i)
        time.sleep(0.5)
    def centre(sel, dx=0.5, dy=0.5): return js(f"(()=>{{const e=document.querySelector({json.dumps(sel)});if(!e)return null;const r=e.getBoundingClientRect();return [r.left+r.width*{dx},r.top+r.height*{dy}]}})()")
    def key(k, code, vk, mods=0): cmd("Input.dispatchKeyEvent", type="keyDown", key=k, code=code, windowsVirtualKeyCode=vk, modifiers=mods); cmd("Input.dispatchKeyEvent", type="keyUp", key=k, code=code, windowsVirtualKeyCode=vk, modifiers=mods); time.sleep(0.4)
    def wait(expr, seconds=30):
        for _ in range(seconds * 4):
            if js(expr): return True
            time.sleep(0.25)
        return False
    def shot(name): open(f"{OUT}/{name}.png", "wb").write(base64.b64decode(cmd("Page.captureScreenshot", format="png")["data"]))
    def scene(): return [p for p in get("http://localhost:3000/api/projects") if p["id"] == PROJECT][0]["scenes"][0]
    def obj(): return scene()["editor_data"]["objects"][0]
    def rules_now(count, seconds=10):
        """The character's saved colour rules once there are at least `count` of them (none for 0) (or what there is after `seconds`)."""
        for _ in range(seconds * 2):
            r = obj().get("colorReplacements") or []
            if (len(r) >= count if count else not r): return r
            time.sleep(0.5)
        return obj().get("colorReplacements") or []
    STAGE = "[data-testid=native-stage-host] [data-testid=stage]"
    IN = f"!!document.querySelector('{STAGE}')"
    PICKED = "!!document.querySelector('[data-testid=native-editor]')?.dataset.picked"
    def enter():
        js("""(()=>{const e=document.querySelector('[title*="step inside it"]');const r=e.getBoundingClientRect();e.dispatchEvent(new MouseEvent('dblclick',{bubbles:true,cancelable:true,clientX:r.left+r.width/2,clientY:r.top+r.height*0.4,view:window}))})()""")
        return wait(IN, 60)
    def scene_char():
        r = js("(()=>{const e=document.querySelector('[data-editor-object-id]');const r=e.getBoundingClientRect();return [r.left,r.top,r.width,r.height]})()")
        return Image.open(io.BytesIO(base64.b64decode(cmd("Page.captureScreenshot", format="png", clip={"x": r[0], "y": r[1], "width": r[2], "height": r[3], "scale": 1})["data"]))).convert("RGB")
    # The stage's pixels, kept in the page; then which of them a click changed (a mask kept as window[name]) and how many.
    def snap(): js(f"(()=>{{const c=document.querySelector('{STAGE}');window.__snap=c.getContext('2d').getImageData(0,0,c.width,c.height).data.slice()}})()")
    def changed(name):
        return js(f"""(()=>{{const c=document.querySelector('{STAGE}');const d=c.getContext('2d').getImageData(0,0,c.width,c.height).data,b=window.__snap;
          const m=new Uint8Array(d.length/4);let n=0;for(let i=0;i<m.length;i++){{const k=i*4;if(Math.abs(d[k]-b[k])+Math.abs(d[k+1]-b[k+1])+Math.abs(d[k+2]-b[k+2])>30){{m[i]=1;n++}}}}
          window[{json.dumps(name)}]=m;return n}})()""")
    def dark():
        if not js("!!document.querySelector('.cb-light-dark')"): key("l", "KeyL", 76, 4)  # ⌘L toggles it
        js("(()=>{const b=[...document.querySelectorAll('.cb-light-dark-toggle button')].find(b=>b.textContent==='Dark'); b&&b.click()})()")
        return bool(js("!!document.querySelector('.cb-light-dark')"))
    def pick_part():
        for dy in (0.5, 0.45, 0.55, 0.4, 0.35, 0.6):
            x, y = centre(STAGE, 0.5, dy); click_at(x, y)
            if js(PICKED): return (x, y)
        return None

    cmd("Runtime.enable"); cmd("Page.enable")
    src = [p for p in get("http://localhost:3000/api/projects") if p["id"] == SOURCE][0]["scenes"][0]["editor_data"]["objects"][0]
    sc = scene(); ed = sc["editor_data"]; o = json.loads(json.dumps(src))
    for k in ("symbolKeys", "symbolValues", "symbolEases", "symbolLayers", "colorReplacements", "colorOverrides", "nativePose", "nativePoseFit", "partOverrides", "partKeyframes", "partReplacements", "onlyParts", "strokeScale"): o.pop(k, None)
    ed["objects"] = [o]; ed["background"] = "#ffffff"
    urllib.request.urlopen(urllib.request.Request(f"http://localhost:3000/api/scenes/{sc['id']}", data=json.dumps({"editor_data": ed}).encode(), method="PATCH", headers={"Content-Type": "application/json"})).read()
    cmd("Page.navigate", url="http://localhost:3000/"); time.sleep(1)
    js("Object.keys(localStorage).filter(k=>k.startsWith('cb-symbol-view')).forEach(k=>localStorage.removeItem(k))")
    cmd("Page.navigate", url=f"http://localhost:3000/editor/{PROJECT}"); time.sleep(12)
    plain = scene_char()

    check("a double-click opens the pose in place", enter())
    spot = pick_part()
    check("a part is picked", bool(spot), str(spot))

    # ---- picked part: the rule is scoped to it
    snap()
    check("Light/Dark opens", dark())
    click_at(*spot); time.sleep(0.8)
    rules = rules_now(1)
    scope = rules[0]["scope"] if rules else ""
    check("a click on the picked part makes a rule", len(rules) >= 1, str(len(rules)))
    check("...scoped to the picked part", scope.startswith("@") and "/" in scope, scope)
    scoped = changed("__scoped")
    check("...and the stage changes", scoped > 0, f"{scoped} pixels")
    shot("1-scoped")

    # ---- Esc puts Light/Dark away and stays in the pose; ⌘Z takes the rule back
    key("Escape", "Escape", 27)
    check("Esc closes Light/Dark and stays in the pose", js(IN) and not js("!!document.querySelector('.cb-light-dark')"))
    js("document.activeElement && document.activeElement.blur()")
    key("z", "KeyZ", 90, 4)
    check("⌘Z takes the rule back", len(rules_now(0)) == 0)

    # ---- nothing picked: the whole character
    click_at(*centre(STAGE, 0.05, 0.9))
    check("a click on empty stage drops the pick", not js(PICKED))
    time.sleep(0.6); snap()
    dark(); click_at(*spot); time.sleep(0.8)
    rules = rules_now(1)
    check("with nothing picked the rule covers the whole character", bool(rules) and rules[0]["scope"] == "*", str(rules[:1]))
    whole = changed("__whole")
    outside_only = js("(()=>{let n=0;for(let i=0;i<__whole.length;i++)if(__scoped[i]&&!__whole[i])n++;return n})()")
    # Include Stroke / Shadow: the outline and shadow colours that follow are found in the part for a scoped click and in the whole
    # character otherwise, so a few edge pixels may differ.
    check("the scoped click changed (almost) nothing the whole-character click leaves alone", outside_only <= 0.02 * scoped, f"{outside_only} of {scoped} pixels")
    check("the whole-character click changes at least as much", whole >= scoped, f"{whole} vs {scoped}")
    # A spot the whole-character click changed but the scoped one did not: the same colour outside the picked part.
    away = js(f"""(()=>{{const c=document.querySelector('{STAGE}');const r=c.getBoundingClientRect();const W=c.width;
      for(let i=0;i<__whole.length;i++){{if(!__whole[i]||__scoped[i])continue;const x=i%W,y=(i/W)|0;let ok=true;
        for(let dy=-3;dy<=3&&ok;dy++)for(let dx=-3;dx<=3;dx++){{const j=(y+dy)*W+x+dx;if(!__whole[j]||__scoped[j]){{ok=false;break}}}}
        if(ok)return [r.left+(x+0.5)*r.width/W,r.top+(y+0.5)*r.height/c.height]}}return null}})()""")
    key("Escape", "Escape", 27)
    js("document.activeElement && document.activeElement.blur()")
    key("z", "KeyZ", 90, 4)
    rules_now(0)

    # ---- picked part again: the same colour outside it is not touched
    if away:
        spot2 = pick_part()
        check("the part is picked again", bool(spot2))
        snap(); dark(); click_at(*away); time.sleep(1.5)
        check("a click on the colour outside the picked part makes no rule", len(rules_now(0, 3)) == 0, str(obj().get("colorReplacements")))
        check("...and changes nothing on the stage", changed("__none") == 0)
        key("Escape", "Escape", 27)
        # Back to the scoped rule for the scene check.
        dark(); click_at(*spot); time.sleep(0.8)
        check("the scoped rule is made again", len(rules_now(1)) >= 1)
    else:
        print("NOTE the clicked colour is only used in the picked part; the outside check is skipped")
        pick_part(); dark(); click_at(*spot); time.sleep(0.8)  # back to the scoped rule
        check("the scoped rule is made again", len(rules_now(1)) >= 1)
    shot("2-final")

    # ---- out: Esc twice; the scene draws the scoped rule
    key("Escape", "Escape", 27)
    check("the first Esc puts Light/Dark away", js(IN) and not js("!!document.querySelector('.cb-light-dark')"))
    key("Escape", "Escape", 27)
    check("the next Esc steps out of the pose", wait(f"!({IN})", 10))
    time.sleep(3)
    now = scene_char()
    diff = sum(1 for a, b in zip(plain.resize((240, 320)).getdata(), now.resize((240, 320)).getdata()) if sum(abs(p - q) for p, q in zip(a, b)) > 60)
    check("the scene draws the scoped colour", diff > 0, f"{diff} pixels differ from the plain character")
    shot("3-scene")
finally:
    chrome.terminate()
print("FAILED:" if failed else "ALL PASSED", failed)
sys.exit(1 if failed else 0)
