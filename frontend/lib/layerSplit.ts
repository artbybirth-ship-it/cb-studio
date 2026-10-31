import type { CharacterKeyframe, CharacterPartKeyframe, EditorObject } from "@/types";
import { resolveCharacterTransformAtTime, sortKeyframes } from "@/lib/keyframes";
import { partKeyframeValuesAt } from "@/lib/partKeyframes";

/**
 * Animate's "drag frames to another layer" for CB Studio, where a layer holds one object: the
 * object cut down to frames a..b (inclusive, 0-based), moved `shift` frames. The piece looks on
 * every one of its frames as the object did there — its own animation (sourceOffsetMs), position
 * and part keyframes inside the range (with keyframes added at the cuts mid-tween), clips and
 * motion range — and nothing outside the range comes along.
 */
const uid = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export function extractFrames(item: EditorObject, a: number, b: number, shift: number, fps: number, id = item.id): EditorObject {
  const from = a / fps;
  const to = b / fps;
  const dt = shift / fps;
  const inRange = (time: number) => Math.round(time * fps) >= a && Math.round(time * fps) <= b;
  const piece: EditorObject = JSON.parse(JSON.stringify(item));
  piece.id = id;
  const oldStart = Math.max(0, Number(item.startTime || 0));
  piece.startTime = Math.max(0, from + dt);
  piece.actionDurationMs = ((b - a + 1) / fps) * 1000;

  // Its own animation carries on from where these frames were (talk windows are in layer time).
  const skipped = Math.max(0, from - oldStart);
  if (item.sourceAnimationClips?.length) {
    piece.sourceAnimationClips = item.sourceAnimationClips
      .map((clip) => ({ ...clip, start: clip.start - skipped }))
      .filter((clip) => clip.start + clip.duration > 0 && clip.start < (b - a + 1) / fps);
  } else if (skipped > 0) piece.sourceOffsetMs = Math.max(0, Number(item.sourceOffsetMs || 0)) + skipped * 1000;

  // Position keyframes: those in range, plus keyframes at the cuts so a tween cut in two keeps its path.
  const keys = sortKeyframes(item.keyframes || []);
  if (keys.length) {
    const kept: CharacterKeyframe[] = keys.filter((key) => inRange(key.time)).map((key) => ({ ...key }));
    const at = (time: number, tween: CharacterKeyframe["tween"]): CharacterKeyframe => {
      const state = resolveCharacterTransformAtTime(item, time);
      return { id: uid("kf"), time, x: state.x, y: state.y, generatedBy: "manual", tween };
    };
    if (!kept.some((key) => Math.round(key.time * fps) === a)) {
      const left = [...keys].reverse().find((key) => key.time < from);
      kept.unshift(at(from, left && keys.some((key) => key.time > from) ? left.tween : false));
    }
    if (!kept.some((key) => Math.round(key.time * fps) === b) && keys.some((key) => key.time > to) && keys.some((key) => key.time < to)) kept.push(at(to, false));
    piece.keyframes = kept.map((key) => ({ ...key, time: Math.max(0, key.time + dt) }));
  }

  // Part keyframes, the same way (before a part's first keyframe its base edit shows: nothing to add).
  if (item.partKeyframes) {
    const parts: Record<string, CharacterPartKeyframe[]> = {};
    for (const [part, frames] of Object.entries(item.partKeyframes)) {
      const sorted = [...frames].sort((x, y) => x.time - y.time);
      const kept = sorted.filter((frame) => inRange(frame.time)).map((frame) => ({ ...frame }));
      const cut = (time: number): CharacterPartKeyframe | null => {
        const values = partKeyframeValuesAt(sorted, time);
        return values ? { ...values, id: uid("pkf"), time, generatedBy: "manual" } : null;
      };
      if (!kept.some((frame) => Math.round(frame.time * fps) === a)) { const first = cut(from); if (first) kept.unshift(first); }
      if (!kept.some((frame) => Math.round(frame.time * fps) === b) && sorted.some((frame) => frame.time > to)) { const last = cut(to); if (last) kept.push(last); }
      if (kept.length) parts[part] = kept.map((frame) => ({ ...frame, time: Math.max(0, frame.time + dt) }));
    }
    piece.partKeyframes = parts;
  }

  // Timeline clips and the motion range: the part inside the range.
  if (item.animationClips?.length) {
    piece.animationClips = item.animationClips
      .filter((clip) => clip.start < to + 1 / fps && clip.start + clip.duration > from)
      .map((clip) => {
        const start = Math.max(clip.start, from);
        const end = Math.min(clip.start + clip.duration, to + 1 / fps);
        return { ...clip, id: id === item.id ? clip.id : uid("clip"), start: start + dt, duration: end - start };
      });
  }
  if (item.manualMotionRange) {
    const start = Math.max(item.manualMotionRange.start, from);
    const end = Math.min(item.manualMotionRange.end, to);
    piece.manualMotionRange = end > start && (piece.keyframes || []).length >= 2
      ? { ...item.manualMotionRange, start: start + dt, end: end + dt }
      : null;
  }
  return piece;
}

/** Moves everything timed on a layer by `dt` seconds (keyframes, part keyframes, clips, motion range). */
export function shiftObjectTimes(item: EditorObject, dt: number) {
  if (!dt) return;
  item.startTime = Math.max(0, Number(item.startTime || 0) + dt);
  if (item.keyframes?.length) item.keyframes = item.keyframes.map((key) => ({ ...key, time: Math.max(0, key.time + dt) }));
  if (item.partKeyframes) {
    item.partKeyframes = Object.fromEntries(Object.entries(item.partKeyframes).map(([part, frames]) => [part, frames.map((frame) => ({ ...frame, time: Math.max(0, frame.time + dt) }))]));
  }
  if (item.animationClips?.length) item.animationClips = item.animationClips.map((clip) => ({ ...clip, start: Math.max(0, clip.start + dt) }));
  if (item.manualMotionRange) item.manualMotionRange = { ...item.manualMotionRange, start: item.manualMotionRange.start + dt, end: item.manualMotionRange.end + dt };
}

export const newLayerId = () => uid("layer");
