"use client";

import { useEffect, useRef, useState } from "react";

type Props = {
  /** Called with the relative scale (percent) and rotation (degrees) to apply. */
  onApply: (scalePercent: number, rotateDegrees: number) => void;
  onClose: () => void;
  /** The selected character part it applies to (e.g. "Head"); absent = the whole selection. */
  target?: string;
};

const parseNumber = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return Number.NaN;
  return Number(trimmed);
};

// The last applied values are remembered until the user types new ones (like Animate).
const STORAGE_KEY = "cb-scale-rotate-last";
const readLastValues = () => {
  try {
    const saved = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "null");
    const scale = parseNumber(String(saved?.scale ?? ""));
    const rotate = parseNumber(String(saved?.rotate ?? ""));
    if (Number.isFinite(scale) && scale > 0 && Number.isFinite(rotate)) return { scale: String(saved.scale), rotate: String(saved.rotate) };
  } catch { /* storage unavailable: fall back to the defaults */ }
  return { scale: "100", rotate: "0" };
};
const saveLastValues = (scale: string, rotate: string) => {
  try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ scale: scale.trim(), rotate: rotate.trim() })); } catch { /* not persisted */ }
};

/**
 * Adobe Animate "Modify › Transform › Scale and Rotate" (Cmd+Option+S).
 * Values are relative: Scale 100 / Rotate 0 leave the selection unchanged.
 */
export default function ScaleRotateDialog({ onApply, onClose, target }: Props) {
  const [initial] = useState(readLastValues);
  const [scale, setScale] = useState(initial.scale);
  const [rotate, setRotate] = useState(initial.rotate);
  const scaleInput = useRef<HTMLInputElement>(null);

  const scaleValue = parseNumber(scale);
  const rotateValue = parseNumber(rotate);
  const scaleValid = Number.isFinite(scaleValue) && scaleValue > 0;
  const rotateValid = Number.isFinite(rotateValue);
  const valid = scaleValid && rotateValid;

  useEffect(() => {
    scaleInput.current?.focus();
    scaleInput.current?.select();
  }, []);

  const submit = () => {
    if (!valid) return;
    saveLastValues(scale, rotate);
    onApply(scaleValue, rotateValue);
    onClose();
  };

  return (
    <div className="cb-scale-rotate-backdrop">
      <div
        className="cb-scale-rotate-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="cb-scale-rotate-title"
        onKeyDown={(event) => {
          // Keys stay inside the dialog: Enter = OK, Escape = Cancel, nothing reaches the editor.
          event.stopPropagation();
          if (event.key === "Enter") { event.preventDefault(); submit(); }
          else if (event.key === "Escape") { event.preventDefault(); onClose(); }
        }}
      >
        {/* Dragged by the app-wide DialogDragManager. */}
        <div className="cb-scale-rotate-header" data-drag-handle>
          <h2 id="cb-scale-rotate-title">Scale and Rotate{target ? ` · ${target}` : ""}</h2>
        </div>
        <form className="cb-scale-rotate-body" onSubmit={(event) => { event.preventDefault(); submit(); }}>
          <label className="cb-scale-rotate-row">
            <span>Scale</span>
            <input ref={scaleInput} value={scale} onChange={(event) => setScale(event.target.value)} inputMode="decimal"
              aria-invalid={!scaleValid} aria-label="Scale percent" />
            <em aria-hidden="true" />
          </label>
          <label className="cb-scale-rotate-row">
            <span>Rotate</span>
            <input value={rotate} onChange={(event) => setRotate(event.target.value)} inputMode="decimal"
              aria-invalid={!rotateValid} aria-label="Rotate degrees" />
            <em>degrees</em>
          </label>
          <div className="cb-scale-rotate-actions">
            <button type="submit" className="cb-scale-rotate-ok" disabled={!valid}>OK</button>
            <button type="button" className="cb-scale-rotate-cancel" onClick={onClose}>Cancel</button>
          </div>
        </form>
      </div>
    </div>
  );
}
