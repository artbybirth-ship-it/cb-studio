import type { FlaLayer, FlaSymbol } from "@/components/SymbolTimeline";
import type { PoseForeign, SymbolLayerEdit } from "@/types";

/**
 * Layers of a pose as the user has arranged them (step inside): a list of layer ids, top to bottom. A layer of the file has its
 * index in the file as its id; layers added here (a folder, an empty layer) get ids from EXTRA_BASE up. Folder membership is
 * `parents`; whether it is hidden, locked or deleted, and its name, are kept beside. `spec` is what the player is told.
 */
export const EXTRA_BASE = 1000;
export type LayerRow = { id: number; name: string; type: string; parent: number | null; layer: FlaLayer; extra: boolean };

/** A new layer starts as Animate's does: a blank keyframe on its first frame, lasting the whole pose, split again at every blank keyframe
 *  put on it since (folders hold no frames). */
const emptyLayer = (name: string, type: string, total = 0, keys: number[] = []): FlaLayer => {
  if (type === "folder" || total <= 0) return { name, type, frames: [], props: [] };
  const starts = [...new Set([0, ...keys.filter((key) => key > 0 && key < total)])].sort((a, b) => a - b);
  return { name, type, frames: starts.map((start, at) => ({ i: start, d: (starts[at + 1] ?? total) - start, blank: true })), props: [] };
};

/** The ids in order (top to bottom): the saved order, then anything it does not mention. */
export function orderOf(layers: FlaLayer[], edit?: SymbolLayerEdit): number[] {
  const known = new Set<number>([...layers.map((_, index) => index), ...(edit?.extras || []).map((extra) => extra.id)]);
  const order = (edit?.order || []).filter((id) => known.has(id));
  const seen = new Set(order);
  const rest = [...(edit?.extras || []).map((extra) => extra.id), ...layers.map((_, index) => index)].filter((id) => !seen.has(id));
  return edit?.order ? [...order, ...rest] : [...rest.filter((id) => id >= EXTRA_BASE), ...rest.filter((id) => id < EXTRA_BASE)];
}

export const parentOf = (layers: FlaLayer[], edit: SymbolLayerEdit | undefined, id: number): number | null => {
  const saved = edit?.parents?.[String(id)];
  if (saved !== undefined) return saved;
  return id < EXTRA_BASE ? layers[id]?.parent ?? null : null;
};

/** The layers to list, top to bottom (deleted ones are left out). */
export function layerRows(layers: FlaLayer[], edit?: SymbolLayerEdit): LayerRow[] {
  const deleted = new Set(edit?.deleted || []);
  const total = Math.max(0, ...layers.flatMap((layer) => layer.frames.map((frame) => frame.i + frame.d)));
  return orderOf(layers, edit).filter((id) => !deleted.has(id)).map((id) => {
    const extra = id >= EXTRA_BASE ? edit?.extras?.find((item) => item.id === id) : undefined;
    const file = id < EXTRA_BASE ? layers[id] : undefined;
    const layer = file || emptyLayer(extra?.name || "Layer", extra?.type || "normal", total, extra?.keys);
    return { id, name: edit?.names?.[String(id)] ?? extra?.name ?? layer.name, type: extra?.type || layer.type, parent: parentOf(layers, edit, id), layer, extra: Boolean(extra) };
  });
}

/** Every layer below a folder (or below a mask: the layers it masks), as ids. */
export function descendants(layers: FlaLayer[], edit: SymbolLayerEdit | undefined, id: number): number[] {
  const ids = orderOf(layers, edit), out: number[] = [];
  for (const other of ids) {
    for (let up: number | null = parentOf(layers, edit, other), guard = 0; up != null && guard < 30; up = parentOf(layers, edit, up), guard += 1) {
      if (up === id) { out.push(other); break; }
    }
  }
  return out;
}

/** A mask layer and the layers it masks stay together: they cannot be moved or dropped into on their own. */
export function lockedTogether(layers: FlaLayer[], edit: SymbolLayerEdit | undefined, id: number): boolean {
  const type = id < EXTRA_BASE ? layers[id]?.type : "normal";
  const parent = parentOf(layers, edit, id);
  const parentType = parent == null ? "" : parent < EXTRA_BASE ? layers[parent]?.type : "folder";
  return type === "mask" || type === "guide" || parentType === "mask" || parentType === "guide";
}

