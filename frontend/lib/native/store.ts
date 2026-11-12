/**
 * Native save format for pose edits. A pose's edits are the whole edited timelines of the library
 * symbols the user changed, by library name; opening replays them over the imported .fla document.
 * There is no per-feature patch language: a timeline is saved as the timeline it now is, so every
 * command (F5/F6/F7, Remove Frames, move, tween…) saves and reloads the same way.
 */
import type { FlaDocument, Timeline } from "../fla/xfl";
import { libraryUsedBy, type ImportedLibrary } from "./library";

export const NATIVE_FORMAT = "cb-native-pose-edits";
export const NATIVE_VERSION = 2;

/** library: symbols (and their pictures and brushes) pasted in from other characters, which the edited timelines use. */
export type NativeEdits = { format: typeof NATIVE_FORMAT; version: number; source: string; symbols: Record<string, Timeline>; library?: ImportedLibrary };

export const emptyEdits = (source: string): NativeEdits => ({ format: NATIVE_FORMAT, version: NATIVE_VERSION, source, symbols: {} });

/** The edited timelines of `working` that differ from the document's own. */
export function editsOf(doc: FlaDocument, working: Map<string, Timeline>): NativeEdits {
  const out = emptyEdits(doc.name);
  for (const [name, timeline] of working) if (doc.symbols.get(name)?.timeline !== timeline) out.symbols[name] = timeline;
  const library = libraryUsedBy(doc, Object.values(out.symbols));
  if (library) out.library = library;
  return out;
}

export const serializeEdits = (edits: NativeEdits) => JSON.stringify(edits);

export function parseEdits(text: string): NativeEdits {
  const data = JSON.parse(text) as Partial<NativeEdits>;
  if (data.format !== NATIVE_FORMAT || typeof data.symbols !== "object" || !data.symbols) throw new Error("This is not a CB pose-edits file.");
  if ((data.version ?? 0) > NATIVE_VERSION) throw new Error("This file was saved by a newer CB Studio.");
  return { format: NATIVE_FORMAT, version: data.version ?? 1, source: String(data.source ?? ""), symbols: data.symbols as Record<string, Timeline>, ...(data.library ? { library: data.library } : {}) };
}

/** Puts saved edits into a working copy; symbols the document no longer has are skipped and returned. */
export function applyEdits(doc: FlaDocument, edits: NativeEdits, working: Map<string, Timeline>): string[] {
  const missing: string[] = [];
  for (const [name, timeline] of Object.entries(edits.symbols)) {
    if (!doc.symbols.has(name)) { missing.push(name); continue; }
    working.set(name, timeline);
  }
  return missing;
}
