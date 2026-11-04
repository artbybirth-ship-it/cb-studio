"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { EaseControl } from "@/components/Timeline";
import type { SymbolEaseEdit, SymbolKeyEdit, SymbolLayerEdit, SymbolValueEdit, SymbolValueKey } from "@/types";
import { scrubProps } from "@/lib/scrub";
import { addLayer, descendants, EXTRA_BASE, layerRows, lockedTogether, moveLayers, toggled } from "@/lib/symbolLayers";
import { addAnchor, fileAnchors, isUnchanged, keyframeAt, moveAnchor, removeAnchor, shownFrames, type Anchor } from "@/lib/symbolKeys";

/**
 * A character's own Animate timeline (step inside a character; only classic tween eases can be
 * edited: click a purple span, saved on the placed character). Shown in place of the
 * scene's timeline: the symbol's layers as Animate lists them (folders, mask and guide layers,
 * nesting), its keyframes and blank keyframes, classic (purple) and shape (green) tweens, labels
 * and sounds, numbered in the symbol's own frames and fps. The playhead and Play run just this
 * symbol; the eye hides a layer on the stage (not saved); double-clicking a keyframe that holds a
 * symbol steps into it. Data: cb-fla-timeline/<document>/<Symbol>.json (lib/server/flaTimeline.ts).
 */
export type FlaFrame = {
  i: number; d: number; tween?: "classic" | "shape" | "motion"; ease?: number | string; label?: string; sound?: string;
  symbols?: Array<{ name: string; js?: string }>; shapes?: number; texts?: number; bitmaps?: number; blank?: boolean;
};
export type FlaLayer = {
  name: string; type: "normal" | "folder" | "mask" | "guide" | string; parent?: number; color?: string;
  hidden?: boolean; locked?: boolean; outline?: boolean; frames: FlaFrame[]; props?: string[]; classes?: Record<string, string>;
};
export type FlaSymbol = { version: number; js: string; fps: number; name: string; frames: number; layers: FlaLayer[] };

export type FrameOp = "insert-frame" | "remove-frames" | "insert-keyframe" | "clear-keyframe" | "copy" | "cut" | "paste";
const CELL = 11;
const ROW = 26;
const LAYER_PANEL = 230;
const short = (name: string) => name.split("/").pop() || name;

/** The file's ease as the Ease box shows it: the .fla stores −100 for a tween that ends slowly (ease out 100). */
const easeValue = (ease: FlaFrame["ease"]) => (typeof ease === "number" ? -ease : 0);
const valueText = (value: number) => (value < 0 ? `ease in ${-value}` : `ease out ${value}`);
const easeText = (ease: FlaFrame["ease"]) =>
  ease == null ? "" : ease === "custom" ? "custom ease" : typeof ease === "number" ? valueText(easeValue(ease)) : `ease ${ease}`;
const holds = (frame: FlaFrame) => [
  ...(frame.symbols || []).map((symbol) => short(symbol.name)),
  ...(frame.shapes ? [`${frame.shapes} shape${frame.shapes > 1 ? "s" : ""}`] : []),
  ...(frame.texts ? [`${frame.texts} text`] : []),
  ...(frame.bitmaps ? [`${frame.bitmaps} bitmap${frame.bitmaps > 1 ? "s" : ""}`] : []),
  ...(frame.sound ? [`sound ${frame.sound}`] : []),
].join(", ");

const LayerIcon = ({ type, open }: { type: string; open: boolean }) => (
  <svg viewBox="0 0 16 16" aria-hidden="true"><g fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round">
    {type === "folder" ? <path d={open ? "M1.5 4.5h4.2l1.3 1.5h7.5v7.5H1.5zM1.5 7.5h13" : "M1.5 4.5h4.2l1.3 1.5h7.5v7.5H1.5z"} />
      : type === "mask" ? <><rect x="2" y="3" width="12" height="10" rx="1.5" /><circle cx="8" cy="8" r="2.6" fill="currentColor" /></>
      : type === "guide" ? <path d="M3 13c2-6 4 1 6-5s3-3 4-5" strokeDasharray="2 1.6" />
      : <path d="M2.5 5.5 8 3l5.5 2.5L8 8zM2.5 8.5 8 11l5.5-2.5M2.5 11.5 8 14l5.5-2.5" />}
  </g></svg>
);
const EyeIcon = ({ shown }: { shown: boolean }) => (
  <svg viewBox="0 0 16 16" aria-hidden="true"><g fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round">
    <path d="M1.8 8s2.3-4 6.2-4 6.2 4 6.2 4-2.3 4-6.2 4-6.2-4-6.2-4z" /><circle cx="8" cy="8" r="1.8" />{!shown && <path d="M3 13 13 3" />}
  </g></svg>
);
const LockIcon = ({ on }: { on: boolean }) => (
  <svg viewBox="0 0 16 16" aria-hidden="true"><g fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3.5" y="7" width="9" height="6.5" rx="1.2" fill={on ? "currentColor" : "none"} /><path d={on ? "M5.5 7V5.2a2.5 2.5 0 0 1 5 0V7" : "M5.5 7V5.2a2.5 2.5 0 0 1 4.8-1"} />
  </g></svg>
);
const TransportIcon = ({ kind }: { kind: "first" | "prev" | "play" | "pause" | "next" | "last" }) => (
  <svg viewBox="0 0 16 16" aria-hidden="true"><g fill="currentColor">
    {kind === "first" && <><rect x="2.5" y="3" width="1.8" height="10" /><path d="M13 3v10L5.5 8z" /></>}
    {kind === "prev" && <path d="M12 3.5v9L5 8z" />}
    {kind === "play" && <path d="M4.5 2.8v10.4L13 8z" />}
    {kind === "pause" && <><rect x="4" y="3" width="2.6" height="10" /><rect x="9.4" y="3" width="2.6" height="10" /></>}
    {kind === "next" && <path d="M4 3.5v9L11 8z" />}
    {kind === "last" && <><path d="M3 3v10L10.5 8z" /><rect x="11.7" y="3" width="1.8" height="10" /></>}
  </g></svg>
);

