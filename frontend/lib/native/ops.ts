/**
 * Native timeline edits, one function per Animate command (F5 Insert Frame, F6 Insert Keyframe,
 * F7 Blank Keyframe, Remove Frames, Clear Keyframe, move keyframe, transform an element). Each is
 * a pure function from a layer to a new layer (the input is never changed), so undo is "keep the
 * old layer", and the same operation works for any layer at any depth: a pose, a nested symbol, a
 * pasted foreign part. There is no per-feature patch on a player any more.
 *
 * Frames are 0-based. A layer's frames are keyframes in order, each holding `d` frames; gaps are
 * allowed (Animate's empty frames) and a keyframe with no elements is a blank keyframe.
 */
import type { Ease, FlaElement, InstanceElement, Keyframe, Layer, Matrix } from "../fla/xfl";
import { easeFunction, layerStateAt, lerp, tweenMatrix } from "./evaluate";
import { matchShapes, morphToShapes } from "./shapeTween";

const end = (k: Keyframe) => k.i + k.d;
const sorted = (frames: Keyframe[]) => frames.slice().sort((a, b) => a.i - b.i);
/** A shape tween whose matched curves are missing (never had them, or an end key changed) gets them worked out again. */
function withMorphs(frames: Keyframe[]): Keyframe[] {
  return frames.map((k, i) => {
    const next = frames[i + 1];
    if (k.tween !== "shape" || k.morph || !next || next.i !== end(k)) return k;
    return { ...k, morph: matchShapes(k.elements, next.elements) };
  });
}
const withFrames = (layer: Layer, frames: Keyframe[]): Layer => ({ ...layer, frames: withMorphs(sorted(frames).filter((k) => k.d > 0)) });

/** What the layer shows at `frame`, with a classic tween applied: the elements an F6 there would capture. */
export function resolveElements(layer: Layer, frame: number): FlaElement[] {
  const state = layerStateAt(layer, frame);
  if (!state) return [];
  const { key, next, offset } = state;
  if (key.tween === "motion" && next && offset > 0) {
    const t = easeFunction(key.ease)(offset / key.d);
    return key.elements.map((el, i) => {
      const to = next.elements[i];
      if (el.k !== "instance" || to?.k !== "instance") return el;
      return { ...el, m: tweenMatrix(el.m, to.m, el.pivot, t, key.rotate), alpha: lerp(el.alpha ?? 1, to.alpha ?? 1, t) };
    });
  }
  if (key.tween === "shape" && next && key.morph && offset > 0) return morphToShapes(key, next, easeFunction(key.ease)(offset / key.d));
  return key.elements;
}

/**
 * The elements of a keyframe split `by` frames after its start: a nested symbol carries on from the frame it had reached instead of starting
 * again (Animate sets a graphic's first frame so; a movie clip carries on the same way through `first`). "Single frame" graphics stay.
 */
const carriedOn = (elements: FlaElement[], by: number): FlaElement[] => (by <= 0 ? elements : elements.map((el) => {
  if (el.k !== "instance" || (el.symbolType === "graphic" && el.loop === "single frame")) return el;
  if (el.symbolType !== "graphic") return { ...el, carried: (el.carried || 0) + by };
  return { ...el, first: (el.first || 0) + (/reverse/.test(el.loop) ? -by : by) };
}));

/** F6: a keyframe at `frame`. On a tween the new key holds the tweened state; past the layer's end it repeats the last key. */
export function insertKeyframe(layer: Layer, frame: number): Layer {
  const state = layerStateAt(layer, frame);
  if (state && state.key.i === frame) return layer;
  if (!state) {
    const last = layer.frames[layer.frames.length - 1];
    if (!last) return withFrames(layer, [{ i: frame, d: 1, elements: [] }]);
    // Extend the last key to the frame before, then start the new key (Animate fills the gap).
    return withFrames(layer, [...layer.frames.slice(0, -1), { ...last, d: Math.max(last.d, frame - last.i), tween: undefined }, { i: frame, d: 1, elements: carriedOn(last.elements, frame - last.i) }]);
  }
  const { key, index } = state;
  const head: Keyframe = { ...key, d: frame - key.i };
  const tail: Keyframe = { i: frame, d: end(key) - frame, elements: carriedOn(resolveElements(layer, frame), frame - key.i), tween: key.tween, ease: key.ease, rotate: key.rotate };
  // A shape tween's matched curves belong to the old pair of keys; the editor re-matches them (shapeTween.ts).
  if (key.tween === "shape") { delete head.morph; delete tail.morph; }
  const frames = layer.frames.slice();
  frames.splice(index, 1, head, tail);
  return withFrames(layer, frames);
}

