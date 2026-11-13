/**
 * Converts the edits older versions of CB Studio saved inside a character (the patch language the
 * Animate player applies: symbolKeys, symbolEases, and later symbolValues/symbolLayers) into native
 * timelines, once, when such a project opens. Pure functions from the file's own layer to the layer
 * those edits made; nothing here touches the player. Keyframe retiming follows lib/symbolKeys.ts
 * (shownFrames), which is how the old timeline drew a layer, so the converted layer has the same
 * spans, tweens and blanks.
 */
import type { BitmapElement, Ease, FlaElement, InstanceElement, Keyframe, Layer, Matrix, Timeline } from "../fla/xfl";
import { easeFunction, lerp, tweenMatrix } from "./evaluate";
import { invert, mul } from "./library";

/** What the file's layer shows at the (possibly fractional) file frame: a classic tween applied between its keys. */
function elementsAtFile(layer: Layer, frame: number): FlaElement[] {
  const index = layer.frames.findIndex((k) => k.i <= frame && frame < k.i + k.d);
  const key = layer.frames[index] ?? layer.frames[layer.frames.length - 1];
  if (!key) return [];
  const next = layer.frames[index + 1];
  if (key.tween === "motion" && next && next.i === key.i + key.d && frame > key.i) {
    const t = easeFunction(key.ease)((frame - key.i) / key.d);
    return key.elements.map((el, i) => {
      const to = next.elements[i];
      if (el.k !== "instance" || to?.k !== "instance") return el;
      return { ...el, m: tweenMatrix(el.m, to.m, el.pivot, t, key.rotate), alpha: lerp(el.alpha ?? 1, to.alpha ?? 1, t) };
    });
  }
  return key.elements;
}

/** The shapes the old editor saved (types/index.ts SymbolKeyEdit / SymbolEaseEdit), kept here so lib/native stands on its own. */
export type SymbolKeyEdit = { props: string[]; anchors: Array<[number, number]>; tweens?: Array<[number, number]>; blanks?: number[]; cut?: number };
export type SymbolEaseEdit = { props: string[]; frame: number; frames: number; value: number };

const NONE = { tween: undefined, ease: undefined, rotate: undefined, morph: undefined } as const;

/** The keyframe edit of one layer (anchors, blanks, made tweens, end cut) applied to the file's layer. */
export function convertKeys(layer: Layer, edit: SymbolKeyEdit): Layer { return convertKeysWithFiles(layer, edit).layer; }

/** Same, also telling which frame of the file each resulting keyframe came from (what the old value edits are keyed by). */
export function convertKeysWithFiles(layer: Layer, edit: SymbolKeyEdit): { layer: Layer; files: number[] } {
  const anchors = edit.anchors;
  if (!anchors || anchors.length < 2 || !layer.frames.length) return { layer, files: layer.frames.map((k) => k.i) };
  const frames: Keyframe[] = [];
  const files: number[] = [];
  for (let k = 0; k + 1 < anchors.length; k += 1) {
    const [file, now] = anchors[k];
    // A keyframe that was cleared or removed has no frames left.
    if (anchors[k + 1][1] <= now) continue;
    if (edit.cut != null && now >= edit.cut) continue;
    const source = [...layer.frames].reverse().find((f) => f.i <= file) || layer.frames[0];
    const added = file !== source.i;
    const blank = !source.elements.length || Boolean(edit.blanks?.includes(file));
    const end = Math.min(anchors[k + 1][1], edit.cut ?? Infinity);
    // A tween made in the editor on a span that holds still: it needs a keyframe after it.
    let next = k + 1;
    while (next < anchors.length - 1 && anchors[next][1] <= now) next += 1;
    const made = !source.tween && !blank && next < anchors.length - 1 ? edit.tweens?.find((t) => t[0] === file) : undefined;
    let key: Keyframe;
    if (blank) key = { i: now, d: end - now, elements: [], ...NONE };
    else if (added) key = { i: now, d: end - now, elements: elementsAtFile(layer, file), tween: source.tween, ease: source.ease, rotate: source.rotate };
    else key = { ...source, i: now, d: end - now };
    // The matched curves belong to the file's own pair of keys; the editor re-matches them.
    if (key.tween === "shape" && (added || key.i !== source.i || key.d !== source.d)) delete key.morph;
    if (made) key = { ...key, tween: "motion", ease: { intensity: -made[1] } };
    frames.push(key);
    files.push(file);
  }
  // A tween only runs into a keyframe that follows right after it.
  const fixed = frames.map((k, i) => (k.tween && !(frames[i + 1] && frames[i + 1].i === k.i + k.d) ? { ...k, ...NONE } : k));
  return { layer: { ...layer, frames: fixed }, files };
}

