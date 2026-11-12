import type { EditorObject, GroupKeyframe, GroupMotion } from "@/types";
import { easeProgress, resolveCharacterTransformAtTime, type CharacterTransform } from "@/lib/keyframes";

/**
 * Motion of a ⌘G group as a whole (Animate: a symbol's tween). Every member carries the same
 * `groupMotion`: the registration point (pivotX/Y, stage px where the group stands with no motion)
 * and keyframes of the group's move (x, y), turn (rotation, degrees) and size (scale) — all
 * relative to where the members themselves are. A member is drawn at
 *   pivot + move + scale · turn(own position − pivot), its own rotation + turn, its own scale × scale.
 * Keep in sync with public/render-harness.html (groupPlace).
 */
export type GroupPose = { x: number; y: number; rotation: number; scale: number };
const EPSILON = 1 / 120;
const REST: GroupPose = { x: 0, y: 0, rotation: 0, scale: 1 };

export const sortGroupKeyframes = (frames: GroupKeyframe[] = []) => [...frames].sort((a, b) => a.time - b.time);
const poseOf = (frame: GroupKeyframe): GroupPose => ({ x: Number(frame.x || 0), y: Number(frame.y || 0), rotation: Number(frame.rotation || 0), scale: Math.max(0.02, Number(frame.scale ?? 1)) });

/** The group's move, turn and size at a time: held before the first and after the last keyframe,
 *  held between keyframes without a tween, eased along a tween. */
export function resolveGroupPose(motion: GroupMotion | undefined, timeSeconds: number): GroupPose {
  const frames = sortGroupKeyframes(motion?.keyframes || []);
  if (!frames.length) return REST;
  const time = Math.max(0, Number(timeSeconds || 0));
  if (time <= frames[0].time + EPSILON) return poseOf(frames[0]);
  const last = frames[frames.length - 1];
  if (time >= last.time - EPSILON) return poseOf(last);
  for (let index = 0; index < frames.length - 1; index += 1) {
    const left = frames[index];
    const right = frames[index + 1];
    if (time < left.time - EPSILON || time > right.time + EPSILON) continue;
    if (left.tween === false) return poseOf(left);
    const linear = Math.max(0, Math.min(1, (time - left.time) / Math.max(EPSILON, right.time - left.time)));
    const t = left.tween ? easeProgress(linear, left.tween.easeIn, left.tween.easeOut) : linear;
    const a = poseOf(left);
    const b = poseOf(right);
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, rotation: a.rotation + (b.rotation - a.rotation) * t, scale: a.scale + (b.scale - a.scale) * t };
  }
  return REST;
}

const turn = (x: number, y: number, degrees: number) => {
  const r = (degrees * Math.PI) / 180;
  return { x: x * Math.cos(r) - y * Math.sin(r), y: x * Math.sin(r) + y * Math.cos(r) };
};
const pivotOf = (motion: GroupMotion | undefined) => ({ x: Number(motion?.pivotX || 0), y: Number(motion?.pivotY || 0) });
export const isRestPose = (pose: GroupPose) => !pose.x && !pose.y && !pose.rotation && pose.scale === 1;

/** A member's own transform, with the group's pose on top (where it is drawn). */
export function applyGroupPose(own: CharacterTransform, motion: GroupMotion | undefined, pose: GroupPose): CharacterTransform {
  if (isRestPose(pose)) return own;
  const pivot = pivotOf(motion);
  const v = turn(own.x - pivot.x, own.y - pivot.y, pose.rotation);
  return { x: pivot.x + pose.x + pose.scale * v.x, y: pivot.y + pose.y + pose.scale * v.y, rotation: own.rotation + pose.rotation, scale: own.scale * pose.scale };
}
/** Where a member is drawn → its own transform (edits on the canvas are written back this way). */
export function removeGroupPose(drawn: CharacterTransform, motion: GroupMotion | undefined, pose: GroupPose): CharacterTransform {
  if (isRestPose(pose)) return drawn;
  const pivot = pivotOf(motion);
  const v = turn((drawn.x - pivot.x - pose.x) / pose.scale, (drawn.y - pivot.y - pose.y) / pose.scale, -pose.rotation);
  return { x: pivot.x + v.x, y: pivot.y + v.y, rotation: drawn.rotation - pose.rotation, scale: drawn.scale / pose.scale };
}

/** Where an object is drawn at a time: its own position (a character's keyframes), size and turn,
 *  moved by its group's motion. */
export function resolveObjectTransformAtTime(object: EditorObject, timeSeconds: number): CharacterTransform {
  const own = object.type === "character"
    ? resolveCharacterTransformAtTime(object, timeSeconds)
    : { x: Number(object.x || 0), y: Number(object.y || 0), scale: Number(object.scale || 1), rotation: Number(object.rotation || 0) };
  return object.group && object.groupMotion ? applyGroupPose(own, object.groupMotion, resolveGroupPose(object.groupMotion, timeSeconds)) : own;
}

/** The group's registration point where it is drawn now (null: not set — the group box centre is used). */
export function groupPivotAtTime(motion: GroupMotion | undefined, timeSeconds: number) {
  if (!motion || motion.pivotX == null || motion.pivotY == null) return null;
  const pose = resolveGroupPose(motion, timeSeconds);
  return { x: Number(motion.pivotX) + pose.x, y: Number(motion.pivotY) + pose.y };
}

/**
 * A change made to the whole group on the canvas — every member turned by dRotation, sized by
 * dScale and then moved so that a member drawn at `before` lands at `after` — written into the
 * group's pose (the keyframe being edited): pose' = change ∘ pose.
 */
export function composeGroupChange(motion: GroupMotion, pose: GroupPose, dRotation: number, dScale: number, before: { x: number; y: number }, after: { x: number; y: number }): GroupPose {
  const pivot = pivotOf(motion);
  // change(q) = dScale·turn(q) + t, with t fixed by the member: after = dScale·turn(before) + t.
  const turnedBefore = turn(before.x, before.y, dRotation);
  const t = { x: after.x - dScale * turnedBefore.x, y: after.y - dScale * turnedBefore.y };
  // The new pose keeps the same pivot: pivot + move' = change(pivot + move).
  const moved = turn(pivot.x + pose.x, pivot.y + pose.y, dRotation);
  return { x: dScale * moved.x + t.x - pivot.x, y: dScale * moved.y + t.y - pivot.y, rotation: pose.rotation + dRotation, scale: Math.max(0.02, pose.scale * dScale) };
}

/** Moving the registration point keeps the group where it is: each keyframe's move absorbs it. */
export function movePivot(motion: GroupMotion, pivotX: number, pivotY: number): GroupMotion {
  const old = pivotOf(motion);
  const dx = pivotX - old.x;
  const dy = pivotY - old.y;
  const keyframes = (motion.keyframes || []).map((frame) => {
    const pose = poseOf(frame);
    const v = turn(dx, dy, pose.rotation);
    return { ...frame, x: pose.x + pose.scale * v.x - dx, y: pose.y + pose.scale * v.y - dy };
  });
  return { ...motion, pivotX, pivotY, keyframes };
}
