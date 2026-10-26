# V37 - No Authentication / Direct Dashboard

This build removes the CharacterBazaar Studio application login/signup flow.

## Behaviour

- Clicking **Login** opens `/dashboard` directly.
- Clicking **Open Studio**, **Start Creating Free**, a template, or **Create Animations** opens `/dashboard` directly.
- Visiting `/login` redirects immediately to `/dashboard`.
- Visiting `/signup` redirects immediately to `/dashboard`.
- No email, password, session, token, bearer token, or application account is required.
- Django REST Framework API authentication classes are disabled and API permissions remain `AllowAny`.

## Existing studio features preserved

The v36 selection tool, center/pivot point, audio import layer, Create Motion workflow, timeline, character controls, background generation and render workflow are unchanged.

## Linux server update

After replacing the old project files, rebuild/restart so the frontend server does not use a cached Next.js build:

```bash
docker compose down
docker compose up -d --build
```

If deploying without Docker, remove the old `.next` output before rebuilding the frontend:

```bash
cd frontend
rm -rf .next
npm install
npm run build
npm run start
```
