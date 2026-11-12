const assert = require("assert");
const o = require("./native/ops.js");
const I = [1,0,0,1,0,0];
const inst = (tx) => ({ k: "instance", item: "A", symbolType: "graphic", m: [1,0,0,1,tx,0], pivot: [0,0], loop: "loop", first: 0 });
const L = (frames) => ({ name: "l", type: "normal", parent: null, hidden: false, frames });
const spans = (l) => l.frames.map((k) => `${k.i}+${k.d}${k.tween ? "t" : ""}`).join(" ");
let l = L([{ i: 0, d: 10, elements: [inst(0)] }]);
// F6 in the middle of a hold
let a = o.insertKeyframe(l, 4); assert.equal(spans(a), "0+4 4+6"); assert.notStrictEqual(a, l); assert.equal(spans(l), "0+10");
assert.equal(o.insertKeyframe(a, 4), a, "F6 on a key is a no-op");
// F6 on a tween captures the tweened position
let t = L([{ i: 0, d: 10, elements: [inst(0)], tween: "motion" }, { i: 10, d: 1, elements: [inst(100)] }]);
let tf = o.insertKeyframe(t, 5); assert.equal(spans(tf), "0+5t 5+5t 10+1");
assert.ok(Math.abs(tf.frames[1].elements[0].m[4] - 50) < 1e-6, "tweened x");
// F6 past the end repeats the last key
let pe = o.insertKeyframe(l, 14); assert.equal(spans(pe), "0+14 14+1"); assert.equal(pe.frames[1].elements.length, 1);
// F5 then remove frames
let f5 = o.insertFrames(a, 2, 3); assert.equal(spans(f5), "0+7 7+6");
let rm = o.removeFrames(f5, 2, 4); assert.equal(spans(rm), "0+4 4+6");
let rm2 = o.removeFrames(a, 3, 5); assert.equal(spans(rm2), "0+3 3+4", spans(rm2));
let rm3 = o.removeFrames(l, 6, 9); assert.equal(spans(rm3), "0+6");
// remove a whole key
let rm4 = o.removeFrames(a, 4, 9); assert.equal(spans(rm4), "0+4");
// Remove frames deleting a tween's end key stops the tween
let rt = o.removeFrames(t, 10, 10); assert.equal(spans(rt), "0+10");
// Clear keyframe merges into previous
assert.equal(spans(o.clearKeyframe(a, 4)), "0+10");
// Move keyframe
assert.equal(spans(o.moveKeyframe(a, 4, 7)), "0+7 7+6");
// setMatrix on a tween frame makes a key
let sm = o.setMatrix(t, 5, 0, [1,0,0,1,77,0]); assert.equal(spans(sm), "0+5t 5+5t 10+1"); assert.equal(sm.frames[1].elements[0].m[4], 77);
// editing mid-span on a held layer changes the span's own key (no split), as in Animate
let held = o.setMatrix(l, 5, 0, [1,0,0,1,9,0]); assert.equal(spans(held), "0+10"); assert.equal(held.frames[0].elements[0].m[4], 9);
// blank keyframe
let bk = o.insertBlankKeyframe(l, 3); assert.equal(bk.frames[1].elements.length, 0);
// history
let h = o.history(l); h = o.commit(h, a); h = o.commit(h, f5); h = o.undo(h); assert.equal(h.present, a); h = o.redo(h); assert.equal(h.present, f5);
// ---- shape tweens
const sq = (x, y, w, c) => ({ k: "shape", m: [1,0,0,1,0,0], fillStyles: { 1: { t: "solid", color: c, alpha: 1 } }, strokeStyles: {}, strokes: [],
  fills: [{ style: { t: "solid", color: c, alpha: 1 }, paths: [[["M", x, y], ["L", x + w, y], ["L", x + w, y + w], ["L", x, y + w], ["L", x, y]]] }] });
const box = (els) => { let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; for (const e of els) for (const f of e.fills) for (const p of f.paths) for (const c of p) { const [px, py] = c.slice(-2); x0 = Math.min(x0, px); y0 = Math.min(y0, py); x1 = Math.max(x1, px); y1 = Math.max(y1, py); } return [x0, y0, x1, y1]; };
let st = L([{ i: 0, d: 10, elements: [sq(0, 0, 100, "#FF0000")] }, { i: 10, d: 1, elements: [sq(200, 0, 50, "#0000FF")] }]);
st = o.setTween(st, 0, "shape");
assert.ok(st.frames[0].morph && st.frames[0].morph.length === 1, "morph computed on setTween");
const seg = st.frames[0].morph[0];
assert.equal(seg.curves.length, 4); assert.deepEqual([seg.f1, seg.f2], [0, 0]);
// the morph's two ends are the two squares' outlines
const ends = (seg) => [seg.curves.map((c) => [c[3], c[4]]), seg.curves.map((c) => [c[7], c[8]])];
const [ea, eb] = ends(seg);
assert.ok(Math.min(...ea.map((p) => p[0])) === 0 && Math.max(...ea.map((p) => p[0])) === 100);
assert.ok(Math.min(...eb.map((p) => p[0])) === 200 && Math.max(...eb.map((p) => p[0])) === 250);
// F6 in the middle of the tween captures the tweened artwork, and both halves still tween
let sf = o.insertKeyframe(st, 5); assert.equal(spans(sf), "0+5 5+5 10+1".replace("0+5", "0+5t").replace("5+5", "5+5t"));
const mid = box(sf.frames[1].elements); assert.ok(mid[0] > 0 && mid[0] < 200 && mid[2] > 100 && mid[2] < 250, "mid box " + mid);
assert.ok(sf.frames[0].morph && sf.frames[1].morph, "both halves re-matched");
// editing the end key re-matches the tween into it
let se = o.setMatrix(st, 10, 0, [2, 0, 0, 2, 0, 0]); assert.ok(se.frames[0].morph, "re-matched after edit");
assert.notDeepEqual(se.frames[0].morph, st.frames[0].morph);
// unequal outlines: 4 corners vs a 6-sided shape get the same count
const hex = { k: "shape", m: [1,0,0,1,0,0], fillStyles: { 1: { t: "solid", color: "#00FF00", alpha: 1 } }, strokeStyles: {}, strokes: [], fills: [{ style: { t: "solid", color: "#00FF00", alpha: 1 }, paths: [[["M", 0, 0], ["L", 10, 0], ["L", 15, 8], ["L", 10, 16], ["L", 0, 16], ["L", -5, 8], ["L", 0, 0]]] }] };
let hx = o.setTween(L([{ i: 0, d: 4, elements: [sq(0, 0, 20, "#00FF00")] }, { i: 4, d: 1, elements: [hex] }]), 0, "shape");
assert.equal(hx.frames[0].morph[0].curves.length, 6);
// an outline with no partner shrinks to its centre
let two = o.setTween(L([{ i: 0, d: 4, elements: [sq(0, 0, 20, "#00FF00"), sq(100, 0, 20, "#00FF00")] }, { i: 4, d: 1, elements: [sq(0, 0, 20, "#00FF00")] }]), 0, "shape");
assert.equal(two.frames[0].morph.length, 2);
console.log("ops: all assertions passed");
