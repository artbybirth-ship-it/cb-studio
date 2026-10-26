import json
import os
import re
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen

from fastapi import HTTPException
from pydantic import BaseModel, Field

GESTURE_PRESETS = {
    "wave_right": {"rightUpperArm", "rightForearm"},
    "wave_left": {"leftUpperArm", "leftForearm"},
    "raise_right_hand": {"rightUpperArm"},
    "raise_left_hand": {"leftUpperArm"},
    "point_right": {"rightUpperArm", "rightForearm"},
    "point_left": {"leftUpperArm", "leftForearm"},
    "nod": {"head"},
    "shake_head": {"head"},
    "lean_forward": {"torso"},
}
MOVEMENT_PRESETS = {
    "move_left", "move_right", "move_to_character",
    "enter_left", "enter_right", "exit_left", "exit_right",
}


class AnimationCharacter(BaseModel):
    id: str = Field(min_length=1, max_length=160)
    name: str = Field(min_length=1, max_length=160)
    x: float
    y: float
    parts: list[str] = Field(default_factory=list)
    actions: list[str] = Field(default_factory=lambda: ["talk"])


class AnimationScene(BaseModel):
    width: int = Field(ge=320, le=7680)
    height: int = Field(ge=240, le=4320)
    duration: float = Field(default=8, ge=1, le=120)


class AnimationPlanRequest(BaseModel):
    prompt: str = Field(min_length=2, max_length=3000)
    scene: AnimationScene
    characters: list[AnimationCharacter] = Field(min_length=1, max_length=12)


class AnimationAction(BaseModel):
    type: str
    characterId: str
    preset: str | None = None
    targetCharacterId: str | None = None
    start: float = Field(ge=0, le=120)
    duration: float = Field(gt=0, le=60)


class AnimationPlan(BaseModel):
    duration: float = Field(ge=1, le=120)
    actions: list[AnimationAction] = Field(default_factory=list, max_length=64)
    unsupported: list[str] = Field(default_factory=list, max_length=24)


def animation_provider() -> str:
    requested = os.getenv("AI_ANIMATION_PROVIDER", "auto").strip().lower()
    account = os.getenv("CLOUDFLARE_ACCOUNT_ID", "").strip()
    token = os.getenv("CLOUDFLARE_API_TOKEN", "").strip()
    if requested == "mock":
        return "mock"
    if requested == "cloudflare":
        return "cloudflare" if account and token else "unconfigured"
    return "cloudflare" if account and token else "mock"


def animation_model() -> str:
    # JSON Mode is supported by this model and it is much cheaper/faster than a 70B model.
    return os.getenv("CLOUDFLARE_TEXT_MODEL", "@cf/meta/llama-3.1-8b-instruct-fast").strip()


def _eligible_presets(character: AnimationCharacter) -> list[str]:
    parts = set(character.parts)
    gestures = [name for name, required in GESTURE_PRESETS.items() if required.issubset(parts)]
    return gestures + sorted(MOVEMENT_PRESETS) + (["talk"] if "talk" in character.actions else [])


def _schema() -> dict:
    return {
        "type": "object",
        "properties": {
            "duration": {"type": "number", "minimum": 1, "maximum": 120},
            "actions": {
                "type": "array",
                "maxItems": 64,
                "items": {
                    "type": "object",
                    "properties": {
                        "type": {"type": "string", "enum": ["gesture", "move", "talk"]},
                        "characterId": {"type": "string"},
                        "preset": {"type": ["string", "null"]},
                        "targetCharacterId": {"type": ["string", "null"]},
                        "start": {"type": "number", "minimum": 0, "maximum": 120},
                        "duration": {"type": "number", "minimum": 0.1, "maximum": 60},
                    },
                    "required": ["type", "characterId", "preset", "targetCharacterId", "start", "duration"],
                    "additionalProperties": False,
                },
            },
            "unsupported": {"type": "array", "items": {"type": "string"}, "maxItems": 24},
        },
        "required": ["duration", "actions", "unsupported"],
        "additionalProperties": False,
    }


def _director_context(payload: AnimationPlanRequest) -> dict:
    return {
        "scene": payload.scene.model_dump(),
        "characters": [
            {
                "id": item.id,
                "name": item.name,
                "x": item.x,
                "y": item.y,
                "parts": item.parts,
                "availablePresets": _eligible_presets(item),
            }
            for item in payload.characters
        ],
    }


