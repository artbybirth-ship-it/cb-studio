"use client";

/**
 * The native pose editor in a window over the scene: loads the character's .fla, opens the pose
 * the user stepped into, and hands the edits back to the placed character when "Done" is pressed
 * (Cancel drops them). Beta: the scene's own preview still plays the Animate player and does not
 * show these edits yet.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import NativePoseEditor from "./NativePoseEditor";
import { loadNativeDoc, type NativeLoaded } from "../lib/native/loadDoc";
import { registerLibrary } from "../lib/native/library";
import { editsOf, type NativeEdits } from "../lib/native/store";
import { convertLegacy, type LegacyFields } from "../lib/native/legacy";
import { buildClones } from "../lib/native/legacyClones";

export default function NativePoseDialog({ flaUrl, item, title, js, initial, legacy, onDone, onCancel }: {
  flaUrl: string; item: string; title: string; /** The pose's class in the player (what old edits call it). */ js?: string; initial?: NativeEdits | null;
  /** What older versions saved inside this character: turned into native edits the first time the pose opens here (when it has none of its own). */
  legacy?: LegacyFields;
  onDone: (edits: NativeEdits | null) => void; onCancel: () => void;
}) {
  const [loaded, setLoaded] = useState<NativeLoaded | null>(null);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState(0);
  const [converted, setConverted] = useState("");
  const [seed, setSeed] = useState<NativeEdits | null>(null);
  const latest = useRef<NativeEdits | null>(initial ?? null);

  useEffect(() => {
    let alive = true;
    loadNativeDoc(flaUrl, (f) => alive && setProgress(f)).then(async (result) => {
      if (!alive) return;
      if (!result.doc.symbols.has(item)) { setError(`This pose ("${item}") is not in the character's Animate file.`); return; }
      // Symbols pasted in from other characters on an earlier visit are put back before the pose is drawn.
      if (!initial && legacy) {
        // Pictures, library symbols and parts of other characters the old editor placed as layers are built first (they load files).
        const prepared: Record<string, Awaited<ReturnType<typeof buildClones>>> = {};
        for (const [cls, edit] of Object.entries(legacy.layers || {})) {
          if (!edit.clones?.some((c) => c.symbol || c.image)) continue;
          // Only a pose's own layers can take them: the clone's place is given in the pose's space.
          const library = cls === js ? item : null;
          if (library) prepared[cls] = await buildClones(result, edit, item, result.doc.symbols.get(library)?.timeline.length || 1);
        }
        if (!alive) return;
        const made = convertLegacy(result.doc.symbols, legacy, js ? { [js]: item } : {}, prepared);
        // The native drawing replaces the player for the whole character, so it is only taken over when every old edit converted.
        if (Object.keys(made.symbols).length && !made.left.length) {
          // Through editsOf so the pictures and parts of other characters the converted layers use are saved with them.
          const edits = editsOf(result.doc, new Map(Object.entries(made.symbols)));
          latest.current = edits;
          setSeed(edits);
          setConverted(`Older edits on this character were converted (${made.converted.join(", ")}).`);
        } else if (made.left.length) setConverted(`Older edits were not converted, so this character keeps using them as they are: ${made.left.join("; ")}.`);
      }
      registerLibrary(result, initial?.library).then(() => alive && setLoaded(result), (e) => alive && setError(e instanceof Error ? e.message : String(e)));
    }).catch((e) => alive && setError(e instanceof Error ? e.message : String(e)));
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flaUrl, item]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !(e.target instanceof HTMLElement && /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName))) onCancel(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const onChange = useCallback((edits: NativeEdits) => { latest.current = edits; }, []);
  const done = () => { const edits = latest.current; onDone(edits && Object.keys(edits.symbols).length ? edits : null); };

  return (
    <div role="dialog" aria-modal="true" aria-label="Native pose editor" data-testid="native-dialog"
      style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(0,0,0,.45)", display: "grid", placeItems: "center" }}>
      <div style={{ background: "#fff", color: "#111", borderRadius: 8, padding: 14, maxWidth: "96vw", maxHeight: "94vh", overflow: "auto", boxShadow: "0 12px 40px rgba(0,0,0,.35)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8, font: "13px system-ui" }}>
          <b>Native editor (beta) · {title}</b>
          <span style={{ color: "#666" }}>Edits are saved on the character when you press Done. The scene preview does not show them yet.</span>
          <span style={{ flex: 1 }} />
          <button data-testid="native-cancel" onClick={onCancel}>Cancel</button>
          <button data-testid="native-done" onClick={done} disabled={!loaded}>Done</button>
        </div>
        {error ? <div style={{ font: "13px system-ui", color: "#b00020" }}>{error}</div>
          : !loaded ? <div style={{ font: "13px system-ui" }}>Loading the character&apos;s Animate file… {Math.round(progress * 100)}%</div>
          : <NativePoseEditor flaUrl={flaUrl} doc={loaded.doc} renderer={loaded.renderer} poses={[{ item, name: item.split("/").pop() || item }]} initialEdits={initial ?? seed} onChange={onChange} />}
        {converted && <div data-testid="native-converted" style={{ font: "12px system-ui", color: "#555", marginTop: 6 }}>{converted}</div>}
      </div>
    </div>
  );
}
