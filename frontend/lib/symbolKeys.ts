import type { FlaFrame, FlaLayer } from "@/components/SymbolTimeline";

/**
 * Keyframes moved and added inside a character (step inside). A layer's keyframes are a list of
 * anchors [frame in the file, frame now]: its keyframes, then the frame its last span ends on.
 * An added keyframe is an anchor the file has none at; it takes the file frame it was added at.
 * The player (cb-animate-bridge.js retimeSteps) follows the same list.
 */
export type Anchor = [number, number];

/** Where each keyframe of the layer is in the file, then where the last span ends. */
export function fileAnchors(layer: FlaLayer): Anchor[] {
  const starts = Array.from(new Set(layer.frames.map((frame) => frame.i))).sort((a, b) => a - b);
  const end = Math.max(0, ...layer.frames.map((frame) => frame.i + frame.d));
  return [...starts, end].map((frame) => [frame, frame] as Anchor);
}

/** A frame of the file → the frame it plays at now. */
export function nowOf(anchors: Anchor[], file: number): number {
  if (file <= anchors[0][0]) return anchors[0][1] + (file - anchors[0][0]);
  for (let k = 0; k + 1 < anchors.length; k += 1) {
    if (file <= anchors[k + 1][0]) return anchors[k][1] + ((file - anchors[k][0]) * (anchors[k + 1][1] - anchors[k][1])) / (anchors[k + 1][0] - anchors[k][0] || 1);
  }
  const last = anchors[anchors.length - 1];
  return last[1] + (file - last[0]);
}

/** A frame now → the frame of the file it shows. */
export function fileOf(anchors: Anchor[], now: number): number {
  const flipped = anchors.map(([file, at]) => [at, file] as Anchor);
  return nowOf(flipped, now);
}

/** The layer's spans as they are now: file frames moved to their new place, an added keyframe splitting its span. */
export type ShownFrame = FlaFrame & { source: FlaFrame; added: boolean; anchor: number; made?: boolean };
export function shownFrames(layer: FlaLayer, anchors: Anchor[], marks?: { tweens?: Tween[]; blanks?: number[]; cut?: number }): ShownFrame[] {
  const out: ShownFrame[] = [];
  for (let k = 0; k + 1 < anchors.length; k += 1) {
    if (anchors[k + 1][1] <= anchors[k][1]) continue; // a keyframe that was cleared or removed has no frames left
    const source = [...layer.frames].reverse().find((frame) => frame.i <= anchors[k][0]) || layer.frames[0];
    if (source.ended) continue; // where a pasted layer was cut short: no frames there
    const cut = marks?.cut;
    if (cut != null && anchors[k][1] >= cut) continue; // frames removed from the layer's end
    const added = anchors[k][0] !== source.i;
    const blank = Boolean(source.blank) || Boolean(marks?.blanks?.includes(anchors[k][0]));
    const base: FlaFrame = blank ? { i: 0, d: 0, blank: true } : added ? { i: 0, d: 0, tween: source.tween, ease: source.ease, symbols: source.symbols } : { ...source };
    const made = !base.tween && !blank && madeTween(anchors, k, marks?.tweens);
    out.push({ ...base, ...(made ? { tween: "classic" as const, ease: -made[1] } : {}), i: anchors[k][1], d: Math.min(anchors[k + 1][1], cut ?? Infinity) - anchors[k][1], source, added, anchor: k, made: Boolean(made) });
  }
  return out;
}

/** A classic tween made in the editor: [file frame it starts at, ease −100…100]. */
export type Tween = [number, number];

/** The tween made on the span starting at anchor k, when a keyframe follows it (the last anchor is the end of the layer, not a keyframe). */
export function madeTween(anchors: Anchor[], k: number, tweens?: Tween[]): Tween | undefined {
  if (!tweens?.length) return undefined;
  let next = k + 1;
  while (next < anchors.length - 1 && anchors[next][1] <= anchors[k][1]) next += 1;
  return next < anchors.length - 1 ? tweens.find((tween) => tween[0] === anchors[k][0]) : undefined;
}

/** A keyframe added inside a blank span is blank too (as in Animate). */
export function grownBlanks(before: Anchor[], after: Anchor[], blanks?: number[]): number[] | undefined {
  if (!blanks?.length) return blanks;
  const out = [...blanks];
  after.forEach((anchor) => {
    if (before.some((old) => old[0] === anchor[0])) return;
    for (let k = 0; k + 1 < before.length; k += 1) {
      if (anchor[0] > before[k][0] && anchor[0] < before[k + 1][0]) { if (blanks.includes(before[k][0])) out.push(anchor[0]); break; }
    }
  });
  return out;
}

