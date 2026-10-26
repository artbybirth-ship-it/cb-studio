# V90 — Head Only Selection / No White Strip

## Fixes
- Head selection bounds are tightened to the actual head only.
- Neck and upper torso are excluded from the head selection/replacement slot.
- Replacing the head no longer erases the source with a rectangular block.
- A head-shaped erase mask is used, preventing the straight white strip/gap below the head.
- Exact head suggestions (`headExact.png`) remain head-only.
- Left/right hand and leg erase masks are also made less rectangular to reduce similar gap artifacts.
- Kallu player iframe bridge query bumped to `v90` to avoid stale cached player markup during testing.

## Files changed
- `frontend/components/StageCanvas.tsx`
- all `frontend/public/html5-combined-players/kallu/*/player.html`
