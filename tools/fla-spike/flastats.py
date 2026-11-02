"""What is inside an FLA: scenes, stage instances, symbols, tween kinds, masks, effects."""
import sys, re
import xml.etree.ElementTree as ET
from collections import Counter
from flazip import read_entries

NS = "{http://ns.adobe.com/xfl/2008/}"


def strip(tag):
    return tag.replace(NS, "")


def main(path):
    entries, _ = read_entries(path)
    doc = ET.fromstring(entries["DOMDocument.xml"])
    print("Document", doc.get("width"), "x", doc.get("height"), "fps", doc.get("frameRate", "24"), "|", doc.get("versionInfo"))
    syms = {k: ET.fromstring(v) for k, v in entries.items() if k.startswith("LIBRARY/") and k.endswith(".xml")}
    kinds = Counter(s.get("symbolType", "movie clip") for s in syms.values())
    print("Library symbols:", len(syms), dict(kinds))
    media = doc.find(NS + "media")
    print("Media:", dict(Counter(strip(m.tag) for m in media)) if media is not None else {})

    for tl in doc.iter(NS + "DOMTimeline"):
        layers = tl.findall(f"{NS}layers/{NS}DOMLayer")
        print(f"\nScene '{tl.get('name')}': {len(layers)} layers")
        for layer in layers:
            frames = layer.findall(f"{NS}frames/{NS}DOMFrame")
            span = sum(int(f.get("duration", 1)) for f in frames)
            first = frames[0] if frames else None
            insts = [e.get("libraryItemName") for e in (first.iter(NS + "DOMSymbolInstance") if first is not None else [])]
            print(f"  layer '{layer.get('name')}' type={layer.get('layerType', 'normal')} keyframes={len(frames)} frames={span} first-frame instances={insts[:4]}{'…' if len(insts) > 4 else ''}")

    # Everything, across stage + library
    every = [doc] + list(syms.values())
    tweens, tags, layer_types, loops = Counter(), Counter(), Counter(), Counter()
    edges = 0
    for root in every:
        for e in root.iter():
            t = strip(e.tag)
            tags[t] += 1
            if t == "DOMFrame" and e.get("tweenType"):
                tweens[e.get("tweenType")] += 1
            if t == "DOMLayer":
                layer_types[e.get("layerType", "normal")] += 1
            if t == "DOMSymbolInstance" and e.get("symbolType") == "graphic":
                loops[e.get("loop", "loop")] += 1
            if t == "Edge" and e.get("edges"):
                edges += 1
    print("\nTween keyframes by kind (XFL 'motion' = Classic Tween, 'motion object' = Motion Tween, 'shape' = Shape Tween):", dict(tweens))
    print("Layer types:", dict(layer_types))
    print("Graphic instance loop modes:", dict(loops))
    interesting = ["DOMShape", "Edge", "DOMSymbolInstance", "DOMBitmapInstance", "DOMStaticText", "DOMDynamicText", "DOMInputText",
                   "SolidColor", "LinearGradient", "RadialGradient", "BitmapFill", "SolidStroke", "VariablePointWidth",
                   "Color", "DropShadowFilter", "GlowFilter", "BlurFilter", "AdjustColorFilter", "BevelFilter",
                   "ShapeHint", "AnimationCore", "Ease", "CustomEase", "DOMRigArmatureNode", "Actionscript", "DOMSoundItem", "DOMGroup", "MorphShape", "MorphSegment"]
    print("Element counts:", {k: tags[k] for k in interesting if tags[k]})
    blend = Counter(e.get("blendMode") for r in every for e in r.iter(NS + "DOMSymbolInstance") if e.get("blendMode"))
    if blend:
        print("Blend modes:", dict(blend))
    print("Shapes with edges:", edges)


if __name__ == "__main__":
    main(sys.argv[1])
