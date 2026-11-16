"""A real MP4 through the Docker render worker draws a character's native pose and its part edits (Step 1).

usage: python3 mp4_render_test.py <throwaway project id> <out dir> <source project id>
Seeds the throwaway scene with the source's first character (Sardar) drawn natively, renders an MP4 through the worker
(POST /api/projects/<id>/render), then the same with a part edit on the head (moved and turned), and compares a frame of each
(taken with the worker's ffmpeg): the edit must change the head area, and both videos must be real, non-empty MP4s.
"""
import io, json, os, subprocess, sys, time, urllib.request, websocket
from PIL import Image, ImageChops

PROJECT, OUT, SOURCE = sys.argv[1], sys.argv[2], sys.argv[3]
os.makedirs(OUT, exist_ok=True)
WORKER = "characterbazaarstudio_mvp_v112-worker-1"
failed = []
def check(name, ok, detail=""):
    print(("PASS " if ok else "FAIL ") + name, detail)
    if not ok: failed.append(name)
get = lambda u: json.load(urllib.request.urlopen(u))
def post(u, body):
    req = urllib.request.Request(u, data=json.dumps(body).encode(), method="POST", headers={"Content-Type": "application/json"})
    return json.load(urllib.request.urlopen(req))
def scene(): return [p for p in get("http://localhost:3000/api/projects") if p["id"] == PROJECT][0]["scenes"][0]
def patch(ed):
    req = urllib.request.Request(f"http://localhost:3000/api/scenes/{scene()['id']}", data=json.dumps({"editor_data": ed}).encode(), method="PATCH", headers={"Content-Type": "application/json"})
    urllib.request.urlopen(req).read()

def head_key():
    """The head's part key, as the player names it (cbPartAt near the top of the character)."""
    chrome = subprocess.Popen(["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "--headless=new", "--remote-debugging-port=9674",
                               f"--user-data-dir={OUT}/profile-{os.getpid()}", "--window-size=1600,1000", "about:blank"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        for _ in range(50):
            try: tabs = get("http://127.0.0.1:9674/json"); break
            except Exception: time.sleep(0.2)
        ws = websocket.create_connection([t for t in tabs if t["type"] == "page"][0]["webSocketDebuggerUrl"], timeout=120)
        n = [0]
        def cmd(m, **p):
            n[0] += 1; ws.send(json.dumps({"id": n[0], "method": m, "params": p}))
            while True:
                msg = json.loads(ws.recv())
                if msg.get("id") == n[0]: return msg.get("result", msg)
        cmd("Page.enable"); cmd("Page.navigate", url=f"http://localhost:3000/editor/{PROJECT}"); time.sleep(12)
        keys = cmd("Runtime.evaluate", returnByValue=True, expression="(()=>{const w=document.querySelector('iframe.cb-character-source-frame').contentWindow;const out=[];for(const [x,y] of [[0.5,0.12],[0.5,0.16],[0.45,0.14],[0.55,0.14]]){try{const r=w.cbPartAt(x,y);if(r) out.push(r.key||r)}catch(e){}}return out})()").get("result", {}).get("value") or []
        return keys[0] if keys else "head"
    finally:
        chrome.terminate()

def render(label):
    job = post(f"http://localhost:3000/api/projects/{PROJECT}/render", {"format": "mp4", "resolution": "hd"})
    t0 = time.time()
    while time.time() - t0 < 600:
        time.sleep(5)
        j = [r for r in get("http://localhost:3000/api/renders") if r["id"] == job["id"]][0]
        if j["status"] in ("complete", "failed"): break
    print(f"{label}: {j['status']} in {time.time() - t0:.0f}s", j.get("output_url"), (j.get("error") or "")[:300])
    return j

def frame_of(job, label, t=0.5):
    name = os.path.basename(job["output_url"])
    inside = f"/app/media/{name}"
    probe = subprocess.run(["docker", "exec", WORKER, "ffprobe", "-v", "error", "-show_entries", "format=duration:stream=codec_name,width,height,nb_frames", "-of", "json", inside], capture_output=True, text=True).stdout
    info = json.loads(probe or "{}")
    subprocess.run(["docker", "exec", WORKER, "ffmpeg", "-y", "-loglevel", "error", "-ss", str(t), "-i", inside, "-frames:v", "1", f"/tmp/{label}.png"], check=True)
    subprocess.run(["docker", "cp", f"{WORKER}:/tmp/{label}.png", f"{OUT}/{label}.png"], check=True)
    return Image.open(f"{OUT}/{label}.png").convert("RGB"), info

src = [p for p in get("http://localhost:3000/api/projects") if p["id"] == SOURCE][0]["scenes"][0]["editor_data"]["objects"][0]
def seed(edit):
    sc = scene(); ed = json.loads(json.dumps(sc["editor_data"])); o = json.loads(json.dumps(src))
    for k in ("symbolKeys", "symbolValues", "symbolEases", "symbolLayers", "colorReplacements", "nativePose", "partOverrides", "partKeyframes"): o.pop(k, None)
    o["nativePose"] = {"Sardar_01": {"format": "cb-native-pose-edits", "version": 2, "source": "", "symbols": {}}}
    if edit: o["partOverrides"] = edit
    ed["objects"] = [o]; ed["background"] = "#ffffff"
    patch(ed)

seed(None)
key = head_key(); print("head part:", key)
a = render("plain")
check("the plain render completes", a["status"] == "complete", a.get("error", "")[:200])
seed({key: {"offsetX": 70, "offsetY": -30, "rotation": 22}})
b = render("edited")
check("the edited render completes", b["status"] == "complete", b.get("error", "")[:200])
if not failed:
    fa, ia = frame_of(a, "plain"); fb, ib = frame_of(b, "edited")
    print("plain:", ia); print("edited:", ib)
    s = ia.get("streams", [{}])[0]
    check("it is an h264 video with frames", s.get("codec_name") == "h264" and float(ia.get("format", {}).get("duration", 0)) > 0.5, str(s))
    ink = sum(1 for p in fa.resize((320, 180)).getdata() if sum(p) < 600)
    check("the character is drawn in the video", ink > 300, f"{ink} ink pixels of 57600")
    d = ImageChops.difference(fa, fb).convert("L"); w, h = d.size
    bbox = d.point(lambda v: 255 if v > 40 else 0).getbbox()
    changed = sum(1 for v in d.resize((320, 180)).getdata() if v > 40)
    check("the head edit changes the picture", changed > 50, f"{changed} changed pixels, box {bbox}")
    check("and only near the top of the character (the head), not everywhere", bool(bbox) and bbox[3] < h * 0.75, str(bbox))
print("FAILED:" if failed else "ALL PASSED", failed)
sys.exit(1 if failed else 0)
