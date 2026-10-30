"use client";

import { useEffect, useMemo, useState } from "react";
import { ColourSwatch } from "./ColourPicker";
import { partLabel } from "@/lib/partLabels";
import { useEscClose } from "@/lib/escClose";
import PanelClose from "./PanelClose";
import type { ColorReplacement, EditorObject } from "@/types";

/**
 * Recolour panel, opened from the Fill/Stroke boxes at the bottom of the tool palette.
 * Illustrator-style palette (every colour the character uses; click one to recolour it and its
 * shades), with fills/strokes, exact or shades, whole character or the selected part. Find and
 * Replace across scenes/files lives in FindReplaceDialog. Bitmaps cannot be recoloured.
 */

type PaletteEntry = { color: string; fills: number; strokes: number; current: string };
type Target = ColorReplacement["target"];
type Match = ColorReplacement["match"];

type Props = {
  character: EditorObject | null;
  activePart: string | null;
  activePartLabel?: string;
  getFrame: () => HTMLIFrameElement | undefined;
  initialTarget: Target;
  pickedColor: string | null;
  /** Increments on every eyedropper pick, so picking the same colour again still applies. */
  pickNonce: number;
  pickActive: boolean;
  onRequestPick: (scope: string) => void;
  onPreview: (rule: ColorReplacement | null) => void;
  onCommit: (rule: Omit<ColorReplacement, "id">) => void;
  onRemove: (id: string) => void;
  onResetAll: () => void;
  onClose: () => void;
  position: { left: number; bottom: number };
};

const HEX = /^#[0-9a-f]{6}$/i;
const normalizeHex = (value: string) => {
  const text = value.trim().replace(/^([0-9a-f]{6})$/i, "#$1");
  return HEX.test(text) ? text.toLowerCase() : null;
};

