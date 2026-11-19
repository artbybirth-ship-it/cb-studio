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
import { createPortal } from "react-dom";
import { colourAtPoint, paletteOf, relativesOf } from "../lib/native/character";
import type { Ease, FlaDocument, FlaElement, Keyframe, Layer, Matrix, Timeline } from "../lib/fla/xfl";
import type { NativeRenderer } from "../lib/native/render";
import { blankKeyframes, clearKeyframe, commit, copyFrames, moveFrames, reverseFrames, setTween, cutFrames, deleteLayers, duplicateLayers, pasteFrames, type FrameClip, history, insertBlankKeyframe, insertLayer, renameLayer, setLayerLocked, insertFrames, insertKeyframe, moveKeyframe, redo, removeFrames, resolveElements, setEase, setElement, setLayerOff, setMatrix, swapSymbol, undo, type History } from "../lib/native/ops";
import { addAnchor, convertAnchor, deleteAnchors, edgeAt, moveAnchors, movePoint, samePoint, shapePoints, type PointRef, type Pt } from "../lib/native/points";
import { innerFrame, layerStateAt } from "../lib/native/evaluate";
import { applyEdits, editsOf, parseEdits, serializeEdits, type NativeEdits } from "../lib/native/store";
import { IDENTITY, addPicture, importElements, invert, mul, poseScale, registerLibrary } from "../lib/native/library";
import { copyClip, readClip } from "../lib/native/clipboard";
import { loadNativeDoc } from "../lib/native/loadDoc";
import { EaseControl } from "./Timeline";
import SymbolTimeline, { PoseLibraryPictures, type FlaFrame, type FrameOp } from "./SymbolTimeline";
import { arrangeNative, arrangedPositions, arrangementOf, asTheFileHasThem, fileArrangement, flaSymbolOf } from "../lib/native/timelineView";
import PartMenu, { type PartAction } from "./PartMenu";
import { arrangeSymbolLayers, groupLayers, ungroupLayer } from "../lib/symbolLayers";
import { useEscClose } from "../lib/escClose";
import type { SymbolLayerEdit } from "../types";
import { createjsValuesOf, withCreatejsValues } from "../lib/native/legacy";
import { fileAnchors, type Anchor } from "../lib/symbolKeys";
import { autoNameAt, autoNames, layerKey } from "../lib/native/names";
import type { MediaLibraryItem } from "../lib/mediaLibrary";
import { pivotOf, propsOf, withProps, type PartProps } from "../lib/native/props";
import { apply as applyM, boxAround, cornersOf, handleTransform, invert as invertM, mul as mulM, HANDLE_AT, type Box, type Handle } from "../lib/native/handles";
import { scrubProps, SCRUB_END, SCRUB_START } from "../lib/scrub";

const CELL = 12;
const ROW = 24;
type Working = ReadonlyMap<string, Timeline>;
type Pose = { item: string; name: string };
type Sel = { layer: number; el: number };
type Drag = { kind: "part"; start: [number, number]; held: Array<Sel & { m: Matrix }>; preview?: Map<number, Layer> } | { kind: "point"; layer: number; el: number; ref: PointRef; preview?: Map<number, Layer> } | { kind: "anchors"; layer: number; el: number; from: Pt[]; start: [number, number]; to?: Pt[]; preview?: Map<number, Layer> } | { kind: "box"; from: [number, number]; to: [number, number]; points?: { add: boolean; onShape: boolean } } | { kind: "key"; layer: number; from: number; start: number; to: number; copy: boolean; toLayer: number; d: number }
  | { kind: "handle"; handle: Handle; frame: Matrix; box: Box; pivot: [number, number]; start: [number, number]; held: Array<Sel & { m: Matrix }>; preview?: Map<number, Layer> }
  | { kind: "pivot"; layer: number; el: number; m: Matrix; preview?: Map<number, Layer> };

/** Frames copied in the timeline (Copy / Cut Frames): one clip per layer, top first, kept while the editor moves between symbols. */
let frameClipboard: { clips: Array<{ offset: number; clip: FrameClip }>; from: number; layer: number; symbol: string } | null = null;
const lengthOf = (layers: Layer[]) => Math.max(1, ...layers.flatMap((l) => l.frames.map((k) => k.i + k.d)));
const short = (name: string) => name.split("/").pop() || name;
/** A library name as people read it: Animate files can keep characters such as "<" as codes ("&#060Path&#062 copy 2" is "<Path> copy 2"). */
const readable = (name: string) => short(name).replace(/&#0*(\d+);?/g, (_, code: string) => String.fromCharCode(Number(code))).replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
/**
 * A tween's ease as the Ease box shows it (the same box as the scene timeline and the old pose timeline): −100 ease in … 100 ease out.
 * The .fla stores the opposite sign (intensity −100 = ends slowly = ease out 100). A custom curve or a named ease has no number: null.
 */
const easeNumber = (ease: Ease | undefined): number | null => (!ease ? 0 : ease.custom?.length || (ease.method && ease.method !== "none") ? null : -(ease.intensity || 0));
const easeOfNumber = (value: number): Ease => ({ intensity: -value });
const easeWords = (ease: Ease | undefined) => {
  const value = easeNumber(ease);
  return value == null ? "custom ease" : value < 0 ? `ease in ${-value}` : value > 0 ? `ease out ${value}` : "no easing";
};
const sameEase = (a: Ease | undefined, b: Ease | undefined) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
/** The tween the frame `at` of `layer` is in (its starting keyframe), when that keyframe tweens into the next one. */
const tweenAt = (layer: Layer | undefined, at: number): Keyframe | null => {
  const state = layer && layerStateAt(layer, at);
  if (!state || !state.key.tween || state.key.tween === "motion object" || !state.next || state.next.i !== state.key.i + state.key.d) return null;
  return state.key;
};
/** A number box of the Properties: drag left / right to change it (lib/scrub.ts, like every number box), or click and type. */
function PropField({ id, label, unit, value, decimals, min, max, onChange }: { id: string; label: string; unit?: string; value: number; decimals: number; min?: number; max?: number; onChange: (value: number) => void }) {
  const [text, setText] = useState<string | null>(null);
  const round = (v: number) => Math.round(v * 10 ** decimals) / 10 ** decimals;
  const commitTyped = () => {
    const next = parseFloat(String(text ?? "").replace(",", ".").replace(/[^\d.+-]/g, ""));
    setText(null);
    if (Number.isFinite(next) && Math.abs(next - round(value)) > 1e-9) onChange(Math.max(min ?? -Infinity, Math.min(max ?? Infinity, next)));
  };
  return (
    <label style={{ display: "inline-flex", alignItems: "center", gap: 3, marginRight: 8 }} title={`${label}: drag left or right to change, or click and type`}>
      <span style={{ color: "#555" }}>{label}</span>
      <input data-testid={`native-prop-${id}`} type="text" inputMode="decimal" aria-label={label} value={text ?? `${round(value)}`}
        style={{ width: 54, font: "12px system-ui", padding: "1px 3px", cursor: "ew-resize" }}
        {...scrubProps({ value: round(value), onChange, min, max, decimals, step: 1 })}
        onFocus={(e) => { setText(String(round(value))); e.target.select(); }}
        onChange={(e) => setText(e.target.value)} onBlur={commitTyped}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); e.currentTarget.blur(); } else if (e.key === "Escape") { setText(null); e.currentTarget.blur(); } }} />
      {unit && <span style={{ color: "#777" }}>{unit}</span>}
    </label>
  );
}
const isTyping = (target: EventTarget | null) => target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName);

/** Where a drawing's ink lies, in the units `draw` draws in (found on a big scratch canvas at half size); null when nothing is drawn. */
function inkBox(draw: (ctx: OffscreenCanvasRenderingContext2D) => void): { x: number; y: number; w: number; h: number } | null {
  const SIZE = 1400, S = 0.5;
  const scratch = new OffscreenCanvas(SIZE, SIZE), ctx = scratch.getContext("2d", { willReadFrequently: true })!;
  ctx.setTransform(S, 0, 0, S, SIZE / 2, SIZE / 2);
  draw(ctx);
  const data = ctx.getImageData(0, 0, SIZE, SIZE).data;
  let x0 = SIZE, y0 = SIZE, x1 = -1, y1 = -1;
  for (let y = 0; y < SIZE; y += 1) for (let x = 0; x < SIZE; x += 1) if (data[(y * SIZE + x) * 4 + 3] > 8) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  return x1 < 0 ? null : { x: (x0 - SIZE / 2) / S, y: (y0 - SIZE / 2) / S, w: (x1 - x0) / S, h: (y1 - y0) / S };
}

/** The colour tools' view of the open level (what the Animate player's colour finder answers), for the scene editor's dropper and the like. */
export type NativeColourFrame = { getBoundingClientRect: () => DOMRect; contentWindow: { cbColorAt: (x: number, y: number, scope: string) => unknown; cbColorPalette: (scope: string) => unknown; cbColorRelatives: (hex: string, scope: string) => unknown } };

