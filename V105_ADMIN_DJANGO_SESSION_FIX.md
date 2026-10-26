# V105 — Admin Login / Django Proxy Fix

## Problem fixed
When the Studio is started with Docker, Next.js proxies `/api/*` to Django. The v104 Admin UI correctly called `/api/admin/session`, but Django did not expose that URL, so login returned Django `404 Page not found` even though the desktop/local Next route existed.

## V105 changes
- Added Django endpoint: `GET/POST/DELETE /api/admin/session`.
- Hard-coded admin credentials remain:
  - ID: `admin`
  - Password: `CBStudio@2026`
- Uses the same admin cookie name/token format as the desktop Next route.
- Character library `POST` and `DELETE` now require a valid admin session on Django too.
- Added `DELETE /api/assets/character-library?packageId=<asset-id>` to Django so Admin "Remove" works in Docker/server mode.
- Library `GET` stays public to the Studio UI so every project can read the universal uploaded catalog.
- Existing Django projects, scenes, render jobs, media, database and worker flow remain unchanged.
- Existing Electron/self-contained behavior remains unchanged.

## Run after updating
Rebuild backend/frontend so Django loads the new URL/view code:

```bash
docker compose down
docker compose up --build -d
```

Then open:

```text
http://localhost:3000/admin
```

Admin login:

```text
admin
CBStudio@2026
```