def _validate_plan(payload: AnimationPlanRequest, candidate: AnimationPlan) -> AnimationPlan:
    character_map = {item.id: item for item in payload.characters}
    actions: list[AnimationAction] = []
    unsupported = list(candidate.unsupported)

    for item in candidate.actions:
        character = character_map.get(item.characterId)
        if not character:
            unsupported.append(f"Unknown character: {item.characterId}")
            continue
        if item.type not in {"gesture", "move", "talk"}:
            unsupported.append(f"Unsupported action type: {item.type}")
            continue
        if item.type == "gesture":
            if item.preset not in GESTURE_PRESETS:
                unsupported.append(f"Unsupported gesture preset: {item.preset}")
                continue
            if not GESTURE_PRESETS[item.preset].issubset(set(character.parts)):
                unsupported.append(f"{character.name} does not expose the body parts required for {item.preset}")
                continue
        if item.type == "move" and item.preset not in MOVEMENT_PRESETS:
            unsupported.append(f"Unsupported movement preset: {item.preset}")
            continue
        if item.type == "move" and item.preset == "move_to_character":
            if not item.targetCharacterId or item.targetCharacterId not in character_map or item.targetCharacterId == item.characterId:
                unsupported.append(f"move_to_character requires a different valid target for {character.name}")
                continue
        if item.type == "talk" and "talk" not in character.actions:
            unsupported.append(f"{character.name} has no talk source action")
            continue
        start = max(0.0, min(119.9, float(item.start)))
        duration = max(0.1, min(60.0, float(item.duration)))
        actions.append(AnimationAction(
            type=item.type,
            characterId=item.characterId,
            preset=("talk" if item.type == "talk" else item.preset),
            targetCharacterId=item.targetCharacterId if item.type == "move" else None,
            start=start,
            duration=duration,
        ))

    required_duration = max([payload.scene.duration] + [a.start + a.duration for a in actions])
    return AnimationPlan(
        duration=min(120.0, max(1.0, required_duration, candidate.duration)),
        actions=sorted(actions, key=lambda item: (item.start, item.characterId)),
        unsupported=unsupported[:24],
    )


def _cloudflare_plan(payload: AnimationPlanRequest) -> AnimationPlan:
    account = os.getenv("CLOUDFLARE_ACCOUNT_ID", "").strip()
    token = os.getenv("CLOUDFLARE_API_TOKEN", "").strip()
    model = animation_model()
    if not account or not token:
        raise HTTPException(status_code=503, detail="Cloudflare animation planner is selected but credentials are missing")

    context = _director_context(payload)
    system = (
        "You are the animation director for a deterministic 2D editor. Convert the user's English/Hinglish instruction "
        "into a timeline plan. You DO NOT create video or invent artwork. Use only character IDs and availablePresets "
        "provided in the scene context. Gesture actions use gesture presets; movement actions use movement presets; talk "
        "uses preset 'talk'. Keep sequential actions sequential unless the prompt clearly says characters act together. "
        "For 'dono/both talk', create parallel talk actions for both. For 'X ke paas jaye/go near X', use move_to_character "
        "with targetCharacterId. If the request cannot be represented, put that instruction in unsupported. Never invent a body part."
    )
    body = json.dumps({
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": f"SCENE CONTEXT:\n{json.dumps(context, ensure_ascii=False)}\n\nUSER INSTRUCTION:\n{payload.prompt}"},
        ],
        "temperature": 0.1,
        "max_tokens": 1600,
        "response_format": {"type": "json_schema", "json_schema": _schema()},
    }).encode("utf-8")
    url = f"https://api.cloudflare.com/client/v4/accounts/{quote(account, safe='')}/ai/run/{model}"
    request = Request(url, data=body, method="POST", headers={
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
        "Accept": "application/json",
    })
    try:
        with urlopen(request, timeout=90) as response:
            result = json.loads(response.read().decode("utf-8"))
    except HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")[:1800]
        raise HTTPException(status_code=502, detail=f"Cloudflare animation planner error: {detail}") from exc
    except (URLError, TimeoutError) as exc:
        raise HTTPException(status_code=502, detail=f"Cloudflare animation planner unavailable: {exc}") from exc
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=502, detail="Cloudflare animation planner returned invalid JSON") from exc

    if result.get("success") is False:
        raise HTTPException(status_code=502, detail=f"Cloudflare animation planner error: {result.get('errors') or []}")
    envelope = result.get("result") or result
    raw = envelope.get("response") if isinstance(envelope, dict) else envelope
    if isinstance(raw, str):
        cleaned = re.sub(r"^```(?:json)?\s*|\s*```$", "", raw.strip(), flags=re.I | re.S)
        try:
            raw = json.loads(cleaned)
        except json.JSONDecodeError as exc:
            raise HTTPException(status_code=502, detail="Cloudflare animation planner did not return a JSON plan") from exc
    if not isinstance(raw, dict):
        raise HTTPException(status_code=502, detail="Cloudflare animation planner returned an unexpected response")
    try:
        return _validate_plan(payload, AnimationPlan.model_validate(raw))
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Cloudflare animation plan validation failed: {exc}") from exc


