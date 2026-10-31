import { promises as fs } from "fs";
import path from "path";
import { inflateRawSync } from "zlib";

/**
 * Animate source timelines for "step inside a character" — the desktop twin of
 * backend/projects/fla_timeline.py (keep the two in step; they write the same files).
 *
 * A character package that includes the .fla gets, per document, cb-fla-timeline/<document>/
 * with index.json and one <JsName>.json per symbol: every layer (name, type, folder / mask
 * nesting, Animate's visible / locked / colour) and keyframe (frame, length, tween, ease, label,
 * sound, what it holds). Each symbol is linked to its published class (lib.<JsName>) and each
 * layer to the display objects its code creates ("// <layer name>" comments), followed down from
 * the stage, because Animate renames clashing symbols on publish.
 */
export const FLA_TIMELINE_VERSION = 1;
export const FLA_TIMELINE_DIR = "cb-fla-timeline";

type Json = Record<string, unknown>;
type Frame = Json & { i: number; d: number; symbols?: unknown[] };
type Layer = Json & { name: string; type: string; frames: Frame[]; props?: string[] };
type Timeline = { name: string; frames: number; layers: Layer[] };
type CodeLayer = { name: string; mask: boolean; props: string[]; symbols: string[]; classes: Record<string, string> };
export type FlaTimelineIndex = { version: number; document: string; fps: number; stage: string | null; symbols: Record<string, { name: string; frames: number; layers: number }>; unlinked: string[] };

/** The .fla's XML files. Reads the zip directory where it says it is: Animate sometimes writes
 *  a directory size that is too large, which stricter readers refuse. */
function readFlaEntries(data: Buffer, wanted: (name: string) => boolean): Map<string, string> {
  const end = data.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (end < 0) throw new Error("not a zip");
  const count = data.readUInt16LE(end + 10);
  let at = data.readUInt32LE(end + 16);
  const files = new Map<string, string>();
  for (let index = 0; index < count && data.readUInt32LE(at) === 0x02014b50; index += 1) {
    const method = data.readUInt16LE(at + 10);
    const size = data.readUInt32LE(at + 20);
    const nameLength = data.readUInt16LE(at + 28);
    const extraLength = data.readUInt16LE(at + 30);
    const commentLength = data.readUInt16LE(at + 32);
    const local = data.readUInt32LE(at + 42);
    const name = data.toString("utf8", at + 46, at + 46 + nameLength);
    at += 46 + nameLength + extraLength + commentLength;
    if (!wanted(name)) continue;
    const start = local + 30 + data.readUInt16LE(local + 26) + data.readUInt16LE(local + 28);
    const raw = data.subarray(start, start + size);
    files.set(name, (method === 8 ? inflateRawSync(raw) : raw).toString("utf8"));
  }
  return files;
}

