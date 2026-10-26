import type { CharacterPartKey, CharacterPartKeyframe, CharacterPartOverride, EditorObject } from "@/types";

/** stretchX / stretchY: width / height on top of `scale`, along the part's own axes (side handles). */
export type PartTransform = { offsetX: number; offsetY: number; rotation: number; scale: number; flipX: boolean; skewX?: number; skewY?: number; stretchX?: number; stretchY?: number };
const EPSILON = 1 / 120;

const sort = (frames: CharacterPartKeyframe[] = []) => [...frames].sort((a, b) => a.time - b.time);
const ease = (value: number, mode: CharacterPartKeyframe["easing"] = "easeInOut") => {
  const t = Math.max(0, Math.min(1, value));
  if (mode === "linear") return t;
  if (mode === "easeIn") return t * t;
  if (mode === "easeOut") return 1 - (1 - t) * (1 - t);
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
};

const frameScale = (frame: CharacterPartKeyframe) => Math.max(0.02, Number(frame.scale ?? 1));
const frameStretch = (frame: CharacterPartKeyframe, axis: "stretchX" | "stretchY") => Math.max(0.02, Number(frame[axis] ?? 1));
/** Stretch is stored only when it differs from 1, so parts without it stay exactly as before. */
const stretchOf = (value: unknown) => Math.max(0.02, Number(value ?? 1) || 1);

export const resolvePartTransformAtTime = (object: EditorObject, partKey: CharacterPartKey, timeSeconds: number): PartTransform => {
  const baseOverride = object.partOverrides?.[partKey] || {};
  const base: PartTransform = {
    offsetX: Number(baseOverride.offsetX || 0),
    offsetY: Number(baseOverride.offsetY || 0),
    rotation: Number(baseOverride.rotation || 0),
    scale: Math.max(0.02, Number(baseOverride.scale ?? 1)),
    flipX: Boolean(baseOverride.flipX),
    skewX: Number(baseOverride.skewX || 0),
    skewY: Number(baseOverride.skewY || 0),
    stretchX: stretchOf(baseOverride.stretchX),
    stretchY: stretchOf(baseOverride.stretchY),
  };
  const frames = sort(object.partKeyframes?.[partKey] || []);
  if (frames.length === 0) return base;
  const time = Math.max(0, Number(timeSeconds || 0));
  if (time < frames[0].time - EPSILON) return base;
  const last = frames[frames.length - 1];
  if (time >= last.time - EPSILON) {
    return {
      offsetX: base.offsetX + last.offsetX,
      offsetY: base.offsetY + last.offsetY,
      rotation: base.rotation + last.rotation,
      scale: base.scale * frameScale(last),
      flipX: typeof last.flipX === "boolean" ? last.flipX : base.flipX,
      skewX: (base.skewX || 0) + Number(last.skewX || 0),
      skewY: (base.skewY || 0) + Number(last.skewY || 0),
      stretchX: (base.stretchX ?? 1) * frameStretch(last, "stretchX"),
      stretchY: (base.stretchY ?? 1) * frameStretch(last, "stretchY"),
    };
  }

  for (let index = 0; index < frames.length - 1; index += 1) {
    const left = frames[index];
    const right = frames[index + 1];
    if (time < left.time - EPSILON || time > right.time + EPSILON) continue;
    const span = Math.max(EPSILON, right.time - left.time);
    const t = ease((time - left.time) / span, right.easing || left.easing);
    const leftScale = frameScale(left);
    const rightScale = frameScale(right);
    return {
      offsetX: base.offsetX + left.offsetX + (right.offsetX - left.offsetX) * t,
      offsetY: base.offsetY + left.offsetY + (right.offsetY - left.offsetY) * t,
      rotation: base.rotation + left.rotation + (right.rotation - left.rotation) * t,
      scale: base.scale * (leftScale + (rightScale - leftScale) * t),
      skewX: (base.skewX || 0) + Number(left.skewX || 0) + (Number(right.skewX || 0) - Number(left.skewX || 0)) * t,
      skewY: (base.skewY || 0) + Number(left.skewY || 0) + (Number(right.skewY || 0) - Number(left.skewY || 0)) * t,
      stretchX: (base.stretchX ?? 1) * (frameStretch(left, "stretchX") + (frameStretch(right, "stretchX") - frameStretch(left, "stretchX")) * t),
      stretchY: (base.stretchY ?? 1) * (frameStretch(left, "stretchY") + (frameStretch(right, "stretchY") - frameStretch(left, "stretchY")) * t),
      // Flip is intentionally discrete so the artwork never passes through a zero-width state.
      // The new flip state becomes active exactly on the right-hand keyframe.
      flipX: time >= right.time - EPSILON
        ? (typeof right.flipX === "boolean" ? right.flipX : (typeof left.flipX === "boolean" ? left.flipX : base.flipX))
        : (typeof left.flipX === "boolean" ? left.flipX : base.flipX),
    };
  }
  return base;
};

