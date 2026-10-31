"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";

/**
 * A character's own Animate timeline (step inside a character; view only). Shown in place of the
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

const CELL = 11;
const ROW = 26;
const LAYER_PANEL = 230;
const short = (name: string) => name.split("/").pop() || name;

const easeText = (ease: FlaFrame["ease"]) =>
  ease == null ? "" : ease === "custom" ? "custom ease" : typeof ease === "number" ? (ease < 0 ? `ease in ${-ease}` : `ease out ${ease}`) : `ease ${ease}`;
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

export default function SymbolTimeline({ crumbs, symbol, frame, playing, hidden, onSeek, onPlay, onToggleLayer, onCrumb, onStepInto }: {
  /** Scene › character › … › this symbol; clicking one steps back out to it. */
  crumbs: string[];
  symbol: FlaSymbol;
  frame: number;
  playing: boolean;
  /** Layers hidden with the eye (indexes into symbol.layers). */
  hidden: Set<number>;
  onSeek: (frame: number) => void;
  onPlay: () => void;
  onToggleLayer: (index: number) => void;
  onCrumb: (index: number) => void;
  onStepInto: (layerIndex: number, frame: number, js: string) => void;
}) {
  const [closed, setClosed] = useState<Set<number>>(new Set());
  const scrollRef = useRef<HTMLDivElement>(null);
  const last = Math.max(0, symbol.frames - 1);
  const cells = symbol.frames + 12;

  // Folder nesting (Animate's parentLayerIndex): a layer's depth, and whether a closed folder hides it.
  const rows = useMemo(() => symbol.layers.map((layer, index) => {
    let depth = 0;
    let folded = false;
    for (let parent = layer.parent; parent != null && depth < 20; parent = symbol.layers[parent]?.parent) {
      if (symbol.layers[parent]?.type === "folder") { depth += 1; if (closed.has(parent)) folded = true; }
    }
    // A masked / guided layer sits indented under its mask or guide.
    if (layer.parent != null && ["mask", "guide"].includes(symbol.layers[layer.parent]?.type)) depth += 1;
    return { layer, index, depth, folded };
  }).filter((row) => !row.folded), [closed, symbol.layers]);
  const hiddenByFolder = (index: number) => {
    for (let parent = symbol.layers[index]?.parent; parent != null; parent = symbol.layers[parent]?.parent) if (hidden.has(parent)) return true;
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
  const labels = Array.from({ length: Math.floor(cells / 5) }, (_, index) => (index + 1) * 5);

  return (
    <section className="cb-symbol-timeline" style={{ ["--cb-sym-cell" as string]: `${CELL}px`, ["--cb-sym-row" as string]: `${ROW}px`, ["--cb-sym-panel" as string]: `${LAYER_PANEL}px` }}>
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
        <span className="cb-symbol-note" title="Inside a character you can look at its layers and keyframes; editing them comes later">View only</span>
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
      <div className="cb-symbol-grid" ref={scrollRef}>
        <div className="cb-symbol-head">
          <div className="cb-symbol-head-name">{symbol.layers.length} layers · {short(symbol.name)}</div>
          <div className="cb-symbol-ruler" style={{ width: cells * CELL }} onPointerDown={scrub} role="slider" aria-label="Frame" aria-valuemin={1} aria-valuemax={symbol.frames} aria-valuenow={frame + 1}>
            {labels.map((label) => <span key={label} style={{ left: (label - 1) * CELL + CELL / 2 }}>{label}</span>)}
            <i className="cb-symbol-end" style={{ left: symbol.frames * CELL }} aria-hidden="true" />
            <b className="cb-symbol-ruler-head" style={{ left: frame * CELL, width: CELL }} aria-hidden="true" />
          </div>
        </div>
        {rows.map(({ layer, index, depth }) => {
          const shown = !hidden.has(index) && !hiddenByFolder(index);
          return (
            <div key={index} className={`cb-symbol-row ${shown ? "" : "is-hidden"} ${layer.type === "folder" ? "is-folder" : ""}`}>
              <div className="cb-symbol-layer" style={{ paddingLeft: 6 + depth * 14 }} title={`${layer.name}${layer.type !== "normal" ? ` (${layer.type} layer)` : ""}${layer.hidden ? " · hidden in Animate" : ""}${layer.locked ? " · locked in Animate" : ""}`}>
                {layer.type === "folder"
                  ? <button type="button" className="cb-symbol-fold" onClick={() => setClosed((current) => { const next = new Set(current); if (next.has(index)) next.delete(index); else next.add(index); return next; })} aria-label={closed.has(index) ? `Open ${layer.name}` : `Close ${layer.name}`} aria-expanded={!closed.has(index)}><LayerIcon type="folder" open={!closed.has(index)} /></button>
                  : <span className="cb-symbol-type"><LayerIcon type={layer.type} open /></span>}
                <span className="cb-symbol-layer-name">{layer.name}</span>
                {layer.color && <i className="cb-symbol-swatch" style={{ borderColor: layer.color }} aria-hidden="true" />}
                <button type="button" className={`cb-symbol-eye ${shown ? "" : "off"}`} onClick={() => onToggleLayer(index)} aria-pressed={!shown}
                  aria-label={`${shown ? "Hide" : "Show"} ${layer.name}`} title={`${shown ? "Hide" : "Show"} this layer on the stage (not saved)`}><EyeIcon shown={shown} /></button>
              </div>
              <div className="cb-symbol-lane" style={{ width: cells * CELL }} onPointerDown={scrub}
                onDoubleClick={(event) => {
                  const at = frameAt(event.clientX, event.currentTarget);
                  const keyframe = layer.frames.find((item) => at >= item.i && at < item.i + item.d);
                  const target = keyframe?.symbols?.find((item) => item.js);
                  if (target?.js) onStepInto(index, at, target.js);
                }}>
                {layer.type !== "folder" && layer.frames.map((item) => {
                  const kind = item.tween === "classic" || item.tween === "motion" ? "classic" : item.tween === "shape" ? "shape" : item.blank ? "blank" : "frames";
                  const info = `Frame ${item.i + 1}${item.d > 1 ? `–${item.i + item.d}` : ""}${item.tween ? ` · ${item.tween} tween${item.ease != null ? `, ${easeText(item.ease)}` : ""}` : ""}${item.blank ? " · blank keyframe" : holds(item) ? ` · ${holds(item)}` : ""}${item.symbols?.some((symbolItem) => symbolItem.js) ? " · double-click to step inside" : ""}`;
                  return (
                    <span key={item.i} className={`cb-symbol-span ${kind}`} style={{ left: item.i * CELL, width: item.d * CELL }} title={info}>
                      <i className={`cb-symbol-key ${item.blank ? "blank" : ""}`} aria-hidden="true" />
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
        <i className="cb-symbol-playhead" style={{ left: LAYER_PANEL + frame * CELL + CELL / 2 - 1 }} aria-hidden="true" />
      </div>
    </section>
  );
}
