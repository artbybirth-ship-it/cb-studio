# V29 — 50x Zoom + Sharp Imported Images + Full-HD Render

Base: v28 async-context render fix.

## Editor
- Canvas viewport zoom: 0.1x to 50x.
- Quick buttons: Fit, 4x, 10x, 50x.
- Mouse-wheel zoom around cursor when the event reaches the stage.
- Hold Space + drag to pan; middle-button drag also pans.
- Character/body-part dragging uses the effective zoom scale, so offsets remain in project coordinates.
- Removed `will-change: transform` from the stage world to avoid forcing the complete editor stage into a stale low-resolution compositor texture.

## Imported image quality
- Background uploads are stored and used as the original file; the editor does not resize or JPEG-compress them.
- Original natural width/height are stored on the editor object.
- Background upload size limit raised to 50 MB for high-resolution artwork.
- DOM image preview uses the original asset URL and standard high-quality browser interpolation.

## Talking/CreateJS preview quality
- The Talking player uses a HiDPI backing canvas (up to 2x devicePixelRatio in the editor).
- Source timeline and original `animation.js` are untouched.
- Body-part hit-testing and independent movement remain source-coordinate based.

## MP4 render quality
- Keeps project coordinates unchanged.
- Headless Chromium captures at up to 2x logical resolution, capped around a 4K surface for Docker memory safety.
- CreateJS uses the same render supersample factor internally.
- Final output is Full HD: 1920x1080 landscape or 1080x1920 portrait.
- FFmpeg uses Lanczos scaling, H.264 CRF 17, `medium` preset, yuv420p and faststart.
- Scene concatenation uses stream copy to avoid an extra video re-encode.
- Existing v28 Playwright/Django async-context DB fix is retained.

## Important raster limitation
50x is an editor viewport zoom. PNG/JPG detail cannot exceed the source image's native pixels. This version removes avoidable editor blur and preserves the original asset, but does not invent missing raster detail.
