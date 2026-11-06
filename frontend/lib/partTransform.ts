/**
 * Rotate and scale a part inside a character (step inside). All points here are in the player's
 * stage units (its W × H space). A part sits in its parent as: parent = (x, y) + A · (local − reg),
 * with A = [[a, c], [b, d]] from scale and skew (Animate keeps rotation as equal skews). The parent
 * itself sits on the stage through a basis (ax, ay | bx, by) and an origin (p0x, p0y).
 */
export type PartInfo = {
  prop: string;
  ax: number; ay: number; bx: number; by: number; p0x: number; p0y: number;
  x: number; y: number; sx: number; sy: number; skx: number; sky: number; rot: number; regX: number; regY: number;
  bounds: { x: number; y: number; width: number; height: number };
  W: number; H: number;
};
export type Pt = [number, number];
export type ScaleHandle = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

const RAD = Math.PI / 180;
export const linear = (info: Pick<PartInfo, "sx" | "sy" | "skx" | "sky">) => ({
  a: info.sx * Math.cos(info.sky * RAD), b: info.sx * Math.sin(info.sky * RAD),
  c: -info.sy * Math.sin(info.skx * RAD), d: info.sy * Math.cos(info.skx * RAD),
});

export const localToParent = (info: PartInfo, p: Pt): Pt => {
  const m = linear(info);
  return [info.x + m.a * (p[0] - info.regX) + m.c * (p[1] - info.regY), info.y + m.b * (p[0] - info.regX) + m.d * (p[1] - info.regY)];
};
export const parentToStage = (info: PartInfo, q: Pt): Pt => [info.p0x + info.ax * q[0] + info.bx * q[1], info.p0y + info.ay * q[0] + info.by * q[1]];
export const stageToParent = (info: PartInfo, s: Pt): Pt => {
  const det = info.ax * info.by - info.bx * info.ay, dx = s[0] - info.p0x, dy = s[1] - info.p0y;
  return [(dx * info.by - info.bx * dy) / det, (info.ax * dy - dx * info.ay) / det];
};
export const localToStage = (info: PartInfo, p: Pt): Pt => parentToStage(info, localToParent(info, p));
export const stageToLocal = (info: PartInfo, s: Pt): Pt => {
  const m = linear(info), q = stageToParent(info, s), det = m.a * m.d - m.b * m.c, dx = q[0] - info.x, dy = q[1] - info.y;
  return [info.regX + (dx * m.d - m.c * dy) / det, info.regY + (m.a * dy - dx * m.b) / det];
};

/** The part's box (local top left, top right, bottom right, bottom left) and pivot, as fractions of the player. */
export function partBox(info: PartInfo) {
  const { x, y, width, height } = info.bounds;
  const corners = ([[x, y], [x + width, y], [x + width, y + height], [x, y + height]] as Pt[]).map((p) => localToStage(info, p));
  const pivot = parentToStage(info, [info.x, info.y]);
  return { corners: corners.map((p): Pt => [p[0] / info.W, p[1] / info.H]), pivot: [pivot[0] / info.W, pivot[1] / info.H] as Pt };
}

/** A part with a turn already in its `rotation` (not Animate's usual skews) is left alone. */
export const canTransform = (info: PartInfo) => Math.abs(info.rot) < 1e-6 && info.bounds.width > 0 && info.bounds.height > 0 && isSound(info);

/** A reading taken while the player is mid-redraw (right after an undo) can hold NaN: it is not used. */
export const isSound = (info: PartInfo) => [info.ax, info.ay, info.bx, info.by, info.p0x, info.p0y, info.x, info.y, info.sx, info.sy, info.skx, info.sky, info.regX, info.regY, info.W, info.H,
  info.bounds.x, info.bounds.y, info.bounds.width, info.bounds.height].every(Number.isFinite);

type Mat = [number, number, number, number]; // [a, b, c, d]: x → (a, b), y → (c, d)
const matrixOf = (info: PartInfo): Mat => { const m = linear(info); return [m.a, m.b, m.c, m.d]; };
const mul = (p: Mat, q: Mat): Mat => [p[0] * q[0] + p[2] * q[1], p[1] * q[0] + p[3] * q[1], p[0] * q[2] + p[2] * q[3], p[1] * q[2] + p[3] * q[3]];
const inverse = (m: Mat): Mat => { const det = m[0] * m[3] - m[1] * m[2]; return [m[3] / det, -m[1] / det, -m[2] / det, m[0] / det]; };
/** How the parent lays out the stage: its x axis goes to (ax, ay), its y axis to (bx, by). */
const basisOf = (info: PartInfo): Mat => [info.ax, info.ay, info.bx, info.by];

