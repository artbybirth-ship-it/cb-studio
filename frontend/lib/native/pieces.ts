/**
 * The drawn pieces of a symbol as the Animate player names them ("shape", "shape_1", "shape_2"…), for the old pose view's edits: a piece
 * moved on its own, or taken out of its layer with Delete. One player piece is exactly one drawn shape of the file, so an old edit becomes
 * a change of that shape. The numbering follows the export (layer by layer from the top; inside a layer the shapes run forward in one
 * file's export and in reverse in another's), so the direction is worked out for each file by matching the colours of the export's own
 * shapes against the file's, over all its symbols (playerShapes / numberingOf).
 */
import type { FlaElement, Keyframe, Layer, ShapeElement, Timeline } from "../fla/xfl";
import { autoNameAt, autoNames, layerKey } from "./names";
import { withCreatejsValues, type CreatejsValues } from "./legacy";

export type Numbering = "forward" | "reverse";
/** How a symbol's export numbers its shapes: the direction (the same all through a file) and the number the first one has (it is not always 0). */
export type PieceNumbering = { order: Numbering; base: number };
/** A file's numbering: its direction, and each class's first number. */
export type DocNumbering = { order: Numbering; bases: Map<string, number> };

/** The name the player gives the n-th drawn piece of a symbol. */
export const pieceName = (n: number) => (n === 0 ? "shape" : `shape_${n}`);
/** Which number a piece name has (null when it is not a piece name). */
export const pieceNumber = (name: string): number | null => (name === "shape" ? 0 : /^shape_(\d+)$/.test(name) ? Number(name.slice(6)) : null);

/** Where one drawn shape sits in a symbol's timeline. */
export type PieceAt = { layer: number; key: number; el: number };

/** The symbol's drawn shapes in the player's numbering order: layers from the top, each layer's shapes (all its keyframes) forward or reversed. */
export function piecesOf(timeline: Timeline, numbering: Numbering): PieceAt[] {
  const out: PieceAt[] = [];
  timeline.layers.forEach((layer, li) => {
    if (layer.type === "folder") return;
    const here: PieceAt[] = [];
    layer.frames.forEach((k, ki) => k.elements.forEach((el, ei) => { if (el.k === "shape") here.push({ layer: li, key: ki, el: ei }); }));
    out.push(...(numbering === "reverse" ? here.reverse() : here));
  });
  return out;
}

/** The colours a drawn shape uses (fills and stroke fills; a gradient's stops), upper case. */
export function coloursOfShape(shape: ShapeElement): string[] {
  const hex = (fill: { t: string; color?: string; stops?: Array<[number, string, number]> }) => (fill.t === "solid" ? [fill.color || ""] : (fill.stops || []).map((s) => s[1]));
  return [...shape.fills.flatMap((f) => hex(f.style)), ...shape.strokes.flatMap((s) => hex(s.style.fill))].map((c) => c.toUpperCase()).filter(Boolean);
}

