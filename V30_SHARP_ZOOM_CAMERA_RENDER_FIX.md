# v30 Sharp Zoom Camera Render Fix

## Problem
v29 zoomed the complete scene with CSS `transform: scale(...)`. The Talking character itself was a CreateJS canvas inside an iframe. At 7.5x/10x/50x the browser enlarged the already-rasterized iframe canvas, so vector artwork looked soft/blurry even though the source CreateJS artwork was vector.

## Fix
- Talking character editor preview is now rendered in a camera-space iframe overlay that always matches the visible editor viewport.
- Zoom/pan is sent into the CreateJS player as a camera transform.
- CreateJS rerenders the vector source at the current visible zoom instead of CSS-stretching the old canvas bitmap.
- Backing canvas uses device-pixel-ratio quality without allocating a gigantic 50x full-stage canvas.
- 50x remains a viewport zoom; render/export resolution is independent.
- Existing body-part direct hit testing, drag offsets, original source animation, color controls, and MP4 render-mode path remain intact.

## Raster limitation
PNG/JPG/bitmap source pixels cannot gain real detail beyond their native resolution. This fix removes editor-generated canvas blur for vector CreateJS artwork; it cannot invent missing raster pixels.
