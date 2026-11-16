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
