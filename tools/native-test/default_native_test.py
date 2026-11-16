"""Phase 6 step A: a character with no native edits is drawn natively by default when its Animate file is there, in the same place as its player.

usage: python3 default_native_test.py <throwaway project id> <out dir> <source project id>
Seeds the throwaway scene with the source's first character (Sardar), then:
  plain   — no edits: the native canvas is shown, the player hidden, and the picture matches the player's (window.__CBS_PLAYER_ONLY__);
  edit    — a part edit on the head: still native, still matching the player with the same edit;
  legacy  — an edit from the old pose timeline (symbolKeys): the player is kept;
  unknown — a part edit on a part the native drawing does not know: the player is kept;
  part    — the head picked on the stage (part editing): the player is shown while it is picked.
"""
import base64, json, os, subprocess, sys, time, urllib.request, websocket
from io import BytesIO
from PIL import Image, ImageChops

PROJECT, OUT, SOURCE = sys.argv[1], sys.argv[2], sys.argv[3]
os.makedirs(OUT, exist_ok=True)
chrome = subprocess.Popen(["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "--headless=new", "--remote-debugging-port=9673",
                           f"--user-data-dir={OUT}/profile", "--window-size=1600,1000", "about:blank"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
failed = []
def get(u): return json.load(urllib.request.urlopen(u))
try:
    for _ in range(50):
        try: tabs = json.load(urllib.request.urlopen("http://127.0.0.1:9673/json")); break
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
    cmd("Runtime.enable"); cmd("Page.enable")
    # The comparison switch is set before any page script runs, only when asked for (sessionStorage flag set by the test itself).
    cmd("Page.addScriptToEvaluateOnNewDocument", source="try{if(sessionStorage.getItem('cbs-player-only')==='1')window.__CBS_PLAYER_ONLY__=true}catch(e){}")
    src = [p for p in get("http://localhost:3000/api/projects") if p["id"] == SOURCE][0]["scenes"][0]["editor_data"]["objects"][0]
    def scene(): return [p for p in get("http://localhost:3000/api/projects") if p["id"] == PROJECT][0]["scenes"][0]
    def seed(**extra):
        sc = scene(); ed = sc["editor_data"]
        o = json.loads(json.dumps(src))
        for k in ("symbolKeys", "symbolValues", "symbolEases", "symbolLayers", "colorReplacements", "colorOverrides", "nativePose", "nativePoseFit", "partOverrides", "partKeyframes", "partReplacements", "onlyParts", "strokeScale"): o.pop(k, None)
        o.update(extra)
        ed["objects"] = [o]
        req = urllib.request.Request(f"http://localhost:3000/api/scenes/{sc['id']}", data=json.dumps({"editor_data": ed}).encode(), method="PATCH", headers={"Content-Type": "application/json"})
        urllib.request.urlopen(req).read()
        return o["id"]
    def open_editor(player_only):
        cmd("Page.navigate", url="http://localhost:3000/")
        time.sleep(1)
        js(f"sessionStorage.setItem('cbs-player-only', '{'1' if player_only else '0'}')")
        cmd("Page.navigate", url=f"http://localhost:3000/editor/{PROJECT}")
        time.sleep(14)
    STATE = """(()=>{const c=document.querySelector('canvas[data-native-character]');const f=document.querySelector('iframe.cb-character-source-frame');
      return {canvas:!!c, nativeVisible:!!c&&getComputedStyle(c).visibility==='visible', playerOpacity:f?getComputedStyle(f).opacity:null}})()"""
    def shot(name):
        r = js("(()=>{const e=document.querySelector('[data-editor-object-id]');const r=e.getBoundingClientRect();return [r.left,r.top,r.width,r.height]})()")
        data = cmd("Page.captureScreenshot", format="png", clip={"x": r[0], "y": r[1], "width": r[2], "height": r[3], "scale": 1})["data"]
        open(f"{OUT}/{name}.png", "wb").write(base64.b64decode(data))
        return Image.open(BytesIO(base64.b64decode(data))).convert("RGB")
    def diff(a, b):
        a = a.resize((300, 400)); b = b.resize((300, 400))
        d = ImageChops.difference(a, b).convert("L")
        return sum(1 for v in d.getdata() if v > 40) / (300 * 400) * 100

    # plain
    seed(); open_editor(True); p0 = shot("player-plain"); s = js(STATE)
    check("player-only switch keeps the player", not s["nativeVisible"] and s["playerOpacity"] != "0", str(s))
    head = js("(()=>{const w=document.querySelector('iframe.cb-character-source-frame').contentWindow;for(const [x,y] of [[0.5,0.12],[0.5,0.16],[0.5,0.1]]){try{const r=w.cbPartAt(x,y);const k=r&&(r.key||r);if(k)return k}catch(e){}}return null})()")
    print("head part:", head)
    open_editor(False); s = js(STATE); n0 = shot("native-plain")
    check("plain: drawn natively by default", s["nativeVisible"] and s["playerOpacity"] == "0", str(s))
    base = diff(p0, n0)
    check("plain: native matches the player (placement and drawing)", base < 1.5, f"{base:.2f}%")

    # edit on a known part
    edit = {head: {"offsetX": 60, "offsetY": -20, "rotation": 15}}
    seed(partOverrides=edit); open_editor(True); p1 = shot("player-edit")
    open_editor(False); s = js(STATE); n1 = shot("native-edit")
    check("edit: drawn natively", s["nativeVisible"], str(s))
    d = diff(p1, n1)
    check("edit: native matches the player with the edit", d < base + 1.5, f"{d:.2f}% vs {base:.2f}%")
    check("edit: the edit shows", diff(n0, n1) > 0.5, f"{diff(n0, n1):.2f}%")

    # legacy pose edit
    seed(symbolKeys={"Sardar_01": {"0": {"anchors": []}}}); open_editor(False); s = js(STATE)
    check("legacy: an old pose-timeline edit keeps the player", not s["nativeVisible"] and s["playerOpacity"] != "0", str(s))

    # unknown part key
    seed(partOverrides={f"{head}/hair": {"offsetX": 40}}); open_editor(False); s = js(STATE)
    check("unknown part: a part the native drawing does not know keeps the player", not s["nativeVisible"] and s["playerOpacity"] != "0", str(s))

    # part editing: the player shows while a part is picked
    seed(); open_editor(False)
    r = js("(()=>{const e=document.querySelector('[data-editor-object-id]');const r=e.getBoundingClientRect();return [r.left,r.top,r.width,r.height]})()")
    x, y = r[0] + r[2] * 0.5, r[1] + r[3] * 0.14
    def click(count, alt=False):
        for i in range(1, count + 1):
            cmd("Input.dispatchMouseEvent", type="mousePressed", x=x, y=y, button="left", clickCount=i, modifiers=1 if alt else 0)
            cmd("Input.dispatchMouseEvent", type="mouseReleased", x=x, y=y, button="left", clickCount=i, modifiers=1 if alt else 0)
            time.sleep(0.05)
    # Select Parts: Option + double-click on the character.
    click(1); time.sleep(1); click(2, alt=True); time.sleep(2)
    s = js(STATE)
    picked = js("!!document.querySelector('.cb-character-part-hitbox')")
    print("after Option+double-click on the head: part box shown =", picked, s)
    if picked:
        check("part: the player is shown while a part is picked", not s["nativeVisible"] and s["playerOpacity"] != "0", str(s))
        cmd("Input.dispatchKeyEvent", type="keyDown", key="Escape", code="Escape", windowsVirtualKeyCode=27)
        cmd("Input.dispatchKeyEvent", type="keyUp", key="Escape", code="Escape", windowsVirtualKeyCode=27)
        time.sleep(0.5)
        cmd("Input.dispatchMouseEvent", type="mousePressed", x=r[0] - 40, y=r[1] + 40, button="left", clickCount=1)
        cmd("Input.dispatchMouseEvent", type="mouseReleased", x=r[0] - 40, y=r[1] + 40, button="left", clickCount=1)
        time.sleep(1.5)
        s = js(STATE)
        check("part: native again once nothing is picked", s["nativeVisible"] and s["playerOpacity"] == "0", str(s))
    else:
        check("part: a part could be picked on the stage", False)

    # The video renderer's page (render-harness.html, what the Docker worker drives): the plain character goes native too, over its
    # hidden player, standing where the player stands; an old pose-timeline edit keeps the player.
    def harness():
        cmd("Page.navigate", url=f"http://localhost:3000/render-harness.html?scene={scene()['id']}&width=1920&height=1080&scale=1"); time.sleep(3)
        for _ in range(160):
            if js("window.__CBS_RENDER_ERROR__ || window.__CBS_RENDER_READY__ === true"): break
            time.sleep(0.5)
        return js("""(()=>{const l=document.querySelector('.char-layer');const c=l&&l.querySelector('canvas'),f=l&&l.querySelector('iframe');
          return {ready:window.__CBS_RENDER_READY__===true,error:window.__CBS_RENDER_ERROR__||null,canvas:c?getComputedStyle(c).visibility:null,player:f?getComputedStyle(f).visibility:null}})()""")
    seed(); h = harness()
    check("video page: the plain character is drawn natively, its player hidden", h["ready"] and h["canvas"] == "visible" and h["player"] == "hidden", str(h))
    geometry = js("""(()=>{
      const ink=(c)=>{const x=c.getContext('2d');const w=c.width,h=c.height;const d=x.getImageData(0,0,w,h).data;let low=-1,l=w,r=-1;for(let y=h-1;y>=0&&low<0;y--)for(let i=0;i<w;i++)if(d[(y*w+i)*4+3]>16){low=y;break}
        const y0=Math.floor(h*0.75);for(let y=y0;y<h;y++)for(let i=0;i<w;i++)if(d[(y*w+i)*4+3]>16){if(i<l)l=i;if(i>r)r=i}
        return {low:low/h,left:l/w,right:r/w}};
      const layer=document.querySelector('.char-layer');
      return {player:ink(layer.querySelector('iframe').contentDocument.querySelector('canvas')),native:ink(layer.querySelector('canvas'))}})()""")
    close = lambda k: abs(geometry["player"][k] - geometry["native"][k]) < 0.012
    check("video page: feet line up with the player's (same placement)", close("low") and close("left") and close("right"), json.dumps(geometry))
    seed(symbolKeys={"Sardar_01": {"0": {"anchors": []}}}); h = harness()
    check("video page: an old pose-timeline edit keeps the player", h["ready"] and h["canvas"] is None and h["player"] != "hidden", str(h))

    # A real MP4 of the plain character through the worker completes.
    seed()
    req = urllib.request.Request(f"http://localhost:3000/api/projects/{PROJECT}/render", data=json.dumps({"format": "mp4", "resolution": "hd"}).encode(), method="POST", headers={"Content-Type": "application/json"})
    job = json.load(urllib.request.urlopen(req)); t0 = time.time()
    while time.time() - t0 < 600:
        time.sleep(5)
        j = [r for r in get("http://localhost:3000/api/renders") if r["id"] == job["id"]][0]
        if j["status"] in ("complete", "failed"): break
    print(f"mp4: {j['status']} in {time.time() - t0:.0f}s", j.get("output_url"))
    check("a real MP4 of the plain character completes", j["status"] == "complete", (j.get("error") or "")[:300])
finally:
    chrome.terminate()
print("FAILED:" if failed else "ALL PASSED", failed)
sys.exit(1 if failed else 0)
