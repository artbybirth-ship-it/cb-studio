"""Spike: convert an FLA (XFL in a ZIP) into a JSON scene graph a canvas renderer can play.

Shapes become closed fill contours and stroke paths (px); symbols keep their layers, keyframes,
classic tweens (with eases), shape tweens (Animate's own MorphShape curves) and masks.
"""
import sys, json, re, math
import xml.etree.ElementTree as ET
from flazip import read_entries

NS = "{http://ns.adobe.com/xfl/2008/}"
T = lambda tag: NS + tag


# ---------- numbers ----------
def num(s):
    """XFL number: decimal, or '#hex.hexfrac' (two's complement integer part)."""
    s = s.strip()
    if not s.startswith("#"):
        return float(s)
    whole, _, frac = s[1:].partition(".")
    value = int(whole or "0", 16)
    bits = 4 * len(whole)
    if bits >= 24 and value >= 1 << (bits - 1):
        value -= 1 << bits
    return value + (int(frac, 16) / (16 ** len(frac)) if frac else 0.0)


def matrix(el):
    m = el.find(f"{T('matrix')}/{T('Matrix')}") if el is not None else None
    if m is None:
        return [1, 0, 0, 1, 0, 0]
    return [float(m.get("a", 1)), float(m.get("b", 0)), float(m.get("c", 0)), float(m.get("d", 1)), float(m.get("tx", 0)), float(m.get("ty", 0))]


def color(hexstr, alpha):
    return [hexstr or "#000000", float(alpha if alpha is not None else 1)]


# ---------- edges ----------
TOKEN = re.compile(r"[!|/\[\]]|S\d+|#[0-9A-Fa-f]+(?:\.[0-9A-Fa-f]+)?|-?\d+(?:\.\d+)?")


def parse_edges(text):
    """Edge string -> list of pieces (each one segment): ('L', p0, p1) or ('Q', p0, c, p1); twips."""
    toks = TOKEN.findall(text)
    pieces, cur, i = [], None, 0
    while i < len(toks):
        t = toks[i]
        if t == "!":
            cur = (num(toks[i + 1]), num(toks[i + 2])); i += 3
        elif t in ("|", "/"):
            p = (num(toks[i + 1]), num(toks[i + 2])); pieces.append(("L", cur, p)); cur = p; i += 3
        elif t in ("[", "]"):
            c = (num(toks[i + 1]), num(toks[i + 2])); p = (num(toks[i + 3]), num(toks[i + 4]))
            pieces.append(("Q", cur, c, p)); cur = p; i += 5
        else:  # S<n> style markers
            i += 1
    return pieces


def reverse(piece):
    return ("L", piece[2], piece[1]) if piece[0] == "L" else ("Q", piece[3], piece[2], piece[1])


def key(p):
    return (round(p[0] * 4), round(p[1] * 4))


def to_cmds(chain):
    """Chain of pieces -> [['M',x,y], ['L',x,y] | ['Q',cx,cy,x,y]] in px."""
    px = lambda v: round(v / 20, 3)
    out = [["M", px(chain[0][1][0]), px(chain[0][1][1])]]
    for pc in chain:
        if pc[0] == "L":
            out.append(["L", px(pc[2][0]), px(pc[2][1])])
        else:
            out.append(["Q", px(pc[2][0]), px(pc[2][1]), px(pc[3][0]), px(pc[3][1])])
    return out


def contours(pieces):
    """Join oriented pieces end-to-start into closed loops (open leftovers are kept as they are)."""
    starts = {}
    for idx, pc in enumerate(pieces):
        starts.setdefault(key(pc[1]), []).append(idx)
    used, loops = [False] * len(pieces), []
    for idx in range(len(pieces)):
        if used[idx]:
            continue
        used[idx] = True
        chain = [pieces[idx]]
        first = key(pieces[idx][1])
        while key(chain[-1][-1]) != first:
            nxt = next((j for j in starts.get(key(chain[-1][-1]), []) if not used[j]), None)
            if nxt is None:
                break
            used[nxt] = True
            chain.append(pieces[nxt])
        loops.append(to_cmds(chain))
    return loops


def stroke_paths(pieces):
    """Consecutive pieces that touch become one polyline (fewer joins than piece by piece)."""
    out, chain = [], []
    for pc in pieces:
        if chain and key(chain[-1][-1]) == key(pc[1]):
            chain.append(pc)
        else:
            if chain:
                out.append(to_cmds(chain))
            chain = [pc]
    if chain:
        out.append(to_cmds(chain))
    return out


