import type { CharacterPartKey, EditorObject } from "@/types";
import { resolvePartTransformAtTime } from "@/lib/partKeyframes";

/**
 * Several character parts selected at once (Shift+click, drag-select, a ⌘G group), Illustrator
 * style. The selection is one key, the members joined by "|" ("leftHand|head/lips"); the player
 * (cb-animate-bridge) draws and drags it as one part, but edits are always written to the members:
 * the group's move, turn and scale are applied to each member about the group's pivot.
 */
export const isMultiPartKey = (key: string | null | undefined): key is string => Boolean(key && key.includes("|"));
export const partMembers = (key: string | null | undefined): string[] => (key ? key.split("|").filter(Boolean) : []);
export const joinPartKeys = (keys: string[]): string | null => {
  const unique = Array.from(new Set(keys.filter(Boolean)));
  return unique.length ? unique.join("|") : null;
};
/** The part a key sits in ("head/lips" → "head"); "" for a top-level part. */
export const parentPartKey = (key: string) => (key.includes("/") ? key.slice(0, key.lastIndexOf("/")) : "");

/** Shift+click: adds the part to the selection, or takes it out again. */
export const togglePartKey = (selection: string | null, key: string): string | null => {
  const members = partMembers(selection);
  const incoming = partMembers(key);
  const allIn = incoming.every((member) => members.includes(member));
  return joinPartKeys(allIn ? members.filter((member) => !incoming.includes(member)) : [...members, ...incoming]);
};

export type PartGroup = NonNullable<EditorObject["partGroups"]>[number];
/** A part picked on the canvas: the whole ⌘G group it belongs to, unless that group was entered. */
export const groupForPart = (object: EditorObject | null | undefined, key: string, enteredGroupId: string | null): PartGroup | null =>
  (object?.partGroups || []).find((group) => group.id !== enteredGroupId
    && group.members.some((member) => member === key || key.startsWith(`${member}/`))) || null;

type Box = { x: number; y: number; width: number; height: number };
type Patch = Partial<{ offsetX: number; offsetY: number; rotation: number; scale: number }>;
/**
 * The group's change (offset in player px, rotation in degrees, scale factor — relative to the
 * group as it is now) as each member's new edit. A member's pivot (its own pivot point, after its
 * own offset) turns and scales about the group pivot; its rotation and scale add on.
 */
export function memberPatches(object: EditorObject, key: string, change: Patch, time: number, sourceWidth: number, sourceHeight: number,
  groupPivot: { x: number; y: number } | null, baseBoundsOf: (member: string) => Box | null): Record<CharacterPartKey, Patch> {
  const theta = (Number(change.rotation || 0) * Math.PI) / 180;
  const scale = Math.max(0.02, Number(change.scale ?? 1));
  const dx = Number(change.offsetX || 0);
  const dy = Number(change.offsetY || 0);
  const result: Record<string, Patch> = {};
  for (const member of partMembers(key)) {
    const current = resolvePartTransformAtTime(object, member, time);
    const next: Patch = { offsetX: current.offsetX + dx, offsetY: current.offsetY + dy };
    if (theta || scale !== 1) {
      const box = baseBoundsOf(member);
      if (box && groupPivot) {
        const pivot = object.partOverrides?.[member] || {};
        const qx = (box.x + box.width * Number(pivot.pivotX ?? 0.5)) * sourceWidth + current.offsetX;
        const qy = (box.y + box.height * Number(pivot.pivotY ?? 1)) * sourceHeight + current.offsetY;
        const vx = qx - groupPivot.x;
        const vy = qy - groupPivot.y;
        const nx = groupPivot.x + scale * (vx * Math.cos(theta) - vy * Math.sin(theta));
        const ny = groupPivot.y + scale * (vx * Math.sin(theta) + vy * Math.cos(theta));
        next.offsetX = current.offsetX + (nx - qx) + dx;
        next.offsetY = current.offsetY + (ny - qy) + dy;
      }
      next.rotation = current.rotation + Number(change.rotation || 0);
      next.scale = Math.max(0.02, current.scale * scale);
    }
    result[member] = next;
  }
  return result;
}

/** A part's name for people: the player's label, else the last piece of its key ("head/lips" →
 *  "Lips", "leftHand" → "Left Hand", drawn shapes → "Shape"). */
export const partTitle = (key: string, label?: string) => {
  if (label && !label.includes("›")) return label;
  const last = key.split("|")[0].split("/").pop() || key;
  return /^shape(_\d+)?/i.test(last) ? "Shape" : last.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (letter) => letter.toUpperCase());
};
