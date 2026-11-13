"""usage: seed_legacy.py <throwaway project id> <index in legacy_objects.json> [json path]
Puts one set of old edits (copied from a real project) on the first object of a THROWAWAY scene, and clears its native edits."""
import json, sys, urllib.request
PROJECT, INDEX = sys.argv[1], int(sys.argv[2])
SOURCE = sys.argv[3] if len(sys.argv) > 3 else "/private/tmp/claude-501/-Users-amazdraw-Downloads-CharacterBazaarStudio-MVP-v112/e20824a2-161c-45d0-b24c-cb95fad8f3b3/scratchpad/legacy_objects.json"
old = json.load(open(SOURCE))[INDEX]
ps = json.load(urllib.request.urlopen("http://localhost:3000/api/projects"))
sc = [p for p in ps if p["id"] == PROJECT][0]["scenes"][0]
ed = sc["editor_data"]; o = ed["objects"][0]
for k in ("nativePose", "nativePoseFit", "symbolKeys", "symbolValues", "symbolEases", "symbolLayers"): o.pop(k, None)
for k in ("symbolKeys", "symbolValues", "symbolEases", "symbolLayers"):
    if old.get(k): o[k] = old[k]
req = urllib.request.Request(f"http://localhost:3000/api/scenes/{sc['id']}", data=json.dumps({"editor_data": ed}).encode(), method="PATCH", headers={"Content-Type": "application/json"})
urllib.request.urlopen(req).read(); print("seeded", old["name"], [k for k in ("symbolKeys", "symbolValues", "symbolEases", "symbolLayers") if old.get(k)])