/** F7: a blank keyframe at `frame`. */
export function insertBlankKeyframe(layer: Layer, frame: number): Layer {
  const made = insertKeyframe(layer, frame);
  return withFrames(made, made.frames.map((k) => (k.i === frame ? { ...k, elements: [], tween: undefined, ease: undefined, rotate: undefined, morph: undefined } : k)));
}

/** F5: `count` frames inserted at `frame`; everything from there on slides later. */
export function insertFrames(layer: Layer, frame: number, count = 1): Layer {
  const state = layerStateAt(layer, frame);
  const frames = layer.frames.map((k) => {
    if (k.i > frame) return { ...k, i: k.i + count };
    if (state && k === state.key) return { ...k, d: k.d + count };
    return k;
  });
  return withFrames(layer, frames);
}

/** Remove Frames: frames `from`…`to` (inclusive) taken out; later keys slide up. Keys wholly inside go; a key cut at its start loses its keyframe. */
export function removeFrames(layer: Layer, from: number, to: number): Layer {
  const count = to - from + 1;
  const out: Keyframe[] = [];
  for (const k of layer.frames) {
    const a = k.i, b = end(k) - 1;
    if (b < from) { out.push(k); continue; }
    if (a > to) { out.push({ ...k, i: k.i - count }); continue; }
    const before = Math.max(0, from - a), after = Math.max(0, b - to);
    const d = before + after;
    if (!d) continue;
    // The key survives from its own start when frames were cut from its middle or end; when its
    // start was cut, what remains is the later part, shown as the same key moved up.
    out.push({ ...k, i: a < from ? a : from, d });
  }
  // A tween that no longer meets a following key stops tweening.
  return withFrames(layer, out.map((k, i) => (k.tween && !(out[i + 1] && out[i + 1].i === end(k)) ? { ...k, tween: undefined, ease: undefined, rotate: undefined, morph: undefined } : k)));
}

/** Clear Keyframe (Shift+F6): the key at `frame` becomes part of the span before it. */
export function clearKeyframe(layer: Layer, frame: number): Layer {
  const index = layer.frames.findIndex((k) => k.i === frame);
  if (index <= 0) return index === 0 ? withFrames(layer, layer.frames.map((k, i) => (i === 0 ? { ...k, elements: [], tween: undefined, morph: undefined } : k))) : layer;
  const prev = layer.frames[index - 1], cur = layer.frames[index];
  if (end(prev) !== cur.i) return layer;
  const frames = layer.frames.slice();
  frames.splice(index - 1, 2, { ...prev, d: prev.d + cur.d, tween: cur.tween, ease: cur.ease, rotate: cur.rotate, morph: undefined });
  return withFrames(layer, frames);
}

/**
 * Moves the keyframe at `from` to `to`, as dragging one keyframe does in Animate: the frames it leaves join the span before it (or are left
 * empty when nothing comes before), and it shows from `to` until the next keyframe. Landing inside a span cuts that span there; landing on a
 * keyframe replaces it; past the layer's end it keeps its length. The keyframes after it stay where they are.
 */
