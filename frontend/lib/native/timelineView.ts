/**
 * The native timeline shown in the scene editor's own timeline panel (components/SymbolTimeline.tsx): one timeline UI for every pose,
 * native or not. The panel draws a symbol from the data the older pose view gave it (FlaSymbol) with the edits laid over it; here the native
 * timeline, edits and all, is that data, so nothing is laid over it. Its layer arrangement (order, folders, names, eye, padlock, delete,
 * new layers) comes back as the older pose view's SymbolLayerEdit and is turned into native layers here.
 */
import type { FlaFrame, FlaLayer, FlaSymbol } from "../../components/SymbolTimeline";
import type { SymbolLayerEdit } from "../../types";
import { EXTRA_BASE, orderOf, parentOf } from "../symbolLayers";
import type { Keyframe, Layer, Timeline } from "../fla/xfl";
import { autoNameAt, autoNames, layerKey, type AutoNames } from "./names";

const short = (name: string) => name.split("/").pop() || name;

/** The panel's ease number for a tween: the file's own (Animate's acceleration); "custom" for a curve; none for a plain tween. */
const easeOf = (k: Keyframe): FlaFrame["ease"] => {
  if (!k.tween || !k.ease) return undefined;
  if (k.ease.custom?.length || (k.ease.method && k.ease.method !== "none")) return "custom";
  return k.ease.intensity ? k.ease.intensity : undefined;
};

/** The names the player knows the parts of one layer by (each part's own name, else the name the player gives an unnamed one). */
function namesOnLayer(layers: Layer[], index: number, names: AutoNames | undefined): string[] {
  const out: string[] = [];
  const key = layerKey(layers, index);
  for (const k of layers[index].frames) k.elements.forEach((el, e) => {
    if (el.k !== "instance" && el.k !== "bitmap") return;
    const name = el.name || autoNameAt(names, key, k.i, e);
    if (name && !out.includes(name)) out.push(name);
  });
  return out;
}

/**
 * The panel's data for a native timeline: its layers as they are now (no arrangement edit laid over them), each keyframe with its tween, ease,
 * label, sound and what it holds. `original` is the file's own timeline of the symbol (the player's part names are worked out from it);
 * `classOf` gives a library item's player class (stepping into a part goes by it).
 */
export function flaSymbolOf(timeline: Timeline, opts: { name: string; js: string; fps: number; original?: Timeline; classOf: (item: string) => string }): FlaSymbol {
  const names = opts.original ? autoNames(opts.original) : undefined;
  // The file's own layer of each layer (by the name the file gave it): edits saved before colours and sounds were read lack them.
  const fileLayers = new Map((opts.original?.layers || []).map((l, i) => [layerKey(opts.original!.layers, i), l] as const));
  const layers: FlaLayer[] = timeline.layers.map((layer, index) => {
    const fileLayer = fileLayers.get(layerKey(timeline.layers, index));
    const color = layer.color ?? fileLayer?.color;
    const props = namesOnLayer(timeline.layers, index, names);
    const classes: Record<string, string> = {};
    const key = layerKey(timeline.layers, index);
    for (const k of layer.frames) k.elements.forEach((el, e) => {
      if (el.k !== "instance") return;
      const name = el.name || autoNameAt(names, key, k.i, e);
      if (name && !classes[name]) classes[name] = opts.classOf(el.item);
    });
    const frames: FlaFrame[] = layer.frames.map((k) => {
      const sound = k.sound ?? fileLayer?.frames.find((f) => f.i === k.i)?.sound;
      const symbols = k.elements.flatMap((el) => (el.k === "instance" ? [{ name: el.item, js: opts.classOf(el.item) }] : []))
        .filter((s, n, all) => all.findIndex((t) => t.name === s.name) === n);
      const shapes = k.elements.filter((el) => el.k === "shape").length, bitmaps = k.elements.filter((el) => el.k === "bitmap").length;
      return {
        i: k.i, d: k.d,
        ...(k.tween ? { tween: k.tween === "shape" ? "shape" as const : "classic" as const } : {}),
        ...(easeOf(k) !== undefined ? { ease: easeOf(k) } : {}),
        ...(k.label ? { label: k.label } : {}),
        ...(sound ? { sound } : {}),
        ...(symbols.length ? { symbols } : {}),
        ...(shapes ? { shapes } : {}),
        ...(bitmaps ? { bitmaps } : {}),
        // As the file's own timeline data has it: a keyframe with a sound is not blank (its sound shows on it).
        ...(!k.elements.length && !sound ? { blank: true } : {}),
      };
    });
    return {
      name: layer.name, type: layer.type, ...(layer.parent != null ? { parent: layer.parent } : {}), ...(color ? { color } : {}),
      frames, props, classes,
    };
  });
  return { version: 1, js: opts.js, fps: opts.fps, name: short(opts.name), frames: Math.max(1, timeline.length), layers };
}

