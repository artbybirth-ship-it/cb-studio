/**
 * Shape tweens, made editable. Animate stores a shape tween as matched curves (<MorphShape>), which
 * the importer reads; when the user changes either end keyframe those curves are stale, so they are
 * worked out again here from the two keyframes' artwork:
 *
 *  1. every closed fill outline (and open stroke line) of both keys, in timeline space;
 *  2. outlines are paired within the same fill / stroke style, nearest and most alike first;
 *  3. a pair gets the same number of curves (the longer side's, splitting the longest curves of
 *     the shorter) and the start point of the second that lines up best, in the same direction;
 *  4. an outline with no partner shrinks to, or grows from, its own centre.
 *
 * This is not Animate's own matching (that has shape hints and more rules), so a tween re-matched
 * here can differ a little from what Animate would draw; unedited tweens keep Animate's curves.
 */
import type { Cmd, Fill, FlaElement, Keyframe, Matrix, MorphSegment, Path, ShapeElement, Stroke } from "../fla/xfl";
import { frameStyles, lerp } from "./evaluate";

type Seg = { x0: number; y0: number; cx: number; cy: number; x1: number; y1: number; line: boolean };
type Contour = { segs: Seg[]; style: number; kind: "fill" | "stroke"; area: number; cx: number; cy: number; closed: boolean };

const apply = (m: Matrix, x: number, y: number): [number, number] => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
const scaleOf = (m: Matrix) => Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) || 1;

function segsOf(path: Path, m: Matrix): Seg[] {
  const out: Seg[] = [];
  let x = 0, y = 0;
  for (const c of path) {
    if (c[0] === "M") { [x, y] = apply(m, c[1], c[2]); continue; }
    const [ex, ey] = apply(m, c[0] === "L" ? c[1] : c[3], c[0] === "L" ? c[2] : c[4]);
    if (c[0] === "L") out.push({ x0: x, y0: y, cx: (x + ex) / 2, cy: (y + ey) / 2, x1: ex, y1: ey, line: true });
    else { const [cx, cy] = apply(m, c[1], c[2]); out.push({ x0: x, y0: y, cx, cy, x1: ex, y1: ey, line: false }); }
    x = ex; y = ey;
  }
  return out;
}
const reverse = (segs: Seg[]): Seg[] => segs.slice().reverse().map((s) => ({ x0: s.x1, y0: s.y1, cx: s.cx, cy: s.cy, x1: s.x0, y1: s.y0, line: s.line }));
const length = (s: Seg) => Math.hypot(s.x1 - s.x0, s.y1 - s.y0);

function split(s: Seg): [Seg, Seg] {
  const ax = (s.x0 + s.cx) / 2, ay = (s.y0 + s.cy) / 2, bx = (s.cx + s.x1) / 2, by = (s.cy + s.y1) / 2;
  const mx = (ax + bx) / 2, my = (ay + by) / 2;
  if (s.line) {
    const lx = (s.x0 + s.x1) / 2, ly = (s.y0 + s.y1) / 2;
    return [{ x0: s.x0, y0: s.y0, cx: (s.x0 + lx) / 2, cy: (s.y0 + ly) / 2, x1: lx, y1: ly, line: true }, { x0: lx, y0: ly, cx: (lx + s.x1) / 2, cy: (ly + s.y1) / 2, x1: s.x1, y1: s.y1, line: true }];
  }
  return [{ x0: s.x0, y0: s.y0, cx: ax, cy: ay, x1: mx, y1: my, line: false }, { x0: mx, y0: my, cx: bx, cy: by, x1: s.x1, y1: s.y1, line: false }];
}
/** Splits the longest curves until there are `count` of them. */
function grow(segs: Seg[], count: number): Seg[] {
  const out = segs.slice();
  while (out.length < count) {
    let at = 0;
    for (let i = 1; i < out.length; i += 1) if (length(out[i]) > length(out[at])) at = i;
    out.splice(at, 1, ...split(out[at]));
  }
  return out;
}

