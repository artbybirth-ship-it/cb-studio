from __future__ import annotations

import hashlib
import json
import re
import shutil
import uuid
import zipfile
from pathlib import Path
from typing import Any
from urllib.parse import quote

from django.conf import settings

MAX_LIBRARY_BYTES = 500 * 1024 * 1024
MAX_EXTRACTED_BYTES = 1024 * 1024 * 1024
MAX_LIBRARY_FILES = 10000
CUSTOM_CHARACTER_CATEGORY = "My Characters"
DEFAULT_CHARACTER_CATEGORY = "Other"
# Wrapper folders that group a whole export rather than name a category.
GENERIC_WRAPPER_FOLDER = re.compile(r"^(librar(y|ies)|characters?|html ?5|exports?|assets|animate)$", re.I)


def _slug(value: str, fallback: str = "item") -> str:
    clean = re.sub(r"[^a-zA-Z0-9]+", "-", value.strip()).strip("-").lower()
    return clean[:80] or fallback


def _clean_label(value: str) -> str:
    text = re.sub(r"[_-]+", " ", value).strip()
    text = re.sub(r"\bhtml5\s*canvas\b", "", text, flags=re.I).strip(" -_")
    text = re.sub(r"\s+", " ", text)
    return text or "Action"


def _category_from_character_dir(character_dir_rel: str, package_label: str) -> str:
    """The nearest meaningful folder above the character folder: "Village/Kallu/idle.html" -> "Village"."""
    parents = [part for part in re.split(r"[\\/]", character_dir_rel) if part][:-1]
    for part in reversed(parents):
        label = _clean_label(part)
        if not GENERIC_WRAPPER_FOLDER.match(label) and label.lower() != package_label.lower():
            return label[:80]
    return DEFAULT_CHARACTER_CATEGORY


def with_character_category(character: dict[str, Any], package_label: str) -> dict[str, Any]:
    """Packages installed before categories existed: derive one from the stored action folder."""
    if character.get("category"):
        return character
    actions = character.get("actions") or []
    if not actions:
        return {**character, "category": DEFAULT_CHARACTER_CATEGORY}
    action = actions[0]
    # player.html sits in an action folder inside the character folder; raw exports sit in the character folder.
    is_player = bool(re.search(r"/player\.html(?:\?|$)", str(action.get("assetUrl") or ""), re.I))
    folder = str(action.get("sourceFolder") or "")
    character_dir_rel = "/".join(folder.split("/")[:-1]) if is_player else folder
    return {**character, "category": _category_from_character_dir(character_dir_rel, package_label)}


def _media_url(relative_path: Path) -> str:
    base = settings.MEDIA_URL.rstrip("/")
    return f"{base}/{quote(relative_path.as_posix(), safe='/')}"


def _safe_extract(zf: zipfile.ZipFile, destination: Path) -> None:
    infos = [info for info in zf.infolist() if not info.is_dir()]
    if len(infos) > MAX_LIBRARY_FILES:
        raise ValueError(f"library contains too many files; max {MAX_LIBRARY_FILES}")
    total_size = sum(max(0, int(info.file_size or 0)) for info in infos)
    if total_size > MAX_EXTRACTED_BYTES:
        raise ValueError("expanded library is too large")

    destination_resolved = destination.resolve()
    for info in zf.infolist():
        raw_name = info.filename.replace("\\", "/")
        if not raw_name or raw_name.startswith("/"):
            continue
        target = (destination / raw_name).resolve()
        if destination_resolved not in target.parents and target != destination_resolved:
            raise ValueError("library ZIP contains an unsafe path")
        if info.is_dir():
            target.mkdir(parents=True, exist_ok=True)
            continue
        target.parent.mkdir(parents=True, exist_ok=True)
        with zf.open(info, "r") as source, target.open("wb") as output:
            shutil.copyfileobj(source, output)


