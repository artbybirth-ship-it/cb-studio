"""ZIP importer for the Backgrounds, FX and SFX libraries.

Folders inside the ZIP become categories and file names become item names.
An optional ``cb-library.json`` can override names/categories:

    {"items": [{"file": "Village/day.jpg", "name": "Village Day", "category": "Village"}]}

Vector backgrounds (.ai / .eps) cannot be displayed by browsers, so each one
needs a preview image with the same base name in the same folder
(e.g. ``village.ai`` + ``village.png``). The preview is shown in the editor and
the original vector is kept as ``sourceUrl``.
"""

from __future__ import annotations

import json
import mimetypes
import shutil
import uuid
import zipfile
from pathlib import Path
from typing import Any

from django.conf import settings

from .character_library import (
    MAX_LIBRARY_BYTES,
    _clean_label,
    _is_noise_file,
    _media_url,
    _safe_extract,
)

LIBRARY_TYPES = ("backgrounds", "fx", "sfx")
LIBRARY_LABELS = {"backgrounds": "Backgrounds", "fx": "FX", "sfx": "SFX"}
# Asset.kind used to store each package.
LIBRARY_ASSET_KIND = {"backgrounds": "background", "fx": "fx", "sfx": "audio"}

DISPLAY_EXTENSIONS = {
    "backgrounds": {".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg"},
    "fx": {".gif", ".png", ".webp", ".apng", ".svg"},
    "sfx": {".mp3", ".wav", ".ogg", ".m4a", ".aac", ".flac"},
}
VECTOR_SOURCE_EXTENSIONS = {"backgrounds": {".ai", ".eps"}, "fx": set(), "sfx": set()}
PREVIEW_EXTENSIONS = (".png", ".jpg", ".jpeg", ".webp", ".svg", ".gif")

EXTRA_MIME = {
    ".webp": "image/webp", ".apng": "image/apng", ".svg": "image/svg+xml",
    ".m4a": "audio/mp4", ".aac": "audio/aac", ".flac": "audio/flac",
    ".ogg": "audio/ogg", ".wav": "audio/wav", ".mp3": "audio/mpeg",
    ".ai": "application/postscript", ".eps": "application/postscript",
}


def _mime_for(path: Path) -> str:
    ext = path.suffix.lower()
    return EXTRA_MIME.get(ext) or mimetypes.guess_type(path.name)[0] or "application/octet-stream"


def _load_manifest(root: Path) -> dict[str, dict[str, Any]]:
    """Map of relative file path (lower-case) -> manifest entry."""
    for candidate in root.rglob("cb-library.json"):
        if _is_noise_file(candidate, root):
            continue
        try:
            data = json.loads(candidate.read_text(encoding="utf-8", errors="ignore"))
        except (OSError, ValueError):
            return {}
        entries = data.get("items") if isinstance(data, dict) else None
        if not isinstance(entries, list):
            return {}
        base = candidate.parent
        result: dict[str, dict[str, Any]] = {}
        for entry in entries:
            if not isinstance(entry, dict) or not isinstance(entry.get("file"), str):
                continue
            target = (base / entry["file"]).resolve()
            try:
                rel = target.relative_to(root.resolve()).as_posix().lower()
            except ValueError:
                continue
            result[rel] = entry
        return result
    return {}


def _category_for(path: Path, root: Path) -> str:
    parts = path.relative_to(root).parts[:-1]
    # A single wrapping folder (e.g. "MyPack/...") is not a category.
    if parts and len([p for p in root.iterdir() if not p.name.startswith((".", "__MACOSX"))]) == 1:
        parts = parts[1:]
    return _clean_label(" / ".join(parts)) if parts else "General"


def _find_preview(source: Path) -> Path | None:
    for ext in PREVIEW_EXTENSIONS:
        for variant in (ext, ext.upper()):
            candidate = source.with_suffix(variant)
            if candidate.exists():
                return candidate
    return None