/** One number of a keyframe: drag it left / right like every number box, or click to type. */
function ValueField({ label, unit, value, decimals, min, max, onChange }: { label: string; unit?: string; value: number; decimals: number; min?: number; max?: number; onChange: (value: number) => void }) {
  const [text, setText] = useState<string | null>(null);
  const shown = `${Math.round(value * 10 ** decimals) / 10 ** decimals}${unit ? ` ${unit}` : ""}`;
  const commit = () => {
    const next = parseFloat(String(text ?? "").replace(",", ".").replace(/[^\d.+-]/g, ""));
    setText(null);
    if (Number.isFinite(next) && Math.abs(next - value) > 1e-6) onChange(Math.max(min ?? -Infinity, Math.min(max ?? Infinity, next)));
  };
  return (
    <label className="cb-symbol-value"><span>{label}</span>
      <input type="text" inputMode="decimal" aria-label={label} value={text ?? shown}
        {...scrubProps({ value, onChange, min, max, decimals, step: decimals ? 0.5 : 1 })}
        onFocus={(event) => { setText(String(Math.round(value * 10 ** decimals) / 10 ** decimals)); event.target.select(); }}
        onChange={(event) => setText(event.target.value)} onBlur={commit}
        onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); } else if (event.key === "Escape") { setText(null); event.currentTarget.blur(); } }} />
    </label>
  );
}

