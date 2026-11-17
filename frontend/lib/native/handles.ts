/**
 * The Free Transform handles of the native pose editor's stage (Animate's Q tool): what a drag on a handle does to the selected part(s), as a
 * matrix in the open level's space. Pure: a frame (the part's own space, or the level for several parts), the artwork's box in that frame,
 * where the drag started and where the pointer is now; the answer G is laid over each part (m' = G · m).
 *
 *  - "nw" "n" "ne" "e" "se" "s" "sw" "w": scale from the opposite side or corner (Alt: from the transformation point; Shift on a corner: keep the shape);
 *  - "rotate": turn about the transformation point (Shift: 15° steps);
 *  - "skew-n" "skew-s" "skew-e" "skew-w": slant along that edge, the opposite edge staying put.
 */
import type { Matrix } from "../fla/xfl";

export type Pt = [number, number];
export type Box = { x0: number; y0: number; x1: number; y1: number };
export type Handle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "rotate" | "skew-n" | "skew-s" | "skew-e" | "skew-w";

export const mul = (a: Matrix, b: Matrix): Matrix => [
  a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1],
  a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3],
  a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5],
];
export const invert = (m: Matrix): Matrix => {
  const det = m[0] * m[3] - m[1] * m[2] || 1e-9;
  return [m[3] / det, -m[1] / det, -m[2] / det, m[0] / det, (m[2] * m[5] - m[3] * m[4]) / det, (m[1] * m[4] - m[0] * m[5]) / det];
};
export const apply = (m: Matrix, p: Pt): Pt => [m[0] * p[0] + m[2] * p[1] + m[4], m[1] * p[0] + m[3] * p[1] + m[5]];

/** Where each handle sits on the box (0…1 across, 0…1 down). */
export const HANDLE_AT: Record<string, Pt> = { nw: [0, 0], n: [0.5, 0], ne: [1, 0], e: [1, 0.5], se: [1, 1], s: [0.5, 1], sw: [0, 1], w: [0, 0.5] };
const at = (box: Box, f: Pt): Pt => [box.x0 + f[0] * (box.x1 - box.x0), box.y0 + f[1] * (box.y1 - box.y0)];
/** The box's corners in the level (nw, ne, se, sw), through the frame. */
export const cornersOf = (frame: Matrix, box: Box): Pt[] => [[0, 0], [1, 0], [1, 1], [0, 1]].map((f) => apply(frame, at(box, f as Pt)));

/** The change, in the level's space, that a drag on `handle` from `start` to `now` (level points) makes. `pivot` is the transformation point (level). */
export function handleTransform(handle: Handle, frame: Matrix, box: Box, start: Pt, now: Pt, pivot: Pt, keys: { shift?: boolean; alt?: boolean } = {}): Matrix {
  const back = invert(frame);
  if (handle === "rotate") {
    let turn = Math.atan2(now[1] - pivot[1], now[0] - pivot[0]) - Math.atan2(start[1] - pivot[1], start[0] - pivot[0]);
    if (keys.shift) turn = Math.round(turn / (Math.PI / 12)) * (Math.PI / 12);
    const c = Math.cos(turn), s = Math.sin(turn);
    return [c, s, -s, c, pivot[0] - (c * pivot[0] - s * pivot[1]), pivot[1] - (s * pivot[0] + c * pivot[1])];
  }
  // In the frame's own space from here on (the part's axes).
  const p0 = apply(back, start), p1 = apply(back, now);
  let X: Matrix;
  if (handle.startsWith("skew-")) {
    const side = handle.slice(5);
    if (side === "n" || side === "s") {
      // The opposite edge stays: x shifts in proportion to the distance from it.
      const edge = side === "n" ? box.y0 : box.y1, anchor = side === "n" ? box.y1 : box.y0;
      const k = (p1[0] - p0[0]) / ((edge - anchor) || 1e-9);
      X = [1, 0, k, 1, -k * anchor, 0];
    } else {
      const edge = side === "w" ? box.x0 : box.x1, anchor = side === "w" ? box.x1 : box.x0;
      const k = (p1[1] - p0[1]) / ((edge - anchor) || 1e-9);
      X = [1, k, 0, 1, 0, -k * anchor];
    }
  } else {
    const f = HANDLE_AT[handle];
    const grip = at(box, f);
    const anchor: Pt = keys.alt ? apply(back, pivot) : at(box, [1 - f[0], 1 - f[1]]);
    const moved: Pt = [grip[0] + (p1[0] - p0[0]), grip[1] + (p1[1] - p0[1])];
    let sx = f[0] === 0.5 ? 1 : (moved[0] - anchor[0]) / ((grip[0] - anchor[0]) || 1e-9);
    let sy = f[1] === 0.5 ? 1 : (moved[1] - anchor[1]) / ((grip[1] - anchor[1]) || 1e-9);
    // Shift on a corner: the same factor both ways (the larger change wins), keeping each side's flip.
    if (keys.shift && f[0] !== 0.5 && f[1] !== 0.5) { const m = Math.max(Math.abs(sx), Math.abs(sy)); sx = m * Math.sign(sx || 1); sy = m * Math.sign(sy || 1); }
    // Never quite flat: a part scaled to nothing could not be grabbed again.
    const floor = (v: number) => (Math.abs(v) < 0.01 ? 0.01 * Math.sign(v || 1) : v);
    sx = floor(sx); sy = floor(sy);
    X = [sx, 0, 0, sy, anchor[0] * (1 - sx), anchor[1] * (1 - sy)];
  }
  return mul(mul(frame, X), back);
}

/** One box around several parts' boxes (each given by its corners in the level): the frame for moving them as one. */
export function boxAround(corners: Pt[][]): Box {
  const all = corners.flat();
  return { x0: Math.min(...all.map((p) => p[0])), y0: Math.min(...all.map((p) => p[1])), x1: Math.max(...all.map((p) => p[0])), y1: Math.max(...all.map((p) => p[1])) };
}
