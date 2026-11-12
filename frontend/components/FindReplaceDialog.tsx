"use client";

import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { FONT_OPTIONS, fontCss } from "@/lib/fonts";
import { normalizeHex, type FindContext, type FindKind, type FindRequest } from "@/lib/findReplace";
import { useEscClose } from "@/lib/escClose";
import PanelClose from "./PanelClose";

/** Find and Replace dialog (Colour / Text / Font across a context), designed after Adobe Animate's. */

type PickTarget = "find" | "replace";
type Duplicate = { characterId: string; name: string };
type Preserve = { characters: { id: string; name: string }[]; takenNames: string[] };
type Props = {
  onClose: () => void;
  /** Runs the replacement; resolves to a message, or rejects/returns null when nothing matched. */
  onReplace: (request: FindRequest, options?: { duplicates?: Duplicate[] }) => Promise<{ message: string; changed: boolean }>;
  /** "All character library": the My characters that use the colour (one per package), before anything changes. */
  onPrepareLibrary: (request: FindRequest) => Promise<{ characters: { id: string; name: string }[]; takenNames: string[]; message?: string }>;
  /** Canvas eyedropper: the editor calls back through `picked` with the colour. */
  onRequestPick: (target: PickTarget) => void;
  picking: PickTarget | null;
  picked: { target: PickTarget; color: string; nonce: number } | null;
};

const KINDS: { value: FindKind; label: string }[] = [
  { value: "text", label: "Text" },
  { value: "font", label: "Font" },
  { value: "colour", label: "Colour" },
];
const CONTEXTS: { value: FindContext; label: string }[] = [
  { value: "frame", label: "Current Frame" },
  { value: "scene", label: "Current Scene" },
  { value: "document", label: "Current Document" },
  { value: "open-files", label: "All Opened Files" },
  { value: "library", label: "All character library" },
];

const Chevron = () => <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3 4.5l3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>;
const Pipette = () => <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M10.6 2.2l3.2 3.2-1.4 1.4-.7-.7-5.6 5.6-2.4.7.7-2.4 5.6-5.6-.7-.7z" fill="currentColor"/></svg>;

