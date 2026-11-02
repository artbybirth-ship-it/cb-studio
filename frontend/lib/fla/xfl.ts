/**
 * Adobe Animate .fla (XFL) reader for the browser importer: the document, its library symbols
 * and their timelines, as plain data the CreateJS writer turns into an HTML5 Canvas export.
 *
 * Shapes become closed fill contours and stroke paths in px. Kept per keyframe: classic tweens
 * (XFL tweenType "motion") with their eases and rotation, shape tweens (Animate's own matched
 * curves, <MorphShape>), masks, Graphic loop modes, alpha, art brushes and bitmaps. What is not
 * imported yet (text, sound, filters, colour effects other than alpha) is listed in warnings.
 * Checked against Animate's own HTML5 publish (tools/fla-spike).
 */
import { readZip } from "./zip";

export type Matrix = [number, number, number, number, number, number];
export type Cmd = ["M", number, number] | ["L", number, number] | ["Q", number, number, number, number];
export type Path = Cmd[];
export type Fill =
  | { t: "solid"; color: string; alpha: number }
  | { t: "linear" | "radial"; m: Matrix; stops: Array<[number, string, number]>; focal: number };
export type Stroke = { w: number; caps: string; joints: string; miter: number; scale: string; fill: Fill; brush?: string };
export type ShapeElement = {
  k: "shape"; m: Matrix;
  fills: Array<{ style: Fill; paths: Path[] }>;
  strokes: Array<{ style: Stroke; paths: Path[] }>;
  fillStyles: Record<number, Fill>;
  strokeStyles: Record<number, Stroke>;
};
export type InstanceElement = {
  k: "instance"; item: string; symbolType: string; m: Matrix; pivot: [number, number];
  loop: string; first: number; alpha?: number; name?: string;
};
export type BitmapElement = { k: "bitmap"; item: string; m: Matrix };
export type FlaElement = ShapeElement | InstanceElement | BitmapElement;
/** One shape-tween segment: start points A/B, then curves [isLine, cA.x, cA.y, aA.x, aA.y, cB.x, cB.y, aB.x, aB.y]. */
export type MorphSegment = { a: [number, number]; b: [number, number]; curves: number[][]; f1: number; f2: number; s1: number; s2: number };
export type Ease = { custom?: Array<[number, number]>; intensity?: number; method?: string };
export type Keyframe = {
  i: number; d: number; elements: FlaElement[];
  tween?: "motion" | "shape" | "motion object"; ease?: Ease; rotate?: [string, number];
  morph?: MorphSegment[]; label?: string;
};
export type Layer = { name: string; type: string; parent: number | null; hidden: boolean; frames: Keyframe[] };
export type Timeline = { name: string; layers: Layer[]; length: number };
/** warnings: what this symbol's own timeline uses that is not imported (see FlaDocument). */
export type LibrarySymbol = { name: string; type: string; timeline: Timeline; warnings: string[] };
export type Brush = { svg: string; diameter: number };
export type BitmapItem = { name: string; data?: Uint8Array; width: number; height: number };
export type FlaDocument = {
  name: string; width: number; height: number; fps: number; background: string;
  stage: Timeline; symbols: Map<string, LibrarySymbol>; brushes: Record<string, Brush>;
  bitmaps: Map<string, BitmapItem>;
  /** bin/M <n> ….dat by <n>: pictures whose library item is missing from the document. */
  binData: Map<string, Uint8Array>;
  /** Not imported yet and used on the stage's own timeline (symbols carry their own). */
  warnings: string[];
};

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

// ---------- XML helpers (namespaced XFL: match on local names)
type Element_ = globalThis.Element;
const kids = (el: Element_ | null | undefined, name?: string): Element_[] =>
  el ? Array.from(el.children).filter((child) => !name || child.localName === name) : [];
const child = (el: Element_ | null | undefined, name: string): Element_ | null => kids(el, name)[0] || null;
const path_ = (el: Element_ | null | undefined, ...names: string[]): Element_ | null => names.reduce<Element_ | null>((node, name) => child(node, name), el || null);
const num = (value: string | null, fallback = 0) => { const n = Number(value); return value != null && Number.isFinite(n) ? n : fallback; };

