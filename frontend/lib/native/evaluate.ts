/**
 * Native timeline evaluation: which keyframe a layer shows at a frame, how a graphic symbol maps the
 * parent's frame to its own, eases, and the classic-tween matrix. Pure functions over the plain
 * data in lib/fla/xfl.ts, so the renderer, the editor and the tests share one definition of "what
 * is on screen at frame N" (the old route patched that answer inside Animate's player).
 */
import type { Ease, FlaElement, InstanceElement, Keyframe, Layer, Matrix, ShapeElement } from "../fla/xfl";

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

// ---------- eases (createjs Ease.* by name, Animate's simple intensity, custom Bézier curves)
const POWERS: Record<string, number> = { quad: 2, cubic: 3, quart: 4, quint: 5 };
const bounceOut = (t: number) => (t < 1 / 2.75 ? 7.5625 * t * t : t < 2 / 2.75 ? 7.5625 * (t -= 1.5 / 2.75) * t + 0.75 : t < 2.5 / 2.75 ? 7.5625 * (t -= 2.25 / 2.75) * t + 0.9375 : 7.5625 * (t -= 2.625 / 2.75) * t + 0.984375);
const NAMED: Record<string, (t: number) => number> = {
  sineIn: (t) => 1 - Math.cos((t * Math.PI) / 2), sineOut: (t) => Math.sin((t * Math.PI) / 2), sineInOut: (t) => -0.5 * (Math.cos(Math.PI * t) - 1),
  circIn: (t) => -(Math.sqrt(1 - t * t) - 1), circOut: (t) => Math.sqrt(1 - (t - 1) * (t - 1)),
  circInOut: (t) => ((t *= 2) < 1 ? -0.5 * (Math.sqrt(1 - t * t) - 1) : 0.5 * (Math.sqrt(1 - (t -= 2) * t) + 1)),
  backIn: (t) => t * t * (2.70158 * t - 1.70158), backOut: (t) => --t * t * (2.70158 * t + 1.70158) + 1,
  backInOut: (t) => ((t *= 2) < 1 ? 0.5 * (t * t * (3.5949095 * t - 2.5949095)) : 0.5 * ((t -= 2) * t * (3.5949095 * t + 2.5949095) + 2)),
  bounceOut, bounceIn: (t) => 1 - bounceOut(1 - t), bounceInOut: (t) => (t < 0.5 ? (1 - bounceOut(1 - t * 2)) * 0.5 : bounceOut(t * 2 - 1) * 0.5 + 0.5),
  elasticIn: (t) => (t === 0 || t === 1 ? t : -(2 ** (10 * (t - 1))) * Math.sin(((t - 1 - 0.075) * 2 * Math.PI) / 0.3)),
  elasticOut: (t) => (t === 0 || t === 1 ? t : 2 ** (-10 * t) * Math.sin(((t - 0.075) * 2 * Math.PI) / 0.3) + 1),
  elasticInOut: (t) => (t === 0 || t === 1 ? t : (t *= 2) < 1 ? -0.5 * 2 ** (10 * (t - 1)) * Math.sin(((t - 1.1125) * 2 * Math.PI) / 0.45) : 2 ** (-10 * (t - 1)) * 0.5 * Math.sin(((t - 1.1125) * 2 * Math.PI) / 0.45) + 1),
};

/** Ease name in Animate's spelling ("EaseIn"/"Quad Out"…) → createjs name, or null. */
function namedEase(method: string): ((t: number) => number) | null {
  const key = method.replace(/^ease/i, "").replace(/[\s_-]+/g, "").toLowerCase();
  for (const [name, power] of Object.entries(POWERS)) {
    if (!key.startsWith(name)) continue;
    const dir = key.slice(name.length);
    if (dir === "in") return (t) => t ** power;
    if (dir === "out") return (t) => 1 - (1 - t) ** power;
    if (dir === "inout") return (t) => (t < 0.5 ? 0.5 * (2 * t) ** power : 1 - 0.5 * Math.abs((2 - 2 * t) ** power));
  }
  const found = Object.keys(NAMED).find((name) => name.toLowerCase() === key);
  return found ? NAMED[found] : null;
}

export function easeFunction(ease: Ease | undefined): (t: number) => number {
  if (!ease) return (t) => t;
  if (ease.custom && ease.custom.length >= 4) {
    const p = ease.custom;
    return (x) => {
      for (let i = 0; i + 3 < p.length; i += 3) {
        if (x > p[i + 3][0] && i + 6 < p.length) continue;
        const [p0, p1, p2, p3] = [p[i], p[i + 1], p[i + 2], p[i + 3]];
        const bx = (u: number) => (1 - u) ** 3 * p0[0] + 3 * (1 - u) ** 2 * u * p1[0] + 3 * (1 - u) * u * u * p2[0] + u ** 3 * p3[0];
        let lo = 0, hi = 1;
        for (let k = 0; k < 30; k += 1) { const mid = (lo + hi) / 2; if (bx(mid) < x) lo = mid; else hi = mid; }
        const u = (lo + hi) / 2;
        return (1 - u) ** 3 * p0[1] + 3 * (1 - u) ** 2 * u * p1[1] + 3 * (1 - u) * u * u * p2[1] + u ** 3 * p3[1];
      }
      return x;
    };
  }
  if (ease.method && ease.method !== "none") {
    const named = namedEase(ease.method);
    if (named) return named;
  }
  // Animate publishes intensity -100 as createjs Ease.get(1) (ease out): the sign is flipped.
  const a = Math.max(-1, Math.min(1, -(ease.intensity || 0) / 100));
  if (!a) return (t) => t;
  return a < 0 ? (t) => t * (t * -a + 1 + a) : (t) => t * ((2 - t) * a + (1 - a));
}

