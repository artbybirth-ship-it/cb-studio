"use client";

import { useEffect, useState } from "react";
import { useEscClose } from "@/lib/escClose";
import PanelClose from "./PanelClose";

/**
 * File › Export (⌘E): choose MP4, GIF, JPEG or PNG, then Export. A JPEG / PNG is the frame at the
 * playhead of the scene being edited; MP4 and GIF are the whole project. Dragged by its header
 * (DialogDragManager); the last format is remembered in this browser.
 */
export type ExportFormat = "mp4" | "gif" | "jpeg" | "png";
/** MP4 picture size (a portrait project gets it turned). */
export type ExportResolution = "hd" | "fullhd" | "4k";
const RESOLUTIONS: { id: ExportResolution; label: string; long: number; short: number }[] = [
  { id: "hd", label: "HD", long: 1280, short: 720 },
  { id: "fullhd", label: "Full HD", long: 1920, short: 1080 },
  { id: "4k", label: "4K", long: 3840, short: 2160 },
];
export const exportExtension = (format: ExportFormat) => (format === "jpeg" ? "jpg" : format);

const FORMATS: { id: ExportFormat; label: string; detail: string }[] = [
  { id: "mp4", label: "MP4", detail: "Video with sound · HD, Full HD or 4K" },
  { id: "gif", label: "GIF", detail: "Animation, no sound · up to 960 px, 15 fps" },
  { id: "jpeg", label: "JPEG", detail: "This frame (at the playhead) · Full HD" },
  { id: "png", label: "PNG", detail: "This frame (at the playhead) · Full HD, clean edges" },
];
const STORAGE_KEY = "cb-export-format";
const RESOLUTION_KEY = "cb-export-resolution";

export const exportFormatLabel = (format: string) => FORMATS.find((item) => item.id === format)?.label || format.toUpperCase();

export default function ExportPanel({ portrait = false, onExport, onClose }: { portrait?: boolean; onExport: (format: ExportFormat, resolution: ExportResolution) => void; onClose: () => void }) {
  useEscClose(true, onClose);
  const [format, setFormat] = useState<ExportFormat>("mp4");
  const [resolution, setResolution] = useState<ExportResolution>("fullhd");
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (FORMATS.some((item) => item.id === saved)) setFormat(saved as ExportFormat);
      const size = window.localStorage.getItem(RESOLUTION_KEY);
      if (RESOLUTIONS.some((item) => item.id === size)) setResolution(size as ExportResolution);
    } catch { /* storage unavailable */ }
  }, []);
  const submit = (chosen = format) => {
    try { window.localStorage.setItem(STORAGE_KEY, chosen); window.localStorage.setItem(RESOLUTION_KEY, resolution); } catch { /* not remembered */ }
    onExport(chosen, resolution);
  };
  return (
    <div className="cb-export-panel" role="dialog" aria-label="Export">
      <header><PanelClose onClose={onClose} label="Close Export" />Export</header>
      <div className="cb-export-body">
        <div className="cb-export-formats" role="radiogroup" aria-label="Format">
          {FORMATS.map((item) => (
            <button key={item.id} type="button" role="radio" aria-checked={format === item.id} className={format === item.id ? "on" : ""}
              onClick={() => setFormat(item.id)} onDoubleClick={() => { setFormat(item.id); submit(item.id); }}>
              <strong>{item.label}</strong>
              <small>{item.detail}</small>
            </button>
          ))}
        </div>
        {format === "mp4" && (
          <div className="cb-export-sizes" role="radiogroup" aria-label="Video size">
            {RESOLUTIONS.map((item) => (
              <button key={item.id} type="button" role="radio" aria-checked={resolution === item.id} className={resolution === item.id ? "on" : ""}
                title={item.id === "hd" ? "Quickest" : item.id === "4k" ? "Sharpest; takes the longest" : undefined} onClick={() => setResolution(item.id)}>
                <strong>{item.label}</strong>
                <small>{portrait ? `${item.short} × ${item.long}` : `${item.long} × ${item.short}`}</small>
              </button>
            ))}
          </div>
        )}
        <div className="cb-export-actions">
          <button type="button" className="cb-export-cancel" onClick={onClose}>Cancel</button>
          <button type="button" className="cb-export-go" onClick={() => submit()}>Export {exportFormatLabel(format)}</button>
        </div>
      </div>
    </div>
  );
}
