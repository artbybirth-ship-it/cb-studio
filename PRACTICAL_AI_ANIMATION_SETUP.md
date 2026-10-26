# CharacterBazaarStudio v35 — Practical Prompt Animation Setup

This build adds a deterministic **Prompt → Animation Plan → Timeline/Keyframes** workflow on top of the supplied Adobe Animate/CreateJS Men Talk and Women Talk assets.

The AI does **not** generate a replacement video. It only decides which supported editor actions should happen and when. The frontend compiler then creates normal editable whole-character and body-part keyframes.

## 1. What is implemented

- `✨ AI Animate` button in the editor top bar.
- Prompt planner endpoint: `POST /v1/animation/plan`.
- Cloudflare Workers AI text planner with JSON-schema output.
- Offline deterministic planner when Cloudflare credentials are not configured.
- Body-part keyframe engine layered on top of the original Animate timeline.
- Whole-character move keyframes.
- Source talking windows: the original talk timeline only advances during planned `talk` clips.
- AI action clips and body-part keyframe markers in the timeline.
- Body-part keyframes are visible/deletable from Character Edit.
- Existing manual whole-character keyframes, body-part offsets, zoom, Cloudflare background generation and MP4 rendering are retained.

## 2. Supported v35 presets

### Gestures

- `wave_right`
- `wave_left`
- `raise_right_hand`
- `raise_left_hand`
- `point_right`
- `point_left`
- `nod`
- `shake_head`
- `lean_forward`

### Movement

- `move_left`
- `move_right`
- `move_to_character`
- `enter_left`
- `enter_right`
- `exit_left`
- `exit_right`

### Source action

- `talk` — uses the supplied Adobe Animate talking timeline; no synthetic talking motion is created.

Unsupported actions such as a backflip are returned in the plan as unsupported rather than inventing motion.

## 3. Cloudflare setup

Create a Workers AI API token and copy your Account ID from Cloudflare Dashboard → Workers AI → **Use REST API**.

Put these values in the project root `.env`:

```env
CLOUDFLARE_ACCOUNT_ID=YOUR_ACCOUNT_ID
CLOUDFLARE_API_TOKEN=YOUR_API_TOKEN

# Prompt animation planner
AI_ANIMATION_PROVIDER=auto
CLOUDFLARE_TEXT_MODEL=@cf/meta/llama-3.1-8b-instruct-fast

# Background generation
AI_IMAGE_PROVIDER=cloudflare
CLOUDFLARE_IMAGE_MODEL=@cf/black-forest-labs/flux-1-schnell
CLOUDFLARE_IMAGE_STEPS=4
```

`AI_ANIMATION_PROVIDER=auto` is recommended during development:

- credentials present → Cloudflare planner;
- credentials absent → local deterministic planner.

To force Cloudflare and fail loudly if credentials are missing:

```env
AI_ANIMATION_PROVIDER=cloudflare
```

To force the local test planner:

```env
AI_ANIMATION_PROVIDER=mock
```

## 4. Rebuild the Docker services

From the project root:

```bash
docker compose down --remove-orphans
docker compose build --no-cache ai frontend
docker compose up -d
```

Check containers:

```bash
docker compose ps
```

Expected services include `frontend`, `backend`, `worker`, `ai`, `db`, and `redis`.

## 5. Verify the AI service

```bash
curl http://localhost:8100/health
```

Expected fields:

```json
{
  "status": "ok",
  "service": "ai",
  "animation_provider": "cloudflare",
  "animation_model": "@cf/meta/llama-3.1-8b-instruct-fast"
}
```

If credentials are not configured and `AI_ANIMATION_PROVIDER=auto`, `animation_provider` will be `mock`.

## 6. Test the planner without opening the UI

This example uses fake IDs only to test the API contract:

