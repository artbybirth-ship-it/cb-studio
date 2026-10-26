# V103 — Self-contained desktop API + universal character library fix

## Why v102 showed “Internal Server Error”

The packaged Electron app contained the local Next.js UI, but the production build still rewrote `/api/*` and `/media/*` to `http://127.0.0.1:8000` by default. Therefore the DMG required a separately running Django backend. When Django was not running on the same Mac, Next.js returned `Internal Server Error` for project loading and Character Library upload.

## v103 fix

The macOS desktop build now works locally for normal editing without a separately running Django/Postgres service:

- `/api/projects` — local create/list/open projects.
- `/api/scenes` — local scene save/update.
- `/api/assets/upload` — local background/audio upload.
- `/api/assets/character-library` — local universal Character Library upload/list.
- `/media/*` — serves uploaded files from local desktop storage.
- Uploaded libraries persist after app restart and appear in every project.
- Raw Adobe Animate HTML5 Canvas exports and existing `player.html` action folders are supported.
- ZIPs with an extra top-level library folder are grouped correctly by character.
- Unsafe ZIP paths and symbolic links are rejected.

Desktop data is stored under Electron's user-data folder, on macOS normally:

```text
~/Library/Application Support/CharacterBazaar Studio/local-data/
```

The application passes the exact Electron user-data path at runtime, so the code does not rely on the working directory or the DMG mount.

## Server / Docker mode remains available

Docker development still uses Django and FastAPI because `docker-compose.yml` supplies:

```text
CB_BACKEND_ORIGIN=http://backend:8000
CB_AI_ORIGIN=http://ai:8100
```

For a production DMG that should intentionally use a central server, set `CB_BACKEND_ORIGIN` and optionally `CB_AI_ORIGIN` before running the build script.

## Important

The self-contained local API covers projects, scenes, uploaded assets and Character Library persistence. MP4 render and AI generation still require their corresponding server services when those features are used.
