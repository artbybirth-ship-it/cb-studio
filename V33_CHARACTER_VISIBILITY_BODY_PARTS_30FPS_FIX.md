# v33 — Character visibility, body-part previews and 30 FPS sync

This build fixes the editor issues reported after adding the supplied **Men Talk** and **Women Talk** Adobe Animate HTML5 Canvas sources.

## Fixed

- Men/Women character is rendered directly inside its character box at normal editor zoom, so selecting a library character no longer leaves an empty canvas.
- Existing v32 saved projects are migrated back to the stable 420×760 character box instead of reusing runtime-computed bounds that could make a character oversized, clipped, or invisible.
- The large blue whole-character selection rectangle is removed from the canvas.
- The CreateJS body-part selection rectangle is also removed; selection remains visible in the right-side editor panel.
- Body-part thumbnail generation now renders each Animate display object locally instead of cropping the full editor canvas. This makes all available body-part cards receive an image, including alternate hand/forearm symbols.
- If a source thumbnail cannot be generated, the right panel falls back to the character preview image rather than a text-only blank card.
- Source animation is no longer allowed to free-run on the browser refresh clock. The editor is the master clock and seeks the Animate source to the exact 30 FPS frame from the playhead. This removes fast-forward playback on high-refresh-rate displays.
- High zoom still switches to the camera-space CreateJS renderer after 4× to preserve the previous sharp-zoom workflow.

## Source assets

The supplied Men Talk and Women Talk FLA/HTML5 Canvas source files are included under:

- `source_assets/Characters_HTML5/Men Talk/`
- `source_assets/Characters_HTML5/Women Talk/`

## Main changed files

- `frontend/components/StageCanvas.tsx`
- `frontend/components/EditorShell.tsx`
- `frontend/components/CharacterEditPanel.tsx`
- `frontend/public/characters/talking/men/player.html`
- `frontend/public/characters/talking/women/player.html`
- `frontend/app/globals.css`

## Rebuild

```bash
docker compose down
docker compose up -d --build
```

If you already have a project created with v32, open it normally. v33 normalizes the saved Men/Women character dimensions during load.
