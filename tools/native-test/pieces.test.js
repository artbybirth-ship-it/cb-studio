const assert = require("assert");
const pc = require("./native/pieces.js");
const I = [1, 0, 0, 1, 0, 0];
const fill = (color) => ({ t: "solid", color, alpha: 1 });
const shape = (color, tx = 0) => ({ k: "shape", m: [1, 0, 0, 1, tx, 0], fills: [{ style: fill(color), paths: [] }], strokes: [], fillStyles: {}, strokeStyles: {} });
const layer = (name, shapes) => ({ name, type: "normal", parent: null, hidden: false, frames: [{ i: 0, d: 10, elements: shapes }] });
// layer A (top): red, green, blue; layer B: black, white
const tl = { name: "T", length: 10, layers: [layer("A", [shape("#FF0000"), shape("#00FF00"), shape("#0000FF")]), layer("B", [shape("#000000"), shape("#FFFFFF")])] };
const colours = (t, order) => pc.piecesOf(t, order).map((s) => pc.coloursOfShape(t.layers[s.layer].frames[s.key].elements[s.el])[0]);
assert.deepEqual(colours(tl, "forward"), ["#FF0000", "#00FF00", "#0000FF", "#000000", "#FFFFFF"], "layers from the top, shapes forward");
assert.deepEqual(colours(tl, "reverse"), ["#0000FF", "#00FF00", "#FF0000", "#FFFFFF", "#000000"], "layers from the top, each layer's shapes reversed");
assert.equal(pc.pieceName(0), "shape"); assert.equal(pc.pieceName(7), "shape_7");
assert.equal(pc.pieceNumber("shape"), 0); assert.equal(pc.pieceNumber("shape_12"), 12); assert.equal(pc.pieceNumber("instance_1"), null);

// an export's script: the shapes and their first colours, class by class
const js = `(lib.Sym = function(mode,startPosition,loop,reversed) {
	this.shape_2 = new cjs.Shape();
	this.shape_2.graphics.f("#0000FF").s().p("AAA");
	this.shape_3 = new cjs.Shape();
	this.shape_3.graphics.f().s("#00FF00").ss(1).p("AAA");
	this.shape_4 = new cjs.Shape();
	this.shape_4.graphics.f("#FF0000").s().p("AAA");
	this.shape_5 = new cjs.Shape();
	this.shape_5.graphics.f("#FFFFFF").s().p("AAA");
	this.shape_6 = new cjs.Shape();
	this.shape_6.graphics.f("#000000").s().p("AAA");
}).prototype = p = new cjs.MovieClip();`;
const shapes = pc.playerShapes(js).get("Sym");
assert.equal(shapes.length, 5); assert.deepEqual(shapes.map((s) => s.colour), ["#0000FF", "#00FF00", "#FF0000", "#FFFFFF", "#000000"], "a stroke-only shape gives its stroke colour");
const doc = pc.numberingOf(js, (cls) => (cls === "Sym" ? tl : null));
assert.equal(doc.order, "reverse", "the export's colours sit where the reversed numbering puts them");
assert.equal(doc.bases.get("Sym"), 2, "the first number is not always 0");

// piece edits: shape_2 is the first piece in the reversed order (the blue one: base 2)
const numbering = { order: "reverse", base: 2 };
const gone = pc.applyPieceEdits(tl, { deleted: ["shape_2", "shape_5"] }, numbering);
assert.deepEqual(gone.lost, []);
assert.deepEqual(gone.timeline.layers[0].frames[0].elements.map((e) => e.fills[0].style.color), ["#FF0000", "#00FF00"], "the blue piece of layer A is gone");
assert.deepEqual(gone.timeline.layers[1].frames[0].elements.map((e) => e.fills[0].style.color), ["#000000"], "and the white one of layer B");
assert.strictEqual(tl.layers[0].frames[0].elements.length, 3, "the input is not changed");
const done = new Set();
const moved = pc.applyPieceEdits(tl, { values: { "0:0:shape_4": { props: ["shape_4"], frame: 0, v: { x: 50, y: 60 } } } }, numbering, done);
assert.deepEqual(moved.lost, []); assert.ok(done.has("0:0:shape_4"));
assert.deepEqual(moved.timeline.layers[0].frames[0].elements[0].m.slice(4), [50, 60], "the red piece moved (shape_4: third in reversed order = first of layer A)");
assert.deepEqual(moved.timeline.layers[0].frames[0].elements[1].m, [1, 0, 0, 1, 0, 0], "the others stayed");
// a piece that is not where the edit says it is (another layer) is not guessed
assert.equal(pc.applyPieceEdits(tl, { values: { "1:0:shape_4": { props: ["shape_4"], frame: 0, v: { x: 1 } } } }, numbering).lost.length, 1);
assert.equal(pc.applyPieceEdits(tl, { deleted: ["shape_99"] }, numbering).lost.length, 1, "no such piece");
// without a numbering nothing is guessed
const none = pc.applyPieceEdits(tl, { deleted: ["shape"] }, null);
assert.equal(none.timeline, tl); assert.equal(none.lost.length, 1);
console.log("pieces ok");
