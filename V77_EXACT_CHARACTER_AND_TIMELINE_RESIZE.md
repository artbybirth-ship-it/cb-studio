# V77 — Exact selected HTML5 character + reference browser + timeline resize

## Fixed: selected card now loads the same character on canvas

V76 used the right-side HTML5 cards as references but still inserted the generic `Men Talk` editable source. V77 removes that mismatch for the supplied HTML5 library.

- First screen shows one card for every supplied HTML5 character:
  - Shambhu
  - Bansi
  - Suresh postman
  - Raghu
- Click a character or drag/drop it onto the stage.
- The canvas object now uses that character's **actual supplied HTML5 Canvas/CreateJS source action**, not the generic Men Talk source.
- The first action is used when dragging the main character card.
- Once the character is selected, clicking one of its right-panel reference/action cards switches the selected canvas character to that exact supplied action.
- 26 supplied HTML5 actions have player wrappers mapped into the editor.

## Right-side flow

### Before a character is on the canvas
- One main card per supplied character.
- Click or drag/drop to add the selected character.

### After placement
- Right panel opens the selected character tab.
- All of that character's supplied actions are shown first.
- `Similar Characters` appears below.

### Part edit
- Single click keeps whole-character selection behavior.
- Double-click a visible body region to open part edit.
- While part edit is open, clicking another visible body region switches the active part.
- The right panel immediately changes to that part context.
- For the active part it shows:
  1. same-character versions from that character's supplied actions;
  2. similar part options from the other supplied characters.
- Clicking a part card applies it to the currently selected part.
- Generic source-region erase support is included for these supplied HTML5 sources so the replacement can cover the selected original region instead of simply adding another image on top.

## Timeline / Layers

- Layer list width is resizable by dragging the divider left/right.
- Timeline clips have visible left and right resize grips.
- Drag a clip body left/right to move it in time.
- Drag left edge to change start time and trim duration.
- Drag right edge to change duration.
- Moving a clip later expands the scene duration when required.
- Stage visibility now respects each layer's `startTime` and `actionDurationMs`.
- Source animation seek time is calculated relative to the clip's timeline start.
- Transport layout is kept compact to more closely match the supplied reference screenshots.

## Source/runtime work

- Added local player wrappers under `frontend/public/html5-character-players/` for all 26 supplied HTML5 actions.
- Image-manifest actions are supported as well as vector-only actions.
- Character-specific and action-specific part crop thumbnails are generated under:
  - `frontend/public/html5-character-parts/`
  - `frontend/public/html5-character-part-actions/`

