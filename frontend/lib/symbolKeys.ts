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
export type ShownFrame = FlaFrame & { source: FlaFrame; added: boolean; anchor: number };
export function shownFrames(layer: FlaLayer, anchors: Anchor[]): ShownFrame[] {
  const out: ShownFrame[] = [];
  for (let k = 0; k + 1 < anchors.length; k += 1) {
    const source = [...layer.frames].reverse().find((frame) => frame.i <= anchors[k][0]) || layer.frames[0];
    const added = anchors[k][0] !== source.i;
    const base: FlaFrame = added ? { i: 0, d: 0, tween: source.tween, ease: source.ease, symbols: source.symbols } : { ...source };
    out.push({ ...base, i: anchors[k][1], d: anchors[k + 1][1] - anchors[k][1], source, added, anchor: k });
  }
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