def _parse_js_metadata(js_path: Path | None, html_path: Path) -> tuple[int, int, int, int]:
    width, height, fps, frames = 1080, 1920, 30, 180
    text = ""
    if js_path and js_path.exists():
        try:
            text = js_path.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            text = ""
    try:
        html = html_path.read_text(encoding="utf-8", errors="ignore")
    except OSError:
        html = ""

    source = text or html
    for key, current in (("width", width), ("height", height), ("fps", fps)):
        match = re.search(rf"\b{key}\s*:\s*([0-9]+(?:\.[0-9]+)?)", source)
        if match:
            value = max(1, int(float(match.group(1))))
            if key == "width":
                width = value
            elif key == "height":
                height = value
            else:
                fps = value

    if not text:
        canvas = re.search(r"<canvas[^>]*\bwidth=[\"']?(\d+)[\"']?[^>]*\bheight=[\"']?(\d+)", html, re.I)
        if canvas:
            width, height = max(1, int(canvas.group(1))), max(1, int(canvas.group(2)))

    if text:
        waits = [int(value) for value in re.findall(r"\.wait\((\d+)\)", text)]
        frame_counts = [int(value) for value in re.findall(r"\btotalFrames\s*=\s*(\d+)", text)]
        candidates = waits + frame_counts
        if candidates:
            frames = max(1, max(candidates))
    duration_ms = max(100, round(frames / max(1, fps) * 1000))
    return width, height, fps, duration_ms


# Every player loads the one shared bridge served by the Next.js frontend
# (frontend/public/vendor/cb-animate-bridge.js), so Docker and desktop installs run
# identical code and old installs can be upgraded in place.
CHARACTER_BRIDGE_VERSION = 2
BRIDGE_SRC = f"/vendor/cb-animate-bridge.js?v={CHARACTER_BRIDGE_VERSION}"
_INLINE_BRIDGE = re.compile(r'<script id="cb-uploaded-library-bridge">[\s\S]*?</script>')


def _bridge_script(width: int, height: int, fps: int) -> str:
    return (
        f'<script src="{BRIDGE_SRC}" data-cb-bridge data-width="{int(width)}" '
        f'data-height="{int(height)}" data-fps="{int(fps)}"></script>'
    )


def _upgrade_bridge_html(text: str) -> str | None:
    """Swap the inline bridge baked into players by older installs for the shared bridge tag."""
    inline = _INLINE_BRIDGE.search(text)
    if not inline:
        return None
    old = inline.group(0)
    canvas = re.search(r"<canvas[^>]*\bwidth=[\"']?(\d+)[\"']?[^>]*\bheight=[\"']?(\d+)", text, re.I)

    def pick(*patterns: str, fallback: int) -> int:
        for pattern in patterns:
            match = re.search(pattern, old)
            if match:
                return int(match.group(1))
        return fallback

    width = pick(r"\bW=(\d+)", r"width:(\d+),height:\d+", fallback=int(canvas.group(1)) if canvas else 1080)
    height = pick(r"\bH=(\d+)", r"width:\d+,height:(\d+)", fallback=int(canvas.group(2)) if canvas else 1920)
    fps = pick(r"\bFPS=(\d+)", r"/1000\*(\d+)\)", fallback=30)
    upgraded = text.replace(old, _bridge_script(width, height, fps), 1)
    # Older Docker players painted a white page behind the character.
    return upgraded.replace("overflow:hidden;background:#fff}canvas", "overflow:hidden;background:transparent}canvas")


def upgrade_package_bridges(package_root: Path) -> int:
    """One-time upgrade of an installed package's players to the shared bridge."""
    upgraded = 0
    if not package_root.is_dir():
        return 0
    for html_path in package_root.rglob("*.html"):
        if _is_noise_file(html_path, package_root):
            continue
        try:
            text = html_path.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue
        new_text = _upgrade_bridge_html(text)
        if new_text is None:
            continue
        html_path.write_text(new_text, encoding="utf-8")
        upgraded += 1
    return upgraded