const areaOf = (segs: Seg[]) => segs.reduce((sum, s) => sum + (s.x0 * s.y1 - s.x1 * s.y0) / 2, 0);

function contoursOf(elements: FlaElement[]): Contour[] {
  const styles = frameStyles(elements);
  const out: Contour[] = [];
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  const add = (paths: Path[], m: Matrix, kind: "fill" | "stroke", style: number) => {
    // Each sub-outline (a path can hold several, started by a move) is matched on its own.
    const subs = paths.flatMap((path) => { const out: Path[] = []; for (const c of path) { if (c[0] === "M") out.push([c]); else out[out.length - 1]?.push(c); } return out; });
    for (const path of subs) {
      const segs = segsOf(path, m);
      if (!segs.length) continue;
      const pts = segs.map((s) => [s.x0, s.y0]);
      const cx = pts.reduce((a, p) => a + p[0], 0) / pts.length, cy = pts.reduce((a, p) => a + p[1], 0) / pts.length;
      const closed = Math.hypot(segs[0].x0 - segs[segs.length - 1].x1, segs[0].y0 - segs[segs.length - 1].y1) < 0.05;
      out.push({ segs, style, kind, area: areaOf(segs), cx, cy, closed });
    }
  };
  for (const el of elements) {
    if (el.k !== "shape") continue;
    for (const f of el.fills) add(f.paths, el.m, "fill", styles.fills.findIndex((s) => same(s, f.style)));
    for (const s of el.strokes) add(s.paths, el.m, "stroke", styles.strokes.findIndex((x) => same(x, { ...s.style, w: s.style.w * scaleOf(el.m) })));
  }
  return out;
}

/** The segment list of B laid over A: same direction, same count, best start point. */
function align(a: Contour, b: Contour): [Seg[], Seg[]] {
  let sb = b.segs;
  if (a.closed && b.closed) { if (Math.sign(a.area) !== Math.sign(b.area)) sb = reverse(sb); }
  else {
    const d = (p: Seg, q: Seg) => Math.hypot(p.x0 - q.x0, p.y0 - q.y0);
    const keep = d(a.segs[0], sb[0]) + Math.hypot(a.segs[a.segs.length - 1].x1 - sb[sb.length - 1].x1, a.segs[a.segs.length - 1].y1 - sb[sb.length - 1].y1);
    const flip = reverse(sb);
    const flipped = d(a.segs[0], flip[0]) + Math.hypot(a.segs[a.segs.length - 1].x1 - flip[flip.length - 1].x1, a.segs[a.segs.length - 1].y1 - flip[flip.length - 1].y1);
    if (flipped < keep) sb = flip;
  }
  // Animate's count is about a + b − 1: both outlines are cut where the other has a corner (matched by the share of the outline's length
  // travelled), so no corner of either is lost. For a closed pair the start of B is the corner that makes the vertices lie closest together.
  const turns = a.closed && b.closed ? sb.length : 1;
  let best: [Seg[], Seg[]] | null = null, bestCost = Infinity;
  for (let r = 0; r < turns; r += 1) {
    const rotated = r ? [...sb.slice(r), ...sb.slice(0, r)] : sb;
    // Outlines with the same number of curves are paired curve for curve (as Animate does); others are cut at each other's corners.
    const [A, B] = a.segs.length === rotated.length ? [a.segs, rotated] : meet(a.segs, rotated);
    let cost = 0;
    for (let i = 0; i < A.length; i += 1) cost += (A[i].x0 - B[i].x0) ** 2 + (A[i].y0 - B[i].y0) ** 2;
    if (cost < bestCost) { bestCost = cost; best = [A, B]; }
  }
  return best!;
}

