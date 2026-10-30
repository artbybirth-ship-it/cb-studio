"use client";

import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { hexToRgb, hsbToRgb, rgbToHex, rgbToHsb, type Hsb, type Rgb } from "@/lib/color";
import { normalizeHex } from "@/lib/findReplace";
import { scrubProps } from "@/lib/scrub";
import { useEscClose } from "@/lib/escClose";
import PanelClose from "./PanelClose";
import CanvasEyedropper from "./CanvasEyedropper";
import { EyedropperIcon } from "./toolIcons";

/**
 * Fill/Stroke (every colour picker in the app; mockup, after Illustrator's Colour Picker): a colour
 * field and a strip, H/S/B and R/G/B whose radio button chooses what the strip controls, a # code,
 * the canvas eyedropper, and for text Include Stroke / Include Shadow. Nothing is applied until
 * Create (Enter); Cancel (Esc) discards. Modal; dragged by its title like every dialog.
 */
export type ColourEffects = { stroke: boolean; shadow: boolean };

type Mode = "h" | "s" | "v" | "r" | "g" | "bl";
type Colour = { hsb: Hsb; rgb: Rgb };

const MODES: { key: Mode; label: string; max: number; unit: string }[] = [
  { key: "h", label: "H", max: 360, unit: "°" },
  { key: "s", label: "S", max: 100, unit: "%" },
  { key: "v", label: "B", max: 100, unit: "%" },
  { key: "r", label: "R", max: 255, unit: "%" },
  { key: "g", label: "G", max: 255, unit: "%" },
  { key: "bl", label: "B", max: 255, unit: "%" },
];
/** R / G / B are shown in % (0–255 inside). */
const isRgb = (mode: Mode) => mode === "r" || mode === "g" || mode === "bl";
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
  /** Starting colour (#rrggbb). */
  initial: string;
  title?: string;
  /** Text: show Include Stroke / Include Shadow, starting as given; Create returns them. */
  effects?: ColourEffects;
  onOk: (hex: string, effects?: ColourEffects) => void;
  onCancel: () => void;
};

export default function ColourPicker({ initial, title = "Fill/Stroke", effects, onOk, onCancel }: Props) {
  const [stroke, setStroke] = useState(Boolean(effects?.stroke));
  const [shadow, setShadow] = useState(Boolean(effects?.shadow));
  const [picking, setPicking] = useState(false);
  const create = (hex: string) => onOk(hex, effects ? { stroke, shadow } : undefined);
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
  const keysRef = useRef({ ok: () => create(hex), cancel: onCancel });
  keysRef.current = { ok: () => create(hex), cancel: onCancel };
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
    <div className={`cb-cp-backdrop ${picking ? "picking" : ""}`} onKeyDown={onKeyDown}>
      <div className="cb-cp-dialog cb-fs-dialog" role="dialog" aria-modal="true" aria-label={title} ref={dialogRef}>
        <header><PanelClose onClose={onCancel} label="Cancel" />{title}</header>
        <div className="cb-fs-body">
          <div className="cb-fs-left">
            <div className="cb-fs-label">
              <span>Select Colour</span>
              <button type="button" className="cb-fs-dropper" aria-label="Eyedropper" title="Eyedropper: click a colour on the canvas" onClick={() => setPicking(true)}><EyedropperIcon /></button>
            </div>
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
            {effects && (
              <div className="cb-fs-effects">
                <label><input type="checkbox" checked={stroke} onChange={(event) => setStroke(event.target.checked)} /> Include Stroke</label>
                <label><input type="checkbox" checked={shadow} onChange={(event) => setShadow(event.target.checked)} /> Include Shadow</label>
              </div>
            )}
          </div>

          <div className="cb-fs-right">
            {MODES.map((item, index) => (
              <label key={item.key} className={`cb-fs-row ${index === 3 ? "gap" : ""}`}>
                <input type="radio" name="cb-cp-mode" checked={mode === item.key} onChange={() => setMode(item.key)} aria-label={`${item.label} on the slider`} />
                <span className="cb-fs-pill">
                  <b>{item.label}</b>
                  <NumberBox label={item.key === "bl" ? "Blue" : item.key === "v" ? "Brightness" : item.label}
                    value={isRgb(item.key) ? (channel(colour, item.key) / 255) * 100 : channel(colour, item.key)} max={isRgb(item.key) ? 100 : item.max} unit={item.unit}
                    onValue={(value) => setChannel(item.key, isRgb(item.key) ? (value / 100) * 255 : value)} />
                </span>
              </label>
            ))}
            <div className="cb-cp-hexrow cb-fs-hexrow">
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
            <button type="button" className="cb-fs-create" onClick={() => create(hex)}>Create</button>
            <button type="button" className="cb-fs-cancel" onClick={onCancel}>Cancel</button>
          </div>
        </div>
      </div>
      {picking && <CanvasEyedropper onPick={(picked) => { setPicking(false); setHexDraft(null); setColour((current) => fromRgb(hexToRgb(picked)!, current.hsb)); }} onCancel={() => setPicking(false)} />}
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
