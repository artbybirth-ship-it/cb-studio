"""Frame-by-frame: Animate's HTML5 publish (CreateJS) vs the spike renderer, with pixel differences."""
import json, sys, time, base64, io, subprocess, urllib.request, websocket
from PIL import Image, ImageChops

S, frames = sys.argv[1], [int(x) for x in sys.argv[2].split(",")]
init = sys.argv[3]
server = subprocess.Popen([sys.executable, "-m", "http.server", "8765", "--bind", "127.0.0.1", "--directory", f"{S}/ref_web"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
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
    cmd("Page.navigate", url="http://127.0.0.1:8765/compare.html"); time.sleep(2)
    print("init:", js(init))
    img = lambda url: Image.open(io.BytesIO(base64.b64decode(url.split(",")[1]))).convert("RGB")
    rows = []
    for f in frames:
        pair = js(f"(() => [refFrame({f}).toDataURL(), ourFrame({f}).toDataURL()])()")
        ref, ours = img(pair[0]), img(pair[1])
        diff = ImageChops.difference(ref, ours)
        px = diff.load(); w, h = diff.size
        big = sum(1 for y in range(0, h, 2) for x in range(0, w, 2) if max(px[x, y]) > 48)
        drawn = sum(1 for y in range(0, h, 2) for x in range(0, w, 2) if min(ref.getpixel((x, y))) < 250)
        mean = sum(sum(c) for c in diff.resize((w // 4, h // 4)).getdata()) / (3 * (w // 4) * (h // 4))
        rows.append((f, big, drawn, mean))
        print(f"frame {f:3}: {100 * big / max(drawn, 1):5.2f}% of the character's pixels differ visibly (>48/255); mean diff {mean:.2f}/255")
        if f in (frames[0], frames[len(frames) // 2]):
            sheet = Image.new("RGB", (w, h * 3), "white")
            sheet.paste(ref, (0, 0)); sheet.paste(ours, (0, h))
            sheet.paste(Image.eval(diff, lambda v: 255 - min(255, v * 3)), (0, 2 * h))
            sheet.resize((w // 2, h * 3 // 2)).save(f"{S}/cmp_{f}.png")
            ref.save(f"{S}/cmp_{f}_ref.png"); ours.save(f"{S}/cmp_{f}_ours.png")
    print("errors:", errors)
finally:
    chrome.kill(); server.kill()
