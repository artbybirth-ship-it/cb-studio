"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { buildFlaPackage, openFla, posePreviews, safeFileName, type OpenedFla } from "@/lib/fla/importFla";
import { poseClassName } from "@/lib/fla/createjsWriter";
import { useEscClose } from "@/lib/escClose";
import PanelClose from "./PanelClose";

/**
 * Import .fla: the file is read in the browser (no Adobe Animate needed). Every symbol on the
 * stage becomes a pose; the user names the character and each pose, unticks poses to leave out,
 * and Import uploads the package like an HTML5 export. If the file cannot be read here,
 * onFallback hands it to the old route (Adobe Animate in the desktop app).
 */
type Props = {
  file: File;
  /** Uploads the package; throws with a message to show if it fails. */
  onImport: (zip: File) => Promise<void>;
  onFallback: (file: File, reason: string) => void;
  onClose: () => void;
};
/** library: the symbol's name in the .fla; name: what the user typed (edited) — until then an
 *  unnamed symbol shows "<character> 01", as the library names it. */
type Row = { item: string; library: string; generic: boolean; name: string; edited: boolean; include: boolean };

export default function ImportFlaDialog({ file, onImport, onFallback, onClose }: Props) {
  const [opened, setOpened] = useState<OpenedFla | null>(null);
  const [progress, setProgress] = useState(0);
  const [characterName, setCharacterName] = useState(() => safeFileName(file.name.replace(/\.fla$/i, "")));
  const [rows, setRows] = useState<Row[]>([]);
  const [previews, setPreviews] = useState<Record<string, string> | null>(null);
  const [skipped, setSkipped] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEscClose(!busy, onClose);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const result = await openFla(file, (fraction) => { if (!cancelled) setProgress(fraction); });
        if (cancelled) return;
        setOpened(result);
        setRows(result.poses.map((pose) => ({ item: pose.item, library: pose.name, generic: pose.generic, name: pose.name, edited: false, include: true })));
        const drawn = await posePreviews(result).catch(() => ({ images: {}, skipped: [] }));
        if (!cancelled) { setPreviews(drawn.images); setSkipped(drawn.skipped); }
      } catch (cause) {
        if (!cancelled) onFallback(file, cause instanceof Error ? cause.message : "unreadable file");
      }
    })();
    return () => { cancelled = true; };
  }, [file]); // eslint-disable-line react-hooks/exhaustive-deps

  const nameOf = (row: Row, index: number) => (row.edited ? row.name
    : row.generic ? `${characterName.trim() || "Pose"} ${String(index + 1).padStart(2, "0")}` : row.library);
  const chosen = rows.filter((row) => row.include);
  const badName = (row: Row, index: number) => row.include && !poseClassName(nameOf(row, index));
  const canImport = Boolean(opened) && !busy && chosen.length > 0 && characterName.trim() !== "" && !rows.some(badName);
  const choices = () => rows.map((row, index) => ({ item: row.item, name: nameOf(row, index).trim(), include: row.include }));
  const importNow = async () => {
    if (!opened || !canImport) return;
    setBusy(true);
    setError("");
    try {
      const { zip } = await buildFlaPackage(opened, characterName, choices());
      await onImport(zip);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Import failed");
      setBusy(false);
    }
  };
  const importRef = useRef(importNow);
  importRef.current = importNow;
  const setRow = (item: string, patch: Partial<Row>) => setRows((list) => list.map((row) => (row.item === item ? { ...row, ...patch } : row)));

  return createPortal(
    <div className="cb-adjust-backdrop cb-fla-import-backdrop" onKeyDown={(event) => {
      event.stopPropagation();
      if (event.key === "Enter" && !(event.target instanceof HTMLButtonElement)) { event.preventDefault(); void importRef.current(); }
    }}>
      <div className="cb-fla-import" role="dialog" aria-modal="true" aria-label="Import .fla">
        <header><PanelClose onClose={() => { if (!busy) onClose(); }} label="Cancel" />Import .fla</header>
        {!opened ? (
          <div className="cb-fla-import-reading">
            <p>Reading <b>{file.name}</b>…</p>
            <div className="cb-fla-import-bar"><span style={{ width: `${Math.round(progress * 100)}%` }} /></div>
          </div>
        ) : (
          <div className="cb-fla-import-body">
            <label className="cb-fla-import-name">Character name
              <input value={characterName} onChange={(event) => setCharacterName(event.target.value)} maxLength={80} autoFocus />
            </label>
            <p className="cb-fla-import-info">
              {rows.length} pose{rows.length === 1 ? "" : "s"} found · {Math.round(opened.doc.width)}×{Math.round(opened.doc.height)} · {Math.round(opened.doc.fps)} fps
              {" · "}{chosen.length} selected
              <button type="button" onClick={() => setRows((list) => list.map((row) => ({ ...row, include: chosen.length !== list.length })))}>
                {chosen.length === rows.length ? "Select none" : "Select all"}
              </button>
            </p>
            <ul className="cb-fla-import-poses">
              {rows.map((row, index) => (
                <li key={row.item} className={row.include ? "" : "off"}>
                  <label className="cb-fla-import-pick" title={row.include ? "Untick to leave this pose out" : "Tick to import this pose"}>
                    <input type="checkbox" checked={row.include} onChange={(event) => setRow(row.item, { include: event.target.checked })} />
                    <span className="cb-fla-import-thumb">
                      {previews?.[row.item] ? <img src={previews[row.item]} alt="" /> : <i>{previews ? "No preview" : "Drawing…"}</i>}
                    </span>
                  </label>
                  <input className={`cb-fla-import-pose-name ${badName(row, index) ? "bad" : ""}`} value={nameOf(row, index)} aria-label="Pose name" maxLength={60}
                    title={badName(row, index) ? "Use English letters or numbers in the name" : "Pose name in the library"}
                    onChange={(event) => setRow(row.item, { name: event.target.value, edited: true })} />
                  {nameOf(row, index) !== row.library && <small className="cb-fla-import-library" title="Its name in the .fla library">{row.library}</small>}
                </li>
              ))}
            </ul>
            {skipped.length > 0 && <p className="cb-fla-import-note">Not imported yet: {skipped.join(", ")}.</p>}
            {error && <p className="cb-fla-import-error" role="alert">{error}</p>}
            <div className="cb-fla-import-actions">
              <button type="button" className="cb-fs-cancel" disabled={busy} onClick={onClose}>Cancel</button>
              <button type="button" className="cb-fs-create" disabled={!canImport} onClick={() => void importNow()}>
                {busy ? "Importing…" : `Import ${chosen.length} pose${chosen.length === 1 ? "" : "s"}`}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
