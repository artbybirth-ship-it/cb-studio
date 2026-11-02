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
export const canTransform = (info: PartInfo) => Math.abs(info.rot) < 1e-6 && info.bounds.width > 0 && info.bounds.height > 0;

/** Turning the part around its pivot by the pointer: the skews both gain the angle, so a skewed part turns whole. */
export function rotatePart(info: PartInfo, start: Pt, now: Pt, snap: boolean) {
  const pivot = parentToStage(info, [info.x, info.y]);
  let turn = Math.atan2(now[1] - pivot[1], now[0] - pivot[0]) - Math.atan2(start[1] - pivot[1], start[0] - pivot[0]);
  if (info.ax * info.by - info.bx * info.ay < 0) turn = -turn;
  let degrees = turn / RAD;
  degrees = ((degrees + 540) % 360) - 180;
  if (snap) degrees = Math.round(degrees / 15) * 15;
  return { skewX: info.skx + degrees, skewY: info.sky + degrees };
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
  const m = linear(info), a2 = m.a * fx, b2 = m.b * fx, c2 = m.c * fy, d2 = m.d * fy;
  const rx = anchor[0] - info.regX, ry = anchor[1] - info.regY;
  return { scaleX: info.sx * fx, scaleY: info.sy * fy, x: info.x + (m.a - a2) * rx + (m.c - c2) * ry, y: info.y + (m.b - b2) * rx + (m.d - d2) * ry };
}
