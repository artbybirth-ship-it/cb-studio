const assert = require("assert");
const { shownFrames: shown0, grownTweens, madeTween, grownBlanks } = require("./symbolKeys.js");
const shownFrames = (l, a, t) => shown0(l, a, t && Array.isArray(t) ? { tweens: t } : t);
const layer = { name: "Head", type: "normal", props: ["a"], frames: [{ i: 0, d: 30, symbols: [{ name: "Head" }] }] };
const anchors = [[0, 0], [10, 10], [30, 30]];
let shown = shownFrames(layer, anchors, [[0, 40]]);
assert.strictEqual(shown[0].tween, "classic"); assert.strictEqual(shown[0].made, true); assert.strictEqual(shown[0].ease, -40);
assert.ok(!shown[1].tween, "the last span has no keyframe to tween to");
assert.ok(!shownFrames(layer, anchors)[0].tween, "no tweens: holds");
assert.strictEqual(madeTween([[0, 0], [30, 30]], 0, [[0, 0]]), undefined, "the end of the layer is not a keyframe");
const grown = [[0, 0], [5, 5], [10, 10], [30, 30]];
assert.deepStrictEqual(grownTweens(anchors, grown, [[0, 40]]), [[0, 40], [5, 40]], "a keyframe inside a tween splits it");
assert.deepStrictEqual(grownTweens(anchors, [[0, 0], [10, 10], [20, 20], [30, 30]], [[0, 40]]), [[0, 40]], "one in a hold does not");
shown = shownFrames(layer, anchors, { blanks: [10] });
assert.strictEqual(shown[1].blank, true, "a blank keyframe shows nothing"); assert.ok(!shown[1].symbols);
assert.ok(!shown[0].blank);
assert.deepStrictEqual(grownBlanks(anchors, [[0, 0], [10, 10], [20, 20], [30, 30]], [10]), [10, 20], "a keyframe inside a blank span is blank");
assert.deepStrictEqual(grownBlanks(anchors, [[0, 0], [5, 5], [10, 10], [30, 30]], [10]), [10], "one before it is not");
// frames removed from a layer's end: spans from the cut on are gone and the one crossing it is shortened
shown = shownFrames(layer, [[0, 0], [10, 10], [20, 20], [30, 30]], { cut: 15 });
assert.deepStrictEqual(shown.map((x) => [x.i, x.d]), [[0, 10], [10, 5]], "cut at 15");
// a pasted layer's frames cut short (clone `end`) are not drawn
const ended = { ...layer, frames: [{ i: 0, d: 20, symbols: [{ name: "Head" }] }, { i: 20, d: 10, blank: true, ended: true }] };
assert.deepStrictEqual(shownFrames(ended, [[0, 0], [20, 20], [30, 30]]).map((x) => [x.i, x.d]), [[0, 20]]);
console.log("keys tween ok");