// ---------- which keyframe a layer shows
export type LayerState = { key: Keyframe; next?: Keyframe; offset: number; index: number };

/** The keyframe covering `frame` (and the one after it, when this one tweens into it). */
export function layerStateAt(layer: Layer, frame: number): LayerState | null {
  const frames = layer.frames;
  const index = frames.findIndex((f) => frame >= f.i && frame < f.i + f.d);
  if (index < 0) return null;
  const key = frames[index], next = frames[index + 1];
  return { key, next: next && next.i === key.i + key.d ? next : undefined, offset: frame - key.i, index };
}

/** 0…1 progress of the tween at this state, or null when the layer holds still. */
export function tweenProgress(state: LayerState): number | null {
  const { key, next, offset } = state;
  if (!key.tween || !next || offset <= 0) return null;
  return easeFunction(key.ease)(offset / key.d);
}

/** The frame a symbol instance shows, given how long its parent has been on this keyframe. */
export function innerFrame(el: InstanceElement, offset: number, length: number): number {
  if (length <= 1) return 0;
  if (el.symbolType === "graphic") {
    const f = el.first;
    switch (el.loop) {
      case "single frame": return Math.min(f, length - 1);
      case "play once": return Math.min(f + offset, length - 1);
      case "play once reverse": return Math.max(f - offset, 0);
      case "loop reverse": return (((f - offset) % length) + length) % length;
      default: return (f + offset) % length;
    }
  }
  return offset % length; // movie clips run their own timeline
}

// ---------- classic tween
function decompose(m: Matrix) {
  const [a, b, c, d] = m;
  return { sx: Math.hypot(a, b), sy: Math.hypot(c, d), ky: Math.atan2(b, a), kx: Math.atan2(-c, d) };
}
function angle(a0: number, a1: number, t: number, rot?: [string, number]) {
  let delta = a1 - a0;
  while (delta > Math.PI) delta -= 2 * Math.PI;
  while (delta < -Math.PI) delta += 2 * Math.PI;
  if (rot?.[0] === "clockwise") { if (delta < 0) delta += 2 * Math.PI; delta += 2 * Math.PI * rot[1]; }
  if (rot?.[0] === "counter-clockwise") { if (delta > 0) delta -= 2 * Math.PI; delta -= 2 * Math.PI * rot[1]; }
  if (rot?.[0] === "none") delta = 0;
  return a0 + delta * t;
}
/** Interpolates two instance matrices about the transformation point, as a classic tween does. */
export function tweenMatrix(m0: Matrix, m1: Matrix, pivot: [number, number], t: number, rot?: [string, number]): Matrix {
  const A = decompose(m0), B = decompose(m1);
  const P0 = [m0[0] * pivot[0] + m0[2] * pivot[1] + m0[4], m0[1] * pivot[0] + m0[3] * pivot[1] + m0[5]];
  const P1 = [m1[0] * pivot[0] + m1[2] * pivot[1] + m1[4], m1[1] * pivot[0] + m1[3] * pivot[1] + m1[5]];
  const sx = lerp(A.sx, B.sx, t), sy = lerp(A.sy, B.sy, t);
  const ky = angle(A.ky, B.ky, t, rot), kx = angle(A.kx, B.kx, t, rot);
  const a = sx * Math.cos(ky), b = sx * Math.sin(ky), c = -sy * Math.sin(kx), d = sy * Math.cos(kx);
  const px = lerp(P0[0], P1[0], t), py = lerp(P0[1], P1[1], t);
  return [a, b, c, d, px - (a * pivot[0] + c * pivot[1]), py - (b * pivot[0] + d * pivot[1])];
}

const unique = <T,>(list: T[]) => { const seen = new Map<string, T>(); list.forEach((s) => { const k = JSON.stringify(s); if (!seen.has(k)) seen.set(k, s); }); return [...seen.values()]; };
const byIndex = <T,>(record: Record<number, T>) => Object.keys(record).map(Number).sort((a, b) => a - b).map((k) => record[k]);
/** Fill / stroke styles of a keyframe's drawing objects together: shape-tween indices are into this list. */
export function frameStyles(elements: FlaElement[]) {
  const shapes = elements.filter((e): e is ShapeElement => e.k === "shape");
  const scale = (m: Matrix) => Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) || 1;
  return {
    fills: unique(shapes.flatMap((s) => byIndex(s.fillStyles))),
    strokes: unique(shapes.flatMap((s) => byIndex(s.strokeStyles).map((style) => ({ ...style, w: style.w * scale(s.m) })))),
  };
}

