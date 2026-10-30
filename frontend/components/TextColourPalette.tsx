"use client";

import { useEffect, useRef, useState } from "react";
import { hexToRgb, rgbToHex } from "@/lib/color";
import { normalizeHex } from "@/lib/findReplace";
import { useEscClose } from "@/lib/escClose";
import { scrubProps } from "@/lib/scrub";
import { EyedropperIcon, FillStrokeIcon } from "./toolIcons";
import ColourPicker, { type ColourEffects } from "./ColourPicker";
import CanvasEyedropper from "./CanvasEyedropper";

/**
 * While text is being typed, a colour button (three pencils) sits beside it; a click opens the colour
 * panel (mockup): 12 swatches, the colour code, the chosen colour, R / G / B in %, the canvas eyedropper and the
 * Fill/Stroke window (with Include Stroke / Shadow). Swatches keep the caret in the text.
 */
const SWATCHES = ["#000000", "#ffffff", "#7f7f7f", "#d64235", "#e4913f", "#efd145", "#63b85f", "#4a9c8a", "#4f9ad6", "#5b5bd1", "#a453d4", "#ec6aa0"];

const PencilsIcon = () => (
  <svg viewBox="0 0 32 32" aria-hidden="true">
    {[{ x: 9, top: 9, fill: "#e8242b" }, { x: 16, top: 7, fill: "#2fb53f" }, { x: 23, top: 5, fill: "#2f6ef0" }].map(({ x, top, fill }) => (
      <g key={fill}>
        <path d={`M${x - 2.6} ${top + 5}L${x} ${top}l2.6 5z`} fill="#d9d9d9" />
        <path d={`M${x - 0.9} ${top + 1.7}L${x} ${top}l0.9 1.7z`} fill={fill} />
        <rect x={x - 2.6} y={top + 5} width="5.2" height={22 - top} rx="0.6" fill={fill} stroke="#fff" strokeWidth="0.8" />
      </g>
    ))}
  </svg>
);

/** R / G / B as 0–100%: drag left / right, or type. */
function ChannelField({ label, percent, onPercent }: { label: string; percent: number; onPercent: (value: number) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft == null) return;
    const value = parseFloat(draft);
    setDraft(null);
    if (Number.isFinite(value)) onPercent(Math.max(0, Math.min(100, value)));
  };
  return (
    <label className="cb-text-palette-channel">
      <b>{label}</b>
      <input value={draft ?? `${percent}%`} aria-label={`${label} (%)`} inputMode="numeric"
        {...scrubProps({ value: percent, onChange: onPercent, min: 0, max: 100 })}
        onFocus={(event) => { setDraft(String(percent)); requestAnimationFrame(() => event.target.select()); }}
        onChange={(event) => setDraft(event.target.value)} onBlur={commit}
        onKeyDown={(event) => { if (event.key === "Enter") (event.target as HTMLInputElement).blur(); else if (event.key === "Escape") { setDraft(null); (event.target as HTMLInputElement).blur(); } }} />
    </label>
  );
}

