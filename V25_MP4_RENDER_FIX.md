# CB Studio v25 — MP4 Render Fix

Based on the uploaded v23 Talking-only project.

## Fixes
- Replaced the Talking player's external CreateJS CDN dependency with a local same-origin CreateJS runtime route backed by npm `createjs@1.0.1`.
- Added player ERROR messages so the headless renderer fails with a useful reason instead of silently capturing blank frames.
- Added exact `SEEK_DONE` acknowledgements from the CreateJS player for deterministic frame capture.
- Render page waits for every Talking iframe to be READY and for every requested frame seek to be painted.
- Backend Playwright frame capture now awaits the render-frame promise rather than sleeping for an arbitrary 22ms.
- Added frontend render-page retry logic and browser request/page-error logging in the worker.
- Added FFprobe validation before a render job is marked complete.
- Default render FPS is 30 to match the supplied Talking Adobe Animate source.
- Increased configurable Celery render time limit to 30 minutes.
- Editor now shows the actual render failure text and an explicit Download MP4 button on success.

## Source lock
The supplied Talking animation JS and FLA source are unchanged.
