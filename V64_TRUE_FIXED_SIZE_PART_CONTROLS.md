# V64 — True fixed-size body-part controls

This update fixes the transform controls growing when the selected body part itself is scaled or the canvas is zoomed.

## Root cause fixed
The part controls were compensating only for canvas zoom. A replacement head can also have its own scale, and browser zoom adds another visual transform. Those transforms multiplied together, so the handles still became huge.

## New behavior
- Scale corner squares stay approximately the same screen size.
- Rotate buttons stay approximately the same screen size.
- Flip button stays approximately the same screen size.
- Selection border thickness stays approximately constant.
- Compensation now includes:
  - Canvas Zoom
  - selected part scale
  - browser zoom counter-scaling
  - camera/source rendering mode

The artwork and selection box geometry can still zoom/scale normally; only the editing controls remain screen-sized.
