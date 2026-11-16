"""Part-tool edits (Move / Rotate / Scale / Hide a rig part, outside a pose) on a character drawn natively match the Animate player's.

usage: python3 part_edits_test.py <throwaway project id> <out dir> <source project id>
Seeds the throwaway scene with the source project's first character (symbol edits, colour rules and native edits dropped), then screenshots the character
four ways: player / native, without / with partOverrides on "head". Native must move the head like the player does (diff native-vs-player with the edit
about as small as without it), and the edit must really change the picture.
"""
import base64, json, os, subprocess, sys, time, urllib.request, websocket
from io import BytesIO
from PIL import Image, ImageChops

PROJECT, OUT, SOURCE = sys.argv[1], sys.argv[2], sys.argv[3]
EDIT = json.loads(sys.argv[4]) if len(sys.argv) > 4 else None
os.makedirs(OUT, exist_ok=True)
chrome = subprocess.Popen(["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "--headless=new", "--remote-debugging-port=9671",
                           f"--user-data-dir={OUT}/profile", "--window-size=1600,1000", "about:blank"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
failed = []
def get(u): return json.load(urllib.request.urlopen(u))
try:
    for _ in range(50):
        try: tabs = json.load(urllib.request.urlopen("http://127.0.0.1:9671/json")); break
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
    # "player" pictures are the Animate player's own: plain characters are drawn natively by default now (Phase 6 A).
    cmd("Page.addScriptToEvaluateOnNewDocument", source="if(location.search.indexOf('player-only')>=0)window.__CBS_PLAYER_ONLY__=true")
    src = [p for p in get("http://localhost:3000/api/projects") if p["id"] == SOURCE][0]["scenes"][0]["editor_data"]["objects"][0]
    def scene(): return [p for p in get("http://localhost:3000/api/projects") if p["id"] == PROJECT][0]["scenes"][0]
    def seed(native, edit):
        sc = scene(); ed = sc["editor_data"]
        o = json.loads(json.dumps(src))
        for k in ("symbolKeys", "symbolValues", "symbolEases", "symbolLayers", "colorReplacements", "nativePose", "partOverrides", "partKeyframes"): o.pop(k, None)
        if native: o["nativePose"] = {"Sardar_01": {"format": "cb-native-pose-edits", "version": 2, "source": "", "symbols": {}}}
        if edit: o["partOverrides"] = edit
        ed["objects"] = [o]
        req = urllib.request.Request(f"http://localhost:3000/api/scenes/{sc['id']}", data=json.dumps({"editor_data": ed}).encode(), method="PATCH", headers={"Content-Type": "application/json"})
        urllib.request.urlopen(req).read()
    def shot(name, native):
        cmd("Page.navigate", url=f"http://localhost:3000/editor/{PROJECT}" + ("" if native else "?player-only=1")); time.sleep(11 if native else 8)
        if native: time.sleep(4)
        r = js("(()=>{const e=document.querySelector('[data-editor-object-id]');const r=e.getBoundingClientRect();return [r.left,r.top,r.width,r.height]})()")
        data = cmd("Page.captureScreenshot", format="png", clip={"x": r[0], "y": r[1], "width": r[2], "height": r[3], "scale": 1})["data"]
        open(f"{OUT}/{name}.png", "wb").write(base64.b64decode(data))
        return Image.open(BytesIO(base64.b64decode(data))).convert("RGB")
    def diff(a, b):
        a = a.resize((300, 400)); b = b.resize((300, 400))
        d = ImageChops.difference(a, b).convert("L")
        return sum(1 for v in d.getdata() if v > 40) / (300 * 400) * 100
    seed(False, None); p0 = shot("player-plain", False)
    if EDIT is None:
        key = js("(()=>{const w=document.querySelector('iframe.cb-character-source-frame').contentWindow;const out=[];for(const [x,y] of [[0.5,0.12],[0.5,0.16],[0.45,0.14],[0.55,0.14]]){try{const r=w.cbPartAt(x,y);out.push(r&&(r.key||r))}catch(e){out.push('ERR')}}return JSON.stringify(out)})()")
        print("PART KEYS at the head:", key)
        k = [v for v in json.loads(key) if v and v != "ERR"]
        EDIT = {k[0]: {"offsetX": 70, "offsetY": -30, "rotation": 22}} if k else {"head": {"offsetX": 70, "offsetY": -30, "rotation": 22}}
        print("editing", EDIT)
    seed(False, EDIT); p1 = shot("player-edit", False)
    seed(True, None); n0 = shot("native-plain", True)
    seed(True, EDIT); n1 = shot("native-edit", True)
    base, withedit, moved_p, moved_n = diff(p0, n0), diff(p1, n1), diff(p0, p1), diff(n0, n1)
    print(f"native-vs-player plain {base:.2f}%  with edit {withedit:.2f}%  | edit changes player {moved_p:.2f}%  native {moved_n:.2f}%")
    check("the edit changes the player's picture", moved_p > 0.5, f"{moved_p:.2f}%")
    check("the edit changes the native picture", moved_n > 0.5, f"{moved_n:.2f}%")
    check("native with the edit stays as close to the player as without it", withedit < base + 1.5, f"{withedit:.2f}% vs {base:.2f}%")
finally:
    chrome.terminate()
print("FAILED:" if failed else "ALL PASSED", failed)
sys.exit(1 if failed else 0)