/** Where each segment starts, as the share (0…1) of the outline's length travelled. */
function starts(segs: Seg[]): number[] {
  const total = segs.reduce((n, s) => n + length(s), 0) || 1;
  let run = 0;
  return segs.map((s) => { const at = run / total; run += length(s); return at; });
}
/** One segment cut at fractions (0…1, rising) of its own length. */
function cut(s: Seg, at: number[]): Seg[] {
  const out: Seg[] = [];
  let rest = s, done = 0;
  for (const f of at) {
    const local = (f - done) / (1 - done);
    if (!(local > 1e-6 && local < 1 - 1e-6)) continue;
    const ax = rest.x0 + (rest.cx - rest.x0) * local, ay = rest.y0 + (rest.cy - rest.y0) * local;
    const bx = rest.cx + (rest.x1 - rest.cx) * local, by = rest.cy + (rest.y1 - rest.cy) * local;
    const mx = ax + (bx - ax) * local, my = ay + (by - ay) * local;
    if (rest.line) {
      const lx = rest.x0 + (rest.x1 - rest.x0) * local, ly = rest.y0 + (rest.y1 - rest.y0) * local;
      out.push({ x0: rest.x0, y0: rest.y0, cx: (rest.x0 + lx) / 2, cy: (rest.y0 + ly) / 2, x1: lx, y1: ly, line: true });
      rest = { x0: lx, y0: ly, cx: (lx + rest.x1) / 2, cy: (ly + rest.y1) / 2, x1: rest.x1, y1: rest.y1, line: true };
    } else {
      out.push({ x0: rest.x0, y0: rest.y0, cx: ax, cy: ay, x1: mx, y1: my, line: false });
      rest = { x0: mx, y0: my, cx: bx, cy: by, x1: rest.x1, y1: rest.y1, line: false };
    }
    done = f;
  }
  out.push(rest);
  return out;
}
/** Both outlines cut at each other's corners: the same number of curves, each pair covering the same share of the outline. */
function meet(a: Seg[], b: Seg[]): [Seg[], Seg[]] {
  const ua = starts(a), ub = starts(b);
  const all: number[] = [];
  for (const u of [...ua, ...ub].sort((x, y) => x - y)) if (!all.length || u - all[all.length - 1] > 1e-4) all.push(u);
  const pieces = (segs: Seg[], u: number[]): Seg[] => segs.flatMap((s, i) => {
    const lo = u[i], hi = i + 1 < u.length ? u[i + 1] : 1;
    const inside = all.filter((v) => v > lo + 2e-4 && v < hi - 2e-4).map((v) => (v - lo) / (hi - lo));
    return cut(s, inside);
  });
  const A = pieces(a, ua), B = pieces(b, ub);
  const n = Math.max(A.length, B.length);
  return [grow(A, n), grow(B, n)];
}

const collapsed = (segs: Seg[], cx: number, cy: number): Seg[] => segs.map((s) => ({ x0: cx, y0: cy, cx, cy, x1: cx, y1: cy, line: s.line }));

function segment(a: Seg[], b: Seg[], f1: number, f2: number, s1: number, s2: number): MorphSegment {
  return {
    a: [a[0].x0, a[0].y0], b: [b[0].x0, b[0].y0], f1, f2, s1, s2,
    curves: a.map((p, i) => [p.line && b[i].line ? 1 : 0, p.cx, p.cy, p.x1, p.y1, b[i].cx, b[i].cy, b[i].x1, b[i].y1]),
  };
}