const NAMED: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'" };
/** Python's html.unescape for what XFL uses: named basics and numeric references (";" optional). */
const unescape = (value: string) => value
  .replace(/&#[xX]([0-9a-fA-F]+);?/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
  .replace(/&#(\d+);?/g, (_, dec) => String.fromCodePoint(Number(dec)))
  .replace(/&(amp|lt|gt|quot|apos);/g, (_, name) => NAMED[name]);
/** Library names arrive escaped twice for items imported from Illustrator ("&#060Path&#062"). */
const libraryName = (value: string) => unescape(unescape(value));

function attrs(tag: string): Record<string, string> {
  const output: Record<string, string> = {};
  for (const match of tag.matchAll(/([A-Za-z_:][\w:.-]*)="([^"]*)"/g)) output[match[1]] = unescape(match[2]);
  return output;
}

/** <name …>body</name> and <name …/> elements (not nested in themselves), with attributes. */
function blocks(xml: string, name: string): Array<[Record<string, string>, string]> {
  const output: Array<[Record<string, string>, string]> = [];
  const pattern = new RegExp(`<${name}\\b([^>]*?)(/?)>`, "g");
  let pos = 0;
  for (;;) {
    pattern.lastIndex = pos;
    const match = pattern.exec(xml);
    if (!match) return output;
    if (match[2] === "/") { output.push([attrs(match[1]), ""]); pos = match.index + match[0].length; continue; }
    const bodyStart = match.index + match[0].length;
    const close = xml.indexOf(`</${name}>`, bodyStart);
    if (close < 0) return output;
    output.push([attrs(match[1]), xml.slice(bodyStart, close)]);
    pos = close + name.length + 3;
  }
}

function ease(frameAttrs: Record<string, string>, body: string): number | string | null {
  if (body.includes("<CustomEase")) return "custom";
  const named = body.match(/<Ease\b[^>]*\bmethod="([^"]+)"/);
  if (named) return named[1];
  if ("acceleration" in frameAttrs) {
    const value = Math.trunc(Number(frameAttrs.acceleration));
    return Number.isFinite(value) ? value : null;
  }
  return null;
}

const TWEENS: Record<string, string> = { motion: "classic", shape: "shape", "motion object": "motion" };

/** Layers (top to bottom, as Animate lists them) and their keyframes. */
function timeline(xml: string): Omit<Timeline, "name"> {
  const layers: Layer[] = [];
  for (const [layerAttrs, body] of blocks(xml, "DOMLayer")) {
    const frames: Frame[] = [];
    for (const [frameAttrs, frameBody] of blocks(body, "DOMFrame")) {
      const elements = frameBody.replace(/<tweens>[\s\S]*?<\/tweens>/g, "");
      // The published code creates a frame's objects top first; the .fla lists them bottom first.
      const symbols: string[] = [];
      for (const match of [...elements.matchAll(/<DOMSymbolInstance\b[^>]*\blibraryItemName="([^"]*)"/g)].reverse()) {
        const item = libraryName(match[1]);
        if (!symbols.includes(item)) symbols.push(item);
      }
      const entry: Frame = { i: Number(frameAttrs.index || 0), d: Number(frameAttrs.duration || 1) };
      const tween = TWEENS[frameAttrs.tweenType || ""];
      if (tween) {
        entry.tween = tween;
        const value = ease(frameAttrs, frameBody);
        if (value !== null && value !== 0) entry.ease = value;
      }
      if (frameAttrs.name) entry.label = frameAttrs.name;
      if (frameAttrs.soundName) entry.sound = frameAttrs.soundName;
      if (symbols.length) entry.symbols = symbols;
      const counts: Record<string, number> = {
        shapes: (elements.match(/<DOMShape\b/g) || []).length,
        texts: (elements.match(/<DOM(?:Static|Dynamic|Input)Text\b/g) || []).length,
        bitmaps: (elements.match(/<DOMBitmapInstance\b/g) || []).length,
      };
      for (const [key, value] of Object.entries(counts)) if (value) entry[key] = value;
      if (!symbols.length && !Object.values(counts).some(Boolean) && !("sound" in entry)) entry.blank = true;
      frames.push(entry);
    }
    const layer: Layer = { name: layerAttrs.name || "", type: layerAttrs.layerType || "normal", frames };
    if ("parentLayerIndex" in layerAttrs) layer.parent = Number(layerAttrs.parentLayerIndex);
    if (layerAttrs.color) layer.color = layerAttrs.color;
    if (layerAttrs.visible === "false") layer.hidden = true;
    if (layerAttrs.locked === "true") layer.locked = true;
    if (layerAttrs.outline === "true") layer.outline = true;
    delete (layer as Json).frames;
    layer.frames = frames;
    layers.push(layer);
  }
  const length = Math.max(1, ...layers.flatMap((layer) => layer.frames.map((frame) => frame.i + frame.d)));
  return { frames: length, layers };
}

/** Each published MovieClip class's layers, with the display objects and library symbols each creates. */
function codeClasses(jsText: string): Map<string, CodeLayer[]> {
  const classes = new Map<string, CodeLayer[]>();
  for (const match of jsText.matchAll(/\(lib\.([A-Za-z0-9_$]+) = function\(mode,startPosition,loop/g)) {
    const from = (match.index || 0) + match[0].length;
    const end = jsText.indexOf("}).prototype", from); // "= p = new cjs.MovieClip()" or getMCSymbolPrototype(…)
    const layers: CodeLayer[] = [];
    let current: CodeLayer | null = null;
    for (const line of jsText.slice(from, end >= 0 ? end : undefined).split("\n")) {
      const comment = line.match(/^\t\/\/ (.+?)\s*$/);
      if (comment && !comment[1].endsWith(":")) {
        current = { name: comment[1].replace(/ \((?:mask|guide)\)$/, ""), mask: comment[1].endsWith("(mask)"), props: [], symbols: [], classes: {} };
        layers.push(current);
        continue;
      }
      if (!current) continue;
      for (const prop of line.matchAll(/\bthis\.([A-Za-z0-9_$]+) = new /g)) if (!current.props.includes(prop[1])) current.props.push(prop[1]);
      for (const object of line.matchAll(/\bthis\.([A-Za-z0-9_$]+) = new lib\.([A-Za-z0-9_$]+)\(/g)) current.classes[object[1]] = object[2];
      for (const symbol of line.matchAll(/new lib\.([A-Za-z0-9_$]+)\(/g)) if (!current.symbols.includes(symbol[1])) current.symbols.push(symbol[1]);
    }
    classes.set(match[1], layers);
  }
  return classes;
}

const plain = (name: string) => (name.split("/").pop() || "").replace(/[^A-Za-z0-9_$]/g, "");
const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const mayBe = (jsName: string, xflName: string) => {
  const base = plain(xflName);
  return jsName === base || new RegExp(`^${escapeRegExp(base)}_\\d+$`).test(jsName);
};

/** (fla index, code index) of the layers whose code Animate wrote, in order, by name. */
function align(xflLayers: Layer[], codeLayers: CodeLayer[]): Array<[number, number]> {
  const pairs: Array<[number, number]> = [];
  let j = 0;
  xflLayers.forEach((layer, i) => {
    if (layer.type === "folder" || layer.type === "guide") return;
    for (let k = j; k < codeLayers.length; k += 1) {
      if (codeLayers[k].name !== layer.name) continue;
      pairs.push([i, k]);
      j = k + 1;
      return;
    }
  });
  return pairs;
}

/** Reads the .fla, links it to the export .js and writes outDir; returns index.json's data. */
export async function buildFlaTimeline(flaPath: string, jsText: string, outDir: string): Promise<FlaTimelineIndex> {
  const entries = readFlaEntries(await fs.readFile(flaPath), (name) => name === "DOMDocument.xml" || (name.startsWith("LIBRARY/") && name.endsWith(".xml")));
  const documentXml = entries.get("DOMDocument.xml");
  if (!documentXml) throw new Error("no DOMDocument.xml");
  const docAttrs = attrs(documentXml.match(/<DOMDocument\b([^>]*)>/)?.[1] || "");
  const fps = Number(docAttrs.frameRate || 24);
  const symbols = new Map<string, Timeline>();
  for (const [name, xml] of [...entries].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    if (!name.startsWith("LIBRARY/")) continue;
    const head = xml.match(/<DOMSymbolItem\b([^>]*)>/);
    if (!head) continue;
    const symbolName = libraryName(attrs(head[1]).name ?? name.slice(8, -4));
    symbols.set(symbolName, { name: symbolName, ...timeline(xml) });
  }
  const scene = blocks(documentXml, "DOMTimeline");
  const stage: Timeline = { name: scene[0]?.[0].name || "Scene 1", ...timeline(scene[0]?.[1] || "") };

  const classes = codeClasses(jsText);
  const stageJs = jsText.match(/\/\/ stage content:\s*\n\(lib\.([A-Za-z0-9_$]+) = function/)?.[1] || null;

  // Link symbols to classes, from the stage down; then any name that can only mean one class.
  const linked = new Map<string, string>();
  const taken = new Set<string>();
  const queue: Array<[Timeline, string]> = stageJs && classes.has(stageJs) ? [[stage, stageJs]] : [];
  while (queue.length) {
    const [xfl, jsName] = queue.shift()!;
    const codeLayers = classes.get(jsName) || [];
    for (const [i, k] of align(xfl.layers, codeLayers)) {
      const xflChildren: string[] = [];
      for (const frame of xfl.layers[i].frames) for (const child of (frame.symbols || []) as string[]) if (symbols.has(child) && !xflChildren.includes(child)) xflChildren.push(child);
      const codeChildren = codeLayers[k].symbols.filter((name) => classes.has(name));
      if (xflChildren.length !== codeChildren.length) continue;
      xflChildren.forEach((child, index) => {
        const codeChild = codeChildren[index];
        if (linked.has(child) || taken.has(codeChild) || !mayBe(codeChild, child)) return;
        linked.set(child, codeChild);
        taken.add(codeChild);
        queue.push([symbols.get(child)!, codeChild]);
      });
    }
  }
  for (const name of symbols.keys()) {
    if (linked.has(name)) continue;
    const options = [...classes.keys()].filter((jsName) => !taken.has(jsName) && mayBe(jsName, name));
    if (options.length === 1 && [...symbols.keys()].filter((other) => !linked.has(other) && mayBe(options[0], other)).length === 1) {
      linked.set(name, options[0]);
      taken.add(options[0]);
    }
  }

  await fs.mkdir(outDir, { recursive: true });
  for (const file of await fs.readdir(outDir)) if (file.endsWith(".json")) await fs.unlink(path.join(outDir, file));

  const write = async (xfl: Timeline, jsName: string) => {
    const codeLayers = classes.get(jsName) || [];
    for (const [i, k] of align(xfl.layers, codeLayers)) {
      xfl.layers[i].props = codeLayers[k].props;
      // Which published symbol each of the layer's objects is (stepping into one).
      const known = Object.fromEntries(Object.entries(codeLayers[k].classes).filter(([, name]) => classes.has(name)));
      if (Object.keys(known).length) xfl.layers[i].classes = known;
    }
    for (const layer of xfl.layers) {
      for (const frame of layer.frames) {
        if (frame.symbols) frame.symbols = (frame.symbols as string[]).map((child) => ({ name: child, ...(linked.has(child) ? { js: linked.get(child) } : {}) }));
      }
    }
    const data = { version: FLA_TIMELINE_VERSION, js: jsName, fps, ...xfl };
    await fs.writeFile(path.join(outDir, `${jsName}.json`), JSON.stringify(data), "utf8");
    return { name: xfl.name, frames: xfl.frames, layers: xfl.layers.length };
  };

  const index: FlaTimelineIndex = { version: FLA_TIMELINE_VERSION, document: path.basename(flaPath, path.extname(flaPath)), fps, stage: stageJs, symbols: {}, unlinked: [] };
  if (stageJs) index.symbols[stageJs] = await write(stage, stageJs);
  for (const [name, jsName] of linked) index.symbols[jsName] = await write(symbols.get(name)!, jsName);
  index.unlinked = [...symbols.keys()].filter((name) => !linked.has(name)).sort();
  await fs.writeFile(path.join(outDir, "index.json"), JSON.stringify(index), "utf8");
  return index;
}
