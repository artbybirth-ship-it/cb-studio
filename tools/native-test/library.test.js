const assert = require("assert");
const lib = require("./native/library.js");
const I = [1, 0, 0, 1, 0, 0];
const shapeWithBrush = (brush) => ({ k: "shape", m: I, fills: [], strokes: [{ style: { w: 1, caps: "round", joints: "round", miter: 3, scale: "normal", fill: { t: "solid", color: "#000000", alpha: 1 }, brush }, paths: [] }], fillStyles: {}, strokeStyles: { 1: { w: 1, caps: "round", joints: "round", miter: 3, scale: "normal", fill: { t: "solid", color: "#000000", alpha: 1 }, brush } } });
const inst = (item) => ({ k: "instance", item, symbolType: "movie clip", m: [2, 0, 0, 2, 10, 20], pivot: [0, 0], loop: "loop", first: 0 });
const tl = (elements, length = 3) => ({ name: "", length, layers: [{ name: "l", type: "normal", parent: null, hidden: false, frames: [{ i: 0, d: length, elements }] }] });
const sym = (name, elements, length) => ({ name, type: "movie clip", timeline: tl(elements, length), warnings: [] });
const doc = (name, symbols, extra = {}) => ({ name, width: 100, height: 100, fps: 24, background: "#fff", stage: tl([]), symbols: new Map(symbols.map((s) => [s.name, s])), brushes: {}, bitmaps: new Map(), binData: new Map(), warnings: [], ...extra });
const loaded = (d) => ({ doc: d, renderer: { assets: { images: new Map() }, loadBrushes: async () => {} } });

(async () => {
  // source: Head uses Mouth (talk loop, 8 frames) and a picture and a brush; Torso is unrelated
  const mouth = sym("Mouth", [{ k: "bitmap", item: "mouth.png", m: I }, shapeWithBrush("7")], 8);
  const head = sym("Rajkumar/Head", [inst("Mouth"), inst("Ghost")], 30);   // "Ghost" is not in the library
  const torso = sym("Torso", [], 1);
  const bitmaps = new Map([["mouth.png", { name: "mouth.png", width: 10, height: 10, data: new Uint8Array([1, 2, 3]) }]]);
  const source = loaded(doc("Rajkumar", [mouth, head, torso], { bitmaps, brushes: { 7: { svg: "<svg/>", diameter: 5 } } }));
  source.renderer.assets.images.set("mouth.png", { width: 10, height: 10 });
  const target = loaded(doc("Sardar", [sym("Pose", [], 30)]));

  const out = await lib.importElements(source, [inst("Rajkumar/Head")], target);
  assert.equal(out[0].item, "Pasted from Rajkumar/Rajkumar/Head", "pasted instance points at the copy");
  assert.deepEqual(out[0].m, [2, 0, 0, 2, 10, 20], "the instance keeps its matrix");
  assert.ok(target.doc.symbols.has("Pasted from Rajkumar/Rajkumar/Head") && target.doc.symbols.has("Pasted from Rajkumar/Mouth"), "head and mouth copied");
  assert.ok(!target.doc.symbols.has("Pasted from Rajkumar/Torso"), "unrelated symbols stay behind");
  const copiedHead = target.doc.symbols.get("Pasted from Rajkumar/Rajkumar/Head");
  const inner = copiedHead.timeline.layers[0].frames[0].elements;
  assert.equal(inner[0].item, "Pasted from Rajkumar/Mouth", "the head's own mouth is renamed");
  assert.equal(inner[1].item, "Ghost", "an item the source does not have is left alone");
  assert.equal(copiedHead.timeline.length, 30, "the copy keeps its own timeline (animation / talk loop)");
  assert.equal(target.doc.symbols.get("Pasted from Rajkumar/Mouth").timeline.length, 8);
  const mouthCopy = target.doc.symbols.get("Pasted from Rajkumar/Mouth").timeline.layers[0].frames[0].elements;
  assert.equal(mouthCopy[0].item, "Pasted from Rajkumar/mouth.png", "picture renamed");
  assert.equal(mouthCopy[1].strokes[0].style.brush, "Pasted from Rajkumar/7", "brush renamed in strokes");
  assert.equal(mouthCopy[1].strokeStyles[1].brush, "Pasted from Rajkumar/7", "...and in the stroke styles");
  assert.ok(target.doc.brushes["Pasted from Rajkumar/7"], "brush registered");
  assert.ok(target.doc.bitmaps.has("Pasted from Rajkumar/mouth.png"), "picture registered");
  assert.ok(target.renderer.assets.images.has("Pasted from Rajkumar/mouth.png"), "decoded picture reused");
  assert.equal(source.doc.symbols.get("Mouth").timeline.layers[0].frames[0].elements[0].item, "mouth.png", "the source is untouched");
  assert.equal(source.doc.symbols.size, 3);

  // again: same copies, nothing doubled
  const before = target.doc.symbols.size;
  const again = await lib.importElements(source, [inst("Rajkumar/Head")], target);
  assert.equal(again[0].item, out[0].item); assert.equal(target.doc.symbols.size, before, "repeat paste reuses the copy");

  // same document: nothing to import
  const same = [inst("Mouth")];
  assert.strictEqual(await lib.importElements(source, same, source), same);

  // what is worth saving: only what the edited timelines use
  const used = lib.libraryUsedBy(target.doc, [tl([inst("Pasted from Rajkumar/Rajkumar/Head")])]);
  assert.deepEqual(Object.keys(used.symbols).sort(), ["Pasted from Rajkumar/Mouth", "Pasted from Rajkumar/Rajkumar/Head"]);
  assert.ok(used.bitmaps["Pasted from Rajkumar/mouth.png"].data, "picture saved as base64");
  assert.ok(used.brushes["Pasted from Rajkumar/7"]);
  const none = lib.libraryUsedBy(target.doc, [tl([inst("Pose")])]);
  assert.ok(!none || (!Object.keys(none.symbols).length && !Object.keys(none.bitmaps).length), "unused imports are not saved");

  // restore into a fresh document (a reopened project): same names, same content
  const fresh = loaded(doc("Sardar", [sym("Pose", [], 30)]));
  await lib.registerLibrary(fresh, JSON.parse(JSON.stringify(used)));
  assert.ok(fresh.doc.symbols.has("Pasted from Rajkumar/Rajkumar/Head") && fresh.doc.symbols.has("Pasted from Rajkumar/Mouth"));
  assert.ok(fresh.doc.brushes["Pasted from Rajkumar/7"]);
  assert.deepEqual(Array.from(fresh.doc.bitmaps.get("Pasted from Rajkumar/mouth.png").data), [1, 2, 3], "picture bytes round-trip");
  await lib.registerLibrary(fresh, used); // repeat is harmless
  assert.equal(fresh.doc.symbols.size, 3);

  // matrices
  const m = [2, 1, -1, 3, 5, 7], inv = lib.invert(m), id = lib.mul(m, inv);
  id.forEach((v, i) => assert.ok(Math.abs(v - I[i]) < 1e-9, "m · m⁻¹ = identity"));
  console.log("library: all assertions passed");
})().catch((e) => { console.error(e); process.exit(1); });