export default function TextColourPalette({ colour, effects, onPick, onFillStroke }: {
  colour: string;
  /** Whether the text has an outline / a shadow now (the Fill/Stroke window's checkboxes). */
  effects: ColourEffects;
  onPick: (hex: string) => void;
  onFillStroke: (hex: string, effects: ColourEffects) => void;
}) {
  const [place, setPlace] = useState<{ left: number; top: number; flip: boolean } | null>(null);
  const [open, setOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [dropperOpen, setDropperOpen] = useState(false);
  const [hexDraft, setHexDraft] = useState<string | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  useEscClose(open && !pickerOpen && !dropperOpen, () => setOpen(false));
  const hex = normalizeHex(colour) || "#000000";
  const rgb = hexToRgb(hex) || { r: 0, g: 0, b: 0 };
  const percent = (value: number) => Math.round((value / 255) * 100);
  const setChannel = (channel: "r" | "g" | "b", value: number) => onPick(rgbToHex({ ...rgb, [channel]: Math.round((value / 100) * 255) }));

  // The button follows the text as it grows, moves or the view zooms (right of it, or left without room).
  useEffect(() => {
    const update = () => {
      const rect = document.querySelector(".cb-stage-text-editing")?.getBoundingClientRect();
      if (!rect) { setPlace(null); return; }
      const flip = rect.right + 14 + 44 + 12 + 330 > window.innerWidth;
      const left = flip && rect.left - 14 - 44 > 8 ? rect.left - 14 - 44 : rect.right + 14;
      const top = Math.max(8, Math.min(rect.top, window.innerHeight - 52));
      setPlace((current) => (current && Math.abs(current.left - left) < 0.5 && Math.abs(current.top - top) < 0.5 && current.flip === flip ? current : { left, top, flip }));
    };
    update();
    const timer = window.setInterval(update, 150);
    return () => window.clearInterval(timer);
  }, []);
  if (!place) return null;
  const commitHex = () => {
    if (hexDraft == null) return;
    const next = normalizeHex(hexDraft.startsWith("#") ? hexDraft : `#${hexDraft}`);
    setHexDraft(null);
    if (next) onPick(next);
  };
  const panelLeft = place.flip ? place.left - 12 - 330 : place.left + 44 + 12;
  const panelTop = Math.max(8, Math.min(place.top, window.innerHeight - 340));

  return (
    <>
      <button ref={buttonRef} type="button" className={`cb-text-palette-button ${open ? "on" : ""}`} data-text-ui style={{ left: place.left, top: place.top }}
        aria-label="Text colour" aria-expanded={open} title="Text colour" onMouseDown={(event) => event.preventDefault()} onClick={() => setOpen((value) => !value)}>
        <PencilsIcon />
      </button>
      {open && (
        <div className="cb-text-palette" data-text-ui role="dialog" aria-label="Text colour" style={{ left: panelLeft, top: panelTop }}>
          <div className="cb-text-palette-swatches">
            {SWATCHES.map((swatch) => (
              <button key={swatch} type="button" className={`${swatch === "#000000" || swatch === "#ffffff" ? "edge" : ""} ${swatch === hex ? "on" : ""}`} style={{ background: swatch }} aria-label={`Text colour ${swatch}`}
                onMouseDown={(event) => event.preventDefault()} onClick={() => onPick(swatch)} />
            ))}
          </div>
          {/* Three rows (mockup): colour code · R, the chosen colour · G, the tools · B. */}
          <div className="cb-text-palette-lower">
            <label className="cb-text-palette-hex"><i>#</i>
              <input value={hexDraft ?? hex.slice(1)} maxLength={7} spellCheck={false} aria-label="Colour code"
                onFocus={(event) => { setHexDraft(hex.slice(1)); requestAnimationFrame(() => event.target.select()); }}
                onChange={(event) => setHexDraft(event.target.value.replace(/[^#0-9a-f]/gi, ""))} onBlur={commitHex}
                onKeyDown={(event) => { if (event.key === "Enter") (event.target as HTMLInputElement).blur(); else if (event.key === "Escape") { setHexDraft(null); (event.target as HTMLInputElement).blur(); } }} />
            </label>
            <ChannelField label="R" percent={percent(rgb.r)} onPercent={(value) => setChannel("r", value)} />
            <div className="cb-text-palette-preview" style={{ background: hex }} role="img" aria-label={`Chosen colour ${hex}`} />
            <ChannelField label="G" percent={percent(rgb.g)} onPercent={(value) => setChannel("g", value)} />
            <div className="cb-text-palette-tools">
              <button type="button" aria-label="Eyedropper" title="Eyedropper: click a colour on the canvas"
                onMouseDown={(event) => event.preventDefault()} onClick={() => setDropperOpen(true)}>
                <EyedropperIcon />
              </button>
              <button type="button" aria-label="Fill and stroke" title="Fill/Stroke: any colour, with an outline or a shadow" onClick={() => setPickerOpen(true)}>
                <FillStrokeIcon />
              </button>
            </div>
            <ChannelField label="B" percent={percent(rgb.b)} onPercent={(value) => setChannel("b", value)} />
          </div>
        </div>
      )}
      {pickerOpen && <ColourPicker initial={hex} effects={effects} onOk={(next, chosen) => { setPickerOpen(false); onFillStroke(next, chosen || effects); }} onCancel={() => setPickerOpen(false)} />}
      {dropperOpen && <CanvasEyedropper onPick={(picked) => { setDropperOpen(false); onPick(picked); }} onCancel={() => setDropperOpen(false)} />}
    </>
  );
}
