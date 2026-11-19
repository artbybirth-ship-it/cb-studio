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
// (as Animate: the frames left join the span before; the key shows until the next keyframe; keys after it stay)
assert.equal(spans(o.moveKeyframe(a, 4, 7)), "0+7 7+3", "later, inside its own span");
assert.equal(spans(o.moveKeyframe(a, 4, 2)), "0+2 2+8", "earlier: it shows up to the next keyframe (the layer's end)");
{
  const three = L([{ i: 0, d: 4, elements: [inst(0)] }, { i: 4, d: 4, elements: [inst(1)] }, { i: 8, d: 4, elements: [inst(2)] }]);
  assert.equal(spans(o.moveKeyframe(three, 4, 5)), "0+5 5+3 8+4", "one frame later: the next key stays");
  assert.equal(spans(o.moveKeyframe(three, 4, 9)), "0+8 8+1 9+3", "over the next key: cuts its span");
  assert.equal(spans(o.moveKeyframe(three, 4, 8)), "0+8 8+4", "onto the next key: replaces it");
  assert.equal(o.moveKeyframe(three, 4, 8).frames[1].elements[0].m[4], 1, "...with the moved key's content");
  assert.equal(spans(o.moveKeyframe(three, 0, 2)), "2+2 4+4 8+4", "the first key moved later leaves empty frames");
  assert.equal(spans(o.moveKeyframe(three, 8, 15)), "0+4 4+8 15+4", "past the end: keeps its length, the span before carries on");
  const tw = L([{ i: 0, d: 4, elements: [inst(0)], tween: "motion" }, { i: 4, d: 4, elements: [inst(10)] }, { i: 8, d: 2, elements: [inst(20)] }]);
  assert.equal(spans(o.moveKeyframe(tw, 4, 6)), "0+6t 6+2 8+2", "the tween before now runs to where the key went");
}
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
// unequal outlines: 4 corners vs a 6-sided shape are cut at each other's corners (as Animate does: between the longer count and a + b − 1)
const hex = { k: "shape", m: [1,0,0,1,0,0], fillStyles: { 1: { t: "solid", color: "#00FF00", alpha: 1 } }, strokeStyles: {}, strokes: [], fills: [{ style: { t: "solid", color: "#00FF00", alpha: 1 }, paths: [[["M", 0, 0], ["L", 10, 0], ["L", 15, 8], ["L", 10, 16], ["L", 0, 16], ["L", -5, 8], ["L", 0, 0]]] }] };
let hx = o.setTween(L([{ i: 0, d: 4, elements: [sq(0, 0, 20, "#00FF00")] }, { i: 4, d: 1, elements: [hex] }]), 0, "shape");
assert.ok(hx.frames[0].morph[0].curves.length >= 6 && hx.frames[0].morph[0].curves.length <= 9, "cut at each other's corners: " + hx.frames[0].morph[0].curves.length);
// an outline with no partner shrinks to its centre
let two = o.setTween(L([{ i: 0, d: 4, elements: [sq(0, 0, 20, "#00FF00"), sq(100, 0, 20, "#00FF00")] }, { i: 4, d: 1, elements: [sq(0, 0, 20, "#00FF00")] }]), 0, "shape");
assert.equal(two.frames[0].morph.length, 2);
console.log("ops: all assertions passed");

// Phase 4a: the eye and Delete layer
{
  const mk = (name, parent) => ({ name, type: "normal", parent, hidden: false, frames: [{ i: 0, d: 5, elements: [inst(0)] }] });
  const base = mk("a", null);
  const off = o.setLayerOff(base, true);
  assert.equal(off.off, true); assert.notStrictEqual(off, base); assert.ok(!base.off, "input not changed");
  assert.equal(o.setLayerOff(base, false), base, "already visible is a no-op");
  assert.equal(o.setLayerOff(off, true), off, "already off is a no-op");
  assert.equal(o.setLayerOff(off, false).off, false);
  // delete: parents are renumbered, and a deleted folder's children move up
  const ls = [mk("top", null), mk("folder", null), mk("in-folder", 1), mk("after", null), mk("in-folder2", 1)];
  const d1 = o.deleteLayers(ls, [0]);
  assert.deepEqual(d1.map((l) => l.name + ":" + l.parent), ["folder:null", "in-folder:0", "after:null", "in-folder2:0"], "renumbered");
  const d2 = o.deleteLayers(ls, [1]);
  assert.deepEqual(d2.map((l) => l.name + ":" + l.parent), ["top:null", "in-folder:null", "after:null", "in-folder2:null"], "children of a deleted folder move up");
  const d3 = o.deleteLayers(ls, [2, 4]);
  assert.deepEqual(d3.map((l) => l.name), ["top", "folder", "after"]);
  assert.equal(o.deleteLayers(ls, []), ls, "nothing to delete returns the same list");
  assert.equal(o.deleteLayers(ls, [99]), ls, "out of range ignored");
  assert.equal(ls.length, 5, "input not changed");
  const nested = [mk("f1", null), mk("f2", 0), mk("leaf", 1)];
  assert.deepEqual(o.deleteLayers(nested, [1]).map((l) => l.name + ":" + l.parent), ["f1:null", "leaf:0"], "grandchild lands in the grandparent");
  console.log("layer eye and delete ok");
}

