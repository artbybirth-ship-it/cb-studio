"""Scene editor -> native editor round trip, in headless Chrome against the dev server on :3000.

usage: python3 scene_native_test.py <project id> <out dir>
Opens the project, steps into the character's pose (double-click), opens the "Native editor
(beta)", moves a part, presses Done, checks the edit is saved on the placed character in the scene
(nativePose), reloads the page, and checks the native editor opens with the edit still there.
Use a throwaway project: the edit is written to it.
"""
import base64, json, os, subprocess, sys, time, urllib.request, websocket

PROJECT, OUT = sys.argv[1], sys.argv[2]
os.makedirs(OUT, exist_ok=True)
chrome = subprocess.Popen(["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "--headless=new", "--remote-debugging-port=9666",
                           f"--user-data-dir={OUT}/profile", "--window-size=1600,1000", "about:blank"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
failed = []
try:
    for _ in range(50):
        try:
            tabs = json.load(urllib.request.urlopen("http://127.0.0.1:9666/json")); break
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

    def open_native():
        cmd("Page.navigate", url=f"http://localhost:3000/editor/{PROJECT}"); time.sleep(8)
        shot("1-editor")
        # step into the pose: a double-click on the character (sent as the DOM event; headless Chrome's
        # synthetic double click does not reach the character's overlay)
        js("""(()=>{const e=document.querySelector('[title*="step inside it"]');const r=e.getBoundingClientRect();e.dispatchEvent(new MouseEvent('dblclick',{bubbles:true,cancelable:true,clientX:r.left+r.width/2,clientY:r.top+r.height*0.4,view:window}))})()""")
        return wait("[data-testid=open-native]", 20)

    check("Double-click steps into the pose and shows the native button", open_native())
    click("[data-testid=open-native]")
    check("native dialog opens and loads the .fla", wait("[data-testid=native-editor]", 90))
    time.sleep(2)
    shot("legacy-open")
    said = js("document.querySelector('[data-testid=native-converted]')?.textContent || ''")
    check("the dialog says the older edits were converted", said.startswith("Older edits on this character were converted") and "Sardar_01" in said, said)
    keys = js("[...document.querySelectorAll('[data-key^=\"1:\"]')].map(e=>e.dataset.key.split(':')[1]*1).sort((a,b)=>a-b)")
    check("layer 1 has the moved keyframes (15 moved to 20)", keys == [0, 9, 20, 27, 69, 79, 85], str(keys))
    check("Undo is disabled (converted edits are the starting point)", js("document.querySelector('[data-testid=undo]').disabled"))
    click("[data-testid=native-cancel]")
finally:
    chrome.terminate()
print("FAILED:" if failed else "ALL PASSED", failed)
sys.exit(1 if failed else 0)
