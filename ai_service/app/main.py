import base64
import hashlib
import html
import io
import json
import os
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image, ImageOps
from pydantic import BaseModel, Field

from .animation_director import AnimationPlanRequest, animation_model, animation_provider, create_animation_plan

app = FastAPI(title="CharacterBazaarStudio AI Service", version="0.4.0")


def _origins():
    raw = os.getenv(
        "CORS_ALLOWED_ORIGINS",
        "http://localhost:3000,http://127.0.0.1:3000,http://192.168.1.42:3000",
    )
    return [item.strip() for item in raw.split(",") if item.strip()]


app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class BackgroundRequest(BaseModel):
    prompt: str = Field(min_length=2, max_length=2000)
    width: int = Field(default=1280, ge=320, le=1920)
    height: int = Field(default=720, ge=240, le=1080)
    seed: int | None = Field(default=None, ge=0, le=2_147_483_647)


def _requested_provider() -> str:
    value = os.getenv("AI_IMAGE_PROVIDER", "auto").strip().lower()
    return value if value in {"auto", "cloudflare", "openai", "mock"} else "auto"


def _cloudflare_credentials():
    return (
        os.getenv("CLOUDFLARE_ACCOUNT_ID", "").strip(),
        os.getenv("CLOUDFLARE_API_TOKEN", "").strip(),
    )


def _active_provider() -> str:
    requested = _requested_provider()
    account_id, token = _cloudflare_credentials()
    openai_key = os.getenv("OPENAI_API_KEY", "").strip()

    if requested == "mock":
        return "mock"
    if requested == "cloudflare":
        return "cloudflare" if account_id and token else "unconfigured"
    if requested == "openai":
        return "openai" if openai_key else "unconfigured"

    # auto: prefer Cloudflare, then OpenAI, otherwise the local mock.
    if account_id and token:
        return "cloudflare"
    if openai_key:
        return "openai"
    return "mock"


@app.get("/health")
def health():
    account_id, token = _cloudflare_credentials()
    return {
        "status": "ok",
        "service": "ai",
        "image_provider": _active_provider(),
        "requested_provider": _requested_provider(),
        "cloudflare_configured": bool(account_id and token),
        "openai_configured": bool(os.getenv("OPENAI_API_KEY", "").strip()),
        "animation_provider": animation_provider(),
        "animation_model": animation_model(),
    }


@app.post("/v1/animation/plan")
def animation_plan(payload: AnimationPlanRequest):
    return create_animation_plan(payload)


def _mock_background(payload: BackgroundRequest):
    digest = hashlib.sha256(payload.prompt.encode("utf-8")).hexdigest()
    a, b = f"#{digest[:6]}", f"#{digest[6:12]}"
    prompt = html.escape(payload.prompt[:90])
    svg = f"""<svg xmlns="http://www.w3.org/2000/svg" width="{payload.width}" height="{payload.height}" viewBox="0 0 {payload.width} {payload.height}">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="{a}"/><stop offset="1" stop-color="{b}"/></linearGradient></defs>
    <rect width="100%" height="100%" fill="url(#g)"/>
    <circle cx="18%" cy="30%" r="110" fill="white" opacity=".08"/>
    <circle cx="82%" cy="70%" r="180" fill="white" opacity=".06"/>
    <text x="50%" y="49%" dominant-baseline="middle" text-anchor="middle" fill="white" font-family="Arial" font-size="42" font-weight="700">AI Background Mock</text>
    <text x="50%" y="57%" dominant-baseline="middle" text-anchor="middle" fill="white" opacity=".8" font-family="Arial" font-size="24">{prompt}</text>
    </svg>"""
    return {
        "provider": "mock",
        "prompt": payload.prompt,
        "image_url": "data:image/svg+xml;charset=utf-8," + quote(svg),
        "width": payload.width,
        "height": payload.height,
    }


def _fit_image_to_png_data_url(encoded: str, width: int, height: int) -> str:
    try:
        raw = base64.b64decode(encoded, validate=True)
        with Image.open(io.BytesIO(raw)) as source:
            image = ImageOps.exif_transpose(source).convert("RGB")
            # Workers AI FLUX does not currently expose width/height inputs. Fit the
            # generated image to the editor canvas while preserving aspect ratio.
            fitted = ImageOps.fit(
                image,
                (width, height),
                method=Image.Resampling.LANCZOS,
                centering=(0.5, 0.5),
            )
            output = io.BytesIO()
            fitted.save(output, format="PNG", optimize=True)
    except Exception as exc:
        raise HTTPException(status_code=502, detail="Image provider returned invalid image data") from exc

    return "data:image/png;base64," + base64.b64encode(output.getvalue()).decode("ascii")


