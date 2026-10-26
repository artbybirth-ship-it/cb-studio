"use client";

import type { ColorReplacement, EditorData, EditorObject } from "@/types";
import type { Html5CharacterLibraryCharacter } from "@/lib/html5CharacterCatalog";
import { exportSourceOf } from "@/lib/partVariants";
import { DEFAULT_FONT } from "@/lib/fonts";

/**
 * Find and Replace (Animate-style): colour, text or font across a context. Colour replaces the
 * exact colour on character artwork (a recolour rule, fills + strokes), text/prop colours and solid
 * scene backgrounds; text and font work on text layers.
 */

export type FindKind = "colour" | "text" | "font";
export type FindContext = "frame" | "scene" | "document" | "open-files" | "library";
export type FindRequest = { kind: FindKind; context: FindContext; find: string; replace: string };
export type ReplaceCounts = { characters: number; texts: number; props: number; backgrounds: number };

export const emptyCounts = (): ReplaceCounts => ({ characters: 0, texts: 0, props: 0, backgrounds: 0 });
export const addCounts = (a: ReplaceCounts, b: ReplaceCounts): ReplaceCounts => ({
  characters: a.characters + b.characters, texts: a.texts + b.texts, props: a.props + b.props, backgrounds: a.backgrounds + b.backgrounds,
});
export const totalCount = (counts: ReplaceCounts) => counts.characters + counts.texts + counts.props + counts.backgrounds;

export const normalizeHex = (value: string | undefined | null) => {
  const text = String(value || "").trim().toLowerCase().replace(/^([0-9a-f]{6})$/, "#$1");
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(text);
  if (short) return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`;
  return /^#[0-9a-f]{6}$/.test(text) ? text : null;
};

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const ruleId = () => `fr-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

/** Adds (or updates) the whole-character exact rule "find → replace" on a character layer; false when it was already so. */
export const addColorRule = (object: EditorObject, find: string, replace: string) => {
  if (find === replace) return false;
  const rules = object.colorReplacements || [];
  // A colour that is itself the result of an earlier replacement: change that result instead.
  const chained = rules.find((rule) => rule.scope === "*" && rule.to === find);
  if (chained) { object.colorReplacements = rules.map((rule) => (rule === chained ? { ...rule, to: replace } : rule)); return true; }
  const same = rules.find((rule) => rule.scope === "*" && rule.match === "exact" && rule.from === find);
  if (same) {
    if (same.to === replace) return false;
    object.colorReplacements = rules.map((rule) => (rule === same ? { ...rule, to: replace } : rule));
    return true;
  }
  const rule: ColorReplacement = { id: ruleId(), from: find, to: replace, target: "both", scope: "*", match: "exact" };
  object.colorReplacements = [...rules, rule];
  return true;
};

/** Layers shown at the playhead (Current Frame): not hidden, inside the layer's time span. */
export const visibleAt = (object: EditorObject, seconds: number) => {
  if (object.hidden || object.type === "audio" || object.type === "empty") return false;
  const start = Math.max(0, Number(object.startTime || 0));
  const length = object.actionDurationMs ? Math.max(0.1, Number(object.actionDurationMs) / 1000) : null;
  return seconds + 0.0001 >= start && (length == null || seconds <= start + length + 0.0001);
};

/**
 * Applies one request to a scene's data in place and returns what changed. onlyIds limits it to
 * those layers (Current Frame); usesColour says whether a character's artwork contains the colour.
 */
export function applyToEditorData(data: EditorData, request: FindRequest, options: { onlyIds?: Set<string>; usesColour?: (object: EditorObject) => boolean; includeBackground?: boolean; charactersOnly?: boolean } = {}): ReplaceCounts {
  const counts = emptyCounts();
  const objects = (data.objects || []).filter((object) => !options.onlyIds || options.onlyIds.has(object.id));
  if (request.kind === "colour") {
    const find = normalizeHex(request.find), replace = normalizeHex(request.replace);
    if (!find || !replace) return counts;
    for (const object of objects) {
      if (object.type === "character") {
        if (options.usesColour?.(object) && addColorRule(object, find, replace)) counts.characters++;
      } else if (options.charactersOnly) {
        continue;
      } else if (object.type === "text") {
        if (normalizeHex(object.fillColor || "#ffffff") === find) { object.fillColor = replace; counts.texts++; }
      } else if (object.type === "prop") {
        if (normalizeHex(object.fillColor) === find) { object.fillColor = replace; counts.props++; }
      }
    }
    if (!options.charactersOnly && options.includeBackground !== false && normalizeHex(data.background) === find) { data.background = replace; counts.backgrounds++; }
    return counts;
  }
  if (request.kind === "text") {
    const find = request.find;
    if (!find) return counts;
    const pattern = new RegExp(escapeRegExp(find), "gi");
    for (const object of objects) {
      if (object.type !== "text" || !object.text || !pattern.test(object.text)) continue;
      pattern.lastIndex = 0;
      object.text = object.text.replace(pattern, () => request.replace);
      counts.texts++;
    }
    return counts;
  }
  const findFont = request.find.trim().toLowerCase();
  if (!findFont || !request.replace.trim()) return counts;
  for (const object of objects) {
    if (object.type === "text" && (object.fontFamily || DEFAULT_FONT).toLowerCase() === findFont) { object.fontFamily = request.replace.trim(); counts.texts++; }
  }
  return counts;
}

// ---- Which characters use a colour: their Animate export's script contains it (all poses).
const scriptCache = new Map<string, Promise<string>>();
const exportScript = async (character: Html5CharacterLibraryCharacter) => {
  const source = await exportSourceOf(character);
  if (!source) return "";
  let pending = scriptCache.get(source.js);
  if (!pending) {
    pending = fetch(encodeURI(source.js)).then((response) => (response.ok ? response.text() : "")).then((text) => text.toLowerCase()).catch(() => "");
    scriptCache.set(source.js, pending);
  }
  return pending;
};
const colourForms = (hex: string) => {
  const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
  return [hex, `rgba(${r},${g},${b},`, `rgba(${r}, ${g}, ${b},`];
};
/** Library character ids (without "html5:") whose artwork contains the colour. */
export async function charactersUsingColour(library: Html5CharacterLibraryCharacter[], ids: Iterable<string>, hex: string): Promise<Set<string>> {
  const forms = colourForms(hex);
  const found = new Set<string>();
  await Promise.all(Array.from(new Set(ids)).map(async (id) => {
    const character = library.find((item) => item.id === id);
    if (!character) return;
    const text = await exportScript(character);
    if (forms.some((form) => text.includes(form))) found.add(id);
  }));
  return found;
}

export const libraryIdOf = (object: EditorObject) => String(object.characterId || "").replace(/^html5:/, "");

export function describeCounts(counts: ReplaceCounts, places: number, placeLabel: string) {
  const parts = [
    counts.characters ? `${counts.characters} character${counts.characters === 1 ? "" : "s"}` : "",
    counts.texts ? `${counts.texts} text layer${counts.texts === 1 ? "" : "s"}` : "",
    counts.props ? `${counts.props} prop${counts.props === 1 ? "" : "s"}` : "",
    counts.backgrounds ? `${counts.backgrounds} background${counts.backgrounds === 1 ? "" : "s"}` : "",
  ].filter(Boolean);
  return `Replaced in ${parts.join(", ")}${places > 1 ? ` across ${places} ${placeLabel}` : ""}.`;
}
