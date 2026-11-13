"use client";

/**
 * Native pose editor (Phase 1): edits an imported .fla's pose directly, with no Animate player in
 * between. The stage is lib/native/render.ts, the timeline shows the symbol's own layers and
 * keyframes, and every command (F5 Insert Frame, F6 Insert Keyframe, F7 Blank Keyframe, Shift+F6
 * Clear Keyframe, Shift+F5 Remove Frames, dragging a part) is one function in lib/native/ops.ts
 * over the layer, so it behaves the same on any layer of any symbol. Undo/redo keep the previous
 * timelines. Save writes the edited timelines (lib/native/store.ts). Not wired into the scene
 * editor yet; opened from /native-lab.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { FlaDocument, FlaElement, Layer, Matrix, Timeline } from "../lib/fla/xfl";
import type { NativeRenderer } from "../lib/native/render";
import { clearKeyframe, commit, deleteLayers, history, insertBlankKeyframe, insertFrames, insertKeyframe, moveKeyframe, redo, removeFrames, resolveElements, setLayerOff, setMatrix, undo, type History } from "../lib/native/ops";
import { innerFrame, layerStateAt } from "../lib/native/evaluate";
import { applyEdits, editsOf, parseEdits, serializeEdits, type NativeEdits } from "../lib/native/store";
import { IDENTITY, importElements, invert, mul, poseScale, registerLibrary } from "../lib/native/library";
import { copyClip, readClip } from "../lib/native/clipboard";
import { loadNativeDoc } from "../lib/native/loadDoc";

const CELL = 12;
const ROW = 24;
type Working = ReadonlyMap<string, Timeline>;
type Pose = { item: string; name: string };
type Sel = { layer: number; el: number };
type Drag = { kind: "part"; start: [number, number]; held: Array<Sel & { m: Matrix }>; preview?: Map<number, Layer> } | { kind: "box"; from: [number, number]; to: [number, number] } | { kind: "key"; layer: number; from: number; start: number; to: number };

const lengthOf = (layers: Layer[]) => Math.max(1, ...layers.flatMap((l) => l.frames.map((k) => k.i + k.d)));
const short = (name: string) => name.split("/").pop() || name;
const isTyping = (target: EventTarget | null) => target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName);

export default function NativePoseEditor({ doc, renderer, poses, initialEdits, onChange, flaUrl }: {
  doc: FlaDocument; renderer: NativeRenderer; poses: Pose[];
  /** Where this character's .fla came from: lets a copied part be found again after a reload. */
  flaUrl?: string;
  /** Edits saved earlier, replayed on open. */
  initialEdits?: NativeEdits | null;
  /** Called with the edits as they now are after every change (not on open). */
  onChange?: (edits: NativeEdits) => void;
}) {
  const [hist, setHist] = useState<History<Working>>(() => {
    const map = new Map<string, Timeline>();
    if (initialEdits) applyEdits(doc, initialEdits, map);
    return history<Working>(map);
  });
  const opened = useRef(hist.present);
  useEffect(() => { if (hist.present !== opened.current) onChange?.(editsOf(doc, new Map(hist.present))); }, [hist.present, doc, onChange]);
  // The symbols stepped into, pose first; each level after the first remembers where its instance stood in the one above (to carry parts between levels).
  const [stack, setStack] = useState<Array<{ item: string; m: Matrix }>>(() => [{ item: poses[0]?.item || "", m: IDENTITY }]);
  const symbol = stack[stack.length - 1].item;
  const [frame, setFrame] = useState(0);
  const [range, setRange] = useState<[number, number]>([0, 0]);
  const [layerIndex, setLayerIndex] = useState(0);
  const [elIndex, setElIndex] = useState<number | null>(null);
  /** Parts selected besides the main one (layerIndex/elIndex): shift-click adds, a drag box adds, they all move together. */
  const [others, setOthers] = useState<Sel[]>([]);
  const [allLayers, setAllLayers] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [view, setView] = useState({ x: 0, y: 0, w: 500, h: 900 });
  const [note, setNote] = useState("");
  const canvas = useRef<HTMLCanvasElement>(null);
  /** Set when a double-click steps into a part: the frame it was playing and the point clicked, in its own space, to select what lies under it once the new level is open. */
  const arriving = useRef<{ frame: number; at: [number, number] } | null>(null);

  const working = hist.present;
  const base = working.get(symbol) ?? doc.symbols.get(symbol)?.timeline;
  // The timeline on screen: the working copy with a drag in progress laid over it.
  const shown: Timeline | undefined = useMemo(() => {
    if (!base) return undefined;
    if (drag?.kind === "part" && drag.preview) return { ...base, layers: base.layers.map((l, i) => drag.preview!.get(i) ?? l) };
    return base;
  }, [base, drag]);
  const length = shown?.length || 1;
  const fps = doc.fps;

  // ---- editing
  const edit = useCallback((change: (layer: Layer, index: number) => Layer, only?: number) => {
    if (!base) return;
    const target = (i: number) => (only != null ? i === only : allLayers || i === layerIndex);
    const layers = base.layers.map((l, i) => (target(i) ? change(l, i) : l));
    const next: Timeline = { ...base, layers, length: lengthOf(layers) };
    const map = new Map(working);
    map.set(symbol, next);
    setHist((h) => commit(h, map));
  }, [base, working, symbol, layerIndex, allLayers]);

  const commands = useMemo(() => ({
    "insert-frame": () => edit((l) => insertFrames(l, frame, range[1] - range[0] + 1)),
    "remove-frames": () => { edit((l) => removeFrames(l, range[0], range[1])); setFrame(range[0]); setRange([range[0], range[0]]); },
    "insert-keyframe": () => edit((l) => insertKeyframe(l, frame)),
    "blank-keyframe": () => edit((l) => insertBlankKeyframe(l, frame)),
    "clear-keyframe": () => edit((l) => clearKeyframe(l, frame)),
  }), [edit, frame, range]);

  // An undo that adds or removes layers (a paste) leaves the old layer numbers pointing at other parts, so the selection goes; otherwise it stays.
  const stepHistory = (step: (h: History<Working>) => History<Working>) => {
    const next = step(hist);
    const count = (w: Working) => (w.get(symbol) ?? doc.symbols.get(symbol)?.timeline)?.layers.length ?? 0;
    if (count(next.present) !== count(hist.present)) { setElIndex(null); setOthers([]); }
    setHist(next);
  };
  /** Delete layer: the layers of the selected parts, or the layer picked in the timeline when no part is selected. */
  const deleteSelected = useCallback(() => {
    if (!base) return;
    const chosen = elIndex != null ? [layerIndex, ...others.map((o) => o.layer)] : others.length ? others.map((o) => o.layer) : [layerIndex];
    const doomed = [...new Set(chosen)].filter((i) => i >= 0 && i < base.layers.length);
    if (!doomed.length) return;
    const layers = deleteLayers(base.layers, doomed);
    const map = new Map(working);
    map.set(symbol, { ...base, layers, length: lengthOf(layers) });
    setHist((h) => commit(h, map));
    setLayerIndex(0); setElIndex(null); setOthers([]);
    setNote(`Deleted ${doomed.length > 1 ? `${doomed.length} layers` : `layer ${base.layers[doomed[0]].name}`}`);
  }, [base, working, symbol, elIndex, layerIndex, others]);
  const deleteRef = useRef<() => void>(() => {});
  deleteRef.current = deleteSelected;
  /** The eye: hides or shows one layer (undoable). */
  const toggleEye = (index: number) => { const layer = base?.layers[index]; if (layer) { edit((l) => setLayerOff(l, !layer.off), index); } };
  const doUndo = () => stepHistory(undo);
  const doRedo = () => stepHistory(redo);

  // Keys are taken in the capture phase and stopped, so the scene editor behind a dialog never also acts on them (F6, ⌘Z, ⌘C, ⌘V…).
  const copyRef = useRef<() => void>(() => {});
  const pasteRef = useRef<() => void>(() => {});
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return;
      const mod = e.metaKey || e.ctrlKey;
      const take = () => { e.preventDefault(); e.stopPropagation(); };
      if (mod && e.key.toLowerCase() === "z") { take(); if (e.shiftKey) doRedo(); else doUndo(); return; }
      if (mod && e.key.toLowerCase() === "c") { take(); copyRef.current(); return; }
      if (mod && e.key.toLowerCase() === "v") { take(); pasteRef.current(); return; }
      if (e.key === "Delete" || e.key === "Backspace") { take(); deleteRef.current(); return; }
      if (e.key === "F5") { take(); (e.shiftKey ? commands["remove-frames"] : commands["insert-frame"])(); }
      else if (e.key === "F6") { take(); (e.shiftKey ? commands["clear-keyframe"] : commands["insert-keyframe"])(); }
      else if (e.key === "F7") { take(); commands["blank-keyframe"](); }
      else if (e.key === "," || e.key === ".") { take(); setFrame((f) => Math.max(0, Math.min(length - 1, f + (e.key === "," ? -1 : 1)))); }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [commands, length]);

  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(() => setFrame((f) => (f + 1) % length), 1000 / fps);
    return () => window.clearInterval(timer);
  }, [playing, length, fps]);

  // ---- copy / paste between poses and characters
  const loadedHere = useMemo(() => ({ doc, renderer }), [doc, renderer]);
  /** Where the current level's own space sits inside the pose's: the stepped-into instances' matrices, outermost first. */
  const levelToPose = useMemo(() => stack.slice(1).reduce((acc, level) => mul(acc, level.m), IDENTITY), [stack]);
  const copyPart = useCallback(() => {
    const chosen = [...(elIndex != null ? [{ layer: layerIndex, el: elIndex }] : []), ...others];
    if (!shown || !chosen.length) { setNote("Click a part on the stage first, then copy"); return; }
    // Bottom-most layer first, and within a layer in stacking order, so the copy stacks as it did.
    const picked = chosen.sort((a, b) => b.layer - a.layer || a.el - b.el).flatMap((c) => { const part = shown.layers[c.layer] && resolveElements(shown.layers[c.layer], frame)[c.el]; return part ? [part] : []; });
    if (!picked.length) return;
    const elements = picked.map((p) => ({ ...p, m: mul(levelToPose, p.m) }) as FlaElement);
    const label = picked.length > 1 ? `${picked.length} parts` : picked[0].k === "instance" ? short(picked[0].item) : picked[0].k;
    copyClip({ flaUrl, docName: doc.name, rootItem: stack[0].item, rootScale: poseScale(doc, stack[0].item), elements, label }, loadedHere);
    setNote(`Copied ${label} from ${doc.name}`);
  }, [shown, elIndex, others, layerIndex, frame, levelToPose, flaUrl, doc, stack, loadedHere]);
  const pastePart = useCallback(async () => {
    const found = readClip();
    if (!found || !base) { setNote("Nothing copied yet: select a part, then copy it (⌘C)"); return; }
    try {
      setNote("Pasting…");
      const source = found.source ?? (found.clip.flaUrl ? await loadNativeDoc(found.clip.flaUrl) : null);
      if (!source) { setNote("The copied part's character is no longer available: copy it again"); return; }
      const pasted = await importElements(source, found.clip.elements, loadedHere);
      // Sized to look the same on the stage as it did where it came from, and placed in this level's space.
      const f = found.clip.rootScale / poseScale(doc, stack[0].item);
      const toLevel = mul(invert(levelToPose), [f, 0, 0, f, 0, 0]);
      const elements = pasted.map((el) => ({ ...el, m: mul(toLevel, el.m) }) as FlaElement);
      // A new layer on top, holding the part for the whole timeline. Layers that point at another layer (masks, folders) shift down with it.
      const first = pasted[0];
      const name = pasted.length > 1 ? `Pasted ${pasted.length} parts` : `Pasted ${first.k === "instance" ? short(first.item).replace(/^Pasted from [^/]*\//, "") : first.k}`;
      const layer: Layer = { name, type: "normal", parent: null, hidden: false, frames: [{ i: 0, d: Math.max(1, base.length), elements }] };
      const layers = [layer, ...base.layers.map((l) => (l.parent != null ? { ...l, parent: l.parent + 1 } : l))];
      const map = new Map(working);
      map.set(symbol, { ...base, layers, length: lengthOf(layers) });
      setHist((h) => commit(h, map));
      setLayerIndex(0); setElIndex(0); setFrame(0); setRange([0, 0]);
      setNote(`${name} from ${found.clip.docName} as a new layer`);
    } catch (error) {
      setNote(error instanceof Error ? error.message : "Could not paste");
    }
  }, [base, working, symbol, doc, stack, levelToPose, loadedHere]);
  copyRef.current = copyPart;
  pasteRef.current = () => void pastePart();

  // ---- stage
  const layoutKey = `${symbol}`;
  useLayoutEffect(() => {
    // Frame the pose: its first frame's ink, found by drawing it once on a big scratch canvas.
    const SIZE = 1400, S = 0.5;
    const scratch = new OffscreenCanvas(SIZE, SIZE), ctx = scratch.getContext("2d", { willReadFrequently: true })!;
    renderer.overrides.clear();
    ctx.setTransform(S, 0, 0, S, SIZE / 2, SIZE / 2);
    renderer.drawSymbol(ctx, symbol, 0);
    const data = ctx.getImageData(0, 0, SIZE, SIZE).data;
    let x0 = SIZE, y0 = SIZE, x1 = -1, y1 = -1;
    for (let y = 0; y < SIZE; y += 1) for (let x = 0; x < SIZE; x += 1) if (data[(y * SIZE + x) * 4 + 3] > 8) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    if (x1 < 0) { setView({ x: -250, y: -450, w: 500, h: 900 }); return; }
    setView({ x: (x0 - SIZE / 2) / S, y: (y0 - SIZE / 2) / S, w: (x1 - x0) / S, h: (y1 - y0) / S });
    setFrame(0); setRange([0, 0]); setLayerIndex(0); setElIndex(null); setOthers([]);
    const landed = arriving.current;
    arriving.current = null;
    if (landed) {
      const level = working.get(symbol) ?? doc.symbols.get(symbol)?.timeline;
      const hit = level && pickAt(level, landed.frame, landed.at[0], landed.at[1], 4);
      setFrame(landed.frame);
      if (hit) { setLayerIndex(hit.layer); setElIndex(hit.el); }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layoutKey, renderer]);

  const fit = useCallback((w: number, h: number) => {
    const s = Math.min(w / (view.w * 1.15), h / (view.h * 1.15));
    return { s, tx: w / 2 - (view.x + view.w / 2) * s, ty: h / 2 - (view.y + view.h / 2) * s };
  }, [view]);

  useEffect(() => {
    const el = canvas.current;
    if (!el || !shown) return;
    renderer.overrides.clear();
    for (const [name, timeline] of working) renderer.overrides.set(name, timeline);
    renderer.overrides.set(symbol, shown);
    const ctx = el.getContext("2d")!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, el.width, el.height);
    const { s, tx, ty } = fit(el.width, el.height);
    ctx.setTransform(s, 0, 0, s, tx, ty);
    renderer.drawSymbol(ctx, symbol, frame);
    // Each selected part's registration point (the main one in pink, the others in blue), and the drag box.
    const marks: Array<Sel & { main: boolean }> = [...(elIndex != null ? [{ layer: layerIndex, el: elIndex, main: true }] : []), ...others.map((o) => ({ ...o, main: false }))];
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    for (const mark of marks) {
      const layer = shown.layers[mark.layer];
      const e = layer && resolveElements(layer, frame)[mark.el];
      if (!e) continue;
      const pivot = e.k === "instance" ? e.pivot : [0, 0];
      const px = e.m[0] * pivot[0] + e.m[2] * pivot[1] + e.m[4], py = e.m[1] * pivot[0] + e.m[3] * pivot[1] + e.m[5];
      ctx.strokeStyle = mark.main ? "#e5007d" : "#1a73e8"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(px * s + tx, py * s + ty, 9, 0, Math.PI * 2); ctx.moveTo(px * s + tx - 14, py * s + ty); ctx.lineTo(px * s + tx + 14, py * s + ty); ctx.moveTo(px * s + tx, py * s + ty - 14); ctx.lineTo(px * s + tx, py * s + ty + 14); ctx.stroke();
    }
    if (drag?.kind === "box") {
      ctx.strokeStyle = "#1a73e8"; ctx.fillStyle = "rgba(26,115,232,0.12)"; ctx.lineWidth = 1;
      const x = Math.min(drag.from[0], drag.to[0]), y = Math.min(drag.from[1], drag.to[1]), w = Math.abs(drag.to[0] - drag.from[0]), h = Math.abs(drag.to[1] - drag.from[1]);
      ctx.fillRect(x, y, w, h); ctx.strokeRect(x, y, w, h);
    }
  }, [renderer, working, shown, symbol, frame, fit, layerIndex, elIndex, others, drag]);

  /** Topmost layer, and part of it, drawn at the point (x, y) of `timeline`'s own space, probed at `scale` pixels per unit. */
  function pickAt(timeline: Timeline, at: number, x: number, y: number, scale: number): { layer: number; el: number } | null {
    renderer.overrides.clear();
    for (const [name, t] of working) renderer.overrides.set(name, t);
    renderer.overrides.set(symbol, timeline);
    const test = (layer: Layer): boolean => {
      const probe = new OffscreenCanvas(1, 1), ctx = probe.getContext("2d", { willReadFrequently: true })!;
      ctx.setTransform(scale, 0, 0, scale, -x * scale, -y * scale);
      renderer.drawTimeline(ctx, { name: "", layers: [{ ...layer, parent: null, type: "normal" }], length: timeline.length }, at);
      return ctx.getImageData(0, 0, 1, 1).data[3] > 8;
    };
    for (let i = 0; i < timeline.layers.length; i += 1) {
      const layer = timeline.layers[i];
      if (layer.type === "folder" || layer.type === "guide" || layer.type === "mask") continue;
      const state = layerStateAt(layer, at);
      if (!state || !test(layer)) continue;
      const parts = resolveElements(layer, at);
      for (let j = parts.length - 1; j >= 0; j -= 1) {
        const only: Layer = { ...layer, frames: [{ i: state.key.i, d: state.key.d, elements: [parts[j] as FlaElement] }] };
        if (test(only)) return { layer: i, el: j };
      }
      return { layer: i, el: Math.max(0, parts.length - 1) };
    }
    return null;
  }
  /** The part at the pointer on the stage. */
  function pick(cx: number, cy: number): { layer: number; el: number } | null {
    if (!shown || !canvas.current) return null;
    const { s, tx, ty } = fit(canvas.current.width, canvas.current.height);
    return pickAt(shown, frame, (cx - tx) / s, (cy - ty) / s, s);
  }

  /** Double-click: step into the symbol under the pointer (and select what lies under it there); on empty stage, step back out. */
  const onStageDouble = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!shown || !canvas.current) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const cx = (e.clientX - rect.left) * (e.currentTarget.width / rect.width), cy = (e.clientY - rect.top) * (e.currentTarget.height / rect.height);
    const hit = pick(cx, cy);
    if (!hit) {
      if (stack.length > 1) setStack((st) => st.slice(0, -1));
      return;
    }
    const layer = shown.layers[hit.layer];
    const part = resolveElements(layer, frame)[hit.el];
    const inner = part?.k === "instance" ? doc.symbols.get(part.item)?.timeline : undefined;
    if (!part || part.k !== "instance" || !inner) { setNote("Nothing to step into here: this is plain artwork"); return; }
    const { s, tx, ty } = fit(canvas.current.width, canvas.current.height);
    const back = invert(part.m);
    const x = (cx - tx) / s, y = (cy - ty) / s;
    arriving.current = { frame: innerFrame(part, layerStateAt(layer, frame)?.offset ?? 0, inner.length), at: [back[0] * x + back[2] * y + back[4], back[1] * x + back[3] * y + back[5]] };
    setStack((st) => [...st, { item: part.item, m: [...part.m] as Matrix }]);
  };

  const toCanvas = (e: React.PointerEvent<HTMLCanvasElement>): [number, number] => {
    const rect = e.currentTarget.getBoundingClientRect();
    return [(e.clientX - rect.left) * (e.currentTarget.width / rect.width), (e.clientY - rect.top) * (e.currentTarget.height / rect.height)];
  };
  /** Every part whose artwork touches the box (canvas pixels). */
  function boxPick(x0: number, y0: number, x1: number, y1: number): Sel[] {
    if (!shown || !canvas.current) return [];
    const { s, tx, ty } = fit(canvas.current.width, canvas.current.height);
    const w = Math.max(1, Math.ceil(x1 - x0)), h = Math.max(1, Math.ceil(y1 - y0));
    const found: Sel[] = [];
    renderer.overrides.clear();
    for (const [name, t] of working) renderer.overrides.set(name, t);
    renderer.overrides.set(symbol, shown);
    shown.layers.forEach((layer, i) => {
      if (layer.type === "folder" || layer.type === "guide" || layer.type === "mask") return;
      const state = layerStateAt(layer, frame);
      if (!state) return;
      resolveElements(layer, frame).forEach((part, j) => {
        const probe = new OffscreenCanvas(w, h), ctx = probe.getContext("2d", { willReadFrequently: true })!;
        ctx.setTransform(s, 0, 0, s, tx - x0, ty - y0);
        const only: Layer = { ...layer, parent: null, type: "normal", frames: [{ i: state.key.i, d: state.key.d, elements: [part as FlaElement] }] };
        renderer.drawTimeline(ctx, { name: "", layers: [only], length: shown.length }, frame);
        const data = ctx.getImageData(0, 0, w, h).data;
        for (let k = 3; k < data.length; k += 4) if (data[k] > 8) { found.push({ layer: i, el: j }); return; }
      });
    });
    return found;
  }
  const selected = (): Sel[] => [...(elIndex != null ? [{ layer: layerIndex, el: elIndex }] : []), ...others];
  const same = (a: Sel, b: Sel) => a.layer === b.layer && a.el === b.el;

  const onStageDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const [cx, cy] = toCanvas(e);
    const hit = pick(cx, cy);
    if (!hit || !shown) {
      // Empty stage: a drag draws a box (shift keeps what is selected already).
      if (!e.shiftKey) { setElIndex(null); setOthers([]); }
      e.currentTarget.setPointerCapture(e.pointerId);
      setDrag({ kind: "box", from: [cx, cy], to: [cx, cy] });
      return;
    }
    const now = selected();
    let next: Sel[];
    if (e.shiftKey) next = now.some((o) => same(o, hit)) ? now.filter((o) => !same(o, hit)) : [...now, hit];
    else next = now.some((o) => same(o, hit)) ? now : [hit];
    setLayerIndex(hit.layer);
    setElIndex(next.length ? next[0].el : null);
    if (next.length) setLayerIndex(next[0].layer);
    setOthers(next.slice(1));
    if (e.shiftKey || !next.length) return;
    const held = next.flatMap((o) => { const part = resolveElements(shown.layers[o.layer], frame)[o.el]; return part ? [{ ...o, m: [...part.m] as Matrix }] : []; });
    if (!held.length) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrag({ kind: "part", start: [cx, cy], held });
  };
  const onStageMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drag || !shown || !canvas.current) return;
    const [cx, cy] = toCanvas(e);
    if (drag.kind === "box") { setDrag({ ...drag, to: [cx, cy] }); return; }
    if (drag.kind !== "part") return;
    const { s } = fit(canvas.current.width, canvas.current.height);
    const dx = (cx - drag.start[0]) / s, dy = (cy - drag.start[1]) / s;
    const preview = new Map<number, Layer>();
    for (const h of drag.held) preview.set(h.layer, setMatrix(preview.get(h.layer) ?? base!.layers[h.layer], frame, h.el, [h.m[0], h.m[1], h.m[2], h.m[3], h.m[4] + dx, h.m[5] + dy]));
    setDrag({ ...drag, preview });
  };
  const onStageUp = () => {
    if (drag?.kind === "part" && drag.preview) {
      const preview = drag.preview;
      const layers = base!.layers.map((l, i) => preview.get(i) ?? l);
      const map = new Map(working);
      map.set(symbol, { ...base!, layers, length: lengthOf(layers) });
      setHist((h) => commit(h, map));
    } else if (drag?.kind === "box") {
      const big = Math.abs(drag.to[0] - drag.from[0]) > 3 || Math.abs(drag.to[1] - drag.from[1]) > 3;
      if (big) {
        const inside = boxPick(Math.min(drag.from[0], drag.to[0]), Math.min(drag.from[1], drag.to[1]), Math.max(drag.from[0], drag.to[0]), Math.max(drag.from[1], drag.to[1]));
        const all = [...selected(), ...inside.filter((n) => !selected().some((o) => same(o, n)))];
        if (all.length) { setLayerIndex(all[0].layer); setElIndex(all[0].el); setOthers(all.slice(1)); }
        setNote(`${all.length} part${all.length === 1 ? "" : "s"} selected`);
      }
    }
    setDrag(null);
  };

  // ---- timeline
  const frameAt = (e: React.PointerEvent<HTMLElement>, left: number) => Math.max(0, Math.floor((e.clientX - left) / CELL));
  const onRowDown = (e: React.PointerEvent<HTMLDivElement>, index: number) => {
    const left = e.currentTarget.getBoundingClientRect().left;
    const f = frameAt(e, left);
    const layer = shown?.layers[index];
    const startKey = layer?.frames.find((k) => k.i === f);
    setLayerIndex(index); setElIndex(null);
    if (e.shiftKey) { setRange(([a]) => [Math.min(a, f), Math.max(a, f)]); setFrame(f); return; }
    setFrame(f); setRange([f, f]);
    if (startKey && e.altKey) {
      e.currentTarget.setPointerCapture(e.pointerId);
      setDrag({ kind: "key", layer: index, from: f, start: f, to: f });
    }
  };
  const onRowMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (drag?.kind !== "key") return;
    setDrag({ ...drag, to: frameAt(e, e.currentTarget.getBoundingClientRect().left) });
  };
  const onRowUp = () => {
    if (drag?.kind === "key" && drag.to !== drag.from) { const d = drag; edit((l) => moveKeyframe(l, d.from, d.to), d.layer); setFrame(drag.to); setRange([drag.to, drag.to]); }
    setDrag(null);
  };

  // ---- save / open
  const download = () => {
    const edits = editsOf(doc, new Map(working));
    const blob = new Blob([serializeEdits(edits)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = `${doc.name}.cb-pose-edits.json`; a.click();
    URL.revokeObjectURL(a.href);
    setNote(`Saved ${Object.keys(edits.symbols).length} edited symbol(s)`);
  };
  const open = async (file: File) => {
    try {
      const edits = parseEdits(await file.text());
      const map = new Map<string, Timeline>();
      const missing = applyEdits(doc, edits, map);
      setHist(history<Working>(map));
      setNote(`Opened ${Object.keys(edits.symbols).length - missing.length} edited symbol(s)${missing.length ? `, ${missing.length} no longer in the document` : ""}`);
    } catch (error) { setNote(error instanceof Error ? error.message : String(error)); }
  };

  const part = shown && elIndex != null && shown.layers[layerIndex] ? resolveElements(shown.layers[layerIndex], frame)[elIndex] : undefined;
  const parts = shown?.layers[layerIndex] ? resolveElements(shown.layers[layerIndex], frame) : [];
  const btn: React.CSSProperties = { padding: "3px 8px", font: "12px system-ui" };

  return (
    <div data-testid="native-editor" style={{ display: "grid", gap: 8 }}>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
        <select value={stack[0].item} onChange={(e) => setStack([{ item: e.target.value, m: IDENTITY }])}>{poses.map((p) => <option key={p.item} value={p.item}>{p.name}</option>)}</select>
        {stack.length > 1 && <button style={btn} onClick={() => setStack((s) => s.slice(0, -1))}>Up</button>}
        <span style={{ font: "12px system-ui" }}>{stack.map((l) => short(l.item)).join(" › ")}</span>
        <button data-testid="insert-frame" style={btn} onClick={commands["insert-frame"]}>F5 Insert Frame</button>
        <button data-testid="remove-frames" style={btn} onClick={commands["remove-frames"]}>⇧F5 Remove Frames</button>
        <button data-testid="insert-keyframe" style={btn} onClick={commands["insert-keyframe"]}>F6 Keyframe</button>
        <button data-testid="blank-keyframe" style={btn} onClick={commands["blank-keyframe"]}>F7 Blank</button>
        <button data-testid="clear-keyframe" style={btn} onClick={commands["clear-keyframe"]}>⇧F6 Clear</button>
        <button data-testid="copy-part" style={btn} onClick={copyPart}>⌘C Copy part</button>
        <button data-testid="paste-part" style={btn} onClick={() => void pastePart()}>⌘V Paste as layer</button>
        <button data-testid="delete-layer" style={btn} onClick={deleteSelected}>⌫ Delete layer</button>
        <button data-testid="undo" style={btn} onClick={doUndo} disabled={!hist.past.length}>Undo</button>
        <button data-testid="redo" style={btn} onClick={doRedo} disabled={!hist.future.length}>Redo</button>
        <label style={{ font: "12px system-ui" }}><input type="checkbox" checked={allLayers} onChange={(e) => setAllLayers(e.target.checked)} /> all layers</label>
        <button style={btn} onClick={() => setPlaying((p) => !p)}>{playing ? "Pause" : "Play"}</button>
        <button data-testid="save" style={btn} onClick={download}>Save edits</button>
        <label style={{ font: "12px system-ui" }}>Open edits: <input type="file" accept=".json" onChange={(e) => e.target.files?.[0] && open(e.target.files[0])} /></label>
        <span data-testid="note" style={{ font: "12px system-ui" }}>{note}</span>
      </div>
      <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
        <canvas data-testid="stage" ref={canvas} width={760} height={560} style={{ border: "1px solid #ccc", width: 570, height: 420, touchAction: "none", cursor: drag?.kind === "part" ? "grabbing" : drag?.kind === "box" ? "crosshair" : "default" }}
          onPointerDown={onStageDown} onPointerMove={onStageMove} onPointerUp={onStageUp} onDoubleClick={onStageDouble} />
        <div style={{ font: "12px system-ui", minWidth: 240 }}>
          <div><b>frame {frame + 1}</b> of {length}{range[1] > range[0] ? ` (selected ${range[0] + 1}–${range[1] + 1})` : ""} · layer {shown?.layers[layerIndex]?.name || "—"}</div>
          <div style={{ marginTop: 6 }}>Parts here:</div>
          {parts.map((p, i) => (
            <div key={i}>
              <button style={{ ...btn, background: i === elIndex ? "#ffd7ee" : undefined }} onClick={() => setElIndex(i)}>#{i + 1} {p.k === "instance" ? short(p.item) : p.k}</button>
              {p.k === "instance" && i === elIndex && doc.symbols.has(p.item) && <button style={btn} onClick={() => setStack((s) => [...s, { item: p.item, m: [...p.m] as Matrix }])}>Step into</button>}
            </div>
          ))}
          {part && <div style={{ marginTop: 6 }}>x {part.m[4].toFixed(1)} · y {part.m[5].toFixed(1)}</div>}
          <div style={{ marginTop: 6, color: "#666" }}>Click a part on the stage, drag to move; Delete removes its layer, the dot beside a layer hides it; ⇧-click adds or removes a part, drag a box on empty stage to select every part it touches (they move together); double-click a symbol to step into it (double-click empty stage steps out). ⌥-drag a keyframe in the timeline to move it. ⇧-click extends the frame selection. , and . step frames.</div>
        </div>
      </div>
      {shown && (
        <div style={{ overflowX: "auto", border: "1px solid #ccc", maxWidth: 1100 }} data-testid="timeline">
          <div style={{ display: "flex" }}>
            <div style={{ width: 170, flex: "none" }} />
            <div style={{ position: "relative", height: 16, width: length * CELL + 40 * CELL, font: "9px system-ui" }}>
              {Array.from({ length: Math.ceil(length / 5) + 8 }, (_, i) => <span key={i} style={{ position: "absolute", left: i * 5 * CELL + 1 }}>{i * 5 + 1}</span>)}
            </div>
          </div>
          {shown.layers.map((layer, index) => (
            <div key={index} style={{ display: "flex", height: ROW, borderTop: "1px solid #e4e4e4", background: index === layerIndex ? "#f4f8ff" : undefined }}>
              <div style={{ width: 170, flex: "none", font: "12px system-ui", padding: "4px 6px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                <button data-testid={`eye-${index}`} title={layer.off ? "Show layer" : "Hide layer"} aria-pressed={!layer.off} style={{ ...btn, padding: "0 4px", marginRight: 4, opacity: layer.off ? 0.4 : 1 }} onClick={() => toggleEye(index)}>{layer.off ? "○" : "●"}</button>
                <span style={{ opacity: layer.off ? 0.5 : 1 }}>{layer.type !== "normal" ? `[${layer.type}] ` : ""}{layer.name}</span>
              </div>
              <div style={{ position: "relative", width: length * CELL + 40 * CELL, touchAction: "none" }} data-layer={index} onPointerDown={(e) => onRowDown(e, index)} onPointerMove={onRowMove} onPointerUp={onRowUp}>
                {layer.frames.map((k) => {
                  const moving = drag?.kind === "key" && drag.layer === index && drag.from === k.i;
                  const left = (moving ? drag.to : k.i) * CELL;
                  return (
                    <div key={k.i} data-key={`${index}:${k.i}`} style={{ position: "absolute", left, top: 2, height: ROW - 5, width: k.d * CELL - 1, boxSizing: "border-box", border: "1px solid #777", opacity: moving ? 0.6 : 1,
                      background: k.tween === "shape" ? "#bfe8bf" : k.tween ? "#d9c8f0" : k.elements.length ? "#e8e8e8" : "#fff" }}>
                      <div style={{ width: 6, height: 6, borderRadius: 3, margin: "2px 0 0 2px", background: k.elements.length ? "#222" : "#fff", border: "1px solid #222" }} />
                    </div>
                  );
                })}
                <div style={{ position: "absolute", left: frame * CELL, top: 0, width: CELL, height: ROW, border: "1px solid #e5007d", boxSizing: "border-box", pointerEvents: "none" }} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
