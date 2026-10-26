"use client";

import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { DragEvent as ReactDragEvent, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";
import type { CharacterKeyframe, EditorObject, Scene } from "@/types";

/** Frames selected on one or more layers (inclusive, 0-based frame indexes). layerId is the
 *  layer the selection started on; layerIds lists every selected layer, top to bottom. */
export type FrameSelection = { layerId: string; layerIds?: string[]; from: number; to: number } | null;
export const selectionLayerIds = (selection: FrameSelection): string[] =>
  (selection ? (selection.layerIds?.length ? selection.layerIds : [selection.layerId]) : []);
export type FrameAction = "keyframe" | "blank" | "insert-frame" | "remove-frames" | "clear-keyframe" | "tween" | "remove-tween";

type Props = {
  scenes: Scene[];
  activeId: string;
  layers: EditorObject[];
  selectedObjectId: string | null;
  isPlaying: boolean;
  playhead: number;
  activeDuration: number;
  onSelect: (scene: Scene) => void;
  onSelectLayer: (id: string) => void;
  onAdd: () => void;
  onPlay: () => void;
  onSeek: (seconds: number) => void;
  onAddKeyframe?: (id: string, time: number) => void;
  onImportAudio?: () => void;
  onCreateMotion?: (id: string) => void;
  onReorderLayer?: (draggedId: string, targetId: string) => void;
  onDeleteLayer?: (id: string) => void;
  onUpdateLayerTiming?: (id: string, patch: { startTime?: number; actionDurationMs?: number }) => void;
  /** Animate symbol looping: toggles a layer between Loop and Play Once. */
  onToggleLayerLoop?: (id: string) => void;
  /** Source animation length (seconds) per layer id, used to mark where each loop restarts. */
  sourceDurations?: Record<string, number>;
  /** Called when a clip move/resize drag starts (true) and ends (false). */
  onClipDragChange?: (active: boolean) => void;
  /** Animate frame selection on the frame grid. */
  frameSelection?: FrameSelection;
  onSelectFrames?: (selection: FrameSelection) => void;
  onFrameAction?: (action: FrameAction, layerIds: string[], from: number, to: number) => void;
  onAddLayer?: () => void;
  onToggleLayerHidden?: (id: string) => void;
  onToggleLayerLocked?: (id: string) => void;
  /** Drag a keyframe from one frame to another. */
  onMoveKeyframe?: (layerId: string, fromFrame: number, toFrame: number) => void;
  /** Tween easing on the keyframe that starts the tween (0..100 each). */
  onSetTweenEase?: (layerId: string, keyframeId: string, easeIn: number, easeOut: number) => void;
};

const LoopIcon = () => (
  <svg viewBox="0 0 16 16" aria-hidden="true"><g fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 7.2V6.4A2.4 2.4 0 0 1 5.4 4h7.1M10.6 2l1.9 2-1.9 2" /><path d="M13 8.8v.8A2.4 2.4 0 0 1 10.6 12H3.5M5.4 14l-1.9-2 1.9-2" />
  </g></svg>
);
const ToolIcon = ({ kind }: { kind: "menu" | "folder" | "add" | "hide" | "lock" | "trash" }) => (
  <svg viewBox="0 0 16 16" aria-hidden="true"><g fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
    {kind === "menu" && <path d="M2 4h12M2 8h12M2 12h12" strokeWidth="1.8" />}
    {kind === "folder" && <path d="M2 4.5h4l1.3 1.5H14v6.5H2z" />}
    {kind === "add" && <path d="M8 2.5v11M2.5 8h11" strokeWidth="1.5" />}
    {kind === "hide" && <><path d="M1.8 8s2.3-4 6.2-4 6.2 4 6.2 4-2.3 4-6.2 4-6.2-4-6.2-4z" /><circle cx="8" cy="8" r="1.8" /><path d="M3 13 13 3" /></>}
    {kind === "lock" && <><rect x="3.5" y="7" width="9" height="6.5" rx="1" fill="currentColor" /><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" /></>}
    {kind === "trash" && <path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.7 9h5.6l.7-9" />}
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

const FPS = 30;
const iconFor = (type: EditorObject["type"]) => type === "audio" ? "♫" : type === "background" ? "▧" : type === "text" ? "T" : type === "prop" ? "◇" : type === "empty" ? "○" : "♙";
const DEFAULT_ZOOM = 27; // ≈ 11 px per frame, like Animate's default frame width
const cellWidthFor = (zoom: number) => 4 + (Math.max(1, Math.min(100, zoom)) / 100) * 26;
/** While dragging on the timeline, nothing on the page may be text-selected (returns the undo). */
const blockTextSelection = () => {
  window.getSelection()?.removeAllRanges();
  const previous = document.body.style.userSelect;
  document.body.style.userSelect = "none";
  return () => { document.body.style.userSelect = previous; };
};
const ROW_HEIGHT = 31; // 30px row + 1px line
const RULER_HEIGHT = 30;

/** First/last frame (inclusive) of a layer's content on the frame grid. */
const layerSpan = (layer: EditorObject, lastSceneFrame: number) => {
  const start = Math.max(0, Number(layer.startTime || 0));
  const startFrame = Math.round(start * FPS);
  if (layer.type === "empty") return { startFrame: 0, endFrame: lastSceneFrame };
  const endFrame = layer.actionDurationMs
    ? Math.max(startFrame, Math.round((start + layer.actionDurationMs / 1000) * FPS) - 1)
    : Math.max(startFrame, lastSceneFrame);
  return { startFrame, endFrame };
};

/** Frames that hold a keyframe: where the content starts, plus every position keyframe. */
export const layerKeyframeFrames = (layer: EditorObject, lastSceneFrame: number) => {
  const { startFrame } = layerSpan(layer, lastSceneFrame);
  const frames = new Set<number>([startFrame]);
  if (layer.type === "character") for (const keyframe of layer.keyframes || []) frames.add(Math.round(keyframe.time * FPS));
  return frames;
};

const frameOfTime = (time: number) => Math.round(time * FPS);
const sortedKeys = (layer: EditorObject) => (layer.type === "character" ? [...(layer.keyframes || [])].sort((a, b) => a.time - b.time) : []);
/** Tweened stretches: from a keyframe whose tween is not off to the next keyframe. */
const tweenSegments = (layer: EditorObject) => {
  const keys = sortedKeys(layer);
  const result: Array<{ left: CharacterKeyframe; fromFrame: number; toFrame: number; easeIn: number; easeOut: number }> = [];
  for (let index = 0; index < keys.length - 1; index += 1) {
    const left = keys[index];
    if (left.tween === false) continue;
    result.push({ left, fromFrame: frameOfTime(left.time), toFrame: frameOfTime(keys[index + 1].time), easeIn: left.tween?.easeIn ?? 0, easeOut: left.tween?.easeOut ?? 0 });
  }
  return result;
};

/** One ease control per tween (Animate's single ease value): drag left for ease in (shown as
 *  −1…−100, starts slowly), right for ease out (1…100, ends slowly); 0 = no easing.
 *  Double-click to type a value from −100 to 100. */
const EaseControl = ({ value, onCommit }: { value: number; onCommit: (next: number) => void }) => {
  const [preview, setPreview] = useState<number | null>(null);
  const [editing, setEditing] = useState(false);
  const shown = preview ?? value;
  const commitTyped = (raw: string) => {
    setEditing(false);
    const parsed = Number(raw);
    if (Number.isFinite(parsed)) onCommit(Math.max(-100, Math.min(100, Math.round(parsed))));
  };
  const beginScrub = (event: ReactPointerEvent<HTMLSpanElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    let latest = value;
    let moved = false;
    const release = blockTextSelection();
    const move = (moveEvent: PointerEvent) => {
      const dx = moveEvent.clientX - startX;
      if (Math.abs(dx) > 2) moved = true;
      latest = Math.max(-100, Math.min(100, Math.round(value + dx / 2)));
      setPreview(latest);
    };
    const up = () => {
      release();
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setPreview(null);
      if (moved && latest !== value) onCommit(latest);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  if (editing) {
    return (
      <input className="cb-ease-input" autoFocus defaultValue={String(value)} aria-label="Ease"
        onPointerDown={(event) => event.stopPropagation()} onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === "Enter") commitTyped(event.currentTarget.value);
          if (event.key === "Escape") setEditing(false);
        }}
        onBlur={(event) => commitTyped(event.currentTarget.value)} />
    );
  }
  return (
    <>
      <span className="cb-ease-box" role="slider" aria-label="Ease (left = ease in, right = ease out)" aria-valuemin={-100} aria-valuemax={100} aria-valuenow={shown}
        title={shown < 0 ? `Ease in ${-shown}: drag left/right, double-click to type` : shown > 0 ? `Ease out ${shown}: drag left/right, double-click to type` : "No easing: drag left for ease in, right for ease out (double-click to type)"}
        onPointerDown={beginScrub} onDoubleClick={() => setEditing(true)}>{String(shown)}</span>
      {shown !== 0 && <em className="cb-ease-word">{shown < 0 ? "in" : "out"}</em>}
    </>
  );
};

type RowHandlers = {
  lanePress: (event: ReactPointerEvent<HTMLDivElement>, layer: EditorObject) => void;
  laneDoubleClick: (event: ReactMouseEvent<HTMLDivElement>, layer: EditorObject) => void;
  contextMenu: (event: ReactMouseEvent<HTMLDivElement>, layer: EditorObject) => void;
  selectLayer: (id: string) => void;
  deleteLayer: (id: string) => void;
  toggleLoop: (id: string) => void;
  toggleHidden: (id: string) => void;
  toggleLocked: (id: string) => void;
  dragStart: (event: ReactDragEvent<HTMLElement>, id: string) => void;
  dragEnd: () => void;
  dragOver: (id: string) => void;
  dragLeave: (id: string) => void;
  drop: (event: ReactDragEvent<HTMLElement>, id: string) => void;
  setEase: (layerId: string, keyframeId: string, easeIn: number, easeOut: number) => void;
};

type LayerRowProps = {
  layer: EditorObject;
  displayIndex: number;
  cell: number;
  lastFrame: number;
  selected: boolean;
  dragging: boolean;
  dropTarget: boolean;
  selection: FrameSelection;
  ghostFrame: number | null;
  spanEditing: boolean;
  loopLength: number;
  handlers: RowHandlers;
};

/** One layer row. Memoized: playback only moves the shared playhead, so rows don't redraw. */
const LayerRow = memo(function LayerRow({ layer, displayIndex, cell, lastFrame, selected, dragging, dropTarget, selection, ghostFrame, spanEditing, loopLength, handlers }: LayerRowProps) {
  const span = layerSpan(layer, lastFrame);
  const keyframes = layerKeyframeFrames(layer, lastFrame);
  const animated = layer.type === "character" && layer.assetKind === "animate-createjs";
  const looping = animated && layer.loopMode === "loop";
  const spanFrames = span.endFrame - span.startFrame + 1;
  // Where each repeat of the source animation starts inside the span (looping layers only).
  const loopMarks = looping && loopLength > 0 && !(layer.sourceAnimationClips || []).length
    ? Array.from({ length: Math.max(0, Math.min(200, Math.ceil(spanFrames / loopLength) - 1)) }, (_, index) => span.startFrame + (index + 1) * loopLength)
    : [];
  return (
    <div
      className={`cb-timeline-row ${selected ? "selected" : ""} ${dragging ? "dragging" : ""} ${dropTarget ? "drop-target" : ""} ${layer.hidden ? "is-hidden" : ""} ${layer.locked ? "is-locked" : ""}`}
      onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "move"; handlers.dragOver(layer.id); }}
      onDragLeave={() => handlers.dragLeave(layer.id)}
      onDrop={(event) => handlers.drop(event, layer.id)}
    >
      <div className="cb-layer-name">
        <button className="cb-layer-drag-handle" draggable onDragStart={(event) => handlers.dragStart(event, layer.id)} onDragEnd={handlers.dragEnd} title="Drag layer up or down">⋮⋮</button>
        <button className="cb-layer-select" onClick={() => handlers.selectLayer(layer.id)} title={layer.name}>
          <b>{iconFor(layer.type)}</b>
          <span>{`Layer ${String(displayIndex + 1).padStart(2, "0")}`}<small>{layer.type === "empty" ? "Empty layer" : layer.name}</small></span>
        </button>
        <span className="cb-layer-flags">
          {layer.hidden && <button type="button" className="cb-layer-flag" onClick={() => handlers.toggleHidden(layer.id)} title="Hidden — click to show" aria-label={`Show ${layer.name}`}><ToolIcon kind="hide" /></button>}
          {layer.locked && <button type="button" className="cb-layer-flag" onClick={() => handlers.toggleLocked(layer.id)} title="Locked — click to unlock" aria-label={`Unlock ${layer.name}`}><ToolIcon kind="lock" /></button>}
          {animated && (
            <button type="button" className={`cb-layer-loop ${looping ? "active" : ""}`} aria-pressed={looping}
              onClick={(event) => { event.stopPropagation(); handlers.toggleLoop(layer.id); }}
              aria-label={`${looping ? "Loop" : "Play once"}: ${layer.name}`}
              title={looping ? "Loop: this character's animation repeats for the whole clip. Click for Play once." : "Play once: this character's animation plays once and holds its last frame. Click to loop it."}><LoopIcon /><span>{looping ? "Loop" : "Once"}</span></button>
          )}
        </span>
        <button className="cb-layer-delete" onClick={(event) => { event.stopPropagation(); handlers.deleteLayer(layer.id); }} title="Remove layer from the scene (the library keeps it)" aria-label={`Remove ${layer.name} from the scene`}>×</button>
      </div>
      <div className="cb-track-lane" onPointerDown={(event) => handlers.lanePress(event, layer)} onMouseDown={(event) => event.preventDefault()} onDoubleClick={(event) => handlers.laneDoubleClick(event, layer)} onContextMenu={(event) => handlers.contextMenu(event, layer)}>
        <span
          className={`cb-frame-span cb-span-${layer.type} ${spanEditing ? "editing" : ""}`}
          style={{ left: `${span.startFrame * cell}px`, width: `${spanFrames * cell}px` }}
          title={`${layer.type === "empty" ? "Empty layer" : layer.name} · frames ${span.startFrame + 1}–${span.endFrame + 1}`}
        >
          {layer.type !== "empty" && <><b className="cb-span-handle left" title="Drag to trim the start" /><b className="cb-span-handle right" title="Drag to trim or extend the end" /></>}
        </span>
        {layer.type !== "empty" && <span className="cb-span-end" style={{ left: `${span.endFrame * cell}px`, width: `${cell}px` }} aria-hidden="true" />}
        {tweenSegments(layer).map((segment) => {
          const width = (segment.toFrame - segment.fromFrame + 1) * cell;
          const ease = segment.easeOut - segment.easeIn;
          return (
            <span key={`tween-${segment.left.id}`} className="cb-tween-span" style={{ left: `${segment.fromFrame * cell}px`, width: `${width}px`, paddingLeft: `${cell + 4}px`, paddingRight: `${cell + 4}px` }}
              title={`Tween · frames ${segment.fromFrame + 1}–${segment.toFrame + 1}${ease ? ` · ${ease < 0 ? `ease in ${-ease}` : `ease out ${ease}`}` : ""}`}>
              {width >= 150 ? (
                <>
                  <i className="cb-tween-arrow to-left" aria-hidden="true" />
                  <EaseControl value={ease} onCommit={(next) => handlers.setEase(layer.id, segment.left.id, next < 0 ? -next : 0, next > 0 ? next : 0)} />
                  <i className="cb-tween-arrow to-right" aria-hidden="true" />
                </>
              ) : width >= 40 ? <i className="cb-tween-arrow to-right" aria-hidden="true" /> : null}
            </span>
          );
        })}
        {selection && <span className="cb-frame-selection" style={{ left: `${selection.from * cell}px`, width: `${(selection.to - selection.from + 1) * cell}px` }} aria-hidden="true" />}
        {ghostFrame != null && <span className="cb-keyframe-ghost" style={{ left: `${ghostFrame * cell}px`, width: `${cell}px` }} aria-hidden="true"><i /></span>}
        {[...keyframes].map((frame) => (
          <span key={`key-${frame}`} className={`cb-keyframe-cell ${layer.type === "empty" ? "blank" : ""}`} style={{ left: `${frame * cell}px`, width: `${cell}px` }}
            title={layer.type === "empty" ? "Blank keyframe — add a character or object to fill this layer" : `Keyframe · frame ${frame + 1}`}>
            <i />
          </span>
        ))}
        {loopMarks.map((frame) => <b key={`loop-${frame}`} className="cb-loop-mark" style={{ left: `${frame * cell}px` }} aria-hidden="true" />)}
        {layer.type === "character" && (layer.animationClips || []).map((clip) => (
          <span key={clip.id} className={`cb-ai-action-clip cb-ai-action-${clip.type}`} style={{ left: `${clip.start * FPS * cell}px`, width: `${Math.max(cell, clip.duration * FPS * cell)}px` }} title={`${clip.label} · ${clip.start.toFixed(2)}s → ${(clip.start + clip.duration).toFixed(2)}s`}>{clip.label}</span>
        ))}
        {layer.type === "character" && layer.manualMotionRange && (() => {
          const motionStart = Math.max(0, layer.manualMotionRange!.start);
          const motionEnd = Math.max(motionStart, layer.manualMotionRange!.end);
          return <span className="cb-motion-range" style={{ left: `${motionStart * FPS * cell}px`, width: `${Math.max(cell, (motionEnd - motionStart) * FPS * cell)}px` }} title={`Motion Tween · ${motionStart.toFixed(2)}s → ${motionEnd.toFixed(2)}s`}><em>motion tween</em></span>;
        })()}
        {layer.type === "character" && Object.entries(layer.partKeyframes || {}).flatMap(([partKey, frames]) => frames.map((keyframe) => (
          <span key={`${partKey}-${keyframe.id}`} className="cb-part-keyframe-marker" style={{ left: `${(Math.round(keyframe.time * FPS) + 0.5) * cell}px` }} title={`${partKey} · frame ${Math.round(keyframe.time * FPS) + 1}`}>◇</span>
        )))}
      </div>
    </div>
  );
});

const FillerRows = memo(function FillerRows({ count, showHint }: { count: number; showHint: boolean }) {
  return (
    <>
      {Array.from({ length: count }, (_, index) => (
        <div key={`filler-${index}`} className="cb-timeline-row cb-filler-row" aria-hidden="true">
          <div className="cb-layer-name">{index === 0 && showHint ? <em className="cb-empty-hint" title="Add a character or background from the library, or press ＋ for an empty layer">Add from the library, or ＋</em> : null}</div>
          <div className="cb-track-lane" />
        </div>
      ))}
    </>
  );
});

/** Frame View (− slider + ⟳). Memoized: it must not re-render on every playback frame, or the
 *  browser keeps rebuilding the slider (visible as flicker). */
const FrameViewControl = memo(function FrameViewControl({ zoom, setZoom }: { zoom: number; setZoom: (update: (value: number) => number) => void }) {
  return (
    <div className="cb-frame-view">
      Frame View
      <button type="button" onClick={() => setZoom((value) => Math.max(1, value - 8))} aria-label="Narrower frames">−</button>
      <input type="range" min="1" max="100" value={zoom} onChange={(event) => { const next = Number(event.target.value); setZoom(() => next); }} aria-label="Frame width" />
      <button type="button" onClick={() => setZoom((value) => Math.min(100, value + 8))} aria-label="Wider frames">＋</button>
      <button type="button" className="cb-frame-view-reset" onClick={() => setZoom(() => DEFAULT_ZOOM)} title="Reset frame width" aria-label="Reset frame width">⟳</button>
    </div>
  );
});

type DragState = {
  layerId: string;
  mode: "move" | "resize-start" | "resize-end" | "keyframe" | "select";
  originX: number;
  startFrame: number;
  endFrame: number;
  active: boolean;
  pressedFrame: number;
  /** Keyframe drags: the frame it would land on. */
  targetFrame?: number;
  /** Move: each selected layer with content, where its content started, and the frames moved so far. */
  moves?: Array<{ id: string; startFrame: number }>;
  carried?: { layerIds: string[]; from: number; to: number };
  delta?: number;
  /** Select (drag across frames): the lane and row pressed, and the last cell reached. */
  lane?: HTMLElement;
  anchorRow?: number;
  lastCell?: string;
};

export default function Timeline({ layers, selectedObjectId, isPlaying, playhead, activeDuration, onSelectLayer, onPlay, onSeek, onReorderLayer, onDeleteLayer, onUpdateLayerTiming, onToggleLayerLoop, sourceDurations = {}, onClipDragChange, frameSelection = null, onSelectFrames, onFrameAction, onAddLayer, onToggleLayerHidden, onToggleLayerLocked, onMoveKeyframe, onSetTweenEase }: Props) {
  const frameCount = Math.max(1, Math.ceil(activeDuration * FPS - 1e-6));
  const lastFrame = frameCount - 1;
  const playheadFrame = Math.max(0, Math.min(lastFrame, Math.floor(playhead * FPS + 1e-6)));
  const selectedLayer = layers.find((layer) => layer.id === selectedObjectId) || null;
  const timelineLayers = useMemo(() => [...layers].reverse(), [layers]);
  const [draggingLayerId, setDraggingLayerId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [timelineZoom, setTimelineZoom] = useState(DEFAULT_ZOOM);
  const [layerPanelWidth, setLayerPanelWidth] = useState(210);
  const [viewWidth, setViewWidth] = useState(800);
  const [viewHeight, setViewHeight] = useState(200);
  const [menu, setMenu] = useState<{ x: number; y: number; layerIds: string[]; from: number; to: number } | null>(null);
  const [keyframeGhost, setKeyframeGhost] = useState<{ layerId: string; frame: number } | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [menuPosition, setMenuPosition] = useState<{ left: number; top: number } | null>(null);
  const tracksRef = useRef<HTMLDivElement | null>(null);

  // Frame grid geometry (Animate): fixed-width frame cells; empty cells continue past the last
  // frame so a keyframe can be added there, but the playhead never goes past the last frame.
  const cell = cellWidthFor(timelineZoom);
  const cells = Math.max(frameCount + FPS, Math.ceil(viewWidth / cell) + 1);
  const laneWidth = cells * cell;
  const labelStep = cell >= 8 ? 5 : cell >= 5 ? 10 : 30;
  const labels = useMemo(() => {
    const result: Array<{ frame: number; text: string; second: boolean }> = [];
    for (let frame = labelStep; frame <= cells; frame += labelStep) result.push({ frame, text: frame % FPS === 0 ? `${frame / FPS}s` : String(frame), second: frame % FPS === 0 });
    for (let frame = FPS; frame <= cells; frame += FPS) if (frame % labelStep !== 0) result.push({ frame, text: `${frame / FPS}s`, second: true });
    return result;
  }, [cells, labelStep]);

  useEffect(() => {
    const tracks = tracksRef.current;
    if (!tracks) return;
    const measure = () => {
      setViewWidth(Math.max(100, tracks.clientWidth - layerPanelWidth));
      setViewHeight(tracks.clientHeight);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(tracks);
    return () => observer.disconnect();
  }, [layerPanelWidth]);

  // Keep the playhead in view while playing, stepping or zooming (pages like Animate).
  useEffect(() => {
    const tracks = tracksRef.current;
    if (!tracks) return;
    const x = layerPanelWidth + playheadFrame * cell;
    const visibleLeft = tracks.scrollLeft + layerPanelWidth;
    const visibleRight = tracks.scrollLeft + tracks.clientWidth;
    if (x < visibleLeft || x + cell > visibleRight) tracks.scrollLeft = Math.max(0, x - layerPanelWidth - cell * 2);
  }, [cell, layerPanelWidth, playheadFrame]);

  // The frame menu opens upward from the pointer (towards the canvas); near the top of the
  // window it opens downward instead, and it always stays inside the window.
  useLayoutEffect(() => {
    if (!menu || !menuRef.current) { setMenuPosition(null); return; }
    const rect = menuRef.current.getBoundingClientRect();
    const above = menu.y - rect.height - 4;
    const top = above >= 8 ? above : Math.max(8, Math.min(menu.y + 4, window.innerHeight - rect.height - 8));
    const left = Math.max(8, Math.min(menu.x, window.innerWidth - rect.width - 8));
    setMenuPosition({ left, top });
  }, [menu]);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", close);
    window.addEventListener("blur", close);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", close);
      window.removeEventListener("blur", close);
    };
  }, [menu]);

  const beginLayerPanelResize = (event: ReactMouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = layerPanelWidth;
    const move = (moveEvent: MouseEvent) => setLayerPanelWidth(Math.max(150, Math.min(420, startWidth + moveEvent.clientX - startX)));
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up, { once: true });
  };

  const frameAt = (clientX: number, element: HTMLElement) => Math.max(0, Math.floor((clientX - element.getBoundingClientRect().left) / cell));
  // Moving the playhead (transport, ruler, playback) ends the frame selection (Animate).
  const clearFrameSelection = () => { if (frameSelection) onSelectFrames?.(null); };
  const goToFrame = (frame: number) => {
    const target = Math.max(0, Math.min(lastFrame, frame));
    clearFrameSelection();
    onSeek(target / FPS);
  };

  // Drag along the ruler to scrub; the playhead stays between the first and last frame.
  const beginScrub = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault(); // a scrub must never start a text selection
    clearFrameSelection();
    const ruler = event.currentTarget;
    const seek = (clientX: number) => onSeek(Math.min(lastFrame, frameAt(clientX, ruler)) / FPS);
    seek(event.clientX);
    const releaseSelection = blockTextSelection();
    const move = (moveEvent: PointerEvent) => seek(moveEvent.clientX);
    const up = () => {
      releaseSelection();
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  /** A block of frames: rows anchorRow..row (top to bottom), frames a..b in either order. */
  const blockSelection = (anchorRow: number, row: number, a: number, b: number): FrameSelection => {
    const ids = timelineLayers.slice(Math.min(anchorRow, row), Math.max(anchorRow, row) + 1).map((item) => item.id);
    const anchorId = timelineLayers[anchorRow]?.id;
    if (!anchorId) return null;
    return { layerId: anchorId, ...(ids.length > 1 ? { layerIds: ids } : {}), from: Math.max(0, Math.min(a, b)), to: Math.max(0, a, b) };
  };

  // Pressing on frames (Animate): drag across frames — and up or down across layers — to select
  // them; Shift+click extends the selection. Dragging frames that are already selected moves
  // that content; a keyframe drags to another frame; the span's edge handles trim or extend it.
  const beginLanePress = (event: ReactPointerEvent<HTMLDivElement>, layer: EditorObject) => {
    if (event.button !== 0) return;
    if ((event.target as HTMLElement).closest(".cb-ease-box, .cb-ease-input")) return;
    event.preventDefault();
    const lane = event.currentTarget;
    const frame = frameAt(event.clientX, lane);
    const row = timelineLayers.findIndex((item) => item.id === layer.id);
    if (event.shiftKey && frameSelection) {
      const anchorRow = timelineLayers.findIndex((item) => item.id === frameSelection.layerId);
      if (anchorRow >= 0) { onSelectFrames?.(blockSelection(anchorRow, row, frameSelection.from, frame)); return; }
    }
    const span = layerSpan(layer, lastFrame);
    const base = { layerId: layer.id, originX: event.clientX, startFrame: span.startFrame, endFrame: span.endFrame, pressedFrame: frame };
    const handle = (event.target as HTMLElement).closest<HTMLElement>(".cb-span-handle");
    if (handle && layer.type !== "empty") {
      setDrag({ ...base, mode: handle.classList.contains("left") ? "resize-start" : "resize-end", active: true });
      onClipDragChange?.(true);
      return;
    }
    const selectedIds = selectionLayerIds(frameSelection);
    const inSelection = Boolean(frameSelection && selectedIds.includes(layer.id) && frame >= frameSelection.from && frame <= frameSelection.to);
    const multiCell = Boolean(frameSelection && (selectedIds.length > 1 || frameSelection.to > frameSelection.from));
    const insideContent = layer.type !== "empty" && frame >= span.startFrame && frame <= span.endFrame;
    const onKeyframe = sortedKeys(layer).some((key) => frameOfTime(key.time) === frame);
    const startMove = () => {
      const moves = (inSelection ? selectedIds : [layer.id])
        .map((id) => layers.find((item) => item.id === id))
        .filter((item): item is EditorObject => Boolean(item && item.type !== "empty"))
        .map((item) => ({ id: item.id, startFrame: layerSpan(item, lastFrame).startFrame }));
      const carried = frameSelection && inSelection ? { layerIds: selectedIds, from: frameSelection.from, to: frameSelection.to } : undefined;
      setDrag({ ...base, mode: "move", active: false, moves, carried, delta: 0 });
    };
    // A block of selected frames moves together, keyframes included.
    if (inSelection && multiCell && insideContent) { startMove(); return; }
    // Press on a keyframe: drag it to another frame (a click still just selects the frame).
    if (onKeyframe) {
      setDrag({ ...base, mode: "keyframe", active: false, targetFrame: frame });
      return;
    }
    // The span's first cell is its start keyframe: dragging it trims or extends the start.
    if (layer.type !== "empty" && frame === span.startFrame) {
      setDrag({ ...base, mode: "resize-start", active: false });
      return;
    }
    if (inSelection && insideContent) { startMove(); return; }
    onSelectFrames?.({ layerId: layer.id, from: frame, to: frame });
    setDrag({ ...base, mode: "select", active: false, lane, anchorRow: row, lastCell: `${row}:${frame}` });
  };

  // Double-click on content selects the whole span (Animate).
  const selectLayerSpan = (event: ReactMouseEvent<HTMLDivElement>, layer: EditorObject) => {
    if ((event.target as HTMLElement).closest(".cb-ease-box, .cb-ease-input") || layer.type === "empty") return;
    const frame = frameAt(event.clientX, event.currentTarget);
    const span = layerSpan(layer, lastFrame);
    if (frame < span.startFrame || frame > span.endFrame) return;
    onSelectFrames?.({ layerId: layer.id, from: span.startFrame, to: span.endFrame });
  };

  useEffect(() => {
    if (!drag) return;
    const releaseSelection = blockTextSelection();
    const handleMove = (event: PointerEvent) => {
      if (drag.mode === "select") {
        const tracks = tracksRef.current;
        if (!tracks || !drag.lane) return;
        // Scroll the frame grid when the pointer runs past its edges.
        const box = tracks.getBoundingClientRect();
        if (event.clientX > box.right - 16) tracks.scrollLeft += cell;
        else if (event.clientX < box.left + layerPanelWidth + 16 && tracks.scrollLeft > 0) tracks.scrollLeft -= cell;
        if (event.clientY > box.bottom - 12) tracks.scrollTop += ROW_HEIGHT / 2;
        else if (event.clientY < box.top + RULER_HEIGHT + 12 && tracks.scrollTop > 0) tracks.scrollTop -= ROW_HEIGHT / 2;
        const frame = Math.min(cells - 1, frameAt(event.clientX, drag.lane));
        const rows = [...tracks.querySelectorAll<HTMLElement>(".cb-timeline-row:not(.cb-filler-row)")];
        let row = rows.findIndex((element) => { const rect = element.getBoundingClientRect(); return event.clientY >= rect.top && event.clientY < rect.bottom; });
        if (row < 0) row = rows.length && event.clientY < rows[0].getBoundingClientRect().top ? 0 : Math.max(0, rows.length - 1);
        const cellKey = `${row}:${frame}`;
        if (cellKey === drag.lastCell) return;
        drag.lastCell = cellKey;
        drag.active = true;
        onSelectFrames?.(blockSelection(drag.anchorRow ?? row, row, drag.pressedFrame, frame));
        return;
      }
      const dx = event.clientX - drag.originX;
      if (!drag.active) {
        if (Math.abs(dx) < 4) return;
        drag.active = true;
        if (drag.mode !== "keyframe") onClipDragChange?.(true);
      }
      const delta = Math.round(dx / cell);
      if (drag.mode === "keyframe") {
        drag.targetFrame = Math.max(0, drag.pressedFrame + delta);
        setKeyframeGhost({ layerId: drag.layerId, frame: drag.targetFrame });
      } else if (drag.mode === "move") {
        // Everything moves by the same number of frames, and nothing goes before frame 1.
        const earliest = Math.min(...(drag.moves || []).map((item) => item.startFrame), drag.carried ? drag.carried.from : Infinity);
        const shift = Math.max(-earliest, delta);
        if (shift === drag.delta) return;
        drag.delta = shift;
        for (const item of drag.moves || []) onUpdateLayerTiming?.(item.id, { startTime: (item.startFrame + shift) / FPS });
      } else if (drag.mode === "resize-start") {
        const startFrame = Math.max(0, Math.min(drag.endFrame, drag.startFrame + delta));
        onUpdateLayerTiming?.(drag.layerId, { startTime: startFrame / FPS, actionDurationMs: ((drag.endFrame - startFrame + 1) / FPS) * 1000 });
      } else {
        const endFrame = Math.max(drag.startFrame, drag.endFrame + delta);
        onUpdateLayerTiming?.(drag.layerId, { actionDurationMs: ((endFrame - drag.startFrame + 1) / FPS) * 1000 });
      }
    };
    const handleUp = () => {
      if (drag.mode === "keyframe") {
        setKeyframeGhost(null);
        if (drag.active && drag.targetFrame != null && drag.targetFrame !== drag.pressedFrame) {
          onMoveKeyframe?.(drag.layerId, drag.pressedFrame, drag.targetFrame);
          onSelectFrames?.({ layerId: drag.layerId, from: drag.targetFrame, to: drag.targetFrame });
        } else onSelectFrames?.({ layerId: drag.layerId, from: drag.pressedFrame, to: drag.pressedFrame });
      } else if (drag.mode === "select") {
        // The selection was updated while dragging.
      } else if (drag.mode === "move" && drag.active) {
        onClipDragChange?.(false);
        // The selection travels with the moved frames.
        const carried = drag.carried;
        const shift = drag.delta || 0;
        if (carried) onSelectFrames?.({ layerId: drag.layerId, ...(carried.layerIds.length > 1 ? { layerIds: carried.layerIds } : {}), from: carried.from + shift, to: carried.to + shift });
      } else if (drag.active) onClipDragChange?.(false);
      else onSelectFrames?.({ layerId: drag.layerId, from: drag.pressedFrame, to: drag.pressedFrame });
      setDrag(null);
    };
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp, { once: true });
    return () => {
      releaseSelection();
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cell, cells, drag, layerPanelWidth, onClipDragChange, onMoveKeyframe, onSelectFrames, onUpdateLayerTiming, timelineLayers]);

  // Right-click inside the selection keeps it (the menu acts on every selected layer).
  const openMenu = (event: ReactMouseEvent<HTMLDivElement>, layer: EditorObject) => {
    event.preventDefault();
    const frame = frameAt(event.clientX, event.currentTarget);
    const keep = Boolean(frameSelection && selectionLayerIds(frameSelection).includes(layer.id) && frame >= frameSelection.from && frame <= frameSelection.to);
    const selection = keep && frameSelection ? frameSelection : { layerId: layer.id, from: frame, to: frame };
    if (!keep) onSelectFrames?.(selection);
    setMenu({ x: event.clientX, y: event.clientY, layerIds: selectionLayerIds(selection), from: selection.from, to: selection.to });
  };

  const startLayerDrag = (event: ReactDragEvent<HTMLElement>, layerId: string) => {
    setDraggingLayerId(layerId);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", layerId);
  };

  const dropLayer = (event: ReactDragEvent<HTMLElement>, targetId: string) => {
    event.preventDefault();
    const draggedId = draggingLayerId || event.dataTransfer.getData("text/plain");
    setDraggingLayerId(null);
    setDropTargetId(null);
    if (!draggedId || draggedId === targetId) return;
    onReorderLayer?.(draggedId, targetId);
  };

  // Menu items are available when they apply to at least one of the selected layers.
  const menuLayers = menu ? menu.layerIds.map((id) => layers.find((layer) => layer.id === id)).filter((layer): layer is EditorObject => Boolean(layer)) : [];
  const menuHasKeyframe = Boolean(menu && menuLayers.some((layer) => layer.type === "character" && (layer.keyframes || []).some((keyframe) => {
    const frame = Math.round(keyframe.time * FPS);
    return frame >= menu.from && frame <= menu.to;
  })));
  const menuSegments = menu ? menuLayers.map((layer) => {
    const keys = sortedKeys(layer);
    const left = [...keys].reverse().find((key) => frameOfTime(key.time) <= menu.from);
    const right = keys.find((key) => frameOfTime(key.time) > menu.from);
    return left && right ? { tweened: left.tween !== false } : null;
  }) : [];
  const menuCanTween = menuSegments.some((segment) => segment && !segment.tweened);
  const menuCanRemoveTween = menuSegments.some((segment) => segment?.tweened);
  const runMenu = (action: FrameAction) => {
    if (menu) onFrameAction?.(action, menu.layerIds, menu.from, menu.to);
    setMenu(null);
  };

  // Rows get one stable handler object (calling the latest implementations), so memoized rows
  // don't redraw on every playback frame.
  const latestRef = useRef({ beginLanePress, selectLayerSpan, openMenu, startLayerDrag, dropLayer, onSelectLayer, onDeleteLayer, onToggleLayerLoop, onToggleLayerHidden, onToggleLayerLocked, onSetTweenEase });
  latestRef.current = { beginLanePress, selectLayerSpan, openMenu, startLayerDrag, dropLayer, onSelectLayer, onDeleteLayer, onToggleLayerLoop, onToggleLayerHidden, onToggleLayerLocked, onSetTweenEase };
  const rowHandlers = useMemo<RowHandlers>(() => ({
    lanePress: (event, layer) => latestRef.current.beginLanePress(event, layer),
    laneDoubleClick: (event, layer) => latestRef.current.selectLayerSpan(event, layer),
    contextMenu: (event, layer) => latestRef.current.openMenu(event, layer),
    selectLayer: (id) => latestRef.current.onSelectLayer(id),
    deleteLayer: (id) => latestRef.current.onDeleteLayer?.(id),
    toggleLoop: (id) => latestRef.current.onToggleLayerLoop?.(id),
    toggleHidden: (id) => latestRef.current.onToggleLayerHidden?.(id),
    toggleLocked: (id) => latestRef.current.onToggleLayerLocked?.(id),
    dragStart: (event, id) => latestRef.current.startLayerDrag(event, id),
    dragEnd: () => { setDraggingLayerId(null); setDropTargetId(null); },
    dragOver: (id) => setDropTargetId(id),
    dragLeave: (id) => setDropTargetId((current) => (current === id ? null : current)),
    drop: (event, id) => latestRef.current.dropLayer(event, id),
    setEase: (layerId, keyframeId, easeIn, easeOut) => latestRef.current.onSetTweenEase?.(layerId, keyframeId, easeIn, easeOut),
  }), []);
  const selectedFrameLayers = useMemo(() => new Set(selectionLayerIds(frameSelection)), [frameSelection]);
  const fillerCount = Math.max(1, Math.ceil((viewHeight - RULER_HEIGHT) / ROW_HEIGHT) - timelineLayers.length);
  const playheadX = layerPanelWidth + playheadFrame * cell + cell / 2 - 1;

  return (
    <section className="cb-timeline cb-frame-timeline" style={{ ["--cb-layer-panel-width" as string]: `${layerPanelWidth}px`, ["--cb-cell" as string]: `${cell}px`, ["--cb-lane-width" as string]: `${laneWidth}px` }}>
      <div className="cb-timeline-toolbar">
        <div className="cb-timeline-left-title"><strong>Layers</strong><span>{FPS.toFixed(2)}FPS</span></div>
        <FrameViewControl zoom={timelineZoom} setZoom={setTimelineZoom} />
        <div className="cb-transport">
          <div className="cb-transport-core">
            <button className="icon" onClick={() => goToFrame(0)} title="First frame" aria-label="First frame"><TransportIcon kind="first" /></button>
            <button className="icon" onClick={() => goToFrame(playheadFrame - 1)} title="Previous frame (,)" aria-label="Previous frame"><TransportIcon kind="prev" /></button>
            <button className="play" onClick={() => { clearFrameSelection(); onPlay(); }} title="Play / Stop (Enter)" aria-label={isPlaying ? "Pause" : "Play"}><TransportIcon kind={isPlaying ? "pause" : "play"} /></button>
            <button className="icon" onClick={() => goToFrame(playheadFrame + 1)} title="Next frame (.)" aria-label="Next frame"><TransportIcon kind="next" /></button>
            <button className="icon" onClick={() => goToFrame(lastFrame)} title="Last frame" aria-label="Last frame"><TransportIcon kind="last" /></button>
          </div>
        </div>
      </div>

      <div className="cb-layer-panel-resizer" style={{ left: `${layerPanelWidth - 3}px` }} onMouseDown={beginLayerPanelResize} title="Drag left/right to resize Layers panel" />

      <div className="cb-timeline-tracks" ref={tracksRef}>
        <div className="cb-timeline-ruler-grid">
          <div className="cb-layer-tools">
            <button type="button" title="Layer menu" aria-label="Layer menu"><ToolIcon kind="menu" /></button>
            <button type="button" title="Project files" aria-label="Project files"><ToolIcon kind="folder" /></button>
            <button type="button" title="New layer (empty, with a blank keyframe)" aria-label="New layer" onClick={onAddLayer}><ToolIcon kind="add" /></button>
            <button type="button" className={selectedLayer?.hidden ? "active" : ""} title="Hide / show the selected layer in the editor" aria-label="Hide layer" aria-pressed={Boolean(selectedLayer?.hidden)} disabled={!selectedLayer} onClick={() => selectedLayer && onToggleLayerHidden?.(selectedLayer.id)}><ToolIcon kind="hide" /></button>
            <button type="button" className={selectedLayer?.locked ? "active" : ""} title="Lock / unlock the selected layer" aria-label="Lock layer" aria-pressed={Boolean(selectedLayer?.locked)} disabled={!selectedLayer} onClick={() => selectedLayer && onToggleLayerLocked?.(selectedLayer.id)}><ToolIcon kind="lock" /></button>
            <button type="button" title="Remove the selected layer from the scene (the library keeps it)" aria-label="Remove layer" onClick={() => selectedLayer && onDeleteLayer?.(selectedLayer.id)} disabled={!selectedLayer}><ToolIcon kind="trash" /></button>
          </div>
          <div className="cb-frame-ruler" onPointerDown={beginScrub} onMouseDown={(event) => event.preventDefault()} role="slider" aria-label="Timeline ruler — click or drag to move the playhead" aria-valuemin={1} aria-valuemax={frameCount} aria-valuenow={playheadFrame + 1}>
            {labels.map((label) => (
              <span key={`${label.frame}-${label.text}`} className={label.second ? "second" : ""} style={{ left: `${(label.frame - 1) * cell + cell / 2}px` }}>{label.text}</span>
            ))}
            {labels.filter((label) => label.second).map((label) => <b key={`tab-${label.frame}`} className="cb-second-tab" style={{ left: `${(label.frame - 1) * cell}px`, width: `${cell}px` }} aria-hidden="true" />)}
            <i className="cb-ruler-head" style={{ transform: `translateX(${playheadFrame * cell}px)`, width: `${cell}px` }} />
          </div>
        </div>

        {timelineLayers.map((layer, displayIndex) => (
          <LayerRow
            key={layer.id}
            layer={layer}
            displayIndex={displayIndex}
            cell={cell}
            lastFrame={lastFrame}
            selected={selectedObjectId === layer.id}
            dragging={draggingLayerId === layer.id}
            dropTarget={dropTargetId === layer.id}
            selection={selectedFrameLayers.has(layer.id) ? frameSelection : null}
            ghostFrame={keyframeGhost?.layerId === layer.id ? keyframeGhost.frame : null}
            spanEditing={Boolean(drag?.active && drag.mode !== "select" && (drag.mode === "move" ? drag.moves?.some((item) => item.id === layer.id) : drag.layerId === layer.id))}
            loopLength={sourceDurations[layer.id] ? Math.round(sourceDurations[layer.id] * FPS) : 0}
            handlers={rowHandlers}
          />
        ))}
        {/* empty rows fill the panel so the frame grid runs to the bottom (Animate) */}
        <FillerRows count={fillerCount} showHint={timelineLayers.length === 0} />
        {/* one playhead line over every row, moved on the GPU (no row redraws while playing) */}
        <i className="cb-playhead-line" aria-hidden="true" style={{ height: `${(timelineLayers.length + fillerCount) * ROW_HEIGHT}px`, transform: `translateX(${playheadX}px)` }} />
      </div>

      {menu && (
        <div ref={menuRef} className="cb-frame-menu" role="menu" style={{ left: `${menuPosition?.left ?? menu.x}px`, top: `${menuPosition?.top ?? menu.y}px`, visibility: menuPosition ? "visible" : "hidden" }} onPointerDown={(event) => event.stopPropagation()}>
          <button type="button" role="menuitem" onClick={() => runMenu("keyframe")}>Insert Keyframe<kbd>K / F6</kbd></button>
          <button type="button" role="menuitem" onClick={() => runMenu("blank")}>Insert Blank Keyframe<kbd>F7</kbd></button>
          <button type="button" role="menuitem" onClick={() => runMenu("insert-frame")}>Insert Frame<kbd>F5</kbd></button>
          <button type="button" role="menuitem" onClick={() => runMenu("remove-frames")}>Remove Frames<kbd>⇧F5</kbd></button>
          <button type="button" role="menuitem" disabled={!menuHasKeyframe} onClick={() => runMenu("clear-keyframe")}>Clear Keyframe<kbd>⇧F6</kbd></button>
          <span className="cb-frame-menu-sep" aria-hidden="true" />
          <button type="button" role="menuitem" disabled={!menuCanTween} onClick={() => runMenu("tween")}>Create Tween<kbd>⇧M</kbd></button>
          <button type="button" role="menuitem" disabled={!menuCanRemoveTween} onClick={() => runMenu("remove-tween")}>Remove Tween<kbd>⌥⇧M</kbd></button>
        </div>
      )}
    </section>
  );
}