/** Moves layers (and what is below a folder among them) before / after a layer, or into a folder. Null when it cannot be done. */
export function moveLayers(layers: FlaLayer[], edit: SymbolLayerEdit | undefined, ids: number[], targetId: number, where: "before" | "after" | "into"): SymbolLayerEdit | null {
  const base = edit || {};
  if (ids.includes(targetId) || ids.some((id) => lockedTogether(layers, edit, id)) || lockedTogether(layers, edit, targetId)) return null;
  const moving = new Set<number>();
  ids.forEach((id) => { moving.add(id); descendants(layers, edit, id).forEach((below) => moving.add(below)); });
  if (moving.has(targetId)) return null;
  const order = orderOf(layers, edit), block = order.filter((id) => moving.has(id)), rest = order.filter((id) => !moving.has(id));
  let at = rest.indexOf(targetId);
  if (at < 0) return null;
  const targetParent = parentOf(layers, edit, targetId);
  const parents = { ...(base.parents || {}) };
  const folderEnd = (folder: number) => { let end = rest.indexOf(folder); rest.forEach((id, index) => { if (descendants(layers, edit, folder).includes(id)) end = Math.max(end, index); }); return end; };
  if (where === "into") { at = rest.indexOf(targetId) + 1; ids.forEach((id) => { parents[String(id)] = targetId; }); }
  else {
    if (where === "after") at = (targetId < EXTRA_BASE && layers[targetId]?.type === "folder") || (targetId >= EXTRA_BASE && base.extras?.find((extra) => extra.id === targetId)?.type === "folder") ? folderEnd(targetId) + 1 : at + 1;
    ids.forEach((id) => { parents[String(id)] = targetParent; });
  }
  rest.splice(at, 0, ...block);
  return { ...base, order: rest, parents };
}

/** Puts these layers into a new folder (where the top one was). Null when a mask layer is among them. */
export function groupLayers(layers: FlaLayer[], edit: SymbolLayerEdit | undefined, ids: number[]): SymbolLayerEdit | null {
  const order = orderOf(layers, edit), picked = order.filter((id) => ids.includes(id));
  if (!picked.length) return null;
  const withFolder = addLayer(layers, edit, "folder", picked[0]);
  const folder = withFolder.extras![withFolder.extras!.length - 1].id;
  return moveLayers(layers, withFolder, picked, folder, "into");
}

/** Takes the layers out of a folder (they go to the folder's own parent) and removes the folder. */
export function ungroupLayer(layers: FlaLayer[], edit: SymbolLayerEdit | undefined, folder: number): SymbolLayerEdit {
  const base = edit || {}, parents = { ...(base.parents || {}) }, above = parentOf(layers, edit, folder);
  orderOf(layers, edit).forEach((id) => { if (parentOf(layers, edit, id) === folder) parents[String(id)] = above; });
  return { ...base, parents, deleted: [...new Set([...(base.deleted || []), folder])] };
}

export const toggled = (list: number[] | undefined, ids: number[]) => {
  const have = new Set(list || []), all = ids.every((id) => have.has(id));
  ids.forEach((id) => (all ? have.delete(id) : have.add(id)));
  return [...have];
};

/** A new folder or empty layer above the layer picked (or at the top). */
export function addLayer(layers: FlaLayer[], edit: SymbolLayerEdit | undefined, type: "normal" | "folder", above?: number | null): SymbolLayerEdit {
  const base = edit || {};
  const id = Math.max(EXTRA_BASE - 1, ...(base.extras || []).map((extra) => extra.id)) + 1;
  const name = type === "folder" ? `Folder ${(base.extras || []).filter((extra) => extra.type === "folder").length + 1}` : `Layer ${(base.extras || []).filter((extra) => extra.type === "normal").length + 1}`;
  const order = orderOf(layers, edit), at = above != null && order.includes(above) ? order.indexOf(above) : 0;
  const parents = { ...(base.parents || {}) };
  parents[String(id)] = above != null ? parentOf(layers, edit, above) : null;
  return { ...base, extras: [...(base.extras || []), { id, name, type }], order: [...order.slice(0, at), id, ...order.slice(at)], parents };
}

/** What the player is told: the file layers' objects top to bottom, and the objects to hide (hidden, deleted, or under a hidden folder). */
export function playerSpec(layers: FlaLayer[], edit: SymbolLayerEdit): { order?: string[][]; hidden: string[]; clones?: Array<{ of: string; prop: string; symbol?: string; image?: PoseImage; foreign?: PoseForeign; end?: number }> } {
  const ids = orderOf(layers, edit), gone = new Set([...(edit.hidden || []), ...(edit.deleted || [])]);
  const single = edit.deletedProps || [];
  const hiddenIds = ids.filter((id) => {
    for (let up: number | null = id, guard = 0; up != null && guard < 30; up = parentOf(layers, edit, up), guard += 1) if (gone.has(up)) return true;
    return false;
  });
  const withParts = ids.filter((id) => id < EXTRA_BASE && layers[id]?.props?.length);
  const moved = edit.order && edit.order.length > 0;
  const clones = (edit.clones || []).map((clone) => (clone.symbol || clone.image ? { of: "", prop: clone.prop, symbol: clone.symbol, image: clone.image, foreign: clone.foreign, end: clone.end } : { of: layers[clone.of]?.props?.[0] || "", prop: clone.prop })).filter((clone) => clone.of || clone.symbol || clone.image);
  return { order: moved ? withParts.map((id) => layers[id].props as string[]) : undefined, hidden: [...new Set([...hiddenIds.flatMap((id) => (id < EXTRA_BASE ? layers[id]?.props || [] : [])), ...single])], clones: clones.length ? clones : undefined };
}

