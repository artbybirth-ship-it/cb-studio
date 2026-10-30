"use client";

import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { hexToRgb, hsbToRgb, rgbToHex, rgbToHsb, type Hsb, type Rgb } from "@/lib/color";
import { normalizeHex } from "@/lib/findReplace";
import { scrubProps } from "@/lib/scrub";
import { useEscClose } from "@/lib/escClose";
import PanelClose from "./PanelClose";

/**
 * Colour Picker, after Adobe Illustrator's: a colour field and a strip, H/S/B and R/G/B boxes whose
 * radio button chooses what the strip controls, a # code, and new | original preview. Nothing is
 * applied until OK (Enter); Cancel (Esc) discards. Modal; dragged by its title like every dialog.
 */

type Mode = "h" | "s" | "v" | "r" | "g" | "bl";
type Colour = { hsb: Hsb; rgb: Rgb };

const MODES: { key: Mode; label: string; max: number; unit: string }[] = [
  { key: "h", label: "H", max: 360, unit: "°" },
  { key: "s", label: "S", max: 100, unit: "%" },
  { key: "v", label: "B", max: 100, unit: "%" },
  { key: "r", label: "R", max: 255, unit: "" },
  { key: "g", label: "G", max: 255, unit: "" },
  { key: "bl", label: "B", max: 255, unit: "" },
];
const MODE_KEY = "cb-colour-picker-mode";
const readMode = (): Mode => {
  try { const saved = window.localStorage.getItem(MODE_KEY) as Mode | null; return MODES.some((mode) => mode.key === saved) ? saved! : "h"; } catch { return "h"; }
};

const clamp = (value: number, max: number) => Math.max(0, Math.min(max, value));
const fromHsb = (hsb: Hsb): Colour => ({ hsb, rgb: hsbToRgb(hsb) });
// From RGB, keeping the hue on greys and the saturation on black, so the field does not jump.
const fromRgb = (rgb: Rgb, previous: Hsb): Colour => {
  const hsb = rgbToHsb(rgb, previous.h);
  return { rgb, hsb: hsb.b === 0 ? { ...hsb, s: previous.s } : hsb };
};
const channel = (colour: Colour, mode: Mode) =>
  mode === "h" ? colour.hsb.h : mode === "s" ? colour.hsb.s : mode === "v" ? colour.hsb.b : mode === "r" ? colour.rgb.r : mode === "g" ? colour.rgb.g : colour.rgb.b;

/** The colour at (x, y) of the field (0..1, y down) for the strip's mode and fixed value. */
function fieldColour(mode: Mode, colour: Colour, x: number, y: number): Colour {
  const { hsb, rgb } = colour;
  switch (mode) {
    case "h": return fromHsb({ h: hsb.h, s: x * 100, b: (1 - y) * 100 });
    case "s": return fromHsb({ h: x * 360, s: hsb.s, b: (1 - y) * 100 });
    case "v": return fromHsb({ h: x * 360, s: (1 - y) * 100, b: hsb.b });
    case "r": return fromRgb({ r: rgb.r, g: Math.round((1 - y) * 255), b: Math.round(x * 255) }, hsb);
    case "g": return fromRgb({ r: Math.round((1 - y) * 255), g: rgb.g, b: Math.round(x * 255) }, hsb);
    default: return fromRgb({ r: Math.round(x * 255), g: Math.round((1 - y) * 255), b: rgb.b }, hsb);
  }
}
/** Where the colour sits in the field (0..1). */
function fieldPoint(mode: Mode, { hsb, rgb }: Colour): { x: number; y: number } {
  switch (mode) {
    case "h": return { x: hsb.s / 100, y: 1 - hsb.b / 100 };
    case "s": return { x: hsb.h / 360, y: 1 - hsb.b / 100 };
    case "v": return { x: hsb.h / 360, y: 1 - hsb.s / 100 };
    case "r": return { x: rgb.b / 255, y: 1 - rgb.g / 255 };
    case "g": return { x: rgb.b / 255, y: 1 - rgb.r / 255 };
    default: return { x: rgb.r / 255, y: 1 - rgb.g / 255 };
  }
}
/** The colour with the strip's channel set to t (0..1). */
function stripColour(mode: Mode, colour: Colour, t: number): Colour {
  const { hsb, rgb } = colour;
  switch (mode) {
    case "h": return fromHsb({ ...hsb, h: t * 360 });
    case "s": return fromHsb({ ...hsb, s: t * 100 });
    case "v": return fromHsb({ ...hsb, b: t * 100 });
    case "r": return fromRgb({ ...rgb, r: Math.round(t * 255) }, hsb);
    case "g": return fromRgb({ ...rgb, g: Math.round(t * 255) }, hsb);
    default: return fromRgb({ ...rgb, b: Math.round(t * 255) }, hsb);
  }
}
/** What the strip shows at t: the hue strip is the full spectrum; other strips run through the channel. */
const stripDisplay = (mode: Mode, colour: Colour, t: number) => (mode === "h" ? hsbToRgb({ h: t * 360, s: 100, b: 100 }) : stripColour(mode, colour, t).rgb);

