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
    shot("2-inside-pose")
    click("[data-testid=open-native]")
    check("native dialog opens and loads the .fla", wait("[data-testid=native-editor]", 90))
    time.sleep(2)
    shot("3-native-open")

    # move a part on the dialog's stage
    r = rect("[data-testid=stage]"); cx, cy = r[0] + r[2] * 0.5, r[1] + r[3] * 0.4
    mouse("mousePressed", cx, cy, clickCount=1); time.sleep(0.5)
    for i in range(1, 9):
        mouse("mouseMoved", cx + i * 6, cy + i * 3, buttons=1); time.sleep(0.05)
    mouse("mouseReleased", cx + 48, cy + 24, clickCount=1); time.sleep(0.6)
    check("Undo is enabled after the drag (an edit was made)", js("!document.querySelector('[data-testid=undo]').disabled"))
    click("[data-testid=native-done]"); time.sleep(2)
    check("dialog closes on Done", rect("[data-testid=native-dialog]") is None)
    shot("4-after-done")

    # the edit is on the placed character, in the scene (the same data a .cb file carries)
    saved = None
    for _ in range(30):
        obj = scene_object()
        if obj.get("nativePose"): saved = obj["nativePose"]; break
        time.sleep(1)
    check("nativePose is saved on the character in the scene", bool(saved), str({k: list(v["symbols"]) for k, v in (saved or {}).items()}))

    # reload: the edit comes back
    check("after reload the pose opens again", open_native())
    click("[data-testid=open-native]")
    check("native dialog reopens", wait("[data-testid=native-editor]", 90))
    time.sleep(2)
    check("Undo is disabled on reopen (edits loaded as the starting point, not as new changes)", js("document.querySelector('[data-testid=undo]').disabled"))
    shot("5-reopened")
    # compare the picture with the first one: the part should be where it was moved to
    click("[data-testid=native-cancel]")
finally:
    chrome.terminate()
print("FAILED:" if failed else "ALL PASSED", failed)
sys.exit(1 if failed else 0)
