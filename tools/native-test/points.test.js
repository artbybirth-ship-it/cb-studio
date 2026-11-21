const assert = require("assert");
const p = require("./native/points.js");
const o = require("./native/ops.js");
const fill = { t: "solid", color: "#FF0000", alpha: 1 };
const stroke = { w: 1, caps: "round", joints: "round", miter: 3, scale: "normal", fill: { t: "solid", color: "#000000", alpha: 1 } };
// a square whose top edge bends (a curve), with the same outline also drawn as a stroke, and a second fill sharing the right edge, drawn backwards
const outline = [["M", 0, 0], ["Q", 10, -6, 20, 0], ["L", 20, 20], ["L", 0, 20], ["L", 0, 0]];
const neighbour = [["M", 20, 20], ["L", 20, 0], ["L", 40, 0], ["L", 40, 20], ["L", 20, 20]];
const shape = { k: "shape", m: [1, 0, 0, 1, 0, 0], fillStyles: {}, strokeStyles: {}, fills: [{ style: fill, paths: [outline, neighbour] }], strokes: [{ style: stroke, paths: [outline] }] };
const found = p.shapePoints(shape);
assert.equal(found.anchors.length, 6, "corners found once each: " + JSON.stringify(found.anchors));
assert.equal(found.controls.length, 1, "one curve");
assert.deepEqual(found.controls[0].at, [10, -6]);
// moving a corner moves it in the fill, the stroke and the neighbouring fill, and leaves the control point
const moved = p.movePoint(shape, { kind: "anchor", at: [20, 0] }, [25, -4]);
const pts = (path) => JSON.stringify(path);
assert.equal(pts(moved.fills[0].paths[0]), pts([["M", 0, 0], ["Q", 10, -6, 25, -4], ["L", 20, 20], ["L", 0, 20], ["L", 0, 0]]), "fill outline");
assert.equal(pts(moved.strokes[0].paths[0]), pts(moved.fills[0].paths[0]), "stroke follows the fill");
assert.equal(pts(moved.fills[0].paths[1]), pts([["M", 20, 20], ["L", 25, -4], ["L", 40, 0], ["L", 40, 20], ["L", 20, 20]]), "neighbour shares the corner");
assert.equal(pts(shape.fills[0].paths[0]), pts(outline), "input not changed");
// the start corner (the M and the closing L) moves together
const start = p.movePoint(shape, { kind: "anchor", at: [0, 0] }, [-3, 2]);
assert.equal(pts(start.fills[0].paths[0]), pts([["M", -3, 2], ["Q", 10, -6, 20, 0], ["L", 20, 20], ["L", 0, 20], ["L", -3, 2]]), "start and close");
// moving the control point bends the curve in fill and stroke alike
const bent = p.movePoint(shape, found.controls[0], [10, -12]);
assert.equal(pts(bent.fills[0].paths[0]), pts([["M", 0, 0], ["Q", 10, -12, 20, 0], ["L", 20, 20], ["L", 0, 20], ["L", 0, 0]]));
assert.equal(pts(bent.strokes[0].paths[0]), pts(bent.fills[0].paths[0]));
// editing a keyframe that a shape tween starts from makes the tween work its curves out again
const sq = (w) => ({ k: "shape", m: [1, 0, 0, 1, 0, 0], fillStyles: {}, strokeStyles: {}, strokes: [], fills: [{ style: fill, paths: [[["M", 0, 0], ["L", w, 0], ["L", w, w], ["L", 0, w], ["L", 0, 0]]] }] });
let layer = { name: "l", type: "normal", parent: null, hidden: false, frames: [{ i: 0, d: 4, elements: [sq(20)] }, { i: 4, d: 1, elements: [sq(40)] }] };
layer = o.setTween(layer, 0, "shape");
assert.ok(layer.frames[0].morph, "matched");
const edited = o.setElement(layer, 0, 0, (el) => p.movePoint(el, { kind: "anchor", at: [20, 20] }, [30, 25]));
assert.ok(edited.frames[0].morph, "re-matched after the point moved");
assert.deepEqual(edited.frames[0].elements[0].fills[0].paths[0][2], ["L", 30, 25]);
assert.notDeepEqual(edited.frames[0].morph, layer.frames[0].morph, "the curves are new");
console.log("points ok");

