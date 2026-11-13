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

/** F6: a keyframe at `frame`. On a tween the new key holds the tweened state; past the layer's end it repeats the last key. */
export function insertKeyframe(layer: Layer, frame: number): Layer {
  const state = layerStateAt(layer, frame);
  if (state && state.key.i === frame) return layer;
  if (!state) {
    const last = layer.frames[layer.frames.length - 1];
    if (!last) return withFrames(layer, [{ i: frame, d: 1, elements: [] }]);
    // Extend the last key to the frame before, then start the new key (Animate fills the gap).
    return withFrames(layer, [...layer.frames.slice(0, -1), { ...last, d: Math.max(last.d, frame - last.i), tween: undefined }, { i: frame, d: 1, elements: last.elements }]);
  }
  const { key, index } = state;
  const head: Keyframe = { ...key, d: frame - key.i };
  const tail: Keyframe = { i: frame, d: end(key) - frame, elements: resolveElements(layer, frame), tween: key.tween, ease: key.ease, rotate: key.rotate };
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

/** Moves the keyframe at `from` so it starts at `to`; its span keeps its length and neighbours give way by trimming. */
export function moveKeyframe(layer: Layer, from: number, to: number): Layer {
  if (from === to) return layer;
  const moving = layer.frames.find((k) => k.i === from);
  if (!moving) return layer;
  const rest = layer.frames.filter((k) => k !== moving);
  const placed: Keyframe = { ...moving, i: to };
  const out: Keyframe[] = [];
  for (const k of rest) {
    // Dragged later, the span just before it stretches to fill the place it left (no empty frames).
    if (end(k) === from && to > from) { out.push({ ...k, d: to - k.i }); continue; }
    if (end(k) <= to || k.i >= end(placed)) { out.push(k); continue; }
    if (k.i < to) out.push({ ...k, d: to - k.i });
    else if (end(k) > end(placed)) out.push({ ...k, i: end(placed), d: end(k) - end(placed) });
  }
  return withFrames(layer, [...out, placed]);
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

// ---------- history
/** Undo/redo over any immutable value (the document, or just one timeline). */
export type History<T> = { past: T[]; present: T; future: T[] };
export const history = <T,>(present: T): History<T> => ({ past: [], present, future: [] });
export const commit = <T,>(h: History<T>, next: T): History<T> => (next === h.present ? h : { past: [...h.past, h.present].slice(-200), present: next, future: [] });
export const undo = <T,>(h: History<T>): History<T> => (h.past.length ? { past: h.past.slice(0, -1), present: h.past[h.past.length - 1], future: [h.present, ...h.future] } : h);
export const redo = <T,>(h: History<T>): History<T> => (h.future.length ? { past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1) } : h);
