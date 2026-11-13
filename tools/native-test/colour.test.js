// Phase 4c: the native colour rules (lib/native/colour.ts) behave like the Animate player's.
const assert = require("assert");
const c = require("./native/colour.js");
const rules = (list) => c.prepareRules(list);
const solid = (color, alpha = 1) => ({ t: "solid", color, alpha });

// exact: only that colour; the original is never changed
const exact = rules([{ from: "#ff0000", to: "#00ff00" }]);
const red = solid("#ff0000", 0.5);
assert.deepEqual(c.recolourFill(red, exact, false), { t: "solid", color: "#00ff00", alpha: 0.5 }, "colour swapped, alpha kept");
assert.equal(red.color, "#ff0000", "input not changed");
const other = solid("#fe0000");
assert.equal(c.recolourFill(other, exact, false), other, "a near colour is not touched by an exact rule (same object back)");
assert.equal(c.recolourFill(red, [], false), red, "no rules: same object");

// target: fill-only / stroke-only
const fillOnly = rules([{ from: "#ff0000", to: "#0000ff", target: "fill" }]);
assert.equal(c.recolourFill(red, fillOnly, true), red, "a fill rule leaves strokes");
assert.equal(c.recolourFill(red, fillOnly, false).color, "#0000ff");
const strokeOnly = rules([{ from: "#ff0000", to: "#0000ff", target: "stroke" }]);
assert.equal(c.recolourFill(red, strokeOnly, false), red, "a stroke rule leaves fills");
assert.equal(c.recolourStroke({ w: 1, caps: "round", joints: "round", miter: 3, scale: "normal", fill: red }, strokeOnly).fill.color, "#0000ff");

// rules never chain: red -> green and green -> blue leaves red as green
const chain = rules([{ from: "#ff0000", to: "#00ff00" }, { from: "#00ff00", to: "#0000ff" }]);
assert.equal(c.recolourFill(red, chain, false).color, "#00ff00", "rules do not chain");

// shades: the family moves with it (a darker red becomes a darker green), other hues stay
const shades = rules([{ from: "#ff0000", to: "#00ff00", match: "shades" }]);
const darkRed = c.recolourFill(solid("#cc0000"), shades, false);
const g = c.parseColour(darkRed.color);
assert.ok(g.g > g.r + 80 && g.r < 40 && g.b < 40, "a darker red becomes a darker green: " + darkRed.color);
assert.equal(c.recolourFill(solid("#0000ff"), shades, false).color, "#0000ff", "a blue is not in red's family");
// exact wins over shades for the same colour
const both = rules([{ from: "#ff0000", to: "#00ff00", match: "shades" }, { from: "#ff0000", to: "#ffffff" }]);
assert.equal(c.recolourFill(red, both, false).color, "#ffffff", "exact beats shades");

// gradients: every stop goes through the rules
const grad = { t: "linear", m: [1, 0, 0, 1, 0, 0], focal: 0, stops: [[0, "#ff0000", 1], [1, "#0000ff", 1]] };
const gr = c.recolourFill(grad, exact, false);
assert.deepEqual(gr.stops, [[0, "#00ff00", 1], [1, "#0000ff", 1]]);
assert.equal(grad.stops[0][1], "#ff0000", "input not changed");

// scope: whole-character rules, and rules for the part a shape is inside
const scoped = rules([{ from: "#ff0000", to: "#111111", scope: "head" }, { from: "#ff0000", to: "#222222", scope: "*" }]);
assert.equal(c.rulesAt(scoped, "").length, 1, "outside any part only the whole-character rule");
assert.equal(c.rulesAt(scoped, "body/head").length, 1, "a part name that is not at the start does not match");
assert.equal(c.rulesAt(scoped, "head").length, 2);
assert.equal(c.rulesAt(scoped, "head/eye").length, 2, "inside a part's children");
assert.equal(c.recolourFill(red, c.rulesAt(scoped, "head"), false).color, "#111111", "the part's own rule wins over the whole-character one");

// junk is ignored
assert.deepEqual(rules([{ from: "nope", to: "#fff" }, { from: "#fff", to: "x" }]), []);
console.log("colour ok");
