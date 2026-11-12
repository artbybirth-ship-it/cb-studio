"use client";

import { useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import type { EditorObject } from "@/types";
import { DEFAULT_FONT, fontCss, styleName, type FontFaceInfo, type FontFamilyInfo } from "@/lib/fonts";
import { listedSystemFamilies } from "@/lib/localFonts";
import { useEscClose } from "@/lib/escClose";
import { scrubProps } from "@/lib/scrub";
import PanelClose from "./PanelClose";
import { FontBrowser, StyleList } from "./FontBrowser";

/**
 * Text panel (Illustrator, horizontal type; mockup): the Text tool, paragraph alignment, font family
 * and style (cards), font size, leading and tracking. It works on the selected text layer, or sets
 * the defaults for the next text typed. Opened beside the Text tool on the rail (T, then Return),
 * stays open while you type, closes with × or Esc.
 */
export type TextValues = Pick<EditorObject, "fontFamily" | "fontWeight" | "fontStyle" | "fontUrl" | "fontSize" | "lineHeight" | "letterSpacing" | "textAlign">;

const SIZES = [6, 8, 10, 12, 14, 18, 24, 30, 36, 48, 52, 60, 72, 96, 120, 144, 200, 300];
const TRACKING = [-100, -75, -50, -25, -10, 0, 10, 25, 50, 75, 100, 200];
const round = (value: number) => Math.round(value * 100) / 100;

/** A number with a ▲▼ stepper, drag-to-change, typing and a ▾ list of presets (as Transform's angle). */
function TextNumber({ icon, label, value, unit, presets, autoLabel, min, max, step = 1, onChange }: {
  icon: ReactNode; label: string; value: number; unit: string; presets: number[]; autoLabel?: string;
  min: number; max: number; step?: number; onChange: (value: number | undefined) => void;
}) {
  const [text, setText] = useState<string | null>(null);
  const clamp = (next: number) => Math.max(min, Math.min(max, round(next)));
  const commit = () => {
    if (text == null) return;
    setText(null);
    if (autoLabel && /^\s*auto\s*$/i.test(text)) { onChange(undefined); return; }
    const parsed = parseFloat(text.replace(",", "."));
    if (Number.isFinite(parsed)) onChange(clamp(parsed));
  };
  const shown = text ?? (autoLabel ? autoLabel : `${round(value)}${unit ? ` ${unit}` : ""}`);
  return (
    <div className="cb-text-number" title={autoLabel ? `Auto: ${round(value)} ${unit} (120% of the font size)` : undefined}>
      <div className="cb-tf-angle">
        <span className="cb-tf-angle-icon cb-text-number-icon" aria-hidden="true">{icon}</span>
        <span className="cb-tf-anglepill">
          <span className="cb-tf-stepper">
            <button type="button" aria-label={`${label} up`} onClick={() => onChange(clamp(value + step))}><svg viewBox="0 0 10 6" aria-hidden="true"><path d="M1 5l4-4 4 4" fill="none" stroke="currentColor" strokeWidth="1.3" /></svg></button>
            <button type="button" aria-label={`${label} down`} onClick={() => onChange(clamp(value - step))}><svg viewBox="0 0 10 6" aria-hidden="true"><path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.3" /></svg></button>
          </span>
          <label className="cb-tf-field">
            <input type="text" inputMode="decimal" aria-label={label} value={shown}
              {...scrubProps({ value, onChange: (next) => onChange(next), min, max, step, decimals: 1 })}
              onFocus={(event) => { setText(autoLabel ? "Auto" : String(round(value))); requestAnimationFrame(() => event.target.select()); }}
              onChange={(event) => setText(event.target.value)} onBlur={commit}
              onKeyDown={(event) => {
                if (event.key === "Enter") (event.target as HTMLInputElement).blur();
                else if (event.key === "Escape") { setText(null); (event.target as HTMLInputElement).blur(); }
                else if (event.key === "ArrowUp" || event.key === "ArrowDown") { event.preventDefault(); setText(null); onChange(clamp(value + (event.key === "ArrowUp" ? 1 : -1) * step * (event.shiftKey ? 10 : 1))); }
              }} />
          </label>
          <i aria-hidden="true" />
          <select aria-label={`${label} presets`} value="" onChange={(event) => { const next = event.target.value; if (next === "auto") onChange(undefined); else if (next !== "") onChange(Number(next)); }}>
            <option value="" disabled hidden />
            {autoLabel != null && <option value="auto">Auto</option>}
            {presets.map((preset) => <option key={preset} value={preset}>{preset}{unit ? ` ${unit}` : ""}</option>)}
          </select>
        </span>
      </div>
      <small>{label}</small>
    </div>
  );
}

/** Four lines of text, the second shorter, set left / centre / right. */
const AlignIcon = ({ align }: { align: "left" | "center" | "right" }) => (
  <svg viewBox="0 0 24 20" aria-hidden="true">
    {[20, 14, 20, 20].map((width, index) => {
      const x = align === "left" ? 2 : align === "right" ? 22 - width : 12 - width / 2;
      return <path key={index} d={`M${x} ${4 + index * 4.5}h${width}`} stroke="currentColor" strokeWidth="1" strokeLinecap="round" />;
    })}
  </svg>
);

export default function TextPanel({ values, installed, textToolActive, onTextTool, onChange, onPickFace, onClose, anchorRef }: {
  values: TextValues;
  installed: FontFamilyInfo[];
  textToolActive: boolean;
  onTextTool: () => void;
  onChange: (patch: Partial<EditorObject>) => void;
  onPickFace: (family: FontFamilyInfo, face: FontFaceInfo) => void;
  onClose: () => void;
  anchorRef: RefObject<HTMLElement | null>;
}) {
  useEscClose(true, onClose);
  const panelRef = useRef<HTMLDivElement>(null);
  const [card, setCard] = useState<"fonts" | "styles" | null>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  // Opens beside the Text tool on the rail (then dragged anywhere by its header).
  useLayoutEffect(() => {
    const anchor = anchorRef.current?.getBoundingClientRect();
    const height = panelRef.current?.offsetHeight || 360;
    const top = anchor ? Math.max(8, Math.min(anchor.top - 12, window.innerHeight - height - 8)) : 120;
    setPosition({ left: anchor ? Math.round(anchor.right + 12) : 80, top: Math.round(top) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const familyName = values.fontFamily || DEFAULT_FONT;
  const weight = values.fontWeight ?? 400;
  const italic = values.fontStyle === "italic";
  const size = Number(values.fontSize || 52);
  const family: FontFamilyInfo = installed.find((item) => item.name === familyName)
    || listedSystemFamilies()?.find((item) => item.name === familyName)
    || { name: familyName, css: fontCss(familyName), faces: [{ weight, italic, url: values.fontUrl }], source: "builtin" };
  const align = values.textAlign || "left";

  return (
    <div ref={panelRef} className="cb-text-panel-float" role="dialog" aria-label="Text panel" data-text-ui
      style={position ? { left: position.left, top: position.top } : { visibility: "hidden" }}>
      <header><PanelClose onClose={onClose} label="Close Text panel" />Text panel (T+return)</header>
      <div className="cb-text-panel-body">
        <div className="cb-text-panel-top">
          <button type="button" className={`cb-text-tool-button ${textToolActive ? "active" : ""}`} aria-pressed={textToolActive} onClick={onTextTool} title="Text tool (T): click the canvas to type">
            <svg viewBox="31.86 152.09 32 32" aria-hidden="true"><path d="M47.86,160.92v14.34M55.49,160.92h-15.25M55.49,160.92v1.8M40.24,160.92v1.8M49.66,175.26h-3.6" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" /></svg>
            <span>Text (T)</span>
          </button>
          <div className="cb-text-paragraph">
            <span>Paragraph</span>
            <div className="cb-text-align" role="radiogroup" aria-label="Paragraph alignment">
              {(["left", "center", "right"] as const).map((value) => (
                <button key={value} type="button" role="radio" aria-checked={align === value} className={align === value ? "on" : ""} onClick={() => onChange({ textAlign: value })}
                  title={`Align ${value === "center" ? "centre" : value} (⌘⇧${value === "left" ? "L" : value === "center" ? "C" : "R"})`}>
                  <AlignIcon align={value} />
                </button>
              ))}
            </div>
            <div className="cb-text-align-keys" aria-hidden="true"><span>(⌘ ⇧ L)</span><span>(⌘ ⇧ C)</span><span>(⌘ ⇧ R)</span></div>
          </div>
        </div>

        <button type="button" className={`cb-text-select ${card === "fonts" ? "open" : ""}`} onClick={() => setCard(card === "fonts" ? null : "fonts")} aria-haspopup="dialog" aria-expanded={card === "fonts"}>
          <span style={{ fontFamily: family.css }}>{familyName}</span><i aria-hidden="true" />
          <svg viewBox="0 0 12 8" aria-hidden="true"><path d="M1.5 2l4.5 4 4.5-4" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
        <button type="button" className={`cb-text-select ${card === "styles" ? "open" : ""}`} onClick={() => setCard(card === "styles" ? null : "styles")} aria-haspopup="listbox" aria-expanded={card === "styles"}>
          <span>{styleName(weight, italic)}</span><i aria-hidden="true" />
          <svg viewBox="0 0 12 8" aria-hidden="true"><path d="M1.5 2l4.5 4 4.5-4" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>

        <div className="cb-text-numbers">
          <TextNumber label="Font size" value={size} unit="px" presets={SIZES} min={1} max={1296} onChange={(next) => onChange({ fontSize: next ?? 52 })}
            icon={<svg viewBox="0 0 28 22"><g fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="square"><path d="M9 2h16M17 2v19M14.5 21h5M1 11h10M6 11v10M4 21h4" /></g></svg>} />
          <TextNumber label="Leading" value={values.lineHeight ?? round(size * 1.2)} autoLabel={values.lineHeight == null ? "Auto" : undefined}
            unit="px" presets={SIZES} min={1} max={2000} onChange={(next) => onChange({ lineHeight: next })}
            icon={<svg viewBox="0 0 28 22"><g fill="none" stroke="currentColor" strokeWidth="1.1"><path d="M1 1h16M1 11h16M1 21h16M24 1v20M21.5 3.5L24 1l2.5 2.5M21.5 18.5L24 21l2.5-2.5" /><path d="M5 9.5l4-8 4 8M6.3 7h5.4M5 19.5l4-8 4 8M6.3 17h5.4" /></g></svg>} />
          <TextNumber label="Spacing between two characters" value={Number(values.letterSpacing || 0)} unit="" presets={TRACKING} min={-1000} max={10000} step={10}
            onChange={(next) => onChange({ letterSpacing: next ?? 0 })}
            icon={<svg viewBox="0 0 28 22"><g fill="none" stroke="currentColor" strokeWidth="1.1"><path d="M1 1v20M14 1v16M27 1v20M2 19h24M4.5 16.5L2 19l2.5 2.5M23.5 16.5L26 19l-2.5 2.5" /><path d="M3.5 13l3.5-9 3.5 9M4.7 10h4.6M16.5 13l3.5-9 3.5 9M17.7 10h4.6" /></g></svg>} />
        </div>
      </div>
      {card === "fonts" && (
        <FontBrowser current={familyName} installed={installed} onClose={() => setCard(null)}
          onPick={(picked, face) => { onPickFace(picked, face); setCard(null); }} />
      )}
      {card === "styles" && (
        <StyleList family={family} weight={weight} italic={italic} onPick={(face) => { onPickFace(family, face); setCard(null); }} />
      )}
    </div>
  );
}