def _patch_animate_html(html_path: Path, width: int, height: int, fps: int) -> None:
    try:
        text = html_path.read_text(encoding="utf-8", errors="ignore")
    except OSError:
        return
    if "data-cb-bridge" in text:
        return
    upgraded = _upgrade_bridge_html(text)
    if upgraded is not None:
        html_path.write_text(upgraded, encoding="utf-8")
        return
    text = re.sub(
        r"<script[^>]+src=[\"']https?://code\.createjs\.com/[^\"']+[\"'][^>]*></script>",
        '<script src="/vendor/createjs"></script>',
        text,
        flags=re.I,
    )
    bridge = _bridge_script(width, height, fps)
    if re.search(r"</body\s*>", text, re.I):
        text = re.sub(r"</body\s*>", bridge + "\n</body>", text, count=1, flags=re.I)
    else:
        text += "\n" + bridge
    html_path.write_text(text, encoding="utf-8")



def _is_noise_file(path: Path, root: Path) -> bool:
    try:
        parts = path.relative_to(root).parts
    except ValueError:
        parts = path.parts
    return any(part == "__MACOSX" or part == ".DS_Store" or part.startswith("._") for part in parts)


def _read_text(path: Path | None) -> str:
    if not path or not path.exists():
        return ""
    try:
        return path.read_text(encoding="utf-8", errors="ignore")
    except OSError:
        return ""


def _composition_id(js_text: str) -> str | None:
    # Never use an arbitrary `id:` in the Animate JS: Shambhu's first id is an audio ID.
    library_properties = re.search(
        r"lib\.properties\s*=\s*\{\s*id\s*:\s*['\"]([^'\"]+)['\"]",
        js_text,
    )
    if library_properties:
        return library_properties.group(1)
    assigned = re.search(r"compositions\[['\"]([^'\"]+)['\"]\]\s*=", js_text)
    return assigned.group(1) if assigned else None


def _top_level_symbols(js_text: str) -> list[str]:
    stage_start = js_text.find("// stage content:")
    if stage_start < 0:
        return []
    stage_end = js_text.find("// library properties:", stage_start)
    block = js_text[stage_start:stage_end if stage_end >= 0 else None]
    pattern = re.compile(
        r"this\.([A-Za-z0-9_$]+)\s*=\s*new\s+lib\.([A-Za-z0-9_$]+)\([^;]*\);\s*"
        r"this\.\1\.setTransform\([^;]*\);",
        re.S,
    )
    output: list[str] = []
    seen: set[str] = set()
    for match in pattern.finditer(block):
        symbol = match.group(2)
        if symbol in seen:
            continue
        seen.add(symbol)
        output.append(symbol)
    return output


def _symbol_label(symbol: str, document_name: str, index: int) -> str:
    text = re.sub(r"([a-z0-9])([A-Z])", r"\1 \2", symbol)
    text = re.sub(r"[_-]+", " ", text).strip()
    text = re.sub(r"\s+", " ", text)
    if not text or re.fullmatch(r"(?i)(symbol|instance|movie\s*clip)\s*\d*(?:\s*copy\s*\d*)?", text):
        base = _clean_label(document_name)
        return f"{base} {index + 1:02d}"
    return text[:200]