export function moveKeyframe(layer: Layer, from: number, to: number): Layer {
  if (from === to) return layer;
  const moving = layer.frames.find((k) => k.i === from);
  if (!moving) return layer;
  // Taken out: the span before it carries on over its frames.
  const left: Keyframe[] = [];
  for (const k of layer.frames) {
    if (k === moving) continue;
    if (end(k) === from) left.push({ ...k, d: k.d + moving.d, morph: undefined });
    else left.push(k);
  }
  // Put in at `to`.
  const out: Keyframe[] = [];
  let d = 0;
  const after = left.find((k) => k.i > to);
  for (const k of left) {
    if (k.i === to) { d = k.d; continue; }                        // lands on a keyframe: replaces it
    if (k.i < to && end(k) > to) { out.push({ ...k, d: to - k.i, morph: undefined }); d = end(k) - to; continue; } // lands inside a span: cuts it
    out.push(k);
  }
  if (!d) d = after ? after.i - to : moving.d;                     // in empty frames: up to the next keyframe; past the end: its own length
  out.push({ ...moving, i: to, d, morph: undefined });
  // A tween that no longer meets a following key stops tweening.
  const frames = sorted(out);
  return withFrames(layer, frames.map((k, i) => (k.tween && !(frames[i + 1] && frames[i + 1].i === end(k)) ? { ...k, tween: undefined, ease: undefined, rotate: undefined, morph: undefined } : k)));
}

/** Replaces one element of the keyframe showing at `frame`. On a held span that key itself changes (as in Animate); on a tween span with no key at `frame`, a key is made first. */
export function setElement(layer: Layer, frame: number, elementIndex: number, update: (el: FlaElement) => FlaElement): Layer {
  const state = layerStateAt(layer, frame);
  const at = state && !state.key.tween ? state.key.i : frame;
  const made = at === frame ? insertKeyframe(layer, frame) : layer;
  // The edited key's own morph, and the morph of the key tweening into it, no longer match the artwork.
  return withFrames(made, made.frames.map((k) => {
    if (k.i === at) return { ...k, elements: k.elements.map((el, i) => (i === elementIndex ? update(el) : el)), morph: undefined };
    if (end(k) === at && k.tween === "shape") return { ...k, morph: undefined };
    return k;
  }));
}

export const setMatrix = (layer: Layer, frame: number, elementIndex: number, m: Matrix): Layer =>
  setElement(layer, frame, elementIndex, (el) => (el.k === "shape" ? { ...el, m } : { ...el, m }));

export const setAlpha = (layer: Layer, frame: number, elementIndex: number, alpha: number): Layer =>
  setElement(layer, frame, elementIndex, (el) => (el.k === "instance" ? ({ ...el, alpha } as InstanceElement) : el));

/** Gives the keyframe at `frame` a classic or shape tween (to the next key) or removes it. */
export function setTween(layer: Layer, frame: number, tween: Keyframe["tween"] | null, ease?: Ease): Layer {
  return withFrames(layer, layer.frames.map((k) => {
    if (k.i !== frame) return k;
    if (!tween) return { ...k, tween: undefined, ease: undefined, rotate: undefined, morph: undefined };
    return { ...k, tween, ease: ease ?? k.ease, morph: tween === "shape" ? undefined : k.morph };
  }));
}

export const setEase = (layer: Layer, frame: number, ease: Ease): Layer => withFrames(layer, layer.frames.map((k) => (k.i === frame ? { ...k, ease } : k)));

// ---------- copy / cut / paste frames
/** Frames copied from a layer: keyframes counted from the first copied frame, and how many frames were copied. */
export type FrameClip = { frames: Keyframe[]; length: number };

/** A keyframe at `frame` when the layer shows something there and none starts there (what is shown is kept: a tween's state is resolved). */
const keyAt = (layer: Layer, frame: number): Layer => (layerStateAt(layer, frame) && !layer.frames.some((k) => k.i === frame) ? insertKeyframe(layer, frame) : layer);

/**
 * Copy Frames: frames `from`…`to` of the layer as they show (a span cut in the middle starts with a keyframe holding what shows there).
 * A tween still running at the last copied frame ends there (a keyframe holding what showed).
 */
