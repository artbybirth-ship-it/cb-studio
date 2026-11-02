# FLA import spike (2 Nov 2026)

Throwaway prototype that proved native .fla reading and playback on `Sardar.fla` and `Shambhu Talk.fla`.
Not wired into CB Studio.

- `flazip.py`: tolerant ZIP reader. Both files fail a normal unzip ("Bad magic number for central
  directory"); walking the local file headers reads every entry.
- `flastats.py <file.fla>`: prints what is inside (scenes, symbols, tween kinds, masks, effects).
- `fla2json.py <file.fla> <out.json>`: converts to a JSON scene graph. Shapes become closed fill
  contours and stroke paths in px. Symbols keep their layers, keyframes, classic tweens and eases,
  shape tweens and masks. Art-brush definitions are included.
- `render.js` + `view.html`: canvas renderer for that JSON. It handles nested symbols, graphic loop
  modes, masks, classic tweens and shape tweens.
- `shoot.py`: renders frames in headless Chrome and saves PNGs. Serve the folder that holds
  `view.html` and the JSON.
- `compare.py` + `compare.html`: draws the same frame with Animate's HTML5 Canvas publish
  (CreateJS) and with `render.js`, then measures the pixel difference.
  - Put `createjs.js`, the publish `.js` (as `sardar_pub.js`), `render.js` and the JSON in one folder.
  - Checked on ~/Documents/sardar (Sardar_HTML5 Canvas.fla + publish): every 3rd frame of 180,
    with 0.44% of the character's pixels visibly different on average (max 0.49%).
  - All of that difference is on outlines (anti-aliasing).

## Format facts learned

- **Tween types:** XFL `tweenType="motion"` is a **Classic** Tween, and `"motion object"` is the
  newer Motion Tween. Both files use only Classic tweens and shape tweens.
- **Shape tweens:** Animate saves the matched start/end curves in `<MorphShape>`.
  - Coordinates are twips ÷ 256 (×12.8 for px), in the timeline's space, not the drawing object's.
  - Fill and stroke indices are 0-based, for the start (1) and end (2) keyframes.
  - -1 means none.
- **Ease sign:** a simple ease of `acceleration="-100"` (or `<Ease intensity="-100">`) is published
  by Animate as createjs `Ease.get(1)`, which is an ease **out**. The amount is −intensity/100.
- **Gradient stops:** the `GradientEntry ratio` is already 0–1 (not 0–255).
- **Edge numbers:** decimal twips, or `#hex.frac` with a two's-complement integer part.
- **Art brushes:** `PaintBrushStroke` with `paintBrushDefinition` is an art brush. Its artwork is an
  SVG inside `PaintBrushDefinitions.xml`; Sardar's walking shoes use one.