/** A matrix back as Animate's scale and skews (keeping a flip's sign): a = sx·cos(skewY), b = sx·sin(skewY), c = −sy·sin(skewX), d = sy·cos(skewX). */
function toScaleSkew(m: Mat, like: Pick<PartInfo, "sx" | "sy">) {
  const flipX = like.sx < 0 ? -1 : 1, flipY = like.sy < 0 ? -1 : 1;
  return {
    scaleX: flipX * Math.hypot(m[0], m[1]), scaleY: flipY * Math.hypot(m[2], m[3]),
    skewY: Math.atan2(m[1] * flipX, m[0] * flipX) / RAD, skewX: Math.atan2(-m[2] * flipY, m[3] * flipY) / RAD,
  };
}
/** The part's position after its matrix changes while the point q (local) stays where it is. */
const keepPoint = (info: PartInfo, next: Mat, q: Pt) => {
  const m = matrixOf(info), rx = q[0] - info.regX, ry = q[1] - info.regY;
  return { x: info.x + (m[0] - next[0]) * rx + (m[2] - next[2]) * ry, y: info.y + (m[1] - next[1]) * rx + (m[3] - next[3]) * ry };
};

/** Turning the part around its pivot by the pointer, exactly as it looks on the stage (even inside a scaled or skewed parent). */
export function rotatePart(info: PartInfo, start: Pt, now: Pt, snap: boolean) {
  const pivot = parentToStage(info, [info.x, info.y]);
  let turn = (Math.atan2(now[1] - pivot[1], now[0] - pivot[0]) - Math.atan2(start[1] - pivot[1], start[0] - pivot[0])) / RAD;
  turn = ((turn + 540) % 360) - 180;
  if (snap) turn = Math.round(turn / 15) * 15;
  const r = turn * RAD, spin: Mat = [Math.cos(r), Math.sin(r), -Math.sin(r), Math.cos(r)], parent = basisOf(info);
  return toScaleSkew(mul(inverse(parent), mul(spin, mul(parent, matrixOf(info)))), info);
}

/** Scaling along the part's own axes with the opposite side fixed; a corner with Shift keeps the proportions. */
export function scalePart(info: PartInfo, handle: ScaleHandle, start: Pt, now: Pt, keepShape: boolean) {
  const { x, y, width, height } = info.bounds;
  const moveX = handle.includes("e") || handle.includes("w"), moveY = handle.includes("n") || handle.includes("s");
  const anchor: Pt = [handle.includes("e") ? x : handle.includes("w") ? x + width : x + width / 2, handle.includes("s") ? y : handle.includes("n") ? y + height : y + height / 2];
  const u0 = stageToLocal(info, start), u1 = stageToLocal(info, now);
  const ratio = (from: number, to: number, at: number) => (Math.abs(from - at) < 1e-6 ? 1 : (to - at) / (from - at));
  const clamp = (f: number) => (Math.abs(f) < 0.01 ? (f < 0 ? -0.01 : 0.01) : f);
  let fx = moveX ? clamp(ratio(u0[0], u1[0], anchor[0])) : 1, fy = moveY ? clamp(ratio(u0[1], u1[1], anchor[1])) : 1;
  if (keepShape && moveX && moveY) { const f = Math.abs(fx) >= Math.abs(fy) ? fx : fy; fx = f; fy = f; }
  const m = matrixOf(info), next: Mat = [m[0] * fx, m[1] * fx, m[2] * fy, m[3] * fy];
  return { scaleX: info.sx * fx, scaleY: info.sy * fy, ...keepPoint(info, next, anchor) };
}

export type SkewEdge = "skew-n" | "skew-s" | "skew-e" | "skew-w";
/** Skewing along an edge of the part's box: the opposite edge stays where it is. */
export function skewPart(info: PartInfo, edge: SkewEdge, start: Pt, now: Pt) {
  const { x, y, width, height } = info.bounds;
  const u0 = stageToLocal(info, start), u1 = stageToLocal(info, now), m = matrixOf(info);
  const horizontal = edge === "skew-n" || edge === "skew-s";
  const edgeAt = horizontal ? (edge === "skew-n" ? y : y + height) : (edge === "skew-w" ? x : x + width);
  const anchorAt = horizontal ? (edge === "skew-n" ? y + height : y) : (edge === "skew-w" ? x + width : x);
  const lever = edgeAt - anchorAt, k = Math.abs(lever) < 1e-6 ? 0 : ((horizontal ? u1[0] - u0[0] : u1[1] - u0[1]) / lever);
  const next: Mat = horizontal ? [m[0], m[1], m[0] * k + m[2], m[1] * k + m[3]] : [m[0] + m[2] * k, m[1] + m[3] * k, m[2], m[3]];
  const q: Pt = horizontal ? [x + width / 2, anchorAt] : [anchorAt, y + height / 2];
  return { ...toScaleSkew(next, info), ...keepPoint(info, next, q) };
}

/** Flipping the part as seen on the stage (left–right or top–bottom) about the middle of its box: the middle stays where it is. */
export function flipPart(info: PartInfo, axis: "h" | "v") {
  const parent = basisOf(info), flip: Mat = axis === "h" ? [-1, 0, 0, 1] : [1, 0, 0, -1];
  const next = mul(inverse(parent), mul(flip, mul(parent, matrixOf(info))));
  const det = next[0] * next[3] - next[1] * next[2];
  const flipY = info.sy < 0 ? -1 : 1, flipX = (det < 0 ? -1 : 1) * flipY;
  const centre: Pt = [info.bounds.x + info.bounds.width / 2, info.bounds.y + info.bounds.height / 2];
  return { ...toScaleSkew(next, { sx: flipX, sy: flipY }), ...keepPoint(info, next, centre) };
}