/** A keyframe added inside a span with a made tween splits it: both halves keep the tween (and its ease). */
export function grownTweens(before: Anchor[], after: Anchor[], tweens?: Tween[]): Tween[] | undefined {
  if (!tweens?.length) return tweens;
  const out = [...tweens];
  after.forEach((anchor) => {
    if (before.some((old) => old[0] === anchor[0])) return;
    for (let k = 0; k + 1 < before.length; k += 1) {
      if (anchor[0] > before[k][0] && anchor[0] < before[k + 1][0]) {
        const made = tweens.find((tween) => tween[0] === before[k][0]);
        if (made) out.push([anchor[0], made[1]]);
        break;
      }
    }
  });
  return out;
}

/** Moves keyframe k to a frame, between its neighbours; null when it cannot move (the first keyframe and the end stay). */
export function moveAnchor(anchors: Anchor[], k: number, to: number): Anchor[] | null {
  if (k <= 0 || k >= anchors.length - 1) return null;
  const at = Math.max(anchors[k - 1][1] + 1, Math.min(anchors[k + 1][1] - 1, Math.round(to)));
  if (at === anchors[k][1]) return anchors;
  return anchors.map((anchor, index) => (index === k ? ([anchor[0], at] as Anchor) : anchor));
}

/** A keyframe at a frame inside a span, holding the position the span has there. */
export function addAnchor(anchors: Anchor[], frame: number): Anchor[] | null {
  for (let k = 0; k + 1 < anchors.length; k += 1) {
    if (frame > anchors[k][1] && frame < anchors[k + 1][1]) return [...anchors.slice(0, k + 1), [fileOf(anchors, frame), frame] as Anchor, ...anchors.slice(k + 1)];
  }
  return null;
}

export function removeAnchor(anchors: Anchor[], k: number): Anchor[] {
  return anchors.filter((_, index) => index !== k);
}

/** Nothing moved or added: the edit can be dropped. */
export const isUnchanged = (layer: FlaLayer, anchors: Anchor[]) => {
  const file = fileAnchors(layer);
  return anchors.length === file.length && anchors.every((anchor, index) => anchor[0] === file[index][0] && anchor[1] === file[index][1]);
};

/**
 * Frame operations of Animate on a layer's anchors. The layer keeps its length (the pose's timeline cannot grow), so what
 * follows a change slides and the last span takes the difference. A keyframe whose frames are gone is kept as an anchor with
 * no frames, so the player drops its content; null when there is no room.
 */

/** Insert Frame (F5): n frames at `at`; the keyframes after it slide right, the last span gets shorter. */
export function insertFrames(anchors: Anchor[], at: number, n = 1): Anchor[] | null {
  const last = anchors.length - 1;
  const next = anchors.map((anchor, index) => (index < last && anchor[1] > at ? ([anchor[0], anchor[1] + n] as Anchor) : anchor));
  for (let i = 0; i < last; i += 1) if (next[i][1] >= next[last][1]) return null;
  return next;
}

/** Remove Frames (⇧F5): frames from..to leave; the keyframes in them go, the ones after slide left and the last span grows. */
export function removeFrames(anchors: Anchor[], from: number, to: number): Anchor[] | null {
  const last = anchors.length - 1, end = anchors[last][1];
  if (from <= anchors[0][1]) return null; // the first frame of a layer stays
  const top = Math.min(to, end - 1);
  if (top < from) return null;
  const n = top - from + 1;
  const slid = anchors.map((anchor, index) => (index === last ? anchor[1] : anchor[1] > top ? anchor[1] - n : anchor[1]));
  return anchors.map((anchor, index) => {
    if (index === 0 || index === last || anchor[1] < from || anchor[1] > top) return [anchor[0], slid[index]] as Anchor;
    // a keyframe inside the removed frames: it ends up with no frames, at the place of the next one that stays
    let j = index + 1;
    while (j < last && anchors[j][1] >= from && anchors[j][1] <= top) j += 1;
    return [anchor[0], slid[j]] as Anchor;
  });
}

/** Clear Keyframe (⇧F6): keyframe k stops being one; the span before it takes over its frames. Null for the first keyframe or the end. */
export function clearKeyframe(anchors: Anchor[], k: number): Anchor[] | null {
  if (k <= 0 || k >= anchors.length - 1) return null;
  return anchors.map((anchor, index) => (index === k ? ([anchor[0], anchors[k + 1][1]] as Anchor) : anchor));
}

/** The keyframe (anchor index) that starts at a frame, or -1. */
export const keyframeAt = (anchors: Anchor[], frame: number) => anchors.findIndex((anchor, index) => index < anchors.length - 1 && anchor[1] === frame && anchors[index + 1][1] > frame);

/** The keyframe (anchor index) whose span holds a frame, or -1. */
export const spanAt = (anchors: Anchor[], frame: number) => anchors.findIndex((anchor, index) => index < anchors.length - 1 && frame >= anchor[1] && frame < anchors[index + 1][1]);
