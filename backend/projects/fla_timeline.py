"""
Animate source timelines for "step inside a character" (frontend/lib/server/flaTimeline.ts is the
same reader for the desktop app; keep the two in step).

An uploaded character package that includes the .fla gets, per document, a folder
cb-fla-timeline/<document>/ with index.json and one <JsName>.json per symbol: every layer (name,
type, folder / mask nesting, Animate's visible / locked / colour) and every keyframe (frame,
length, tween, ease, label, sound, what it holds). Animate isn't needed: a .fla is a zip of XML.

Each symbol is linked to its published HTML5 Canvas class (lib.<JsName> in the export .js), and
each layer to the display objects its code creates (Animate writes "// <layer name>" before every
layer's code), so the editor can play a symbol and show or hide one layer's parts. Names alone
don't link the two — Animate renames clashing symbols on publish ("Symbol 1" and "Folder/Symbol 1"
become Symbol1 and Symbol1_1) — so the link is followed down from the stage, layer by layer.
"""
from __future__ import annotations

import html
import io
import json
import re
import struct
import zipfile
from pathlib import Path
from typing import Any

FLA_TIMELINE_VERSION = 1
FLA_TIMELINE_DIR = "cb-fla-timeline"


def _open_fla(data: bytes) -> zipfile.ZipFile:
    """The .fla as a zip. Animate sometimes writes a central-directory size that is too large;
    Python refuses such a file (unzip copes), so the size is corrected when the directory is
    found at its stated offset."""
    try:
        return zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile:
        end = data.rfind(b"PK\x05\x06")
        if end < 0:
            raise
        size, offset = struct.unpack("<II", data[end + 12:end + 20])
        if data[offset:offset + 4] != b"PK\x01\x02" or offset + size == end:
            raise
        fixed = bytearray(data)
        fixed[end + 12:end + 16] = struct.pack("<I", end - offset)
        return zipfile.ZipFile(io.BytesIO(bytes(fixed)))


def _attrs(tag: str) -> dict[str, str]:
    return {key: html.unescape(value) for key, value in re.findall(r'([A-Za-z_:][\w:.-]*)="([^"]*)"', tag)}


def _name(value: str) -> str:
    """Library names arrive escaped twice for items imported from Illustrator ("&#060Path&#062")."""
    return html.unescape(value)


def _blocks(xml: str, name: str) -> list[tuple[dict[str, str], str]]:
    """<name …>body</name> and <name …/> elements (not nested in themselves), with attributes."""
    output = []
    pattern = re.compile(rf"<{name}\b([^>]*?)(/?)>")
    pos = 0
    while True:
        match = pattern.search(xml, pos)
        if not match:
            return output
        if match.group(2) == "/":
            output.append((_attrs(match.group(1)), ""))
            pos = match.end()
            continue
        close = xml.find(f"</{name}>", match.end())
        if close < 0:
            return output
        output.append((_attrs(match.group(1)), xml[match.end():close]))
        pos = close + len(name) + 3


def _ease(attrs: dict[str, str], body: str) -> Any:
    if "<CustomEase" in body:
        return "custom"
    named = re.search(r'<Ease\b[^>]*\bmethod="([^"]+)"', body)
    if named:
        return named.group(1)
    if "acceleration" in attrs:
        try:
            return int(float(attrs["acceleration"]))
        except ValueError:
            return None
    return None


TWEENS = {"motion": "classic", "shape": "shape", "motion object": "motion"}