/** Library names of items imported from Illustrator arrive escaped twice ("&#060Path&#062"). */
export const displayName = (value: string) => value
  .replace(/&#[xX]([0-9a-fA-F]+);?/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
  .replace(/&#(\d+);?/g, (_, dec) => String.fromCodePoint(Number(dec)))
  .replace(/&(amp|lt|gt|quot|apos);/g, (_, name) => ({ amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'" })[name as "amp"]);

/** XFL number: decimal, or "#hex.frac" whose integer part is two's complement. */
export function xflNumber(text: string): number {
  const s = text.trim();
  if (!s.startsWith("#")) return Number(s);
  const [whole, frac = ""] = s.slice(1).split(".");
  let value = parseInt(whole || "0", 16);
  const bits = 4 * whole.length;
  if (bits >= 24 && value >= 2 ** (bits - 1)) value -= 2 ** bits;
  return value + (frac ? parseInt(frac, 16) / 16 ** frac.length : 0);
}

function matrixOf(el: Element_ | null): Matrix {
  const m = path_(el, "matrix", "Matrix");
  if (!m) return [...IDENTITY];
  return [num(m.getAttribute("a"), 1), num(m.getAttribute("b")), num(m.getAttribute("c")), num(m.getAttribute("d"), 1), num(m.getAttribute("tx")), num(m.getAttribute("ty"))];
}

// ---------- edges → contours
type Point = [number, number];
type Piece = ["L", Point, Point] | ["Q", Point, Point, Point];
const TOKEN = /[!|/[\]]|S\d+|#[0-9A-Fa-f]+(?:\.[0-9A-Fa-f]+)?|-?\d+(?:\.\d+)?/g;

/** An edge string → one piece per segment, in twips. */
function parseEdges(text: string): Piece[] {
  const tokens = text.match(TOKEN) || [];
  const pieces: Piece[] = [];
  let current: Point = [0, 0];
  for (let i = 0; i < tokens.length;) {
    const t = tokens[i];
    if (t === "!") { current = [xflNumber(tokens[i + 1]), xflNumber(tokens[i + 2])]; i += 3; }
    else if (t === "|" || t === "/") { const p: Point = [xflNumber(tokens[i + 1]), xflNumber(tokens[i + 2])]; pieces.push(["L", current, p]); current = p; i += 3; }
    else if (t === "[" || t === "]") {
      const c: Point = [xflNumber(tokens[i + 1]), xflNumber(tokens[i + 2])];
      const p: Point = [xflNumber(tokens[i + 3]), xflNumber(tokens[i + 4])];
      pieces.push(["Q", current, c, p]); current = p; i += 5;
    } else i += 1; // style markers (S1…)
  }
  return pieces;
}
const reversePiece = (p: Piece): Piece => (p[0] === "L" ? ["L", p[2], p[1]] : ["Q", p[3], p[2], p[1]]);
const endOf = (p: Piece): Point => (p[0] === "L" ? p[2] : p[3]);
const keyOf = (p: Point) => `${Math.round(p[0] * 4)},${Math.round(p[1] * 4)}`;
const px = (v: number) => Math.round(v * 50) / 1000; // twips → px, 3 decimals

function toPath(chain: Piece[]): Path {
  const out: Path = [["M", px(chain[0][1][0]), px(chain[0][1][1])]];
  for (const p of chain) {
    if (p[0] === "L") out.push(["L", px(p[2][0]), px(p[2][1])]);
    else out.push(["Q", px(p[2][0]), px(p[2][1]), px(p[3][0]), px(p[3][1])]);
  }
  return out;
}

/** Oriented pieces joined end to start into closed loops (open leftovers kept as they are). */
function contours(pieces: Piece[]): Path[] {
  const starts = new Map<string, number[]>();
  pieces.forEach((p, index) => { const k = keyOf(p[1]); (starts.get(k) || starts.set(k, []).get(k)!).push(index); });
  const used = new Array(pieces.length).fill(false);
  const loops: Path[] = [];
  for (let index = 0; index < pieces.length; index += 1) {
    if (used[index]) continue;
    used[index] = true;
    const chain = [pieces[index]];
    const first = keyOf(pieces[index][1]);
    while (keyOf(endOf(chain[chain.length - 1])) !== first) {
      const next = (starts.get(keyOf(endOf(chain[chain.length - 1]))) || []).find((j) => !used[j]);
      if (next == null) break;
      used[next] = true;
      chain.push(pieces[next]);
    }
    loops.push(toPath(chain));
  }
  return loops;
}

/** Touching pieces in order become one polyline (fewer joins than piece by piece). */
function strokePaths(pieces: Piece[]): Path[] {
  const out: Path[] = [];
  let chain: Piece[] = [];
  for (const p of pieces) {
    if (chain.length && keyOf(endOf(chain[chain.length - 1])) === keyOf(p[1])) chain.push(p);
    else { if (chain.length) out.push(toPath(chain)); chain = [p]; }
  }
  if (chain.length) out.push(toPath(chain));
  return out;
}

// ---------- styles
function fillOf(el: Element_ | null): Fill {
  const solid = child(el, "SolidColor");
  if (solid) return { t: "solid", color: (solid.getAttribute("color") || "#000000").toUpperCase(), alpha: num(solid.getAttribute("alpha"), 1) };
  for (const kind of ["LinearGradient", "RadialGradient"] as const) {
    const g = child(el, kind);
    if (!g) continue;
    const stops = kids(g, "GradientEntry").map((entry) => [num(entry.getAttribute("ratio")), (entry.getAttribute("color") || "#000000").toUpperCase(), num(entry.getAttribute("alpha"), 1)] as [number, string, number]);
    return { t: kind === "LinearGradient" ? "linear" : "radial", m: matrixOf(g), stops, focal: num(g.getAttribute("focalPointRatio")) };
  }
  // Bitmap fills: a neutral grey stands in (rare in character art).
  return { t: "solid", color: "#999999", alpha: child(el, "BitmapFill") ? 1 : 0 };
}

function strokeOf(el: Element_): Stroke | null {
  const s = el.firstElementChild;
  if (!s) return null;
  const fill = child(s, "fill");
  const out: Stroke = {
    w: num(s.getAttribute("weight"), 1), caps: s.getAttribute("caps") || "round", joints: s.getAttribute("joints") || "round",
    miter: num(s.getAttribute("miterLimit"), 3), scale: s.getAttribute("scaleMode") || "normal",
    fill: fill ? fillOf(fill) : { t: "solid", color: "#000000", alpha: 1 },
  };
  if (s.localName === "PaintBrushStroke" && s.getAttribute("paintBrushDefinition")) out.brush = s.getAttribute("paintBrushDefinition")!;
  return out;
}

function shapeOf(el: Element_): ShapeElement {
  const fillStyles: Record<number, Fill> = {};
  for (const f of kids(child(el, "fills"), "FillStyle")) fillStyles[num(f.getAttribute("index"))] = fillOf(f);
  const strokeStyles: Record<number, Stroke> = {};
  for (const s of kids(child(el, "strokes"), "StrokeStyle")) { const style = strokeOf(s); if (style) strokeStyles[num(s.getAttribute("index"))] = style; }
  const byFill = new Map<number, Piece[]>();
  const byStroke = new Map<number, Piece[]>();
  for (const edge of kids(child(el, "edges"), "Edge")) {
    const text = edge.getAttribute("edges");
    if (!text) continue;
    const pieces = parseEdges(text);
    const f0 = num(edge.getAttribute("fillStyle0")), f1 = num(edge.getAttribute("fillStyle1")), s = num(edge.getAttribute("strokeStyle"));
    // Fill on the right as drawn; a fill on the left runs the edge backwards.
    if (f1) (byFill.get(f1) || byFill.set(f1, []).get(f1)!).push(...pieces);
    if (f0) (byFill.get(f0) || byFill.set(f0, []).get(f0)!).push(...pieces.slice().reverse().map(reversePiece));
    if (s) (byStroke.get(s) || byStroke.set(s, []).get(s)!).push(...pieces);
  }
  const sorted = <T,>(map: Map<number, T>) => [...map.entries()].sort((a, b) => a[0] - b[0]);
  return {
    k: "shape", m: matrixOf(el),
    fills: sorted(byFill).map(([index, pieces]) => ({ style: fillStyles[index] || { t: "solid", color: "#000000", alpha: 0 }, paths: contours(pieces) })),
    strokes: sorted(byStroke).filter(([index]) => strokeStyles[index]).map(([index, pieces]) => ({ style: strokeStyles[index], paths: strokePaths(pieces) })),
    fillStyles, strokeStyles,
  };
}

function instanceOf(el: Element_, warnings: Set<string>): InstanceElement {
  const pivot = path_(el, "transformationPoint", "Point");
  const color = path_(el, "color", "Color");
  const out: InstanceElement = {
    k: "instance", item: el.getAttribute("libraryItemName") || "", symbolType: el.getAttribute("symbolType") || "movie clip", m: matrixOf(el),
    pivot: [num(pivot?.getAttribute("x") ?? null), num(pivot?.getAttribute("y") ?? null)],
    loop: el.getAttribute("loop") || "loop", first: num(el.getAttribute("firstFrame")),
  };
  if (color) {
    if (color.hasAttribute("alphaMultiplier")) out.alpha = num(color.getAttribute("alphaMultiplier"), 1);
    if ([...color.getAttributeNames()].some((name) => name !== "alphaMultiplier")) warnings.add("colour effects other than alpha (tint, brightness)");
  }
  if (child(el, "filters")) warnings.add("filters (shadow, glow, blur)");
  const name = el.getAttribute("name");
  if (name) out.name = name;
  return out;
}

function elementsOf(container: Element_ | null, warnings: Set<string>): FlaElement[] {
  const out: FlaElement[] = [];
  for (const el of kids(container)) {
    switch (el.localName) {
      case "DOMShape": out.push(shapeOf(el)); break;
      case "DOMSymbolInstance": out.push(instanceOf(el, warnings)); break;
      case "DOMGroup": out.push(...elementsOf(child(el, "members"), warnings)); break; // members carry timeline-space matrices
      case "DOMBitmapInstance": out.push({ k: "bitmap", item: el.getAttribute("libraryItemName") || "", m: matrixOf(el) }); break;
      case "DOMStaticText": case "DOMDynamicText": case "DOMInputText": warnings.add("text"); break;
      default: break;
    }
  }
  return out;
}

const pair = (value: string | null): [number, number] => {
  const [x = "0", y = "0"] = (value || "").split(",");
  return [xflNumber(x) * 12.8, xflNumber(y) * 12.8]; // twips ÷ 256 → px
};
function morphOf(el: Element_): MorphSegment[] {
  return Array.from(el.getElementsByTagNameNS("*", "MorphSegment")).map((segment) => ({
    a: pair(segment.getAttribute("startPointA")), b: pair(segment.getAttribute("startPointB")),
    curves: kids(segment, "MorphCurves").map((c) => [
      c.getAttribute("isLine") === "true" ? 1 : 0,
      ...pair(c.getAttribute("controlPointA")), ...pair(c.getAttribute("anchorPointA")),
      ...pair(c.getAttribute("controlPointB")), ...pair(c.getAttribute("anchorPointB")),
    ]),
    f1: num(segment.getAttribute("fillIndex1"), -1), f2: num(segment.getAttribute("fillIndex2"), -1),
    s1: num(segment.getAttribute("strokeIndex1"), -1), s2: num(segment.getAttribute("strokeIndex2"), -1),
  }));
}

function easeOf(frame: Element_): Ease {
  const tweens = child(frame, "tweens");
  const custom = child(tweens, "CustomEase");
  if (custom) return { custom: kids(custom, "Point").map((p) => [num(p.getAttribute("x")), num(p.getAttribute("y"))]) };
  const ease = child(tweens, "Ease");
  if (ease) return { intensity: num(ease.getAttribute("intensity")), method: ease.getAttribute("method") || undefined };
  if (frame.getAttribute("easeMethodName")) return { method: frame.getAttribute("easeMethodName")! };
  return { intensity: num(frame.getAttribute("acceleration")) };
}

function timelineOf(el: Element_ | null, warnings: Set<string>): Timeline {
  const layers: Layer[] = kids(child(el, "layers"), "DOMLayer").map((layer) => ({
    name: layer.getAttribute("name") || "",
    type: layer.getAttribute("layerType") || "normal",
    parent: layer.hasAttribute("parentLayerIndex") ? num(layer.getAttribute("parentLayerIndex")) : null,
    hidden: layer.getAttribute("visible") === "false",
    frames: kids(child(layer, "frames"), "DOMFrame").map((frame) => {
      const out: Keyframe = { i: num(frame.getAttribute("index")), d: num(frame.getAttribute("duration"), 1), elements: elementsOf(child(frame, "elements"), warnings) };
      const tween = frame.getAttribute("tweenType");
      if (tween === "motion" || tween === "shape" || tween === "motion object") {
        out.tween = tween;
        out.ease = easeOf(frame);
        if (frame.getAttribute("motionTweenRotate")) out.rotate = [frame.getAttribute("motionTweenRotate")!, num(frame.getAttribute("motionTweenRotateTimes"))];
        const morph = child(frame, "MorphShape");
        if (morph) out.morph = morphOf(morph);
        if (tween === "motion object") warnings.add("Motion Tweens (the newer kind) — shown without their motion");
      }
      if (frame.getAttribute("name")) out.label = frame.getAttribute("name")!;
      if (frame.getAttribute("soundName")) warnings.add("sound");
      return out;
    }),
  }));
  const length = Math.max(1, ...layers.flatMap((layer) => layer.frames.map((frame) => frame.i + frame.d)));
  return { name: el?.getAttribute("name") || "", layers, length };
}

function brushesOf(xml: string | undefined): Record<string, Brush> {
  const out: Record<string, Brush> = {};
  if (!xml) return out;
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  for (const def of Array.from(doc.documentElement?.children || [])) {
    try {
      const param = JSON.parse(def.getAttribute("brushParam") || "{}");
      if (param.svgData) out[def.getAttribute("index") || ""] = { svg: String(param.svgData), diameter: Number(param.diameter) || 64 };
    } catch { /* an unreadable brush only loses that brush */ }
  }
  return out;
}

const text = (bytes: Uint8Array | undefined) => (bytes ? new TextDecoder().decode(bytes) : "");

/** Reads an .fla file. onProgress(0…1) is called as the library is read. */
export async function readFla(file: Blob, name: string, onProgress?: (fraction: number) => void): Promise<FlaDocument> {
  const entries = await readZip(new Uint8Array(await file.arrayBuffer()));
  const documentXml = text(entries.get("DOMDocument.xml"));
  if (!documentXml) throw new Error("This file has no Animate document in it (it may be an old Flash CS4 or earlier .fla — open and save it in Animate first).");
  const parser = new DOMParser();
  const doc = parser.parseFromString(documentXml, "application/xml").documentElement;
  if (!doc || doc.localName !== "DOMDocument") throw new Error("The Animate document could not be read.");
  const symbols = new Map<string, LibrarySymbol>();
  const libraryFiles = [...entries.keys()].filter((key) => key.startsWith("LIBRARY/") && key.endsWith(".xml"));
  for (let index = 0; index < libraryFiles.length; index += 1) {
    const root = parser.parseFromString(text(entries.get(libraryFiles[index])), "application/xml").documentElement;
    if (root?.localName === "DOMSymbolItem") {
      const symbolName = root.getAttribute("name") || libraryFiles[index].slice(8, -4);
      const warnings = new Set<string>();
      const timeline = timelineOf(path_(root, "timeline", "DOMTimeline"), warnings);
      symbols.set(symbolName, { name: symbolName, type: root.getAttribute("symbolType") || "movie clip", timeline, warnings: [...warnings] });
    }
    if (index % 20 === 19) { onProgress?.((index + 1) / libraryFiles.length); await new Promise((resolve) => setTimeout(resolve, 0)); }
  }

  const bitmaps = new Map<string, BitmapItem>();
  for (const item of kids(child(doc, "media"), "DOMBitmapItem")) {
    const itemName = item.getAttribute("name") || "";
    const href = item.getAttribute("bitmapDataHRef");
    bitmaps.set(itemName, {
      name: itemName, data: href ? entries.get(`bin/${href}`) : undefined,
      width: num(item.getAttribute("frameRight")) / 20, height: num(item.getAttribute("frameBottom")) / 20,
    });
  }
  const binData = new Map<string, Uint8Array>();
  for (const [key, value] of entries) { const n = key.match(/^bin\/M (\d+) [^/]*\.dat$/)?.[1]; if (n) binData.set(n, value); }

  const warnings = new Set<string>();
  const stage = timelineOf(path_(doc, "timelines", "DOMTimeline"), warnings);
  onProgress?.(1);
  return {
    name: name.replace(/\.fla$/i, ""), width: num(doc.getAttribute("width"), 550), height: num(doc.getAttribute("height"), 400),
    fps: num(doc.getAttribute("frameRate"), 24), background: (doc.getAttribute("backgroundColor") || "#FFFFFF").toUpperCase(),
    stage, symbols, brushes: brushesOf(text(entries.get("PaintBrushDefinitions.xml")) || undefined), bitmaps, binData, warnings: [...warnings],
  };
}
