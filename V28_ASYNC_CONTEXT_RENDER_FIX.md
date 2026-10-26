# v28 - Django ORM / Playwright Async Context Render Fix

## Fixed error

`You cannot call this from an async context - use a thread or sync_to_async.`

## Root cause

The Celery render task uses Playwright's synchronous API. Internally Playwright runs an asyncio event loop on the calling thread. v27 called Django ORM `job.save()` from `_set_progress()` while that Playwright loop was active. Django correctly raised `SynchronousOnlyOperation`.

## v28 behavior

- Initial RenderJob/Project database writes happen before Playwright starts.
- Scene rendering continues through the v27 static render harness.
- Progress writes that occur while Playwright is active are executed in a dedicated DB thread.
- The DB thread closes stale Django connections before and after each write.
- Final progress, MP4 URL, job status, and project status are written normally after the Playwright context has exited.
- The original Talking source animation is not modified.
- Existing background, body-part offset, rotation, visibility, color and per-part animation state rendering is retained.
- Exact `SEEK -> SEEK_DONE -> screenshot` frame capture is retained.
- FFmpeg encode, audio mix/mux, concat, and FFprobe validation are retained.