/** The file's layers plus the copies Duplicate Layer made (after them, in the order they were made): a copy starts as the file's layer. */
/**
 * Symbols that came from another character are named "<tag>~<class>" wherever the editor and the player talk about them (the
 * keys of the edits made inside them, the player's own name for their clips), because two characters often have a symbol of
 * the same class name ("Symbol2"): the tag is the first 8 characters of the id of the character's library folder.
 * public/vendor/cb-animate-bridge.js makes the same tag from the library's script address.
 */
export const foreignTag = (lib: string) => ((lib.match(/character_libraries\/([^/]+)/)?.[1]) || "x").slice(0, 8);
export const qualifiedClass = (tag: string, cls: string) => `${tag}~${cls}`;
/** "tag~Class" → [tag, Class]; a plain class → [null, class]. */
export const splitClass = (name: string): [string | null, string] => { const at = name.indexOf("~"); return at > 0 ? [name.slice(0, at), name.slice(at + 1)] : [null, name]; };
/** A symbol file read from another character, its classes qualified (the symbol's own and those of the objects inside it). */
export function qualifySymbol(data: FlaSymbol, tag: string): FlaSymbol {
  const symbolsOf = (frames: FlaLayer["frames"]) => frames.map((frame) => (frame.symbols ? { ...frame, symbols: frame.symbols.map((item) => (item.js ? { ...item, js: qualifiedClass(tag, item.js) } : item)) } : frame));
  return {
    ...data, js: qualifiedClass(tag, data.js),
    layers: data.layers.map((layer) => ({
      ...layer, frames: symbolsOf(layer.frames),
      ...(layer.classes ? { classes: Object.fromEntries(Object.entries(layer.classes).map(([prop, cls]) => [prop, qualifiedClass(tag, cls)])) } : {}),
    })),
  };
}

export function withClones(data: FlaSymbol, clones?: SymbolClone[]): FlaSymbol {
  if (!clones?.length) return data;
  const layers = [...data.layers];
  clones.forEach((clone) => {
    if (clone.symbol || clone.image) {
      const name = clone.name || (clone.image ? clone.image.name || "Picture" : clone.symbol!.replace(/(?:copy\d*|_\d+)+$/i, "") || "Layer");
      const shown = Math.max(1, Math.min(data.frames, clone.end ?? data.frames));
      const cls = clone.symbol ? (clone.foreign ? qualifiedClass(foreignTag(clone.foreign.lib), clone.symbol) : clone.symbol) : "";
      const body = clone.image ? { bitmaps: 1 } : { symbols: [{ name: clone.symbol!, js: cls }] };
      // A symbol clone can be stepped into: the class its object has (qualified when it came from another character).
      const classes = clone.symbol ? { [clone.prop]: cls } : undefined;
      layers.push({ name, type: "normal", props: [clone.prop], ...(classes ? { classes } : {}), frames: shown < data.frames ? [{ i: 0, d: shown, ...body }, { i: shown, d: data.frames - shown, blank: true, ended: true }] : [{ i: 0, d: shown, ...body }] });
      return;
    }
    const source = layers[clone.of];
    if (!source) { layers.push({ name: "Layer", type: "normal", frames: [] }); return; }
    const classes = source.classes && source.props?.[0] && source.classes[source.props[0]] ? { [clone.prop]: source.classes[source.props[0]] } : undefined;
    layers.push({ ...source, name: `${source.name} copy`, props: [clone.prop], classes, frames: source.frames });
  });
  return { ...data, layers };
}

export type PoseImage = { url: string; w: number; h: number; name: string; keep?: boolean };
export type SymbolClone = { of: number; prop: string; symbol?: string; image?: PoseImage; foreign?: PoseForeign; end?: number; name?: string };