export default function RecolorPanel({
  character, activePart, activePartLabel, getFrame, initialTarget, pickedColor, pickNonce, pickActive,
  onRequestPick, onPreview, onCommit, onRemove, onResetAll, onClose, position,
}: Props) {
  useEscClose(true, onClose);
  const [scope, setScope] = useState<string>(activePart || "*");
  const [find, setFind] = useState("");
  const [replace, setReplace] = useState("#c4702d");
  const [target, setTarget] = useState<Target>(initialTarget);
  const [match, setMatch] = useState<Match>("exact");
  const [palette, setPalette] = useState<PaletteEntry[]>([]);
  const [paletteState, setPaletteState] = useState<"loading" | "ready" | "empty">("loading");
  const [previewTick, setPreviewTick] = useState(0);
  const rules = useMemo(() => character?.colorReplacements || [], [character?.colorReplacements]);
  const rulesKey = JSON.stringify(rules);

  useEffect(() => { setTarget(initialTarget); }, [initialTarget]);
  useEffect(() => { setScope(activePart || "*"); }, [activePart, character?.id]);
  // Eyedropper result: the source colour under the pointer becomes "Find" (Animate: exact match).
  useEffect(() => {
    if (!pickedColor) return;
    const entry = palette.find((item) => item.color === pickedColor);
    setFind(pickedColor);
    setReplace(entry?.current || pickedColor);
    setMatch("exact");
  }, [pickNonce]); // eslint-disable-line react-hooks/exhaustive-deps

  // Colours used by the character (or the part), read from its player; it may still be loading.
  useEffect(() => {
    if (!character) { setPalette([]); setPaletteState("empty"); return; }
    let cancelled = false;
    let tries = 0;
    if (!palette.length) setPaletteState("loading");
    const load = () => {
      if (cancelled) return;
      let list: PaletteEntry[] | null = null;
      try {
        const fn = (getFrame()?.contentWindow as (Window & { cbColorPalette?: (scope: string) => PaletteEntry[] }) | null | undefined)?.cbColorPalette;
        if (typeof fn === "function") list = fn(scope === "*" ? "" : scope);
      } catch { list = null; }
      if (list && list.length) { setPalette(list); setPaletteState("ready"); return; }
      if (++tries < 20) window.setTimeout(load, 400);
      else { setPalette([]); setPaletteState("empty"); }
    };
    load();
    return () => { cancelled = true; };
  }, [character?.id, scope, rulesKey, previewTick]); // eslint-disable-line react-hooks/exhaustive-deps

  const findHex = normalizeHex(find);
  const replaceHex = normalizeHex(replace);
  const ready = Boolean(character && findHex && replaceHex && findHex !== replaceHex);

  // Live preview while choosing; cleared when the panel closes or the rule is saved.
  useEffect(() => {
    if (!ready || !findHex || !replaceHex) { onPreview(null); return; }
    onPreview({ id: "preview", from: findHex, to: replaceHex, target, scope, match });
    const timer = window.setTimeout(() => setPreviewTick((tick) => tick + 1), 350);
    return () => window.clearTimeout(timer);
  }, [ready, findHex, replaceHex, target, scope, match]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => onPreview(null), []); // eslint-disable-line react-hooks/exhaustive-deps

  const pickSwatch = (entry: PaletteEntry) => {
    setFind(entry.color);
    setReplace(entry.current);
    // Palette edits move the colour family together (Illustrator Recolor Artwork).
    setMatch("shades");
  };

  const commit = () => {
    if (!ready || !findHex || !replaceHex) return;
    onCommit({ from: findHex, to: replaceHex, target, scope, match });
    onPreview(null);
  };

  const scopeLabel = (value: string) => value === "*" ? "Whole character" : `Part: ${partLabel(character, value)}`;

  return (
    <div className="cb-recolor-panel" role="dialog" aria-label="Recolour character" style={{ left: position.left, bottom: position.bottom }}>
      <header>
        <PanelClose onClose={onClose} label="Close Recolour" />
        <strong>Recolour</strong>
      </header>

      {!character ? (
        <p className="cb-recolor-empty">Select a character on the canvas to recolour it.</p>
      ) : (
        <>
          <div className="cb-recolor-scope" role="radiogroup" aria-label="Recolour scope">
            <button type="button" className={scope === "*" ? "active" : ""} onClick={() => setScope("*")}>Whole character</button>
            {activePart && <button type="button" className={scope === activePart ? "active" : ""} onClick={() => setScope(activePart)}>{activePartLabel || activePart}</button>}
          </div>

          <section>
            <h4>{scope === "*" ? "Character colours" : `${activePartLabel || scope} colours`}</h4>
            {paletteState === "loading" && <p className="cb-recolor-hint">Reading colours…</p>}
            {paletteState === "empty" && <p className="cb-recolor-hint">No vector colours found. Bitmap artwork can't be recoloured.</p>}
            {paletteState === "ready" && (
              <div className="cb-recolor-swatches">
                {palette.map((entry) => (
                  <button
                    key={entry.color}
                    type="button"
                    className={`cb-recolor-swatch ${findHex === entry.color ? "active" : ""}`}
                    style={{ background: entry.current === entry.color ? entry.color : `linear-gradient(135deg, ${entry.color} 50%, ${entry.current} 50%)` }}
                    title={`${entry.color}${entry.current !== entry.color ? ` → ${entry.current}` : ""} · ${entry.fills} fills, ${entry.strokes} strokes`}
                    onClick={() => pickSwatch(entry)}
                  />
                ))}
              </div>
            )}
            <p className="cb-recolor-hint">Click a colour to recolour it and its shades.</p>
          </section>

          <section>
            <h4>Recolour colour</h4>
            <div className="cb-recolor-row">
              <span>Colour</span>
              <span className="cb-recolor-chip" style={{ background: findHex || "transparent" }} />
              <input value={find} onChange={(event) => setFind(event.target.value)} placeholder="#rrggbb" aria-label="Colour to recolour" />
              <button type="button" className={`cb-recolor-pick ${pickActive ? "active" : ""}`} onClick={() => onRequestPick(scope)} title="Pick the colour from the character">
                <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M10.6 2.2l3.2 3.2-1.4 1.4-.7-.7-5.6 5.6-2.4.7.7-2.4 5.6-5.6-.7-.7z" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/></svg>
              </button>
            </div>
            <div className="cb-recolor-row">
              <span>New</span>
              <ColourSwatch value={replaceHex || "#000000"} onChange={setReplace} label="Replace with colour" />
              <input value={replace} onChange={(event) => setReplace(event.target.value)} placeholder="#rrggbb" aria-label="Replace with hex" />
            </div>
            <div className="cb-recolor-options">
              <label>Apply to
                <select value={target} onChange={(event) => setTarget(event.target.value as Target)}>
                  <option value="both">Fills and strokes</option>
                  <option value="fill">Fills</option>
                  <option value="stroke">Strokes</option>
                </select>
              </label>
              <label>Match
                <select value={match} onChange={(event) => setMatch(event.target.value as Match)}>
                  <option value="exact">Exact colour</option>
                  <option value="shades">Similar shades</option>
                </select>
              </label>
            </div>
            <button type="button" className="cb-recolor-apply" disabled={!ready} onClick={commit}>Recolour · {scopeLabel(scope)}</button>
            <p className="cb-recolor-hint">Text, fonts, other scenes or files: Find and Replace (Shift+Cmd/Ctrl+F).</p>
          </section>

          {rules.length > 0 && (
            <section>
              <h4>Changes <button type="button" className="cb-recolor-reset" onClick={onResetAll}>Reset all</button></h4>
              <ul className="cb-recolor-rules">
                {rules.map((rule) => (
                  <li key={rule.id}>
                    <span className="cb-recolor-chip" style={{ background: rule.from }} />→<span className="cb-recolor-chip" style={{ background: rule.to }} />
                    <small>{rule.match === "shades" ? "shades" : "exact"} · {rule.target === "both" ? "fill+stroke" : rule.target} · {scopeLabel(rule.scope)}</small>
                    <button type="button" onClick={() => onRemove(rule.id)} aria-label={`Remove ${rule.from} to ${rule.to}`}>×</button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}
