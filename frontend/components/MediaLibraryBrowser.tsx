"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { MEDIA_LIBRARY_COPY, type MediaLibraryItem, type MediaLibraryType } from "@/lib/mediaLibrary";
import { useMediaLibrary } from "@/lib/useMediaLibrary";

type Props = {
  type: MediaLibraryType;
  search: string;
  onAdd: (item: MediaLibraryItem) => void;
  /** Built-in tools (upload, AI, text…) shown above the library grid. */
  tools?: ReactNode;
};

/** Editor browser for one installed Backgrounds / FX / SFX library. */
export default function MediaLibraryBrowser({ type, search, onAdd, tools }: Props) {
  const { items, packages, loading, error } = useMediaLibrary(type);
  const [category, setCategory] = useState("All");
  const [playingId, setPlayingId] = useState("");
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const copy = MEDIA_LIBRARY_COPY[type];
  const query = search.trim().toLowerCase();

  const categories = useMemo(() => ["All", ...Array.from(new Set(items.map((item) => item.category))).sort()], [items]);
  const visible = useMemo(() => items.filter((item) =>
    (category === "All" || item.category === category)
    && (!query || [item.name, item.category, item.format].some((value) => value.toLowerCase().includes(query)))), [items, category, query]);

  useEffect(() => () => { audioRef.current?.pause(); }, []);
  useEffect(() => { if (!categories.includes(category)) setCategory("All"); }, [categories, category]);

  const togglePreview = (item: MediaLibraryItem) => {
    audioRef.current?.pause();
    if (playingId === item.id) { setPlayingId(""); return; }
    const audio = new Audio(item.url);
    audio.onended = () => setPlayingId("");
    audioRef.current = audio;
    setPlayingId(item.id);
    void audio.play().catch(() => setPlayingId(""));
  };

  const dragProps = (item: MediaLibraryItem) => ({
    draggable: true,
    onDragStart: (event: React.DragEvent) => {
      event.dataTransfer.effectAllowed = "copy";
      event.dataTransfer.setData("text/uri-list", item.url);
    },
  });

  return (
    <div className={`cb-media-library cb-media-library-${type}`}>
      {tools && <div className="cb-media-tools">{tools}</div>}

      {error && <div className="cb-library-upload-error in-panel">{error}</div>}

      {loading ? <div className="cb-visual-empty-state">Loading {copy.label} library…</div>
        : packages.length === 0 ? <p className="cb-library-home-notice">{copy.empty}</p>
        : <>
          {categories.length > 2 && <div className="cb-media-categories" role="tablist" aria-label={`${copy.label} categories`}>
            {categories.map((name) => (
              <button key={name} type="button" role="tab" aria-selected={category === name} className={category === name ? "active" : ""} onClick={() => setCategory(name)}>{name}</button>
            ))}
          </div>}

          {visible.length === 0 ? <div className="cb-visual-empty-state">No matching {copy.singular}s.</div>
            : type === "sfx" ? (
              <ul className="cb-media-sound-list">
                {visible.map((item) => (
                  <li key={item.id}>
                    <button type="button" className={`cb-media-play ${playingId === item.id ? "playing" : ""}`} onClick={() => togglePreview(item)} aria-label={playingId === item.id ? `Stop ${item.name}` : `Play ${item.name}`}>
                      {playingId === item.id ? "■" : "▶"}
                    </button>
                    <span className="cb-media-sound-copy"><b>{item.name}</b><small>{item.category} · {item.format.toUpperCase()}</small></span>
                    <button type="button" className="cb-media-add" onClick={() => onAdd(item)} title={`Add ${item.name} to the timeline`}>＋ Add</button>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="cb-media-grid">
                {visible.map((item) => (
                  <button key={item.id} type="button" className="cb-media-card" onClick={() => onAdd(item)} title={`Add ${item.name}${item.sourceUrl ? ` (${item.format.toUpperCase()} original)` : ""}`} {...dragProps(item)}>
                    <span className="cb-media-thumb"><img src={item.previewUrl || item.url} alt="" loading="lazy" draggable={false} />{item.sourceUrl && <em>{item.format.toUpperCase()}</em>}</span>
                    <b>{item.name}</b>
                  </button>
                ))}
              </div>
            )}
        </>}
    </div>
  );
}
