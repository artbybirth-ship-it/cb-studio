# V93 — DMG TypeScript Build Fix

Fixes the Next.js production build error in `frontend/app/render/scene/[id]/page.tsx`.

`requestAnimationFrame` requires a callback accepting a timestamp. Passing a Promise resolver directly caused TypeScript to fail.

Changed both nested frame callbacks from direct resolver references to zero-argument callbacks:

- `window.requestAnimationFrame(() => window.requestAnimationFrame(pending.resolve));`
  -> `window.requestAnimationFrame(() => window.requestAnimationFrame(() => pending.resolve()));`

- `window.requestAnimationFrame(() => window.requestAnimationFrame(resolve));`
  -> `window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve()));`

This keeps the same two-frame wait behavior while satisfying TypeScript.