export default function NativePoseEditor({ doc, renderer, poses, initialEdits, onChange, flaUrl, uploadPicture, embedded, crumbs, onStepOut, colourPick, onColourFrame, onScope, pointTool, onPointTool, onNotice, redrawKey, note: outsideNote, sceneHistory, zoom: zoomProp, onZoom, onFitScale, viewReset, zoomTool, playToggle }: {
  doc: FlaDocument; renderer: NativeRenderer; poses: Pose[];
  /** Where this character's .fla came from: lets a copied part be found again after a reload. */
  flaUrl?: string;
  /** Edits saved earlier, replayed on open. */
  initialEdits?: NativeEdits | null;
  /** Called with the edits as they now are after every change (not on open). */
  onChange?: (edits: NativeEdits) => void;
  /** Stores a picture file from the computer with the project and answers its address (the scene editor); without it the picture's bytes are kept in the edits. */
  uploadPicture?: (file: File) => Promise<string>;
  /** In place in the scene editor (Phase 6): the stage goes into `stage` (the canvas area), the toolbar and timeline into `timeline`. */
  embedded?: { stage: HTMLElement; timeline: HTMLElement } | null;
  /** In place: the names before the open pose (scene, character); a click on one, a double-click on empty stage at the pose's own level, steps out. */
  crumbs?: string[];
  onStepOut?: () => void;
  /** A colour tool is waiting for a click (dropper, Light/Dark, a colour box): stage clicks go to it instead of picking parts. */
  colourPick?: ((clientX: number, clientY: number, keys: { altKey: boolean; shiftKey: boolean }) => void) | null;
  /** Told the colour tools' view of the open level (null when it goes). */
  onColourFrame?: (frame: NativeColourFrame | null) => void;
  /** Told the colour scope of the picked parts ("@<class>/<names>", what the colour tools then work on), or null for the whole character. */
  onScope?: (scope: string | null) => void;
  /** In place: point editing follows the scene's Direct select tool (A on the tool rail; V turns it off). */
  pointTool?: boolean;
  /** Told when point editing is turned on or off here (A, or the button), so the scene's tool rail follows. */
  onPointTool?: (on: boolean) => void;
  /** In place: messages go to the scene editor's notice (the timeline panel has no line of its own for them). */
  onNotice?: (text: string) => void;
  /** Draw again when this changes (the character's colour rules changed). */
  redrawKey?: string;
  /** A message from outside (older edits converted…), shown with the editor's own notes. */
  note?: string;
  /**
   * In place: the scene's one Undo / Redo is used (each change here is one step of it, through onChange). After each, `turn` changes and the
   * timelines are taken again from `edits`, the character's edits as the scene now has them.
   */
  sceneHistory?: { turn: number; edits?: NativeEdits | null; undo: () => void; redo: () => void };
  /** In place: the view's zoom, set by the scene editor (⌘+ / ⌘− / ⌘0 / ⌘1, its zoom box). 1 = the open level fitted to the stage. */
  zoom?: number;
  /** Asked for another zoom from here (the wheel / a pinch, the Zoom tool's click), about the pointer. */
  onZoom?: (zoom: number) => void;
  /** Told what zoom 1 is on screen (CSS pixels per unit of the open level), for the scene editor's zoom box and Actual Size. */
  onFitScale?: (scale: number) => void;
  /** In place: changes when the view goes back to the middle (⌘0, Fit in Window). */
  viewReset?: number;
  /** In place: the scene's Zoom tool is on (a click zooms in there, ⌥-click zooms out). */
  zoomTool?: boolean;
  /** In place: changes when the scene editor's Enter / Return plays or pauses the pose (as the timeline's play button does). */
  playToggle?: number;
}) {
  const [hist, setHist] = useState<History<Working>>(() => {
    const map = new Map<string, Timeline>();
    if (initialEdits) applyEdits(doc, initialEdits, map);
    return history<Working>(map);
  });
  const opened = useRef(hist.present);
  // Told once per change of the timelines (not again when only the callback is a new function).
  const emitted = useRef(hist.present);
  useEffect(() => {
    if (hist.present === emitted.current) return;
    emitted.current = hist.present;
    if (hist.present !== opened.current) onChange?.(editsOf(doc, new Map(hist.present)));
  }, [hist.present, doc, onChange]);
  // In place: after the scene's Undo / Redo, the timelines are the character's edits as the scene now has them (not saved again).
  const turnSeen = useRef(sceneHistory?.turn);
  useEffect(() => {
    if (!sceneHistory || sceneHistory.turn === turnSeen.current) return;
    turnSeen.current = sceneHistory.turn;
    const map = new Map<string, Timeline>();
    if (sceneHistory.edits) applyEdits(doc, sceneHistory.edits, map);
    // The selection stays unless the layers changed in number (then the old numbers point at other parts).
    const count = (w: Working) => (w.get(symbol) ?? doc.symbols.get(symbol)?.timeline)?.layers.length ?? 0;
    if (count(map) !== count(hist.present)) { setElIndex(null); setOthers([]); }
    opened.current = map;
    emitted.current = map;
    setHist(history<Working>(map));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sceneHistory?.turn]);
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
  /** Point editing (A, Animate's Subselection tool): the selected drawn shape shows its anchor points, which can be dragged. */
  const [pointMode, setPointMode] = useState(false);
  /** In place: the keyframe picked in the timeline panel (its value boxes show it), and the panel's live preview of a keyframe drag. */
  const [keyPick, setKeyPick] = useState<{ layer: number; frame: number } | null>(null);
  /** In place: the right-click menu of a part (the older pose view's menu, shared). */
  const [partMenu, setPartMenu] = useState<{ x: number; y: number; hasPart: boolean } | null>(null);
  const [panelPreview, setPanelPreview] = useState<Map<number, Layer> | null>(null);
  /** The selected anchors of the shape being point-edited, in its own space (click, Shift-click, a box; drawn filled). */
  const [selPts, setSelPts] = useState<Pt[]>([]);
  const togglePointMode = () => { const on = !pointMode; setPointMode(on); onPointTool?.(on); };
  useEffect(() => { if (pointTool !== undefined) setPointMode(pointTool); }, [pointTool]);
  const [playing, setPlaying] = useState(false);
  const [playSeen, setPlaySeen] = useState(playToggle);
  if (playSeen !== playToggle) { setPlaySeen(playToggle); setPlaying((p) => !p); }
  const [drag, setDragState] = useState<Drag | null>(null);
  /** The drag as last set (not as last drawn): a release that comes before the screen has caught up with a slow move still keeps that move. */
  const dragNow = useRef<Drag | null>(null);
  const setDrag = useCallback((next: Drag | null) => { dragNow.current = next; setDragState(next); }, []);
  /** The ease while the Ease box is being dragged: the tween plays with it on the stage, nothing is kept until the drag ends. */
  const [easePreview, setEasePreview] = useState<{ layer: number; at: number; value: number } | null>(null);
  /** A Properties number while it is being dragged: shown on the stage, kept as one undo step when the drag ends. */
  const [valuePreview, setValuePreview] = useState<{ layer: number; next: Layer } | null>(null);
  const [view, setView] = useState({ x: 0, y: 0, w: 500, h: 900 });
  /** In place: how far the view is moved from the middle, in canvas pixels (Space-drag or the middle button). */
  const [pan, setPan] = useState({ x: 0, y: 0 });
  /** A zoom asked for from here (wheel, Zoom tool): the canvas point, from the stage's middle, that stays under the pointer when it arrives. */
  const zoomAnchor = useRef<{ zoom: number; at: [number, number] } | null>(null);
  const [zoomSeen, setZoomSeen] = useState(zoomProp ?? 1);
  const [resetSeen, setResetSeen] = useState(viewReset);
  /** Space held (a drag moves the view), and a view move in progress. */
  const [spaceHeld, setSpaceHeld] = useState(false);
  const panDrag = useRef<{ x: number; y: number; from: { x: number; y: number } } | null>(null);
  const [panning, setPanning] = useState(false);
  const [note, setNote] = useState("");
  const canvas = useRef<HTMLCanvasElement>(null);
  /** The stage's size on screen (CSS pixels); its canvas has a third more pixels. In place it follows the scene's canvas area. */
  const [stageCss, setStageCss] = useState({ w: 570, h: 420 });
  useEffect(() => {
    const host = embedded?.stage;
    if (!host) return;
    const measure = () => { const r = host.getBoundingClientRect(); setStageCss({ w: Math.max(200, Math.floor(r.width) - 2), h: Math.max(160, Math.floor(r.height) - 2) }); };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(host);
    return () => observer.disconnect();
  }, [embedded?.stage]);
  const canvasW = Math.round((stageCss.w * 4) / 3), canvasH = Math.round((stageCss.h * 4) / 3);
  /** Set when a double-click steps into a part: the frame it was playing and the point clicked, in its own space, to select what lies under it once the new level is open. */
  const arriving = useRef<{ frame: number; at: [number, number] } | null>(null);

  const working = hist.present;
  const base = working.get(symbol) ?? doc.symbols.get(symbol)?.timeline;
  // The timeline on screen: the working copy with a drag in progress laid over it.
  const shown: Timeline | undefined = useMemo(() => {
    if (!base) return undefined;
    if ((drag?.kind === "part" || drag?.kind === "point" || drag?.kind === "anchors" || drag?.kind === "handle" || drag?.kind === "pivot") && drag.preview) return { ...base, layers: base.layers.map((l, i) => drag.preview!.get(i) ?? l) };
    if (panelPreview) return { ...base, layers: base.layers.map((l, i) => panelPreview.get(i) ?? l) };
    if (easePreview) return { ...base, layers: base.layers.map((l, i) => (i === easePreview.layer ? setEase(l, easePreview.at, easeOfNumber(easePreview.value)) : l)) };
    if (valuePreview) return { ...base, layers: base.layers.map((l, i) => (i === valuePreview.layer ? valuePreview.next : l)) };
    return base;
  }, [base, drag, easePreview, valuePreview, panelPreview]);
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

  // ---- Copy / Cut / Paste Frames: the selected frames (frames range[0]…range[1]) of the picked layer, or of every layer with "all layers".
  const [hasFrames, setHasFrames] = useState(Boolean(frameClipboard));
  /** Where the last press was: ⌘C / ⌘V act on frames after a press in the timeline, on parts after a press on the stage (as Animate's focus). */
  const focusRef = useRef<"stage" | "timeline">("stage");
  const frameLayers = (): number[] => (base ? (allLayers ? base.layers.map((l, i) => (l.type === "folder" ? -1 : i)).filter((i) => i >= 0) : [layerIndex]) : []);
  const copyFramesCmd = useCallback((cut = false) => {
    if (!base) return;
    const chosen = frameLayers().filter((i) => base.layers[i]);
    if (!chosen.length) return;
    const [from, to] = range;
    const first = chosen[0];
    frameClipboard = { clips: chosen.map((i) => ({ offset: i - first, clip: copyFrames(base.layers[i], from, to) })), from, layer: first, symbol };
    setHasFrames(true);
    const what = `${to - from + 1} frame${to > from ? "s" : ""}${chosen.length > 1 ? ` of ${chosen.length} layers` : ""}`;
    if (!cut) { setNote(`Copied ${what}`); return; }
    const layers = base.layers.map((l, i) => (chosen.includes(i) && !l.locked ? cutFrames(l, from, to).layer : l));
    const map = new Map(working);
    map.set(symbol, { ...base, layers, length: lengthOf(layers) });
    setHist((h) => commit(h, map));
    setNote(`Cut ${what}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base, working, symbol, range, allLayers, layerIndex]);
  const pasteFramesCmd = useCallback((inPlace = false) => {
    const clip = frameClipboard;
    if (!base || !clip) { setNote("Nothing to paste: copy frames first (⌥⌘C)"); return; }
    // With "all layers" the frames go back onto the layers they came from; otherwise onto the picked layer and the ones below it.
    const first = inPlace || (allLayers && clip.clips.length > 1) ? clip.layer : layerIndex, at = inPlace ? clip.from : range[0];
    let skipped = 0;
    const layers = base.layers.slice();
    for (const { offset, clip: c } of clip.clips) {
      const i = first + offset, layer = layers[i];
      if (!layer || layer.type === "folder" || layer.locked) { skipped += 1; continue; }
      layers[i] = pasteFrames(layer, at, c);
    }
    if (skipped === clip.clips.length) { setNote("These layers can't take the frames (locked, folders, or past the last layer)"); return; }
    const map = new Map(working);
    map.set(symbol, { ...base, layers, length: lengthOf(layers) });
    setHist((h) => commit(h, map));
    const length = Math.max(...clip.clips.map((c) => c.clip.length));
    setLayerIndex(first); setFrame(at); setRange([at, at + length - 1]);
    setNote(`Pasted ${length} frame${length > 1 ? "s" : ""}${skipped ? ` (${skipped} layer${skipped > 1 ? "s" : ""} skipped: locked, folders or past the last layer)` : ""}`);
  }, [base, working, symbol, layerIndex, range, allLayers]);
  const framesRef = useRef({ copy: copyFramesCmd, paste: pasteFramesCmd });
  framesRef.current = { copy: copyFramesCmd, paste: pasteFramesCmd };

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
  deleteRef.current = () => { if (!deletePointsRef.current()) deleteSelected(); };
  const deletePointsRef = useRef<() => boolean>(() => false);
  const togglePointRef = useRef(togglePointMode);
  togglePointRef.current = togglePointMode;
  /** The eye: hides or shows one layer (undoable). */
  const toggleEye = (index: number) => { const layer = base?.layers[index]; if (layer) { edit((l) => setLayerOff(l, !layer.off), index); } };
  /** The padlock (undoable): a locked layer's parts cannot be picked or changed on the stage; what was selected on it is let go. */
  const toggleLock = (index: number) => {
    const layer = base?.layers[index];
    if (!layer) return;
    edit((l) => setLayerLocked(l, !layer.locked), index);
    if (!layer.locked) { if (layerIndex === index) setElIndex(null); setOthers((o) => o.filter((x) => x.layer !== index)); }
  };
  const [renaming, setRenaming] = useState<number | null>(null);
  const commitRename = (index: number, name: string) => {
    setRenaming(null);
    if (!base) return;
    const layers = renameLayer(base.layers, index, name);
    if (layers === base.layers) return;
    const map = new Map(working);
    map.set(symbol, { ...base, layers });
    setHist((h) => commit(h, map));
    setNote(`Renamed to ${name.trim()}`);
  };
  /** Duplicate Layers: the layers of the selected parts, or the picked layer; the copies sit just above and are picked. */
  const duplicateSelected = () => {
    if (!base) return;
    const chosen = elIndex != null ? [layerIndex, ...others.map((o) => o.layer)] : [layerIndex];
    const made = duplicateLayers(base.layers, chosen);
    if (!made.copies.length) { setNote("Folders and mask layers are not duplicated: pick a plain layer"); return; }
    const map = new Map(working);
    map.set(symbol, { ...base, layers: made.layers, length: lengthOf(made.layers) });
    setHist((h) => commit(h, map));
    setLayerIndex(made.copies[0]); setElIndex(null); setOthers([]);
    setNote(`Duplicated ${made.copies.length > 1 ? `${made.copies.length} layers` : `layer ${base.layers[chosen[0]].name}`}`);
  };
  const doUndo = () => (sceneHistory ? sceneHistory.undo() : stepHistory(undo));
  const doRedo = () => (sceneHistory ? sceneHistory.redo() : stepHistory(redo));

  // Keys are taken in the capture phase and stopped, so the scene editor behind a dialog never also acts on them (F6, ⌘Z, ⌘C, ⌘V…).
  const embeddedRef = useRef(Boolean(embedded));
  embeddedRef.current = Boolean(embedded);
  const copyRef = useRef<() => void>(() => {});
  const pasteRef = useRef<() => void>(() => {});
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return;
      const mod = e.metaKey || e.ctrlKey;
      const take = () => { e.preventDefault(); e.stopPropagation(); };
      // In place the timeline panel takes the frame keys on the frames selected in it (F5, F6, F7, ⌥⌘C / X / V, ⌘⇧V, and , / . to step).
      if (embeddedRef.current && (/^F[567]$/.test(e.key) || (mod && e.altKey && /^Key[CXV]$/.test(e.code)) || (mod && e.shiftKey && e.code === "KeyV") || e.key === "," || e.key === ".")) return;
      // In place, ⌘Z is the scene's (it reaches the scene editor); here it is the editor's own.
      if (mod && e.code === "KeyZ") { if (sceneHistory) return; take(); if (e.shiftKey) doRedo(); else doUndo(); return; }
      // In place, the part menu's shortcuts (as the older pose view had them): ⌘X cut, ⌘F / ⌘B paste in front / back, ⌘↑ / ⌘↓ arrange
      // (⇧: all the way), ⌘D duplicate the layer, ⌘G / ⇧⌘G group / ungroup, H / ⇧H flip.
      if (embeddedRef.current && !e.altKey) {
        const act: PartAction | null = mod && e.code === "KeyX" ? "cut"
          : mod && !e.shiftKey && e.code === "KeyF" ? "pasteFront" : mod && !e.shiftKey && e.code === "KeyB" ? "pasteBack"
          : mod && e.key === "ArrowUp" ? (e.shiftKey ? "toFront" : "forward") : mod && e.key === "ArrowDown" ? (e.shiftKey ? "toBack" : "backward")
          : mod && !e.shiftKey && e.code === "KeyD" ? "duplicate" : mod && e.code === "KeyG" ? (e.shiftKey ? "ungroup" : "group")
          : !mod && e.code === "KeyH" ? (e.shiftKey ? "flipV" : "flipH") : null;
        if (act) { take(); partActionRef.current(act); return; }
      }
      // Frames: ⌥⌘C / ⌥⌘X / ⌥⌘V always, ⌘⇧V pastes them back where they were copied from; ⌘C / ⌘V act on frames after a press in the timeline.
      if (mod && e.altKey && e.code === "KeyC") { take(); framesRef.current.copy(false); return; }
      if (mod && e.altKey && e.code === "KeyX") { take(); framesRef.current.copy(true); return; }
      if (mod && e.altKey && e.code === "KeyV") { take(); framesRef.current.paste(false); return; }
      if (mod && e.shiftKey && e.code === "KeyV") { take(); framesRef.current.paste(true); return; }
      if (mod && e.code === "KeyC") { take(); if (focusRef.current === "timeline") framesRef.current.copy(false); else copyRef.current(); return; }
      if (mod && e.code === "KeyV") { take(); if (focusRef.current === "timeline") framesRef.current.paste(false); else pasteRef.current(); return; }
      if (e.key === "Delete" || e.key === "Backspace") { take(); deleteRef.current(); return; }
      // Arrow keys nudge the selected parts one unit (Shift: ten), each press one undo step.
      if (!mod && e.key.startsWith("Arrow") && nudgeRef.current) {
        const step = e.shiftKey ? 10 : 1;
        const by: [number, number] = e.key === "ArrowLeft" ? [-step, 0] : e.key === "ArrowRight" ? [step, 0] : e.key === "ArrowUp" ? [0, -step] : [0, step];
        if (nudgeRef.current(by)) take();
        return;
      }
      if (e.key === "F5") { take(); (e.shiftKey ? commands["remove-frames"] : commands["insert-frame"])(); }
      else if (e.key === "F6") { take(); (e.shiftKey ? commands["clear-keyframe"] : commands["insert-keyframe"])(); }
      else if (e.key === "F7") { take(); commands["blank-keyframe"](); }
      else if (!mod && !e.shiftKey && e.key.toLowerCase() === "a") { take(); togglePointRef.current(); }
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
  const pastePart = useCallback(async (place: "above" | "front" | "back" = "front") => {
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
      const layer: Layer = { name, fileName: "", type: "normal", parent: null, hidden: false, frames: [{ i: 0, d: Math.max(1, base.length), elements }] };
      // ⌘V above the picked layer (as the older pose view), ⌘F in front of everything, ⌘B behind everything.
      const at = place === "front" ? 0 : place === "back" ? base.layers.length : Math.max(0, Math.min(base.layers.length, layerIndex));
      const layers = insertLayer(base.layers, at, layer);
      const map = new Map(working);
      map.set(symbol, { ...base, layers, length: lengthOf(layers) });
      setHist((h) => commit(h, map));
      setLayerIndex(at); setElIndex(0); setOthers([]); setFrame(0); setRange([0, 0]);
      setNote(`${name} from ${found.clip.docName} as a new layer`);
    } catch (error) {
      setNote(error instanceof Error ? error.message : "Could not paste");
    }
  }, [base, working, symbol, doc, stack, levelToPose, loadedHere, layerIndex]);
  /** Swap: the selected part's symbol becomes the copied part (same place, same animation) on every keyframe of its layer. */
  const swapPart = useCallback(async () => {
    const found = readClip();
    if (!found || !base) { setNote("Copy the part to swap in first (⌘C), then select the part to replace"); return; }
    const target = elIndex != null ? base.layers[layerIndex] && resolveElements(base.layers[layerIndex], frame)[elIndex] : null;
    if (!target || target.k !== "instance") { setNote("Click the part to replace on the stage first"); return; }
    const clip = found.clip.elements;
    if (clip.length !== 1 || clip[0].k !== "instance") { setNote("Swap needs one copied part that is a symbol: copy a single part"); return; }
    try {
      setNote("Swapping…");
      const source = found.source ?? (found.clip.flaUrl ? await loadNativeDoc(found.clip.flaUrl) : null);
      if (!source) { setNote("The copied part's character is no longer available: copy it again"); return; }
      const [incoming] = await importElements(source, clip, loadedHere);
      if (incoming.k !== "instance") return;
      if (incoming.item === target.item) { setNote("That part is already in place"); return; }
      const scale = found.clip.rootScale / poseScale(doc, stack[0].item);
      const layers = base.layers.map((l, i) => (i === layerIndex ? swapSymbol(l, target.item, incoming, scale) : l));
      const map = new Map(working);
      map.set(symbol, { ...base, layers, length: lengthOf(layers) });
      setHist((h) => commit(h, map));
      setNote(`Swapped ${short(target.item)} for ${short(incoming.item).replace(/^Pasted from [^/]*\//, "")} on layer ${base.layers[layerIndex].name}`);
    } catch (error) {
      setNote(error instanceof Error ? error.message : "Could not swap");
    }
  }, [base, working, symbol, doc, stack, elIndex, layerIndex, frame, loadedHere]);
  copyRef.current = copyPart;
  pasteRef.current = () => void pastePart(embedded ? "above" : "front");

  // ---- new layer from the library: a symbol of this file, a picture of the Backgrounds / FX libraries, or a picture file (Animate: drag from the Library)
  const [libMenu, setLibMenu] = useState<{ x: number; y: number } | null>(null);
  const [libFilter, setLibFilter] = useState("");
  /** The new layer goes above the picked layer, holds the element for the whole timeline, and is selected. One undo step. */
  const addLayerWith = useCallback((el: FlaElement, name: string, above?: number) => {
    if (!base) return;
    const at = Math.max(0, Math.min(base.layers.length, above ?? layerIndex));
    const layer: Layer = { name, fileName: "", type: "normal", parent: null, hidden: false, frames: [{ i: 0, d: Math.max(1, base.length), elements: [el] }] };
    const layers = insertLayer(base.layers, at, layer);
    const map = new Map(working);
    map.set(symbol, { ...base, layers, length: lengthOf(layers) });
    setHist((h) => commit(h, map));
    setLayerIndex(at); setElIndex(0); setOthers([]);
    setNote(`New layer ${name}`);
  }, [base, working, symbol, layerIndex]);
  /** The middle of what the stage shows, in this level's own space: where a new layer's artwork is centred. */
  const viewCentre = (): [number, number] => [view.x + view.w / 2, view.y + view.h / 2];
  const addSymbolLayer = useCallback((item: string, above?: number) => {
    const symbolInfo = doc.symbols.get(item);
    if (!symbolInfo) return;
    renderer.overrides.clear();
    for (const [name, t] of working) renderer.overrides.set(name, t);
    const box = inkBox((ctx) => renderer.drawSymbol(ctx, item, 0));
    const middle: [number, number] = box ? [box.x + box.w / 2, box.y + box.h / 2] : [0, 0];
    const [cx, cy] = viewCentre();
    // Centred on the stage, turning about its own middle.
    const el: FlaElement = { k: "instance", item, symbolType: symbolInfo.type, m: [1, 0, 0, 1, cx - middle[0], cy - middle[1]], pivot: middle, loop: "loop", first: 0 };
    addLayerWith(el, readable(item), above);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, renderer, working, addLayerWith, view]);
  const addPictureLayer = useCallback(async (picture: { url?: string; file?: File; name: string }, above?: number) => {
    try {
      setNote("Adding the picture…");
      let url = picture.url, bytes: Uint8Array | undefined;
      if (picture.file) {
        if (!picture.file.type.startsWith("image/")) { setNote("Pick a picture file"); return; }
        if (uploadPicture) url = await uploadPicture(picture.file); else bytes = new Uint8Array(await picture.file.arrayBuffer());
      }
      const added = await addPicture({ doc, renderer }, { url, bytes, name: picture.name.replace(/\.[a-z0-9]+$/i, "") });
      // Fitted into 40% of what the stage shows (never enlarged), centred.
      const [cx, cy] = viewCentre();
      const k = Math.min(1, (view.w * 0.4) / Math.max(1, added.width), (view.h * 0.4) / Math.max(1, added.height));
      addLayerWith({ k: "bitmap", item: added.item, m: [k, 0, 0, k, cx - (added.width * k) / 2, cy - (added.height * k) / 2] }, picture.name.replace(/\.[a-z0-9]+$/i, "") || "Picture", above);
    } catch (error) {
      setNote(error instanceof Error ? error.message : "Could not add the picture");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, renderer, uploadPicture, addLayerWith, view]);
  const libraryNames = useMemo(() => [...doc.symbols.keys()].sort((a, b) => readable(a).localeCompare(readable(b))), [doc, hist]);

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
    // Each level opens fitted to the stage (stepping in or out frames the new level).
    setPan({ x: 0, y: 0 });
    onZoom?.(1);
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

  // The view: the open level fitted to the stage, then zoomed about the stage's middle and moved by `pan` (canvas pixels). Drawing, picking,
  // dragging, the handles and the colour tools all go through fit(), so they follow the zoom.
  const zoom = embedded ? zoomProp ?? 1 : 1;
  // A new zoom keeps the point it was asked about where it is (the middle for ⌘+ / ⌘−); ⌘0 brings the view back to the middle.
  if (zoomSeen !== zoom) {
    const a = zoomAnchor.current && Math.abs(zoomAnchor.current.zoom - zoom) < 1e-9 ? zoomAnchor.current.at : [0, 0];
    const r = zoom / zoomSeen;
    setZoomSeen(zoom);
    setPan({ x: a[0] - (a[0] - pan.x) * r, y: a[1] - (a[1] - pan.y) * r });
  }
  if (resetSeen !== viewReset) { setResetSeen(viewReset); setPan({ x: 0, y: 0 }); }
  /** Zoom by a factor about a canvas point (from the stage's middle); the scene editor keeps the zoom (same limits as its canvas). */
  const zoomAt = (factor: number, at: [number, number]) => {
    if (!onZoom) return;
    const next = Math.max(0.1, Math.min(200, zoom * factor));
    zoomAnchor.current = { zoom: next, at };
    onZoom(next);
  };
  const wheelRef = useRef<(e: WheelEvent) => void>(() => {});
  wheelRef.current = (e) => {
    const el = canvas.current;
    if (!embedded || !onZoom || !el) return;
    // The wheel and a trackpad pinch zoom about the pointer, as on the scene's canvas (and never zoom the page).
    e.preventDefault();
    const r = el.getBoundingClientRect();
    zoomAt(e.deltaY < 0 ? 1.15 : 1 / 1.15, [(e.clientX - r.left) * (el.width / r.width) - el.width / 2, (e.clientY - r.top) * (el.height / r.height) - el.height / 2]);
  };
  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const on = (e: WheelEvent) => wheelRef.current(e);
    el.addEventListener("wheel", on, { passive: false });
    return () => el.removeEventListener("wheel", on);
  }, []);
  const inPlace = Boolean(embedded);
  useEffect(() => {
    if (!inPlace) return;
    const down = (e: KeyboardEvent) => { if (e.code === "Space" && !isTyping(e.target)) setSpaceHeld(true); };
    const up = (e: KeyboardEvent) => { if (e.code === "Space") setSpaceHeld(false); };
    const away = () => setSpaceHeld(false);
    window.addEventListener("keydown", down, true);
    window.addEventListener("keyup", up, true);
    window.addEventListener("blur", away);
    return () => { window.removeEventListener("keydown", down, true); window.removeEventListener("keyup", up, true); window.removeEventListener("blur", away); };
  }, [inPlace]);
  const fit = useCallback((w: number, h: number) => {
    const s0 = Math.min(w / (view.w * 1.15), h / (view.h * 1.15));
    const tx0 = w / 2 - (view.x + view.w / 2) * s0, ty0 = h / 2 - (view.y + view.h / 2) * s0;
    return { s: s0 * zoom, tx: w / 2 + (tx0 - w / 2) * zoom + pan.x, ty: h / 2 + (ty0 - h / 2) * zoom + pan.y };
  }, [view, zoom, pan]);
  // What zoom 1 is on screen, for the scene editor's zoom box (CSS pixels per unit).
  useEffect(() => {
    if (!onFitScale) return;
    onFitScale(Math.min(canvasW / (view.w * 1.15), canvasH / (view.h * 1.15)) * (stageCss.w / canvasW));
  }, [onFitScale, view, canvasW, canvasH, stageCss.w]);

  // The colour tools' view of what the stage shows (the open level at this frame, with the edits): registered once, reading the latest state.
  const colourState = useRef({ symbol, frame, working, fit });
  colourState.current = { symbol, frame, working, fit };
  useEffect(() => {
    if (!onColourFrame) return;
    const prepare = () => { const st = colourState.current; renderer.overrides.clear(); for (const [n, t] of st.working) renderer.overrides.set(n, t); return st; };
    onColourFrame({
      getBoundingClientRect: () => canvas.current?.getBoundingClientRect() ?? new DOMRect(),
      contentWindow: {
        cbColorAt: (x, y, scope) => { const el = canvas.current; if (!el) return null; const st = prepare(); return colourAtPoint(renderer, st.symbol, st.frame, st.fit(el.width, el.height), x * el.width, y * el.height, scope); },
        cbColorPalette: (scope) => paletteOf(renderer, prepare().symbol, scope),
        cbColorRelatives: (hex, scope) => relativesOf(renderer, prepare().symbol, hex, scope),
      },
    });
    return () => onColourFrame(null);
  }, [onColourFrame, renderer]);

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
    // Point editing: the main selected part, when it is a drawn shape, shows its anchors (squares) and curve control points (dots).
    let pointsShown = false;
    if (pointMode && elIndex != null) {
      const shape = shown.layers[layerIndex] && resolveElements(shown.layers[layerIndex], frame)[elIndex];
      if (shape?.k === "shape") {
        const toScreen = (p: Pt): Pt => [(shape.m[0] * p[0] + shape.m[2] * p[1] + shape.m[4]) * s + tx, (shape.m[1] * p[0] + shape.m[3] * p[1] + shape.m[5]) * s + ty];
        const { anchors, controls } = shapePoints(shape);
        ctx.lineWidth = 1; ctx.strokeStyle = "rgba(229,0,125,0.55)";
        for (const c of controls) { const [cx, cy] = toScreen(c.at), [ax, ay] = toScreen(c.a), [bx, by] = toScreen(c.b); ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(cx, cy); ctx.lineTo(bx, by); ctx.stroke(); }
        ctx.fillStyle = "#e5007d";
        for (const c of controls) { const [x, y] = toScreen(c.at); ctx.beginPath(); ctx.arc(x, y, 3.5, 0, Math.PI * 2); ctx.fill(); }
        ctx.lineWidth = 1.5; ctx.strokeStyle = "#1a73e8"; ctx.fillStyle = "#fff";
        for (const a of anchors) { const [x, y] = toScreen(a); ctx.fillStyle = selPts.some((p) => samePoint(p, a)) ? "#1a73e8" : "#fff"; ctx.fillRect(x - 4, y - 4, 8, 8); ctx.strokeRect(x - 4, y - 4, 8, 8); }
        // Where the points are on the canvas, for the headless tests.
        el.dataset.points = JSON.stringify([...anchors.slice(0, 60).map((a) => ({ k: "anchor", p: toScreen(a), sel: selPts.some((q) => samePoint(q, a)) })), ...controls.slice(0, 30).map((c) => ({ k: "control", p: toScreen(c.at), a: toScreen(c.a), b: toScreen(c.b) }))]);
        el.dataset.pointCount = String(anchors.length);
        el.dataset.pointSel = String(anchors.filter((a) => selPts.some((p) => samePoint(p, a))).length);
        pointsShown = true;
      }
    }
    if (!pointsShown) { delete el.dataset.points; delete el.dataset.pointCount; delete el.dataset.pointSel; }
    if (drag?.kind === "box") {
      ctx.strokeStyle = "#1a73e8"; ctx.fillStyle = "rgba(26,115,232,0.12)"; ctx.lineWidth = 1;
      const x = Math.min(drag.from[0], drag.to[0]), y = Math.min(drag.from[1], drag.to[1]), w = Math.abs(drag.to[0] - drag.from[0]), h = Math.abs(drag.to[1] - drag.from[1]);
      ctx.fillRect(x, y, w, h); ctx.strokeRect(x, y, w, h);
    }
  }, [renderer, working, shown, symbol, frame, fit, layerIndex, elIndex, others, drag, pointMode, selPts, canvasW, canvasH, redrawKey]);
  // The selected points belong to one shape at one frame.
  useEffect(() => { setSelPts([]); }, [symbol, frame, layerIndex, elIndex, pointMode]);
  // After Undo / Redo (or any change to the shape), only the selected points the shape still has stay selected.
  useEffect(() => {
    const ps = pointShape(base);
    if (!ps) return;
    const there = shapePoints(ps.shape).anchors;
    setSelPts((now) => { const kept = now.filter((p) => there.some((a) => samePoint(a, p))); return kept.length === now.length ? now : kept; });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [working]);

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
      if (layer.type === "folder" || layer.type === "guide" || layer.type === "mask" || layer.locked) continue;
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
    if (!shown || !canvas.current || (embedded && (zoomTool || spaceHeld))) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const cx = (e.clientX - rect.left) * (e.currentTarget.width / rect.width), cy = (e.clientY - rect.top) * (e.currentTarget.height / rect.height);
    // Point editing a shape: a double-click on one of its edges adds an anchor there (the outline keeps its shape).
    const ps = pointShape(base);
    if (ps && pointAt(cx, cy)) return;  // on a point already: nothing to add
    if (ps) {
      const found = edgeAt(ps.shape, ps.local(cx, cy), 7 / ps.scale);
      if (found) {
        const made = addAnchor(ps.shape, found.edge, found.t);
        editShape(ps.layer, ps.el, () => made.shape);
        setSelPts([made.point]);
        setNote("Point added");
        return;
      }
    }
    const hit = pick(cx, cy);
    if (ps && hit && hit.layer === ps.layer && hit.el === ps.el) return;
    if (!hit) {
      if (stack.length > 1) setStack((st) => st.slice(0, -1));
      else onStepOut?.();
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
      if (layer.type === "folder" || layer.type === "guide" || layer.type === "mask" || layer.locked) return;
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
  // The colour tools work on the picked parts (as in the old pose view): their scope goes out whenever the selection changes.
  const scopeNow = base && (elIndex != null || others.length) ? renderer.partScope(symbol, base, selected(), frame) : null;
  useEffect(() => { onScope?.(scopeNow); }, [onScope, scopeNow]);
  useEffect(() => () => onScope?.(null), [onScope]);
  const same = (a: Sel, b: Sel) => a.layer === b.layer && a.el === b.el;

  /** The drawn shape being point-edited (the main selected part, when point editing is on and it is a drawn shape on an unlocked layer), in `timeline`. */
  function pointShape(timeline: Timeline | undefined) {
    if (!pointMode || elIndex == null || !timeline || !canvas.current || timeline.layers[layerIndex]?.locked) return null;
    const shape = timeline.layers[layerIndex] && resolveElements(timeline.layers[layerIndex], frame)[elIndex];
    if (!shape || shape.k !== "shape") return null;
    const { s, tx, ty } = fit(canvas.current.width, canvas.current.height);
    const m = shape.m, back = invert(m);
    return {
      shape, layer: layerIndex, el: elIndex,
      /** Shape space to canvas pixels, and back. */
      screen: (p: Pt): Pt => [(m[0] * p[0] + m[2] * p[1] + m[4]) * s + tx, (m[1] * p[0] + m[3] * p[1] + m[5]) * s + ty],
      local: (cx: number, cy: number): Pt => { const x = (cx - tx) / s, y = (cy - ty) / s; return [back[0] * x + back[2] * y + back[4], back[1] * x + back[3] * y + back[5]]; },
      /** A move of (dx, dy) in the level's units, in the shape's own space. */
      delta: (dx: number, dy: number): Pt => [back[0] * dx + back[2] * dy, back[1] * dx + back[3] * dy],
      /** Canvas pixels per shape unit (for how near the pointer must be). */
      scale: s * Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) || s,
    };
  }
  /** One point edit kept as one undo step. */
  const editShape = (layer: number, el: number, change: (shape: Extract<FlaElement, { k: "shape" }>) => Extract<FlaElement, { k: "shape" }>) => {
    if (!base) return;
    const layers = base.layers.slice();
    layers[layer] = setElement(layers[layer], frame, el, (x) => (x.k === "shape" ? change(x) : x));
    const map = new Map(working);
    map.set(symbol, { ...base, layers, length: lengthOf(layers) });
    setHist((h) => commit(h, map));
  };
  deletePointsRef.current = () => {
    const ps = pointShape(base);
    if (!ps || !selPts.length) return false;
    const gone = selPts;
    editShape(ps.layer, ps.el, (shape) => deleteAnchors(shape, gone));
    setSelPts([]);
    setNote(`Deleted ${gone.length} point${gone.length === 1 ? "" : "s"}`);
    return true;
  };

  /** The anchor or control point of the selected drawn shape under the pointer (canvas pixels), when point editing is on. */
  function pointAt(cx: number, cy: number): { ref: PointRef; layer: number; el: number } | null {
    if (!pointMode || elIndex == null || !shown || !canvas.current || shown.layers[layerIndex]?.locked) return null;
    const shape = shown.layers[layerIndex] && resolveElements(shown.layers[layerIndex], frame)[elIndex];
    if (!shape || shape.k !== "shape") return null;
    const { s, tx, ty } = fit(canvas.current.width, canvas.current.height);
    const screen = (p: Pt): Pt => [(shape.m[0] * p[0] + shape.m[2] * p[1] + shape.m[4]) * s + tx, (shape.m[1] * p[0] + shape.m[3] * p[1] + shape.m[5]) * s + ty];
    const { anchors, controls } = shapePoints(shape);
    const R = 9;
    let best: { ref: PointRef; d: number } | null = null;
    // Anchors win over a control point lying on top of them.
    for (const a of anchors) { const [x, y] = screen(a), d = Math.hypot(x - cx, y - cy); if (d <= R && (!best || d < best.d)) best = { ref: { kind: "anchor", at: a }, d }; }
    if (!best) for (const c of controls) { const [x, y] = screen(c.at), d = Math.hypot(x - cx, y - cy); if (d <= R && (!best || d < best.d)) best = { ref: c, d }; }
    return best ? { ref: best.ref, layer: layerIndex, el: elIndex } : null;
  }

  /** In place, a right-click on the stage: the part under the pointer is picked (unless it is picked already) and its menu opens. */
  const onStageContext = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!embedded) return;
    e.preventDefault();
    focusRef.current = "stage";
    const rect = e.currentTarget.getBoundingClientRect();
    const hit = pick((e.clientX - rect.left) * (e.currentTarget.width / rect.width), (e.clientY - rect.top) * (e.currentTarget.height / rect.height));
    if (hit && !selected().some((o) => same(o, hit))) { setLayerIndex(hit.layer); setElIndex(hit.el); setOthers([]); }
    setPartMenu({ x: e.clientX, y: e.clientY, hasPart: Boolean(hit) });
  };
  const onStageDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.button === 2) return; // the right button opens the part menu (onStageContext)
    // In place: Space-drag or the middle button moves the view; the Zoom tool's click zooms in there (⌥: out).
    if (embedded && (e.button === 1 || (e.button === 0 && spaceHeld))) {
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      panDrag.current = { x: e.clientX, y: e.clientY, from: pan };
      setPanning(true);
      return;
    }
    if (embedded && zoomTool && e.button === 0) {
      const [cx, cy] = toCanvas(e);
      zoomAt(e.altKey ? 1 / 1.25 : 1.25, [cx - e.currentTarget.width / 2, cy - e.currentTarget.height / 2]);
      return;
    }
    focusRef.current = "stage";
    if (colourPick) { colourPick(e.clientX, e.clientY, { altKey: e.altKey, shiftKey: e.shiftKey }); return; }
    const [cx, cy] = toCanvas(e);
    const point = pointAt(cx, cy);
    if (point && point.ref.kind === "anchor") {
      const a = point.ref.at, has = selPts.some((p) => samePoint(p, a));
      // Option-click: corner <-> curve (Animate's Convert Anchor Point tool).
      if (e.altKey) { editShape(point.layer, point.el, (shape) => convertAnchor(shape, a)); setSelPts([a]); return; }
      // Shift-click adds the anchor to the selected ones, or takes it out.
      if (e.shiftKey) { setSelPts(has ? selPts.filter((p) => !samePoint(p, a)) : [...selPts, a]); return; }
      const from = has ? selPts : [a];
      setSelPts(from);
      e.currentTarget.setPointerCapture(e.pointerId);
      setDrag({ kind: "anchors", layer: point.layer, el: point.el, from, start: [cx, cy] });
      return;
    }
    if (point) {
      e.currentTarget.setPointerCapture(e.pointerId);
      setDrag({ kind: "point", layer: point.layer, el: point.el, ref: point.ref });
      return;
    }
    const hit = pick(cx, cy);
    // Point editing a shape: a drag on empty stage or on the shape itself (its edges count, even under another part) draws a box that selects the
    // anchors inside it.
    const editing = pointShape(shown);
    const onEdge = Boolean(editing && edgeAt(editing.shape, editing.local(cx, cy), 7 / editing.scale));
    if (editing && (!hit || onEdge || (hit.layer === layerIndex && hit.el === elIndex))) {
      e.currentTarget.setPointerCapture(e.pointerId);
      setDrag({ kind: "box", from: [cx, cy], to: [cx, cy], points: { add: e.shiftKey, onShape: Boolean(hit) || onEdge } });
      return;
    }
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
    const moving = panDrag.current;
    if (moving) {
      const k = e.currentTarget.width / e.currentTarget.getBoundingClientRect().width;
      setPan({ x: moving.from.x + (e.clientX - moving.x) * k, y: moving.from.y + (e.clientY - moving.y) * k });
      return;
    }
    if (!drag || !shown || !canvas.current) return;
    const [cx, cy] = toCanvas(e);
    if (drag.kind === "box") { setDrag({ ...drag, to: [cx, cy] }); return; }
    if (drag.kind === "anchors") {
      const ps = pointShape(base);
      if (!ps) return;
      const { s } = fit(canvas.current.width, canvas.current.height);
      const d = ps.delta((cx - drag.start[0]) / s, (cy - drag.start[1]) / s);
      const to = drag.from.map((p): Pt => [p[0] + d[0], p[1] + d[1]]);
      const moved = setElement(base!.layers[drag.layer], frame, drag.el, (el) => (el.k === "shape" ? moveAnchors(el, drag.from, to) : el));
      setDrag({ ...drag, to, preview: new Map([[drag.layer, moved]]) });
      return;
    }
    if (drag.kind === "point") {
      const { s, tx, ty } = fit(canvas.current.width, canvas.current.height);
      const level = base!.layers[drag.layer] && resolveElements(base!.layers[drag.layer], frame)[drag.el];
      if (!level || level.k !== "shape") return;
      // The pointer, in the level's space and then in the shape's own space.
      const back = invert(level.m), x = (cx - tx) / s, y = (cy - ty) / s;
      const to: Pt = [back[0] * x + back[2] * y + back[4], back[1] * x + back[3] * y + back[5]];
      const moved = setElement(base!.layers[drag.layer], frame, drag.el, (el) => (el.k === "shape" ? movePoint(el, drag.ref, to) : el));
      setDrag({ ...drag, preview: new Map([[drag.layer, moved]]) });
      return;
    }
    if (drag.kind !== "part") return;
    const { s } = fit(canvas.current.width, canvas.current.height);
    const dx = (cx - drag.start[0]) / s, dy = (cy - drag.start[1]) / s;
    const preview = new Map<number, Layer>();
    for (const h of drag.held) preview.set(h.layer, setMatrix(preview.get(h.layer) ?? base!.layers[h.layer], frame, h.el, [h.m[0], h.m[1], h.m[2], h.m[3], h.m[4] + dx, h.m[5] + dy]));
    setDrag({ ...drag, preview });
  };
  const onStageUp = () => {
    if (panDrag.current) { panDrag.current = null; setPanning(false); return; }
    const drag = dragNow.current;
    if (drag?.kind === "anchors" && drag.to) setSelPts(drag.to);
    if (drag?.kind === "box" && drag.points) {
      const ps = pointShape(shown);
      const big = Math.abs(drag.to[0] - drag.from[0]) > 3 || Math.abs(drag.to[1] - drag.from[1]) > 3;
      if (ps && big) {
        const [x0, x1] = [Math.min(drag.from[0], drag.to[0]), Math.max(drag.from[0], drag.to[0])], [y0, y1] = [Math.min(drag.from[1], drag.to[1]), Math.max(drag.from[1], drag.to[1])];
        const inside = shapePoints(ps.shape).anchors.filter((a) => { const [x, y] = ps.screen(a); return x >= x0 && x <= x1 && y >= y0 && y <= y1; });
        const next = drag.points.add ? [...selPts, ...inside.filter((a) => !selPts.some((p) => samePoint(p, a)))] : inside;
        setSelPts(next);
        setNote(`${next.length} point${next.length === 1 ? "" : "s"} selected`);
      } else if (!big && !drag.points.add) {
        // A click: drops the selected points; on empty stage with none selected, drops the shape too.
        if (selPts.length || drag.points.onShape) setSelPts([]);
        else { setElIndex(null); setOthers([]); }
      }
      setDrag(null);
      return;
    }
    if ((drag?.kind === "part" || drag?.kind === "point" || drag?.kind === "anchors" || drag?.kind === "handle" || drag?.kind === "pivot") && drag.preview) {
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

  // ---- Free Transform handles (Animate's Q tool) on the selected part, or around several selected parts: scale from the sides and corners,
  // rotate just outside a corner, skew along an edge, drag the transformation point. Each drag is one undo step.
  const boxCache = useRef(new Map<string, Box | null>());
  /** The artwork's box in the part's own space at this frame (drawn alone, found from its pixels; remembered per part and frame). */
  const localBoxOf = (layer: Layer, sel: Sel): Box | null => {
    const state = layerStateAt(layer, frame);
    const el = state ? resolveElements(layer, frame)[sel.el] : undefined;
    if (!state || !el) return null;
    const key = `${symbol}|${sel.layer}|${frame - state.key.i}|${JSON.stringify({ ...el, m: 0 })}`;
    if (boxCache.current.has(key)) return boxCache.current.get(key)!;
    renderer.overrides.clear();
    for (const [name, t] of working) renderer.overrides.set(name, t);
    const alone: Layer = { ...layer, parent: null, type: "normal", off: false, frames: [{ i: state.key.i, d: state.key.d, elements: [{ ...el, m: IDENTITY } as FlaElement] }] };
    const ink = inkBox((ctx) => renderer.drawTimeline(ctx, { name: "", layers: [alone], length: Math.max(1, base?.length || 1) }, frame));
    const box = ink ? { x0: ink.x, y0: ink.y, x1: ink.x + Math.max(ink.w, 0.5), y1: ink.y + Math.max(ink.h, 0.5) } : null;
    if (boxCache.current.size > 300) boxCache.current.clear();
    boxCache.current.set(key, box);
    return box;
  };
  /** What the handles hold: one part (its own axes and transformation point) or several (a level-aligned box, turning about its middle). */
  const handleModel = (() => {
    if (!base || !shown || pointMode || drag?.kind === "box" || drag?.kind === "part" || drag?.kind === "point" || drag?.kind === "key") return null;
    const chosen = selected().filter((c) => base.layers[c.layer] && !base.layers[c.layer].locked);
    if (!chosen.length) return null;
    // The base (not a drag preview) so the box stays with the drag's start; the box is drawn through the preview below.
    const parts = chosen.flatMap((c) => { const el = resolveElements(base.layers[c.layer], frame)[c.el]; const box = el && localBoxOf(base.layers[c.layer], c); return el && box ? [{ ...c, part: el, box }] : []; });
    if (!parts.length) return null;
    if (parts.length === 1) {
      const { part: el, box } = parts[0];
      const pv = el.k === "instance" ? el.pivot : pivotOf(el);
      return { frame: el.m, box, pivot: applyM(el.m, pv), parts, single: el.k === "instance" ? parts[0] : null };
    }
    const box = boxAround(parts.map((p) => cornersOf(p.part.m, p.box)));
    return { frame: IDENTITY as Matrix, box, pivot: [(box.x0 + box.x1) / 2, (box.y0 + box.y1) / 2] as [number, number], parts, single: null };
  })();
  const nudgeRef = useRef<((by: [number, number]) => boolean) | null>(null);
  nudgeRef.current = (by) => {
    const ps = pointShape(base);
    if (ps && selPts.length) {
      const d = ps.delta(by[0], by[1]), from = selPts, to = from.map((p): Pt => [p[0] + d[0], p[1] + d[1]]);
      editShape(ps.layer, ps.el, (shape) => moveAnchors(shape, from, to));
      setSelPts(to);
      return true;
    }
    if (!base || !handleModel) return false;
    let layers = base.layers.slice();
    for (const p of handleModel.parts) layers[p.layer] = setMatrix(layers[p.layer], frame, p.el, [p.part.m[0], p.part.m[1], p.part.m[2], p.part.m[3], p.part.m[4] + by[0], p.part.m[5] + by[1]]);
    const map = new Map(working);
    map.set(symbol, { ...base, layers, length: lengthOf(layers) });
    setHist((h) => commit(h, map));
    layers = [];
    return true;
  };
  /** A pointer position as a point of the open level (the stage canvas's own pixels, then the fitted view). */
  const levelPoint = (clientX: number, clientY: number): [number, number] | null => {
    const el = canvas.current;
    if (!el) return null;
    const r = el.getBoundingClientRect(), { s, tx, ty } = fit(el.width, el.height);
    const cx = (clientX - r.left) * (el.width / r.width), cy = (clientY - r.top) * (el.height / r.height);
    return [(cx - tx) / s, (cy - ty) / s];
  };
  const beginHandle = (handle: Handle) => (e: React.PointerEvent<HTMLElement>) => {
    if (e.button !== 0 || !handleModel) return;
    e.preventDefault(); e.stopPropagation();
    const start = levelPoint(e.clientX, e.clientY);
    if (!start) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrag({ kind: "handle", handle, frame: handleModel.frame, box: handleModel.box, pivot: handleModel.pivot, start, held: handleModel.parts.map((p) => ({ layer: p.layer, el: p.el, m: [...p.part.m] as Matrix })) });
  };
  const beginPivot = (e: React.PointerEvent<HTMLElement>) => {
    const one = handleModel?.single;
    if (e.button !== 0 || !one) return;
    e.preventDefault(); e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrag({ kind: "pivot", layer: one.layer, el: one.el, m: [...one.part.m] as Matrix });
  };
  const moveHandle = (e: React.PointerEvent<HTMLElement>) => {
    if (!base || (drag?.kind !== "handle" && drag?.kind !== "pivot")) return;
    const now = levelPoint(e.clientX, e.clientY);
    if (!now) return;
    if (drag.kind === "pivot") {
      const local = applyM(invertM(drag.m), now);
      const moved = setElement(base.layers[drag.layer], frame, drag.el, (el) => (el.k === "instance" ? { ...el, pivot: local } : el));
      setDrag({ ...drag, preview: new Map([[drag.layer, moved]]) });
      return;
    }
    const G = handleTransform(drag.handle, drag.frame, drag.box, drag.start, now, drag.pivot, { shift: e.shiftKey, alt: e.altKey });
    const preview = new Map<number, Layer>();
    for (const h of drag.held) preview.set(h.layer, setMatrix(preview.get(h.layer) ?? base.layers[h.layer], frame, h.el, mulM(G, h.m)));
    setDrag({ ...drag, preview });
  };
  /** Double-click on the transformation point: back to the middle of the part. */
  const resetPivot = () => {
    const one = handleModel?.single;
    if (!one || !base) return;
    const middle: [number, number] = [(one.box.x0 + one.box.x1) / 2, (one.box.y0 + one.box.y1) / 2];
    edit((l) => setElement(l, frame, one.el, (el) => (el.k === "instance" ? { ...el, pivot: middle } : el)), one.layer);
  };

  // ---- timeline
  const frameAt = (e: React.PointerEvent<HTMLElement>, left: number) => Math.max(0, Math.floor((e.clientX - left) / CELL));
  const onRowDown = (e: React.PointerEvent<HTMLDivElement>, index: number) => {
    const left = e.currentTarget.getBoundingClientRect().left;
    const f = frameAt(e, left);
    const layer = shown?.layers[index];
    const startKey = layer?.frames.find((k) => k.i === f);
    focusRef.current = "timeline";
    setLayerIndex(index); setElIndex(null);
    if (e.shiftKey) { setRange(([a]) => [Math.min(a, f), Math.max(a, f)]); setFrame(f); return; }
    setFrame(f); setRange([f, f]);
    // Animate: dragging a keyframe moves it; ⌥-drag drops a copy (onto this layer or another one).
    if (startKey && !layer?.locked) {
      e.currentTarget.setPointerCapture(e.pointerId);
      setDrag({ kind: "key", layer: index, from: f, start: f, to: f, copy: e.altKey, toLayer: index, d: startKey.d });
    }
  };
  const onRowMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (drag?.kind !== "key") return;
    // The row under the pointer (a copy can go to another layer; a move stays on its own).
    const row = drag.copy ? document.elementsFromPoint(e.clientX, e.clientY).map((el) => (el as HTMLElement).dataset?.layer).find((v) => v != null) : undefined;
    setDrag({ ...drag, to: frameAt(e, e.currentTarget.getBoundingClientRect().left), toLayer: row != null ? Number(row) : drag.toLayer });
  };
  const onRowUp = () => {
    const d = drag;
    setDrag(null);
    if (d?.kind !== "key" || !base) return;
    if (d.copy) {
      if (d.to === d.from && d.toLayer === d.layer) return;
      const target = base.layers[d.toLayer];
      if (!target || target.type === "folder" || target.locked) { setNote("That layer can't take the keyframe (locked or a folder)"); return; }
      const clip = copyFrames(base.layers[d.layer], d.from, d.from + d.d - 1);
      edit((l) => pasteFrames(l, d.to, clip), d.toLayer);
      setLayerIndex(d.toLayer); setFrame(d.to); setRange([d.to, d.to + d.d - 1]);
      setNote(`Copied the keyframe to ${target.name} frame ${d.to + 1}`);
      return;
    }
    if (d.to !== d.from) { edit((l) => moveKeyframe(l, d.from, d.to), d.layer); setFrame(d.to); setRange([d.to, d.to]); }
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
  // ---- Properties: the selected part's place, size, rotation, skew and opacity at this frame. A change on a held span changes that keyframe; on
  // a tween a keyframe is made here first (ops.setElement). Typed numbers are one undo step each; a drag on a number is one undo step in all.
  const scrubbing = useRef(false);
  const previewRef = useRef(valuePreview);
  previewRef.current = valuePreview;
  const commitLayer = useCallback((index: number, next: Layer) => {
    if (!base) return;
    const layers = base.layers.map((l, i) => (i === index ? next : l));
    const map = new Map(working);
    map.set(symbol, { ...base, layers, length: lengthOf(layers) });
    setHist((h) => commit(h, map));
  }, [base, working, symbol]);
  useEffect(() => {
    const start = () => { scrubbing.current = true; };
    const end = () => {
      scrubbing.current = false;
      const done = previewRef.current;
      setValuePreview(null);
      // Esc during a drag puts the number back: nothing to keep then.
      if (done && base && JSON.stringify(done.next.frames) !== JSON.stringify(base.layers[done.layer]?.frames)) commitLayer(done.layer, done.next);
    };
    window.addEventListener(SCRUB_START, start);
    window.addEventListener(SCRUB_END, end);
    return () => { window.removeEventListener(SCRUB_START, start); window.removeEventListener(SCRUB_END, end); };
  }, [base, commitLayer]);
  const setPartValue = (change: Partial<PartProps> & { alpha?: number }) => {
    if (!base || elIndex == null || !base.layers[layerIndex]) return;
    if (base.layers[layerIndex].locked) { setNote("This layer is locked: unlock it to change its parts"); return; }
    const now = resolveElements(base.layers[layerIndex], frame)[elIndex];
    if (!now) return;
    const apply = (el: FlaElement): FlaElement => {
      // Opacity is shown in whole %: within that rounding it is the same.
      if (change.alpha != null) return el.k === "instance" && Math.abs(change.alpha - (el.alpha ?? 1)) > 0.005 + 1e-9 ? { ...el, alpha: change.alpha } : el;
      return { ...el, m: withProps(el.m, pivotOf(el), change) } as FlaElement;
    };
    // Back to what it is (Esc during a drag, or the same number typed): nothing to keep, and no keyframe made for it.
    const unchanged = JSON.stringify(apply(now)) === JSON.stringify(now);
    const next = unchanged ? null : setElement(base.layers[layerIndex], frame, elIndex, apply);
    if (scrubbing.current) {
      const preview = next ? { layer: layerIndex, next } : null;
      // Kept at once (not on the next render): the drag's end can come before React draws again.
      previewRef.current = preview;
      setValuePreview(preview);
    } else if (next) commitLayer(layerIndex, next);
  };
  const partProps = part ? propsOf(part.m, pivotOf(part)) : null;
  // The tween at the playhead on the picked layer: its ease can be changed (classic and shape tweens, as in Animate's Properties panel).
  const tween = base ? tweenAt(base.layers[layerIndex], frame) : null;
  // The same tween as the Animate file has it (same layer name, same start): what Reset goes back to.
  const fileLayer = base && doc.symbols.get(symbol)?.timeline.layers.find((l) => l.name === base.layers[layerIndex]?.name);
  const fileTween = tween && fileLayer ? fileLayer.frames.find((k) => k.i === tween.i && k.d === tween.d && k.tween === tween.tween) : undefined;
  const setTweenEase = (ease: Ease | undefined) => {
    if (!tween) return;
    const at = tween.i;
    setEasePreview(null);
    edit((l) => (ease ? setEase(l, at, ease) : { ...l, frames: l.frames.map((k) => (k.i === at ? { ...k, ease: undefined } : k)) }), layerIndex);
    setNote(`Ease on ${base?.layers[layerIndex]?.name} ${at + 1}–${at + tween.d}: ${easeWords(ease)}`);
  };

  const toolbarEl = (
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
        {!embedded && <select value={stack[0].item} onChange={(e) => setStack([{ item: e.target.value, m: IDENTITY }])}>{poses.map((p) => <option key={p.item} value={p.item}>{p.name}</option>)}</select>}
        {stack.length > 1 && <button style={btn} onClick={() => setStack((s) => s.slice(0, -1))}>Up</button>}
        {!embedded && <span style={{ font: "12px system-ui" }}>{stack.map((l) => short(l.item)).join(" › ")}</span>}
        <button data-testid="insert-frame" style={btn} onClick={commands["insert-frame"]}>F5 Insert Frame</button>
        <button data-testid="remove-frames" style={btn} onClick={commands["remove-frames"]}>⇧F5 Remove Frames</button>
        <button data-testid="insert-keyframe" style={btn} onClick={commands["insert-keyframe"]}>F6 Keyframe</button>
        <button data-testid="blank-keyframe" style={btn} onClick={commands["blank-keyframe"]}>F7 Blank</button>
        <button data-testid="clear-keyframe" style={btn} onClick={commands["clear-keyframe"]}>⇧F6 Clear</button>
        <button data-testid="copy-frames" style={btn} onClick={() => copyFramesCmd(false)} title="Copy the selected frames (⌥⌘C, or ⌘C after clicking in the timeline)">Copy frames</button>
        <button data-testid="cut-frames" style={btn} onClick={() => copyFramesCmd(true)} title="Cut the selected frames: copied, then left empty (⌥⌘X)">Cut frames</button>
        <button data-testid="paste-frames" style={btn} disabled={!hasFrames} onClick={() => pasteFramesCmd(false)} title="Paste the copied frames at the selected frame; they replace what is there (⌥⌘V; ⌘⇧V pastes them back where they came from)">Paste frames</button>
        <button data-testid="copy-part" style={btn} onClick={copyPart}>⌘C Copy part</button>
        <button data-testid="paste-part" style={btn} onClick={() => void pastePart()}>⌘V Paste as layer</button>
        <button data-testid="swap-part" style={btn} onClick={() => void swapPart()}>⇄ Swap with copied part</button>
        <button data-testid="add-from-library" style={btn} title="New layer above the picked one: a symbol of this file's library, a picture, or a picture file from your computer"
          onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setLibFilter(""); setLibMenu((open) => (open ? null : { x: r.left, y: r.bottom + 4 })); }}>＋ Layer from library</button>
        <button data-testid="point-mode" style={{ ...btn, background: pointMode ? "#cfe3ff" : undefined }} aria-pressed={pointMode} title="Point editing (A): select a drawn shape, then drag its anchor points and curve handles; ⇧-click or a box selects several, Delete removes them, double-click an edge adds one, ⌥-click switches corner / curve" onClick={togglePointMode}>A Edit points</button>
        <button data-testid="delete-layer" style={btn} onClick={deleteSelected}>⌫ Delete layer</button>
        <button data-testid="duplicate-layer" style={btn} onClick={duplicateSelected} title="A copy of the picked layer (or the layers of the selected parts), just above it">⧉ Duplicate layer</button>
        <button data-testid="undo" data-steps={hist.past.length} style={btn} onClick={doUndo} disabled={!sceneHistory && !hist.past.length}>Undo</button>
        <button data-testid="redo" style={btn} onClick={doRedo} disabled={!sceneHistory && !hist.future.length}>Redo</button>
        <label style={{ font: "12px system-ui" }}><input type="checkbox" checked={allLayers} onChange={(e) => setAllLayers(e.target.checked)} /> all layers</label>
        <button style={btn} onClick={() => setPlaying((p) => !p)}>{playing ? "Pause" : "Play"}</button>
        {!embedded && <button data-testid="save" style={btn} onClick={download}>Save edits</button>}
        {!embedded && <label style={{ font: "12px system-ui" }}>Open edits: <input type="file" accept=".json" onChange={(e) => e.target.files?.[0] && open(e.target.files[0])} /></label>}
        <span data-testid="note" style={{ font: "12px system-ui" }}>{note || outsideNote}</span>
      </div>
  );
  const stageEl = (
        <div style={{ position: "relative", width: stageCss.w + 2, height: stageCss.h + 2, flex: "none" }}>
        <canvas data-testid="stage" ref={canvas} width={canvasW} height={canvasH} style={{ border: "1px solid #ccc", width: stageCss.w, height: stageCss.h, touchAction: "none", cursor: panning ? "grabbing" : embedded && spaceHeld ? "grab" : embedded && zoomTool ? "zoom-in" : colourPick ? "crosshair" : drag?.kind === "part" || drag?.kind === "point" ? "grabbing" : drag?.kind === "box" ? "crosshair" : "default" }}
          onPointerDown={onStageDown} onPointerMove={onStageMove} onPointerUp={onStageUp} onDoubleClick={onStageDouble} onContextMenu={onStageContext} />
        {handleModel && canvas.current && (() => {
          // The box follows a drag in progress (the preview), the handles sit on it.
          const el = canvas.current, { s, tx, ty } = fit(el.width, el.height), k = stageCss.w / el.width;
          const G = drag?.kind === "handle" && drag.preview ? (() => { const h = drag.held[0], now = drag.preview!.get(h.layer); const m = now && resolveElements(now, frame)[h.el]?.m; return m ? mulM(m, invertM(h.m)) : null; })() : null;
          const frameNow = G ? mulM(G, handleModel.frame) : handleModel.frame;
          const toCss = (p: [number, number]): [number, number] => [1 + (p[0] * s + tx) * k, 1 + (p[1] * s + ty) * k];
          const corners = cornersOf(frameNow, handleModel.box).map(toCss);
          const at = (f: [number, number]) => toCss(applyM(frameNow, [handleModel.box.x0 + f[0] * (handleModel.box.x1 - handleModel.box.x0), handleModel.box.y0 + f[1] * (handleModel.box.y1 - handleModel.box.y0)]));
          const centre: [number, number] = [(corners[0][0] + corners[2][0]) / 2, (corners[0][1] + corners[2][1]) / 2];
          const pivotNow = drag?.kind === "pivot" && drag.preview ? (() => { const e2 = resolveElements(drag.preview!.get(drag.layer)!, frame)[drag.el]; return e2?.k === "instance" ? toCss(applyM(e2.m, e2.pivot)) : null; })() : null;
          const pivot = pivotNow ?? toCss(G ? applyM(G, handleModel.pivot) : handleModel.pivot);
          const square: React.CSSProperties = { position: "absolute", width: 9, height: 9, marginLeft: -5, marginTop: -5, background: "#fff", border: "1px solid #1a73e8", boxSizing: "border-box", touchAction: "none" };
          const cursors: Record<string, string> = { nw: "nwse-resize", se: "nwse-resize", ne: "nesw-resize", sw: "nesw-resize", n: "ns-resize", s: "ns-resize", e: "ew-resize", w: "ew-resize" };
          const edges: Array<[Handle, number, number]> = [["skew-n", 0, 1], ["skew-e", 1, 2], ["skew-s", 2, 3], ["skew-w", 3, 0]];
          return (
            <div data-testid="handles" style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
              <svg width={stageCss.w + 2} height={stageCss.h + 2} style={{ position: "absolute", inset: 0, overflow: "visible" }} aria-hidden="true">
                <polygon points={corners.map((p) => p.join(",")).join(" ")} fill="none" stroke="#1a73e8" strokeWidth={1} />
              </svg>
              {edges.map(([name, a, b]) => {
                const [x0, y0] = corners[a], [x1, y1] = corners[b], len = Math.hypot(x1 - x0, y1 - y0);
                return <i key={name} data-testid={`handle-${name}`} title="Skew: drag along this edge" onPointerDown={beginHandle(name)} onPointerMove={moveHandle} onPointerUp={onStageUp}
                  style={{ position: "absolute", left: (x0 + x1) / 2, top: (y0 + y1) / 2, width: Math.max(0, len - 24), height: 7, transform: `translate(-50%, -50%) rotate(${Math.atan2(y1 - y0, x1 - x0)}rad)`, pointerEvents: "auto", touchAction: "none", cursor: name === "skew-n" || name === "skew-s" ? "ew-resize" : "ns-resize" }} />;
              })}
              {(["nw", "ne", "se", "sw"] as const).map((name) => {
                const [x, y] = at(HANDLE_AT[name]), ox = x - centre[0], oy = y - centre[1], ol = Math.hypot(ox, oy) || 1;
                return <i key={`turn-${name}`} data-testid={`handle-rotate-${name}`} title="Rotate (Shift: 15° steps)" onPointerDown={beginHandle("rotate")} onPointerMove={moveHandle} onPointerUp={onStageUp}
                  style={{ position: "absolute", left: x + (ox / ol) * 14, top: y + (oy / ol) * 14, width: 18, height: 18, marginLeft: -9, marginTop: -9, borderRadius: 9, pointerEvents: "auto", touchAction: "none", cursor: "alias" }} />;
              })}
              {(Object.keys(HANDLE_AT) as Handle[]).map((name) => {
                const [x, y] = at(HANDLE_AT[name]);
                return <i key={name} data-testid={`handle-${name}`} title="Scale (Shift on a corner: keep the shape; Alt: from the transformation point)" onPointerDown={beginHandle(name)} onPointerMove={moveHandle} onPointerUp={onStageUp}
                  style={{ ...square, left: x, top: y, pointerEvents: "auto", cursor: cursors[name] }} />;
              })}
              {handleModel.single && <i data-testid="handle-pivot" title="Transformation point: drag to move where this part turns and scales from; double-click to put it back in the middle" onPointerDown={beginPivot} onPointerMove={moveHandle} onPointerUp={onStageUp} onDoubleClick={resetPivot}
                style={{ position: "absolute", left: pivot[0], top: pivot[1], width: 14, height: 14, marginLeft: -7, marginTop: -7, borderRadius: 7, border: "2px solid #e5007d", background: "rgba(255,255,255,.6)", boxSizing: "border-box", pointerEvents: "auto", touchAction: "none", cursor: "move" }} />}
            </div>
          );
        })()}
        </div>
  );
  const sideEl = (
        <div style={{ font: "12px system-ui", minWidth: 240 }}>
          <div><b>frame {frame + 1}</b> of {length}{range[1] > range[0] ? ` (selected ${range[0] + 1}–${range[1] + 1})` : ""} · layer {shown?.layers[layerIndex]?.name || "—"}</div>
          <div style={{ marginTop: 6 }}>Parts here:</div>
          {parts.map((p, i) => (
            <div key={i}>
              <button style={{ ...btn, background: i === elIndex ? "#ffd7ee" : undefined }} onClick={() => setElIndex(i)}>#{i + 1} {p.k === "instance" ? short(p.item) : p.k}</button>
              {p.k === "instance" && i === elIndex && doc.symbols.has(p.item) && <button style={btn} onClick={() => setStack((s) => [...s, { item: p.item, m: [...p.m] as Matrix }])}>Step into</button>}
            </div>
          ))}
          {tween && (
            <div data-testid="native-ease" style={{ marginTop: 6, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
              <span title={`${tween.tween === "shape" ? "Shape" : "Classic"} tween, frames ${tween.i + 1}–${tween.i + tween.d}`}>{tween.tween === "shape" ? "Shape" : "Classic"} tween {tween.i + 1}–{tween.i + tween.d} · Ease</span>
              <EaseControl key={`${symbol}:${layerIndex}:${tween.i}`} value={easeNumber(tween.ease) ?? 0}
                onCommit={(value) => setTweenEase(easeOfNumber(value))}
                onPreview={(value) => setEasePreview(value == null ? null : { layer: layerIndex, at: tween.i, value })} />
              {easeNumber(tween.ease) == null && !easePreview && <em data-testid="native-ease-custom">custom ease</em>}
              {fileTween && !sameEase(fileTween.ease, tween.ease) && <button data-testid="native-ease-reset" style={btn} onClick={() => setTweenEase(fileTween.ease)} title={`Back to the file's ${easeWords(fileTween.ease)}`}>Reset</button>}
            </div>
          )}
          {part && partProps && shown?.layers[layerIndex]?.locked && <div data-testid="native-locked" style={{ marginTop: 8, color: "#777" }}>🔒 Layer {shown.layers[layerIndex].name} is locked: unlock it (padlock beside its name) to change its parts.</div>}
          {part && partProps && !shown?.layers[layerIndex]?.locked && (
            <div data-testid="native-props" style={{ marginTop: 8, lineHeight: "26px" }}>
              <div><b>Properties</b> <span style={{ color: "#777" }}>({part.k === "instance" ? short(part.item) : part.k === "shape" ? "drawn shape" : "picture"}; X / Y is its transformation point)</span></div>
              <PropField id="x" label="X" value={partProps.x} decimals={1} onChange={(x) => setPartValue({ x })} />
              <PropField id="y" label="Y" value={partProps.y} decimals={1} onChange={(y) => setPartValue({ y })} />
              <br />
              <PropField id="w" label="W" unit="%" value={partProps.w} decimals={1} onChange={(w) => setPartValue({ w })} />
              <PropField id="h" label="H" unit="%" value={partProps.h} decimals={1} onChange={(h) => setPartValue({ h })} />
              <br />
              <PropField id="rotation" label="Rotate" unit="°" value={partProps.rotation} decimals={1} onChange={(rotation) => setPartValue({ rotation })} />
              <PropField id="skew" label="Skew" unit="°" value={partProps.skew} decimals={1} onChange={(skew) => setPartValue({ skew })} />
              {part.k === "instance" && <><br /><PropField id="alpha" label="Opacity" unit="%" value={(part.alpha ?? 1) * 100} decimals={0} min={0} max={100} onChange={(v) => setPartValue({ alpha: Math.round(v * 10) / 1000 })} /></>}
            </div>
          )}
          {embedded ? <details style={{ marginTop: 8, color: "#555" }}><summary style={{ cursor: "pointer" }}>How to…</summary>Click a part on the stage, drag to move (or drag a number in its Properties left / right, or click it and type); its box scales from the squares (Shift on a corner keeps the shape, Alt scales from the transformation point), rotates just outside a corner (Shift: 15° steps), skews along an edge; drag the pink transformation point to move it (double-click: back to the middle); arrow keys nudge 1 (Shift 10); A (or Edit points, or Direct select on the tool rail) shows the anchor points of a drawn shape (double-click a symbol to step into it first): drag one, or a curve handle, to reshape it; ⇧-click or drag a box to select several (they move together, arrow keys nudge them, Delete removes them); double-click an edge to add a point; ⌥-click a point to switch it between corner and curve; Delete removes its layer, the dot beside a layer hides it, the padlock locks it, double-click a layer's name to rename it; ⇧-click adds or removes a part, drag a box on empty stage to select every part it touches (they move together); double-click a symbol to step into it (double-click empty stage steps out). drag a keyframe in the timeline to move it, ⌥-drag to drop a copy (onto any layer); Copy / Cut / Paste frames (⌥⌘C / ⌥⌘X / ⌥⌘V, ⌘⇧V back in place) work on the selected frames; click inside a tween to change its Ease (drag the number, or double-click to type). ⇧-click extends the frame selection. , and . step frames.</details> : <div style={{ marginTop: 6, color: "#666" }}>Click a part on the stage, drag to move (or drag a number in its Properties left / right, or click it and type); its box scales from the squares (Shift on a corner keeps the shape, Alt scales from the transformation point), rotates just outside a corner (Shift: 15° steps), skews along an edge; drag the pink transformation point to move it (double-click: back to the middle); arrow keys nudge 1 (Shift 10); A (or Edit points, or Direct select on the tool rail) shows the anchor points of a drawn shape (double-click a symbol to step into it first): drag one, or a curve handle, to reshape it; ⇧-click or drag a box to select several (they move together, arrow keys nudge them, Delete removes them); double-click an edge to add a point; ⌥-click a point to switch it between corner and curve; Delete removes its layer, the dot beside a layer hides it, the padlock locks it, double-click a layer's name to rename it; ⇧-click adds or removes a part, drag a box on empty stage to select every part it touches (they move together); double-click a symbol to step into it (double-click empty stage steps out). drag a keyframe in the timeline to move it, ⌥-drag to drop a copy (onto any layer); Copy / Cut / Paste frames (⌥⌘C / ⌥⌘X / ⌥⌘V, ⌘⇧V back in place) work on the selected frames; click inside a tween to change its Ease (drag the number, or double-click to type). ⇧-click extends the frame selection. , and . step frames.</div>}
        </div>
        );
  const libMenuEl = (
      libMenu && (
        <>
          <div className="cb-symbol-lib-shade" onPointerDown={() => setLibMenu(null)} />
          <div className="cb-frame-menu cb-symbol-lib" role="menu" data-testid="native-library" style={{ left: libMenu.x, top: libMenu.y }}>
            <input autoFocus value={libFilter} onChange={(e) => setLibFilter(e.target.value)} placeholder="Find a symbol or picture" aria-label="Find a symbol or picture"
              onKeyDown={(e) => { if (e.key === "Escape") setLibMenu(null); e.stopPropagation(); }} />
            <div className="cb-symbol-lib-list">
              {libraryNames.filter((name) => readable(name).toLowerCase().includes(libFilter.toLowerCase()) || name.toLowerCase().includes(libFilter.toLowerCase())).slice(0, 300).map((name) => (
                <button key={name} type="button" role="menuitem" data-symbol={name} title={name} onClick={() => { setLibMenu(null); addSymbolLayer(name); }}>{readable(name)}</button>
              ))}
              {!libraryNames.length && <span className="cb-symbol-lib-empty">No symbols in this file&apos;s library.</span>}
            </div>
            <label className="cb-symbol-lib-upload">
              Upload a picture…
              <input data-testid="native-upload-picture" type="file" accept="image/*" hidden onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ""; if (file) { setLibMenu(null); void addPictureLayer({ file, name: file.name }); } }} />
            </label>
            <PoseLibraryPictures filter={libFilter} onPick={(item: MediaLibraryItem) => { setLibMenu(null); void addPictureLayer({ url: item.url, name: item.name }); }} />
          </div>
        </>
      )
  );
  const timelineEl = (
      shown && (
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
                <button data-testid={`eye-${index}`} title={layer.off ? "Show layer" : "Hide layer"} aria-pressed={!layer.off} style={{ ...btn, padding: "0 4px", marginRight: 2, opacity: layer.off ? 0.4 : 1 }} onClick={() => toggleEye(index)}>{layer.off ? "○" : "●"}</button>
                <button data-testid={`lock-${index}`} title={layer.locked ? "Unlock layer" : "Lock layer (its parts cannot be picked or changed on the stage)"} aria-pressed={!!layer.locked} style={{ ...btn, padding: "0 3px", marginRight: 4, opacity: layer.locked ? 1 : 0.35 }} onClick={() => toggleLock(index)}>{layer.locked ? "🔒" : "🔓"}</button>
                {renaming === index
                  ? <input data-testid={`rename-${index}`} autoFocus defaultValue={layer.name} aria-label="Layer name" style={{ width: 90, font: "12px system-ui" }} onFocus={(e) => e.target.select()}
                      onBlur={(e) => commitRename(index, e.target.value)}
                      onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter") e.currentTarget.blur(); else if (e.key === "Escape") setRenaming(null); }} />
                  : <span data-testid={`layer-name-${index}`} title="Double-click to rename" onDoubleClick={() => setRenaming(index)} style={{ opacity: layer.off ? 0.5 : 1 }}>{layer.type !== "normal" ? `[${layer.type}] ` : ""}{layer.name}</span>}
              </div>
              <div style={{ position: "relative", width: length * CELL + 40 * CELL, touchAction: "none" }} data-layer={index} onPointerDown={(e) => onRowDown(e, index)} onPointerMove={onRowMove} onPointerUp={onRowUp}>
                {layer.frames.map((k) => {
                  const moving = drag?.kind === "key" && !drag.copy && drag.layer === index && drag.from === k.i;
                  const left = (moving ? drag.to : k.i) * CELL;
                  return (
                    <div key={k.i} data-key={`${index}:${k.i}`} title={`Frame ${k.i + 1}${k.d > 1 ? `–${k.i + k.d}` : ""}${k.tween ? ` · ${k.tween === "shape" ? "shape" : "classic"} tween, ${easeWords(k.ease)}` : ""}`} style={{ position: "absolute", left, top: 2, height: ROW - 5, width: k.d * CELL - 1, boxSizing: "border-box", border: "1px solid #777", opacity: moving ? 0.6 : 1,
                      background: k.tween === "shape" ? "#bfe8bf" : k.tween ? "#d9c8f0" : k.elements.length ? "#e8e8e8" : "#fff" }}>
                      <div style={{ width: 6, height: 6, borderRadius: 3, margin: "2px 0 0 2px", background: k.elements.length ? "#222" : "#fff", border: "1px solid #222" }} />
                    </div>
                  );
                })}
                {drag?.kind === "key" && drag.copy && drag.toLayer === index && (drag.to !== drag.from || drag.toLayer !== drag.layer) && (
                  <div data-testid="key-copy-ghost" style={{ position: "absolute", left: drag.to * CELL, top: 2, height: ROW - 5, width: drag.d * CELL - 1, boxSizing: "border-box", border: "1px dashed #1a73e8", background: "rgba(26,115,232,.15)", pointerEvents: "none" }} />
                )}
                <div style={{ position: "absolute", left: frame * CELL, top: 0, width: CELL, height: ROW, border: "1px solid #e5007d", boxSizing: "border-box", pointerEvents: "none" }} />
              </div>
            </div>
          ))}
        </div>
      )
  );
  // ---- In place: the scene editor's own timeline panel (components/SymbolTimeline.tsx), the one timeline UI of every pose. It shows this
  // native timeline as it is (nothing laid over it) and its commands run on the native timeline here.
  const original = doc.symbols.get(symbol)?.timeline;
  const panelSymbol = useMemo(() => (shown ? flaSymbolOf(shown, { name: symbol, js: renderer.classOfItem(symbol), fps, original, classOf: (item) => renderer.classOfItem(item) }) : null),
    [shown, symbol, renderer, fps, original]);
  const say = useCallback((text: string) => { setNote(text); onNotice?.(text); }, [onNotice]);
  const commitLayers = (layers: Layer[]) => {
    if (!base) return;
    const map = new Map(working);
    map.set(symbol, { ...base, layers, length: lengthOf(layers) });
    setHist((h) => commit(h, map));
  };
  /** The name the player knows a part by (its own, else the one it gives an unnamed one): the panel lights the rows of the parts picked on the stage. */
  const partName = (sel: Sel): string => {
    const layer = shown?.layers[sel.layer], state = layer && layerStateAt(layer, frame);
    const el = state?.key.elements[sel.el];
    if (!layer || !state || !el || (el.k !== "instance" && el.k !== "bitmap")) return "";
    return el.name || autoNameAt(original ? autoNames(original) : undefined, layerKey(shown!.layers, sel.layer), state.key.i, sel.el);
  };
  const pickedNames = selected().map(partName).filter(Boolean);
  /** The part of a layer the value boxes and edits go to: the one picked on the stage when it is on that layer, else the layer's first. */
  const partOn = (layer: number, at: number): number => (elIndex != null && layerIndex === layer ? elIndex : (() => {
    const key = base?.layers[layer] && layerStateAt(base.layers[layer], at)?.key;
    const i = key ? key.elements.findIndex((el) => el.k === "instance" || el.k === "bitmap") : -1;
    return i >= 0 ? i : 0;
  })());
  const keyValues = (() => {
    if (!keyPick || !base?.layers[keyPick.layer]) return null;
    const el = layerStateAt(base.layers[keyPick.layer], keyPick.frame)?.key.elements[partOn(keyPick.layer, keyPick.frame)];
    return { layer: keyPick.layer, frame: keyPick.frame, values: el ? (createjsValuesOf(el) as unknown as Record<string, number>) : null };
  })();
  /** The panel's keyframes of a layer after a drag or an add (as "anchors": where each keyframe was → where it is now) applied natively. */
  const keysApplied = (index: number, anchors: Anchor[]): Layer | null => {
    const layer = base?.layers[index], fla = panelSymbol?.layers[index];
    if (!layer || !fla) return null;
    const now = fileAnchors(fla);
    let out = layer;
    if (anchors.length === now.length + 1) {
      const added = anchors.find((a) => !now.some((b) => b[0] === a[0]));
      if (added) out = insertKeyframe(out, Math.round(added[1]));
    } else if (anchors.length === now.length) {
      anchors.forEach((a, k) => { if (k < anchors.length - 1 && a[1] !== now[k][1]) out = moveKeyframe(out, now[k][0], Math.round(a[1])); });
    }
    return out === layer ? null : out;
  };
  /** One frame operation of the panel on the frames selected in it (layers, from … to). One undo step. */
  const runPanelOp = (op: FrameOp, sel: { layers: number[]; from: number; to: number }, by = 0) => {
    if (!base) return;
    const clip = frameClipboard;
    if (op === "paste-place") {
      if (!clip || clip.symbol !== symbol) { say("Nothing to paste in place: copy keyframes first (⌘C)."); return; }
      sel = { layers: [clip.layer], from: clip.from, to: clip.from };
      op = "paste";
    }
    const ids = sel.layers.filter((i) => base.layers[i] && base.layers[i].type !== "folder" && !base.layers[i].locked);
    if (!ids.length) { say("These layers can't be changed here (locked layers and folders)."); return; }
    const count = sel.to - sel.from + 1;
    const per = (change: (l: Layer) => Layer): boolean => {
      let changed = false;
      const layers = base.layers.map((l, i) => { if (!ids.includes(i)) return l; const next = change(l); if (next !== l) changed = true; return next; });
      if (changed) commitLayers(layers);
      return changed;
    };
    const startsTouched = (l: Layer) => [...new Set(Array.from({ length: count }, (_, n) => layerStateAt(l, sel.from + n)?.key.i).filter((i): i is number => i != null))];
    switch (op) {
      case "insert-frame": per((l) => insertFrames(l, sel.from, count)); return;
      case "remove-frames": if (!per((l) => removeFrames(l, sel.from, sel.to))) say("The first frame of a layer can't be removed."); else setFrame((f) => Math.min(f, sel.from)); return;
      case "insert-keyframe": per((l) => { let out = l; for (let f = sel.from; f <= sel.to; f += 1) if (!out.frames.some((k) => k.i === f)) out = insertKeyframe(out, f); return out; }); return;
      case "blank-keyframe": if (!per((l) => insertBlankKeyframe(l, sel.from))) say("There is no frame to put a blank keyframe on there."); return;
      case "clear-keyframe": per((l) => { let out = l; for (const k of l.frames) if (k.i > 0 && k.i >= sel.from && k.i <= sel.to) out = clearKeyframe(out, k.i); return out; }); return;
      case "delete-drawing": if (!per((l) => blankKeyframes(l, sel.from, sel.to))) say("Select a keyframe to delete its drawing (it becomes a blank keyframe)."); return;
      case "create-tween": case "create-shape-tween": case "remove-tween": {
        const done = per((l) => {
          let out = l;
          for (const i of startsTouched(l)) {
            const k = out.frames.find((x) => x.i === i), next = out.frames.find((x) => x.i === (k ? k.i + k.d : -1));
            if (!k) continue;
            if (op === "create-tween" && !k.tween && next && k.elements.some((el) => el.k === "instance")) out = setTween(out, i, "motion");
            if (op === "remove-tween" && k.tween) out = setTween(out, i, null);
          }
          return out;
        });
        if (!done) say(op === "create-shape-tween" ? "Add a keyframe where the tween should end first (F6); a shape tween needs drawn shapes on both keyframes." : op === "create-tween" ? "Add a keyframe where the tween should end first (F6), then create the tween: a classic tween needs a symbol on the keyframe." : "No tween in these frames.");
        return;
      }
      case "copy": case "cut": {
        frameClipboard = { clips: ids.map((i) => ({ offset: i - ids[0], clip: copyFrames(base.layers[i], sel.from, sel.to) })), from: sel.from, layer: ids[0], symbol };
        setHasFrames(true);
        if (op === "cut") per((l) => cutFrames(l, sel.from, sel.to).layer);
        return;
      }
      case "paste": {
        if (!clip) { say("Nothing to paste: copy frames first."); return; }
        const layers = base.layers.slice();
        let skipped = 0;
        for (const { offset, clip: c } of clip.clips) {
          const i = sel.layers[0] + offset, layer = layers[i];
          if (!layer || layer.type === "folder" || layer.locked) { skipped += 1; continue; }
          layers[i] = pasteFrames(layer, sel.from, c);
        }
        commitLayers(layers);
        if (skipped) say(`${skipped} layer${skipped > 1 ? "s" : ""} of the copy had nowhere to go (locked, a folder, or past the last layer).`);
        return;
      }
      case "move": if (!per((l) => moveFrames(l, sel.from, sel.to, by))) say("No keyframes moved: select frames that hold keyframes (the first keyframe of a layer stays)."); return;
      case "reverse": if (!per((l) => reverseFrames(l, sel.from, sel.to))) say("Select frames that hold at least two keyframes, then choose Reverse Frames."); return;
    }
  };
  const fileEaseAt = (layer: number, at: number) => {
    const fileLayer = original?.layers.find((_, i) => base && layerKey(original.layers, i) === layerKey(base.layers, layer));
    return fileLayer?.frames.find((k) => k.i === at)?.ease;
  };
  const setPanelEase = (layer: number, at: number, value: number | null) => edit((l) => setEase(l, at, value == null ? (fileEaseAt(layer, at) ?? {}) : easeOfNumber(value)), layer);
  const panelEl = embedded && panelSymbol ? (
    <SymbolTimeline
      key={`${stack.length}:${symbol}`}
      crumbs={[...(crumbs || []), ...stack.map((l, i) => (i === 0 ? (poses.find((p) => p.item === l.item)?.name || readable(l.item)) : readable(l.item)))]}
      symbol={panelSymbol}
      frame={frame}
      playing={playing}
      // Like a character's older edits: no arrangement edit while the layers are as the file has them (the panel then offers no "reset layers").
      layerEdit={base && !asTheFileHasThem(base, original) ? arrangementOf(base) : undefined}
      onLayerEdit={(change) => {
        if (!base || !panelSymbol) return;
        const next = change(arrangementOf(base));
        const layers = next ? arrangeNative(base, panelSymbol.layers, next) : fileArrangement(base, original ?? base);
        commitLayers(layers);
        if (layers.length !== base.layers.length) { setElIndex(null); setOthers([]); setLayerIndex(0); }
      }}
      onDuplicateLayers={(ids) => {
        if (!base) return;
        const made = duplicateLayers(base.layers, ids);
        if (!made.copies.length) { say("Folders and mask layers are not duplicated: pick a plain layer"); return; }
        commitLayers(made.layers);
        setLayerIndex(made.copies[0]); setElIndex(null); setOthers([]);
      }}
      onListLibrary={async () => libraryNames}
      onAddSymbol={(name, above) => addSymbolLayer(name, above ?? 0)}
      onAddPicture={(item, above) => void addPictureLayer({ url: item.url, name: item.name }, above ?? 0)}
      onUploadPicture={(file, above) => void addPictureLayer({ file, name: file.name }, above ?? 0)}
      onNotice={say}
      editable={base ? Object.fromEntries(base.layers.map((l, i) => [i, l.type !== "folder"])) : undefined}
      keyValues={keyValues}
      pickedProp={pickedNames[0] ?? null}
      pickedProps={pickedNames}
      onPickLayers={(ids) => {
        const picks = ids.flatMap((i) => { const key = shown?.layers[i] && layerStateAt(shown.layers[i], frame)?.key; return key?.elements.length ? [{ layer: i, el: 0 }] : []; });
        if (!picks.length) return;
        setLayerIndex(picks[0].layer); setElIndex(picks[0].el); setOthers(picks.slice(1));
            if (op === "create-shape-tween" && (!k.tween || k.tween === "motion") && next && k.elements.some((el) => el.k === "shape") && next.elements.some((el) => el.k === "shape")) out = setTween(out, i, "shape");
      }}
      onFrameOp={runPanelOp}
      canPaste={hasFrames}
      onSelectLayer={(index) => {
        focusRef.current = "timeline";
        if (index == null) { setElIndex(null); setOthers([]); return; }
        const key = shown?.layers[index] && layerStateAt(shown.layers[index], frame)?.key;
        setLayerIndex(index); setElIndex(key?.elements.length ? 0 : null); setOthers([]);
      }}
      onSelectKey={(layer, at) => setKeyPick(at == null ? null : { layer, frame: at })}
      onSetValue={(layer, at, patch) => {
        const el = partOn(layer, at);
        if (!patch) {
          // Back to the file's values: the same part of the file's own keyframe there.
          const fileLayer = original?.layers.find((_, i) => base && layerKey(original.layers, i) === layerKey(base.layers, layer));
          const fileEl = fileLayer && layerStateAt(fileLayer, at)?.key.elements[el];
          if (fileEl) edit((l) => setElement(l, at, el, (x) => ({ ...x, m: fileEl.m, ...(fileEl.k === "instance" && x.k === "instance" ? { pivot: fileEl.pivot, alpha: fileEl.alpha } : {}) }) as FlaElement), layer);
          return;
        }
        edit((l) => setElement(l, at, el, (x) => withCreatejsValues(x, patch)), layer);
      }}
      onSeek={(f) => setFrame(Math.max(0, Math.min(length - 1, f)))}
      onPlay={() => setPlaying((p) => !p)}
      onCrumb={(index) => {
        const outer = (crumbs || []).length;
        if (index < outer) { onStepOut?.(); return; }
        setStack((st) => st.slice(0, index - outer + 1));
      }}
      onStepInto={(layerIndex2, at, js) => {
        const key = shown?.layers[layerIndex2] && layerStateAt(shown.layers[layerIndex2], at)?.key;
        const part = key?.elements.find((el) => el.k === "instance" && renderer.classOfItem(el.item) === js);
        if (!part || part.k !== "instance" || !doc.symbols.has(part.item)) { say("Nothing to step into here: this is plain artwork"); return; }
        arriving.current = null;
        setStack((st) => [...st, { item: part.item, m: [...part.m] as Matrix }]);
      }}
      onSetEase={(layer, key: FlaFrame, value) => setPanelEase(layer, key.i, value)}
      onPreviewEase={(layer, key: FlaFrame, value) => setEasePreview(value == null ? null : { layer, at: key.i, value })}
      onSetTweenEase={(layer, at, value) => setPanelEase(layer, at, value)}
      onPreviewTweenEase={(layer, at, value) => setEasePreview(value == null ? null : { layer, at, value })}
      onSetKeys={(index, anchors) => { setPanelPreview(null); const next = anchors && keysApplied(index, anchors); if (next) edit(() => next, index); }}
      onPreviewKeys={(index, anchors) => { const next = anchors && keysApplied(index, anchors); setPanelPreview(next ? new Map([[index, next]]) : null); }}
      onCopyKey={(fromLayer, fromAt, toLayer, toAt) => {
        if (!base) return;
        const target = base.layers[toLayer], key = base.layers[fromLayer]?.frames.find((k) => k.i === fromAt);
        if (!key) return;
        if (!target || target.type === "folder" || target.locked) { say("That layer can't take the keyframe (locked or a folder)"); return; }
        const copied = copyFrames(base.layers[fromLayer], key.i, key.i + key.d - 1);
        edit((l) => pasteFrames(l, toAt, copied), toLayer);
      }}
    />
  ) : null;
  // ---- In place: the part menu's actions (and their shortcuts), on the parts picked on the stage, as the older pose view had them.
  const pickedLayers = (): number[] => [...new Set(selected().map((o) => o.layer))];
  /** A change of the layer arrangement made by the older pose view's own helpers (arrange, group), applied natively; the picked parts stay picked. */
  const arrangeWith = (make: (fla: NonNullable<typeof panelSymbol>["layers"], current: SymbolLayerEdit) => SymbolLayerEdit | null, nothing: string) => {
    if (!base || !panelSymbol) return;
    const next = make(panelSymbol.layers, arrangementOf(base));
    if (!next) { say(nothing); return; }
    const moved = arrangedPositions(panelSymbol.layers, next);
    commitLayers(arrangeNative(base, panelSymbol.layers, next));
    const sel = selected().flatMap((o) => (moved.has(o.layer) ? [{ layer: moved.get(o.layer)!, el: o.el }] : []));
    if (sel.length) { setLayerIndex(sel[0].layer); setElIndex(sel[0].el); setOthers(sel.slice(1)); }
  };
  /** Flip the picked parts about their transformation point (several: about the middle of their box), on this frame. */
  const flipSelected = (axis: "h" | "v") => {
    if (!base || !handleModel) { say("Pick a part first to flip it."); return; }
    const [cx, cy] = handleModel.pivot, sx = axis === "h" ? -1 : 1, sy = axis === "v" ? -1 : 1;
    const flip: Matrix = [sx, 0, 0, sy, cx - sx * cx, cy - sy * cy];
    let layers = base.layers.slice();
    for (const p of handleModel.parts) layers[p.layer] = setMatrix(layers[p.layer], frame, p.el, mulM(flip, p.part.m));
    commitLayers(layers);
    layers = [];
  };
      shapeTweens
  const partAction = (action: PartAction) => {
    setPartMenu(null);
    const ids = pickedLayers();
    const needPart = (what: string) => { if (ids.length) return true; say(`Pick a part first to ${what}.`); return false; };
    switch (action) {
      case "cut": if (needPart("cut it")) { copyPart(); deleteSelected(); } return;
      case "copy": copyPart(); return;
      case "paste": void pastePart("above"); return;
      case "pasteFront": void pastePart("front"); return;
      case "pasteBack": void pastePart("back"); return;
      case "swap": void swapPart(); return;
      case "toFront": case "forward": case "backward": case "toBack":
        if (needPart("arrange it")) arrangeWith((fla, current) => arrangeSymbolLayers(fla, current, ids, action === "toFront" ? "front" : action === "toBack" ? "back" : action), "It can't go further that way.");
        return;
      case "duplicate": if (needPart("duplicate its layer")) duplicateSelected(); return;
      case "flipH": case "flipV": flipSelected(action === "flipH" ? "h" : "v"); return;
      case "pivot": if (handleModel?.single) resetPivot(); else say("Pick one part (a symbol) to reset its registration point."); return;
      case "group": if (needPart("group it")) arrangeWith((fla, current) => groupLayers(fla, current, ids), "These layers can't go in a folder together."); return;
      case "ungroup": {
        if (!needPart("ungroup it") || !base) return;
        const folder = base.layers[ids[0]]?.parent;
        if (folder == null || base.layers[folder]?.type !== "folder") { say("This layer is not in a folder."); return; }
        arrangeWith((fla, current) => ungroupLayer(fla, current, folder), "Nothing to ungroup.");
        return;
      }
      case "hide": case "lock":
        if (!needPart(action === "hide" ? "hide its layer" : "lock its layer") || !base) return;
        commitLayers(base.layers.map((l, i) => (ids.includes(i) ? (action === "hide" ? setLayerOff(l, true) : setLayerLocked(l, true)) : l)));
        setElIndex(null); setOthers([]);
        return;
      case "delete": if (needPart("delete its layer")) deleteSelected(); return;
      case "back": if (stack.length > 1) setStack((st) => st.slice(0, -1)); else onStepOut?.(); return;
    }
  };
  const partActionRef = useRef(partAction);
  partActionRef.current = partAction;
  useEscClose(Boolean(partMenu), () => setPartMenu(null));
  useEffect(() => {
    if (!partMenu) return;
    const close = (e: PointerEvent) => { if (!(e.target as HTMLElement | null)?.closest?.(".cb-symbol-menu")) setPartMenu(null); };
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [partMenu]);

  // Messages from outside (older edits converted…) go to the scene's notice once.
  const toldOutside = useRef("");
  useEffect(() => { if (embedded && outsideNote && toldOutside.current !== outsideNote) { toldOutside.current = outsideNote; onNotice?.(outsideNote); } }, [embedded, outsideNote, onNotice]);

  if (embedded) {
    // In place: the stage over the scene's canvas area; the scene's own timeline panel in its timeline row.
    return (
      <>
        {createPortal(
          <div data-testid="native-editor" className="cb-native-inplace-stage" style={{ position: "absolute", inset: 0, background: "#e7e7e7", overflow: "hidden" }}
            // For the headless tests: the last message, the picked part (layer, part, its X / Y) and point editing, which no panel shows here.
            data-note={note || outsideNote || ""} data-point-mode={pointMode ? "on" : "off"}
            // ...and the view: scale and offset of the open level on the canvas, and canvas pixels per CSS pixel.
            data-view={(() => { const v = fit(canvasW, canvasH); return JSON.stringify({ s: v.s, tx: v.tx, ty: v.ty, k: canvasW / stageCss.w, zoom }); })()}
            data-picked={(() => { const el = elIndex != null && shown?.layers[layerIndex] ? resolveElements(shown.layers[layerIndex], frame)[elIndex] : undefined; return el ? JSON.stringify({ layer: layerIndex, el: elIndex, x: Math.round(el.m[4] * 100) / 100, y: Math.round(el.m[5] * 100) / 100, count: selected().length }) : ""; })()}>
            {stageEl}
          </div>, embedded.stage)}
        {panelEl && createPortal(panelEl, embedded.timeline)}
        {partMenu && createPortal(<PartMenu x={partMenu.x} y={partMenu.y} hasPart={partMenu.hasPart} canSwap onAction={(action) => partActionRef.current(action)} />, document.body)}
      </>
    );
  }
  return (
    <div data-testid="native-editor" style={{ display: "grid", gap: 8 }}>
      {toolbarEl}
      <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
        {stageEl}
        {sideEl}
      </div>
      {libMenuEl}
      {timelineEl}
    </div>
  );
}