/** The layers are as the file has them: same layers in the same order, names and folders, none switched off or locked (no "reset layers" to offer). */
export const asTheFileHasThem = (timeline: Timeline, original: Timeline | undefined): boolean => Boolean(original) && timeline.layers.length === original!.layers.length
  && timeline.layers.every((l, i) => !l.off && !l.locked && l.name === original!.layers[i].name && (l.fileName ?? l.name) === original!.layers[i].name && l.parent === original!.layers[i].parent);

/** The panel's arrangement edit for the native layers as they are: only the eye and the padlock (the order and names are the layers' own). */
export const arrangementOf = (timeline: Timeline): SymbolLayerEdit => ({
  hidden: timeline.layers.flatMap((l, i) => (l.off ? [i] : [])),
  locked: timeline.layers.flatMap((l, i) => (l.locked ? [i] : [])),
});

/**
 * The native layers after the panel changed the arrangement (`next`, made from arrangementOf's): reordered, put in or out of folders, renamed,
 * switched off / on, locked, deleted, and new empty layers or folders added (as Animate makes them: one blank keyframe for the whole timeline).
 */
export function arrangeNative(timeline: Timeline, fla: FlaLayer[], next: SymbolLayerEdit): Layer[] {
  const deleted = new Set(next.deleted || []), hidden = new Set(next.hidden || []), locked = new Set(next.locked || []);
  const ids = orderOf(fla, next).filter((id) => !deleted.has(id));
  const total = Math.max(1, timeline.length);
  const made = ids.map((id) => {
    if (id < EXTRA_BASE) return timeline.layers[id];
    const extra = next.extras?.find((x) => x.id === id);
    const type = extra?.type || "normal";
    const layer: Layer = { name: extra?.name || "Layer", type, parent: null, hidden: false, fileName: "", frames: type === "folder" ? [] : [{ i: 0, d: total, elements: [] }] };
    return layer;
  });
  const position = new Map(ids.map((id, n) => [id, n]));
  return made.flatMap((layer, n) => {
    if (!layer) return [];
    const id = ids[n];
    const parent = parentOf(fla, next, id);
    const out: Layer = { ...layer, name: next.names?.[String(id)] ?? layer.name, parent: parent != null && position.has(parent) ? position.get(parent)! : null };
    // The name the file has stays with the layer when it is renamed (the player's part names are worked out by it).
    if (out.name !== layer.name && layer.fileName === undefined) out.fileName = layer.name;
    if (hidden.has(id)) out.off = true; else delete out.off;
    if (locked.has(id)) out.locked = true; else delete out.locked;
    return [out];
  });
}

/**
 * "Put the layers back as the .fla has them": the file's layers in the file's order, names, folders, shown and unlocked, each keeping its
 * keyframes as edited (a deleted one comes back as the file has it). Layers the file does not have (new, duplicated, pasted) go.
 */
export function fileArrangement(timeline: Timeline, original: Timeline): Layer[] {
  const now = new Map(timeline.layers.map((l, i) => [layerKey(timeline.layers, i), l] as const));
  return original.layers.map((file, i) => {
    const kept = now.get(layerKey(original.layers, i));
    const out: Layer = { ...(kept || file), name: file.name, parent: file.parent };
    delete out.off; delete out.locked; delete out.fileName;
    return out;
  });
}

/** Where each layer (by its index before) is after the arrangement `next`: the layers of a picked part stay picked once they move. */
export function arrangedPositions(fla: FlaLayer[], next: SymbolLayerEdit): Map<number, number> {
  const deleted = new Set(next.deleted || []);
  return new Map(orderOf(fla, next).filter((id) => !deleted.has(id)).map((id, n) => [id, n] as const).filter(([id]) => id < EXTRA_BASE));
}
