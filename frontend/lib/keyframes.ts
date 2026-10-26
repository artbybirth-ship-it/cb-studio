import type { CharacterKeyframe, EditorObject } from "@/types";

export type CharacterTransform = {
  x: number;
  y: number;
  scale: number;
  rotation: number;
};

const EPSILON = 1 / 120;

/** Eased tween progress (Animate classic-tween style). easeIn/easeOut are 0..100 strengths:
 *  a cubic curve whose start/end handles flatten as the ease grows; 0/0 is linear. */
export const easeProgress = (t: number, easeIn = 0, easeOut = 0) => {
  const inStrength = Math.max(0, Math.min(1, easeIn / 100));
  const outStrength = Math.max(0, Math.min(1, easeOut / 100));
  const y1 = (1 - inStrength) / 3;
  const y2 = 1 - (1 - outStrength) / 3;
  const u = 1 - t;
  return 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t;
};

export const sortKeyframes = (frames: CharacterKeyframe[] = []) =>
  [...frames].sort((a, b) => a.time - b.time);

export const resolveCharacterTransformAtTime = (object: EditorObject, timeSeconds: number): CharacterTransform => {
  const base: CharacterTransform = {
    x: Number(object.x || 0),
    y: Number(object.y || 0),
    scale: Number(object.scale || 1),
    rotation: Number(object.rotation || 0),
  };
  const frames = sortKeyframes(object.keyframes || []);
  if (frames.length === 0) return base;

  const time = Math.max(0, Number(timeSeconds || 0));
  if (time <= frames[0].time + EPSILON) {
    const first = frames[0];
    return { x: first.x, y: first.y, scale: base.scale, rotation: base.rotation };
  }
  const last = frames[frames.length - 1];
  if (time >= last.time - EPSILON) {
    return { x: last.x, y: last.y, scale: base.scale, rotation: base.rotation };
  }

  for (let index = 0; index < frames.length - 1; index += 1) {
    const left = frames[index];
    const right = frames[index + 1];
    if (time < left.time - EPSILON || time > right.time + EPSILON) continue;
    // No tween: the position holds until the next keyframe (Animate).
    if (left.tween === false) return { x: left.x, y: left.y, scale: base.scale, rotation: base.rotation };
    const span = Math.max(EPSILON, right.time - left.time);
    const linear = Math.max(0, Math.min(1, (time - left.time) / span));
    const t = left.tween ? easeProgress(linear, left.tween.easeIn, left.tween.easeOut) : linear;
    return {
      x: left.x + (right.x - left.x) * t,
      y: left.y + (right.y - left.y) * t,
      scale: base.scale,
      rotation: base.rotation,
    };
  }
  return base;
};

export const findKeyframeNearTime = (frames: CharacterKeyframe[] = [], timeSeconds: number) =>
  frames.find((frame) => Math.abs(frame.time - timeSeconds) <= EPSILON) || null;

export const upsertCharacterKeyframe = (
  object: EditorObject,
  timeSeconds: number,
  transform: CharacterTransform,
  generatedBy: "ai" | "manual" = "manual",
  /** Tween setting for a newly created keyframe (existing keyframes keep theirs). */
  newTween?: CharacterKeyframe["tween"],
): CharacterKeyframe[] => {
  const time = Math.max(0, Number(timeSeconds || 0));
  const frames = sortKeyframes(object.keyframes || []);
  const existing = frames.find((frame) => Math.abs(frame.time - time) <= EPSILON);
  if (existing) {
    return sortKeyframes(frames.map((frame) => frame.id === existing.id ? {
      ...frame,
      time,
      x: transform.x,
      y: transform.y,
      scale: transform.scale,
      rotation: transform.rotation,
      generatedBy: existing.generatedBy || generatedBy,
    } : frame));
  }
  return sortKeyframes([...frames, {
    id: `kf-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    time,
    x: transform.x,
    y: transform.y,
    scale: transform.scale,
    rotation: transform.rotation,
    generatedBy,
    ...(newTween !== undefined ? { tween: newTween } : {}),
  }]);
};