/** The shapes of every symbol class in an export's script, in the export's own numbering: class → each shape's number and first colour. */
export function playerShapes(js: string): Map<string, Array<{ n: number; colour: string | null }>> {
  const out = new Map<string, Array<{ n: number; colour: string | null }>>();
  for (const block of js.matchAll(/\(lib\.(\w+) = function\(mode,startPosition,loop,reversed\) \{[\s\S]*?\}\)\.prototype/g)) {
    const shapes: Array<{ n: number; colour: string | null }> = [];
    for (const m of block[0].matchAll(/this\.(shape(?:_\d+)?) = new cjs\.Shape\(\);\s*\n\s*this\.\1\.graphics\.([^\n]*)/g)) {
      const colour = /(?:^|\.)(?:f|s)\("(#[0-9A-Fa-f]{6})"/.exec(m[2])?.[1] ?? null;
      shapes.push({ n: pieceNumber(m[1]) ?? -1, colour: colour ? colour.toUpperCase() : null });
    }
    if (shapes.length) out.set(block[1], shapes);
  }
  return out;
}

/**
 * Which way a file's export numbers its shapes: every symbol with at least three shapes votes by how many of the export's shape colours sit
 * where each direction would put them. `itemOf` names the library symbol of a class (null when unknown). Null when nothing decides it.
 */
export function numberingOf(js: string, timelineOf: (cls: string) => Timeline | null): DocNumbering | null {
  const score = { forward: 0, reverse: 0 };
  const bases = new Map<string, number>();
  for (const [cls, shapes] of playerShapes(js)) {
    const base = Math.min(...shapes.map((s) => s.n).filter((n) => n >= 0));
    if (Number.isFinite(base)) bases.set(cls, base);
    if (shapes.length < 3) continue;
    const timeline = timelineOf(cls);
    if (!timeline) continue;
    for (const numbering of ["forward", "reverse"] as const) {
      const spots = piecesOf(timeline, numbering);
      if (spots.length !== shapes.length) continue;
      for (const s of shapes) {
        const at = spots[s.n - base];
        const el = at && timeline.layers[at.layer].frames[at.key].elements[at.el];
        if (s.colour && el?.k === "shape" && coloursOfShape(el).includes(s.colour)) score[numbering] += 1;
      }
    }
  }
  if (score.forward === score.reverse) return null;
  return { order: score.forward > score.reverse ? "forward" : "reverse", bases };
}

export type PieceEdits = {
  /** Pieces and instances taken out of their layers one by one (the old editor's deletedProps). */
  deleted?: string[];
  /** The values of a piece moved on its own, by "<layer>:<file frame>:<piece>". */
  values?: Record<string, { props: string[]; frame: number; v: Partial<CreatejsValues> }>;
};

/**
 * The old piece edits of one symbol applied to its file timeline (before any other old edit: they name the file's own shapes and layers):
 * the deleted pieces (and deleted unnamed instances) leave their keyframes, a moved piece takes its values. `applied` is told which value ids
 * landed. Null `numbering`: the pieces cannot be found, so nothing is done and `lost` lists what asked for it.
 */
export function applyPieceEdits(timeline: Timeline, edits: PieceEdits, numbering: PieceNumbering | null, applied?: Set<string>): { timeline: Timeline; lost: string[] } {
  const wantValues = Object.entries(edits.values || {}).filter(([id]) => id.split(":").length === 3);
  const deleted = edits.deleted || [];
  if (!wantValues.length && !deleted.length) return { timeline, lost: [] };
  const lost: string[] = [];
  const pieceNames = deleted.filter((n) => pieceNumber(n) != null), instanceNames = deleted.filter((n) => pieceNumber(n) == null);
  if (numbering == null && (pieceNames.length || wantValues.length)) {
    return { timeline, lost: [...(pieceNames.length ? [`${pieceNames.length} drawn piece${pieceNames.length > 1 ? "s" : ""} removed one by one`] : []), ...(wantValues.length ? [`${wantValues.length} moved piece${wantValues.length > 1 ? "s" : ""}`] : [])] };
  }
  const spots = numbering ? piecesOf(timeline, numbering.order) : [];
  const spotOf = (name: string) => spots[(pieceNumber(name) ?? -1) - (numbering?.base ?? 0)];
  const gone = new Set<string>(), changed = new Map<string, FlaElement>();
  const at = (s: PieceAt) => `${s.layer}:${s.key}:${s.el}`;
  for (const name of pieceNames) {
    const s = spotOf(name);
    if (s) gone.add(at(s)); else lost.push(`${name} (no such piece)`);
  }
  for (const [id, edit] of wantValues) {
    const [layer, frame, name] = id.split(":");
    const s = spotOf(name);
    const key = s && timeline.layers[s.layer]?.frames[s.key];
    // The piece must be where the edit says (its layer, its keyframe), or the numbering is not what it was when the edit was made.
    if (!s || !key || s.layer !== Number(layer) || key.i !== Number(frame)) { lost.push(`${id}`); continue; }
    const el = key.elements[s.el];
    if (el.k !== "shape") { lost.push(id); continue; }
    changed.set(at(s), withCreatejsValues(el, edit.v));
    applied?.add(id);
  }
  // Unnamed instances taken out: the player's name for each element is worked out as for value edits (names.ts).
  const names = instanceNames.length ? autoNames(timeline) : undefined;
  const layers = timeline.layers.map((layer, li): Layer => {
    const frames = layer.frames.map((k, ki): Keyframe => {
      const kept: FlaElement[] = [];
      let touched = false;
      k.elements.forEach((el, ei) => {
        const where = `${li}:${ki}:${ei}`;
        const instanceGone = el.k === "instance" && instanceNames.includes(el.name || autoNameAt(names, layerKey(timeline.layers, li), k.i, ei));
        if (gone.has(where) || instanceGone) { touched = true; return; }
        const next = changed.get(where);
        if (next) touched = true;
        kept.push(next ?? el);
      });
      return touched ? { ...k, elements: kept, morph: undefined } : k;
    });
    return frames.some((f, i) => f !== layer.frames[i]) ? { ...layer, frames } : layer;
  });
  return { timeline: layers.some((l, i) => l !== timeline.layers[i]) ? { ...timeline, layers } : timeline, lost };
}
