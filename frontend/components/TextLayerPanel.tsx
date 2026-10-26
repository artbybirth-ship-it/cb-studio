"use client";

import { useRef, useState } from "react";
import type { EditorObject } from "@/types";
import { DEFAULT_FONT, FONT_OPTIONS, fontCss } from "@/lib/fonts";
import Popover from "./Popover";
import { ColourSwatch } from "./ColourPicker";

/** Right-hand panel for a selected text layer: words, font, colour and size. */
type Props = {
  layer: EditorObject;
  onPatch: (patch: Partial<EditorObject>, recordHistory?: boolean) => void;
  onBack: () => void;
};

export default function TextLayerPanel({ layer, onPatch, onBack }: Props) {
  const [fontsOpen, setFontsOpen] = useState(false);
  const fontRef = useRef<HTMLButtonElement>(null);
  const font = layer.fontFamily || DEFAULT_FONT;

  return (
    <aside className="cb-text-panel" aria-label="Text layer">
      <header>
        <button type="button" onClick={onBack} aria-label="Back to library">←</button>
        <strong>Text</strong>
      </header>

      <label className="cb-text-field">Text
        <textarea
          value={layer.text ?? ""}
          rows={3}
          onChange={(event) => onPatch({ text: event.target.value }, false)}
          onBlur={(event) => onPatch({ text: event.target.value }, true)}
          style={{ fontFamily: fontCss(font) }}
        />
      </label>

      <label className="cb-text-field">Font
        <button type="button" ref={fontRef} className="cb-font-button" style={{ fontFamily: fontCss(font) }} onClick={() => setFontsOpen((open) => !open)} aria-haspopup="listbox" aria-expanded={fontsOpen}>
          <span>{font}</span>
          <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3 4.5l3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></svg>
        </button>
      </label>
      <Popover open={fontsOpen} anchorRef={fontRef} onClose={() => setFontsOpen(false)} matchAnchorWidth role="listbox" aria-label="Fonts" className="cb-font-menu">
        {FONT_OPTIONS.map((option) => (
          <button key={option.name} type="button" role="option" aria-selected={option.name === font} className={option.name === font ? "active" : ""} style={{ fontFamily: option.css }}
            onClick={() => { onPatch({ fontFamily: option.name }, true); setFontsOpen(false); }}>
            {option.name}
          </button>
        ))}
      </Popover>

      <div className="cb-text-row">
        <label className="cb-text-field">Colour
          <span className="cb-text-color">
            <ColourSwatch value={layer.fillColor || "#ffffff"} onChange={(hex) => onPatch({ fillColor: hex }, true)} label="Text colour" />
            <code>{layer.fillColor || "#ffffff"}</code>
          </span>
        </label>
        <label className="cb-text-field">Size
          <input type="number" min={8} max={400} value={Number(layer.fontSize || 52)}
            onChange={(event) => onPatch({ fontSize: Math.max(8, Math.min(400, Number(event.target.value) || 52)) }, true)} />
        </label>
      </div>
    </aside>
  );
}
