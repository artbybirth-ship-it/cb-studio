/**
 * A selected part's numbers in the native pose editor's Properties (Animate's Transform panel): where its transformation point stands,
 * its width and height as a % of its own size, its rotation and skew, and (for a symbol) its opacity. Pure: a matrix in, numbers out,
 * and a changed number back to a matrix that keeps the transformation point where it is (as Animate does when you scale or turn).
 *
 * Animate's matrix model: a = sx·cos(skewY), b = sx·sin(skewY), c = −sy·sin(skewX), d = sy·cos(skewX). Rotation is skewY; the skew shown
 * is skewX − skewY (0 for a part that is only turned and scaled).
 */
import type { FlaElement, Matrix } from "../fla/xfl";
import { shapePoints } from "./points";

export type PartProps = { x: number; y: number; w: number; h: number; rotation: number; skew: number };
const DEG = 180 / Math.PI;
/** Turns an angle into −180…180. */
const wrap = (deg: number) => { let v = deg % 360; if (v > 180) v -= 360; if (v <= -180) v += 360; return v; };

/** The transformation point in the element's own space: a symbol's pivot, the middle of a drawn shape, a picture's corner. */
export function pivotOf(el: FlaElement): [number, number] {
  if (el.k === "instance") return el.pivot;
  if (el.k === "shape") {
    const { anchors } = shapePoints(el);
    if (!anchors.length) return [0, 0];
    const xs = anchors.map((p) => p[0]), ys = anchors.map((p) => p[1]);
    return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
  }
  return [0, 0];
}

export function propsOf(m: Matrix, pivot: [number, number]): PartProps {
  const [a, b, c, d, tx, ty] = m;
  const sx = Math.hypot(a, b), sy = Math.hypot(c, d);
  const skewY = Math.atan2(b, a) * DEG, skewX = Math.atan2(-c, d) * DEG;
  return { x: a * pivot[0] + c * pivot[1] + tx, y: b * pivot[0] + d * pivot[1] + ty, w: sx * 100, h: sy * 100, rotation: wrap(skewY), skew: wrap(skewX - skewY) };
}

/** The matrix with `change` applied; everything not changed stays, and the transformation point stays put unless X or Y is what changed. */
export function withProps(m: Matrix, pivot: [number, number], change: Partial<PartProps>): Matrix {
  const now = propsOf(m, pivot);
  // Numbers given as they already are change nothing (the matrix is not rebuilt, so it stays exactly as it was). The boxes show one decimal,
  // so a number within that rounding (Esc after a drag sends back the rounded start) is the same number.
  const real = Object.fromEntries(Object.entries(change).filter(([k, v]) => v != null && Math.abs(v - now[k as keyof PartProps]) > 0.05 + 1e-9)) as Partial<PartProps>;
  if (!Object.keys(real).length) return m;
  change = real;
  const next = { ...now, ...change };
  // A width or height of 0 cannot be turned back: keep a sliver (a negative one flips).
  const sx = Math.max(0.0001, Math.abs(next.w) / 100) * Math.sign(next.w || 1), sy = Math.max(0.0001, Math.abs(next.h) / 100) * Math.sign(next.h || 1);
  // Size, rotation and skew rebuild any matrix exactly (a flipped part reads as a skew of 180°); X or Y alone keeps the matrix as it is.
  let [a, b, c, d] = m;
  if (change.w != null || change.h != null || change.rotation != null || change.skew != null) {
    const skewY = next.rotation / DEG, skewX = (next.rotation + next.skew) / DEG;
    a = sx * Math.cos(skewY); b = sx * Math.sin(skewY); c = -sy * Math.sin(skewX); d = sy * Math.cos(skewX);
  }
  return [a, b, c, d, next.x - (a * pivot[0] + c * pivot[1]), next.y - (b * pivot[0] + d * pivot[1])];
}