// Phase 4b: swap symbol
{
  const ins = (item, m) => ({ k: "instance", item, symbolType: "graphic", m, pivot: [1, 2], loop: "loop", first: 0, name: "n" });
  const layer = { name: "mouth", type: "normal", parent: null, hidden: false, frames: [
    { i: 0, d: 3, elements: [ins("Mouth_A", [1, 0, 0, 1, 10, 20]), ins("Other", [1, 0, 0, 1, 0, 0])], tween: "motion" },
    { i: 3, d: 3, elements: [ins("Mouth_A", [0, 1, -1, 0, 30, 40])] },
    { i: 6, d: 2, elements: [ins("Different", [1, 0, 0, 1, 5, 5])] },
  ] };
  const to = { k: "instance", item: "Pasted from X/Mouth_B", symbolType: "movie clip", m: [9, 9, 9, 9, 9, 9], pivot: [7, 8], loop: "loop", first: 0 };
  const out = o.swapSymbol(layer, "Mouth_A", to, 2);
  assert.deepEqual(out.frames[0].elements.map((e) => e.item), ["Pasted from X/Mouth_B", "Other"], "only the matching instance changes");
  assert.deepEqual(out.frames[0].elements[0].m, [2, 0, 0, 2, 10, 20], "position kept, size scaled");
  assert.deepEqual(out.frames[1].elements[0].m, [0, 2, -2, 0, 30, 40], "rotation kept, every keyframe swapped");
  assert.equal(out.frames[0].elements[0].symbolType, "movie clip");
  assert.deepEqual(out.frames[0].elements[0].pivot, [7, 8]);
  assert.equal(out.frames[0].elements[0].name, "n", "instance name kept");
  assert.equal(out.frames[0].tween, "motion", "tween kept");
  assert.equal(out.frames[2].elements[0].item, "Different", "other symbols untouched");
  assert.equal(layer.frames[0].elements[0].item, "Mouth_A", "input not changed");
  assert.equal(o.swapSymbol(layer, "Nothing", to), layer, "no match returns the same layer");
  console.log("swap symbol ok");
}

// insert layer: above the picked layer, in its folder; parents below shift
{
  const named = (name, type = "normal", parent = null) => ({ name, type, parent, hidden: false, frames: [] });
  // 0 top, 1 folder, 2 in folder, 3 mask, 4 masked by 3
  const layers = [named("top"), named("F", "folder"), named("inF", "normal", 1), named("M", "mask"), named("under", "normal", 3)];
  const fresh = named("new");
  const a = o.insertLayer(layers, 2, fresh);
  assert.deepEqual(a.map((l) => l.name), ["top", "F", "new", "inF", "M", "under"], "above the picked layer");
  assert.equal(a[2].parent, 1, "in the picked layer's folder");
  assert.equal(a[3].parent, 1, "folder above keeps its index");
  assert.equal(a[5].parent, 4, "masked layer follows its mask down");
  const b = o.insertLayer(layers, 3, fresh);
  assert.equal(b[3].parent, null, "a mask is not a folder: the new layer is not masked");
  assert.equal(b[5].parent, 4, "masked layer still points at its mask");
  assert.equal(o.insertLayer(layers, 0, fresh)[0].name, "new", "on top");
  assert.equal(o.insertLayer(layers, 99, fresh)[5].name, "new", "past the end: at the bottom");
  assert.equal(layers[4].parent, 3, "input not changed");
  console.log("insert layer ok");
}

// rename, lock, duplicate layers
{
  const named = (name, type = "normal", parent = null) => ({ name, type, parent, hidden: false, frames: [{ i: 0, d: 2, elements: [inst(5)] }] });
  const layers = [named("top"), named("M", "mask"), named("under", "normal", 1), named("F", "folder"), named("inF", "normal", 3)];
  const r = o.renameLayer(layers, 2, " Arm ");
  assert.equal(r[2].name, "Arm"); assert.equal(r[2].fileName, "under", "keeps its file name");
  assert.equal(o.renameLayer(r, 2, "Leg")[2].fileName, "under", "a second rename keeps the first file name");
  assert.equal(o.renameLayer(layers, 2, "  "), layers, "an empty name changes nothing");
  assert.equal(o.setLayerLocked(layers[0], true).locked, true);
  assert.equal(o.setLayerLocked(layers[0], false), layers[0], "unchanged: the same layer");
  const d = o.duplicateLayers(layers, [2, 4, 1, 3]);
  assert.deepEqual(d.layers.map((l) => l.name), ["top", "M", "under copy", "under", "F", "inF copy", "inF"], "copies above the originals; mask and folder not copied");
  assert.deepEqual(d.copies, [2, 5]);
  assert.equal(d.layers[2].parent, 1, "a copy under a mask stays under it");
  assert.equal(d.layers[5].parent, 4, "a copy in a folder stays in it (the folder moved down one)");
  assert.equal(d.layers[6].parent, 4);
  assert.equal(d.layers[2].fileName, "", "a copy is not a layer of the file");
  assert.notEqual(d.layers[2].frames, layers[2].frames, "the copy has its own keyframes");
  d.layers[2].frames[0].elements[0].m[4] = 99;
  assert.equal(layers[2].frames[0].elements[0].m[4], 5, "changing the copy leaves the original");
  console.log("rename / lock / duplicate layers ok");
}