export const resolvePartOverridesAtTime = (object: EditorObject, timeSeconds: number): Record<CharacterPartKey, CharacterPartOverride> => {
  const keys = new Set<string>([
    ...Object.keys(object.partOverrides || {}),
    ...Object.keys(object.partKeyframes || {}),
  ]);
  const result: Record<string, CharacterPartOverride> = {};
  keys.forEach((key) => {
    const base = object.partOverrides?.[key] || {};
    const resolved = resolvePartTransformAtTime(object, key, timeSeconds);
    result[key] = { ...base, ...resolved };
  });
  return result;
};

export const upsertPartKeyframe = (
  object: EditorObject,
  partKey: CharacterPartKey,
  timeSeconds: number,
  transform: PartTransform,
  generatedBy: "ai" | "manual" = "manual",
): CharacterPartKeyframe[] => {
  const time = Math.max(0, Number(timeSeconds || 0));
  const frames = sort(object.partKeyframes?.[partKey] || []);
  const existing = frames.find((frame) => Math.abs(frame.time - time) <= EPSILON);
  const next: CharacterPartKeyframe = {
    id: existing?.id || `pkf-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    time,
    offsetX: transform.offsetX,
    offsetY: transform.offsetY,
    rotation: transform.rotation,
    scale: Math.max(0.02, Number(transform.scale || 1)),
    flipX: Boolean(transform.flipX),
    skewX: Number(transform.skewX || 0),
    skewY: Number(transform.skewY || 0),
    ...(stretchOf(transform.stretchX) !== 1 ? { stretchX: stretchOf(transform.stretchX) } : {}),
    ...(stretchOf(transform.stretchY) !== 1 ? { stretchY: stretchOf(transform.stretchY) } : {}),
    easing: existing?.easing || "easeInOut",
    generatedBy: existing?.generatedBy || generatedBy,
  };
  return sort(existing ? frames.map((frame) => frame.id === existing.id ? next : frame) : [...frames, next]);
};

export const resolveSourceSeekMs = (object: EditorObject, timeSeconds: number) => {
  const layerStart = Math.max(0, Number(object.startTime || 0));
  const localTime = Math.max(0, timeSeconds - layerStart);
  const clips = [...(object.sourceAnimationClips || [])].sort((a, b) => a.start - b.start);
  if (clips.length === 0) return localTime * 1000;
  const active = clips.find((clip) => localTime >= clip.start && localTime < clip.start + clip.duration);
  if (active) return Math.max(0, (localTime - active.start) * 1000);
  return 0;
};

/**
 * Linear part of a part edit in stage space, A = R·K·S (scale incl. flip, then skew, then rotate);
 * the same matrix the player bridge and the editor's CSS transform use.
 */
export const partEditMatrix = (state: { rotation?: number; scale?: number; flipX?: boolean; skewX?: number; skewY?: number; stretchX?: number; stretchY?: number }) => {
  const angle = Number(state.rotation || 0) * Math.PI / 180;
  const c = Math.cos(angle), s = Math.sin(angle);
  const scale = Math.max(0.02, Number(state.scale ?? 1));
  const sx = scale * stretchOf(state.stretchX) * (state.flipX ? -1 : 1), sy = scale * stretchOf(state.stretchY);
  const tx = Math.tan(Number(state.skewX || 0) * Math.PI / 180), ty = Math.tan(Number(state.skewY || 0) * Math.PI / 180);
  return { a11: sx * (c - s * ty), a12: sy * (c * tx - s), a21: sx * (s + c * ty), a22: sy * (s * tx + c) };
};