const SIZE = 256;

/** Number box: shows "227°"; typing updates the colour; ↑/↓ step 1, with Shift 10. */
function NumberBox({ label, value, max, unit, onValue }: { label: string; value: number; max: number; unit: string; onValue: (value: number) => void }) {
  // What is being typed, only while the box has focus; otherwise it always shows the current value.
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? `${Math.round(value)}${unit}`;
  return (
    <input className="cb-cp-number" value={shown} aria-label={label} inputMode="numeric"
      {...scrubProps({ value: Math.round(value), onChange: onValue, min: 0, max })}
      onFocus={(event) => { setDraft(String(Math.round(value))); requestAnimationFrame(() => event.target.select()); }}
      onBlur={() => setDraft(null)}
      onChange={(event) => {
        if (document.activeElement === event.target) setDraft(event.target.value);
        const number = Number(event.target.value.replace(/[^\d.]/g, ""));
        if (event.target.value.trim() !== "" && Number.isFinite(number)) onValue(clamp(number, max));
      }}
      onKeyDown={(event) => {
        if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
        event.preventDefault();
        const next = clamp(Math.round(value) + (event.key === "ArrowUp" ? 1 : -1) * (event.shiftKey ? 10 : 1), max);
        setDraft(String(next));
        onValue(next);
      }} />
  );
}

type Props = {
  /** Starting colour (#rrggbb); also the "original" half of the preview. */
  initial: string;
  title?: string;
  onOk: (hex: string) => void;
  onCancel: () => void;
};

