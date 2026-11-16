"""Find and Replace reads colours as they are drawn now: after Light/Dark, the readout and the picked colour are the darkened codes, and
replacing a darkened colour changes it.

usage: python3 shown_colour_test.py <throwaway project id> <out dir> <source project id>
Copies the first character of <source project id> (Sardar) into the throwaway scene with two Light/Dark rules already made: the jacket
#65755c darkened (fill and stroke) and its outline #384230 darkened (fill and stroke, as Light/Dark makes it: some outlines are brush fills). Checks the colour under the jacket and under its outline is
reported as the darkened code (and the original is still known), that the Find and Replace eyedropper's hover readout and picked colour show
the darkened outline code, and that replacing it with red changes the outline's rule (not a new rule that matches nothing).
"""
import base64, json, os, subprocess, sys, time, urllib.request, websocket

PROJECT, OUT, SOURCE = sys.argv[1], sys.argv[2], sys.argv[3]
os.makedirs(OUT, exist_ok=True)
chrome = subprocess.Popen(["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "--headless=new", "--remote-debugging-port=9672",
                           f"--user-data-dir={OUT}/profile-{os.getpid()}", "--window-size=1600,1000", "about:blank"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
failed = []
JACKET, JACKET_NOW, LINE, LINE_NOW = "#65755c", "#2d3527", "#384230", "#1a1f16"
try:
    for _ in range(50):
        try: tabs = json.load(urllib.request.urlopen("http://127.0.0.1:9672/json")); break
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
    def click_at(x, y):
        for kind in ("mousePressed", "mouseReleased"): cmd("Input.dispatchMouseEvent", type=kind, x=x, y=y, button="left", clickCount=1)
        time.sleep(1.2)
    def click(selector):
        r = js("(()=>{const e=document.querySelector(%s);const r=e.getBoundingClientRect();return [r.left+r.width/2,r.top+r.height/2]})()" % json.dumps(selector)); click_at(*r)
    def scene():
        return [p for p in json.load(urllib.request.urlopen("http://localhost:3000/api/projects")) if p["id"] == PROJECT][0]["scenes"][0]
    def patch(sc, ed):
        req = urllib.request.Request(f"http://localhost:3000/api/scenes/{sc['id']}", data=json.dumps({"editor_data": ed}).encode(), method="PATCH", headers={"Content-Type": "application/json"})
        urllib.request.urlopen(req).read()
    cmd("Runtime.enable"); cmd("Page.enable")

    src = [p for p in json.load(urllib.request.urlopen("http://localhost:3000/api/projects")) if p["id"] == SOURCE][0]["scenes"][0]["editor_data"]
    sc = scene(); ed = json.loads(json.dumps(sc["editor_data"]))
    ed["objects"] = [json.loads(json.dumps(src["objects"][0]))]; ed["background"] = "#ffffff"
    ed["objects"][0].pop("nativePose", None)
    ed["objects"][0]["colorReplacements"] = [
        {"id": "tone-test-1", "from": JACKET, "to": JACKET_NOW, "target": "both", "scope": "*", "match": "exact"},
        {"id": "tone-test-2", "from": LINE, "to": LINE_NOW, "target": "both", "scope": "*", "match": "exact"},
    ]
    patch(sc, ed)
    cmd("Page.navigate", url=f"http://localhost:3000/editor/{PROJECT}"); time.sleep(12)
    # the colour tools' view of the character, over a grid: where the jacket is, and where its outline is
    hits = js("""(()=>{const id=document.querySelector('[data-editor-object-id]').getAttribute('data-editor-object-id');
      const fr=(window.__CBS_COLOUR_FRAME__&&window.__CBS_COLOUR_FRAME__(id))||document.querySelector('iframe.cb-character-source-frame'); const r=fr.getBoundingClientRect(), out=[];
      for(let gy=0.3;gy<0.8;gy+=0.004)for(let gx=0.3;gx<0.7;gx+=0.004){const h=fr.contentWindow.cbColorAt(gx,gy,''); if(h&&(h.original==='%s'||h.original==='%s')) out.push([r.left+r.width*gx, r.top+r.height*gy, h.original, (h.current||'').toLowerCase()])}
      return out})()""" % (JACKET, LINE)) or []
    jacket = [h for h in hits if h[2] == JACKET]; line = [h for h in hits if h[2] == LINE]
    check("the jacket is found", bool(jacket), f"{len(jacket)} points")
    check("its colour is reported as drawn now (darkened)", bool(jacket) and all(h[3] == JACKET_NOW for h in jacket), str({h[3] for h in jacket}))
    check("the outline is found", bool(line), f"{len(line)} points")
    check("the outline is reported as drawn now (darkened)", bool(line) and all(h[3] == LINE_NOW for h in line), str({h[3] for h in line}))
    if not line: raise SystemExit(1)
    lx, ly = line[len(line) // 2][0], line[len(line) // 2][1]
    for kind in ("rawKeyDown", "keyUp"): cmd("Input.dispatchKeyEvent", type=kind, key="F", code="KeyF", windowsVirtualKeyCode=70, modifiers=12)
    time.sleep(1.5)
    check("Find and Replace opens", bool(js("!!document.querySelector('.cb-fr-dialog')")))
    click(".cb-fr-colour:nth-of-type(1) .cb-fr-pipette"); time.sleep(0.4)
    cmd("Input.dispatchMouseEvent", type="mouseMoved", x=lx, y=ly); time.sleep(0.8)
    readout = (js("(document.querySelector('.cb-fr-hover b')||{}).textContent") or "").lower()
    check("the hover readout shows the darkened outline code", readout == LINE_NOW[1:], readout)
    click_at(lx, ly)
    swatches = js("[...document.querySelectorAll('.cb-fr-swatch')].map(b=>b.getAttribute('aria-label'))") or []
    picked = swatches[0].split(": ")[1].lower() if swatches else ""
    check("the picked Find colour is the darkened outline code", picked == LINE_NOW, picked)
    click("[aria-label^='Replace with:']"); time.sleep(0.6)
    js("""((v)=>{const i=document.querySelector("input[aria-label='Colour code']");const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;set.call(i,v);i.dispatchEvent(new Event('input',{bubbles:true}))})('ff0000')""")
    time.sleep(0.5)
    js("document.querySelector('.cb-fr-replace').click()"); time.sleep(4)
    status = js("(document.querySelector('.cb-fr-status')||{}).textContent")
    rules = scene()["editor_data"]["objects"][0].get("colorReplacements") or []
    check("Replace finds it (no 'No matches')", not status, str(status))
    check("the outline's rule now gives red", any(r["id"] == "tone-test-2" and r["to"] == "#ff0000" for r in rules), str(rules))
    check("the jacket's rule is untouched", any(r["id"] == "tone-test-1" and r["to"] == JACKET_NOW for r in rules))
    check("no rule from the darkened code was added", not any(r["from"] == LINE_NOW for r in rules))
    time.sleep(1)
    now = js("""(()=>{const id=document.querySelector('[data-editor-object-id]').getAttribute('data-editor-object-id');
      const fr=(window.__CBS_COLOUR_FRAME__&&window.__CBS_COLOUR_FRAME__(id))||document.querySelector('iframe.cb-character-source-frame'); const r=fr.getBoundingClientRect();
      const h=fr.contentWindow.cbColorAt((%f-r.left)/r.width,(%f-r.top)/r.height,''); return h&&(h.current||'').toLowerCase()})()""" % (lx, ly))
    check("the outline is drawn red now", now == "#ff0000", str(now))
    open(f"{OUT}/after.png", "wb").write(base64.b64decode(cmd("Page.captureScreenshot", format="png")["data"]))
finally:
    chrome.terminate()
print("FAILED:" if failed else "ALL PASSED", failed)
sys.exit(1 if failed else 0)
