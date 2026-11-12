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
import type { NativeEdits } from "../lib/native/store";

export default function NativePoseDialog({ flaUrl, item, title, initial, onDone, onCancel }: {
  flaUrl: string; item: string; title: string; initial?: NativeEdits | null;
  onDone: (edits: NativeEdits | null) => void; onCancel: () => void;
}) {
  const [loaded, setLoaded] = useState<NativeLoaded | null>(null);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState(0);
  const latest = useRef<NativeEdits | null>(initial ?? null);

  useEffect(() => {
    let alive = true;
    loadNativeDoc(flaUrl, (f) => alive && setProgress(f)).then((result) => {
      if (!alive) return;
      if (!result.doc.symbols.has(item)) { setError(`This pose ("${item}") is not in the character's Animate file.`); return; }
      // Symbols pasted in from other characters on an earlier visit are put back before the pose is drawn.
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
          : <NativePoseEditor flaUrl={flaUrl} doc={loaded.doc} renderer={loaded.renderer} poses={[{ item, name: item.split("/").pop() || item }]} initialEdits={initial} onChange={onChange} />}
      </div>
    </div>
  );
}
