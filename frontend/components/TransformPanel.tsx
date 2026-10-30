"use client";

import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

/**
 * Illustrator's Transform panel: registration point, X / Y, W / H (linked or not), rotation and
 * skew of the selected layer or part. Not modal: it stays open and follows the selection. Dragged by
 * its header (DialogDragManager), it first opens in the middle of the canvas.
 */
export type TransformField = "x" | "y" | "w" | "h" | "rotation" | "skew";
export type TransformValues = Record<TransformField, number>;
export type TransformReading = {
  values: TransformValues;
  /** "part": X / Y move the part, W / H are % of its own size. */
  mode: "layer" | "part";
  /** What the panel works on, e.g. "Sardar" or "Sardar › Head". */
  targetLabel: string;
  /** Scale Strokes & Effects applies (whole characters). */
  scaleStrokesAvailable: boolean;
};

type Props = {
  /** The selection's current values; null when nothing transformable is selected. Read again
   *  after each change and a few times a second (a character's artwork box arrives later). */
  read: () => TransformReading | null;
  reference: { rx: number; ry: number };
  onReference: (rx: number, ry: number) => void;
  linked: boolean;
  onLinked: (linked: boolean) => void;
  scaleStrokes: boolean;
  onScaleStrokes: (value: boolean) => void;
  onChange: (field: TransformField, value: number) => void;
  onClose: () => void;
  shortcut: string;
};

const ANGLES = [-180, -135, -90, -45, -30, 0, 30, 45, 90, 135, 180];
const SKEWS = [-60, -45, -30, -15, 0, 15, 30, 45, 60];
const round = (value: number, digits = 2) => Math.round(value * 10 ** digits) / 10 ** digits;
const parse = (text: string) => { const value = parseFloat(String(text).replace(",", ".").replace(/[^\d.+-]/g, "")); return Number.isFinite(value) ? value : null; };

function NumberField({ label, value, unit, disabled, onCommit, ariaLabel }: { label?: string; value: number | null; unit: string; disabled: boolean; onCommit: (value: number) => void; ariaLabel: string }) {
  const [text, setText] = useState("");
  const [editing, setEditing] = useState(false);
  useEffect(() => { if (!editing) setText(value == null ? "" : `${round(value)} ${unit}`.trim()); }, [editing, unit, value]);
  const commit = () => { const next = parse(text); setEditing(false); if (next != null && value != null && Math.abs(next - value) > 1e-6) onCommit(next); };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    // Enter leaves the field, which applies it once (onBlur); Cmd+Z then undoes the change, not the typing.
    if (event.key === "Enter") { event.preventDefault(); (event.target as HTMLInputElement).blur(); }
    else if (event.key === "Escape") { setEditing(false); (event.target as HTMLInputElement).blur(); }
    else if ((event.key === "ArrowUp" || event.key === "ArrowDown") && value != null) {
      event.preventDefault();
      const step = (event.shiftKey ? 10 : 1) * (event.key === "ArrowUp" ? 1 : -1);
      const base = parse(text) ?? value;
      setEditing(false);
      onCommit(base + step);
    }
  };
  return (
    <label className="cb-tf-field">
      {label && <span>{label}</span>}
      <input type="text" inputMode="decimal" aria-label={ariaLabel} disabled={disabled} value={text}
        onFocus={(event) => { setEditing(true); event.target.select(); }} onChange={(event) => { setEditing(true); setText(event.target.value); }}
        onBlur={commit} onKeyDown={onKeyDown} />
    </label>
  );
}

function AngleField({ icon, value, presets, disabled, onCommit, ariaLabel }: { icon: ReactNode; value: number | null; presets: number[]; disabled: boolean; onCommit: (value: number) => void; ariaLabel: string }) {
  return (
    <div className="cb-tf-angle">
      <span className="cb-tf-angle-icon" aria-hidden="true">{icon}</span>
      <span className="cb-tf-stepper">
        <button type="button" aria-label={`${ariaLabel} +1°`} disabled={disabled} onClick={() => value != null && onCommit(value + 1)}><svg viewBox="0 0 10 6" aria-hidden="true"><path d="M1 5l4-4 4 4" fill="none" stroke="currentColor" strokeWidth="1.3" /></svg></button>
        <button type="button" aria-label={`${ariaLabel} −1°`} disabled={disabled} onClick={() => value != null && onCommit(value - 1)}><svg viewBox="0 0 10 6" aria-hidden="true"><path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.3" /></svg></button>
      </span>
      <NumberField value={value} unit="°" disabled={disabled} onCommit={onCommit} ariaLabel={ariaLabel} />
      <select aria-label={`${ariaLabel} presets`} disabled={disabled} value="" onChange={(event) => { if (event.target.value !== "") onCommit(Number(event.target.value)); }}>
        <option value="" disabled hidden />
        {presets.map((angle) => <option key={angle} value={angle}>{angle}°</option>)}
      </select>
    </div>
  );
}

