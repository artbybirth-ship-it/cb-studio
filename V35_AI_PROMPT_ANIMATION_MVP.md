# v35 AI Prompt Animation MVP

v35 adds a practical prompt-controlled animation layer without replacing the original Adobe Animate artwork.

## Added

- AI Animate modal with plan preview and explicit Apply to Timeline.
- Cloudflare Workers AI text planner endpoint with JSON-schema output.
- Deterministic mock planner for offline/local setup testing.
- Per-body-part keyframes: offset X/Y + rotation + easing.
- Gesture preset compiler.
- Whole-character movement compiler.
- Source talk windows so original source talking motion is used only during planned talk actions.
- AI action clips and body-part keyframe markers on the timeline.
- Manual add/delete/clear controls for body-part keyframes.
- Health endpoint now reports animation provider/model.

## Main code

- `ai_service/app/animation_director.py`
- `frontend/components/AIAnimatePanel.tsx`
- `frontend/lib/animationPresets.ts`
- `frontend/lib/animationCompiler.ts`
- `frontend/lib/partKeyframes.ts`

See `PRACTICAL_AI_ANIMATION_SETUP.md` for setup and test commands.
