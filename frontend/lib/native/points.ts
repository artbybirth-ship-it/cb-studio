/**
 * Anchor and control points of a drawn shape (Animate's Subselection tool), for editing in the native pose editor.
 *
 * A drawn shape is kept as closed fill outlines and open stroke lines (lib/fla/xfl.ts), made of straight segments and quadratic curves in
 * the shape's own space. The same corner usually appears several times: in the fill outline, in the stroke line that runs along it and in
 * the next fill that shares the edge. Moving a point therefore moves every copy of it, so the fill and its outline stay together.
 * Everything here is pure: the shape given is never changed, a new one comes back.
 */
import type { Cmd, Path, ShapeElement } from "../fla/xfl";

export type Pt = [number, number];
/** An anchor (a corner or end where segments meet), or the control point that bends one curve between two anchors. */
export type PointRef = { kind: "anchor"; at: Pt } | { kind: "control"; at: Pt; a: Pt; b: Pt };

const EPS = 0.02;
const near = (p: Pt, q: Pt) => Math.abs(p[0] - q[0]) <= EPS && Math.abs(p[1] - q[1]) <= EPS;
const ends = (cmd: Cmd): Pt => (cmd[0] === "Q" ? [cmd[3], cmd[4]] : [cmd[1], cmd[2]]);
const every = (el: ShapeElement): Path[] => [...el.fills.flatMap((f) => f.paths), ...el.strokes.flatMap((s) => s.paths)];

/** The shape's distinct anchors, and its curve control points (each with the two anchors of its curve), in the shape's own space. */
export function shapePoints(el: ShapeElement): { anchors: Pt[]; controls: Array<Extract<PointRef, { kind: "control" }>> } {
  const anchors: Pt[] = [], controls: Array<Extract<PointRef, { kind: "control" }>> = [];
  const noteAnchor = (p: Pt) => { if (!anchors.some((a) => near(a, p))) anchors.push(p); };
  for (const path of every(el)) {
    let at: Pt = [0, 0];
    for (const cmd of path) {
      const to = ends(cmd);
      if (cmd[0] === "M") { noteAnchor(to); at = to; continue; }
      noteAnchor(to);
      if (cmd[0] === "Q") {
        const control: Pt = [cmd[1], cmd[2]], from = at;
        // The same curve drawn the other way round (a neighbouring fill) is the same control point.
        if (!controls.some((c) => near(c.at, control) && ((near(c.a, from) && near(c.b, to)) || (near(c.a, to) && near(c.b, from))))) controls.push({ kind: "control", at: control, a: from, b: to });
      }
      at = to;
    }
  }
  return { anchors, controls };
}

/** Where the point `ref` is dragged to: every copy of it moves. An anchor leaves the curves' control points where they are (as Animate does). */
export function movePoint(el: ShapeElement, ref: PointRef, to: Pt): ShapeElement {
  const remap = (path: Path): Path => {
    const out: Path = [];
    let was: Pt = [0, 0];
    for (const cmd of path) {
      const end = ends(cmd);
      let next: Cmd = cmd;
      if (ref.kind === "anchor") {
        const moved = near(end, ref.at);
        if (cmd[0] === "M") next = moved ? ["M", to[0], to[1]] : cmd;
        else if (cmd[0] === "L") next = moved ? ["L", to[0], to[1]] : cmd;
        else next = moved ? ["Q", cmd[1], cmd[2], to[0], to[1]] : cmd;
      } else if (cmd[0] === "Q" && near([cmd[1], cmd[2]], ref.at) && ((near(was, ref.a) && near(end, ref.b)) || (near(was, ref.b) && near(end, ref.a)))) {
        next = ["Q", to[0], to[1], cmd[3], cmd[4]];
      }
      out.push(next);
      was = end;
    }
    return out;
  };
  return { ...el, fills: el.fills.map((f) => ({ ...f, paths: f.paths.map(remap) })), strokes: el.strokes.map((s) => ({ ...s, paths: s.paths.map(remap) })) };
}

// ---- Several points at once, deleting, adding and converting (Animate's Subselection, Delete, Pen "+" and Convert Anchor tools).

/** Where each of the anchors `from` goes (same order as `to`): every copy of each moves; the curves' control points stay. */
export function moveAnchors(el: ShapeElement, from: Pt[], to: Pt[]): ShapeElement {
  const target = (p: Pt): Pt | null => { const i = from.findIndex((f) => near(f, p)); return i >= 0 ? to[i] : null; };
  const remap = (path: Path): Path => path.map((cmd) => {
    const moved = target(ends(cmd));
    if (!moved) return cmd;
    return cmd[0] === "Q" ? ["Q", cmd[1], cmd[2], moved[0], moved[1]] : [cmd[0], moved[0], moved[1]];
  });
  return mapPaths(el, remap);
}

