import type { FlaLayer, FlaSymbol } from "@/components/SymbolTimeline";
import type { SymbolLayerEdit } from "@/types";

/**
 * Layers of a pose as the user has arranged them (step inside): a list of layer ids, top to bottom. A layer of the file has its
 * index in the file as its id; layers added here (a folder, an empty layer) get ids from EXTRA_BASE up. Folder membership is
 * `parents`; whether it is hidden, locked or deleted, and its name, are kept beside. `spec` is what the player is told.
 */
export const EXTRA_BASE = 1000;
export type LayerRow = { id: number; name: string; type: string; parent: number | null; layer: FlaLayer; extra: boolean };

const emptyLayer = (name: string, type: string): FlaLayer => ({ name, type, frames: [], props: [] });

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
  return orderOf(layers, edit).filter((id) => !deleted.has(id)).map((id) => {
    const extra = id >= EXTRA_BASE ? edit?.extras?.find((item) => item.id === id) : undefined;
    const file = id < EXTRA_BASE ? layers[id] : undefined;
    const layer = file || emptyLayer(extra?.name || "Layer", extra?.type || "normal");
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
export function playerSpec(layers: FlaLayer[], edit: SymbolLayerEdit): { order?: string[][]; hidden: string[]; clones?: Array<{ of: string; prop: string; symbol?: string }> } {
  const ids = orderOf(layers, edit), gone = new Set([...(edit.hidden || []), ...(edit.deleted || [])]);
  const hiddenIds = ids.filter((id) => {
    for (let up: number | null = id, guard = 0; up != null && guard < 30; up = parentOf(layers, edit, up), guard += 1) if (gone.has(up)) return true;
    return false;
  });
  const withParts = ids.filter((id) => id < EXTRA_BASE && layers[id]?.props?.length);
  const moved = edit.order && edit.order.length > 0;
  const clones = (edit.clones || []).map((clone) => (clone.symbol ? { of: "", prop: clone.prop, symbol: clone.symbol } : { of: layers[clone.of]?.props?.[0] || "", prop: clone.prop })).filter((clone) => clone.of || clone.symbol);
  return { order: moved ? withParts.map((id) => layers[id].props as string[]) : undefined, hidden: hiddenIds.flatMap((id) => (id < EXTRA_BASE ? layers[id]?.props || [] : [])), clones: clones.length ? clones : undefined };
}

/** The file's layers plus the copies Duplicate Layer made (after them, in the order they were made): a copy starts as the file's layer. */
export function withClones(data: FlaSymbol, clones?: SymbolClone[]): FlaSymbol {
  if (!clones?.length) return data;
  const layers = [...data.layers];
  clones.forEach((clone) => {
    if (clone.symbol) {
      layers.push({ name: clone.symbol.replace(/(?:copy\d*|_\d+)+$/i, "") || "Layer", type: "normal", props: [clone.prop], frames: [{ i: 0, d: Math.max(1, data.frames), symbols: [{ name: clone.symbol }] }] });
      return;
    }
    const source = layers[clone.of];
    if (!source) { layers.push({ name: "Layer", type: "normal", frames: [] }); return; }
    const classes = source.classes && source.props?.[0] && source.classes[source.props[0]] ? { [clone.prop]: source.classes[source.props[0]] } : undefined;
    layers.push({ ...source, name: `${source.name} copy`, props: [clone.prop], classes, frames: source.frames });
  });
  return { ...data, layers };
}

export type SymbolClone = { of: number; prop: string; symbol?: string };

/** A new layer holding one instance of a library symbol (a keyframe over the whole pose), above the layer picked (or on top). */
export function addSymbolLayer(layers: FlaLayer[], edit: SymbolLayerEdit | undefined, symbol: string, above?: number | null): SymbolLayerEdit {
  const base = edit || {}, clones = [...(base.clones || [])];
  const used = clones.reduce((top, clone) => Math.max(top, Number(clone.prop.replace(/\D+/g, "")) || 0), 0);
  const index = layers.length, order = orderOf(layers, edit), parents = { ...(base.parents || {}) };
  clones.push({ of: -1, prop: `cbnew${used + 1}`, symbol });
  const at = above != null && order.includes(above) ? order.indexOf(above) : 0;
  parents[String(index)] = above != null ? parentOf(layers, edit, above) : null;
  return { ...base, clones, order: [...order.slice(0, at), index, ...order.slice(at)], parents };
}

/** A copy of each of these layers, put above the layer it copies (folders, masks and layers with no objects are left out). */
export function duplicateLayers(layers: FlaLayer[], edit: SymbolLayerEdit | undefined, ids: number[], fileCount: number): { edit: SymbolLayerEdit; made: number } {
  const base = edit || {}, clones = [...(base.clones || [])];
  let order = orderOf(layers, edit), made = 0;
  const parents = { ...(base.parents || {}) };
  let used = clones.reduce((top, clone) => Math.max(top, Number(clone.prop.replace(/\D+/g, "")) || 0), 0);
  let count = layers.length;
  order.filter((id) => ids.includes(id)).forEach((id) => {
    const layer = layers[id];
    if (id >= EXTRA_BASE || !layer || layer.type !== "normal" || !layer.props?.length) return;
    used += 1;
    clones.push({ of: id, prop: `cbdup${used}` });
    const index = count;
    count += 1;
    made += 1;
    order = [...order.slice(0, order.indexOf(id)), index, ...order.slice(order.indexOf(id))];
    parents[String(index)] = parentOf(layers, edit, id);
  });
  void fileCount;
  return { edit: { ...base, clones, order, parents }, made };
}

/** Nothing in the edit changes the layers: it can be dropped. */
export const isLayerEditEmpty = (edit: SymbolLayerEdit) =>
  !edit.order && !(edit.names && Object.keys(edit.names).length) && !edit.hidden?.length && !edit.locked?.length && !edit.deleted?.length && !(edit.parents && Object.keys(edit.parents).length) && !edit.extras?.length && !edit.clones?.length;