// ---- several anchors at once
const two = p.moveAnchors(shape, [[20, 0], [20, 20]], [[22, 1], [22, 21]]);
assert.equal(pts(two.fills[0].paths[0]), pts([["M", 0, 0], ["Q", 10, -6, 22, 1], ["L", 22, 21], ["L", 0, 20], ["L", 0, 0]]), "both corners of the right edge move");
assert.equal(pts(two.fills[0].paths[1]), pts([["M", 22, 21], ["L", 22, 1], ["L", 40, 0], ["L", 40, 20], ["L", 22, 21]]), "...in the neighbour too");
assert.equal(pts(two.strokes[0].paths[0]), pts(two.fills[0].paths[0]));

// ---- deleting an anchor joins its neighbours
// (0,20) sits between two straight sides: they become one straight line, in the fill and the stroke
const del1 = p.deleteAnchors(shape, [[0, 20]]);
assert.equal(pts(del1.fills[0].paths[0]), pts([["M", 0, 0], ["Q", 10, -6, 20, 0], ["L", 20, 20], ["L", 0, 0]]), "straight + straight = straight");
assert.equal(pts(del1.strokes[0].paths[0]), pts(del1.fills[0].paths[0]));
assert.equal(pts(del1.fills[0].paths[1]), pts(neighbour), "the neighbour does not have that anchor");
// (20,0) sits between the curve and a straight side: one curve that passes through where the anchor was
const del2 = p.deleteAnchors(shape, [[20, 0]]);
const q = del2.fills[0].paths[0][1];
assert.equal(q[0], "Q"); assert.deepEqual([q[3], q[4]], [20, 20], "joined to the next anchor");
const mid = [0.25 * 0 + 0.5 * q[1] + 0.25 * 20, 0.25 * 0 + 0.5 * q[2] + 0.25 * 20];
assert.ok(Math.hypot(mid[0] - 20, mid[1] - 0) < 1e-9, "the curve passes through the old anchor: " + mid);
assert.equal(del2.fills[0].paths[1].length, 4, "the neighbour loses the shared corner too");
// the start anchor of a closed outline (its M and its closing point)
const del3 = p.deleteAnchors(shape, [[0, 0]]);
assert.equal(del3.fills[0].paths[0].length, 4, "three sides left");
const d3 = del3.fills[0].paths[0], last = d3[d3.length - 1];
assert.deepEqual([d3[0][1], d3[0][2]], [last[last.length - 2], last[last.length - 1]], "still closed");
// a closed outline with too few anchors left goes; an open line loses its end
const tri = { ...shape, fills: [{ style: fill, paths: [[["M", 0, 0], ["L", 10, 0], ["L", 0, 10], ["L", 0, 0]]] }], strokes: [{ style: stroke, paths: [[["M", 0, 0], ["L", 10, 0], ["L", 20, 0]]] }] };
const del4 = p.deleteAnchors(tri, [[10, 0]]);
assert.equal(del4.fills[0].paths.length, 0, "a two-sided straight outline encloses nothing");
assert.equal(pts(del4.strokes[0].paths[0]), pts([["M", 0, 0], ["L", 20, 0]]), "line joined");
assert.equal(pts(p.deleteAnchors(tri, [[20, 0]]).strokes[0].paths[0]), pts([["M", 0, 0], ["L", 10, 0]]), "line end dropped");