/** Small dropdown pill (Search / Context) with a check on the chosen item. */
function Dropdown<T extends string>({ value, options, onChange, wide, disabledValues }: { value: T; options: { value: T; label: string }[]; onChange: (value: T) => void; wide?: boolean; disabledValues?: T[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => { if (!ref.current?.contains(event.target as Node)) setOpen(false); };
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [open]);
  return (
    <div className={`cb-fr-dropdown ${wide ? "wide" : ""}`} ref={ref}>
      <button type="button" className="cb-fr-pill" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <span>{options.find((option) => option.value === value)?.label}</span><Chevron />
      </button>
      {open && (
        <div className="cb-fr-menu" role="listbox">
          {options.map((option) => {
            const disabled = disabledValues?.includes(option.value);
            return (
              <button key={option.value} type="button" role="option" aria-selected={option.value === value} disabled={disabled}
                className={option.value === value ? "selected" : ""} onClick={() => { onChange(option.value); setOpen(false); }}>
                <span>{option.label}</span>{option.value === value && <svg viewBox="0 0 16 12" aria-hidden="true"><path d="M1.5 6.5l4 4 9-9" fill="none" stroke="currentColor" strokeWidth="1.3"/></svg>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** "Select colour" bubble: spectrum (hue across, light → dark down), colour code, Use picker. */
function ColourBubble({ color, onChange, onUsePicker, side }: { color: string; onChange: (hex: string) => void; onUsePicker: () => void; side: "left" | "right" }) {
  const [code, setCode] = useState(color.replace("#", ""));
  const [marker, setMarker] = useState<{ x: number; y: number } | null>(null);
  useEffect(() => { setCode(color.replace("#", "")); }, [color]);
  const pickAt = (event: ReactPointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    const y = Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height));
    setMarker({ x, y });
    // Hue left → right at full saturation; top = white, middle = pure hue, bottom = black.
    const h = x * 360, l = 1 - y, c = (1 - Math.abs(2 * l - 1)), hp = h / 60, xx = c * (1 - Math.abs((hp % 2) - 1)), m = l - c / 2;
    const [r, g, b] = hp < 1 ? [c, xx, 0] : hp < 2 ? [xx, c, 0] : hp < 3 ? [0, c, xx] : hp < 4 ? [0, xx, c] : hp < 5 ? [xx, 0, c] : [c, 0, xx];
    onChange(`#${[r, g, b].map((v) => Math.round((v + m) * 255).toString(16).padStart(2, "0")).join("")}`);
  };
  return (
    <div className={`cb-fr-bubble ${side}`} role="dialog" aria-label="Select colour" onPointerDown={(event) => event.stopPropagation()}>
      <div className="cb-fr-bubble-title">Select colour</div>
      <div className="cb-fr-spectrum" onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); pickAt(event); }} onPointerMove={(event) => { if (event.buttons) pickAt(event); }}>
        {marker && <span className="cb-fr-marker" style={{ left: `${marker.x * 100}%`, top: `${marker.y * 100}%` }}>+</span>}
      </div>
      <div className="cb-fr-bubble-row">
        <label>colour code <span className="cb-fr-code"><i>#</i><input value={code} maxLength={7}
          onChange={(event) => { const value = event.target.value.replace("#", ""); setCode(value); const hex = normalizeHex(value); if (hex) onChange(hex); }} aria-label="Colour code" /></span></label>
        <button type="button" className="cb-fr-usepicker" onClick={onUsePicker}>Use picker <span><Pipette /></span></button>
      </div>
    </div>
  );
}

/** Font field: type to filter, choose from the list (each name shown in its own font). */
function FontField({ value, onChange, placeholder }: { value: string; onChange: (value: string) => void; placeholder: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const list = useMemo(() => FONT_OPTIONS.filter((font) => !value || font.name.toLowerCase().includes(value.toLowerCase()) || FONT_OPTIONS.some((f) => f.name === value)), [value]);
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => { if (!ref.current?.contains(event.target as Node)) setOpen(false); };
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [open]);
  return (
    <div className="cb-fr-dropdown wide" ref={ref}>
      <div className="cb-fr-pill cb-fr-font">
        <input value={value} placeholder={placeholder} onFocus={() => setOpen(true)} onChange={(event) => { onChange(event.target.value); setOpen(true); }} style={{ fontFamily: value ? fontCss(value) : undefined }} />
        <button type="button" onClick={() => setOpen((v) => !v)} aria-label="Show fonts"><Chevron /></button>
      </div>
      {open && (
        <div className="cb-fr-menu" role="listbox">
          {list.map((font) => (
            <button key={font.name} type="button" role="option" aria-selected={font.name === value} className={font.name === value ? "selected" : ""}
              style={{ fontFamily: font.css }} onClick={() => { onChange(font.name); setOpen(false); }}>
              <span>{font.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** "Shambhu copy", or "Shambhu copy 2" … when that name is already in My characters. */
const freeName = (base: string, taken: Set<string>) => {
  let name = `${base} copy`;
  for (let index = 2; taken.has(name.toLowerCase()); index += 1) name = `${base} copy ${index}`;
  taken.add(name.toLowerCase());
  return name;
};

export default function FindReplaceDialog({ onClose, onReplace, onPrepareLibrary, onRequestPick, picking, picked }: Props) {
  const [kind, setKind] = useState<FindKind>("colour");
  const [context, setContext] = useState<FindContext>("document");
  const [findColour, setFindColour] = useState("#4f7cff");
  const [replaceColour, setReplaceColour] = useState("#93562a");
  const [bubble, setBubble] = useState<PickTarget | null>(null);
  const [findText, setFindText] = useState("");
  const [replaceText, setReplaceText] = useState("");
  const [findFont, setFindFont] = useState("");
  const [replaceFont, setReplaceFont] = useState("");
  const [status, setStatus] = useState<{ text: string; tone: "info" | "error" } | null>(null);
  const [busy, setBusy] = useState(false);
  // Second step for "All character library": duplicate the characters first (on by default).
  const [preserve, setPreserve] = useState<Preserve | null>(null);
  const [keepOriginal, setKeepOriginal] = useState(true);
  const [copyNames, setCopyNames] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!picked) return;
    if (picked.target === "find") setFindColour(picked.color); else setReplaceColour(picked.color);
  }, [picked?.nonce]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (kind !== "colour" && context === "library") setContext("document"); }, [kind, context]);
  // Esc: the "Preserve the original?" question first, then an open colour bubble, then the dialog.
  // Picking on the canvas registers on top (EditorShell), so Esc cancels the pick first.
  useEscClose(true, () => { if (preserve) setPreserve(null); else if (bubble) setBubble(null); else onClose(); });

  const request: FindRequest = kind === "colour"
    ? { kind, context, find: findColour, replace: replaceColour }
    : kind === "text" ? { kind, context, find: findText, replace: replaceText }
      : { kind, context, find: findFont, replace: replaceFont };
  const valid = kind === "colour" ? Boolean(normalizeHex(findColour) && normalizeHex(replaceColour) && normalizeHex(findColour) !== normalizeHex(replaceColour))
    : kind === "text" ? findText.length > 0 && findText !== replaceText
      : Boolean(findFont.trim() && replaceFont.trim() && findFont.trim() !== replaceFont.trim());

  const run = async () => {
    if (!valid || busy) return;
    setBusy(true);
    setStatus(null);
    try {
      if (request.kind === "colour" && request.context === "library") {
        // Nothing changes yet: first offer to keep the originals by duplicating them.
        const found = await onPrepareLibrary(request);
        if (!found.characters.length) { setStatus({ text: found.message || "No matches found.", tone: "info" }); return; }
        const taken = new Set(found.takenNames.map((name) => name.toLowerCase()));
        setCopyNames(Object.fromEntries(found.characters.map((character) => [character.id, freeName(character.name, taken)])));
        setKeepOriginal(true);
        setPreserve(found);
        return;
      }
      const result = await onReplace(request);
      if (result.changed) onClose();
      else setStatus({ text: result.message, tone: "info" });
    } catch (error) {
      setStatus({ text: error instanceof Error ? error.message : "Replace failed", tone: "error" });
    } finally {
      setBusy(false);
    }
  };

  // Copy names must be filled in, differ from each other and from every name already in My characters.
  const nameProblem = (() => {
    if (!preserve || !keepOriginal) return null;
    const taken = new Set(preserve.takenNames.map((name) => name.toLowerCase()));
    const seen = new Set<string>();
    for (const character of preserve.characters) {
      const name = (copyNames[character.id] || "").replace(/\s+/g, " ").trim();
      if (!name) return { id: character.id, text: "Name the copy." };
      if (taken.has(name.toLowerCase()) || seen.has(name.toLowerCase())) return { id: character.id, text: `“${name}” is already in My characters.` };
      seen.add(name.toLowerCase());
    }
    return null;
  })();

  const confirmLibrary = async () => {
    if (!preserve || busy || nameProblem) return;
    setBusy(true);
    setStatus(null);
    try {
      const duplicates = keepOriginal ? preserve.characters.map((character) => ({ characterId: character.id, name: (copyNames[character.id] || "").replace(/\s+/g, " ").trim() })) : undefined;
      const result = await onReplace(request, { duplicates });
      if (result.changed) onClose();
      else { setPreserve(null); setStatus({ text: result.message, tone: "info" }); }
    } catch (error) {
      setPreserve(null);
      setStatus({ text: error instanceof Error ? error.message : "Replace failed", tone: "error" });
    } finally {
      setBusy(false);
    }
  };

  const swatch = (target: PickTarget, color: string, label: string) => (
    <div className="cb-fr-colour">
      <span>{label}</span>
      <button type="button" className={`cb-fr-pipette ${picking === target ? "active" : ""}`} onClick={() => { setBubble(null); onRequestPick(target); }} title={`Pick the ${target === "find" ? "colour to find" : "new colour"} from the canvas`}><Pipette /></button>
      <button type="button" className={`cb-fr-swatch ${bubble === target ? "open" : ""}`} style={{ background: color }} onClick={() => setBubble((open) => (open === target ? null : target))} aria-label={`${label}: ${color}`} />
      {bubble === target && (
        <ColourBubble color={color} side={target === "find" ? "right" : "left"}
          onChange={(hex) => (target === "find" ? setFindColour(hex) : setReplaceColour(hex))}
          onUsePicker={() => { setBubble(null); onRequestPick(target); }} />
      )}
    </div>
  );

  return (
    <div className={`cb-fr-backdrop ${picking ? "picking" : ""}`} onPointerDown={(event) => { if (event.target === event.currentTarget) setBubble(null); }}>
      {picking && <div className="cb-fr-pick-banner">Click a colour on the canvas · Esc to cancel</div>}
      <div className="cb-fr-dialog" role="dialog" aria-label="Find and Replace" aria-modal="true">
        <header><PanelClose onClose={onClose} label="Close Find and Replace" />Find and Replace</header>
        <div className="cb-fr-body">
          <div className="cb-fr-line"><span className="cb-fr-label">Search</span><Dropdown value={kind} options={KINDS} onChange={(value) => { setKind(value); setStatus(null); }} /></div>

          {kind === "colour" ? (
            <>
              <div className="cb-fr-colours">
                {swatch("find", findColour, "Find colour")}
                {swatch("replace", replaceColour, "Replace with")}
              </div>
              <div className="cb-fr-line"><span className="cb-fr-label">Context</span><Dropdown wide value={context} options={CONTEXTS} onChange={setContext} /></div>
            </>
          ) : (
            <>
              <div className="cb-fr-line"><span className="cb-fr-label">Context</span><Dropdown wide value={context} options={CONTEXTS} onChange={setContext} disabledValues={["library"]} /></div>
              {kind === "text" ? (
                <>
                  <label className="cb-fr-block">Find text<textarea value={findText} onChange={(event) => setFindText(event.target.value)} placeholder="Type text you want to find" /></label>
                  <label className="cb-fr-block">Replace with<textarea value={replaceText} onChange={(event) => setReplaceText(event.target.value)} placeholder="Type text you want to replace with!" /></label>
                </>
              ) : (
                <>
                  <div className="cb-fr-block">Find Font<FontField value={findFont} onChange={setFindFont} placeholder="Type font you want to find" /></div>
                  <div className="cb-fr-block">Replace with<FontField value={replaceFont} onChange={setReplaceFont} placeholder="Type font to replace with" /></div>
                </>
              )}
            </>
          )}

          {status && <p className={`cb-fr-status ${status.tone}`} role="status">{status.text}</p>}
          <div className="cb-fr-actions">
            <button type="button" className="cb-fr-cancel" onClick={onClose}>Cancel</button>
            <button type="button" className="cb-fr-replace" disabled={!valid || busy} onClick={() => void run()}>{busy ? "Replacing…" : "Replace"}</button>
          </div>
        </div>
      </div>

      {preserve && (
        <div className="cb-fr-preserve-layer">
          <div className="cb-fr-dialog cb-fr-preserve" role="dialog" aria-label="Preserve the original?" aria-modal="true">
            <header><PanelClose onClose={() => setPreserve(null)} label="Back" />Preserve the original?</header>
            <div className="cb-fr-body">
              <p className="cb-fr-note">
                {preserve.characters.length === 1 ? `“${preserve.characters[0].name}” uses` : `${preserve.characters.length} of My characters use`} <span className="cb-fr-chip" style={{ background: findColour }} /> {findColour}.
                {" "}Recolouring changes {preserve.characters.length === 1 ? "it" : "them"} in the library.
              </p>
              <label className="cb-fr-check">
                <input type="checkbox" checked={keepOriginal} onChange={(event) => setKeepOriginal(event.target.checked)} />
                <span>Create a duplicate library before proceeding</span>
              </label>
              {keepOriginal ? (
                <div className="cb-fr-names">
                  {preserve.characters.map((character) => (
                    <label key={character.id} className="cb-fr-name">
                      <span>Name the copy of {character.name}</span>
                      <input value={copyNames[character.id] || ""} aria-invalid={nameProblem?.id === character.id} maxLength={80}
                        onChange={(event) => setCopyNames((names) => ({ ...names, [character.id]: event.target.value }))}
                        onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void confirmLibrary(); } }} />
                    </label>
                  ))}
                  <p className="cb-fr-hint">{nameProblem ? <em>{nameProblem.text}</em> : "The copy gets the new colour. The original and the characters already in your scenes stay as they are."}</p>
                </div>
              ) : (
                <p className="cb-fr-hint warn">No copy: the original{preserve.characters.length === 1 ? "" : "s"} in My characters and the characters of {preserve.characters.length === 1 ? "that kind" : "those kinds"} in this document change to the new colour.</p>
              )}
              <div className="cb-fr-actions">
                <button type="button" className="cb-fr-cancel" onClick={() => setPreserve(null)} disabled={busy}>Cancel</button>
                <button type="button" className="cb-fr-replace" disabled={busy || Boolean(nameProblem)} onClick={() => void confirmLibrary()}>
                  {busy ? (keepOriginal ? "Creating…" : "Replacing…") : keepOriginal ? "Create" : "Replace"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