def _timeline(xml: str) -> dict[str, Any]:
    """Layers (top to bottom, as Animate lists them) and their keyframes."""
    layers = []
    for attrs, body in _blocks(xml, "DOMLayer"):
        frames = []
        for frame_attrs, frame_body in _blocks(body, "DOMFrame"):
            elements = re.sub(r"<tweens>.*?</tweens>", "", frame_body, flags=re.S)
            symbols: list[str] = []
            # The published code creates a frame's objects top first; the .fla lists them bottom first.
            for item in reversed(re.findall(r'<DOMSymbolInstance\b[^>]*\blibraryItemName="([^"]*)"', elements)):
                item = _name(html.unescape(item))
                if item not in symbols:
                    symbols.append(item)
            entry: dict[str, Any] = {"i": int(frame_attrs.get("index", 0)), "d": int(frame_attrs.get("duration", 1))}
            tween = TWEENS.get(frame_attrs.get("tweenType", ""))
            if tween:
                entry["tween"] = tween
                ease = _ease(frame_attrs, frame_body)
                if ease not in (None, 0):
                    entry["ease"] = ease
            if frame_attrs.get("name"):
                entry["label"] = frame_attrs["name"]
            if frame_attrs.get("soundName"):
                entry["sound"] = frame_attrs["soundName"]
            if symbols:
                entry["symbols"] = symbols
            counts = {
                "shapes": len(re.findall(r"<DOMShape\b", elements)),
                "texts": len(re.findall(r"<DOM(?:Static|Dynamic|Input)Text\b", elements)),
                "bitmaps": len(re.findall(r"<DOMBitmapInstance\b", elements)),
            }
            entry.update({key: value for key, value in counts.items() if value})
            if not symbols and not any(counts.values()) and "sound" not in entry:
                entry["blank"] = True
            frames.append(entry)
        layer: dict[str, Any] = {"name": attrs.get("name", ""), "type": attrs.get("layerType", "normal")}
        if "parentLayerIndex" in attrs:
            layer["parent"] = int(attrs["parentLayerIndex"])
        if attrs.get("color"):
            layer["color"] = attrs["color"]
        if attrs.get("visible") == "false":
            layer["hidden"] = True
        if attrs.get("locked") == "true":
            layer["locked"] = True
        if attrs.get("outline") == "true":
            layer["outline"] = True
        layer["frames"] = frames
        layers.append(layer)
    length = max([frame["i"] + frame["d"] for layer in layers for frame in layer["frames"]] or [1])
    return {"frames": length, "layers": layers}


def _js_classes(js_text: str) -> dict[str, list[dict[str, Any]]]:
    """Each published MovieClip class's layers: "// name" comments, in order, with the display
    objects (this.x = …) and library symbols (new lib.Y(…)) each layer's code creates."""
    classes: dict[str, list[dict[str, Any]]] = {}
    for match in re.finditer(r"\(lib\.([A-Za-z0-9_$]+) = function\(mode,startPosition,loop", js_text):
        end = js_text.find("}).prototype", match.end())  # "= p = new cjs.MovieClip()" or getMCSymbolPrototype(…)
        body = js_text[match.end(): end if end >= 0 else None]
        layers: list[dict[str, Any]] = []
        current: dict[str, Any] | None = None
        for line in body.split("\n"):
            comment = re.match(r"^\t// (.+?)\s*$", line)
            if comment and not comment.group(1).endswith(":"):
                name = re.sub(r" \((?:mask|guide)\)$", "", comment.group(1))
                current = {"name": name, "mask": comment.group(1).endswith("(mask)"), "props": [], "symbols": [], "classes": {}}
                layers.append(current)
                continue
            if current is None:
                continue
            for prop in re.findall(r"\bthis\.([A-Za-z0-9_$]+) = new ", line):
                if prop not in current["props"]:
                    current["props"].append(prop)
            for prop, symbol in re.findall(r"\bthis\.([A-Za-z0-9_$]+) = new lib\.([A-Za-z0-9_$]+)\(", line):
                current["classes"][prop] = symbol
            for symbol in re.findall(r"new lib\.([A-Za-z0-9_$]+)\(", line):
                if symbol not in current["symbols"]:
                    current["symbols"].append(symbol)
        classes[match.group(1)] = layers
    return classes


def _plain(name: str) -> str:
    return re.sub(r"[^A-Za-z0-9_$]", "", name.split("/")[-1])


def _may_be(js_name: str, xfl_name: str) -> bool:
    plain = _plain(xfl_name)
    return js_name == plain or bool(re.fullmatch(re.escape(plain) + r"_\d+", js_name))


def _align(xfl_layers: list[dict[str, Any]], js_layers: list[dict[str, Any]]) -> list[tuple[int, int]]:
    """(xfl index, js index) of the layers whose code Animate wrote, in order, by name."""
    pairs, j = [], 0
    for i, layer in enumerate(xfl_layers):
        if layer["type"] in ("folder", "guide"):
            continue
        k = next((k for k in range(j, len(js_layers)) if js_layers[k]["name"] == layer["name"]), None)
        if k is None:
            continue
        pairs.append((i, k))
        j = k + 1
    return pairs


