import type { CharacterKeyframe, EditorObject } from "@/types";

/**
 * Timeline layers that hold several objects (Merge Layers, Animate style). Objects keep their own
 * entries in the scene (exports and both backends read them as before); a shared `layer` tag puts
 * them on one timeline row. An object without a tag is a layer of its own, keyed by its id.
 */
export const layerKeyOf = (object: EditorObject) => object.layer || object.id;

/** The objects on a layer, bottom to top (scene order). */
export const layerMembers = (objects: EditorObject[], key: string) => objects.filter((item) => layerKeyOf(item) === key);

/**
 * ⌘G groups on the timeline (like a symbol in Animate): a group's objects show as one row, keyed
 * "group:<id>", until the group is entered; then the timeline shows only the group's own layers.
 */
const GROUP_ROW = "group:";
export const isGroupRow = (key: string | null | undefined) => Boolean(key && key.startsWith(GROUP_ROW));
export const groupOfRow = (key: string) => key.slice(GROUP_ROW.length);
/** The timeline row an object is on: its group's row (unless that group is entered), else its layer. */
export const rowKeyOf = (object: EditorObject, enteredGroup?: string | null) =>
  (object.group && object.group !== enteredGroup ? `${GROUP_ROW}${object.group}` : layerKeyOf(object));
/** The objects on a row (a group row: every object of the group), bottom to top. */
export const rowMembersOf = (objects: EditorObject[], key: string) =>
  (isGroupRow(key) ? objects.filter((item) => item.group === groupOfRow(key)) : layerMembers(objects, key));

/**
 * Who may share a layer: anything except characters; a character's layer holds just that
 * character — except body-part layers (Distribute to Layers) of one character, which may share.
 */
export function canShareLayer(objects: EditorObject[]) {
  const things = objects.filter((item) => item.type !== "empty");
  const characters = things.filter((item) => item.type === "character");
  if (!characters.length) return true;
  return characters.length === things.length && characters.every((item) => item.onlyParts?.length && item.assetUrl === characters[0].assetUrl);
}

/**
 * One timeline row per layer, bottom to top like the scene (the timeline lists them top first). A
 * layer of one object is that object itself; a layer of several, or a ⌘G group, is a combined row:
 * one frame span over all of them, and their keyframes. Rows are ordered by each one's top object.
 * Inside an entered group only the group's own layers are listed.
 */
export function timelineRows(allObjects: EditorObject[], enteredGroup?: string | null): EditorObject[] {
  const objects = enteredGroup ? allObjects.filter((item) => item.group === enteredGroup) : allObjects;
  const keyOf = (item: EditorObject) => rowKeyOf(item, enteredGroup);
  const topIndex = new Map<string, number>();
  objects.forEach((item, index) => topIndex.set(keyOf(item), index));
  const keys = Array.from(topIndex.keys()).sort((a, b) => topIndex.get(a)! - topIndex.get(b)!);
  return keys.map((key) => {
    const members = objects.filter((item) => keyOf(item) === key);
    if (members.length === 1 && members[0].id === key) return members[0];
    const top = members[members.length - 1];
    const groupName = isGroupRow(key) ? top.groupName || "Group" : null;
    const starts = members.map((item) => Math.max(0, Number(item.startTime || 0)));
    const start = Math.min(...starts);
    const openEnded = members.some((item) => !item.actionDurationMs);
    const end = Math.max(...members.map((item, index) => starts[index] + Number(item.actionDurationMs || 0) / 1000));
    const characters = members.filter((item) => item.type === "character");
    // Keyframe marks of every object (their tween arrows are left out: they belong to one object each).
    // A group's row shows the group's own motion (keyframes and tweens).
    const keyframes: CharacterKeyframe[] = isGroupRow(key)
      ? (top.groupMotion?.keyframes || []).map((frame) => ({ id: frame.id, time: frame.time, x: frame.x, y: frame.y, rotation: frame.rotation, scale: frame.scale, tween: frame.tween }))
      : characters.flatMap((item) => (item.keyframes || []).map((frame) => ({ ...frame, tween: members.length > 1 ? false as const : frame.tween })));
    const sameType = members.every((item) => item.type === top.type);
    return {
      ...top,
      id: key,
      type: sameType ? top.type : characters.length ? "character" : "prop",
      // The row shows the group's name, the layer's own name (layerName, kept on every object), else its objects' names, top first.
      name: groupName || top.layerName || [...members].reverse().map((item) => item.name).join(", "),
      layerName: groupName || top.layerName,
      startTime: start,
      actionDurationMs: openEnded ? undefined : (end - start) * 1000,
      keyframes,
      partKeyframes: {},
      animationClips: [],
      manualMotionRange: null,
      sourceAnimationClips: [],
      hidden: members.every((item) => item.hidden),
      locked: members.every((item) => item.locked),
      loopMode: characters.some((item) => item.loopMode === "loop") ? "loop" : top.loopMode,
      assetKind: characters.length && characters.every((item) => item.assetKind === "animate-createjs") ? "animate-createjs" : top.assetKind,
    };
  });
}

/**
 * Copies (paste, ⌥-drag) get layers and ⌘G groups of their own: copies that shared a merged layer
 * or a group share a new one, never the originals'; a lone copy is a plain object again.
 */
export function retagCopies(copies: EditorObject[], stamp: number) {
  for (const field of ["layer", "group"] as const) {
    const counts = new Map<string, number>();
    copies.forEach((copy) => { const tag = copy[field]; if (tag) counts.set(tag, (counts.get(tag) || 0) + 1); });
    const fresh = new Map<string, string>();
    for (const copy of copies) {
      const tag = copy[field];
      if (!tag) continue;
      if ((counts.get(tag) || 0) < 2) {
        delete copy[field];
        if (field === "layer") delete copy.layerName;
        continue;
      }
      if (!fresh.has(tag)) fresh.set(tag, `${field}-${stamp.toString(36)}-${fresh.size}`);
      copy[field] = fresh.get(tag);
    }
  }
  return copies;
}

/** Rebuilds the stacking order from row keys (bottom to top), each row's objects kept together. The
 *  rows' objects take the places they held among themselves (inside a group: only the group's). */
export function orderByLayers(objects: EditorObject[], keysBottomUp: string[]): EditorObject[] {
  const ordered = keysBottomUp.flatMap((key) => rowMembersOf(objects, key));
  const moving = new Set(ordered);
  if (moving.size !== ordered.length) return objects;
  let next = 0;
  return objects.map((item) => (moving.has(item) ? ordered[next++] : item));
}