def discover_media_items(library_type: str, package_id: str, root: Path, root_rel: Path) -> tuple[list[dict[str, Any]], list[str]]:
    display_exts = DISPLAY_EXTENSIONS[library_type]
    vector_exts = VECTOR_SOURCE_EXTENSIONS[library_type]
    manifest = _load_manifest(root)
    items: list[dict[str, Any]] = []
    skipped: list[str] = []
    used_as_preview: set[Path] = set()

    files = sorted(p for p in root.rglob("*") if p.is_file() and not _is_noise_file(p, root))

    # Vector sources first so their previews are not also listed as separate items.
    for path in files:
        if path.suffix.lower() not in vector_exts:
            continue
        preview = _find_preview(path)
        rel = path.relative_to(root).as_posix()
        if not preview:
            skipped.append(f"{rel} (needs a preview image with the same name, e.g. {path.stem}.png)")
            continue
        used_as_preview.add(preview)
        items.append(_make_item(library_type, package_id, root, root_rel, display=preview, source=path, manifest=manifest))

    for path in files:
        rel = path.relative_to(root).as_posix()
        ext = path.suffix.lower()
        if path.name == "cb-library.json" or path in used_as_preview or ext in vector_exts:
            continue
        if ext not in display_exts:
            skipped.append(f"{rel} (unsupported file type)")
            continue
        items.append(_make_item(library_type, package_id, root, root_rel, display=path, source=None, manifest=manifest))

    return items, skipped


def _make_item(library_type: str, package_id: str, root: Path, root_rel: Path, *, display: Path, source: Path | None, manifest: dict[str, dict[str, Any]]) -> dict[str, Any]:
    primary = source or display
    rel = primary.relative_to(root).as_posix()
    entry = manifest.get(rel.lower()) or manifest.get(display.relative_to(root).as_posix().lower()) or {}
    url = _media_url(root_rel / display.relative_to(root))
    item: dict[str, Any] = {
        "id": f"{package_id}:{rel}",
        "packageId": package_id,
        "type": library_type,
        "name": str(entry.get("name") or _clean_label(primary.stem))[:160],
        "category": str(entry.get("category") or _category_for(primary, root))[:160],
        "url": url,
        "previewUrl": url if library_type != "sfx" else "",
        "format": primary.suffix.lower().lstrip("."),
        "mimeType": _mime_for(display),
        "size": primary.stat().st_size,
    }
    if source:
        item["sourceUrl"] = _media_url(root_rel / source.relative_to(root))
    return item


def install_media_library_zip(library_type: str, uploaded) -> tuple[str, str, list[dict[str, Any]], list[str]]:
    if library_type not in LIBRARY_TYPES:
        raise ValueError("type must be backgrounds, fx or sfx")
    if uploaded.size and uploaded.size > MAX_LIBRARY_BYTES:
        raise ValueError("library ZIP is too large; max 500 MB")
    if Path(uploaded.name).suffix.lower() != ".zip":
        raise ValueError("library must be uploaded as a ZIP file")

    package_id = uuid.uuid4().hex
    root_rel = Path("media_libraries") / library_type / package_id
    root = Path(settings.MEDIA_ROOT) / root_rel
    root.mkdir(parents=True, exist_ok=False)
    try:
        uploaded.seek(0)
        with zipfile.ZipFile(uploaded) as zf:
            _safe_extract(zf, root)
        items, skipped = discover_media_items(library_type, package_id, root, root_rel)
        if not items:
            raise ValueError(f"no supported {LIBRARY_LABELS[library_type]} files found in this ZIP")
        return package_id, _clean_label(Path(uploaded.name).stem), items, skipped
    except zipfile.BadZipFile as exc:
        shutil.rmtree(root, ignore_errors=True)
        raise ValueError("invalid ZIP file") from exc
    except Exception:
        shutil.rmtree(root, ignore_errors=True)
        raise


def delete_media_library_files(library_type: str, package_id: str) -> None:
    try:
        safe_id = uuid.UUID(package_id).hex
    except (ValueError, TypeError):
        return
    if library_type in LIBRARY_TYPES:
        shutil.rmtree(Path(settings.MEDIA_ROOT) / "media_libraries" / library_type / safe_id, ignore_errors=True)