/** The values the old editor saved for one keyframe (CreateJS names: x, y, scale, skew in degrees, alpha 0–1, registration point). */
export type SymbolValueEdit = { props: string[]; frame: number; v: Partial<Record<"x" | "y" | "scaleX" | "scaleY" | "skewX" | "skewY" | "alpha" | "regX" | "regY", number>> };

const DEG = Math.PI / 180;
/** CreateJS's own properties of a placed instance (the writer's decompose: skew carries any rotation). */
function propsOf(el: InstanceElement | BitmapElement) {
  const m = el.k === "bitmap" && el.local ? mul(el.m, invert(el.local)) : el.m;
  const [a, b, c, d] = m, [rx, ry] = el.k === "instance" ? el.pivot : [0, 0];
  return { x: a * rx + c * ry + el.m[4], y: b * rx + d * ry + el.m[5], scaleX: Math.hypot(a, b), scaleY: Math.hypot(c, d), skewX: Math.atan2(-c, d) / DEG, skewY: Math.atan2(b, a) / DEG, regX: rx, regY: ry, alpha: el.k === "instance" ? el.alpha ?? 1 : 1 };
}
/** The matrix, registration point and alpha CreateJS makes of those properties (Matrix2D.appendTransform with no rotation). */
function elementOf<T extends InstanceElement | BitmapElement>(el: T, p: ReturnType<typeof propsOf>): T {
  const a = Math.cos(p.skewY * DEG) * p.scaleX, b = Math.sin(p.skewY * DEG) * p.scaleX, c = -Math.sin(p.skewX * DEG) * p.scaleY, d = Math.cos(p.skewX * DEG) * p.scaleY;
  const m: Matrix = [a, b, c, d, p.x - (a * p.regX + c * p.regY), p.y - (b * p.regX + d * p.regY)];
  // A picture has no registration point of its own: it is folded into its matrix (which is what the matrix above already did).
  if (el.k === "bitmap") return { ...el, m: el.local ? mul(m, el.local) : m };
  const out = { ...el, m, pivot: [p.regX, p.regY] } as InstanceElement;
  if (p.alpha !== 1 || el.alpha != null) out.alpha = p.alpha;
  return out as T;
}

/** Edited values laid on one keyframe: the named objects take them (the others stay as they are). */
export function applyValues(key: Keyframe, edit: SymbolValueEdit): Keyframe {
  const names = new Set(edit.props || []);
  let changed = false;
  const elements = key.elements.map((el) => {
    if ((el.k !== "instance" && el.k !== "bitmap") || !el.name || !names.has(el.name)) return el;
    const p = propsOf(el);
    for (const [k, v] of Object.entries(edit.v || {})) if (typeof v === "number" && k in p) (p as Record<string, number>)[k] = v;
    changed = true;
    return elementOf(el, p);
  });
  return changed ? { ...key, elements } : key;
}

/** Eases edited on tweens, as "<layer>:<keyframe frame now>" → the edit (value −100 ease in … 100 ease out; the file's own intensity is its negative). */
export function convertEases(layer: Layer, eases: Record<string, SymbolEaseEdit>, layerIndex: number): Layer {
  let changed = false;
  const frames = layer.frames.map((k) => {
    const edit = eases[`${layerIndex}:${k.i}`];
    if (!edit || !k.tween) return k;
    changed = true;
    const ease: Ease = { intensity: -edit.value };
    return { ...k, ease };
  });
  return changed ? { ...layer, frames } : layer;
}

export type LegacySymbolEdits = {
  keys?: Record<string, SymbolKeyEdit>;
  eases?: Record<string, SymbolEaseEdit>;
  /** "<layer>:<file frame>" → values. */
  values?: Record<string, SymbolValueEdit>;
};

