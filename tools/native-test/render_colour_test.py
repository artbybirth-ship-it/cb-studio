"""Colour rules in a real render: the worker renders one frame of the scene without and with a Recolour rule, and an MP4.

usage: python3 render_colour_test.py frame <project id> <scene id> <out dir>   (needs Sardar with native edits first: run swap_part_test.py)
       python3 render_colour_test.py mp4 <project id> <scene id>
Checks the green pixels of the frame (0 without the rule, thousands with it). Use a throwaway project: the rule is written to it.
"""
import json,urllib.request,time,sys
from io import BytesIO
from PIL import Image
P, SC = sys.argv[2], sys.argv[3]
API="http://localhost:3000/api"
def j(u,data=None,method=None):
    r=urllib.request.Request(u,data=json.dumps(data).encode() if data is not None else None,method=method,headers={"Content-Type":"application/json"})
    return json.load(urllib.request.urlopen(r))
def scene(): return [p for p in j(f"{API}/projects") if p['id']==P][0]['scenes'][0]
def set_rule(rules):
    sc=scene(); ed=sc['editor_data']; ed['objects'][0]['colorReplacements']=rules
    j(f"{API}/scenes/{sc['id']}",{"editor_data":ed},"PATCH")
def render(tag,fmt="png",t=0.5):
    job=j(f"{API}/projects/{P}/render",{"format":fmt,"scene":SC,"time":t,"resolution":"720p"} if fmt=="png" else {"format":fmt,"scene":SC,"resolution":"720p"},"POST")
    for _ in range(240):
        job=j(f"{API}/renders/{job['id']}")
        if job['status'] in("complete","failed"): break
        time.sleep(2)
    print(tag,job['status'],job.get('error','')[:200],job.get('output_url'))
    return job
def green(img):
    px=img.convert("RGB").getdata(); return sum(1 for r,g,b in px if g>200 and r<60 and b<60)
if sys.argv[1]=="frame":
    set_rule([]); a=render("no-rule"); 
    ia=Image.open(BytesIO(urllib.request.urlopen("http://localhost:3000"+a['output_url']).read())); 
    # the colour most used by the character in the unruled frame (not the white background), turned green as a family
    from collections import Counter
    count = Counter(p for p in ia.convert("RGB").resize((480, 270)).getdata() if min(p) < 225 and not (p[1] > 200 and p[0] < 80 and p[2] < 80))
    dominant = "#%02x%02x%02x" % count.most_common(1)[0][0]
    print("dominant colour", dominant)
    set_rule([{"id":"t1","from":dominant,"to":"#00ff00","target":"both","scope":"*","match":"shades"}]); b=render("with-rule")
    ib=Image.open(BytesIO(urllib.request.urlopen("http://localhost:3000"+b['output_url']).read()))
    ia.save(sys.argv[4]+"/frame-no-rule.png"); ib.save(sys.argv[4]+"/frame-rule.png")
    ga, gb = green(ia), green(ib)
    print(("PASS " if ga == 0 and gb > 1000 else "FAIL ") + "the worker draws the colour rule", ia.size, "green px without rule", ga, "with rule", gb)
    sys.exit(0 if ga == 0 and gb > 1000 else 1)
if sys.argv[1]=="mp4":
    job=render("mp4","mp4"); print(job['output_url'])
