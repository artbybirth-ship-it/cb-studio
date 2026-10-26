"use client";

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { axisAngle, type ReflectAxis } from "@/lib/reflect";

/**
 * Adobe Illustrator "Reflect" (Reflect tool O, then Enter): Horizontal, Vertical or an Angle axis
 * (typed or set on the dial), live Preview, OK. Holding Option/Alt turns OK into Copy (reflect a
 * duplicate). Dragged by its title like every dialog.
 */

type Props = {
  /** The selected character part it applies to (e.g. "Head"); absent = the whole selection. */
  target?: string;
  /** Copy needs whole layers (a part cannot be duplicated on its own). */
  canCopy: boolean;
  /** Show the result on the canvas for this axis angle; null removes the preview. */
  onPreview: (angle: number | null) => void;
  onApply: (angle: number, copy: boolean) => void;
  onCancel: () => void;
};

const STORAGE_KEY = "cb-reflect-last";
type Saved = { axis: ReflectAxis; angle: string; preview: boolean };
const readSaved = (): Saved => {
  try {
    const saved = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "null");
    if (saved && ["horizontal", "vertical", "angle"].includes(saved.axis)) return { axis: saved.axis, angle: String(saved.angle ?? "90"), preview: saved.preview !== false };
  } catch { /* storage unavailable */ }
  return { axis: "vertical", angle: "90", preview: true };
};

// Illustrator's axis icons: an outline triangle mirrored onto a filled one across a dotted line.
const HorizontalIcon = () => (
  <svg viewBox="0 0 20 24" aria-hidden="true"><path d="M3 2.5h14L10 10z" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" /><path d="M1 12h18" stroke="currentColor" strokeWidth="1" strokeDasharray="1.4 1.2" /><path d="M3 21.5h14L10 14z" fill="currentColor" /></svg>
);
const VerticalIcon = () => (
  <svg viewBox="0 0 24 20" aria-hidden="true"><path d="M2.5 3v14L10 10z" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" /><path d="M12 1v18" stroke="currentColor" strokeWidth="1" strokeDasharray="1.4 1.2" /><path d="M21.5 3v14L14 10z" fill="currentColor" /></svg>
);