export function copyFrames(layer: Layer, from: number, to: number): FrameClip {
  const length = to - from + 1;
  // Cut at both ends; a tween still running at the last copied frame gets a keyframe there, so the copy ends as it looked (as Animate splits it).
  const inTween = (l: Layer, f: number) => { const st = layerStateAt(l, f); return !!st && !!st.key.tween && st.key.i < f && !!st.next; };
  const ends = inTween(layer, to) ? keyAt(keyAt(layer, from), to) : keyAt(layer, from);
  const cut = keyAt(ends, to + 1);
  const frames = cut.frames.filter((k) => k.i >= from && k.i <= to).map((k) => ({ ...k, i: k.i - from, d: Math.min(k.d, to + 1 - k.i) }));
  return { length, frames: frames.map((k, i) => (k.tween && !(frames[i + 1] && frames[i + 1].i === k.i + k.d) ? { ...k, tween: undefined, ease: undefined, rotate: undefined, morph: undefined } : k)) };
}

/**
 * Paste Frames (Animate: pasted frames replace what they land on): the clip's frames from `at` on; what showed after them stays. The span
 * before `at` ends there (a tween from it now runs into the pasted keyframe).
 */
export function pasteFrames(layer: Layer, at: number, clip: FrameClip): Layer {
  const end = at + clip.length;
  const kept = keyAt(layer, end);
  const before = kept.frames.filter((k) => k.i < at).map((k) => (k.i + k.d > at ? { ...k, d: at - k.i, morph: undefined } : k));
  const after = kept.frames.filter((k) => k.i >= end);
  const pasted = clip.frames.map((k) => ({ ...k, i: k.i + at }));
  // The key just before the paste no longer meets its old next key: it is re-matched (shape tween) against what now follows it.
  const frames = [...before, ...pasted, ...after].map((k) => ({ ...k }));
  return withFrames(layer, frames.map((k, i) => (k.tween && !(frames[i + 1] && frames[i + 1].i === k.i + k.d) ? { ...k, tween: undefined, ease: undefined, rotate: undefined, morph: undefined } : k)));
}

/** Cut Frames: copied, then the frames are left empty (a blank keyframe); what showed after them stays. */
export function cutFrames(layer: Layer, from: number, to: number): { layer: Layer; clip: FrameClip } {
  const clip = copyFrames(layer, from, to);
  return { clip, layer: pasteFrames(layer, from, { length: clip.length, frames: [{ i: 0, d: clip.length, elements: [] }] }) };
}

// ---------- swap symbol
/**
 * Animate's Swap Symbol, for the whole layer: every keyframe's instance of `from` becomes an
 * instance of `to`, keeping where it is, how it is turned and its tween. `scale` sizes the new
 * symbol (1 for another variant of the same character; the pose-size ratio for a part from
 * another character). The new symbol brings its own transformation point.
 */
export function swapSymbol(layer: Layer, from: string, to: InstanceElement, scale = 1): Layer {
  let changed = false;
  const frames = layer.frames.map((k) => {
    if (!k.elements.some((el) => el.k === "instance" && el.item === from)) return k;
    changed = true;
    return {
      ...k,
      elements: k.elements.map((el) => {
        if (el.k !== "instance" || el.item !== from) return el;
        const [a, b, c, d, tx, ty] = el.m;
        return { ...el, item: to.item, symbolType: to.symbolType, pivot: to.pivot, m: [a * scale, b * scale, c * scale, d * scale, tx, ty] } as InstanceElement;
      }),
    };
  });
  return changed ? withFrames(layer, frames) : layer;
}

// ---------- layers
/** The eye: a layer that is off is not drawn (and cannot be picked) at any frame. */
export const setLayerOff = (layer: Layer, off: boolean): Layer => (!!layer.off === off ? layer : { ...layer, off });

/**
 * Removes the layers at `indices`. A layer whose parent (folder or mask) was removed moves up to
 * that parent's own parent; the rest keep their parent, renumbered for the layers that went.
 */