/** A new layer holding one instance of a library symbol (a keyframe over the whole pose), above the layer picked (or on top). */
export function addSymbolLayer(layers: FlaLayer[], edit: SymbolLayerEdit | undefined, symbol: string | PoseImage | { symbol: string; name: string; foreign: PoseForeign }, above?: number | null): SymbolLayerEdit {
  const base = edit || {}, clones = [...(base.clones || [])];
  const used = clones.reduce((top, clone) => Math.max(top, Number(clone.prop.replace(/\D+/g, "")) || 0), 0);
  const index = layers.length, order = orderOf(layers, edit), parents = { ...(base.parents || {}) };
  clones.push(typeof symbol === "string" ? { of: -1, prop: `cbnew${used + 1}`, symbol } : "foreign" in symbol ? { of: -1, prop: `cbnew${used + 1}`, symbol: symbol.symbol, name: symbol.name, foreign: symbol.foreign } : { of: -1, prop: `cbnew${used + 1}`, image: symbol });
  const at = above != null && order.includes(above) ? order.indexOf(above) : 0;
  parents[String(index)] = above != null ? parentOf(layers, edit, above) : null;
  return { ...base, clones, order: [...order.slice(0, at), index, ...order.slice(at)], parents };
}

/** A copy of each of these layers: just above the layer it copies, or on top of all layers, or at the bottom (folders, masks and layers with no objects are left out). */
export function duplicateLayers(layers: FlaLayer[], edit: SymbolLayerEdit | undefined, ids: number[], fileCount: number, place: "above" | "front" | "back" = "above"): { edit: SymbolLayerEdit; made: number; pairs: Array<{ from: number; to: number; prop: string }> } {
  const base = edit || {}, clones = [...(base.clones || [])], pairs: Array<{ from: number; to: number; prop: string }> = [];
  let order = orderOf(layers, edit), made = 0, top = 0;
  const parents = { ...(base.parents || {}) };
  let used = clones.reduce((most, clone) => Math.max(most, Number(clone.prop.replace(/\D+/g, "")) || 0), 0);
  let count = layers.length;
  order.filter((id) => ids.includes(id)).forEach((id) => {
    const layer = layers[id];
    if (id >= EXTRA_BASE || !layer || layer.type !== "normal" || !layer.props?.length) return;
    used += 1;
    const prop = `cbdup${used}`;
    clones.push({ of: id, prop });
    const index = count;
    count += 1;
    made += 1;
    pairs.push({ from: id, to: index, prop });
    if (place === "front") { order = [...order.slice(0, top), index, ...order.slice(top)]; top += 1; parents[String(index)] = null; }
    else if (place === "back") { order = [...order, index]; parents[String(index)] = null; }
    else { order = [...order.slice(0, order.indexOf(id)), index, ...order.slice(order.indexOf(id))]; parents[String(index)] = parentOf(layers, edit, id); }
  });
  void fileCount;
  return { edit: { ...base, clones, order, parents }, made, pairs };
}

/** Moves layers one step up / down among their neighbours, or to the top / bottom (Bring Forward, Send Backward, to Front, to Back). Null when nothing moves. */
export function arrangeSymbolLayers(layers: FlaLayer[], edit: SymbolLayerEdit | undefined, ids: number[], how: "forward" | "backward" | "front" | "back"): SymbolLayerEdit | null {
  const deleted = new Set(edit?.deleted || []);
  const order = orderOf(layers, edit).filter((id) => !deleted.has(id));
  const picked = order.filter((id) => ids.includes(id));
  if (!picked.length) return null;
  let next: SymbolLayerEdit | null = edit || {};
  const sameParent = (id: number) => order.filter((other) => parentOf(layers, edit, other) === parentOf(layers, edit, id));
  const group = how === "forward" || how === "front" ? picked : [...picked].reverse();
  for (const id of group) {
    const siblings = sameParent(id).filter((other) => !ids.includes(other) || other === id), at = siblings.indexOf(id);
    let target: number | undefined, where: "before" | "after" = "before";
    if (how === "front") target = siblings.find((other) => !ids.includes(other)), where = "before";
    else if (how === "back") { target = [...siblings].reverse().find((other) => !ids.includes(other)); where = "after"; }
    else if (how === "forward") { target = siblings.slice(0, at).reverse().find((other) => !ids.includes(other)); where = "before"; }
    else { target = siblings.slice(at + 1).find((other) => !ids.includes(other)); where = "after"; }
    if (target == null) continue;
    const moved = moveLayers(layers, next, [id], target, where);
    if (moved) next = moved;
  }
  return next && next !== (edit || {}) ? next : null;
}

/** Nothing in the edit changes the layers: it can be dropped. */
export const isLayerEditEmpty = (edit: SymbolLayerEdit) =>
  !edit.order && !(edit.names && Object.keys(edit.names).length) && !edit.hidden?.length && !edit.locked?.length && !edit.deleted?.length && !edit.deletedProps?.length && !(edit.parents && Object.keys(edit.parents).length) && !edit.extras?.length && !edit.clones?.length;
