"""Load /native-lab in headless Chrome, open an .fla, save the canvas at given frames as PNGs."""
import json, sys, time, base64, subprocess, urllib.request, websocket

FLA, OUT = sys.argv[1], sys.argv[2]
import os
IDX = int(os.environ.get('IDX','0'))
frames = [int(x) for x in sys.argv[3].split(",")]
pose_index = int(sys.argv[4]) if len(sys.argv) > 4 else 0
chrome = subprocess.Popen(["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "--headless=new", "--remote-debugging-port=9444",
                           f"--user-data-dir={OUT}/profile", "--window-size=1300,1000", "about:blank"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
try:
    for _ in range(50):
        try:
            tabs = json.load(urllib.request.urlopen("http://127.0.0.1:9444/json")); break
        except Exception:
            time.sleep(0.2)
    ws = websocket.create_connection([t for t in tabs if t["type"] == "page"][0]["webSocketDebuggerUrl"], timeout=300)
    n = [0]
    def cmd(method, **params):
        n[0] += 1; ws.send(json.dumps({"id": n[0], "method": method, "params": params}))
        while True:
            msg = json.loads(ws.recv())
            if msg.get("method") == "Runtime.exceptionThrown":
                print("EXC", msg["params"]["exceptionDetails"].get("exception", {}).get("description", "")[:400])
            if msg.get("id") == n[0]:
                return msg.get("result", msg)
    def js(e):
        r = cmd("Runtime.evaluate", expression=e, returnByValue=True, awaitPromise=True)
        if r.get("exceptionDetails"):
            print("JS error:", r["exceptionDetails"].get("exception", {}).get("description", "")[:600])
        return r.get("result", {}).get("value")
    cmd("Runtime.enable"); cmd("Page.enable"); cmd("DOM.enable")
    cmd("Page.navigate", url="http://localhost:3000/native-lab"); time.sleep(6)
    root = cmd("DOM.getDocument")["root"]["nodeId"]
    node = cmd("DOM.querySelector", nodeId=root, selector="input[type=file]")["nodeId"]
    cmd("DOM.setFileInputFiles", files=[FLA], nodeId=node)
    for _ in range(120):
        time.sleep(1)
        if js("!!document.querySelector('canvas')"): break
    if os.environ.get("REMATCH"):
        print(js("window.__rematch && window.__rematch()"))
    if os.environ.get("REMATCH"):
        urls = js("""(()=>{const out=[];for(const p of window.__pairs||[]){const c=document.createElement('canvas');c.width=800;c.height=400;const x=c.getContext('2d');x.fillStyle='#fff';x.fillRect(0,0,800,400);const mk=(d,ox)=>{const t=document.createElement('canvas');t.width=400;t.height=400;t.getContext('2d').putImageData(d,0,0);x.drawImage(t,ox,0)};mk(p.before,0);mk(p.after,400);out.push({u:c.toDataURL('image/png'),d:p.d,n:p.name})}return out})()""")
        for i, r in enumerate(urls or []):
            open(f"{OUT}/tween_{i}.png", "wb").write(base64.b64decode(r["u"].split(",")[1])); print("tween", i, r["n"], round(r["d"], 1))
    if len(sys.argv) > 5:
        nodes = cmd("DOM.querySelectorAll", nodeId=root, selector="input[type=file]")["nodeIds"]
        cmd("DOM.setFileInputFiles", files=[sys.argv[5]], nodeId=nodes[1])
        for _ in range(240):
            time.sleep(1)
            r = js("document.getElementById('report')?.textContent || ''")
            if r and r != "Comparing…": print(r); break
    if len(sys.argv) > 5:
        for i, nm in enumerate(["native", "publish"]):
            u = js(f"window.__cmp[{IDX}].{nm}.toDataURL('image/png')")
            open(f"{OUT}/cmp_{nm}.png", "wb").write(base64.b64decode(u.split(",")[1]))
    print("status:", js("document.querySelector('main div:nth-of-type(1)')?.textContent || document.body.innerText.slice(0,200)"))
    setter = "(i,v)=>{const el=document.querySelectorAll('input[type=range]')[0];Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,String(v));el.dispatchEvent(new Event('input',{bubbles:true}));}"
    if pose_index:
        js(f"(()=>{{const s=document.querySelector('select');const o=s.options[{pose_index}];Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(s,o.value);s.dispatchEvent(new Event('change',{{bubbles:true}}));}})()")
        time.sleep(1)
    for f in frames:
        js(f"({setter})(0,{f})"); time.sleep(0.6)
        res = js("(()=>{const c=document.querySelector('canvas');return {url:c.toDataURL('image/png'),ms:c.dataset.ms,missing:c.dataset.missing}})()")
        open(f"{OUT}/frame_{pose_index}_{f}.png", "wb").write(base64.b64decode(res["url"].split(",")[1]))
        print("frame", f, "ms", res["ms"], "missing", res["missing"])
finally:
    chrome.terminate()