export function deleteLayers(layers: Layer[], indices: number[]): Layer[] {
  const gone = new Set(indices.filter((i) => i >= 0 && i < layers.length));
  if (!gone.size) return layers;
  const survivor = (p: number | null): number | null => {
    while (p != null && gone.has(p)) p = layers[p].parent;
    return p;
  };
  const renumbered = (p: number) => p - [...gone].filter((g) => g < p).length;
  return layers.flatMap((layer, i) => {
    if (gone.has(i)) return [];
    const p = survivor(layer.parent);
    const parent = p == null ? null : renumbered(p);
    return [parent === layer.parent ? layer : { ...layer, parent }];
  });
}

/**
 * A new layer put above the layer at `at` (layers are listed top first, so it takes index `at`), in the same folder as that layer.
 * Layers that point at a parent (folder or mask) at or below `at` point at it one further down.
 */
export function insertLayer(layers: Layer[], at: number, layer: Layer): Layer[] {
  const where = Math.max(0, Math.min(layers.length, at));
  const neighbour = layers[where];
  const folder = neighbour && neighbour.parent != null && layers[neighbour.parent]?.type === "folder" ? neighbour.parent : null;
  const shift = (p: number | null) => (p != null && p >= where ? p + 1 : p);
  const placed: Layer = { ...layer, parent: shift(folder) };
  return [...layers.slice(0, where).map((l) => (l.parent != null && l.parent >= where ? { ...l, parent: l.parent + 1 } : l)), placed,
    ...layers.slice(where).map((l) => (l.parent != null && l.parent >= where ? { ...l, parent: l.parent + 1 } : l))];
}

/** Rename: the layer keeps its file name (fileName), so what the player calls its instances does not change. */
export function renameLayer(layers: Layer[], index: number, name: string): Layer[] {
  const layer = layers[index], next = name.trim();
  if (!layer || !next || next === layer.name) return layers;
  return layers.map((l, i) => (i === index ? { ...l, name: next, fileName: l.fileName ?? l.name } : l));
}

/** The padlock: a locked layer's parts cannot be picked or changed on the stage. */
export const setLayerLocked = (layer: Layer, locked: boolean): Layer => (!!layer.locked === locked ? layer : { ...layer, locked });

/**
 * Duplicate Layers: a copy of each layer at `indices`, just above it, named "<name> copy", in the same folder (a layer under a mask stays
 * under it). Folders and masks are not duplicated (their layers would need copying too). Answers the layers and where the copies are.
 */
export function duplicateLayers(layers: Layer[], indices: number[]): { layers: Layer[]; copies: number[] } {
  const chosen = [...new Set(indices)].filter((i) => layers[i] && layers[i].type !== "folder" && layers[i].type !== "mask").sort((a, b) => a - b);
  let out = layers;
  // From the bottom up, so the indexes still to do are not moved by the copies already made.
  for (const i of [...chosen].reverse()) {
    const original = out[i];
    const copy: Layer = { ...JSON.parse(JSON.stringify(original)) as Layer, name: `${original.name} copy`, fileName: "", locked: false };
    const shift = (p: number | null) => (p != null && p >= i ? p + 1 : p);
    out = [...out.slice(0, i).map((l) => ({ ...l, parent: shift(l.parent) })), { ...copy, parent: shift(original.parent) }, ...out.slice(i).map((l) => ({ ...l, parent: shift(l.parent) }))];
  }
  return { layers: out, copies: chosen.map((i, k) => i + k) };
}

// ---------- history
/** Undo/redo over any immutable value (the document, or just one timeline). */
export type History<T> = { past: T[]; present: T; future: T[] };
export const history = <T,>(present: T): History<T> => ({ past: [], present, future: [] });
export const commit = <T,>(h: History<T>, next: T): History<T> => (next === h.present ? h : { past: [...h.past, h.present].slice(-200), present: next, future: [] });
export const undo = <T,>(h: History<T>): History<T> => (h.past.length ? { past: h.past.slice(0, -1), present: h.past[h.past.length - 1], future: [h.present, ...h.future] } : h);
export const redo = <T,>(h: History<T>): History<T> => (h.future.length ? { past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1) } : h);
