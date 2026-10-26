# V88 — Precise Garment Color And Selection

## Fixes
- Tightened Kallu garment hit/selection bounds for **Baniyan / Vest** and **Lungi / Lower Cloth**.
- Replaced broad garment rectangle tint masks with tighter garment-shaped masks inside the CreateJS player.
- Baniyan color now affects only the baniyan area much more precisely.
- Lungi color now affects only the lungi area much more precisely and avoids tinting legs.
- High-quality zoom behavior from V86 is retained.

## Files changed
- `frontend/components/StageCanvas.tsx`
- every `frontend/public/html5-combined-players/kallu/*/player.html`