const mapPaths = (el: ShapeElement, fn: (path: Path) => Path | null): ShapeElement => ({
  ...el,
  fills: el.fills.map((f) => ({ ...f, paths: f.paths.map(fn).filter((p): p is Path => Boolean(p && p.length)) })),
  strokes: el.strokes.map((s) => ({ ...s, paths: s.paths.map(fn).filter((p): p is Path => Boolean(p && p.length)) })),
});

/** One segment of an outline: from, to, and the control point when it is a curve. */
type Seg = { from: Pt; to: Pt; c: Pt | null };
/** A path as its runs (each starts at an M): the segments of each, and whether it closes on itself. */
function runsOf(path: Path): Array<{ segs: Seg[]; closed: boolean; start: Pt }> {
  const runs: Array<{ segs: Seg[]; closed: boolean; start: Pt }> = [];
  let at: Pt = [0, 0];
  for (const cmd of path) {
    const to = ends(cmd);
    if (cmd[0] === "M") { runs.push({ segs: [], closed: false, start: to }); at = to; continue; }
    if (!runs.length) runs.push({ segs: [], closed: false, start: at });
    runs[runs.length - 1].segs.push({ from: at, to, c: cmd[0] === "Q" ? [cmd[1], cmd[2]] : null });
    at = to;
  }
  for (const run of runs) run.closed = run.segs.length > 0 && near(run.segs[run.segs.length - 1].to, run.start);
  return runs;
}
function pathOf(runs: Array<{ segs: Seg[] }>): Path {
  const out: Path = [];
  for (const { segs } of runs) {
    if (!segs.length) continue;
    out.push(["M", segs[0].from[0], segs[0].from[1]]);
    for (const s of segs) out.push(s.c ? ["Q", s.c[0], s.c[1], s.to[0], s.to[1]] : ["L", s.to[0], s.to[1]]);
  }
  return out;
}
/** Two segments meeting at an anchor made into one: two straight sides give a straight line, otherwise a curve through where the anchor was. */
function joined(a: Seg, b: Seg): Seg {
  if (!a.c && !b.c) return { from: a.from, to: b.to, c: null };
  const p = a.to;
  return { from: a.from, to: b.to, c: [2 * p[0] - (a.from[0] + b.to[0]) / 2, 2 * p[1] - (a.from[1] + b.to[1]) / 2] };
}

/** The anchors `points` taken out: their neighbours are joined. A closed outline left with too little to enclose anything goes, as does an empty line. */
export function deleteAnchors(el: ShapeElement, points: Pt[]): ShapeElement {
  const gone = (p: Pt) => points.some((q) => near(p, q));
  return mapPaths(el, (path) => {
    const runs = runsOf(path).map((run) => {
      let segs = run.segs;
      if (run.closed) {
        // Cyclic: the anchor at the end of segment k joins segment k and the next one.
        for (let guard = 0; guard < 10000; guard += 1) {
          const k = segs.findIndex((s) => gone(s.to));
          if (k < 0 || segs.length < 2) break;
          const next = (k + 1) % segs.length, merged = joined(segs[k], segs[next]);
          if (next === 0) segs = [...segs.slice(1, k), merged];
          else segs = [...segs.slice(0, k), merged, ...segs.slice(next + 1)];
        }
        if (segs.length < 2 || (segs.length === 2 && !segs[0].c && !segs[1].c) || segs.some((s) => gone(s.to))) return { segs: [] as Seg[] };
        return { segs };
      }
      while (segs.length && gone(segs[0].from)) segs = segs.slice(1);
      while (segs.length && gone(segs[segs.length - 1].to)) segs = segs.slice(0, -1);
      for (let guard = 0; guard < 10000; guard += 1) {
        const k = segs.findIndex((s, i) => i < segs.length - 1 && gone(s.to));
        if (k < 0) break;
        segs = [...segs.slice(0, k), joined(segs[k], segs[k + 1]), ...segs.slice(k + 2)];
      }
      return { segs };
    });
    const out = pathOf(runs);
    return out.length ? out : null;
  });
}

const lerpPt = (a: Pt, b: Pt, t: number): Pt => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
const at = (s: Seg, t: number): Pt => (s.c ? lerpPt(lerpPt(s.from, s.c, t), lerpPt(s.c, s.to, t), t) : lerpPt(s.from, s.to, t));
const sameSeg = (s: Seg, e: Seg) => (s.c ? Boolean(e.c && near(s.c, e.c)) : !e.c) && ((near(s.from, e.from) && near(s.to, e.to)) || (near(s.from, e.to) && near(s.to, e.from)));