def _symbol_player_html(source_js_url: str, composition_id: str, symbol: str, width: int, height: int, fps: int) -> str:
    bridge = _bridge_script(width, height, fps)
    # Images/sprites are loaded relative to their original export folder. Do not
    # load the missing optional audio: the library preview must be visual-only.
    return f'''<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>html,body{{margin:0;width:100%;height:100%;overflow:hidden;background:transparent}}canvas{{display:block;width:100%;height:100%;background:transparent}}</style>
</head><body><canvas id="canvas" width="{width}" height="{height}"></canvas>
<script src="/vendor/createjs"></script>
<script src="{source_js_url}"></script>
<script>(function(){{
var canvas=document.getElementById('canvas'),W={width},H={height},COMP={json.dumps(composition_id)},SYMBOL={json.dumps(symbol)},SRC_BASE={json.dumps(source_js_url.rsplit('/',1)[0]+'/')};
var preview=new URLSearchParams(location.search).get('cbPreview')==='1',stage=null,root=null,lib=null;
function absSrc(src){{try{{return new URL(String(src||''),location.origin+SRC_BASE).href;}}catch(e){{return src;}}}}
function fit(){{var gb=root&&root.getBounds&&root.getBounds(),nb=root&&root.nominalBounds;if(gb&&nb&&(gb.width>nb.width*5||gb.height>nb.height*5))gb=null;var b=gb||nb||(lib&&lib[SYMBOL]&&lib[SYMBOL].prototype&&lib[SYMBOL].prototype.nominalBounds)||{{x:0,y:0,width:W,height:H}};var bw=Math.max(1,Number(b.width)||W),bh=Math.max(1,Number(b.height)||H),s=Math.min(W*.92/bw,H*.92/bh);root.scaleX=root.scaleY=s;root.x=(W-bw*s)/2-(Number(b.x)||0)*s;root.y=(H-bh*s)/2-(Number(b.y)||0)*s;}}
function render(){{try{{var C=lib&&lib[SYMBOL];if(!C)throw Error('Missing symbol '+SYMBOL);root=new C();window.exportRoot=root;stage=new createjs.Stage(canvas);window.stage=stage;stage.addChild(root);fit();if(root.gotoAndStop)root.gotoAndStop(0);stage.update();if(!preview){{createjs.Ticker.framerate=(lib.properties&&lib.properties.fps)||{fps};createjs.Ticker.addEventListener('tick',stage);}}}}catch(err){{console.error('[CBS] Pose render failed',err);}}}}
function ready(comp){{lib=comp.getLibrary();var manifest=(lib.properties&&lib.properties.manifest)||[];var visible=manifest.filter(function(item){{return !/\\.(?:mp3|wav|ogg|m4a)(?:\\?|$)/i.test(String(item.src||''));}});if(!visible.length){{render();return;}}var queue=new createjs.LoadQueue(false);queue.addEventListener('fileload',function(evt){{if(evt&&evt.item&&evt.item.type==='image')comp.getImages()[evt.item.id]=evt.result;}});queue.addEventListener('complete',function(evt){{try{{var ss=comp.getSpriteSheet(),meta=lib.ssMetadata||[];for(var i=0;i<meta.length;i++)ss[meta[i].name]=new createjs.SpriteSheet({{images:[evt.target.getResult(meta[i].name)],frames:meta[i].frames}});}}catch(e){{console.error(e);}}render();}});queue.addEventListener('error',function(evt){{console.error('[CBS] Missing asset',evt);}});queue.loadManifest(visible.map(function(item){{var copy=Object.assign({{}},item);copy.src=absSrc(copy.src);return copy;}}));}}
try{{var comp=window.AdobeAn&&AdobeAn.getComposition(COMP);if(!comp)throw Error('Animate composition not found: '+COMP);ready(comp);}}catch(err){{console.error('[CBS] Pose preview startup failed',err);}}
}})();</script>
{bridge}
</body></html>'''