export default function SymbolTimeline({ crumbs, symbol, frame, playing, layerEdit, onLayerEdit, onDuplicateLayers, onListLibrary, onAddSymbol, onNotice, eases, keys, editable: editableProp, values, keyValues, pickedProp, onFrameOp, canPaste, onSelectLayer, onSelectKey, onSetValue, onSeek, onPlay, onCrumb, onStepInto, onSetEase, onPreviewEase, onSetKeys, onPreviewKeys }: {
  /** Scene › character › … › this symbol; clicking one steps back out to it. */
  crumbs: string[];
  symbol: FlaSymbol;
  frame: number;
  playing: boolean;
  /** How the layers were arranged here (order, hidden, locked, renamed, deleted, folders), saved with the character. */
  layerEdit?: SymbolLayerEdit;
  /** Change that arrangement (one undo step); a null result puts it back as the file has it. */
  onDuplicateLayers?: (ids: number[]) => void;
  /** Library symbols of the pose (names), and adding one on a new layer. */
  onListLibrary?: () => Promise<string[]>;
  onAddSymbol?: (name: string, above: number | null) => void;
  onLayerEdit: (change: (edit: SymbolLayerEdit) => SymbolLayerEdit | null) => void;
  onNotice?: (text: string) => void;
  /** This symbol's edited eases, by "<layer index>:<keyframe>". */
  eases?: Record<string, SymbolEaseEdit>;
  /** This symbol's moved and added keyframes, by layer index. */
  keys?: Record<string, SymbolKeyEdit>;
  /** Layers whose keyframes the player can move (asked of it); the rest are view only. */
  editable?: Record<number, boolean>;
  /** Values edited on this symbol's keyframes, by "<layer index>:<file frame>". */
  values?: Record<string, SymbolValueEdit>;
  /** The picked keyframe's values as the file has them (null: the player could not read them). */
  keyValues?: { layer: number; frame: number; values: Record<string, number> | null } | null;
  /** The part picked on the stage (its property name in this symbol): the layers that show it are highlighted. */
  pickedProp?: string | null;
  /** A frame operation of Animate on the selected frames (insert / remove frames, insert / clear keyframes, copy / cut / paste). */
  onFrameOp: (op: FrameOp, selection: { layers: number[]; from: number; to: number }) => void;
  /** Frames were copied: Paste is available. */
  canPaste: boolean;
  /** A layer was picked by its name (null: none): its part is picked on the stage. */
  onSelectLayer: (layerIndex: number | null) => void;
  /** A keyframe was picked (file frame), or none. */
  onSelectKey: (layerIndex: number, frame: number | null) => void;
  /** Change values of a keyframe; null puts them back. */
  onSetValue: (layerIndex: number, frame: number, patch: Partial<Record<SymbolValueKey, number>> | null) => void;
  onSeek: (frame: number) => void;
  onPlay: () => void;
  onCrumb: (index: number) => void;
  onStepInto: (layerIndex: number, frame: number, js: string) => void;
  /** A new ease for a keyframe's tween; null goes back to the .fla's. */
  onSetEase: (layerIndex: number, keyframe: FlaFrame, value: number | null) => void;
  /** The ease during a drag on the Ease box, then null when the drag ends. */
  onPreviewEase: (layerIndex: number, keyframe: FlaFrame, value: number | null) => void;
  /** The layer's keyframes after a move or add; null goes back to the .fla's. */
  onSetKeys: (layerIndex: number, anchors: Anchor[] | null) => void;
  /** The keyframes during a drag, then null when the drag ends. */
  onPreviewKeys: (layerIndex: number, anchors: Anchor[] | null) => void;
}) {
  const [closed, setClosed] = useState<Set<number>>(new Set());
  const rowsRef = useRef<number[]>([]);
  const selectionRef = useRef<{ layers: number[]; from: number; to: number } | null>(null);
  const opRef = useRef(onFrameOp);
  opRef.current = onFrameOp;
  const [keySel, setKeySel] = useState<{ layer: number; frame: number } | null>(null);
  const selectKey = (sel: { layer: number; frame: number } | null) => { setKeySel(sel); onSelectKey(sel?.layer ?? 0, sel ? sel.frame : null); };
  const [layerSel, setLayerSel] = useState<number | null>(null);
  const [libMenu, setLibMenu] = useState<{ x: number; y: number } | null>(null);
  const [libNames, setLibNames] = useState<string[]>([]);
  const [libFilter, setLibFilter] = useState("");
  // Selected frames, across layers (Animate): from where the press began to where the pointer is now.
  const [frameSel, setFrameSel] = useState<{ a: { layer: number; frame: number }; b: { layer: number; frame: number } } | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [picked, setPicked] = useState<{ layer: number; i: number } | null>(null);
  const viewRows = useMemo(() => layerRows(symbol.layers, layerEdit), [symbol.layers, layerEdit]);
  const layerAt = (id: number) => (id < EXTRA_BASE ? symbol.layers[id] : viewRows.find((row) => row.id === id)?.layer);
  const hiddenSet = new Set(layerEdit?.hidden || []), lockedSet = new Set(layerEdit?.locked || []);
  // A locked layer takes no edits: its keyframes cannot be moved or changed.
  const editable: Record<number, boolean> | undefined = editableProp && Object.fromEntries(Object.entries(editableProp).map(([id, value]) => [id, Boolean(value) && !lockedSet.has(Number(id))]));
  const anchorsOf = (index: number): Anchor[] => keys?.[index]?.anchors || fileAnchors(layerAt(index) as FlaLayer);
  const pickedLayer = picked ? layerAt(picked.layer) : undefined;
  const pickedShown = picked && pickedLayer ? shownFrames(pickedLayer, anchorsOf(picked.layer)).find((item) => item.i === picked.i) : undefined;
  const pickedFrame = pickedShown?.source;
  const pickedEdit = picked && pickedFrame ? eases?.[`${picked.layer}:${pickedFrame.i}`] : undefined;
  const pickedClassic = (pickedFrame?.tween === "classic" || pickedFrame?.tween === "motion") && Boolean(pickedLayer?.props?.length);
  const pickedMovable = Boolean(picked && editable?.[picked.layer]);
  const pickedAnchors = picked ? anchorsOf(picked.layer) : [];
  // The playhead is inside the picked tween (not on its first frame): a keyframe can be added there.
  const canAdd = Boolean(picked && pickedClassic && pickedMovable && addAnchor(pickedAnchors, frame));
  const keysEdited = Boolean(picked && keys?.[picked.layer]);
  const commitKeys = (layerIndex: number, anchors: Anchor[]) => onSetKeys(layerIndex, isUnchanged(layerAt(layerIndex) as FlaLayer, anchors) ? null : anchors);
  const scrollRef = useRef<HTMLDivElement>(null);
  const last = Math.max(0, symbol.frames - 1);
  // The selection as layers (in the order they are listed) and frames; kept in a ref for the shortcuts.
  const selection = (() => {
    if (!frameSel) return null;
    const order = rowsRef.current, ia = order.indexOf(frameSel.a.layer), ib = order.indexOf(frameSel.b.layer);
    const layers = ia >= 0 && ib >= 0 ? order.slice(Math.min(ia, ib), Math.max(ia, ib) + 1) : [frameSel.a.layer];
    return { layers, from: Math.min(frameSel.a.frame, frameSel.b.frame), to: Math.max(frameSel.a.frame, frameSel.b.frame) };
  })();
  const cells = symbol.frames + 12;

  // The layers as arranged, with their folder depth, and whether a closed folder hides them.
  const parentById = new Map(viewRows.map((row) => [row.id, row.parent] as const));
  const typeById = new Map(viewRows.map((row) => [row.id, row.type] as const));
  const rows = useMemo(() => viewRows.map((row) => {
    let depth = 0;
    let folded = false;
    for (let parent = row.parent; parent != null && depth < 20; parent = parentById.get(parent) ?? null) {
      if (typeById.get(parent) === "folder") { depth += 1; if (closed.has(parent)) folded = true; }
    }
    // A masked / guided layer sits indented under its mask or guide.
    if (row.parent != null && ["mask", "guide"].includes(typeById.get(row.parent) || "")) depth += 1;
    return { layer: row.layer, index: row.id, depth, folded, name: row.name, extra: row.extra };
  }).filter((row) => !row.folded), [closed, viewRows]); // eslint-disable-line react-hooks/exhaustive-deps
  rowsRef.current = rows.map((row) => row.index);
  const hiddenByFolder = (index: number) => {
    for (let parent = parentById.get(index) ?? null; parent != null; parent = parentById.get(parent) ?? null) if (hiddenSet.has(parent)) return true;
    return false;
  };

  // Keep the playhead in view.
  useEffect(() => {
    const box = scrollRef.current;
    if (!box) return;
    const x = LAYER_PANEL + frame * CELL;
    if (x < box.scrollLeft + LAYER_PANEL || x + CELL > box.scrollLeft + box.clientWidth) box.scrollLeft = Math.max(0, x - LAYER_PANEL - CELL * 4);
  }, [frame]);

  const frameAt = (clientX: number, element: HTMLElement) => Math.max(0, Math.min(last, Math.floor((clientX - element.getBoundingClientRect().left) / CELL)));
  const scrub = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const element = event.currentTarget;
    onSeek(frameAt(event.clientX, element));
    const move = (moveEvent: PointerEvent) => onSeek(frameAt(moveEvent.clientX, element));
    const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  // Dragging a keyframe: it follows the pointer between its neighbours, live on the stage, one undo step.
  const beginKeyDrag = (event: ReactPointerEvent<HTMLElement>, layerIndex: number, anchor: number) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    setPicked({ layer: layerIndex, i: anchorsOf(layerIndex)[anchor][1] });
    const startX = event.clientX, start = anchorsOf(layerIndex);
    selectKey({ layer: layerIndex, frame: start[anchor][0] });
    // Its frame is selected too (Shift adds to the frames already selected), and the playhead goes there.
    setMenu(null);
    setLayerSel(layerIndex);
    onSeek(start[anchor][1]);
    setFrameSel((current) => (event.shiftKey && current ? { a: current.a, b: { layer: layerIndex, frame: start[anchor][1] } } : { a: { layer: layerIndex, frame: start[anchor][1] }, b: { layer: layerIndex, frame: start[anchor][1] } }));
    if (anchor === 0) return;
    let latest = start;
    const move = (moveEvent: PointerEvent) => {
      const next = moveAnchor(start, anchor, start[anchor][1] + Math.round((moveEvent.clientX - startX) / CELL));
      if (!next || next === latest) return;
      latest = next;
      setPicked({ layer: layerIndex, i: next[anchor][1] });
      onPreviewKeys(layerIndex, next);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      if (latest !== start) { commitKeys(layerIndex, latest); onPreviewKeys(layerIndex, null); }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  selectionRef.current = selection;
  // Press on a frame and drag: select frames across layers (Shift extends); the playhead goes to the frame pressed.
  const beginFrameSelect = (event: ReactPointerEvent<HTMLElement>, layerIndex: number) => {
    if (event.button !== 0) return;
    event.preventDefault();
    setMenu(null);
    const lane = event.currentTarget, at = frameAt(event.clientX, lane);
    onSeek(at);
    const from = event.shiftKey && frameSel ? frameSel.a : { layer: layerIndex, frame: at };
    setFrameSel({ a: from, b: { layer: layerIndex, frame: at } });
    const move = (moveEvent: PointerEvent) => {
      const row = (document.elementFromPoint(moveEvent.clientX, moveEvent.clientY) as HTMLElement | null)?.closest("[data-symbol-row]");
      const layer = row ? Number(row.getAttribute("data-symbol-row")) : layerIndex;
      setFrameSel((current) => (current ? { ...current, b: { layer, frame: frameAt(moveEvent.clientX, lane) } } : current));
    };
    const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  // Animate's frame shortcuts while frames are selected: F5 / ⇧F5 insert / remove frames, F6 / ⇧F6 insert / clear a keyframe,
  // Delete clears a keyframe, ⌥⌘C / ⌥⌘X / ⌥⌘V copy / cut / paste frames.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null, tag = target?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select" || target?.isContentEditable) return;
      const sel = selectionRef.current;
      if (!sel) return;
      const command = event.metaKey || event.ctrlKey;
      let op: FrameOp | null = null;
      if (event.key === "F5") op = event.shiftKey ? "remove-frames" : "insert-frame";
      else if (event.key === "F6") op = event.shiftKey ? "clear-keyframe" : "insert-keyframe";
      else if ((event.key === "Delete" || event.key === "Backspace") && !command) op = "clear-keyframe";
      else if (command && event.altKey && event.code === "KeyC") op = "copy";
      else if (command && event.altKey && event.code === "KeyX") op = "cut";
      else if (command && event.altKey && event.code === "KeyV") op = "paste";
      if (!op) return;
      event.preventDefault();
      event.stopPropagation();
      opRef.current(op, sel);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") { event.stopPropagation(); close(); } };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", key, true);
    return () => { window.removeEventListener("pointerdown", close); window.removeEventListener("keydown", key, true); };
  }, [menu]);
  // ---- Layers: pick (Shift / ⌘ for several), rename, hide, lock, reorder by dragging, new layer / folder, delete.
  const [layerPick, setLayerPick] = useState<Set<number>>(new Set());
  const [renaming, setRenaming] = useState<number | null>(null);
  const [dropAt, setDropAt] = useState<{ id: number; where: "before" | "after" | "into" } | null>(null);
  const dropRef = useRef<typeof dropAt>(null);
  const idsFor = (id: number) => (layerPick.has(id) ? [...layerPick] : [id]);
  const pickLayer = (event: { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean }, id: number) => {
    const order = rowsRef.current;
    if (event.shiftKey && layerSel != null && order.includes(layerSel)) {
      const a = order.indexOf(layerSel), b = order.indexOf(id);
      setLayerPick(new Set(order.slice(Math.min(a, b), Math.max(a, b) + 1)));
    } else if (event.metaKey || event.ctrlKey) {
      setLayerPick((current) => { const next = new Set(current.size ? current : layerSel != null ? [layerSel] : []); if (next.has(id)) next.delete(id); else next.add(id); return next; });
      setLayerSel(id);
    } else { setLayerPick(new Set([id])); setLayerSel(id); }
    onSelectLayer(id);
  };
  const renameLayer = (id: number, value: string, fileName: string) => {
    setRenaming(null);
    const text = value.trim();
    onLayerEdit((current) => {
      const names = { ...(current.names || {}) };
      if (!text || (text === fileName && id < EXTRA_BASE)) delete names[String(id)]; else names[String(id)] = text;
      const extras = id >= EXTRA_BASE ? (current.extras || []).map((extra) => (extra.id === id && text ? { ...extra, name: text } : extra)) : current.extras;
      return { ...current, names, extras };
    });
  };
  const beginLayerDrag = (event: ReactPointerEvent<HTMLElement>, id: number) => {
    if (event.button !== 0 || (event.target as HTMLElement).closest("button,input")) return;
    const startY = event.clientY, ids = idsFor(id);
    let active = false;
    const move = (moveEvent: PointerEvent) => {
      if (!active) { if (Math.abs(moveEvent.clientY - startY) < 5) return; active = true; document.body.classList.add("cb-dragging-layer"); }
      const row = (document.elementFromPoint(moveEvent.clientX, moveEvent.clientY) as HTMLElement | null)?.closest("[data-symbol-row]");
      if (!row) { dropRef.current = null; setDropAt(null); return; }
      const target = Number(row.getAttribute("data-symbol-row")), box = row.getBoundingClientRect(), y = (moveEvent.clientY - box.top) / box.height;
      const where = typeById.get(target) === "folder" && y > 0.3 && y < 0.7 ? "into" : y < 0.5 ? "before" : "after";
      dropRef.current = ids.includes(target) ? null : { id: target, where };
      setDropAt(dropRef.current);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      document.body.classList.remove("cb-dragging-layer");
      const drop = dropRef.current;
      dropRef.current = null;
      setDropAt(null);
      if (!active || !drop) return;
      const next = moveLayers(symbol.layers, layerEdit, ids, drop.id, drop.where);
      if (!next) onNotice?.("A mask and the layers it masks stay together: they can't be moved, or dropped into, one by one.");
      else onLayerEdit(() => next);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  const deleteLayers = () => {
    const picked = layerPick.size ? [...layerPick] : layerSel != null ? [layerSel] : [];
    if (!picked.length) return;
    if (picked.some((id) => lockedTogether(symbol.layers, layerEdit, id))) { onNotice?.("A mask and the layers it masks go together: delete them as a block."); return; }
    const all = new Set<number>(picked);
    picked.forEach((id) => descendants(symbol.layers, layerEdit, id).forEach((below) => all.add(below)));
    onLayerEdit((current) => ({ ...current, deleted: [...new Set([...(current.deleted || []), ...all])] }));
    setLayerPick(new Set());
    setLayerSel(null);
    onSelectLayer(null);
  };
  const labels = Array.from({ length: Math.floor(cells / 5) }, (_, index) => (index + 1) * 5);

  return (
    <section className="cb-symbol-timeline" style={{ ["--cb-sym-cell" as string]: `${CELL}px`, ["--cb-sym-row" as string]: `${ROW}px`, ["--cb-sym-panel" as string]: `${LAYER_PANEL}px` }}>
      <div className="cb-symbol-top">
      <div className="cb-symbol-toolbar">
        <nav className="cb-symbol-crumbs" aria-label="Where you are">
          {crumbs.map((crumb, index) => (
            <span key={`${index}-${crumb}`}>
              {index > 0 && <i aria-hidden="true">›</i>}
              {index < crumbs.length - 1
                ? <button type="button" onClick={() => onCrumb(index)} title={index === 0 ? "Back to the scene (Esc steps out one level)" : `Back to ${crumb}`}>{crumb}</button>
                : <b title={symbol.name}>{crumb}</b>}
            </span>
          ))}
        </nav>
        {picked && pickedLayer && pickedFrame && (pickedClassic || pickedMovable || keysEdited) ? (
          <div className="cb-symbol-ease">
            <span className="cb-symbol-ease-where" title={pickedLayer.name}>{pickedLayer.name} · {pickedShown!.i + 1}–{pickedShown!.i + pickedShown!.d}</span>
            {pickedClassic && <>
              <span className="cb-symbol-ease-label">Ease</span>
              <EaseControl key={`${picked.layer}:${picked.i}`} value={pickedEdit?.value ?? easeValue(pickedFrame.ease)}
                onCommit={(value) => onSetEase(picked.layer, pickedFrame, value)}
                onPreview={(value) => onPreviewEase(picked.layer, pickedFrame, value)} />
              {!pickedEdit && typeof pickedFrame.ease === "string" && <span className="cb-symbol-ease-custom">{easeText(pickedFrame.ease)}</span>}
              {pickedEdit && <button type="button" className="cb-symbol-ease-reset" onClick={() => onSetEase(picked.layer, pickedFrame, null)} title={`Back to the file's ${easeText(pickedFrame.ease) || "no easing"}`}>Reset</button>}
            </>}
            <button type="button" className="cb-symbol-ease-reset" disabled={!canAdd} onClick={() => { const next = addAnchor(pickedAnchors, frame); if (next) commitKeys(picked.layer, next); }}
              title={canAdd ? `Add a keyframe at frame ${frame + 1}, holding where the motion is now` : pickedMovable ? "Move the playhead inside this tween to add a keyframe" : "This layer is built from frames in the .fla: its keyframes are view only"}>+ Keyframe</button>
            {pickedShown?.added && <button type="button" className="cb-symbol-ease-reset" onClick={() => commitKeys(picked.layer, removeAnchor(pickedAnchors, pickedShown.anchor))} title="Remove this keyframe you added">Remove keyframe</button>}
            {keysEdited && <button type="button" className="cb-symbol-ease-reset" onClick={() => onSetKeys(picked.layer, null)} title="Put this layer's keyframes back where the .fla has them">Reset keys</button>}
          </div>
        ) : (
          <span className="cb-symbol-note" title="Inside a character you can edit classic tween eases, and move or add keyframes on tweened layers; shape tweens and layers built from frames are view only">
            {pickedFrame?.tween === "shape" ? "Shape tween: view only" : "Click a purple tween: edit its ease, drag its keyframes"}
          </span>
        )}
        <span className="cb-symbol-fps">{symbol.fps.toFixed(2)} FPS</span>
        <div className="cb-symbol-transport">
          <button type="button" onClick={() => onSeek(0)} aria-label="First frame" title="First frame"><TransportIcon kind="first" /></button>
          <button type="button" onClick={() => onSeek(Math.max(0, frame - 1))} aria-label="Previous frame" title="Previous frame"><TransportIcon kind="prev" /></button>
          <button type="button" className="play" onClick={onPlay} aria-label={playing ? "Pause" : "Play"} title="Play / Stop (this symbol)"><TransportIcon kind={playing ? "pause" : "play"} /></button>
          <button type="button" onClick={() => onSeek(Math.min(last, frame + 1))} aria-label="Next frame" title="Next frame"><TransportIcon kind="next" /></button>
          <button type="button" onClick={() => onSeek(last)} aria-label="Last frame" title="Last frame"><TransportIcon kind="last" /></button>
          <span className="cb-symbol-counter">{frame + 1} / {symbol.frames}</span>
        </div>
      </div>
      {keySel && layerAt(keySel.layer) && (() => {
        const layer = layerAt(keySel.layer) as FlaLayer;
        const edit = values?.[`${keySel.layer}:${keySel.frame}`];
        const file = keyValues && keyValues.layer === keySel.layer && keyValues.frame === keySel.frame ? keyValues.values : null;
        const now = file ? { ...file, ...(edit?.v || {}) } as Record<string, number> : null;
        const set = (patch: Partial<Record<SymbolValueKey, number>>) => onSetValue(keySel.layer, keySel.frame, patch);
        const round = (value: number, digits: number) => Math.round(value * 10 ** digits) / 10 ** digits;
        const turn = now != null && Math.abs((now.skewX ?? 0) - (now.skewY ?? 0)) < 0.01;
        return (
          <div className="cb-symbol-values">
            <span className="cb-symbol-values-where" title={layer.name}>{layer.name} · keyframe {keySel.frame + 1}</span>
            {!now ? <span className="cb-symbol-ease-custom">{editable?.[keySel.layer] === false ? "This layer's keyframes can't be edited here" : "No position values on this keyframe (empty, or a shape tween)"}</span> : <>
              <ValueField label="X" value={now.x} decimals={1} onChange={(v) => set({ x: v })} />
              <ValueField label="Y" value={now.y} decimals={1} onChange={(v) => set({ y: v })} />
              {turn
                ? <ValueField label="Rotation" unit="°" value={now.skewX ?? 0} decimals={1} onChange={(v) => set({ skewX: v, skewY: v })} />
                : <><ValueField label="Skew X" unit="°" value={now.skewX ?? 0} decimals={1} onChange={(v) => set({ skewX: v })} /><ValueField label="Skew Y" unit="°" value={now.skewY ?? 0} decimals={1} onChange={(v) => set({ skewY: v })} /></>}
              <ValueField label="Scale X" unit="%" value={round((now.scaleX ?? 1) * 100, 2)} decimals={1} onChange={(v) => set({ scaleX: round(v / 100, 4) })} />
              <ValueField label="Scale Y" unit="%" value={round((now.scaleY ?? 1) * 100, 2)} decimals={1} onChange={(v) => set({ scaleY: round(v / 100, 4) })} />
              <ValueField label="Opacity" unit="%" value={round((now.alpha ?? 1) * 100, 1)} decimals={0} min={0} max={100} onChange={(v) => set({ alpha: round(v / 100, 3) })} />
            </>}
            {edit && <button type="button" className="cb-symbol-ease-reset" onClick={() => onSetValue(keySel.layer, keySel.frame, null)} title="Put this keyframe's values back to the .fla's">Reset values</button>}
            <button type="button" className="cb-symbol-ease-reset" onClick={() => selectKey(null)} aria-label="Close keyframe values" title="Close">×</button>
          </div>
        );
      })()}
      </div>
      <div className="cb-symbol-grid" ref={scrollRef}>
        <div className="cb-symbol-head">
          <div className="cb-symbol-head-name">
            <span title={symbol.name}>{rows.length} layers · {short(symbol.name)}</span>
            <span className="cb-symbol-layer-tools">
              <button type="button" onClick={() => onLayerEdit((current) => addLayer(symbol.layers, current, "normal", layerSel))} title="New layer (an empty one, above the layer picked)" aria-label="New layer"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3v10M3 8h10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg></button>
              {onAddSymbol && onListLibrary && <button type="button" onClick={(event) => {
                const box = event.currentTarget.getBoundingClientRect();
                setLibMenu((open) => (open ? null : { x: box.left, y: box.bottom + 4 }));
                setLibFilter("");
                onListLibrary().then(setLibNames);
              }} title="New layer from the library (a symbol of this pose, placed in the middle of the stage)" aria-label="New layer from library"><svg viewBox="0 0 16 16" aria-hidden="true"><rect x="2.5" y="3" width="8" height="10" rx="1.2" fill="none" stroke="currentColor" strokeWidth="1.3" /><path d="M13 5.5v5M10.5 8h5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg></button>}
              {onDuplicateLayers && <button type="button" onClick={() => onDuplicateLayers(layerPick.size ? [...layerPick] : layerSel != null ? [layerSel] : [])} title="Duplicate layer (a copy of the picked layers, just above them)" aria-label="Duplicate layer"><svg viewBox="0 0 16 16" aria-hidden="true"><rect x="5" y="5" width="8" height="8" rx="1.2" fill="none" stroke="currentColor" strokeWidth="1.3" /><path d="M3 10.5V4a1 1 0 0 1 1-1h6.5" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg></button>}
              <button type="button" onClick={() => onLayerEdit((current) => addLayer(symbol.layers, current, "folder", layerSel))} title="New folder (drag layers into it)" aria-label="New folder"><LayerIcon type="folder" open={false} /></button>
              <button type="button" onClick={deleteLayers} disabled={!layerPick.size && layerSel == null} title="Delete the picked layers (they are hidden for good; Undo brings them back)" aria-label="Delete layer"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 4.5h9M6.5 4.5V3h3v1.5M5 4.5l.5 8.5h5l.5-8.5" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" /></svg></button>
              {layerEdit && <button type="button" onClick={() => onLayerEdit(() => null)} title="Put the layers back as the .fla has them" aria-label="Reset layers">↺</button>}
            </span>
          </div>
          <div className="cb-symbol-ruler" style={{ width: cells * CELL }} onPointerDown={scrub} role="slider" aria-label="Frame" aria-valuemin={1} aria-valuemax={symbol.frames} aria-valuenow={frame + 1}>
            {labels.map((label) => <span key={label} style={{ left: (label - 1) * CELL + CELL / 2 }}>{label}</span>)}
            <i className="cb-symbol-end" style={{ left: symbol.frames * CELL }} aria-hidden="true" />
            <b className="cb-symbol-ruler-head" style={{ left: frame * CELL, width: CELL }} aria-hidden="true" />
          </div>
        </div>
        {rows.map(({ layer, index, depth, name }) => {
          const shown = !hiddenSet.has(index) && !hiddenByFolder(index), locked = lockedSet.has(index);
          return (
            <div key={index} data-symbol-row={index} className={`cb-symbol-row ${shown ? "" : "is-hidden"} ${locked ? "is-locked" : ""} ${layer.type === "folder" ? "is-folder" : ""} ${layerSel === index || layerPick.has(index) || (pickedProp && layer.props?.includes(pickedProp)) ? "is-selected" : ""} ${dropAt?.id === index ? `drop-${dropAt.where}` : ""}`}>
              <div className="cb-symbol-layer" style={{ paddingLeft: 6 + depth * 14 }} onPointerDown={(event) => beginLayerDrag(event, index)} onClick={(event) => { if ((event.target as HTMLElement).closest("button,input")) return; pickLayer(event, index); }} title={`${name}${layer.type !== "normal" ? ` (${layer.type} layer)` : ""}${layer.hidden ? " · hidden in Animate" : ""}${layer.locked ? " · locked in Animate" : ""} · drag to reorder, double-click to rename`}>
                {layer.type === "folder"
                  ? <button type="button" className="cb-symbol-fold" onClick={() => setClosed((current) => { const next = new Set(current); if (next.has(index)) next.delete(index); else next.add(index); return next; })} aria-label={closed.has(index) ? `Open ${name}` : `Close ${name}`} aria-expanded={!closed.has(index)}><LayerIcon type="folder" open={!closed.has(index)} /></button>
                  : <span className="cb-symbol-type"><LayerIcon type={layer.type} open /></span>}
                {renaming === index
                  ? <input className="cb-symbol-rename" autoFocus defaultValue={name} aria-label="Layer name" onFocus={(event) => event.target.select()} onPointerDown={(event) => event.stopPropagation()}
                      onBlur={(event) => renameLayer(index, event.target.value, index < EXTRA_BASE ? symbol.layers[index]?.name || "" : "")}
                      onKeyDown={(event) => { event.stopPropagation(); if (event.key === "Enter") event.currentTarget.blur(); else if (event.key === "Escape") setRenaming(null); }} />
                  : <span className="cb-symbol-layer-name" onDoubleClick={() => setRenaming(index)}>{name}</span>}
                {layer.color && <i className="cb-symbol-swatch" style={{ borderColor: layer.color }} aria-hidden="true" />}
                <button type="button" className={`cb-symbol-eye ${shown ? "" : "off"}`} onClick={() => onLayerEdit((current) => ({ ...current, hidden: toggled(current.hidden, idsFor(index)) }))} aria-pressed={!shown}
                  aria-label={`${shown ? "Hide" : "Show"} ${name}`} title={`${shown ? "Hide" : "Show"} this layer (saved with the character, also in exports)`}><EyeIcon shown={shown} /></button>
                <button type="button" className={`cb-symbol-lock ${locked ? "on" : ""}`} onClick={() => onLayerEdit((current) => ({ ...current, locked: toggled(current.locked, idsFor(index)) }))} aria-pressed={locked}
                  aria-label={`${locked ? "Unlock" : "Lock"} ${name}`} title={locked ? "Unlock this layer" : "Lock this layer: its parts and keyframes can't be edited"}><LockIcon on={locked} /></button>
              </div>
              <div className="cb-symbol-lane" style={{ width: cells * CELL }}
                onPointerDown={(event) => {
                  const at = frameAt(event.clientX, event.currentTarget);
                  const keyframe = shownFrames(layer, anchorsOf(index)).find((item) => at >= item.i && at < item.i + item.d);
                  setPicked(keyframe && layer.type !== "folder" ? { layer: index, i: keyframe.i } : null);
                  if (keyframe && layer.type !== "folder" && !keyframe.added) { setLayerSel(index); selectKey({ layer: index, frame: keyframe.source.i }); }
                  if (layer.type !== "folder" && !locked) beginFrameSelect(event, index); else scrub(event);
                }}
                onContextMenu={(event) => {
                  if (layer.type === "folder") return;
                  event.preventDefault();
                  const at = frameAt(event.clientX, event.currentTarget);
                  if (!selection || !selection.layers.includes(index) || at < selection.from || at > selection.to) setFrameSel({ a: { layer: index, frame: at }, b: { layer: index, frame: at } });
                  setMenu({ x: event.clientX, y: event.clientY });
                }}
                onDoubleClick={(event) => {
                  const at = frameAt(event.clientX, event.currentTarget);
                  const keyframe = layer.frames.find((item) => at >= item.i && at < item.i + item.d);
                  const target = keyframe?.symbols?.find((item) => item.js);
                  if (target?.js) onStepInto(index, at, target.js);
                }}>
                {selection && selection.layers.includes(index) && <i className="cb-symbol-sel" style={{ left: selection.from * CELL, width: (selection.to - selection.from + 1) * CELL }} aria-hidden="true" />}
                {layer.type !== "folder" && shownFrames(layer, anchorsOf(index)).map((item) => {
                  const kind = item.tween === "classic" || item.tween === "motion" ? "classic" : item.tween === "shape" ? "shape" : item.blank ? "blank" : "frames";
                  const edit = eases?.[`${index}:${item.source.i}`];
                  const movable = Boolean(editable?.[index]) && item.anchor > 0;
                  const info = `Frame ${item.i + 1}${item.d > 1 ? `–${item.i + item.d}` : ""}${item.tween ? ` · ${item.tween} tween${edit ? `, ${edit.value ? valueText(edit.value) : "no easing"} (edited)` : item.ease != null ? `, ${easeText(item.ease)}` : ""}` : ""}${item.blank ? " · blank keyframe" : holds(item) ? ` · ${holds(item)}` : ""}${item.symbols?.some((symbolItem) => symbolItem.js) ? " · double-click to step inside" : ""}`;
                  return (
                    <span key={item.i} className={`cb-symbol-span ${kind} ${edit ? "is-edited" : ""} ${item.added || item.i !== item.source.i ? "is-moved" : ""} ${picked?.layer === index && picked.i === item.i ? "is-picked" : ""}`} style={{ left: item.i * CELL, width: item.d * CELL }} title={info}>
                      <i className={`cb-symbol-key ${item.blank ? "blank" : ""} ${item.added ? "added" : ""} ${movable ? "movable" : ""} ${editable?.[index] && !item.added ? "pickable" : ""} ${values?.[`${index}:${item.source.i}`] ? "valued" : ""} ${keySel?.layer === index && keySel.frame === item.source.i && !item.added ? "chosen" : ""}`} aria-hidden="true"
                        onPointerDown={editable?.[index] && !item.added ? (event) => beginKeyDrag(event, index, item.anchor) : undefined} />
                      {item.tween && item.d > 2 && <em className="cb-symbol-arrow" aria-hidden="true" />}
                      {!item.tween && item.d > 1 && <u className="cb-symbol-hold" aria-hidden="true" />}
                      {item.label && <small className="cb-symbol-label">⚑ {item.label}</small>}
                      {item.sound && <small className="cb-symbol-sound">♪ {item.sound}</small>}
                    </span>
                  );
                })}
              </div>
            </div>
          );
        })}
        {menu && selection && (() => {
          const run = (op: FrameOp) => { setMenu(null); onFrameOp(op, selection); };
          const onKeyframe = selection.layers.some((layerIndex) => { const anchors = anchorsOf(layerIndex); for (let f = selection.from; f <= selection.to; f += 1) if (keyframeAt(anchors, f) > 0) return true; return false; });
          return (
            <div className="cb-frame-menu cb-symbol-framemenu" role="menu" style={{ left: menu.x, top: menu.y }} onPointerDown={(event) => event.stopPropagation()}>
              <button type="button" role="menuitem" onClick={() => run("insert-frame")}>Insert Frame<kbd>F5</kbd></button>
              <button type="button" role="menuitem" onClick={() => run("remove-frames")}>Remove Frames<kbd>⇧F5</kbd></button>
              <span className="cb-frame-menu-sep" aria-hidden="true" />
              <button type="button" role="menuitem" onClick={() => run("insert-keyframe")}>Insert Keyframe<kbd>F6</kbd></button>
              <button type="button" role="menuitem" disabled={!onKeyframe} onClick={() => run("clear-keyframe")}>Clear Keyframe<kbd>⇧F6</kbd></button>
              <span className="cb-frame-menu-sep" aria-hidden="true" />
              <button type="button" role="menuitem" onClick={() => run("copy")}>Copy Frames<kbd>⌥⌘C</kbd></button>
              <button type="button" role="menuitem" onClick={() => run("cut")}>Cut Frames<kbd>⌥⌘X</kbd></button>
              <button type="button" role="menuitem" disabled={!canPaste} onClick={() => run("paste")}>Paste Frames<kbd>⌥⌘V</kbd></button>
            </div>
          );
        })()}
        <i className="cb-symbol-playhead" style={{ left: LAYER_PANEL + frame * CELL + CELL / 2 - 1 }} aria-hidden="true" />
      </div>
      {libMenu && onAddSymbol && (
        <>
          <div className="cb-symbol-lib-shade" onPointerDown={() => setLibMenu(null)} />
          <div className="cb-frame-menu cb-symbol-lib" role="menu" style={{ left: libMenu.x, top: libMenu.y }}>
            <input autoFocus value={libFilter} onChange={(event) => setLibFilter(event.target.value)} placeholder="Find a symbol" onKeyDown={(event) => { if (event.key === "Escape") setLibMenu(null); event.stopPropagation(); }} />
            <div className="cb-symbol-lib-list">
              {libNames.filter((name) => name.toLowerCase().includes(libFilter.toLowerCase())).map((name) => (
                <button key={name} type="button" role="menuitem" onClick={() => { setLibMenu(null); onAddSymbol(name, layerSel); }}>{name}</button>
              ))}
              {!libNames.length && <span className="cb-symbol-lib-empty">No symbols in this pose's library.</span>}
            </div>
          </div>
        </>
      )}
    </section>
  );
}
