# CharacterBazaarStudio v26 - MP4 render runtime fix

## Root cause fixed
v25 attempted to serve `node_modules/createjs/builds/1.0.0/createjs.min.js`. The npm `createjs` meta package does not ship that browser runtime bundle, so `/vendor/createjs` could return HTTP 500 in the Docker frontend. Headless Chromium then could not initialize the Adobe Animate/CreateJS character and the Celery render failed.

## v26 changes
- Removed the broken `createjs` meta dependency.
- Added classic CreateJS packages: easeljs 1.0.2, tweenjs 1.0.2, preloadjs 1.0.1, soundjs 1.0.1.
- `/vendor/createjs` now concatenates their local minified browser runtimes from node_modules. No CDN is required by the Talking player.
- Celery performs a frontend render preflight for CreateJS runtime, Talking player, animation.js and manifest.json before frame capture.
- Render failures now appear in a persistent visible error banner with the exact backend error and a Retry Render button.
- Existing exact SEEK_DONE frame capture and FFmpeg/FFprobe MP4 validation remain enabled.

## Rebuild
Because npm dependencies changed, rebuild frontend and worker/backend without cache:

```bash
docker compose down --remove-orphans
docker compose build --no-cache frontend backend worker
docker compose up -d
```

Then hard refresh the browser.
