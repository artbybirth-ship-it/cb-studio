# v34 — Men/Women vector source load fix

## Root cause found from the screenshot

The supplied **Men Talk** and **Women Talk** Adobe Animate exports are vector-only. In both original Animate JavaScript files:

```js
lib.properties.manifest = []
```

The v33 player always created a `createjs.LoadQueue` and waited for its `complete` event. With an empty manifest there is nothing to preload, so the character setup path could remain waiting and never create `exportRoot`, never post `READY`, and never send the body-part thumbnails. In the editor this appeared as:

- character missing from the canvas
- right panel stuck at **Loading body-part images from the Adobe Animate source…**

Adobe's own exported HTML for these two files does not use a preload queue; it calls its completion/setup function directly. v34 now does the same for vector-only sources.

## Changes

1. **Vector-only source startup**
   - If `lib.properties.manifest` is empty, `player.html` calls the source completion/setup path immediately.
   - PreloadJS is still used for any future source that actually has bitmap/sound manifest entries.

2. **Character always visible while source starts**
   - The editor shows the supplied SVG character preview underneath the iframe until the Animate player posts `READY`.
   - If the source player errors, the character does not disappear completely.

3. **Body-part panel READY path restored**
   - Men: 16 mapped parts.
   - Women: 12 mapped parts.
   - Each mapped target was checked against the actual exported assembly instance and has source bounds for thumbnail generation.

4. **No fast-forward/free-running source animation**
   - Embedded editor players do not run their own CreateJS ticker.
   - The editor playhead seeks the source to `floor(time × 30 FPS)`.
   - Standalone `autoplay=1` still uses CreateJS's native ticker.

5. **Clean selection remains**
   - No blue selection rectangle is drawn over the character artwork.

## Rebuild

```bash
docker compose down --remove-orphans
docker compose up -d --build
```

Then hard refresh the browser (`Cmd + Shift + R` on macOS).