/** A symbol's timeline with the old keyframe and ease edits applied; the same timeline when there is nothing to apply. */
export function convertTimeline(timeline: Timeline, edits: LegacySymbolEdits): Timeline {
  let changed = false;
  const layers = timeline.layers.map((layer, index) => {
    let out = layer;
    const keys = edits.keys?.[String(index)];
    let files = layer.frames.map((k) => k.i);
    if (keys) { const done = convertKeysWithFiles(out, keys); out = done.layer; files = done.files; }
    if (edits.values) {
      // Values are keyed by the file's frame; a keyframe the editor added (or moved) is still known by the frame it came from.
      const frames = out.frames.map((k, n) => { const v = edits.values![`${index}:${files[n]}`]; return v ? applyValues(k, v) : k; });
      if (frames.some((k, n) => k !== out.frames[n])) out = { ...out, frames };
    }
    if (edits.eases) out = convertEases(out, edits.eases, index);
    if (out !== layer) changed = true;
    return out;
  });
  if (!changed) return timeline;
  const length = Math.max(1, ...layers.flatMap((l) => l.frames.map((k) => k.i + k.d)));
  return { ...timeline, layers, length };
}

// ---------- layer arrangement (symbolLayers)
const EXTRA_BASE = 1000;
/** How the old editor saved a symbol's layer arrangement (types/index.ts SymbolLayerEdit), without what only the player needed (spec). */
export type SymbolLayerEdit = {
  order?: number[]; names?: Record<string, string>; hidden?: number[]; deleted?: number[]; parents?: Record<string, number | null>;
  extras?: Array<{ id: number; name: string; type: "normal" | "folder" }>;
  clones?: Array<{ of: number; prop: string; symbol?: string; image?: unknown; foreign?: unknown; end?: number; name?: string }>;
};

/** What a layer edit asks for that this converter does not do: pictures, symbols placed from a library, parts of other characters. */
export const unsupportedLayers = (edit: SymbolLayerEdit, prepared?: Array<Layer | undefined>): string[] =>
  (edit.clones || []).filter((c, i) => (c.symbol || c.image || c.foreign || c.of < 0) && !prepared?.[i]).map((c) => `layer ${c.prop} holds ${c.image ? "a picture" : c.foreign ? "a part of another character" : "a library symbol"}`);

/** The file's layers plus the copies Duplicate Layer made (after them, in the order they were made). */
export function addDuplicates(timeline: Timeline, edit: SymbolLayerEdit, prepared?: Array<Layer | undefined>): Timeline {
  const all = [...timeline.layers];
  (edit.clones || []).forEach((c, i) => {
    if (prepared?.[i]) { all.push(prepared[i]!); return; }
    // A copy of a layer (which may itself be an earlier copy) goes by its own name in the old edits' values: the objects take it.
    const source = all[c.of];
    if (!source) { all.push({ name: "Layer", type: "normal", parent: null, hidden: false, frames: [] }); return; }
    all.push({ ...source, name: `${source.name} copy`, frames: source.frames.map((k) => ({ ...k, elements: k.elements.map((el) => (el.k === "shape" ? el : { ...el, name: c.prop })) })) });
  });
  return all.length > timeline.layers.length ? { ...timeline, layers: all } : timeline;
}

/** The layers (file + copies, in `timeline`) as the old editor left them: reordered, renamed, switched off, deleted, put in folders, with empty layers and folders added. */
export function arrangeLayers(timeline: Timeline, edit: SymbolLayerEdit): Timeline {
  const made = timeline.layers;
  const extras = edit.extras || [];
  const byId = (id: number): Layer | undefined => (id >= EXTRA_BASE ? (() => { const e = extras.find((x) => x.id === id); return e ? { name: e.name, type: e.type, parent: null, hidden: false, frames: [] } : undefined; })() : made[id]);
  // The ids top to bottom: the saved order, then anything it does not mention (as lib/symbolLayers.ts orderOf).
  const known = new Set<number>([...made.map((_, i) => i), ...extras.map((e) => e.id)]);
  const saved = (edit.order || []).filter((id) => known.has(id)), seen = new Set(saved);
  const rest = [...extras.map((e) => e.id), ...made.map((_, i) => i)].filter((id) => !seen.has(id));
  const ids = edit.order ? [...saved, ...rest] : [...rest.filter((id) => id >= EXTRA_BASE), ...rest.filter((id) => id < EXTRA_BASE)];
  const deleted = new Set(edit.deleted || []);
  const parentOf = (id: number): number | null => { const p = edit.parents?.[String(id)]; if (p !== undefined) return p; return id < EXTRA_BASE ? made[id]?.parent ?? null : null; };
  const kept = ids.filter((id) => !deleted.has(id) && byId(id));
  const position = new Map(kept.map((id, n) => [id, n]));
  const hidden = new Set<number>(edit.hidden || []);
  const switchedOff = (id: number) => { for (let up: number | null = id, guard = 0; up != null && guard < 30; up = parentOf(up), guard += 1) if (hidden.has(up) || deleted.has(up)) return true; return false; };
  const layers = kept.map((id) => {
    const layer = byId(id)!, parent = parentOf(id);
    const out: Layer = { ...layer, name: edit.names?.[String(id)] ?? layer.name, parent: parent != null && position.has(parent) ? position.get(parent)! : null };
    if (switchedOff(id)) out.off = true;
    return out;
  });
  return { ...timeline, layers, length: Math.max(1, ...layers.flatMap((l) => l.frames.map((k) => k.i + k.d))) };
}