export default function ColourPicker({ initial, title = "Colour Picker", onOk, onCancel }: Props) {
  // Its own Enter / Esc keys stay (OK / Cancel); registering keeps panels behind it from closing first.
  useEscClose(true, onCancel);
  const original = normalizeHex(initial) || "#000000";
  const [colour, setColour] = useState<Colour>(() => fromRgb(hexToRgb(original)!, { h: 0, s: 0, b: 0 }));
  const [mode, setModeState] = useState<Mode>("h");
  const [hexDraft, setHexDraft] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const fieldRef = useRef<HTMLCanvasElement>(null);
  const stripRef = useRef<HTMLCanvasElement>(null);
  const hexRef = useRef<HTMLInputElement>(null);
  const hex = rgbToHex(colour.rgb);

  useEffect(() => { setModeState(readMode()); }, []);
  const setMode = (next: Mode) => { setModeState(next); try { window.localStorage.setItem(MODE_KEY, next); } catch { /* not remembered */ } };
  // The # code starts selected, as in Illustrator, so typing a code replaces it.
  useEffect(() => { requestAnimationFrame(() => { hexRef.current?.focus(); hexRef.current?.select(); }); }, []);

  // Field: depends on the mode and the strip's value (and, for R/G/B, nothing else).
  const fixed = channel(colour, mode);
  useEffect(() => {
    const context = fieldRef.current?.getContext("2d");
    if (!context) return;
    const image = context.createImageData(SIZE, SIZE);
    for (let y = 0; y < SIZE; y += 1) {
      for (let x = 0; x < SIZE; x += 1) {
        const { rgb } = fieldColour(mode, colour, x / (SIZE - 1), y / (SIZE - 1));
        const index = (y * SIZE + x) * 4;
        image.data[index] = rgb.r; image.data[index + 1] = rgb.g; image.data[index + 2] = rgb.b; image.data[index + 3] = 255;
      }
    }
    context.putImageData(image, 0, 0);
  }, [mode, fixed]); // eslint-disable-line react-hooks/exhaustive-deps

  // Strip: the spectrum for H, otherwise the channel's range at the current colour.
  useEffect(() => {
    const context = stripRef.current?.getContext("2d");
    if (!context) return;
    const image = context.createImageData(SIZE, 1);
    for (let x = 0; x < SIZE; x += 1) {
      const rgb = stripDisplay(mode, colour, x / (SIZE - 1));
      image.data[x * 4] = rgb.r; image.data[x * 4 + 1] = rgb.g; image.data[x * 4 + 2] = rgb.b; image.data[x * 4 + 3] = 255;
    }
    context.putImageData(image, 0, 0);
  }, [mode, mode === "h" ? 0 : hex]); // eslint-disable-line react-hooks/exhaustive-deps

  const at = (event: ReactPointerEvent<HTMLElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: clamp((event.clientX - rect.left) / rect.width, 1), y: clamp((event.clientY - rect.top) / rect.height, 1) };
  };
  const dragField = (event: ReactPointerEvent<HTMLDivElement>) => { const p = at(event); setColour((current) => fieldColour(mode, current, p.x, p.y)); setHexDraft(null); };
  const dragStrip = (event: ReactPointerEvent<HTMLDivElement>) => { const p = at(event); setColour((current) => stripColour(mode, current, p.x)); setHexDraft(null); };

  const setChannel = (key: Mode, value: number) => {
    setHexDraft(null);
    setColour((current) => key === "h" ? fromHsb({ ...current.hsb, h: value }) : key === "s" ? fromHsb({ ...current.hsb, s: value }) : key === "v" ? fromHsb({ ...current.hsb, b: value })
      : fromRgb({ ...current.rgb, [key === "bl" ? "b" : key]: Math.round(value) } as Rgb, current.hsb));
  };

  const copy = async () => {
    try { await navigator.clipboard.writeText(hex); }
    catch {
      const area = document.createElement("textarea");
      area.value = hex; document.body.appendChild(area); area.select();
      try { document.execCommand("copy"); } finally { area.remove(); }
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  };

  const onKeyDown = (event: ReactKeyboardEvent) => {
    event.stopPropagation(); // nothing reaches the editor's shortcuts
  };
  // Enter = OK, Esc = Cancel, wherever focus is (clicking the field or strip takes it off the
  // dialog). A focused button keeps Enter for itself.
  const keysRef = useRef({ ok: () => onOk(hex), cancel: onCancel });
  keysRef.current = { ok: () => onOk(hex), cancel: onCancel };
  const dialogRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Enter" && event.key !== "Escape") return;
      const target = event.target as HTMLElement | null;
      if (event.key === "Enter" && target instanceof HTMLButtonElement && dialogRef.current?.contains(target)) { event.stopPropagation(); return; }
      event.preventDefault();
      event.stopPropagation();
      if (event.key === "Enter") keysRef.current.ok(); else keysRef.current.cancel();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  const point = fieldPoint(mode, colour);
  const stripAt = fixed / (MODES.find((item) => item.key === mode)!.max);

  return (
    <div className="cb-cp-backdrop" onKeyDown={onKeyDown}>
      <div className="cb-cp-dialog" role="dialog" aria-modal="true" aria-label={title} ref={dialogRef}>
        <header><PanelClose onClose={onCancel} label="Cancel" />{title}</header>
        <div className="cb-cp-body">
          <div className="cb-cp-left">
            <div className="cb-cp-field" onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); dragField(event); }} onPointerMove={(event) => { if (event.buttons) dragField(event); }}>
              <canvas ref={fieldRef} width={SIZE} height={SIZE} aria-hidden="true" />
              <span className={`cb-cp-ring ${colour.hsb.b > 55 && colour.hsb.s < 45 ? "dark" : ""}`} style={{ left: `${point.x * 100}%`, top: `${point.y * 100}%` }} />
            </div>
            <div className="cb-cp-strip" role="slider" aria-label={`${MODES.find((item) => item.key === mode)!.label} slider`} aria-valuenow={Math.round(fixed)}
              onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); dragStrip(event); }} onPointerMove={(event) => { if (event.buttons) dragStrip(event); }}>
              <canvas ref={stripRef} width={SIZE} height={1} aria-hidden="true" />
              <span className="cb-cp-tri top" style={{ left: `${stripAt * 100}%` }} />
              <span className="cb-cp-tri bottom" style={{ left: `${stripAt * 100}%` }} />
            </div>
          </div>

          <div className="cb-cp-right">
            {MODES.map((item) => (
              <label key={item.key} className="cb-cp-row">
                <input type="radio" name="cb-cp-mode" checked={mode === item.key} onChange={() => setMode(item.key)} aria-label={`${item.label} on the slider`} />
                <span>{item.label}:</span>
                <NumberBox label={item.key === "bl" ? "Blue" : item.key === "v" ? "Brightness" : item.label} value={channel(colour, item.key)} max={item.max} unit={item.unit} onValue={(value) => setChannel(item.key, value)} />
              </label>
            ))}
            <div className="cb-cp-hexrow">
              <label className="cb-cp-hex"><i>#</i>
                <input ref={hexRef} value={hexDraft ?? hex.slice(1)} maxLength={7} spellCheck={false} aria-label="Colour code"
                  onChange={(event) => {
                    setHexDraft(event.target.value);
                    const next = normalizeHex(event.target.value);
                    if (next) setColour((current) => fromRgb(hexToRgb(next)!, current.hsb));
                  }}
                  onBlur={() => setHexDraft(null)} />
              </label>
              <button type="button" className="cb-cp-copy" onClick={() => void copy()} title="Copy colour code" aria-label="Copy colour code">
                <svg viewBox="0 0 20 20" aria-hidden="true"><rect x="7.5" y="2.5" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="1.2" strokeDasharray="1.6 1.4"/><rect x="2.5" y="9.5" width="7" height="8" fill="none" stroke="currentColor" strokeWidth="1.4"/></svg>
                {copied && <em>Copied</em>}
              </button>
            </div>
            <div className="cb-cp-preview">
              <span style={{ background: hex }} title={`New: ${hex}`} />
              <button type="button" style={{ background: original }} title={`Original: ${original} (click to go back)`} aria-label={`Original colour ${original}`}
                onClick={() => { setHexDraft(null); setColour((current) => fromRgb(hexToRgb(original)!, current.hsb)); }} />
            </div>
            <button type="button" className="cb-cp-ok" onClick={() => onOk(hex)}>OK</button>
            <button type="button" className="cb-cp-cancel" onClick={onCancel}>Cancel</button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** A swatch that opens the Colour Picker (used in place of the system colour popup). */
export function ColourSwatch({ value, onChange, label, title, className = "" }: { value: string; onChange: (hex: string) => void; label: string; title?: string; className?: string }) {
  const [open, setOpen] = useState(false);
  const hex = normalizeHex(value) || "#000000";
  return (
    <>
      <button type="button" className={`cb-cp-swatch ${className}`} style={{ background: hex }} aria-label={`${label}: ${hex}`} title={title || `${label} — click to choose a colour`} onClick={() => setOpen(true)} />
      {open && <ColourPicker initial={hex} onOk={(next) => { setOpen(false); if (next !== hex) onChange(next); }} onCancel={() => setOpen(false)} />}
    </>
  );
}
