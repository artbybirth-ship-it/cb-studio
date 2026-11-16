// lib/native/props.ts: a part's numbers (Properties) from its matrix, and back.
const assert = require("assert");
const p = require("./native/props.js");
const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} vs ${b}`);
const nearM = (m, n) => m.forEach((v, i) => near(v, n[i]));
const at = (m, q) => [m[0] * q[0] + m[2] * q[1] + m[4], m[1] * q[0] + m[3] * q[1] + m[5]];

// plain: scale 2 × 0.5, turned 30°, pivot (10, 20)
const r = Math.PI / 6, m = [2 * Math.cos(r), 2 * Math.sin(r), -0.5 * Math.sin(r), 0.5 * Math.cos(r), 100, 50], pivot = [10, 20];
const v = p.propsOf(m, pivot);
near(v.w, 200); near(v.h, 50); near(v.rotation, 30); near(v.skew, 0);
nearM([v.x, v.y], at(m, pivot));
// nothing changed gives the same matrix back
nearM(p.withProps(m, pivot, {}), m);
nearM(p.withProps(m, pivot, { rotation: v.rotation, w: v.w }), m);
// X moves only the place
const moved = p.withProps(m, pivot, { x: v.x + 7 });
nearM(moved.slice(0, 4), m.slice(0, 4)); nearM(at(moved, pivot), [v.x + 7, v.y]);
// rotation, size and skew keep the transformation point where it is
for (const change of [{ rotation: -45 }, { w: 80 }, { h: 300 }, { skew: 20 }]) {
  const n = p.withProps(m, pivot, change);
  nearM(at(n, pivot), [v.x, v.y]);
  const back = p.propsOf(n, pivot);
  for (const [k, value] of Object.entries(change)) near(back[k], value, 1e-6);
}
// a flipped part (negative a) round-trips exactly through its numbers
const flipped = [-1, 0, 0, 1, 5, 5];
nearM(p.withProps(flipped, [0, 0], { x: p.propsOf(flipped, [0, 0]).x }), flipped);
const fv = p.propsOf(flipped, [0, 0]);
nearM(p.withProps(flipped, [0, 0], { rotation: fv.rotation, skew: fv.skew }), flipped);
// a drawn shape turns about its middle
const fill = { t: "solid", color: "#000", alpha: 1 };
const shape = { k: "shape", m: [1, 0, 0, 1, 0, 0], fills: [{ style: fill, paths: [[["M", 0, 0], ["L", 40, 0], ["L", 40, 20], ["L", 0, 20], ["L", 0, 0]]] }], strokes: [] };
assert.deepEqual(p.pivotOf(shape), [20, 10]);
// a number within the shown rounding (one decimal) changes nothing: the very same matrix comes back
const odd = [0.98765, 0.1234, -0.1234, 0.98765, 3.21, 4.56];
const ov = p.propsOf(odd, [0, 0]);
assert.strictEqual(p.withProps(odd, [0, 0], { w: Math.round(ov.w * 10) / 10, rotation: Math.round(ov.rotation * 10) / 10, x: Math.round(ov.x * 10) / 10 }), odd);
console.log("props tests passed");
