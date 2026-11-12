"""A character with native edits shows them in the scene editor and on the render page.

usage: python3 native_scene_render_test.py <project id> <scene id> <out dir>
Needs a scene whose Sardar has a pasted Rajkumar head (run paste_native_test.py first).
"""
import base64, json, os, subprocess, sys, time, urllib.request, websocket

PROJECT, SCENE, OUT = sys.argv[1], sys.argv[2], sys.argv[3]
os.makedirs(OUT, exist_ok=True)
chrome = subprocess.Popen(["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "--headless=new", "--remote-debugging-port=9999",
                           f"--user-data-dir={OUT}/profile", "--window-size=1920,1080", "about:blank"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
failed = []
try:
    for _ in range(50):
        try: tabs = json.load(urllib.request.urlopen("http://127.0.0.1:9999/json")); break
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
    def shot(name):
        open(f"{OUT}/{name}.png", "wb").write(base64.b64decode(cmd("Page.captureScreenshot", format="png")["data"]))
    cmd("Runtime.enable"); cmd("Page.enable")

    # ---- the render page, as the video renderer drives it
    cmd("Page.navigate", url=f"http://localhost:3000/render/scene/{SCENE}"); time.sleep(3)
    ready = False
    for _ in range(120):
        if js("window.__CBS_RENDER_READY__ === true"): ready = True; break
        time.sleep(0.5)
    check("render page becomes ready (waits for the native characters)", ready, str(js("window.__CBS_RENDER_ERROR__")))
    check("no native character is still loading", (js("window.__CBS_NATIVE_PENDING__ || 0")) == 0)
    count = js("document.querySelectorAll('[data-native-character]').length")
    check("a native canvas stands in for the character that has native edits", count == 1, f"{count} canvas(es)")
    visible = js("[...document.querySelectorAll('[data-native-character]')].every(c=>getComputedStyle(c).visibility==='visible')")
    check("the native canvas is showing", visible)
    def grab(seconds, name):
        js("window.__CBS_SET_TIME__(%s)" % seconds); time.sleep(0.5)
        shot(name)
        return js("document.querySelector('[data-native-character]').toDataURL('image/png')")
    a = grab(0, "render-0s"); b = grab(0.7, "render-0.7s"); c = grab(1.4, "render-1.4s")
    check("the character changes over time (animation plays natively)", len({a, b, c}) == 3)
    painted = js("""(()=>{const c=document.querySelector('[data-native-character]');const d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let n=0;for(let i=3;i<d.length;i+=4)if(d[i]>16)n++;return n})()""")
    check("the native canvas has artwork on it", painted > 50000, f"{painted} px")

    # ---- the scene editor
    cmd("Page.navigate", url=f"http://localhost:3000/editor/{PROJECT}"); time.sleep(10)
    count = js("document.querySelectorAll('[data-native-character]').length")
    check("the scene editor draws the edited character natively", count == 1, f"{count}")
    shot("editor")
    # the placement saved with the edits is the player's own (read in the editor when Done was pressed)
    saved = [o for o in json.load(urllib.request.urlopen("http://localhost:3000/api/projects")) if o["id"] == PROJECT][0]["scenes"][0]["editor_data"]["objects"]
    fit = [o for o in saved if o.get("nativePose")][0].get("nativePoseFit")
    check("a placement was saved with the native edits", bool(fit), str(fit))
    live = js("""(()=>{const f=[...document.querySelectorAll('[data-editor-object-id]')].find(e=>e.querySelector('[data-native-character]')).querySelector('iframe');const r=f.contentWindow.exportRoot;return r?{s:r.scaleX,tx:r.x,ty:r.y}:null})()""")
    check("it equals the player's own placement", bool(fit and live) and all(abs(fit[k] - live[k]) < 0.01 * max(1, abs(live[k])) for k in ("s", "tx", "ty")), f"saved {fit} live {live}")
    # a click on the edited character still selects it (hit-testing reads the native canvas)
    box = js("(()=>{const e=document.querySelector('[data-native-character]').getBoundingClientRect();return [e.left+e.width/2,e.top+e.height*0.45]})()")
    for kind in ("mousePressed", "mouseReleased"): cmd("Input.dispatchMouseEvent", type=kind, x=box[0], y=box[1], button="left", clickCount=1)
    time.sleep(1)
    check("clicking the edited character selects it", bool(js("!!document.querySelector('.cb-stage-character.selected')")))
    shot("editor-selected")
finally:
    chrome.terminate()
print("FAILED:" if failed else "ALL PASSED", failed)
sys.exit(1 if failed else 0)