export type LegacySymbol = { keys?: Record<string, SymbolKeyEdit>; eases?: Record<string, SymbolEaseEdit>; values?: Record<string, SymbolValueEdit>; layers?: SymbolLayerEdit };

/** Everything the old editor saved for one symbol, applied to its timeline. `unsupported` lists what could not be converted (then `timeline` is null and the old edit stays in charge). */
export function convertSymbol(timeline: Timeline, edits: LegacySymbol, prepared?: Array<Layer | undefined>): { timeline: Timeline | null; unsupported: string[] } {
  const unsupported = edits.layers ? unsupportedLayers(edits.layers, prepared) : [];
  if (unsupported.length) return { timeline: null, unsupported };
  let out = edits.layers ? addDuplicates(timeline, edits.layers, prepared) : timeline;
  out = convertTimeline(out, { keys: edits.keys, eases: edits.eases, values: edits.values });
  if (edits.layers) out = arrangeLayers(out, edits.layers);
  return { timeline: out, unsupported: [] };
}

// ---------- a whole character
const plain = (name: string) => (name.split("/").pop() || name).toLowerCase().replace(/[^a-z0-9]/g, "");

export type LegacyFields = {
  keys?: Record<string, Record<string, SymbolKeyEdit>>;
  eases?: Record<string, Record<string, SymbolEaseEdit>>;
  values?: Record<string, Record<string, SymbolValueEdit>>;
  layers?: Record<string, SymbolLayerEdit>;
};

/**
 * The old per-symbol edits of a placed character as native timelines, by library name. The old edits name
 * symbols by their player class (Symbol9, Headcopy2), the file by its library name (Symbol 9, Head copy 2):
 * they are matched ignoring spaces, punctuation and case (`known` gives the exact name where the character's index says so). A class that matches no symbol (or two), or whose
 * edit uses something not converted, is listed in `left` and gets no timeline: the old edit stays in charge there.
 */
export function convertLegacy(symbols: Map<string, { timeline: Timeline }>, fields: LegacyFields, known: Record<string, string> = {}, prepared: Record<string, Array<Layer | undefined>> = {}): { symbols: Record<string, Timeline>; converted: string[]; left: string[] } {
  const byPlain = new Map<string, string[]>();
  for (const name of symbols.keys()) byPlain.set(plain(name), [...(byPlain.get(plain(name)) || []), name]);
  const classes = new Set([...Object.keys(fields.keys || {}), ...Object.keys(fields.eases || {}), ...Object.keys(fields.values || {}), ...Object.keys(fields.layers || {})]);
  const out: Record<string, Timeline> = {}, converted: string[] = [], left: string[] = [];
  for (const cls of classes) {
    // The pose's own class is told (its library name comes from the character's index); otherwise a symbol in the library's top level beats ones in folders (copies of it).
    let found = known[cls] && symbols.has(known[cls]) ? [known[cls]] : byPlain.get(plain(cls)) || [];
    if (found.length > 1) { const top = found.filter((name) => !name.includes("/")); if (top.length === 1) found = top; }
    if (found.length !== 1) { left.push(`${cls} (${found.length ? "more than one symbol of that name" : "not in the Animate file"})`); continue; }
    const result = convertSymbol(symbols.get(found[0])!.timeline, { keys: fields.keys?.[cls], eases: fields.eases?.[cls], values: fields.values?.[cls], layers: fields.layers?.[cls] }, prepared[cls]);
    if (!result.timeline) { left.push(`${cls} (${result.unsupported.join(", ")})`); continue; }
    out[found[0]] = result.timeline;
    converted.push(cls);
  }
  return { symbols: out, converted, left };
}
