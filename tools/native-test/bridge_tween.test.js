// Runs the bridge's made-tween code (applyMadeTweens) against mock tween steps shaped like a pasted layer's: a head, a hold,
// and the zero + hold pairs the player's splitSteps leaves at each added keyframe.
const fs = require("fs"), vm = require("vm"), assert = require("assert"), path = require("path");
const src = fs.readFileSync(path.join(__dirname, "../../frontend/public/vendor/cb-animate-bridge.js"), "utf8");
const a = src.indexOf("var cbTweenSteps = [], cbBlankProps = [];"), b = src.indexOf("function applySymbolEdits");
assert.ok(a > 0 && b > a, "markers found");
class Step { constructor(prev, t, d, props) { this.prev = prev; this.t = t; this.d = d; this.props = props; this.ease = null; } }
const mk = (spec) => { // spec: [[t, d, props|"same"], …]
  const head = new Step(null, 0, 0, null); let prev = head, tail = head;
  spec.forEach(([t, d, props]) => { const s = new Step(prev, t, d, props === "same" ? prev.props : props); prev.next = s; prev = s; });
  return head;
};
const run = (spec, edit, entries) => {
  const A = { x: 0, y: 0, alpha: 1 }, B = { x: 100, y: 40, alpha: 1 }, C = { x: 100, y: 40, alpha: 1 };
  // frames: 0 key A, 10 key B, 20 key C (added keys), layer ends at 30
  const head = mk([[0, 0, A], [0, 10, "same"], [10, 0, B], [10, 10, "same"], [20, 0, C], [20, 10, "same"]]);
  const obj = { x: 0, y: 0 }, clip = { timeline: { tweens: [{ target: obj, _stepHead: head }] }, pic: obj };
  const touched = new Set(), cbValueSteps = [];
  const ctx = { VALUE_KEYS: ["x", "y", "scaleX", "scaleY", "skewX", "skewY", "alpha", "regX", "regY"], cbValueSteps, createjs: { Ease: { get: (v) => ({ amount: v }) } },
    tweensFor: (c) => c.timeline.tweens, edit, clip, touched, entries, out: {} };
  vm.runInNewContext(src.slice(a, b) + "\nif (edit.blanks) applyBlanks(clip, edit, touched);\napplyMadeTweens(clip, edit, entries, touched); out.cbTweenSteps = cbTweenSteps; out.cbBlankProps = cbBlankProps;", ctx);
  const steps = []; for (let s = head.next; s; s = s.next) steps.push(s);
  return { steps, A, B, C, ctx };
};
const base = { props: ["pic"], anchors: [[0, 0], [10, 10], [20, 20], [30, 30]] };

// one tween A→B with an ease out 50: the hold before B ends on B's values
let r = run(0, { ...base, tweens: [[0, 50]] }, {});
assert.strictEqual(r.steps[1].props, r.B, "span 0–10 now moves to B's values");
assert.deepStrictEqual(r.steps[1].ease, { amount: 0.5 });
assert.strictEqual(r.steps[3].props, r.B, "span 10–20 still holds");
assert.strictEqual(r.ctx.out.cbTweenSteps.length, 1);
r.ctx.out.cbTweenSteps.reverse().forEach((x) => { x.step.props = x.props; x.step.ease = x.ease; });
assert.strictEqual(r.steps[1].props, r.A, "undone: back to a hold");

// no tweens → nothing touched
r = run(0, base, {});
assert.strictEqual(r.ctx.out.cbTweenSteps.length, 0);

// a run A→B→C with B untouched: B takes the tweened value between A and C, and both spans tween
r = run(0, { ...base, tweens: [[0, 0], [10, 0]] }, {});
assert.ok(Math.abs(r.B.x - 50) < 1e-9, `B inherits the midway x (${r.B.x})`);
assert.strictEqual(r.steps[1].props, r.B);
assert.strictEqual(r.steps[3].props, r.C);

// the same run with B given its own x: it keeps it (y still comes from the tween)
r = run(0, { ...base, tweens: [[0, 0], [10, 0]] }, { "1:10": { props: ["pic"], frame: 10, v: { x: 70 } } });
r = run(0, { ...base, tweens: [[0, 0], [10, 0]] }, { "1:10": { props: ["pic"], frame: 10, v: { x: 70 } } });
assert.strictEqual(r.B.x, 100, "mock B starts at 100; explicit x is not overwritten by the tween");
assert.ok(Math.abs(r.B.y - 20) < 1e-9, `y was not edited so it follows the tween (${r.B.y})`);
// a blank keyframe at B (file frame 10), with a keyframe at C again: the object is hidden from 10 up to 20 only
r = run(0, { ...base, blanks: [10] }, {});
const off = (st) => st.props._off;
assert.strictEqual(off(r.steps[0]), false, "frame 0: shown");
assert.strictEqual(off(r.steps[1]), false, "hold before the blank keyframe: shown");
assert.strictEqual(off(r.steps[2]), true, "the blank keyframe hides");
assert.strictEqual(off(r.steps[3]), true, "and so does its hold");
assert.strictEqual(off(r.steps[4]), false, "the next keyframe shows again");
assert.strictEqual(off(r.steps[5]), false);
r.ctx.out.cbBlankProps.reverse().forEach((x) => { if (x.had) x.props._off = x.old; else delete x.props._off; });
assert.ok(!("_off" in r.steps[2].props), "undone: nothing left on the values");
// blank on the last keyframe: hidden to the end of the layer
r = run(0, { ...base, blanks: [20] }, {});
assert.strictEqual(off(r.steps[3]), false); assert.strictEqual(off(r.steps[4]), true); assert.strictEqual(off(r.steps[5]), true);
console.log("bridge tween ok");