def _split_combined_animate_export(
    package_id: str,
    package_root: Path,
    package_root_rel: Path,
    html_path: Path,
    js_path: Path | None,
    source_folder: str,
) -> list[dict[str, Any]]:
    if not js_path or not js_path.exists():
        return []
    js_text = _read_text(js_path)
    symbols = _top_level_symbols(js_text)
    composition_id = _composition_id(js_text)
    if len(symbols) < 2 or not composition_id:
        return []

    doc_name = _clean_label(html_path.stem)
    generated_root = package_root / "cb-isolated-symbols" / _slug(doc_name, "document")
    generated_root.mkdir(parents=True, exist_ok=True)
    source_js_url = _relative_url(package_root_rel, package_root, js_path)
    _, _, fps, duration_ms = _parse_js_metadata(js_path, html_path)
    width, height = 720, 960
    character_id = f"upload-{package_id[:8]}-{_slug(doc_name, 'character')}"
    actions: list[dict[str, Any]] = []
    used_ids: set[str] = set()
    for index, symbol in enumerate(symbols):
        name = _symbol_label(symbol, doc_name, index)
        base_key = _slug(name, f"pose-{index + 1}")
        key = base_key
        suffix = 2
        while key in used_ids:
            key = f"{base_key}-{suffix}"
            suffix += 1
        used_ids.add(key)
        symbol_dir = generated_root / f"{index + 1:03d}-{_slug(symbol, 'symbol')}"
        symbol_dir.mkdir(parents=True, exist_ok=True)
        player = symbol_dir / "player.html"
        player.write_text(_symbol_player_html(source_js_url, composition_id, symbol, width, height, fps), encoding="utf-8")
        player_url = _relative_url(package_root_rel, package_root, player)
        actions.append({
            "id": f"{character_id}-{key}",
            "characterId": character_id,
            "characterName": doc_name,
            "actionName": name,
            "thumbUrl": f"{player_url}?cbPreview=1",
            "sourceSvgName": f"{symbol} (isolated Animate pose)",
            "sourceFolder": source_folder,
            "assetUrl": player_url,
            "sourceWidth": width,
            "sourceHeight": height,
            "fps": fps,
            "durationMs": duration_ms,
        })
    return [{
        "id": character_id,
        "name": doc_name,
        "sourceFolder": source_folder,
        "origin": "uploaded",
        "packageId": package_id,
        "actions": actions,
    }] if actions else []


def _make_placeholder_preview(path: Path, character: str, action: str) -> None:
    safe_character = character.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    safe_action = action.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    svg = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 540 720">
