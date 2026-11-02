"use client";

import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { ADJUST_CHANNELS, type AdjustMode, type AdjustSettings } from "@/lib/adjustColour";
import { scrubProps } from "@/lib/scrub";
import { useEscClose } from "@/lib/escClose";
import PanelClose from "./PanelClose";

/**
 * Adjust colour balance (Colour palette, ⌘J; mockup): Colour Mode (RGB / HSB / Greyscale) with
 * Convert, a slider and a number box per channel (−100…100 %), what changes (Fill / Stroke / Shadow),
 * Preview, Cancel and Create. Changes show on the canvas while Preview is on; nothing is kept until
 * Create (Enter); Cancel (Esc) puts every colour back.
 */
const MODES: { value: AdjustMode; label: string }[] = [
  { value: "rgb", label: "RGB" },
  { value: "hsb", label: "HSB" },
  { value: "grey", label: "Greyscale" },
];

function PercentBox({ label, value, onValue }: { label: string; value: number; onValue: (value: number) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft == null) return;
    const number = parseFloat(draft);
    setDraft(null);
    if (Number.isFinite(number)) onValue(Math.max(-100, Math.min(100, Math.round(number))));
  };
  return (
    <input className="cb-adjust-number" value={draft ?? String(value)} aria-label={`${label} (%)`} inputMode="numeric"
      {...scrubProps({ value, onChange: onValue, min: -100, max: 100 })}
      onFocus={(event) => { setDraft(String(value)); requestAnimationFrame(() => event.target.select()); }}
      onChange={(event) => setDraft(event.target.value)} onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") { commit(); (event.target as HTMLInputElement).blur(); }
        else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
          event.preventDefault();
          onValue(Math.max(-100, Math.min(100, value + (event.key === "ArrowUp" ? 1 : -1) * (event.shiftKey ? 10 : 1))));
        }
      }} />
  );
}

type Props = {
  /** What is being adjusted: text shows Shadow; a character has none. */
  hasShadow: boolean;
  /** "Sardar", "2 layers"… shown under the title. */
  targetLabel: string;
  onPreview: (settings: AdjustSettings | null) => void;
  onCreate: (settings: AdjustSettings) => void;
  onCancel: () => void;
};

export default function AdjustColourDialog({ hasShadow, targetLabel, onPreview, onCreate, onCancel }: Props) {
  const [settings, setSettings] = useState<AdjustSettings>({ mode: "rgb", convert: false, values: [0, 0, 0], fill: true, stroke: true, shadow: hasShadow });
  const [preview, setPreview] = useState(true);
  useEscClose(true, onCancel);
  const channels = ADJUST_CHANNELS[settings.mode];
  const setValue = (index: number, value: number) => setSettings((current) => {
    const values = [...current.values] as AdjustSettings["values"];
    values[index] = value;
    return { ...current, values };
  });
  const somethingChanges = settings.fill || settings.stroke || (hasShadow && settings.shadow);

  useEffect(() => { onPreview(preview ? settings : null); }, [preview, settings]); // eslint-disable-line react-hooks/exhaustive-deps

  // Enter = Create wherever focus is (a focused button keeps Enter for itself).
  const createRef = useRef(() => onCreate(settings));
  createRef.current = () => { if (somethingChanges) onCreate(settings); };
  const dialogRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Enter") return;
      const target = event.target as HTMLElement | null;
      if (target instanceof HTMLButtonElement && dialogRef.current?.contains(target)) return;
      if (target instanceof HTMLInputElement && target.classList.contains("cb-adjust-number")) return;
      event.preventDefault();
      event.stopPropagation();
      createRef.current();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  return (
    <div className="cb-adjust-backdrop" onKeyDown={(event: ReactKeyboardEvent) => event.stopPropagation()}>
      <div className="cb-adjust-dialog" role="dialog" aria-modal="true" aria-label="Adjust colour balance" ref={dialogRef}>
        <header><PanelClose onClose={onCancel} label="Cancel" />Adjust colour balance</header>
        <div className="cb-adjust-body">
          <small className="cb-adjust-target">{targetLabel}</small>
          <div className="cb-adjust-mode">
            <label>Colour Mode
              <select value={settings.mode} onChange={(event) => setSettings((current) => ({ ...current, mode: event.target.value as AdjustMode, values: [0, 0, 0] }))}>
                {MODES.map((mode) => <option key={mode.value} value={mode.value}>{mode.label}</option>)}
              </select>
            </label>
            <label className={`cb-adjust-check ${settings.mode !== "grey" ? "off" : ""}`} title="Greyscale: turn every colour grey first (otherwise only the greys change)">
              <input type="checkbox" checked={settings.convert} disabled={settings.mode !== "grey"} onChange={(event) => setSettings((current) => ({ ...current, convert: event.target.checked }))} /> Convert
            </label>
          </div>
          <div className="cb-adjust-sliders">
            {channels.map((label, index) => (
              <div key={`${settings.mode}-${label}`} className="cb-adjust-slider">
                <span>{label}</span>
                <input type="range" min={-100} max={100} step={1} value={settings.values[index]} aria-label={label}
                  onChange={(event) => setValue(index, Number(event.target.value))} onDoubleClick={() => setValue(index, 0)} />
                <PercentBox label={label} value={settings.values[index]} onValue={(value) => setValue(index, value)} />
                <i>%</i>
              </div>
            ))}
          </div>
          <div className="cb-adjust-checks">
            <label className="cb-adjust-check"><input type="checkbox" checked={settings.fill} onChange={(event) => setSettings((current) => ({ ...current, fill: event.target.checked }))} /> Fill</label>
            <label className="cb-adjust-check"><input type="checkbox" checked={settings.stroke} onChange={(event) => setSettings((current) => ({ ...current, stroke: event.target.checked }))} /> Stroke</label>
            <label className={`cb-adjust-check ${hasShadow ? "" : "off"}`} title={hasShadow ? "The text's shadow colour" : "Only text has a shadow"}>
              <input type="checkbox" checked={hasShadow && settings.shadow} disabled={!hasShadow} onChange={(event) => setSettings((current) => ({ ...current, shadow: event.target.checked }))} /> Shadow
            </label>
          </div>
          <div className="cb-adjust-actions">
            <label className="cb-adjust-check"><input type="checkbox" checked={preview} onChange={(event) => setPreview(event.target.checked)} /> Preview</label>
            <button type="button" className="cb-fs-cancel" onClick={onCancel}>Cancel</button>
            <button type="button" className="cb-fs-create" disabled={!somethingChanges} onClick={() => createRef.current()}>Create</button>
          </div>
        </div>
      </div>
    </div>
  );
}