def build_fla_timeline(fla_path: Path, js_text: str, out_dir: Path) -> dict[str, Any]:
    """Reads the .fla, links it to the export .js and writes out_dir; returns index.json's data."""
    archive = _open_fla(fla_path.read_bytes())
    document = archive.read("DOMDocument.xml").decode("utf-8", "ignore")
    doc_attrs = _attrs(re.search(r"<DOMDocument\b([^>]*)>", document).group(1))
    fps = float(doc_attrs.get("frameRate", 24))
    symbols: dict[str, dict[str, Any]] = {}
    for name in sorted(archive.namelist()):
        if not (name.startswith("LIBRARY/") and name.endswith(".xml")):
            continue
        xml = archive.read(name).decode("utf-8", "ignore")
        head = re.search(r"<DOMSymbolItem\b([^>]*)>", xml)
        if head:
            item = _attrs(head.group(1))
            symbol_name = _name(item.get("name", name[8:-4]))
            symbols[symbol_name] = {"name": symbol_name, **_timeline(xml)}
    scene = _blocks(document, "DOMTimeline")
    stage = {"name": scene[0][0].get("name", "Scene 1") if scene else "Scene 1", **_timeline(scene[0][1] if scene else "")}

    classes = _js_classes(js_text)
    stage_match = re.search(r"// stage content:\s*\n\(lib\.([A-Za-z0-9_$]+) = function", js_text)
    stage_js = stage_match.group(1) if stage_match else None

    # Link symbols to classes, from the stage down; then any name that can only mean one class.
    linked: dict[str, str] = {}
    taken: set[str] = set()
    queue: list[tuple[dict[str, Any], str]] = [(stage, stage_js)] if stage_js in classes else []
    while queue:
        xfl, js_name = queue.pop(0)
        js_layers = classes.get(js_name) or []
        for i, k in _align(xfl["layers"], js_layers):
            xfl_children: list[str] = []
            for frame in xfl["layers"][i]["frames"]:
                for child in frame.get("symbols", []):
                    if child in symbols and child not in xfl_children:
                        xfl_children.append(child)
            js_children = [name for name in js_layers[k]["symbols"] if name in classes]
            if len(xfl_children) != len(js_children):
                continue
            for child, js_child in zip(xfl_children, js_children):
                if child in linked or js_child in taken or not _may_be(js_child, child):
                    continue
                linked[child] = js_child
                taken.add(js_child)
                queue.append((symbols[child], js_child))
    for name in symbols:
        if name in linked:
            continue
        options = [js_name for js_name in classes if js_name not in taken and _may_be(js_name, name)]
        if len(options) == 1 and sum(_may_be(options[0], other) for other in symbols if other not in linked) == 1:
            linked[name] = options[0]
            taken.add(options[0])

    out_dir.mkdir(parents=True, exist_ok=True)
    for stale in out_dir.glob("*.json"):
        stale.unlink()

    classes_known = set(classes)

    def write(xfl: dict[str, Any], js_name: str) -> dict[str, Any]:
        js_layers = classes.get(js_name) or []
        for i, k in _align(xfl["layers"], js_layers):
            xfl["layers"][i]["props"] = js_layers[k]["props"]
            # Which published symbol each of the layer's objects is (stepping into one).
            known = {prop: name for prop, name in js_layers[k]["classes"].items() if name in classes_known}
            if known:
                xfl["layers"][i]["classes"] = known
        for layer in xfl["layers"]:
            for frame in layer["frames"]:
                if "symbols" in frame:
                    frame["symbols"] = [{"name": child, **({"js": linked[child]} if child in linked else {})} for child in frame["symbols"]]
        data = {"version": FLA_TIMELINE_VERSION, "js": js_name, "fps": fps, **xfl}
        (out_dir / f"{js_name}.json").write_text(json.dumps(data, separators=(",", ":")), encoding="utf-8")
        return {"name": xfl["name"], "frames": xfl["frames"], "layers": len(xfl["layers"])}

    index: dict[str, Any] = {"version": FLA_TIMELINE_VERSION, "document": fla_path.stem, "fps": fps, "stage": stage_js, "symbols": {}}
    if stage_js:
        index["symbols"][stage_js] = write(stage, stage_js)
    for name, js_name in linked.items():
        index["symbols"][js_name] = write(symbols[name], js_name)
    index["unlinked"] = sorted(name for name in symbols if name not in linked)
    (out_dir / "index.json").write_text(json.dumps(index, separators=(",", ":")), encoding="utf-8")
    return index