/** The matched curves for a shape tween from keyframe `from` to keyframe `to` (Animate's MorphShape, recomputed). */
export function matchShapes(from: FlaElement[], to: FlaElement[]): MorphSegment[] {
  const A = contoursOf(from), B = contoursOf(to);
  const out: MorphSegment[] = [];
  const free = new Set(B.map((_, i) => i));
  const mark = (c: Contour, v: number): [number, number] => (c.kind === "fill" ? [v, -1] : [-1, v]);
  for (const a of A.slice().sort((x, y) => Math.abs(y.area) - Math.abs(x.area))) {
    let best = -1, bestCost = Infinity;
    for (const i of free) {
      const b = B[i];
      if (b.kind !== a.kind) continue;
      // The same style is preferred, but an outline whose fill changed between the keys is still the same outline.
      const cost = Math.hypot(a.cx - b.cx, a.cy - b.cy) + 0.5 * Math.abs(Math.sqrt(Math.abs(a.area)) - Math.sqrt(Math.abs(b.area))) + (b.style === a.style ? 0 : 40);
      if (cost < bestCost) { bestCost = cost; best = i; }
    }
    if (best < 0) {
      // No partner: shrink to its own centre.
      const [f1, s1] = mark(a, a.style);
      out.push(segment(a.segs, collapsed(a.segs, a.cx, a.cy), f1, a.kind === "fill" ? a.style : -1, s1, a.kind === "stroke" ? a.style : -1));
      continue;
    }
    free.delete(best);
    const [sa, sb] = align(a, B[best]);
    out.push(a.kind === "fill" ? segment(sa, sb, a.style, B[best].style, -1, -1) : segment(sa, sb, -1, -1, a.style, B[best].style));
  }
  // Outlines only the second key has grow out of their own centre, in the first key's style when it has one like it.
  for (const i of free) {
    const b = B[i];
    const style = Math.max(0, Math.min(b.style, (b.kind === "fill" ? frameStyles(from).fills.length : frameStyles(from).strokes.length) - 1));
    const base = collapsed(b.segs, b.cx, b.cy);
    out.push(b.kind === "fill" ? segment(base, b.segs, style, b.style, -1, -1) : segment(base, b.segs, -1, -1, style, b.style));
  }
  return out;
}

// ---------- what a shape tween shows at t, as ordinary artwork
const mix = (a: Fill, b: Fill, t: number): Fill => {
  if (a.t !== "solid" || b.t !== "solid") return a;
  const c = (s: string, i: number) => parseInt(s.replace("#", "").slice(i, i + 2), 16);
  const color = "#" + [0, 2, 4].map((i) => Math.round(lerp(c(a.color, i), c(b.color, i), t)).toString(16).padStart(2, "0")).join("").toUpperCase();
  return { t: "solid", color, alpha: lerp(a.alpha, b.alpha, t) };
};

/** The tweened artwork at progress t (0…1) between `key` and `next`: what F6 inside a shape tween turns into a keyframe. */
export function morphToShapes(key: Keyframe, next: Keyframe, t: number): FlaElement[] {
  const A = frameStyles(key.elements), B = frameStyles(next.elements);
  const fills = new Map<string, { style: Fill; paths: Path[] }>();
  const strokes = new Map<string, { style: Stroke; paths: Path[] }>();
  for (const seg of key.morph || []) {
    const path: Cmd[] = [["M", lerp(seg.a[0], seg.b[0], t), lerp(seg.a[1], seg.b[1], t)]];
    for (const c of seg.curves) {
      const x = lerp(c[3], c[7], t), y = lerp(c[4], c[8], t);
      path.push(c[0] ? ["L", x, y] : ["Q", lerp(c[1], c[5], t), lerp(c[2], c[6], t), x, y]);
    }
    const fa = A.fills[seg.f1];
    if (fa) {
      const style = mix(fa, B.fills[seg.f2] || fa, t), k = JSON.stringify(style);
      (fills.get(k) || fills.set(k, { style, paths: [] }).get(k)!).paths.push(path);
      continue;
    }
    const sa = A.strokes[seg.s1];
    if (!sa) continue;
    const sb = B.strokes[seg.s2] || sa;
    const style: Stroke = { ...sa, w: lerp(sa.w, sb.w, t), fill: mix(sa.fill, sb.fill, t) }, k = JSON.stringify(style);
    (strokes.get(k) || strokes.set(k, { style, paths: [] }).get(k)!).paths.push(path);
  }
  const fillList = [...fills.values()], strokeList = [...strokes.values()];
  const shape: ShapeElement = {
    k: "shape", m: [1, 0, 0, 1, 0, 0], fills: fillList, strokes: strokeList,
    fillStyles: Object.fromEntries(fillList.map((f, i) => [i + 1, f.style])),
    strokeStyles: Object.fromEntries(strokeList.map((s, i) => [i + 1, s.style])),
  };
  return [shape];
}