def _subjects(payload: AnimationPlanRequest, prompt: str) -> list[AnimationCharacter]:
    lower = prompt.lower()
    women = [c for c in payload.characters if re.search(r"women|woman|female|girl|lady", c.name, re.I)]
    men = [c for c in payload.characters if re.search(r"men|man|male|boy", c.name, re.I)]
    if re.search(r"\b(woman|women|girl|lady|ladki|mahila)\b", lower) and women:
        return women[:1]
    if re.search(r"\b(man|men|boy|ladka|aadmi)\b", lower) and men:
        return men[:1]
    if re.search(r"\b(dono|both|all)\b", lower):
        return payload.characters
    return payload.characters[:1]


def _mock_plan(payload: AnimationPlanRequest) -> AnimationPlan:
    """Deterministic offline planner so the feature can be tested before Cloudflare credentials are added."""
    text = payload.prompt.lower()
    subjects = _subjects(payload, text)
    actions: list[AnimationAction] = []
    unsupported: list[str] = []
    cursor = 0.0

    def add_gesture(preset: str, duration: float = 1.5):
        nonlocal cursor
        added = False
        for char in subjects:
            if preset in _eligible_presets(char):
                actions.append(AnimationAction(type="gesture", characterId=char.id, preset=preset, start=cursor, duration=duration))
                added = True
        if added:
            cursor += duration
        else:
            unsupported.append(f"The selected character does not expose the body parts required for {preset}.")

    if any(word in text for word in ["wave", "hello hand", "hi hand", "haath hila", "hath hila"]):
        add_gesture("wave_left" if "left" in text or "baaya" in text else "wave_right")
    elif any(word in text for word in ["raise", "hand up", "haath upar", "hath upar"]):
        add_gesture("raise_left_hand" if "left" in text or "baaya" in text else "raise_right_hand")
    elif "point" in text or "ishara" in text:
        add_gesture("point_left" if "left" in text or "baaya" in text else "point_right")
    if "nod" in text or "head yes" in text or "haan me sir" in text:
        add_gesture("nod", 1.2)
    if "shake head" in text or "head no" in text or "na me sir" in text:
        add_gesture("shake_head", 1.2)
    if "lean" in text or "jhuk" in text:
        add_gesture("lean_forward", 1.4)

    move_subject = subjects[0] if subjects else None
    if move_subject:
        if any(word in text for word in ["paas", "near", "towards", "toward"] ) and len(payload.characters) > 1:
            target = next((c for c in payload.characters if c.id != move_subject.id), None)
            if target:
                actions.append(AnimationAction(type="move", characterId=move_subject.id, preset="move_to_character", targetCharacterId=target.id, start=cursor, duration=2.5))
                cursor += 2.5
        elif "enter" in text or "aaye" in text or "aao" in text:
            preset = "enter_right" if "right" in text else "enter_left"
            actions.append(AnimationAction(type="move", characterId=move_subject.id, preset=preset, start=cursor, duration=2.2))
            cursor += 2.2
        elif ("move" in text or "chale" in text or "walk" in text) and ("left" in text or "right" in text):
            preset = "move_left" if "left" in text else "move_right"
            actions.append(AnimationAction(type="move", characterId=move_subject.id, preset=preset, start=cursor, duration=2.5))
            cursor += 2.5

    if any(word in text for word in ["talk", "baat", "bolo", "bole", "dialogue", "conversation"]):
        mentions_woman = bool(re.search(r"\b(woman|women|girl|lady|ladki|mahila)\b", text))
        mentions_man = bool(re.search(r"\b(man|men|boy|ladka|aadmi)\b", text))
        talk_all = bool(re.search(r"\b(dono|both|all)\b", text)) or (mentions_woman and mentions_man)
        talk_subjects = payload.characters if talk_all else subjects
        talk_duration = 4.0
        match = re.search(r"(\d+(?:\.\d+)?)\s*(?:second|seconds|sec|s)\b", text)
        if match:
            talk_duration = max(0.5, min(30.0, float(match.group(1))))
        for char in talk_subjects:
            if "talk" in char.actions:
                actions.append(AnimationAction(type="talk", characterId=char.id, preset="talk", start=cursor, duration=talk_duration))
        cursor += talk_duration

    if not actions:
        unsupported.append("Offline planner could not map this prompt. Configure Cloudflare for broader natural-language understanding, or use words such as wave, move left/right, paas/near, talk/baat, nod, point, or raise hand.")
    return _validate_plan(payload, AnimationPlan(duration=max(payload.scene.duration, cursor or 1), actions=actions, unsupported=unsupported))


def create_animation_plan(payload: AnimationPlanRequest) -> dict:
    provider = animation_provider()
    if provider == "cloudflare":
        plan = _cloudflare_plan(payload)
        return {"provider": f"cloudflare:{animation_model()}", "prompt": payload.prompt, "plan": plan.model_dump()}
    if provider == "unconfigured":
        raise HTTPException(status_code=503, detail="Cloudflare animation planner is selected but CLOUDFLARE_ACCOUNT_ID or CLOUDFLARE_API_TOKEN is missing")
    plan = _mock_plan(payload)
    return {"provider": "mock:deterministic-animation-director", "prompt": payload.prompt, "plan": plan.model_dump()}