def fill_style(el):
    for kind in ("SolidColor", "LinearGradient", "RadialGradient", "BitmapFill"):
        f = el.find(T(kind))
        if f is None:
            continue
        if kind == "SolidColor":
            return {"t": "solid", "c": color(f.get("color"), f.get("alpha"))}
        if kind == "BitmapFill":
            return {"t": "solid", "c": ["#999999", 1], "bitmap": f.get("bitmapPath")}
        stops = [[float(g.get("ratio", 0)), *color(g.get("color"), g.get("alpha"))] for g in f.findall(T("GradientEntry"))]
        return {"t": "linear" if kind == "LinearGradient" else "radial", "m": matrix(f), "stops": stops,
                "spread": f.get("spreadMethod", "pad"), "focal": float(f.get("focalPointRatio", 0))}
    return {"t": "solid", "c": ["#000000", 0]}


def stroke_style(el):
    s = next(iter(el), None)
    if s is None:
        return None
    fill = s.find(T("fill"))
    out = {"w": float(s.get("weight", 1)), "caps": s.get("caps", "round"), "joints": s.get("joints", "round"),
           "miter": float(s.get("miterLimit", 3)), "scale": s.get("scaleMode", "normal"),
           "fill": fill_style(fill) if fill is not None else {"t": "solid", "c": ["#000000", 1]}}
    if s.tag == T("PaintBrushStroke"):  # art brush: artwork stretched along the stroke
        out["brush"] = s.get("paintBrushDefinition")
    return out


def brushes(xml):
    out = {}
    if not xml:
        return out
    for b in ET.fromstring(xml):
        try:
            p = json.loads(b.get("brushParam") or "{}")
        except ValueError:
            continue
        out[b.get("index")] = {"type": p.get("FlashPaintBrushType"), "svg": p.get("svgData"), "diameter": float(p.get("diameter", 64)),
                               "flip": p.get("flipArt") == "true", "direction": p.get("artDirection")}
    return out


def shape(el):
    fills = {int(f.get("index")): fill_style(f) for f in el.findall(f"{T('fills')}/{T('FillStyle')}")}
    strokes = {int(s.get("index")): stroke_style(s) for s in el.findall(f"{T('strokes')}/{T('StrokeStyle')}")}
    by_fill, by_stroke = {}, {}
    for e in el.findall(f"{T('edges')}/{T('Edge')}"):
        text = e.get("edges")
        if not text:
            continue
        pieces = parse_edges(text)
        f0, f1, s = int(e.get("fillStyle0", 0)), int(e.get("fillStyle1", 0)), int(e.get("strokeStyle", 0))
        if f1:
            by_fill.setdefault(f1, []).extend(pieces)
        if f0:
            by_fill.setdefault(f0, []).extend(reverse(p) for p in reversed(pieces))
        if s:
            by_stroke.setdefault(s, []).extend(pieces)
    return {
        "k": "shape", "m": matrix(el),
        "fills": [{"style": fills.get(i, {"t": "solid", "c": ["#000", 0]}), "paths": contours(p)} for i, p in sorted(by_fill.items())],
        "strokes": [{"style": strokes[i], "paths": stroke_paths(p)} for i, p in sorted(by_stroke.items()) if strokes.get(i)],
        # Fill / stroke styles by their index, for shape tweens.
        "fillStyles": {str(i): v for i, v in fills.items()}, "strokeStyles": {str(i): v for i, v in strokes.items() if v},
    }


def instance(el):
    tp = el.find(f"{T('transformationPoint')}/{T('Point')}")
    col = el.find(f"{T('color')}/{T('Color')}")
    out = {"k": "inst", "lib": el.get("libraryItemName"), "st": el.get("symbolType", "movie clip"), "m": matrix(el),
           "pivot": [float(tp.get("x", 0)), float(tp.get("y", 0))] if tp is not None else [0, 0],
           "loop": el.get("loop", "loop"), "first": int(el.get("firstFrame", 0))}
    if col is not None:
        out["alpha"] = float(col.get("alphaMultiplier", 1))
    if el.get("blendMode"):
        out["blend"] = el.get("blendMode")
    if el.get("isVisible") == "false":
        out["hidden"] = True
    return out