// ---- adding an anchor keeps the outline's exact shape
const e1 = p.edgeAt(shape, [10, 20.5], 2);
assert.ok(e1 && Math.abs(e1.t - 0.5) < 1e-3, "the bottom edge, half way: " + JSON.stringify(e1));
const add1 = p.addAnchor(shape, e1.edge, e1.t);
assert.ok(Math.hypot(add1.point[0] - 10, add1.point[1] - 20) < 1e-3, "new anchor on the edge");
assert.equal(add1.shape.fills[0].paths[0].length, 6, "one more segment in the fill");
assert.equal(pts(add1.shape.strokes[0].paths[0]), pts(add1.shape.fills[0].paths[0]), "and in its outline");
assert.equal(add1.shape.fills[0].paths[1].length, 5, "the neighbour does not have that edge");
// on the curve: the two halves draw the same curve
const e2 = p.edgeAt(shape, [6, -3], 3);
assert.ok(e2 && e2.edge.c, "the curved top edge");
const add2 = p.addAnchor(shape, e2.edge, e2.t);
const [, h1, h2] = add2.shape.fills[0].paths[0];
const curve = (a, c, b, t) => [(1 - t) ** 2 * a[0] + 2 * (1 - t) * t * c[0] + t * t * b[0], (1 - t) ** 2 * a[1] + 2 * (1 - t) * t * c[1] + t * t * b[1]];
for (const t of [0.1, 0.3, 0.5, 0.7, 0.9]) {
  const u = t * e2.t, v = e2.t + t * (1 - e2.t);
  const want1 = curve([0, 0], [10, -6], [20, 0], u), got1 = curve([0, 0], [h1[1], h1[2]], [h1[3], h1[4]], t);
  const want2 = curve([0, 0], [10, -6], [20, 0], v), got2 = curve([h1[3], h1[4]], [h2[1], h2[2]], [h2[3], h2[4]], t);
  assert.ok(Math.hypot(want1[0] - got1[0], want1[1] - got1[1]) < 1e-9 && Math.hypot(want2[0] - got2[0], want2[1] - got2[1]) < 1e-9, "same curve at " + t);
}
// an edge shared with the neighbour (drawn the other way) is split there too
const e3 = p.edgeAt(shape, [20, 5], 1);
const add3 = p.addAnchor(shape, e3.edge, e3.t);
assert.ok(add3.shape.fills[0].paths[1].some((c) => Math.abs(c[c.length - 2] - 20) < 1e-9 && Math.abs(c[c.length - 1] - 5) < 1e-3), "neighbour split at the same point");
assert.equal(p.edgeAt(shape, [10, 10], 2), null, "nothing near the middle of the square");

// ---- corner <-> curve
// (0,20): two straight sides become curves through it, smooth along the line from (20,20) to (0,0)
const smooth = p.convertAnchor(shape, [0, 20]);
const sp = smooth.fills[0].paths[0];
assert.equal(sp[3][0], "Q"); assert.equal(sp[4][0], "Q");
const into = [sp[3][3] - sp[3][1], sp[3][4] - sp[3][2]], out = [sp[4][1] - sp[3][3], sp[4][2] - sp[3][4]];
assert.ok(Math.abs(into[0] * out[1] - into[1] * out[0]) < 1e-9 && into[0] * out[0] + into[1] * out[1] > 0, "smooth through the anchor");
assert.equal(pts(smooth.strokes[0].paths[0]), pts(sp), "outline follows");
// (20,0): the curve meeting it is straightened, as is the side, and the neighbour's side
const corner = p.convertAnchor(shape, [20, 0]);
assert.deepEqual(corner.fills[0].paths[0][1], ["L", 20, 0], "the curve is now straight");
assert.ok(corner.fills[0].paths.flat().every((c) => c[0] !== "Q"), "no curve meets that anchor any more");
// the round trip: a corner made smooth and back is a corner again
assert.equal(pts(p.convertAnchor(smooth, [0, 20]).fills[0].paths[0]), pts(outline), "smooth then corner = the outline");
// Option-drag on an edge: the straight left... right edge (20,0)-(20,20) is pulled out to (30,10) at its middle; the ends stay, the neighbour's copy bends too
const edge = { a: [20, 20], b: [20, 0], c: null };
const bentEdge = p.bendEdge(shape, edge, 0.5, [30, 10]);
const qb = bentEdge.fills[0].paths[0].find((c) => c[0] === "Q" && c[3] === 20 && c[4] === 20 || c[0] === "Q" && c[3] === 20 && c[4] === 0 && c[1] > 20);
assert.ok(qb, "the right edge is a curve now: " + pts(bentEdge.fills[0].paths[0]));
assert.ok(Math.abs(qb[1] - 40) < 1e-9 && Math.abs(qb[2] - 10) < 1e-9, "its control point puts the middle at (30,10): " + pts(qb));
assert.ok(bentEdge.fills[0].paths[1].some((c) => c[0] === "Q"), "the neighbouring fill's copy bends with it");
assert.ok(bentEdge.strokes[0].paths[0].some((c) => c[0] === "Q" && c[1] === 40), "the stroke follows");
assert.equal(pts(shape.fills[0].paths[0]), pts(outline), "input not changed");
console.log("points (several, delete, add, convert, bend) ok");
