"""Drive view.html in headless Chrome: run JS that returns a canvas, save it as PNG."""
import json, sys, time, base64, subprocess, urllib.request, websocket

S = sys.argv[1]
jobs = json.loads(sys.argv[2])  # [[name, js expression returning a canvas or {c}], ...]
setup = sys.argv[3] if len(sys.argv) > 3 else ""
server = subprocess.Popen([sys.executable, "-m", "http.server", "8765", "--bind", "127.0.0.1", "--directory", f"{S}/fla_out"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
chrome = subprocess.Popen(["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "--headless=new", "--remote-debugging-port=9333",
                           f"--user-data-dir={S}/chrome-profile", "--window-size=1400,1000", "about:blank"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
try:
    for _ in range(50):
        try:
            tabs = json.load(urllib.request.urlopen("http://127.0.0.1:9333/json")); break
        except Exception:
            time.sleep(0.2)
    ws = websocket.create_connection([t for t in tabs if t["type"] == "page"][0]["webSocketDebuggerUrl"], timeout=300)
    n = [0]; errors = []
    def cmd(method, **params):
        n[0] += 1; ws.send(json.dumps({"id": n[0], "method": method, "params": params}))
        while True:
            msg = json.loads(ws.recv())
            if msg.get("method") == "Runtime.exceptionThrown":
                errors.append(msg["params"]["exceptionDetails"].get("exception", {}).get("description", "")[:400])
            if msg.get("id") == n[0]:
                return msg.get("result", msg)
    def js(e):
        r = cmd("Runtime.evaluate", expression=e, returnByValue=True, awaitPromise=True)
        if r.get("exceptionDetails"):
            print("JS error:", r["exceptionDetails"].get("exception", {}).get("description", "")[:600])
        return r.get("result", {}).get("value")
    cmd("Runtime.enable"); cmd("Page.enable")
    cmd("Page.navigate", url="http://127.0.0.1:8765/view.html"); time.sleep(1.5)
    if setup:
        print("setup:", js(setup))
    for name, expr in jobs:
        res = js("(async () => { const r = await (" + expr + "); const c = r && r.c ? r.c : r; if (!c) return null; "
                 "const url = c.toDataURL('image/png'); return {url, w: c.width, h: c.height, ms: r.ms, stats: {shapes: R.stats.shapes, inst: R.stats.instances, masks: R.stats.masks, morphs: R.stats.morphs, tweens: R.stats.tweens, missing: [...R.stats.missing].slice(0, 5)}}; })()")
        if not res:
            print(name, "-> nothing drawn"); continue
        open(f"{S}/{name}.png", "wb").write(base64.b64decode(res["url"].split(",")[1]))
        print(name, f"{res['w']}x{res['h']}", (f"{res['ms']:.0f} ms" if res.get("ms") else ""), res["stats"])
        js("R.stats = {shapes: 0, instances: 0, masks: 0, morphs: 0, tweens: 0, missing: new Set()}")
    print("errors:", errors)
finally:
    chrome.kill(); server.kill()