<rect width="540" height="720" rx="28" fill="#f5f3ee"/><circle cx="270" cy="218" r="92" fill="#d4c8b6"/>
<rect x="165" y="320" width="210" height="230" rx="70" fill="#b7aa96"/>
<text x="270" y="625" text-anchor="middle" font-family="Arial,sans-serif" font-size="30" fill="#2b2925">{safe_character}</text>
<text x="270" y="665" text-anchor="middle" font-family="Arial,sans-serif" font-size="22" fill="#6d675e">{safe_action}</text>
</svg>'''
    path.write_text(svg, encoding="utf-8")


def _preview_for(html_path: Path, character_name: str, action_name: str) -> Path:
    candidates = [
        html_path.with_suffix(".svg"),
        html_path.with_suffix(".png"),
        html_path.with_suffix(".jpg"),
        html_path.with_suffix(".jpeg"),
        html_path.parent / "preview.svg",
        html_path.parent / "preview.png",
        html_path.parent / "preview.jpg",
        html_path.parent / "preview.jpeg",
    ]
    for candidate in candidates:
        if candidate.exists():
            return candidate
    for pattern in ("*.svg", "*.png", "*.jpg", "*.jpeg"):
        first = next((item for item in sorted(html_path.parent.glob(pattern)) if not item.name.startswith("._")), None)
        if first:
            return first
    generated = html_path.parent / "cb-preview.svg"
    _make_placeholder_preview(generated, character_name, action_name)
    return generated


def _relative_url(package_root_rel: Path, package_root: Path, target: Path) -> str:
    return _media_url(package_root_rel / target.relative_to(package_root))


def _normalize_manifest(manifest: dict[str, Any], package_id: str, package_root: Path, package_root_rel: Path) -> list[dict[str, Any]]:
    output: list[dict[str, Any]] = []
    for char_index, character in enumerate(manifest.get("characters") or []):
        if not isinstance(character, dict):
            continue
        name = str(character.get("name") or f"Character {char_index + 1}")[:200]
        raw_char_id = str(character.get("id") or name)
        character_id = f"upload-{package_id[:8]}-{_slug(raw_char_id, f'character-{char_index + 1}')}"
        actions: list[dict[str, Any]] = []
        for action_index, action in enumerate(character.get("actions") or []):
            if not isinstance(action, dict):
                continue
            player = str(action.get("player") or action.get("assetUrl") or "").lstrip("/")
            if not player:
                continue
            player_path = (package_root / player).resolve()
            if package_root.resolve() not in player_path.parents or not player_path.exists():
                continue
            action_name = str(action.get("actionName") or action.get("name") or f"Action {action_index + 1}")[:200]
            preview = str(action.get("preview") or action.get("thumbUrl") or "").lstrip("/")
            preview_path = (package_root / preview).resolve() if preview else _preview_for(player_path, name, action_name)
            if package_root.resolve() not in preview_path.parents or not preview_path.exists():
                preview_path = _preview_for(player_path, name, action_name)
            width = max(1, int(action.get("sourceWidth") or 1080))
            height = max(1, int(action.get("sourceHeight") or 1920))
            fps = max(1, int(action.get("fps") or 30))
            duration_ms = max(100, int(action.get("durationMs") or 6000))
            actions.append({
                "id": f"{character_id}-{_slug(str(action.get('id') or action_name), f'action-{action_index + 1}')}",
                "characterId": character_id,
                "characterName": name,
                "actionName": action_name,
                "thumbUrl": _relative_url(package_root_rel, package_root, preview_path),
                "sourceSvgName": preview_path.name,
                "sourceFolder": str(action.get("sourceFolder") or player_path.parent.relative_to(package_root).as_posix()),
                "assetUrl": _relative_url(package_root_rel, package_root, player_path),
                "sourceWidth": width,
                "sourceHeight": height,
                "fps": fps,
                "durationMs": duration_ms,
            })
        if actions:
            output.append({
                "id": character_id,
                "name": name,
                "sourceFolder": str(character.get("sourceFolder") or name),
                "category": str(character.get("category") or "").strip()[:80] or DEFAULT_CHARACTER_CATEGORY,
                "origin": "uploaded",
                "packageId": package_id,
                "actions": actions,
            })
    return output


def _discover_catalog(package_id: str, package_root: Path, package_root_rel: Path, package_label: str) -> list[dict[str, Any]]:
    manifest_paths = sorted(package_root.rglob("cb-library.json"))
    if manifest_paths:
        try:
            manifest = json.loads(manifest_paths[0].read_text(encoding="utf-8"))
            normalized = _normalize_manifest(manifest, package_id, package_root, package_root_rel)
            if normalized:
                return normalized
        except (OSError, json.JSONDecodeError, TypeError, ValueError):
            pass

    player_files = [path for path in sorted(package_root.rglob("player.html")) if not _is_noise_file(path, package_root)]
    player_dirs = {path.parent.resolve() for path in player_files}
    raw_html_files = [
        path for path in sorted(package_root.rglob("*.html"))
        if path.name.lower() != "player.html"
        and path.parent.resolve() not in player_dirs
        and not _is_noise_file(path, package_root)
        and "cb-isolated-symbols" not in path.parts
    ]
    html_files = player_files + raw_html_files
    if not html_files:
        raise ValueError("no HTML5 character actions found in the ZIP")

    grouped: dict[str, dict[str, Any]] = {}
    used_action_ids: set[str] = set()
    for index, html_path in enumerate(html_files):
        rel = html_path.relative_to(package_root)
        parent = html_path.parent
        is_player = html_path.name.lower() == "player.html"
        if parent == package_root:
            character_name = _clean_label(html_path.stem)
            action_name = _clean_label(html_path.stem)
            source_folder = rel.parent.as_posix() or character_name
            character_dir_rel = ""
        elif is_player:
            # player.html normally lives in an action folder; its grandparent is
            # the character even when the ZIP has an extra top-level library folder.
            character_dir = parent.parent if parent.parent != package_root else parent
            character_name = _clean_label(character_dir.name)
            action_name = _clean_label(parent.name)
            source_folder = parent.relative_to(package_root).as_posix()
            character_dir_rel = character_dir.relative_to(package_root).as_posix()
        else:
            # Raw Animate .html/.js exports sit directly in the character folder.
            character_name = _clean_label(parent.name)
            action_name = _clean_label(html_path.stem)
            source_folder = parent.relative_to(package_root).as_posix()
            character_dir_rel = source_folder
        category = _category_from_character_dir(character_dir_rel, package_label)

        char_key = _slug(character_name, f"character-{index + 1}")
        character_id = f"upload-{package_id[:8]}-{char_key}"

        js_path = html_path.with_suffix(".js")
        if not js_path.exists() and is_player:
            animation_js = html_path.parent / "animation.js"
            js_path = animation_js if animation_js.exists() else None
        elif not js_path.exists():
            js_path = None
        width, height, fps, duration_ms = _parse_js_metadata(js_path, html_path)
        if not is_player:
            split_characters = _split_combined_animate_export(
                package_id, package_root, package_root_rel, html_path, js_path, source_folder,
            )
            if split_characters:
                for split_character in split_characters:
                    split_character["category"] = category
                    # Same id as a character already found: rename instead of dropping that one.
                    previous_id = split_character["id"]
                    candidate_id = previous_id
                    suffix = 2
                    while candidate_id in grouped:
                        candidate_id = f"{previous_id}-{suffix}"
                        suffix += 1
                    if candidate_id != previous_id:
                        split_character["id"] = candidate_id
                        for action in split_character["actions"]:
                            action["characterId"] = candidate_id
                            action_id = str(action.get("id") or "")
                            action["id"] = f"{candidate_id}{action_id[len(previous_id):]}" if action_id.startswith(f"{previous_id}-") else f"{candidate_id}-{action_id}"
                    grouped[split_character["id"]] = split_character
                continue
            _patch_animate_html(html_path, width, height, fps)
        group = grouped.setdefault(character_id, {
            "id": character_id,
            "name": character_name,
            "sourceFolder": source_folder.rsplit("/", 1)[0] if "/" in source_folder else source_folder,
            "category": category,
            "origin": "uploaded",
            "packageId": package_id,
            "actions": [],
        })
        preview = _preview_for(html_path, character_name, action_name)
        base_action_id = f"{character_id}-{_slug(action_name, f'action-{index + 1}')}"
        action_id = base_action_id
        suffix = 2
        while action_id in used_action_ids:
            action_id = f"{base_action_id}-{suffix}"
            suffix += 1
        used_action_ids.add(action_id)
        group["actions"].append({
            "id": action_id,
            "characterId": character_id,
            "characterName": character_name,
            "actionName": action_name,
            "thumbUrl": _relative_url(package_root_rel, package_root, preview),
            "sourceSvgName": preview.name,
            "sourceFolder": source_folder,
            "assetUrl": _relative_url(package_root_rel, package_root, html_path),
            "sourceWidth": width,
            "sourceHeight": height,
            "fps": fps,
            "durationMs": duration_ms,
        })

    return [item for item in grouped.values() if item["actions"]]


def package_fingerprint(package_root: Path) -> str:
    """Identity of an installed export, independent of how it was packed (ZIP or picked folder).

    Every original file's path + content, skipping generated files; HTML is identified by path
    only because installs patch it. Same algorithm as the desktop (Next.js) backend.
    """
    digest = hashlib.sha256()
    files = []
    for path in package_root.rglob("*"):
        if not path.is_file() or _is_noise_file(path, package_root):
            continue
        rel = path.relative_to(package_root).as_posix()
        if "cb-isolated-symbols" in rel.split("/") or path.name == "cb-preview.svg":
            continue
        files.append((rel, path))
    for rel, path in sorted(files, key=lambda item: item[0]):
        digest.update(rel.encode("utf-8"))
        digest.update(b"\0")
        if path.suffix.lower() != ".html":
            digest.update(hashlib.sha256(path.read_bytes()).digest())
    return digest.hexdigest()


# Files that can hold the package's own /media/character_libraries/<id>/ address.
_REWRITE_SUFFIXES = {".html", ".htm", ".json", ".svg", ".css", ".js"}


def duplicate_character_package(source_hex: str, name: str, characters: list[dict[str, Any]], character_id: str = "") -> tuple[str, list[dict[str, Any]]]:
    """My characters: a full copy of a package under a new name (Find and Replace "create a duplicate
    library before proceeding"). Copies the files, rewrites the package address inside them and gives
    the copy its own ids. The renamed character is `character_id` (or the only one). Returns the new
    folder id and catalog. Mirrors duplicateLocalCharacterLibrary() in the desktop backend.
    """
    source_hex = uuid.UUID(str(source_hex)).hex
    libraries_root = Path(settings.MEDIA_ROOT) / "character_libraries"
    source_root = libraries_root / source_hex
    if not source_root.is_dir():
        raise ValueError("The character's files are missing")
    new_hex = uuid.uuid4().hex
    target_root = libraries_root / new_hex
    shutil.copytree(source_root, target_root)
    try:
        for path in target_root.rglob("*"):
            if not path.is_file() or path.suffix.lower() not in _REWRITE_SUFFIXES:
                continue
            try:
                text = path.read_text(encoding="utf-8")
            except (UnicodeDecodeError, OSError):
                continue
            if source_hex in text:
                path.write_text(text.replace(source_hex, new_hex), encoding="utf-8")
        old_prefix, new_prefix = f"upload-{source_hex[:8]}-", f"upload-{new_hex[:8]}-"
        catalog = json.loads(json.dumps(characters).replace(source_hex, new_hex).replace(old_prefix, new_prefix))
        renamed_id = character_id.replace(old_prefix, new_prefix) if character_id else ""
        for item in catalog:
            if len(catalog) > 1 and item.get("id") != renamed_id:
                continue
            item["name"] = name
            item["userNamed"] = True  # shown exactly as typed, never cleaned
            for action in item.get("actions") or []:
                action["characterName"] = name
    except Exception:
        shutil.rmtree(target_root, ignore_errors=True)
        raise
    return new_hex, catalog


# Animate .fla files are converted by Adobe Animate, which only the desktop app can drive.
FLA_NEEDS_DESKTOP = (
    "Animate .fla files are converted by the CB Studio desktop app (it needs Adobe Animate on the Mac). "
    "Here, publish the file as HTML5 Canvas in Animate and upload the export ZIP."
)


def install_character_library_zip(uploaded, custom: bool = False) -> tuple[str, str, list[dict[str, Any]], str]:
    if uploaded.size and uploaded.size > MAX_LIBRARY_BYTES:
        raise ValueError("character library ZIP is too large; max 500 MB")
    if Path(uploaded.name).suffix.lower() == ".fla":
        raise ValueError(FLA_NEEDS_DESKTOP)
    if Path(uploaded.name).suffix.lower() != ".zip":
        raise ValueError("character library must be uploaded as a ZIP file")

    package_id = uuid.uuid4().hex
    package_root_rel = Path("character_libraries") / package_id
    package_root = Path(settings.MEDIA_ROOT) / package_root_rel
    package_root.mkdir(parents=True, exist_ok=False)
    try:
        uploaded.seek(0)
        with zipfile.ZipFile(uploaded) as zf:
            _safe_extract(zf, package_root)
        # A ZIP holding only an Animate source file: this server cannot run Animate to convert it.
        files = [path for path in package_root.rglob("*") if path.is_file() and "__MACOSX" not in path.parts]
        if not any(path.suffix.lower() in (".html", ".htm") for path in files) and any(path.suffix.lower() == ".fla" for path in files):
            raise ValueError(FLA_NEEDS_DESKTOP)
        fingerprint = package_fingerprint(package_root)
        package_name = _clean_label(Path(uploaded.name).stem)
        characters = _discover_catalog(package_id, package_root, package_root_rel, package_name)
        if custom:
            for character in characters:
                character["origin"] = "custom"
                character["category"] = CUSTOM_CHARACTER_CATEGORY
        return package_id, package_name, characters, fingerprint
    except zipfile.BadZipFile as exc:
        shutil.rmtree(package_root, ignore_errors=True)
        raise ValueError("invalid ZIP file") from exc
    except Exception:
        shutil.rmtree(package_root, ignore_errors=True)
        raise
