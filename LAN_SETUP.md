# CharacterBazaarStudio v7 — Local / LAN setup

The frontend now uses same-origin proxy routes for Django, media files and the AI service. This means the editor can be opened from either `localhost` or the computer's LAN IP without baking that IP into the browser API URLs.

## Start

```bash
docker compose down
docker compose up --build -d
```

Check:

```bash
docker compose ps
```

## Open locally

- Studio: `http://localhost:3000`
- Direct Django API: `http://localhost:8000/api/`
- Direct AI docs: `http://localhost:8100/docs`

## Open from another PC on the same network

For the current server PC LAN IP `192.168.1.42`:

- Studio: `http://192.168.1.42:3000`
- Direct Django API: `http://192.168.1.42:8000/api/`
- Direct AI docs: `http://192.168.1.42:8100/docs`

Inside the Studio, API requests use `/backend-api`, AI requests use `/ai-api`, and uploaded media uses `/media`. Next.js proxies those paths to the Docker services, so background/voice uploads work through the same `:3000` origin.

## Use a Django backend on another server

The browser continues to call the Studio on port `3000`; Next.js forwards API and media requests to Django. Set `CB_BACKEND_ORIGIN` in the root `.env` to the backend server origin (Django uses port `8000` in this project):

```env
CB_BACKEND_ORIGIN=http://122.180.242.125:8000
```

The backend server must accept connections from the frontend host on port `8000`, and its `DJANGO_ALLOWED_HOSTS` must include `122.180.242.125`. Then restart the frontend:

```bash
docker compose up -d --build frontend
```

Use HTTPS instead of HTTP when the backend is exposed beyond a trusted private network. The Django API in this project currently has no application authentication, so do not expose it publicly without adding appropriate access controls.

## If the LAN IP changes

The Studio itself no longer needs `NEXT_PUBLIC_API_URL` to be changed. If you also want to open ports `8000`/`8100` directly from other PCs, update these `.env` values with the new LAN IP:

- `DJANGO_ALLOWED_HOSTS`
- `CORS_ALLOWED_ORIGINS`
- `CSRF_TRUSTED_ORIGINS`

Then rebuild with `docker compose up --build -d`.

## Firewall

For the Studio only, port `3000` is enough because it proxies backend/AI/media. Ports `8000` and `8100` are only needed if you want to access the API/docs directly from another PC.