export default function TransformPanel({ read, reference, onReference, linked, onLinked, scaleStrokes, onScaleStrokes, onChange: change, onClose, shortcut }: Props) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [reading, setReading] = useState<TransformReading | null>(null);
  const refresh = useRef(() => undefined as void);
  refresh.current = () => {
    const next = read();
    setReading((current) => (JSON.stringify(current) === JSON.stringify(next) ? current : next));
  };
  useEffect(() => {
    refresh.current();
    const timer = window.setInterval(() => refresh.current(), 300);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => { refresh.current(); }, [reference]);
  const onChange = (field: TransformField, value: number) => {
    change(field, value);
    window.setTimeout(() => refresh.current(), 40);
  };
  const values = reading?.values ?? null;
  const mode = reading?.mode ?? "layer";
  const targetLabel = reading?.targetLabel ?? "";
  const scaleStrokesAvailable = Boolean(reading?.scaleStrokesAvailable);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  // Opens in the middle of the canvas (then the user drags it anywhere).
  useLayoutEffect(() => {
    const panel = panelRef.current;
    const canvas = document.querySelector(".cb-canvas-wrap")?.getBoundingClientRect();
    if (!panel) return;
    const box = canvas || { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
    setPosition({ left: Math.round(box.left + (box.width - panel.offsetWidth) / 2), top: Math.round(box.top + (box.height - panel.offsetHeight) / 2) });
  }, []);
  const disabled = values == null;
  const sizeUnit = mode === "part" ? "%" : "px";
  return (
    <div ref={panelRef} className="cb-transform-panel" role="dialog" aria-label="Transform"
      style={position ? { left: position.left, top: position.top } : { visibility: "hidden" }}
      onKeyDown={(event) => { if (event.key === "Escape" && !(event.target instanceof HTMLInputElement)) onClose(); }}>
      <header>
        <strong>Transform ({shortcut})</strong>
        <button type="button" className="cb-tf-close" aria-label="Close Transform panel" onClick={onClose}>×</button>
      </header>
      <div className="cb-tf-body">
        <div className="cb-tf-top">
          <div className="cb-tf-reference">
            <div className="cb-tf-grid" role="radiogroup" aria-label="Registration point"
              title={mode === "part" ? "A part scales and turns around its own registration point: drag that point on the canvas" : "The point X / Y give, and that size, rotation and skew keep in place"}>
              {[0, 0.5, 1].map((ry) => [0, 0.5, 1].map((rx) => (
                <button key={`${rx}-${ry}`} type="button" role="radio" aria-checked={reference.rx === rx && reference.ry === ry} disabled={mode === "part"}
                  aria-label={`Registration point ${ry === 0 ? "top" : ry === 1 ? "bottom" : "middle"} ${rx === 0 ? "left" : rx === 1 ? "right" : "centre"}`}
                  className={reference.rx === rx && reference.ry === ry ? "on" : ""} onClick={() => onReference(rx, ry)} />
              )))}
            </div>
            <small>Registration Point</small>
          </div>
          <div className="cb-tf-options">
            <label title="CB Studio has no rounded-corner shapes"><input type="checkbox" checked disabled readOnly /> Scale Corners</label>
            <label title={scaleStrokesAvailable ? "Off: a character's outlines keep their thickness when you scale it here" : "For whole characters"}>
              <input type="checkbox" checked={scaleStrokes} disabled={!scaleStrokesAvailable} onChange={(event) => onScaleStrokes(event.target.checked)} /> Scale Strokes &amp; Effects
            </label>
          </div>
        </div>
        <div className="cb-tf-rows">
          <div className="cb-tf-pair">
            <NumberField label="X" value={values?.x ?? null} unit="px" disabled={disabled} onCommit={(value) => onChange("x", value)} ariaLabel={mode === "part" ? "Move X" : "X"} />
            <NumberField label="Y" value={values?.y ?? null} unit="px" disabled={disabled} onCommit={(value) => onChange("y", value)} ariaLabel={mode === "part" ? "Move Y" : "Y"} />
          </div>
          <div className="cb-tf-pair">
            <NumberField label="W" value={values?.w ?? null} unit={sizeUnit} disabled={disabled} onCommit={(value) => onChange("w", value)} ariaLabel="Width" />
            <NumberField label="H" value={values?.h ?? null} unit={sizeUnit} disabled={disabled} onCommit={(value) => onChange("h", value)} ariaLabel="Height" />
          </div>
          <button type="button" className={`cb-tf-link ${linked ? "on" : ""}`} aria-pressed={linked} aria-label="Constrain width and height proportions"
            title={linked ? "Proportions linked: W and H change together" : "Proportions free: W and H change on their own"} onClick={() => onLinked(!linked)}>
            <svg viewBox="0 0 16 16" aria-hidden="true">{linked
              ? <path d="M6.5 9.5l3-3M5.5 7.5L4 9a2.5 2.5 0 0 0 3.5 3.5L9 11M10.5 8.5L12 7a2.5 2.5 0 0 0-3.5-3.5L7 5" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
              : <path d="M5.5 7.5L4 9a2.5 2.5 0 0 0 3.5 3.5L9 11M10.5 8.5L12 7a2.5 2.5 0 0 0-3.5-3.5L7 5M3 3l10 10" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />}</svg>
          </button>
        </div>
        <div className="cb-tf-angles">
          <AngleField ariaLabel="Rotate" value={values?.rotation ?? null} presets={ANGLES} disabled={disabled} onCommit={(value) => onChange("rotation", value)}
            icon={<svg viewBox="0 0 16 16"><path d="M2 13h12M2 13l8-8" fill="none" stroke="currentColor" strokeWidth="1.2" /><path d="M7 13a5 5 0 0 0-1.4-3.5" fill="none" stroke="currentColor" strokeWidth="1.2" /></svg>} />
          <AngleField ariaLabel="Skew" value={values?.skew ?? null} presets={SKEWS} disabled={disabled} onCommit={(value) => onChange("skew", value)}
            icon={<svg viewBox="0 0 16 16"><path d="M5 3h9l-3 10H2z" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" /></svg>} />
        </div>
        <p className="cb-tf-target">{disabled ? "Select a layer or a part to transform it." : targetLabel}</p>
      </div>
    </div>
  );
}