/** An edge of the shape: its ends, its control point (null for a straight one). */
export type EdgeRef = { a: Pt; b: Pt; c: Pt | null };

/** The edge nearest the point p (shape space) within `reach`, and where along it (t from a to b). */
export function edgeAt(el: ShapeElement, p: Pt, reach: number): { edge: EdgeRef; t: number; d: number } | null {
  let best: { edge: EdgeRef; t: number; d: number } | null = null;
  for (const path of every(el)) for (const run of runsOf(path)) for (const s of run.segs) {
    let bt = 0, bd = Infinity;
    for (let i = 0; i <= 40; i += 1) { const q = at(s, i / 40), d = Math.hypot(q[0] - p[0], q[1] - p[1]); if (d < bd) { bd = d; bt = i / 40; } }
    // Refine around the best sample.
    for (let step = 1 / 80; step > 1e-4; step /= 2) for (const t of [bt - step, bt + step]) {
      if (t < 0 || t > 1) continue;
      const q = at(s, t), d = Math.hypot(q[0] - p[0], q[1] - p[1]);
      if (d < bd) { bd = d; bt = t; }
    }
    if (bd <= reach && (!best || bd < best.d)) best = { edge: { a: s.from, b: s.to, c: s.c }, t: bt, d: bd };
  }
  return best;
}

/** A new anchor on `edge` at t (0..1 from a to b), on every copy of the edge; the outline keeps its exact shape. Answers the new shape and the new anchor. */
export function addAnchor(el: ShapeElement, edge: EdgeRef, t: number): { shape: ShapeElement; point: Pt } {
  const ref: Seg = { from: edge.a, to: edge.b, c: edge.c };
  const point = at(ref, t);
  const split = (s: Seg): Seg[] => {
    const u = near(s.from, ref.from) ? t : 1 - t;
    if (!s.c) return [{ from: s.from, to: point, c: null }, { from: point, to: s.to, c: null }];
    const p01 = lerpPt(s.from, s.c, u), p12 = lerpPt(s.c, s.to, u);
    return [{ from: s.from, to: point, c: p01 }, { from: point, to: s.to, c: p12 }];
  };
  const shape = mapPaths(el, (path) => pathOf(runsOf(path).map((run) => ({ segs: run.segs.flatMap((s) => (sameSeg(s, ref) ? split(s) : [s])) }))));
  return { shape, point };
}

/**
 * Corner ↔ curve at the anchor p (Animate's Convert Anchor Point tool). When any edge meeting there is curved, every edge meeting there
 * is made straight (a corner). When they are all straight, they bend into one smooth curve through p, along the line from the anchor
 * before it to the one after it.
 */
export function convertAnchor(el: ShapeElement, p: Pt): ShapeElement {
  const touching: Seg[] = [];
  let tangent: Pt | null = null;
  for (const path of every(el)) for (const run of runsOf(path)) {
    const n = run.segs.length;
    run.segs.forEach((s, i) => {
      if (near(s.from, p) || near(s.to, p)) touching.push(s);
      if (!tangent && near(s.to, p)) {
        const next = i + 1 < n ? run.segs[i + 1] : run.closed ? run.segs[0] : null;
        if (next) { const d: Pt = [next.to[0] - s.from[0], next.to[1] - s.from[1]], len = Math.hypot(d[0], d[1]); if (len > 1e-9) tangent = [d[0] / len, d[1] / len]; }
      }
    });
  }
  if (!touching.length) return el;
  const curved = touching.some((s) => s.c);
  if (!curved && !tangent) return el;
  const bend = (s: Seg): Seg => {
    if (curved) return { ...s, c: null };
    const other = near(s.from, p) ? s.to : s.from, len = Math.hypot(other[0] - p[0], other[1] - p[1]);
    const side = Math.sign((other[0] - p[0]) * tangent![0] + (other[1] - p[1]) * tangent![1]) || 1;
    return { ...s, c: [p[0] + side * tangent![0] * len / 2, p[1] + side * tangent![1] * len / 2] };
  };
  return mapPaths(el, (path) => pathOf(runsOf(path).map((run) => ({ segs: run.segs.map((s) => (near(s.from, p) || near(s.to, p) ? bend(s) : s)) }))));
}


/** The same anchor (points within the editing tolerance). */
export const samePoint = near;
