# V38 - Tight Selection, Pivot Scaling, Explicit Motion, Timeline Seek

This build keeps the no-authentication flow from V37 and updates the editor behavior requested for character animation.

## Changes

1. Character selection box now follows the visible CreateJS character artwork instead of the full source viewport.
2. The draggable center point is the scaling pivot. Resizing a character keeps that pivot fixed in world space.
3. A Motion range is created only when the user explicitly clicks **Create Motion**. Existing/manual/AI keyframes no longer create a Motion clip automatically.
4. Clicking the timeline ruler, an empty track area, or directly on a source clip moves the playhead vertical line to that timestamp.
5. All editor labels added or changed in this version are English.
6. Application authentication remains disabled. `/login` and `/signup` continue to redirect directly to the dashboard, and the REST API remains `AllowAny` with no DRF authentication classes.

## Linux rebuild

```bash
docker compose down
docker compose up -d --build
```

If an old frontend is still visible after deployment, hard refresh the browser once after the new containers are running.
