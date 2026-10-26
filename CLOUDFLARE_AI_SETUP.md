# Cloudflare Workers AI Background Setup (v32)

The editor can generate a background from the prompt box with **Cloudflare Workers AI / FLUX.1 Schnell**.
Credentials remain server-side in the root `.env`; they are never exposed through a `NEXT_PUBLIC_*` variable.

## 1. Create the Cloudflare credentials

In Cloudflare Dashboard open **Workers AI** and choose **Use REST API**. Copy:

- Account ID
- Workers AI API token

The dashboard token template is recommended. If you create a custom token, grant the Workers AI permissions required by Cloudflare for REST inference.

## 2. Configure `.env`

```env
AI_IMAGE_PROVIDER=cloudflare
CLOUDFLARE_ACCOUNT_ID=YOUR_ACCOUNT_ID
CLOUDFLARE_API_TOKEN=YOUR_API_TOKEN
CLOUDFLARE_IMAGE_MODEL=@cf/black-forest-labs/flux-1-schnell
CLOUDFLARE_IMAGE_STEPS=4
```

Do **not** put the token in `NEXT_PUBLIC_*`.

## 3. Start / rebuild

```bash
docker compose up -d --build
```

## 4. Verify provider

```bash
curl http://localhost:8100/health
```

Expected:

```json
{
  "status": "ok",
  "service": "ai",
  "image_provider": "cloudflare",
  "requested_provider": "cloudflare",
  "cloudflare_configured": true
}
```

## 5. Test prompt → background directly

```bash
curl -X POST http://localhost:8100/v1/generate/background \
  -H "Content-Type: application/json" \
  -d '{"prompt":"clean 2D cartoon living room background, warm daylight, no characters","width":1920,"height":1080}'
```

The editor flow is:

`Prompt box -> /ai-api/v1/generate/background -> FastAPI ai service -> Cloudflare Workers AI -> PNG -> Django media -> background layer`

The AI service center-fits Cloudflare's returned image to the project canvas size and saves it as a PNG for the editor.

## Character assets in this build

The character library now contains the supplied Adobe Animate HTML5 sources:

- Men Talk — 30 FPS, 197 frames
- Women Talk — 30 FPS, 180 frames

Each uses the existing whole-character movement, body-part mode and position-keyframe system.
