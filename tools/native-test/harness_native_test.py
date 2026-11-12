"""The video renderer's static page (render-harness.html) draws characters with native edits.

usage: python3 harness_native_test.py <scene id> <out dir>
Drives the page the way the render worker does (ready flag, then __CBS_SET_TIME__ per frame).
"""
import base64, json, os, subprocess, sys, time, urllib.request, websocket

SCENE, OUT = sys.argv[1], sys.argv[2]
MODE = sys.argv[3] if len(sys.argv) > 3 else "saved-fit"   # or "no-fit": the scene has no nativePoseFit
os.makedirs(OUT, exist_ok=True)
chrome = subprocess.Popen(["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "--headless=new", "--remote-debugging-port=9998",
                           f"--user-data-dir={OUT}/profile", "--window-size=1920,1080", "about:blank"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
failed = []
try:
    for _ in range(50):
        try: tabs = json.load(urllib.request.urlopen("http://127.0.0.1:9998/json")); break
        except Exception: time.sleep(0.2)
    ws = websocket.create_connection([t for t in tabs if t["type"] == "page"][0]["webSocketDebuggerUrl"], timeout=300)
    n = [0]
    def cmd(method, **params):
        n[0] += 1; ws.send(json.dumps({"id": n[0], "method": method, "params": params}))
        while True:
            msg = json.loads(ws.recv())
            if msg.get("method") == "Runtime.exceptionThrown": print("EXC", msg["params"]["exceptionDetails"].get("exception", {}).get("description", "")[:300])
            if msg.get("method") == "Runtime.consoleAPICalled" and msg["params"]["type"] == "error": print("console.error", " ".join(str(a.get("value", a.get("description", ""))) for a in msg["params"]["args"])[:300])
            if msg.get("id") == n[0]: return msg.get("result", msg)
    def js(e):
        r = cmd("Runtime.evaluate", expression=e, returnByValue=True, awaitPromise=True)
        if r.get("exceptionDetails"): print("JS error:", r["exceptionDetails"].get("exception", {}).get("description", "")[:400])
        return r.get("result", {}).get("value")
    def check(name, ok, detail=""):
        print(("PASS " if ok else "FAIL ") + name, detail)
        if not ok: failed.append(name)
    def shot(name): open(f"{OUT}/{name}.png", "wb").write(base64.b64decode(cmd("Page.captureScreenshot", format="png")["data"]))
    cmd("Runtime.enable"); cmd("Page.enable")
    cmd("Page.navigate", url=f"http://localhost:3000/render-harness.html?scene={SCENE}&width=1920&height=1080&scale=1"); time.sleep(3)
    ready = False
    for _ in range(160):
        if js("window.__CBS_RENDER_ERROR__ || window.__CBS_RENDER_READY__ === true"): ready = True; break
        time.sleep(0.5)
    check("the harness becomes ready", bool(js("window.__CBS_RENDER_READY__")), str(js("window.__CBS_RENDER_ERROR__")))
    check("the bundle is loaded", bool(js("!!(window.CBNative && window.CBNative.createNativeCharacter)")))
    canvases = js("[...document.querySelectorAll('.char-layer canvas')].map(c=>getComputedStyle(c).visibility)")
    check("one native canvas, showing", canvases == ["visible"], str(canvases))
    legacy = js("[...document.querySelectorAll('.char-layer')].filter(l=>l.querySelector('canvas') && l.querySelector('iframe')).length")
    if MODE == "saved-fit":
        check("with a saved placement the character has no player at all", js("[...document.querySelectorAll('.char-layer')].filter(l=>l.querySelector('canvas')).every(l=>!l.querySelector('iframe'))"))
    else:
        check("without a saved placement the player stays underneath, hidden", legacy == 1 and js("[...document.querySelectorAll('.char-layer')].filter(l=>l.querySelector('canvas')).every(l=>getComputedStyle(l.querySelector('iframe')).visibility==='hidden')"))
    check("the other character is untouched (player only)", js("[...document.querySelectorAll('.char-layer')].filter(l=>!l.querySelector('canvas')).length") == 1)
    grabs = []
    for t in (0, 0.7, 1.4):
        js("window.__CBS_SET_TIME__(%s)" % t); time.sleep(0.4)
        shot("harness-%s" % t)
        grabs.append(js("document.querySelector('.char-layer canvas').toDataURL('image/png')"))
    check("the native character changes over time", len(set(grabs)) == 3)
    painted = js("""(()=>{const c=document.querySelector('.char-layer canvas');const d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let n=0;for(let i=3;i<d.length;i+=4)if(d[i]>16)n++;return n})()""")
    check("it has artwork on it", painted > 50000, f"{painted} px")
    # Placement: the native drawing stands where the player stands. Compare the lowest and the widest-low ink of the player's own
    # canvas (hidden, but still drawn) and the native canvas: the head is edited, the feet are not.
    geometry = None if MODE == "saved-fit" else js("""(()=>{
      const ink=(c)=>{const x=c.getContext('2d');const w=c.width,h=c.height;const d=x.getImageData(0,0,w,h).data;let low=-1,l=w,r=-1;for(let y=h-1;y>=0&&low<0;y--)for(let i=0;i<w;i++)if(d[(y*w+i)*4+3]>16){low=y;break}
        const y0=Math.floor(h*0.75);for(let y=y0;y<h;y++)for(let i=0;i<w;i++)if(d[(y*w+i)*4+3]>16){if(i<l)l=i;if(i>r)r=i}
        return {low:low/h,left:l/w,right:r/w}};
      const layer=[...document.querySelectorAll('.char-layer')].find(l=>l.querySelector('canvas'));
      const player=layer.querySelector('iframe').contentDocument.querySelector('canvas');
      return {player:ink(player),native:ink(layer.querySelector('canvas'))}})()""")
    close = lambda a, b: abs(a - b) < 0.012
    if MODE == "saved-fit": geometry = None
    if geometry: check("feet line up with the player's (same placement)", close(geometry["player"]["low"], geometry["native"]["low"]) and close(geometry["player"]["left"], geometry["native"]["left"]) and close(geometry["player"]["right"], geometry["native"]["right"]), json.dumps(geometry))
finally:
    chrome.terminate()
print("FAILED:" if failed else "ALL PASSED", failed)
sys.exit(1 if failed else 0)
