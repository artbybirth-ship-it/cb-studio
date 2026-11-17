// lib/native/handles.ts: what the stage's transform handles do to a part.
const assert = require("assert");
const h = require("./native/handles.js");
const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} vs ${b}`);
const nearP = (p, q) => { near(p[0], q[0]); near(p[1], q[1]); };
// a part turned 30° and scaled 2, placed at (100, 50); its artwork box in its own space is 0…40 × 0…20
const r = Math.PI / 6, frame = [2 * Math.cos(r), 2 * Math.sin(r), -2 * Math.sin(r), 2 * Math.cos(r), 100, 50];
const box = { x0: 0, y0: 0, x1: 40, y1: 20 };
const corners = h.cornersOf(frame, box);
const pivot = h.apply(frame, [20, 10]);
const after = (G) => h.cornersOf(h.mul(G, frame), box);

// a corner dragged: the opposite corner stays, the dragged one follows the pointer
const se = corners[2], move = [se[0] + 15, se[1] + 7];
let G = h.handleTransform("se", frame, box, se, move, pivot);
nearP(after(G)[0], corners[0]); nearP(after(G)[2], move);
// a side handle: only that way (the opposite side stays, the other axis keeps its size)
const e = h.apply(frame, [40, 10]);
G = h.handleTransform("e", frame, box, e, h.apply(frame, [60, 10]), pivot);
nearP(after(G)[0], corners[0]); nearP(after(G)[3], corners[3]);
nearP(after(G)[1], h.apply(frame, [60, 0]));
// Alt: from the transformation point
G = h.handleTransform("e", frame, box, e, h.apply(frame, [60, 10]), pivot, { alt: true });
nearP(h.apply(G, pivot), pivot);
// Shift on a corner: the same factor both ways
G = h.handleTransform("se", frame, box, se, h.apply(frame, [80, 25]), pivot, { shift: true });
const L = h.mul(G, frame), sx = Math.hypot(L[0], L[1]) / 2, sy = Math.hypot(L[2], L[3]) / 2;
near(sx, sy); near(sx, 2);
// rotate: about the transformation point, by the angle swept; Shift snaps to 15°
const start = [pivot[0] + 50, pivot[1]], now = [pivot[0], pivot[1] + 50];
G = h.handleTransform("rotate", frame, box, start, now, pivot);
nearP(h.apply(G, pivot), pivot); near(Math.atan2(G[1], G[0]), Math.PI / 2);
G = h.handleTransform("rotate", frame, box, start, [pivot[0] + 50, pivot[1] + 12], pivot, { shift: true });
near(Math.atan2(G[1], G[0]) * 180 / Math.PI, 15);
// skew along the top edge: the bottom edge stays, the top slides along the part's own x
G = h.handleTransform("skew-n", frame, box, h.apply(frame, [20, 0]), h.apply(frame, [30, 0]), pivot);
nearP(after(G)[3], corners[3]); nearP(after(G)[2], corners[2]);
nearP(after(G)[0], h.apply(frame, [10, 0]));
// skew along the right edge: the left edge stays
G = h.handleTransform("skew-e", frame, box, h.apply(frame, [40, 10]), h.apply(frame, [40, 16]), pivot);
nearP(after(G)[0], corners[0]); nearP(after(G)[3], corners[3]); nearP(after(G)[1], h.apply(frame, [40, 6]));
// nothing moved: nothing changes
G = h.handleTransform("se", frame, box, se, se, pivot);
[1, 0, 0, 1, 0, 0].forEach((v, i) => near(G[i], v));
// a box around several parts
assert.deepEqual(h.boxAround([[[0, 0], [10, 0]], [[5, -3], [7, 20]]]), { x0: 0, y0: -3, x1: 10, y1: 20 });
console.log("handles ok");
