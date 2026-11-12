/**
 * The native editor's clipboard: parts copied from a pose, for pasting into any pose (of the same
 * or another character). It remembers where the parts came from (the character's .fla) so they can
 * be copied into the target's library when pasted (lib/native/library.ts). Kept in memory with the
 * loaded source, and in sessionStorage so a page reload does not lose it.
 */
import type { FlaElement } from "../fla/xfl";
import type { NativeLoaded } from "./loadDoc";

export type NativeClip = {
  /** The character's .fla (how to load the source again after a reload); absent for a file opened in the lab. */
  flaUrl?: string;
  docName: string;
  /** The pose the parts were copied from, and how big it is drawn on its stage: parts are scaled to look the same size on the target's. */
  rootItem: string;
  rootScale: number;
  /** The parts, as they stand in the pose's own space (the position of the level they were copied from is already folded in). */
  elements: FlaElement[];
  label: string;
};

const KEY = "cb-native-clip";
let memory: { clip: NativeClip; source: NativeLoaded } | null = null;

export function copyClip(clip: NativeClip, source: NativeLoaded) {
  memory = { clip, source };
  try { sessionStorage.setItem(KEY, JSON.stringify(clip)); } catch { /* too big or blocked: the in-memory copy still works */ }
}

export function readClip(): { clip: NativeClip; source: NativeLoaded | null } | null {
  if (memory) return memory;
  try {
    const text = sessionStorage.getItem(KEY);
    return text ? { clip: JSON.parse(text) as NativeClip, source: null } : null;
  } catch { return null; }
}
