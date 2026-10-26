import { GESTURE_PRESETS } from "@/lib/animationPresets";
import { resolveCharacterTransformAtTime, upsertCharacterKeyframe } from "@/lib/keyframes";
import { upsertPartKeyframe } from "@/lib/partKeyframes";
import type { AnimationPlan, AnimationPlanAction, EditorData, EditorObject } from "@/types";

const actionLabel = (action: AnimationPlanAction) => {
  if (action.type === "talk") return "Talk";
  if (action.type === "move") return (action.preset || "Move").replaceAll("_", " ");
  return GESTURE_PRESETS[action.preset || ""]?.label || (action.preset || "Gesture").replaceAll("_", " ");
};

const cleanPreviousAI = (object: EditorObject) => {
  object.keyframes = (object.keyframes || []).filter((frame) => frame.generatedBy !== "ai");
  const nextPartKeyframes: NonNullable<EditorObject["partKeyframes"]> = {};
  Object.entries(object.partKeyframes || {}).forEach(([key, frames]) => {
    const kept = frames.filter((frame) => frame.generatedBy !== "ai");
    if (kept.length > 0) nextPartKeyframes[key] = kept;
  });
  object.partKeyframes = nextPartKeyframes;
  object.animationClips = (object.animationClips || []).filter((clip) => clip.generatedBy !== "ai");
  object.sourceAnimationClips = (object.sourceAnimationClips || []).filter((clip) => !clip.id.startsWith("ai-source-"));
};

const compileGesture = (object: EditorObject, action: AnimationPlanAction) => {
  const preset = GESTURE_PRESETS[action.preset || ""];
  if (!preset) return false;
  const availableParts = new Set((object.sourceParts || []).map((part) => part.key));
  let applied = false;
  Object.entries(preset.parts).forEach(([partKey, samples]) => {
    if (availableParts.size > 0 && !availableParts.has(partKey)) return;
    samples.forEach((sample) => {
      const time = Math.max(0, action.start + sample.t * Math.max(0.1, action.duration));
      object.partKeyframes = object.partKeyframes || {};
      object.partKeyframes[partKey] = upsertPartKeyframe(object, partKey, time, {
        offsetX: Number(sample.offsetX || 0),
        offsetY: Number(sample.offsetY || 0),
        rotation: Number(sample.rotation || 0),
        scale: 1,
        flipX: false,
      }, "ai");
    });
    applied = true;
  });
  return applied;
};

const movementEnd = (
  object: EditorObject,
  target: EditorObject | undefined,
  action: AnimationPlanAction,
  sceneWidth: number,
  sceneHeight: number,
) => {
  const start = resolveCharacterTransformAtTime(object, action.start);
  const preset = action.preset || "move_right";
  const delta = Math.max(180, sceneWidth * 0.18);
  const offscreenPadding = Math.max(160, (object.sourceWidth || 420) * (object.scale || 1) * 0.2);
  let from = { ...start };
  let to = { ...start };
  if (preset === "move_left") to.x = Math.max(-sceneWidth, start.x - delta);
  else if (preset === "move_right") to.x = Math.min(sceneWidth * 2, start.x + delta);
  else if (preset === "move_to_character" && target) {
    const targetTransform = resolveCharacterTransformAtTime(target, action.start + action.duration);
    const gap = Math.max(140, Math.min(320, sceneWidth * 0.16));
    to.x = start.x <= targetTransform.x ? targetTransform.x - gap : targetTransform.x + gap;
    to.y = targetTransform.y;
  } else if (preset === "enter_left") {
    from.x = -offscreenPadding;
    to = { ...start };
  } else if (preset === "enter_right") {
    from.x = sceneWidth + offscreenPadding;
    to = { ...start };
  } else if (preset === "exit_left") {
    to.x = -offscreenPadding;
  } else if (preset === "exit_right") {
    to.x = sceneWidth + offscreenPadding;
  }
  from.y = Math.max(-sceneHeight, Math.min(sceneHeight * 2, from.y));
  to.y = Math.max(-sceneHeight, Math.min(sceneHeight * 2, to.y));
  return { from, to };
};

const compileMove = (object: EditorObject, target: EditorObject | undefined, action: AnimationPlanAction, width: number, height: number) => {
  const { from, to } = movementEnd(object, target, action, width, height);
  object.keyframes = upsertCharacterKeyframe(object, action.start, from, "ai");
  object.keyframes = upsertCharacterKeyframe(object, action.start + Math.max(0.1, action.duration), to, "ai");
  return true;
};

export type CompileAnimationResult = {
  data: EditorData;
  appliedActions: number;
  skippedActions: string[];
};

export const compileAnimationPlan = (
  data: EditorData,
  plan: AnimationPlan,
  sceneWidth: number,
  sceneHeight: number,
): CompileAnimationResult => {
  const objects = data.objects;
  objects.filter((item) => item.type === "character").forEach(cleanPreviousAI);
  let appliedActions = 0;
  const skippedActions: string[] = [];

  [...plan.actions].sort((a, b) => a.start - b.start).forEach((action, index) => {
    const object = objects.find((item) => item.id === action.characterId && item.type === "character");
    if (!object) {
      skippedActions.push(`Character not found: ${action.characterId}`);
      return;
    }
    let applied = false;
    if (action.type === "gesture") applied = compileGesture(object, action);
    if (action.type === "move") {
      const target = action.targetCharacterId ? objects.find((item) => item.id === action.targetCharacterId && item.type === "character") : undefined;
      applied = compileMove(object, target, action, sceneWidth, sceneHeight);
    }
    if (action.type === "talk") {
      object.sourceAnimationClips = [
        ...(object.sourceAnimationClips || []),
        { id: `ai-source-${Date.now()}-${index}`, mode: "talk", start: action.start, duration: Math.max(0.1, action.duration) },
      ];
      applied = true;
    }
    if (!applied) {
      skippedActions.push(`${object.name}: ${actionLabel(action)} could not be applied because the required body part/preset is unavailable.`);
      return;
    }
    object.animationClips = [
      ...(object.animationClips || []),
      {
        id: `ai-clip-${Date.now()}-${index}`,
        type: action.type,
        label: actionLabel(action),
        preset: action.preset || undefined,
        start: Math.max(0, action.start),
        duration: Math.max(0.1, action.duration),
        generatedBy: "ai",
        targetCharacterId: action.targetCharacterId || null,
      },
    ];
    appliedActions += 1;
  });

  return { data, appliedActions, skippedActions };
};
