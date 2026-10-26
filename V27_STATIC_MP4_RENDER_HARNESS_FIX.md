# v27 - Static MP4 Render Harness Fix

Root cause of the visible `Page.wait_for_function: Timeout 30000ms exceeded` error:
The Celery/Playwright worker depended on the Next.js client render route becoming hydrated and setting `window.__CBS_RENDER_READY__`. In Docker/dev mode that client hydration/route compilation could fail to become ready within the worker's 30 second wait even though the normal editor itself worked.

## v27 fix
- MP4 worker no longer uses `/render/scene/<id>` for frame capture.
- Added `/public/render-harness.html`, a static browser renderer with no React/Next hydration dependency.
- Harness loads the saved Scene and Project directly through same-origin `/api`.
- Recreates the scene stage, background images, Talking CreateJS character iframe, text, and static props.
- Applies the saved whole-character transform, body-part offsets, visibility, per-part animation state, and color overrides.
- Waits for every background image and every Talking CreateJS runtime to be ready.
- Exact render frames use `SEEK` -> `SEEK_DONE` acknowledgement before Playwright screenshots.
- Original Talking source animation remains unchanged.
- Existing FFmpeg frame encoding, scene audio mix, MP4 mux, and FFprobe validation remain in place.
- Render timeout diagnostics now report static harness state instead of only a generic wait timeout.