def elements(container):
    out = []
    if container is None:
        return out
    for el in container:
        tag = el.tag.replace(NS, "")
        if tag == "DOMShape":
            out.append(shape(el))
        elif tag == "DOMSymbolInstance":
            out.append(instance(el))
        elif tag == "DOMGroup":  # members carry their own (timeline-space) matrices
            out.extend(elements(el.find(T("members"))))
        elif tag == "DOMBitmapInstance":
            out.append({"k": "bitmap", "lib": el.get("libraryItemName"), "m": matrix(el)})
    return out


def morph(el):
    segs = []
    for s in el.iter(T("MorphSegment")):
        pa = [num(v) for v in s.get("startPointA").split(",")]
        pb = [num(v) for v in s.get("startPointB").split(",")]
        curves = []
        for c in s.findall(T("MorphCurves")):
            v = lambda n: [num(x) * 256 / 20 for x in c.get(n).split(",")]
            curves.append([1 if c.get("isLine") == "true" else 0, *v("controlPointA"), *v("anchorPointA"), *v("controlPointB"), *v("anchorPointB")])
        segs.append({"a": [pa[0] * 12.8, pa[1] * 12.8], "b": [pb[0] * 12.8, pb[1] * 12.8], "c": curves,
                     "f1": int(s.get("fillIndex1", -1)), "f2": int(s.get("fillIndex2", -1)), "s1": int(s.get("strokeIndex1", -1)), "s2": int(s.get("strokeIndex2", -1))})
    return segs


def ease(frame):
    tw = frame.find(T("tweens"))
    if tw is not None:
        ce = tw.find(T("CustomEase"))
        if ce is not None:
            return {"custom": [[float(p.get("x", 0)), float(p.get("y", 0))] for p in ce.findall(T("Point"))]}
        e = tw.find(T("Ease"))
        if e is not None:
            return {"intensity": float(e.get("intensity", 0)), "method": e.get("method")}
    if frame.get("easeMethodName"):
        return {"method": frame.get("easeMethodName")}
    return {"intensity": float(frame.get("acceleration", 0))}


def timeline(tl):
    layers = []
    for layer in tl.findall(f"{T('layers')}/{T('DOMLayer')}"):
        frames = []
        for f in layer.findall(f"{T('frames')}/{T('DOMFrame')}"):
            fr = {"i": int(f.get("index", 0)), "d": int(f.get("duration", 1)), "els": elements(f.find(T("elements")))}
            if f.get("tweenType"):
                fr["tw"] = f.get("tweenType")
                fr["ease"] = ease(f)
                if f.get("motionTweenRotate"):
                    fr["rot"] = [f.get("motionTweenRotate"), int(f.get("motionTweenRotateTimes", 0))]
                ms = f.find(T("MorphShape"))
                if ms is not None:
                    fr["morph"] = morph(ms)
            frames.append(fr)
        layers.append({"name": layer.get("name"), "type": layer.get("layerType", "normal"),
                       "parent": int(layer.get("parentLayerIndex")) if layer.get("parentLayerIndex") else None,
                       "hidden": layer.get("visible") == "false", "frames": frames})
    length = max([fr["i"] + fr["d"] for l in layers for fr in l["frames"]] or [1])
    return {"name": tl.get("name"), "layers": layers, "length": length}


def convert(path):
    entries, problems = read_entries(path)
    doc = ET.fromstring(entries["DOMDocument.xml"])
    symbols = {}
    for k, v in entries.items():
        if not (k.startswith("LIBRARY/") and k.endswith(".xml")):
            continue
        root = ET.fromstring(v)
        if root.tag != T("DOMSymbolItem"):
            continue
        tl = root.find(f"{T('timeline')}/{T('DOMTimeline')}")
        symbols[root.get("name")] = {"type": root.get("symbolType", "movie clip"), "tl": timeline(tl)}
    scenes = [timeline(tl) for tl in doc.findall(f"{T('timelines')}/{T('DOMTimeline')}")]
    return {"w": float(doc.get("width", 550)), "h": float(doc.get("height", 400)), "fps": float(doc.get("frameRate", 24)),
            "bg": doc.get("backgroundColor", "#FFFFFF"), "scenes": scenes, "symbols": symbols, "problems": problems,
            "brushes": brushes(entries.get("PaintBrushDefinitions.xml"))}


if __name__ == "__main__":
    data = convert(sys.argv[1])
    json.dump(data, open(sys.argv[2], "w"), separators=(",", ":"))
    print("symbols", len(data["symbols"]), "scenes", len(data["scenes"]), "bytes", len(json.dumps(data, separators=(",", ":"))))
