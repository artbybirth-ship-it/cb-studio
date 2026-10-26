# v106 — Auto-Split Uploaded Characters

## Goal
When Admin uploads one ZIP, every character visible as a top-level Adobe Animate/CreateJS stage symbol should appear as a separate character in Studio instead of one combined stage preview.

## Changes
- Raw Adobe Animate HTML5 Canvas exports are inspected for top-level `lib.*` symbols placed directly on the stage.
- If two or more stage symbols are found, v106 generates an isolated CreateJS player for every symbol.
- Each isolated symbol becomes its own universal character with its own card and live preview.
- Clicking/dragging a card inserts only that isolated symbol into the Studio canvas.
- Existing timeline/play/seek and the generic uploaded-character bridge remain attached to the isolated player.
- Desktop/local and Django/server importers use the same split behavior.
- macOS ZIP metadata (`__MACOSX`, `.DS_Store`, `._*`) is ignored.
- Existing `player.html` action packs and explicit `cb-library.json` manifests keep their intentional grouping and are not auto-split.

## Important
Packages uploaded with v105 keep their old saved catalog. Delete the old package from `/admin` and upload the ZIP again so v106 can rebuild it into separate characters.
