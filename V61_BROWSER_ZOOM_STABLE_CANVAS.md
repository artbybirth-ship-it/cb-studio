# V61 — Browser-zoom-stable canvas

## Behavior
- Browser/page zoom is detected separately from Character Bazaar Studio's own Canvas Zoom.
- Browser zoom is counter-scaled around the entire editor stage, so the canvas, character and replacement overlays keep one coordinate system and do not drift apart.
- Internal **Canvas Zoom** still zooms the whole stage normally: background, character, replacement parts, boxes and overlays move together.
- Pointer coordinates, panning and dragging are compensated for browser zoom so moving parts still matches the mouse position.

## Why
Browser page zoom changes the browser device-pixel ratio and layout viewport. Previously the stage geometry and camera-space replacement layers could be recalculated against different effective coordinate sizes, which could make a replacement appear misaligned. V61 keeps an internal logical viewport and counter-scales it only for browser zoom.
