"""Later frames of a converted pose against the old player, on the render page (headless Chrome, dev server on :3000).

usage: LEGACY_INDEX=0|3|4 python3 legacy_frames_test.py <throwaway project id> <out dir>
Seeds the throwaway scene with one set of real old edits (legacy_objects.json), then at several times compares
  A old player drawing the old edits      B converted native drawing
  C old player, no edits                  D native drawing, no edits
The player and the native drawing already differ on a plain character (D vs C: stroke weight, placement), so the
check is that the conversion adds little on top of that: diff(B, A) stays within a margin of diff(D, C).
Use a throwaway project: it is rewritten.
"""
import base64, io, json, os, subprocess, sys, time, urllib.request, websocket
from PIL import Image, ImageChops

PROJECT, OUT = sys.argv[1], sys.argv[2]
INDEX = int(os.environ.get("LEGACY_INDEX", "3"))
TIMES = [float(t) for t in os.environ.get("TIMES", "0,0.4,0.9,1.5,2.2").split(",")]
MARGIN = float(os.environ.get("MARGIN", "3.0"))
SOURCE = "/private/tmp/claude-501/-Users-amazdraw-Downloads-CharacterBazaarStudio-MVP-v112/e20824a2-161c-45d0-b24c-cb95fad8f3b3/scratchpad/legacy_objects.json"
os.makedirs(OUT, exist_ok=True)
OLD = ("symbolKeys", "symbolValues", "symbolEases", "symbolLayers")
chrome = subprocess.Popen(["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "--headless=new", "--remote-debugging-port=9667",
                           f"--user-data-dir={OUT}/profile", "--window-size=1920,1080", "about:blank"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
failed = []
try:
    for _ in range(50):
        try: tabs = json.load(urllib.request.urlopen("http://127.0.0.1:9667/json")); break
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
    def wait(selector, seconds=60):
        for _ in range(seconds * 2):
            if rect(selector): return True
            time.sleep(0.5)
        return False
    def click_at(x, y):
        for kind in ("mousePressed", "mouseReleased"): cmd("Input.dispatchMouseEvent", type=kind, x=x, y=y, button="left", clickCount=1)
        time.sleep(0.6)
    def click(selector):
        r = rect(selector); click_at(r[0] + r[2] / 2, r[1] + r[3] / 2)
    cmd("Runtime.enable"); cmd("Page.enable")

    def scene():
        ps = json.load(urllib.request.urlopen("http://localhost:3000/api/projects"))
        return [p for p in ps if p["id"] == PROJECT][0]["scenes"][0]
    def patch(sc, ed):
        req = urllib.request.Request(f"http://localhost:3000/api/scenes/{sc['id']}", data=json.dumps({"editor_data": ed}).encode(), method="PATCH", headers={"Content-Type": "application/json"})
        urllib.request.urlopen(req).read()
    def render_page(sc):
        cmd("Page.navigate", url=f"http://localhost:3000/render/scene/{sc['id']}"); time.sleep(3)
        for _ in range(180):
            if js("window.__CBS_RENDER_READY__ === true"): return True
            time.sleep(0.5)
        return False
    def shots(label, sc):
        ok = render_page(sc)
        check(f"{label}: render page ready", ok, str(js("window.__CBS_RENDER_ERROR__")))
        out = []
        for t in TIMES:
            js("window.__CBS_SET_TIME__(%s)" % t); time.sleep(0.7)
            im = Image.open(io.BytesIO(base64.b64decode(cmd("Page.captureScreenshot", format="png")["data"]))).convert("L")
            im.save(f"{OUT}/{label}-{t}.png"); out.append(im)
        return out
    def pct(a, b):
        ink = sum(1 for p in a.getdata() if p < 235) or 1
        return 100.0 * sum(1 for p in ImageChops.difference(a, b).getdata() if p > 40) / ink

    sc0 = scene(); ed0 = json.loads(json.dumps(sc0["editor_data"])); o0 = ed0["objects"][0]
    real = json.load(open(SOURCE))[INDEX]
    for k in ("nativePose", "nativePoseFit") + OLD: o0.pop(k, None)
    for k in OLD:
        if real.get(k): o0[k] = real[k]
    seeded = json.loads(json.dumps(ed0))
    patch(sc0, ed0)
    A = shots("A-old-player", scene())

    # convert by opening the pose in the editor and pressing Done
    cmd("Page.navigate", url=f"http://localhost:3000/editor/{PROJECT}"); time.sleep(10)
    js("""(()=>{const e=document.querySelector('[title*="step inside it"]');const r=e.getBoundingClientRect();e.dispatchEvent(new MouseEvent('dblclick',{bubbles:true,cancelable:true,clientX:r.left+r.width/2,clientY:r.top+r.height*0.4,view:window}))})()""")
    check("pose opens", wait("[data-testid=open-native]", 20))
    click("[data-testid=open-native]")
    check("native dialog opens", wait("[data-testid=native-editor]", 90)); time.sleep(2)
    said = js("document.querySelector('[data-testid=native-converted]')?.textContent || ''")
    check("older edits were converted", said.startswith("Older edits on this character were converted"), said)
    click("[data-testid=native-done]"); time.sleep(2)
    sc1 = scene()
    check("native edits saved", bool(sc1["editor_data"]["objects"][0].get("nativePose")))
    B = shots("B-converted-native", sc1)

    # controls: same character with no old edits, drawn by the player (C) and natively (D)
    ed = json.loads(json.dumps(sc1["editor_data"])); o = ed["objects"][0]
    saved_native = o["nativePose"]
    for k in OLD: o.pop(k, None)
    o.pop("nativePose", None)
    patch(sc1, ed)
    C = shots("C-player-unedited", scene())
    o["nativePose"] = {k: {**v, "symbols": {}} for k, v in saved_native.items()}
    patch(scene(), ed)
    D = shots("D-native-unedited", scene())

    worst = 0
    for i, t in enumerate(TIMES):
        ba, dc, ca = pct(B[i], A[i]), pct(D[i], C[i]), pct(C[i], A[i])
        print(f"t={t}s  converted vs old player {ba:.2f}%   baseline (native vs player, unedited) {dc:.2f}%   old edits change the player by {ca:.2f}%")
        check(f"t={t}s conversion adds under {MARGIN}% on top of the baseline", ba <= dc + MARGIN, f"{ba:.2f}% vs {dc:.2f}%")
        worst = max(worst, ba - dc)
    print("worst excess over baseline:", round(worst, 2), "%")
finally:
    chrome.terminate()
print("FAILED:" if failed else "ALL PASSED", failed)
sys.exit(1 if failed else 0)
