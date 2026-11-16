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
