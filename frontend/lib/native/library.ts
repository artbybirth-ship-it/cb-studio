/**
 * Copying a symbol between characters, as Animate does between documents: the symbol and every
 * library item it uses (nested symbols, pictures, art brushes) are copied into the target's
 * library under names that cannot clash, and the pasted element is then an ordinary instance of
 * the copy. Nothing about the copy is special afterwards: it keeps its own timeline (so its
 * animation and talk loop play), steps into like any symbol, and F5/F6/Remove Frames work on its
 * layer like any other. The copy is independent of the original (as in Animate).
 *
 * What was imported is remembered per document so it can be saved with the pose edits
 * (lib/native/store.ts) and put back on open.
 */
import type { Brush, BitmapItem, FlaDocument, FlaElement, LibrarySymbol, Matrix, ShapeElement, Timeline } from "../fla/xfl";
import { decodeBitmap } from "../fla/bitmaps";
import type { NativeLoaded } from "./loadDoc";

export type SavedBitmap = { name: string; width: number; height: number; data?: string };
/** Imported library items, JSON-safe (pictures as base64). */
export type ImportedLibrary = { symbols: Record<string, LibrarySymbol>; bitmaps: Record<string, SavedBitmap>; brushes: Record<string, Brush> };

const empty = (): ImportedLibrary => ({ symbols: {}, bitmaps: {}, brushes: {} });
const imported = new WeakMap<FlaDocument, ImportedLibrary>();
export const importedOf = (doc: FlaDocument): ImportedLibrary => imported.get(doc) ?? imported.set(doc, empty()).get(doc)!;

// ---------- matrices (a·b applies b first, then a)
export const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];
export const mul = (a: Matrix, b: Matrix): Matrix => [
  a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1], a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3],
  a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5],
];
export function invert(m: Matrix): Matrix {
  const det = m[0] * m[3] - m[1] * m[2] || 1;
  const a = m[3] / det, b = -m[1] / det, c = -m[2] / det, d = m[0] / det;
  return [a, b, c, d, -(a * m[4] + c * m[5]), -(b * m[4] + d * m[5])];
}

/** How big the pose is drawn on the document's stage (1 when it is not placed there): what makes two characters' units comparable. */
export function poseScale(doc: FlaDocument, item: string): number {
  for (const layer of doc.stage.layers) for (const key of layer.frames) for (const el of key.elements) if (el.k === "instance" && el.item === item) return Math.hypot(el.m[0], el.m[1]) || 1;
  return 1;
}

// ---------- what a symbol uses
type Uses = { symbols: Set<string>; bitmaps: Set<string>; brushes: Set<string> };
function usesOf(doc: FlaDocument, items: string[]): Uses {
  const uses: Uses = { symbols: new Set(), bitmaps: new Set(), brushes: new Set() };
  const visitElements = (els: FlaElement[]) => {
    for (const el of els) {
      if (el.k === "instance") { if (doc.symbols.has(el.item)) visit(el.item); }
      else if (el.k === "bitmap") { if (doc.bitmaps.has(el.item)) uses.bitmaps.add(el.item); }
      else {
        for (const s of Object.values(el.strokeStyles)) if (s.brush) uses.brushes.add(s.brush);
        for (const s of el.strokes) if (s.style.brush) uses.brushes.add(s.style.brush);
      }
    }
  };
  const visit = (item: string) => {
    if (uses.symbols.has(item)) return;
    uses.symbols.add(item);
    for (const layer of doc.symbols.get(item)!.timeline.layers) for (const key of layer.frames) visitElements(key.elements);
  };
  for (const item of items) if (doc.symbols.has(item)) visit(item); else visitElements([]);
  return uses;
}
/** Elements that are not symbols (a pasted picture or drawing) can be pasted too: what they use comes along. */
function usesOfElements(doc: FlaDocument, elements: FlaElement[]): Uses {
  const uses = usesOf(doc, elements.flatMap((el) => (el.k === "instance" ? [el.item] : [])));
  for (const el of elements) {
    if (el.k === "bitmap" && doc.bitmaps.has(el.item)) uses.bitmaps.add(el.item);
    if (el.k === "shape") {
      for (const s of Object.values(el.strokeStyles)) if (s.brush) uses.brushes.add(s.brush);
      for (const s of el.strokes) if (s.style.brush) uses.brushes.add(s.style.brush);
    }
  }
  return uses;
}

// ---------- renaming
type Names = { symbol: (item: string) => string; bitmap: (name: string) => string; brush: (id: string) => string; hasSymbol: (item: string) => boolean; hasBitmap: (name: string) => boolean };