// copy / cut / paste frames
{
  // a: hold 0-3 (x 0), tween 4-7 (x 40 -> 80), hold 8-9 (x 80)
  const layer = L([{ i: 0, d: 4, elements: [inst(0)] }, { i: 4, d: 4, elements: [inst(40)], tween: "motion" }, { i: 8, d: 2, elements: [inst(80)] }]);
  const x = (l, f) => o.resolveElements(l, f)[0]?.m[4];
  // copying the whole tween with its end key keeps the tween
  const whole = o.copyFrames(layer, 4, 8);
  assert.equal(whole.length, 5);
  assert.deepEqual(whole.frames.map((k) => [k.i, k.d, !!k.tween]), [[0, 4, true], [4, 1, false]]);
  // copying from the middle of the tween: starts with what shows there and ends as frame 7 looked (a tween between the two)
  const mid = o.copyFrames(layer, 5, 7);
  assert.deepEqual(mid.frames.map((k) => [k.i, k.d, !!k.tween]), [[0, 2, true], [2, 1, false]]);
  assert.equal(mid.frames[0].elements[0].m[4], 50, "the tweened state at the start");
  assert.equal(mid.frames[1].elements[0].m[4], 70, "the tweened state at the end");
  const midPasted = o.pasteFrames(L([{ i: 0, d: 20, elements: [inst(0)] }]), 10, mid);
  for (let k = 0; k < 3; k += 1) assert.equal(x(midPasted, 10 + k), x(layer, 5 + k), "a linear tween pastes exactly, frame " + k);
  // pasting the tween over frames 0-4: frames 0-4 replaced, 5 on shows as before
  const pasted = o.pasteFrames(layer, 0, whole);
  for (const f of [0, 2, 4]) assert.equal(x(pasted, f), x(layer, f + 4), "pasted frame " + f);
  for (const f of [5, 6, 7, 8, 9]) assert.equal(x(pasted, f), x(layer, f), "after the paste, frame " + f + " shows as before");
  // pasting a hold into the middle of the tween: the tween before now runs into the pasted key
  const held = o.pasteFrames(layer, 6, { length: 1, frames: [{ i: 0, d: 1, elements: [inst(500)] }] });
  assert.equal(x(held, 6), 500); assert.equal(x(held, 5), 40 + (500 - 40) / 2, "tween 4 -> 6 now ends at the pasted key");
  assert.equal(x(held, 7), x(layer, 7), "frame 7 shows as before");
  // pasting past the layer's end leaves a gap, then the frames
  const far = o.pasteFrames(layer, 12, mid);
  assert.equal(o.resolveElements(far, 11).length, 0, "gap");
  assert.equal(x(far, 12), 50);
  // cut: the frames empty, what follows unchanged
  const cut = o.cutFrames(layer, 1, 5);
  assert.equal(cut.clip.length, 5);
  assert.equal(o.resolveElements(cut.layer, 3).length, 0, "cut frames are empty");
  assert.equal(x(cut.layer, 0), 0); assert.equal(x(cut.layer, 6), x(layer, 6), "after the cut as before");
  assert.equal(layer.frames.length, 3, "input not changed");
  console.log("copy / paste frames ok");
}

// F6 in the middle of a span: nested symbols carry on from the frame they had reached
{
  const g = (loop) => ({ k: "instance", item: "G", symbolType: "graphic", m: [1,0,0,1,0,0], pivot: [0,0], loop, first: 2 });
  const mc = { k: "instance", item: "M", symbolType: "movie clip", m: [1,0,0,1,0,0], pivot: [0,0], loop: "loop", first: 0 };
  const layer = L([{ i: 0, d: 10, elements: [g("loop"), g("play once reverse"), g("single frame"), mc] }]);
  const split = o.insertKeyframe(layer, 4).frames[1].elements;
  assert.deepEqual(split.map((e) => e.first), [6, -2, 2, 0], "graphics: loop +4, reverse -4, single frame stays; a movie clip's first is left");
  assert.equal(split[3].carried, 4, "a movie clip carries on through its own field");
  // a movie clip's firstFrame from the file is ignored, as the player does
  assert.equal(require("./native/evaluate.js").innerFrame({ ...mc, first: 5 }, 2, 7), 2);
  const ev = require("./native/evaluate.js");
  for (let f = 4; f < 10; f += 1) for (let e = 0; e < 4; e += 1)
    assert.equal(ev.innerFrame(split[e], f - 4, 7), ev.innerFrame(layer.frames[0].elements[e], f, 7), `same inner frame at ${f} (element ${e})`);
  console.log("F6 carries nested animation on ok");
}
