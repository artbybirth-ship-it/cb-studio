# MVP Scope

## Working in this ZIP

- Project dashboard: list + create project.
- Django project API automatically creates Scene 1.
- Editor: switch scenes, add scenes, save scene JSON.
- PixiJS stage: character/text placeholders and drag-to-position.
- Inspector: background color, scene duration, object delete.
- Timeline: scene cards plus a basic duration playhead.
- FastAPI local AI mock: prompt -> deterministic SVG background, no paid API key required.
- Render queue: Django creates a render job, Celery processes it via Redis, FFmpeg creates a playable demo MP4.
- PostgreSQL models: Project, Scene, Asset, RenderJob.
- Docker Compose: frontend, backend, worker, AI service, PostgreSQL, Redis.

## Deliberately not production-complete yet

- Authentication / teams / permissions.
- Real CharacterBazaar rig import and skeletal/action animation.
- Real image/voice AI provider calls.
- Audio tracks, lip-sync and subtitles.
- Final compositor that reproduces every editor object in the MP4. Current FFmpeg job validates the async render pipeline with a solid demo video.
- S3/R2 storage, CDN, signed uploads.
- Credits, subscriptions, Razorpay/Stripe.
- Undo/redo, snapping, transform handles, keyframes, transitions and camera tracks.

This boundary is intentional: the ZIP is a clean basic vertical slice that boots all major services and gives the next development phase stable extension points.
