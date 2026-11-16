"""Light/Dark then Undo: Cmd+Z puts the colour back and Cmd+Shift+Z redoes it, also after a tick in the Light/Dark panel.

usage: python3 tone_undo_test.py <throwaway project id> <out dir>
Opens the editor on a throwaway project whose first layer is a character, selects it, opens Light/Dark (Cmd+L), ticks Include Shadow (the
checkbox keeps the keyboard focus, which used to make Cmd+Z do nothing), clicks the character's artwork, and checks the pixel changes, comes
back on Cmd+Z and changes again on Cmd+Shift+Z. Nothing is saved to the project by the test (the colour change is undone).
"""
import base64, io, json, os, subprocess, sys, time, urllib.request, websocket
from PIL import Image

PROJECT, OUT = sys.argv[1], sys.argv[2]
os.makedirs(OUT, exist_ok=True)
chrome = subprocess.Popen(["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "--headless=new", "--remote-debugging-port=9671",
                           f"--user-data-dir={OUT}/profile-{os.getpid()}", "--window-size=1600,1000", "about:blank"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
failed = []
try:
    for _ in range(50):
        try: tabs = json.load(urllib.request.urlopen("http://127.0.0.1:9671/json")); break
        except Exception: time.sleep(0.2)
    ws = websocket.create_connection([t for t in tabs if t["type"] == "page"][0]["webSocketDebuggerUrl"], timeout=120)
    n = [0]
    def cmd(method, **params):
        n[0] += 1; ws.send(json.dumps({"id": n[0], "method": method, "params": params}))
        while True:
            msg = json.loads(ws.recv())
            if msg.get("id") == n[0]: return msg.get("result", msg)
    def js(e): return cmd("Runtime.evaluate", expression=e, returnByValue=True, awaitPromise=True).get("result", {}).get("value")
    def check(name, ok, detail=""):
        print(("PASS " if ok else "FAIL ") + name, detail)
        if not ok: failed.append(name)
    def click(x, y):
        for kind in ("mousePressed", "mouseReleased"): cmd("Input.dispatchMouseEvent", type=kind, x=x, y=y, button="left", clickCount=1)
        time.sleep(2.5)
    def key(k, code, vk, mods):  # mods: 2 Ctrl, 4 Meta, 8 Shift
        for kind in ("rawKeyDown", "keyUp"): cmd("Input.dispatchKeyEvent", type=kind, key=k, code=code, windowsVirtualKeyCode=vk, modifiers=mods)
        time.sleep(2.5)
    def pixel(x, y):
        im = Image.open(io.BytesIO(base64.b64decode(cmd("Page.captureScreenshot", format="png")["data"]))).convert("RGB")
        return im.getpixel((int(x), int(y)))
    cmd("Runtime.enable"); cmd("Page.enable")
    cmd("Page.navigate", url=f"http://localhost:3000/editor/{PROJECT}"); time.sleep(12)
    # A point on the artwork: the first point down the middle of the character's box that has a colour.
    spot = js("""(()=>{const e=document.querySelector('[data-editor-object-id]'), id=e.getAttribute('data-editor-object-id');
      const fr=(window.__CBS_COLOUR_FRAME__&&window.__CBS_COLOUR_FRAME__(id))||document.querySelector('iframe.cb-character-source-frame'); const r=fr.getBoundingClientRect();
      for(let y=0.45;y<0.9;y+=0.05){const h=fr.contentWindow.cbColorAt(0.5,y,''); if(h) return [r.left+r.width*0.5, r.top+r.height*y, h.original]} return null})()""")
    check("found a coloured point on the character", bool(spot), str(spot))
    x, y = spot[0], spot[1]
    click(x, y - 120)  # select the character
    key("l", "KeyL", 76, 4)
    check("Light/Dark is open", bool(js("!!document.querySelector('.cb-light-dark')")))
    js("(()=>{const b=[...document.querySelectorAll('.cb-light-dark-toggle button')].find(b=>b.textContent==='Dark'); b&&b.click()})()")
    box = js("(()=>{const i=[...document.querySelectorAll('.cb-light-dark-checks input')][1]; const r=i.getBoundingClientRect(); return [r.left+r.width/2, r.top+r.height/2, i.checked]})()")
    if not box[2]: click(box[0], box[1])
    check("Include Shadow is ticked and holds the focus", bool(js("(()=>{const i=[...document.querySelectorAll('.cb-light-dark-checks input')][1]; return i.checked && document.activeElement===i})()")))
    before = pixel(x, y)
    click(x, y)
    after = pixel(x, y)
    check("a Light/Dark click changes the colour", after != before, f"{before} -> {after}")
    key("z", "KeyZ", 90, 4)
    undone = pixel(x, y)
    check("Cmd+Z puts it back", undone == before, f"{undone} (was {before})")
    key("z", "KeyZ", 90, 4 | 8)
    redone = pixel(x, y)
    check("Cmd+Shift+Z does it again", redone == after, f"{redone} (expected {after})")
    key("z", "KeyZ", 90, 4)
    check("and Cmd+Z undoes it again", pixel(x, y) == before)
finally:
    chrome.terminate()
print("FAILED:" if failed else "ALL PASSED", failed)
sys.exit(1 if failed else 0)
