const assert = require("assert");
const g = require("./native/legacy.js");
const inst = (tx) => ({ k: "instance", item: "A", symbolType: "graphic", m: [1,0,0,1,tx,0], pivot: [0,0], loop: "loop", first: 0 });
const L = (frames) => ({ name: "l", type: "normal", parent: null, hidden: false, frames });
const spans = (l) => l.frames.map((k) => `${k.i}+${k.d}${k.tween ? "t" : ""}${k.elements.length ? "" : "b"}`).join(" ");
// the real Sardar edit: keys at 0 9 15 27 69 79 85, the one at 15 moved to 20, layer ends at 100
let real = L([0, 9, 15, 27, 69, 79, 85].map((i, n, a) => ({ i, d: (a[n + 1] ?? 100) - i, elements: [inst(i)] })));
let moved = g.convertKeys(real, { props: ["instance"], anchors: [[0,0],[9,9],[15,20],[27,27],[69,69],[79,79],[85,85],[100,100]] });
assert.equal(spans(moved), "0+9 9+11 20+7 27+42 69+10 79+6 85+15", spans(moved));
assert.equal(moved.frames[2].elements[0].m[4], 15, "the moved key keeps its own artwork");
assert.equal(real.frames[1].d, 6, "the file's layer is not changed");
// a key added inside a tween takes the tweened state; both halves keep the tween
let tw = L([{ i: 0, d: 10, elements: [inst(0)], tween: "motion" }, { i: 10, d: 5, elements: [inst(100)] }]);
let added = g.convertKeys(tw, { props: [], anchors: [[0,0],[5,5],[10,10],[15,15]] });
assert.equal(spans(added), "0+5t 5+5t 10+5");
assert.ok(Math.abs(added.frames[1].elements[0].m[4] - 50) < 1e-6, "added key holds the tweened x");
// blanks, cut and a made tween
let hold = L([{ i: 0, d: 10, elements: [inst(0)] }, { i: 10, d: 10, elements: [inst(100)] }]);
let b = g.convertKeys(hold, { props: [], anchors: [[0,0],[10,10],[20,20]], blanks: [10] });
assert.equal(spans(b), "0+10 10+10b");
let cut = g.convertKeys(hold, { props: [], anchors: [[0,0],[10,10],[20,20]], cut: 14 });
assert.equal(spans(cut), "0+10 10+4");
let made = g.convertKeys(hold, { props: [], anchors: [[0,0],[10,10],[20,20]], tweens: [[0, 40]] });
assert.equal(spans(made), "0+10t 10+10");
assert.equal(made.frames[0].ease.intensity, -40);
// a made tween with no keyframe after it does not run
let tail = g.convertKeys(hold, { props: [], anchors: [[0,0],[10,10],[20,20]], tweens: [[10, 40]] });
assert.equal(spans(tail), "0+10 10+10");
// a key with no frames left is dropped
let gone = g.convertKeys(hold, { props: [], anchors: [[0,0],[10,20],[20,20]] });
assert.equal(spans(gone), "0+20", spans(gone));
// eases
let tl = { name: "t", length: 15, layers: [tw] };
let eased = g.convertTimeline(tl, { eases: { "0:0": { props: [], frame: 0, frames: 10, value: 60 } } });
assert.equal(eased.layers[0].frames[0].ease.intensity, -60);
assert.strictEqual(g.convertTimeline(tl, {}), tl, "nothing to apply: same timeline");
// values: the registration point and skew the old editor saved become a matrix again
const named = (name, m, pivot) => ({ ...inst(0), name, m, pivot });
const vk = { i: 0, d: 10, elements: [named("instance_9", [1,0,0,1,40,60], [10,20])] };
const vv = g.applyValues(vk, { props: ["instance_9"], frame: 0, v: { x: 100, y: 200 } });
let me = vv.elements[0];
assert.ok(Math.abs(me.m[4] + 10 - 100) < 1e-9 && Math.abs(me.m[5] + 20 - 200) < 1e-9, "x/y is where the registration point stands");
assert.deepEqual(me.pivot, [10, 20]);
const sk = g.applyValues(vk, { props: ["instance_9"], frame: 0, v: { skewX: 1.62, skewY: 1.62, scaleX: 1, scaleY: 1, regX: 0, regY: 0, x: 5, y: 6 } }).elements[0];
assert.ok(Math.abs(sk.m[0] - Math.cos(1.62 * Math.PI / 180)) < 1e-9 && Math.abs(sk.m[1] - Math.sin(1.62 * Math.PI / 180)) < 1e-9, "skew is a rotation when both match");
assert.deepEqual([sk.m[4], sk.m[5]], [5, 6]);
assert.strictEqual(g.applyValues(vk, { props: ["other"], frame: 0, v: { x: 1 } }), vk, "an unnamed object is not touched");
// alpha, and a value keyed by the file frame of a moved key
const mv = L([{ i: 0, d: 5, elements: [named("a", [1,0,0,1,0,0], [0,0])] }, { i: 5, d: 5, elements: [named("a", [1,0,0,1,9,0], [0,0])] }]);
const t2 = g.convertTimeline({ name: "t", length: 10, layers: [mv] }, { keys: { "0": { props: ["a"], anchors: [[0,0],[5,8],[10,10]] } }, values: { "0:5": { props: ["a"], frame: 5, v: { alpha: 0.5 } } } });
assert.equal(t2.layers[0].frames[1].i, 8); assert.equal(t2.layers[0].frames[1].elements[0].alpha, 0.5);
// layers: order, rename, switch off, delete, folders, duplicates (a duplicate takes its own key/value edits)
const lay = (name, tx, parent = null) => ({ name, type: "normal", parent, hidden: false, frames: [{ i: 0, d: 10, elements: [named(name, [1,0,0,1,tx,0], [0,0])] }] });
const base = { name: "t", length: 10, layers: [lay("a", 0), lay("b", 10), lay("c", 20)] };
let r = g.convertSymbol(base, { layers: { order: [2, 0, 1], names: { "1": "bee" }, hidden: [0], deleted: [2], extras: [{ id: 1000, name: "Folder 1", type: "folder" }], parents: { "0": 1000, "1": 1000 } } });
assert.equal(r.timeline.layers.length, 3, "deleted layer is gone, the folder is added");
assert.deepEqual(r.timeline.layers.map((l) => l.name), ["a", "bee", "Folder 1"], "a saved order puts unlisted layers after it, as the old list did");
assert.ok(r.timeline.layers.find((l) => l.name === "a").off, "hidden layer is switched off");
assert.equal(r.timeline.layers[r.timeline.layers.find((l) => l.name === "a").parent].name, "Folder 1", "parent follows the new position");
let dup = g.convertSymbol(base, { layers: { clones: [{ of: 1, prop: "cbdup1" }] }, values: { "3:0": { props: ["cbdup1"], frame: 0, v: { x: 77 } } } });
assert.equal(dup.timeline.layers.length, 4); assert.equal(dup.timeline.layers[3].name, "b copy");
assert.equal(dup.timeline.layers[3].frames[0].elements[0].m[4], 77, "the copy takes its own value edit"); assert.equal(dup.timeline.layers[1].frames[0].elements[0].m[4], 10, "the original does not");
// a layer built from a picture/part (prepared) takes its values by its clone name, and a duplicate of it copies it
const prep = [{ name: "Head", type: "normal", parent: null, hidden: false, frames: [{ i: 0, d: 10, elements: [{ k: "bitmap", item: "pic", name: "cbnew1", m: [1,0,0,1,0,0] }] }] }];
let built = g.convertSymbol(base, { layers: { clones: [{ of: -1, prop: "cbnew1", image: {} }, { of: 3, prop: "cbdup2" }] }, values: { "3:0": { props: ["cbnew1"], frame: 0, v: { x: 50, y: 60, regX: 5, regY: 5 } }, "4:0": { props: ["cbdup2"], frame: 0, v: { x: 90, y: 60 } } } }, prep);
assert.equal(built.timeline.layers.length, 5);
assert.deepEqual(built.timeline.layers[3].frames[0].elements[0].m.slice(4), [45, 55], "a picture's registration point is folded into its matrix");
const loc = [0.5,0,0,0.5,-10,-20]; const withLocal = [{ ...prep[0], frames: [{ i: 0, d: 10, elements: [{ k: "bitmap", item: "pic", name: "cbnew1", local: loc, m: [0.5,0,0,0.5,100-10,100-20] }] }] }];
const lb = g.convertSymbol(base, { layers: { clones: [{ of: -1, prop: "cbnew1", image: {} }] }, values: { "3:0": { props: ["cbnew1"], frame: 0, v: { x: 30, y: 40, regX: 0, regY: 0 } } } }, withLocal);
assert.deepEqual(lb.timeline.layers[3].frames[0].elements[0].m.slice(4), [30 - 10, 40 - 20], "the container moves, the picture stays centred in it");
assert.equal(built.timeline.layers[4].frames[0].elements[0].name, "cbdup2"); assert.equal(built.timeline.layers[4].frames[0].elements[0].m[4], 90, "the duplicate of a built layer is its own copy");
let foreign = g.convertSymbol(base, { layers: { clones: [{ of: -1, prop: "cbnew1", symbol: "Headcopy", foreign: { lib: "x", scale: 1, frame: 0 } }] } });
assert.equal(foreign.timeline, null); assert.ok(foreign.unsupported[0].includes("another character"));
console.log("legacy tests passed");
