"""Phase 6 B: a new layer from the library in the native pose editor (symbol, library picture, picture file), with real mouse events.

usage: python3 library_layer_test.py <file.fla> <throwaway project id> <source project id> <out dir>
Part 1, /native-lab with <file.fla>: "+ Layer from library" lists the file's symbols; picking one adds a layer above the picked layer
holding it (the picture changes, its Properties show), Undo takes it away; a picture of the Backgrounds / FX library (when there is
one) and a picture file each add a layer too.
Part 2, the scene editor: the throwaway scene gets the source's first character (plain); in its native editor a picture file is added
and Done pressed: the picture is saved BY ITS ADDRESS (uploaded with the project, not copied into the scene), and after a reload the
scene's native drawing shows it.
"""
import base64, json, os, re, subprocess, sys, time, urllib.request, websocket
from io import BytesIO
from PIL import Image

FLA, PROJECT, SOURCE, OUT = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
os.makedirs(OUT, exist_ok=True)
PNG = os.path.join(OUT, "red-square.png")
Image.new("RGB", (240, 240), (230, 20, 30)).save(PNG)
chrome = subprocess.Popen(["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "--headless=new", "--remote-debugging-port=9559",
                           f"--user-data-dir={OUT}/profile", "--window-size=1400,1100", "about:blank"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
failed = []
def get(u): return json.load(urllib.request.urlopen(u))
try:
    for _ in range(50):
        try: tabs = json.load(urllib.request.urlopen("http://127.0.0.1:9559/json")); break
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
    def mouse(kind, x, y, **kw): cmd("Input.dispatchMouseEvent", type=kind, x=x, y=y, button="left", clickCount=kw.pop("clickCount", 1), **kw)
    def centre(sel, dx=0.5, dy=0.5): return js(f"(()=>{{const e=document.querySelector({json.dumps(sel)});if(!e)return null;const r=e.getBoundingClientRect();return [r.left+r.width*{dx},r.top+r.height*{dy}]}})()")
    def click(sel, dx=0.5, dy=0.5): x, y = centre(sel, dx, dy); mouse("mousePressed", x, y); mouse("mouseReleased", x, y); time.sleep(0.4)
    def wait(expr, seconds=30):
        for _ in range(seconds * 4):
            if js(expr): return True
            time.sleep(0.25)
        return False
    def shot(name): open(f"{OUT}/{name}.png", "wb").write(base64.b64decode(cmd("Page.captureScreenshot", format="png")["data"]))
    def set_file(selector, path):
        root = cmd("DOM.getDocument", depth=-1, pierce=True)["root"]["nodeId"]
        cmd("DOM.setFileInputFiles", files=[path], nodeId=cmd("DOM.querySelector", nodeId=root, selector=selector)["nodeId"])
    stage = lambda: js("document.querySelector('[data-testid=stage]').toDataURL()")
    layer_names = lambda: js("[...document.querySelectorAll('[data-testid=timeline] [data-testid^=layer-name-]')].map(e=>e.textContent)")
    note = lambda: js("document.querySelector('[data-testid=note]').textContent")
    def pick_row(i):  # a click on a layer's row at frame 1 picks that layer
        click(f"[data-testid=timeline] [data-layer='{i}']", 0.004, 0.5)

    cmd("Runtime.enable"); cmd("Page.enable"); cmd("DOM.enable")
    # ---------------- part 1: the lab
    cmd("Page.navigate", url="http://localhost:3000/native-lab"); time.sleep(6)
    set_file("input[type=file]", FLA)
    wait("!!document.querySelector('[data-testid=toggle-editor]')", 120)
    click("[data-testid=toggle-editor]"); time.sleep(2)
    check("editor opens", bool(js("!!document.querySelector('[data-testid=stage]')")))
    names0, img0 = layer_names(), stage()
    pick_row(2); time.sleep(0.3)
    click("[data-testid=add-from-library]"); time.sleep(0.5)
    symbols = js("[...document.querySelectorAll('[data-testid=native-library] [data-symbol]')].map(b=>b.dataset.symbol)") or []
    check("the menu lists the file's symbols", len(symbols) > 5, f"{len(symbols)} symbols")
    # filter, then take the first match that draws something
    # a symbol whose name is not part of another's, so typing it leaves a short list
    shorts = [s.split("/")[-1] for s in symbols]
    target = next((s for s in symbols if len(s.split("/")[-1]) > 4 and sum(1 for t in shorts if s.split("/")[-1].lower() in t.lower()) <= 3), symbols[len(symbols) // 2])
    cmd("Input.insertText", text=target.split("/")[-1]); time.sleep(0.4)
    shown_after_filter = js("[...document.querySelectorAll('[data-testid=native-library] [data-symbol]')].map(b=>b.dataset.symbol)") or []
    check("typing filters the list", 0 < len(shown_after_filter) < len(symbols) and target in shown_after_filter, f"{len(shown_after_filter)} left")
    js(f"document.querySelector('[data-testid=native-library] [data-symbol=' + {json.dumps(json.dumps(target))} + ']').scrollIntoView({{block:'nearest'}})")
    click(f"[data-testid=native-library] [data-symbol={json.dumps(target)}]"); time.sleep(0.8)
    names1, img1 = layer_names(), stage()
    print("added", target, "->", names1[:5])
    check("a new layer above the picked layer", len(names1) == len(names0) + 1 and names1[2] == re.sub(r"&#0*(\d+);?", lambda m: chr(int(m.group(1))), target.split("/")[-1]) and names1[3] == names0[2], f"{names1[:5]}")
    check("the picture shows it", img1 != img0)
    check("it is selected, with its Properties", bool(js("!!document.querySelector('[data-testid=native-props]')")))
    shot("1-symbol-added")
    click("[data-testid=undo]"); time.sleep(0.4)
    check("Undo takes the layer away", layer_names() == names0 and stage() == img0)
    # a library picture, when the Backgrounds / FX libraries have one
    click("[data-testid=add-from-library]"); time.sleep(2.5)
    pics = js("document.querySelectorAll('[data-testid=native-library] .cb-symbol-lib-pics button').length") or 0
    if pics:
        click("[data-testid=native-library] .cb-symbol-lib-pics button");
        wait("/^New layer/.test(document.querySelector('[data-testid=note]').textContent)", 30)
        check("a library picture adds a layer that shows", len(layer_names()) == len(names0) + 1 and stage() != img0, note())
        shot("2-library-picture")
        click("[data-testid=undo]"); time.sleep(0.4)
    else:
        print("(no Backgrounds / FX pictures on this server: skipped)")
        js("document.querySelector('.cb-symbol-lib-shade').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}))"); time.sleep(0.3)
    # a picture file
    click("[data-testid=add-from-library]"); time.sleep(0.4)
    set_file("[data-testid=native-upload-picture]", PNG)
    wait("/^New layer/.test(document.querySelector('[data-testid=note]').textContent)", 30)
    img3 = stage()
    check("a picture file adds a layer named after it", "red-square" in (layer_names() or [""])[0 if False else 2] and img3 != img0, f"{layer_names()[:4]} | {note()}")
    red = js("""(()=>{const c=document.querySelector('[data-testid=stage]');const d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let n=0;for(let i=0;i<d.length;i+=4)if(d[i]>200&&d[i+1]<60&&d[i+2]<70)n++;return n})()""")
    check("...and the picture is drawn (red pixels on the stage)", red > 500, f"{red} px")
    shot("3-picture-file")

    # ---------------- part 2: the scene, a picture file saved by its address
    src = [p for p in get("http://localhost:3000/api/projects") if p["id"] == SOURCE][0]["scenes"][0]["editor_data"]["objects"][0]
    sc = [p for p in get("http://localhost:3000/api/projects") if p["id"] == PROJECT][0]["scenes"][0]
    o = json.loads(json.dumps(src))
    for k in ("symbolKeys", "symbolValues", "symbolEases", "symbolLayers", "colorReplacements", "colorOverrides", "nativePose", "nativePoseFit", "partOverrides", "partKeyframes", "partReplacements", "onlyParts", "strokeScale"): o.pop(k, None)
    ed = sc["editor_data"]; ed["objects"] = [o]
    urllib.request.urlopen(urllib.request.Request(f"http://localhost:3000/api/scenes/{sc['id']}", data=json.dumps({"editor_data": ed}).encode(), method="PATCH", headers={"Content-Type": "application/json"})).read()
    def red_in_scene():
        return js("""(()=>{const c=document.querySelector('canvas[data-native-character]');if(!c||getComputedStyle(c).visibility!=='visible')return -1;const d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let n=0;for(let i=0;i<d.length;i+=4)if(d[i]>200&&d[i+1]<60&&d[i+2]<70&&d[i+3]>200)n++;return n})()""")
    cmd("Page.navigate", url=f"http://localhost:3000/editor/{PROJECT}"); time.sleep(12)
    before = red_in_scene()
    js("""(()=>{const e=document.querySelector('[title*="step inside it"]');const r=e.getBoundingClientRect();e.dispatchEvent(new MouseEvent('dblclick',{bubbles:true,cancelable:true,clientX:r.left+r.width/2,clientY:r.top+r.height*0.4,view:window}))})()""")
    check("stepped into the pose", wait("!!document.querySelector('[data-testid=native-editor] [data-testid=stage]')", 90))
    check("native editor opens in the scene", wait("!!document.querySelector('[data-testid=native-editor] [data-testid=stage]')", 90))
    time.sleep(1)
    click("[data-testid=add-from-library]"); time.sleep(0.4)
    set_file("[data-testid=native-upload-picture]", PNG)
    check("the picture file is added", wait("/^New layer/.test(document.querySelector('[data-testid=note]').textContent)", 30), note())
    click("[data-testid=native-step-out]"); time.sleep(3)
    saved = [p for p in get("http://localhost:3000/api/projects") if p["id"] == PROJECT][0]["scenes"][0]["editor_data"]["objects"][0].get("nativePose") or {}
    bitmaps = [b for e in saved.values() for b in ((e.get("library") or {}).get("bitmaps") or {}).values()]
    print("saved pictures:", [{k: (v if k != "data" else f"{len(v)} chars") for k, v in b.items()} for b in bitmaps])
    check("saved by its address, not copied into the scene", len(bitmaps) == 1 and bitmaps[0].get("url") and not bitmaps[0].get("data"), str(bitmaps[:1]))
    check("the address is the project's upload", bool(bitmaps) and urllib.request.urlopen("http://localhost:3000" + bitmaps[0]["url"] if bitmaps[0]["url"].startswith("/") else bitmaps[0]["url"]).status == 200)
    # a reload would open the pose again (the stepped-into view is kept): the scene's own drawing is what is checked
    js("Object.keys(localStorage).filter(k=>k.startsWith('cb-symbol-view')).forEach(k=>localStorage.removeItem(k))")
    cmd("Page.navigate", url=f"http://localhost:3000/editor/{PROJECT}"); time.sleep(14)
    after = red_in_scene()
    check("after a reload the scene's native drawing shows the picture", after > 200 and after > before + 200, f"red px before {before}, after {after}")
    shot("4-scene")
finally:
    chrome.terminate()
print("FAILED:" if failed else "ALL PASSED", failed)
sys.exit(1 if failed else 0)