function renameShape(el: ShapeElement, names: Names): ShapeElement {
  const fix = <T extends { brush?: string }>(style: T): T => (style.brush ? { ...style, brush: names.brush(style.brush) } : style);
  return {
    ...el,
    strokes: el.strokes.map((s) => ({ ...s, style: fix(s.style) })),
    strokeStyles: Object.fromEntries(Object.entries(el.strokeStyles).map(([k, v]) => [k, fix(v)])),
  };
}
export function renameElements(elements: FlaElement[], names: Names): FlaElement[] {
  return elements.map((el) => {
    if (el.k === "instance") return names.hasSymbol(el.item) ? { ...el, item: names.symbol(el.item) } : el;
    if (el.k === "bitmap") return names.hasBitmap(el.item) ? { ...el, item: names.bitmap(el.item) } : el;
    return renameShape(el, names);
  });
}
const renameTimeline = (timeline: Timeline, names: Names): Timeline => ({
  ...timeline,
  layers: timeline.layers.map((layer) => ({ ...layer, frames: layer.frames.map((key) => ({ ...key, elements: renameElements(key.elements, names) })) })),
});

// ---------- base64 for saving pictures
function toBase64(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(out);
}
const fromBase64 = (text: string): Uint8Array => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

/** Everything in `lib` registered in the target's document and renderer (symbols, pictures, brushes). Safe to repeat. */
export async function registerLibrary(target: NativeLoaded, lib: ImportedLibrary | undefined): Promise<void> {
  if (!lib) return;
  const { doc, renderer } = target;
  const record = importedOf(doc);
  for (const [name, symbol] of Object.entries(lib.symbols)) { if (!doc.symbols.has(name)) doc.symbols.set(name, symbol); record.symbols[name] = symbol; }
  const fresh: Record<string, Brush> = {};
  for (const [id, brush] of Object.entries(lib.brushes)) { if (!doc.brushes[id]) { doc.brushes[id] = brush; fresh[id] = brush; } record.brushes[id] = brush; }
  if (Object.keys(fresh).length) await renderer.loadBrushes(fresh);
  for (const [name, saved] of Object.entries(lib.bitmaps)) {
    record.bitmaps[name] = saved;
    if (doc.bitmaps.has(name)) continue;
    const data = saved.data ? fromBase64(saved.data) : undefined;
    const item: BitmapItem = { name, data, width: saved.width, height: saved.height };
    doc.bitmaps.set(name, item);
    const decoded = await decodeBitmap(data);
    if (decoded) renderer.assets.images.set(name, await createImageBitmap(new Blob([decoded.bytes as BlobPart])) as never);
  }
}

/**
 * Copies `elements` (taken from `source`) so they can live in `target`: returns them renamed to the
 * copies. Items already imported from the same source are reused. Elements from the target's own
 * document come back unchanged.
 */
export async function importElements(source: NativeLoaded, elements: FlaElement[], target: NativeLoaded): Promise<FlaElement[]> {
  if (source.doc === target.doc) return elements;
  const prefix = `Pasted from ${source.doc.name}/`;
  const uses = usesOfElements(source.doc, elements);
  const names: Names = {
    symbol: (item) => prefix + item, bitmap: (name) => prefix + name, brush: (id) => `${prefix}${id}`,
    hasSymbol: (item) => uses.symbols.has(item), hasBitmap: (name) => uses.bitmaps.has(name),
  };
  const lib: ImportedLibrary = empty();
  for (const item of uses.symbols) {
    const symbol = source.doc.symbols.get(item)!;
    lib.symbols[names.symbol(item)] = { ...symbol, name: names.symbol(item), timeline: renameTimeline(symbol.timeline, names) };
  }
  for (const name of uses.bitmaps) {
    const bitmap = source.doc.bitmaps.get(name)!;
    lib.bitmaps[names.bitmap(name)] = { name: names.bitmap(name), width: bitmap.width, height: bitmap.height, data: bitmap.data ? toBase64(bitmap.data) : undefined };
  }
  for (const id of uses.brushes) if (source.doc.brushes[id]) lib.brushes[names.brush(id)] = source.doc.brushes[id];
  await registerLibrary(target, lib);
  // A picture the source already decoded does not need decoding again.
  for (const name of uses.bitmaps) { const image = source.renderer.assets.images.get(name); if (image) target.renderer.assets.images.set(names.bitmap(name), image); }
  return renameElements(elements, names);
}

/** The imported items the given timelines still use (what is worth saving). */
export function libraryUsedBy(doc: FlaDocument, timelines: Timeline[]): ImportedLibrary | undefined {
  const record = importedOf(doc);
  if (!Object.keys(record.symbols).length && !Object.keys(record.bitmaps).length) return undefined;
  const out = empty();
  const seen = new Set<string>();
  const visit = (timeline: Timeline) => {
    for (const layer of timeline.layers) for (const key of layer.frames) for (const el of key.elements) {
      if (el.k === "instance" && record.symbols[el.item] && !seen.has(el.item)) { seen.add(el.item); out.symbols[el.item] = record.symbols[el.item]; visit(record.symbols[el.item].timeline); }
      else if (el.k === "bitmap" && record.bitmaps[el.item]) out.bitmaps[el.item] = record.bitmaps[el.item];
      else if (el.k === "shape") for (const s of [...Object.values(el.strokeStyles), ...el.strokes.map((x) => x.style)]) if (s.brush && record.brushes[s.brush]) out.brushes[s.brush] = record.brushes[s.brush];
    }
  };
  timelines.forEach(visit);
  // Pictures and brushes used by the symbols that came along.
  return Object.keys(out.symbols).length || Object.keys(out.bitmaps).length ? out : undefined;
}