```bash
curl -X POST http://localhost:8100/v1/animation/plan \
  -H 'Content-Type: application/json' \
  -d '{
    "prompt": "Woman right hand wave kare, phir man ke paas jaye aur dono 5 second talk karein.",
    "scene": {"width": 1920, "height": 1080, "duration": 8},
    "characters": [
      {
        "id": "woman-1",
        "name": "Women Talk",
        "x": 500,
        "y": 540,
        "parts": ["head","rightHand","rightForearm","rightUpperArm","leftHand","leftForearm","leftUpperArm","torso"],
        "actions": ["talk"]
      },
      {
        "id": "man-1",
        "name": "Men Talk",
        "x": 1200,
        "y": 540,
        "parts": ["head","rightHand","rightForearm","rightUpperArm","leftHand","leftForearm","leftUpperArm","torso"],
        "actions": ["talk"]
      }
    ]
  }'
```

A valid response contains a plan similar to:

```json
{
  "plan": {
    "duration": 9,
    "actions": [
      {"type":"gesture","characterId":"woman-1","preset":"wave_right","start":0,"duration":1.5},
      {"type":"move","characterId":"woman-1","preset":"move_to_character","targetCharacterId":"man-1","start":1.5,"duration":2.5},
      {"type":"talk","characterId":"woman-1","preset":"talk","start":4,"duration":5},
      {"type":"talk","characterId":"man-1","preset":"talk","start":4,"duration":5}
    ],
    "unsupported": []
  }
}
```

## 7. Practical editor workflow

1. Open a project.
2. Add **Men Talk** and/or **Women Talk** from the character library.
3. Wait until the right panel shows the body-part thumbnails. This matters for gestures.
4. Position the characters on the canvas.
5. Click **✨ AI Animate** in the top bar.
6. Enter a prompt, for example:

   `Woman right hand wave kare, phir man ke paas jaye aur dono 5 second talk karein.`

7. Click **Generate Animation Plan**.
8. Inspect the action timings before applying.
9. Click **Apply to Timeline**.
10. Play the scene.
11. Select a character/body part to inspect generated body-part keyframes.
12. Save and render MP4 as normal.

## 8. How v35 executes the prompt

```text
Prompt
  ↓
FastAPI /v1/animation/plan
  ↓
Cloudflare Workers AI JSON plan
  ↓
Pydantic + preset/character validation
  ↓
Frontend animationCompiler.ts
  ├─ whole-character position keyframes
  ├─ body-part offset/rotation keyframes
  └─ source talking windows
  ↓
StageCanvas resolves the current frame
  ↓
CreateJS player receives deterministic transforms
  ↓
Preview / MP4 render
```

## 9. Important implementation rule

Cloudflare never gets permission to invent raw transform values. It can only select from the supported preset names. The transform curves and degrees live in:

```text
frontend/lib/animationPresets.ts
```

The compiler that converts a plan into editor keyframes lives in:

```text
frontend/lib/animationCompiler.ts
```

This keeps character motion predictable and editable.

## 10. Adding a new gesture

Example: add `hands_up`.

1. Add its body-part curves to `frontend/lib/animationPresets.ts`.
2. Add the preset to the backend allowed preset map in `ai_service/app/animation_director.py`.
3. Rebuild `frontend` and `ai`.
4. Test the prompt in the AI Animate panel.

Do not add a preset to the AI allow-list unless the frontend compiler can actually execute it.

## 11. Current limitations

- This is a preset/keyframe animation director, not unrestricted generative motion.
- Perfect walk cycles require dedicated source walk actions or a skeletal/IK system.
- Lip sync is not included in v35.
- Expressions are limited by the source character symbols currently exported from Adobe Animate.
- Gesture quality depends on the pivot/registration points in the supplied Animate symbols. Fine-tune preset rotations per character if necessary.
- Body-part prompts should be generated only after the source player has reported its parts to the editor.

## 12. Recommended next phase

After v35 is stable, add:

1. dedicated Idle / Walk / Talk / Run source actions per character;
2. per-character gesture preset tuning;
3. audio transcription + phoneme timing;
4. mouth-shape/lip-sync tracks;
5. 2D bone hierarchy + IK for unrestricted arm/leg posing;
6. reusable scene-level AI director that can also generate the Cloudflare background from the same prompt.