def _cloudflare_background(payload: BackgroundRequest, account_id: str, api_token: str):
    model = os.getenv(
        "CLOUDFLARE_IMAGE_MODEL",
        "@cf/black-forest-labs/flux-1-schnell",
    ).strip()
    try:
        steps = int(os.getenv("CLOUDFLARE_IMAGE_STEPS", "4"))
    except ValueError:
        steps = 4
    steps = max(1, min(steps, 8))

    url = f"https://api.cloudflare.com/client/v4/accounts/{quote(account_id, safe='')}/ai/run/{model}"
    cloudflare_input = {"prompt": payload.prompt.strip(), "steps": steps}
    if payload.seed is not None:
        cloudflare_input["seed"] = payload.seed
    body = json.dumps(cloudflare_input).encode("utf-8")
    request = Request(
        url,
        data=body,
        method="POST",
        headers={
            "Authorization": f"Bearer {api_token}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
    )

    try:
        with urlopen(request, timeout=180) as response:
            result = json.loads(response.read().decode("utf-8"))
    except HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")[:1600]
        raise HTTPException(status_code=502, detail=f"Cloudflare Workers AI error: {detail}") from exc
    except (URLError, TimeoutError) as exc:
        raise HTTPException(status_code=502, detail=f"Cloudflare Workers AI unavailable: {exc}") from exc
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=502, detail="Cloudflare Workers AI returned invalid JSON") from exc

    if result.get("success") is False:
        errors = result.get("errors") or []
        raise HTTPException(status_code=502, detail=f"Cloudflare Workers AI error: {errors}")

    data = result.get("result") or result
    encoded = data.get("image") if isinstance(data, dict) else None
    if not encoded:
        raise HTTPException(status_code=502, detail="Cloudflare Workers AI returned no image data")

    return {
        "provider": f"cloudflare:{model}",
        "prompt": payload.prompt,
        "image_url": _fit_image_to_png_data_url(encoded, payload.width, payload.height),
        "width": payload.width,
        "height": payload.height,
    }


def _openai_background(payload: BackgroundRequest, api_key: str):
    model = os.getenv("OPENAI_IMAGE_MODEL", "gpt-image-2")
    quality = os.getenv("OPENAI_IMAGE_QUALITY", "medium")
    body = json.dumps({
        "model": model,
        "prompt": payload.prompt,
        "size": f"{payload.width}x{payload.height}",
        "quality": quality,
        "output_format": "png",
        "n": 1,
    }).encode("utf-8")

    request = Request(
        "https://api.openai.com/v1/images/generations",
        data=body,
        method="POST",
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
    )

    try:
        with urlopen(request, timeout=180) as response:
            result = json.loads(response.read().decode("utf-8"))
    except HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")[:1200]
        raise HTTPException(status_code=502, detail=f"OpenAI image provider error: {detail}") from exc
    except (URLError, TimeoutError) as exc:
        raise HTTPException(status_code=502, detail=f"OpenAI image provider unavailable: {exc}") from exc

    data = (result.get("data") or [{}])[0]
    encoded = data.get("b64_json")
    if not encoded:
        raise HTTPException(status_code=502, detail="OpenAI image provider returned no image data")

    try:
        base64.b64decode(encoded, validate=True)
    except Exception as exc:
        raise HTTPException(status_code=502, detail="OpenAI image provider returned invalid image data") from exc

    return {
        "provider": model,
        "prompt": payload.prompt,
        "image_url": f"data:image/png;base64,{encoded}",
        "width": payload.width,
        "height": payload.height,
    }


@app.post("/v1/generate/background")
def generate_background(payload: BackgroundRequest):
    provider = _active_provider()

    if provider == "cloudflare":
        account_id, api_token = _cloudflare_credentials()
        return _cloudflare_background(payload, account_id, api_token)

    if provider == "openai":
        return _openai_background(payload, os.getenv("OPENAI_API_KEY", "").strip())

    if provider == "unconfigured":
        requested = _requested_provider()
        if requested == "cloudflare":
            raise HTTPException(status_code=503, detail="Cloudflare Workers AI is selected but CLOUDFLARE_ACCOUNT_ID or CLOUDFLARE_API_TOKEN is missing")
        raise HTTPException(status_code=503, detail="The selected AI image provider is not configured")

    return _mock_background(payload)