export default function ReflectDialog({ target, canCopy, onPreview, onApply, onCancel }: Props) {
  const [initial] = useState(readSaved);
  const [axis, setAxis] = useState<ReflectAxis>(initial.axis);
  const [angleText, setAngleText] = useState(initial.axis === "angle" ? initial.angle : String(axisAngle(initial.axis, 0)));
  const [preview, setPreview] = useState(initial.preview);
  const [altHeld, setAltHeld] = useState(false);
  const okRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const finishRef = useRef<(copy: boolean) => void>(() => undefined);

  const typed = Number(angleText);
  const valid = axis !== "angle" || (angleText.trim() !== "" && Number.isFinite(typed));
  const angle = axisAngle(axis, valid ? typed : 0);
  const copying = altHeld && canCopy;

  // Live preview: re-applied from the original whenever the axis changes.
  useEffect(() => { onPreview(preview && valid ? angle : null); }, [preview, valid, angle]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { okRef.current?.focus(); }, []);
  // Option/Alt held: OK becomes Copy.
  useEffect(() => {
    const sync = (event: KeyboardEvent) => setAltHeld(event.altKey);
    const clear = () => setAltHeld(false);
    window.addEventListener("keydown", sync, true);
    window.addEventListener("keyup", sync, true);
    window.addEventListener("blur", clear);
    return () => { window.removeEventListener("keydown", sync, true); window.removeEventListener("keyup", sync, true); window.removeEventListener("blur", clear); };
  }, []);

  const chooseAxis = (next: ReflectAxis) => {
    setAxis(next);
    if (next !== "angle") setAngleText(String(axisAngle(next, 0)));
  };
  const finish = (copy: boolean) => {
    if (!valid || (copy && !canCopy)) return;
    try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ axis, angle: angleText.trim(), preview })); } catch { /* not remembered */ }
    onApply(angle, copy);
  };
  finishRef.current = finish;
  // Enter = OK (Option/Alt+Enter = Copy), Esc = Cancel, wherever focus is (dragging the dial takes
  // it off the dialog). A focused button keeps Enter for itself; nothing reaches the editor.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Enter" && event.key !== "Escape") return;
      const target = event.target as HTMLElement | null;
      if (event.key === "Enter" && target instanceof HTMLButtonElement && dialogRef.current?.contains(target)) { event.stopPropagation(); return; }
      event.preventDefault();
      event.stopPropagation();
      if (event.key === "Enter") finishRef.current(event.altKey && canCopy);
      else onCancel();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [canCopy, onCancel]);

  // Dial: the needle points along the axis (0° = right, 90° = up); drag it to set the angle.
  const dialAt = (event: ReactPointerEvent<HTMLElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const raw = (Math.atan2(-(event.clientY - (rect.top + rect.height / 2)), event.clientX - (rect.left + rect.width / 2)) * 180) / Math.PI;
    const step = event.shiftKey ? 15 : 1;
    const next = ((Math.round(raw / step) * step) % 360 + 360) % 360;
    setAxis("angle");
    setAngleText(String(next));
  };
  const needle = (angle * Math.PI) / 180;

  return (
    <div className="cb-rf-backdrop">
      <div className="cb-rf-dialog" role="dialog" aria-modal="true" aria-labelledby="cb-reflect-title" ref={dialogRef}
        onKeyDown={(event) => event.stopPropagation() /* other keys stay inside the dialog */}>
        <header id="cb-reflect-title">Reflect{target ? ` · ${target}` : ""}</header>
        <div className="cb-rf-body">
          <div className="cb-rf-axes" role="radiogroup" aria-label="Axis">
            <label className="cb-rf-radio"><input type="radio" name="cb-reflect-axis" checked={axis === "horizontal"} onChange={() => chooseAxis("horizontal")} /><span>Horizontal</span><HorizontalIcon /></label>
            <label className="cb-rf-radio"><input type="radio" name="cb-reflect-axis" checked={axis === "vertical"} onChange={() => chooseAxis("vertical")} /><span>Vertical</span><VerticalIcon /></label>
          </div>
          <div className="cb-rf-angle">
            <label className="cb-rf-radio"><input type="radio" name="cb-reflect-axis" checked={axis === "angle"} onChange={() => chooseAxis("angle")} /><span>Angle</span></label>
            <span className="cb-rf-anglebox">
              <input type="text" inputMode="decimal" value={angleText} aria-label="Axis angle in degrees" aria-invalid={!valid}
                onChange={(event) => { setAngleText(event.target.value.replace("°", "")); setAxis("angle"); }}
                onKeyDown={(event) => {
                  if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
                  event.preventDefault();
                  setAngleText(String((Number.isFinite(typed) ? typed : 0) + (event.key === "ArrowUp" ? 1 : -1) * (event.shiftKey ? 10 : 1)));
                  setAxis("angle");
                }} />
              <i>°</i>
            </span>
            <span className="cb-rf-dial" role="slider" aria-label="Axis angle dial" aria-valuenow={Math.round(angle)} title="Drag to set the angle (Shift = 15° steps)"
              onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); dialAt(event); }}
              onPointerMove={(event) => { if (event.buttons) dialAt(event); }}>
              <svg viewBox="0 0 60 60" aria-hidden="true">
                <circle cx="30" cy="30" r="28" fill="none" stroke="currentColor" strokeWidth="1.5" />
                <path d={`M30 30L${30 + 27 * Math.cos(needle)} ${30 - 27 * Math.sin(needle)}`} stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </span>
          </div>
          <label className="cb-rf-check"><input type="checkbox" checked={preview} onChange={(event) => setPreview(event.target.checked)} /><span>Preview</span></label>
          <div className="cb-rf-actions">
            <button type="button" className="cb-rf-cancel" onClick={onCancel}>Cancel</button>
            <button type="button" ref={okRef} className="cb-rf-ok" disabled={!valid} onClick={(event) => finish(event.altKey && canCopy)}
              title={canCopy ? "Hold Option/Alt to reflect a copy" : undefined}>{copying ? "Copy" : "OK"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
