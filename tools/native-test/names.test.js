// The player's names for unnamed instances (lib/native/names.ts), checked against a real published file too (see the numbering note there).
const assert = require("assert");
const n = require("./native/names.js");
const I = [1, 0, 0, 1, 0, 0];
const ins = (item) => ({ k: "instance", item, symbolType: "graphic", m: I, pivot: [0, 0], loop: "loop", first: 0 });
const L = (name, frames, type = "normal") => ({ name, type, parent: null, hidden: false, frames });
const tl = { name: "T", length: 10, layers: [
  L("a", [{ i: 0, d: 5, elements: [ins("X")] }, { i: 5, d: 5, elements: [ins("X")] }]),            // carries on: one instance
  L("folder", [], "folder"),                                                                          // folders have none
  L("b", [{ i: 0, d: 3, elements: [ins("X"), ins("Y")] }, { i: 3, d: 3, elements: [ins("X"), ins("Z")] }, { i: 8, d: 2, elements: [ins("X"), ins("Z")] }]), // second swaps symbol; a gap starts new ones
  L("a", [{ i: 0, d: 10, elements: [ins("Q")] }]),                                                    // repeated layer name
] };
const names = n.autoNames(tl);
const at = (layer, i, e) => n.autoNameAt(names, n.layerKey(tl.layers, layer), i, e);
assert.equal(at(0, 0, 0), "instance");
assert.equal(at(0, 5, 0), "instance", "the same symbol across keyframes keeps its name");
assert.equal(at(2, 0, 0), "instance_1");
assert.equal(at(2, 0, 1), "instance_2");
assert.equal(at(2, 3, 0), "instance_1", "first element carries on");
assert.equal(at(2, 3, 1), "instance_3", "a different symbol in the same slot is a new instance");
assert.equal(at(2, 8, 0), "instance_4", "after a gap it is a new instance");
assert.equal(at(3, 0, 0), "instance_6", "a repeated layer name is told apart by order");
assert.equal(at(3, 7, 0), "instance_6", "a later frame uses the keyframe at or before it (an F6 copy is the same instance)");
assert.equal(at(1, 0, 0), "", "folders have no instances");
assert.equal(n.autoNameAt(undefined, "x", 0, 0), "");
console.log("names ok");
