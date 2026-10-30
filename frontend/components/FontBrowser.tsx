"use client";

import { useEffect, useMemo, useState } from "react";
import { closestFace, ensureFontFace, styleName, type FontFaceInfo, type FontFamilyInfo } from "@/lib/fonts";
import { familyHasScript, listedSystemFamilies, localFontsSupported, loadSystemFamilies } from "@/lib/localFonts";

/**
 * Text panel cards (mockups): the font list — Favourite, System font (this computer), Installed font
 * (CB Studio's fonts and the team's uploaded ones), Language filter — and a family's style list.
 * Each row writes "Sample" in its own font; ▸ opens the family's styles; ☆ marks a favourite.
 */
type Tab = "favourite" | "system" | "installed";
type Language = "all" | "latin" | "devanagari";
const FAVOURITES_KEY = "cb-favourite-fonts";
const LANGUAGES: { id: Language; label: string; short: string }[] = [
  { id: "all", label: "All languages", short: "ALL" },
  { id: "latin", label: "English (Latin)", short: "ENG" },
  { id: "devanagari", label: "Hindi (Devanagari)", short: "HIN" },
];

const readFavourites = (): string[] => { try { return JSON.parse(window.localStorage.getItem(FAVOURITES_KEY) || "[]"); } catch { return []; } };

/** A face's CSS for its "Sample" (uploaded team fonts are loaded from their file). */
const sampleStyle = (family: FontFamilyInfo, face?: FontFaceInfo) => {
  const shown = face || closestFace(family.faces);
  if (shown?.url) ensureFontFace(family.name, shown.weight, shown.italic, shown.url);
  return { fontFamily: family.css, fontWeight: shown?.weight ?? 400, fontStyle: shown?.italic ? "italic" : "normal" };
};

export function FontBrowser({ current, installed, onPick, onClose }: {
  current: string;
  installed: FontFamilyInfo[];
  onPick: (family: FontFamilyInfo, face: FontFaceInfo) => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<Tab>("installed");
  const [language, setLanguage] = useState<Language>("all");
  const [languageOpen, setLanguageOpen] = useState(false);
  const [system, setSystem] = useState<FontFamilyInfo[] | null>(() => listedSystemFamilies());
  const [systemError, setSystemError] = useState("");
  const [favourites, setFavourites] = useState<string[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [scriptOk, setScriptOk] = useState<Record<string, boolean>>({});
  useEffect(() => { setFavourites(readFavourites()); }, []);

  const showSystem = async () => {
    setTab("system");
    if (system) return;
    try { setSystem(await loadSystemFamilies()); setSystemError(""); }
    catch (error) { setSystemError(error instanceof Error ? error.message : "Fonts on this computer could not be listed"); }
  };
  const toggleFavourite = (name: string) => {
    const next = favourites.includes(name) ? favourites.filter((item) => item !== name) : [...favourites, name];
    setFavourites(next);
    try { window.localStorage.setItem(FAVOURITES_KEY, JSON.stringify(next)); } catch { /* not remembered */ }
  };

  const everything = useMemo(() => {
    const byName = new Map<string, FontFamilyInfo>();
    for (const family of [...installed, ...(system || [])]) if (!byName.has(family.name)) byName.set(family.name, family);
    return byName;
  }, [installed, system]);
  const listed = tab === "favourite" ? favourites.map((name) => everything.get(name)).filter((family): family is FontFamilyInfo => Boolean(family))
    : tab === "system" ? system || [] : installed;

  // Language filter: which of the listed families have the script's letters (shown as they are checked).
  useEffect(() => {
    if (language === "all") return;
    let cancelled = false;
    void (async () => {
      let found: Record<string, boolean> = {};
      for (const [index, family] of listed.entries()) {
        found[`${family.name}|${language}`] = await familyHasScript(family, language);
        if (cancelled) return;
        if (index % 20 === 19 || index === listed.length - 1) { const batch = found; found = {}; setScriptOk((current) => ({ ...current, ...batch })); }
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [language, tab, system, installed]);
  const shown = language === "all" ? listed : listed.filter((family) => scriptOk[`${family.name}|${language}`]);

  return (
    <div className="cb-font-card" role="dialog" aria-label="Fonts" data-text-ui>
      <div className="cb-font-tabs">
        <button type="button" className={tab === "favourite" ? "on" : ""} onClick={() => setTab("favourite")}>
          <span>Favourite</span>
          <i aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" /></svg></i>
        </button>
        <button type="button" className={tab === "system" ? "on" : ""} onClick={() => void showSystem()} title={localFontsSupported() ? "Fonts on this computer" : "Needs Chrome, Edge or the desktop app"}>
          <span>System font</span>
          <i aria-hidden="true"><svg viewBox="0 0 24 24"><rect x="4" y="5" width="16" height="11" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.5" /><path d="M12 16v3M8.5 19h7" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg></i>
        </button>
        <button type="button" className={tab === "installed" ? "on" : ""} onClick={() => setTab("installed")}>
          <span>Installed font</span>
          <i aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M7 4v6M5 8l2 2 2-2M13 6h6M13 6v13M13 12h4.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg></i>
        </button>
        <div className="cb-font-language">
          <button type="button" className={language !== "all" ? "on" : ""} onClick={() => setLanguageOpen((open) => !open)} aria-haspopup="listbox" aria-expanded={languageOpen}>
            <span>Language filter</span>
            <i aria-hidden="true"><b>{LANGUAGES.find((item) => item.id === language)?.short}</b><svg viewBox="0 0 24 12"><path d="M7 3l5 5 5-5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg></i>
          </button>
          {languageOpen && (
            <div className="cb-font-language-menu" role="listbox">
              {LANGUAGES.map((item) => (
                <button key={item.id} type="button" role="option" aria-selected={language === item.id} onClick={() => { setLanguage(item.id); setLanguageOpen(false); }}>
                  {language === item.id ? "✓ " : ""}{item.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="cb-font-list" role="listbox" aria-label="Font families">
        {tab === "system" && !system && <p className="cb-font-note">{systemError || "Listing the fonts on this computer… (allow it when the browser asks)"}</p>}
        {tab === "favourite" && favourites.length === 0 && <p className="cb-font-note">Hover a font and click ☆ to keep it here.</p>}
        {(tab !== "system" || system) && shown.length === 0 && language !== "all" && <p className="cb-font-note">No font here can show that language.</p>}
        {shown.map((family) => {
          const many = family.faces.length > 1;
          const open = expanded === family.name;
          const favourite = favourites.includes(family.name);
          return (
            <div key={`${family.source}-${family.name}`} className={`cb-font-family ${family.name === current ? "current" : ""}`}>
              <div className="cb-font-row" role="option" aria-selected={family.name === current} onClick={() => onPick(family, closestFace(family.faces))}>
                <button type="button" className={`cb-font-expand ${open ? "open" : ""}`} aria-label={open ? "Hide styles" : "Show styles"} disabled={!many}
                  onClick={(event) => { event.stopPropagation(); setExpanded(open ? null : family.name); }}>
                  {many && <svg viewBox="0 0 10 10" aria-hidden="true"><path d="M3.5 2l3 3-3 3" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" /></svg>}
                </button>
                <span className="cb-font-name">{family.name}{many ? ` (${family.faces.length})` : ""}</span>
                <span className="cb-font-sample" style={sampleStyle(family)}>Sample</span>
                <button type="button" className={`cb-font-star ${favourite ? "on" : ""}`} aria-label={favourite ? "Remove from favourites" : "Add to favourites"}
                  onClick={(event) => { event.stopPropagation(); toggleFavourite(family.name); }}>{favourite ? "★" : "☆"}</button>
              </div>
              {open && family.faces.map((face) => (
                <div key={`${face.weight}-${face.italic}-${face.postscriptName || ""}`} className="cb-font-row cb-font-face" role="option" aria-selected={false} onClick={() => onPick(family, face)}>
                  <span className="cb-font-expand" />
                  <span className="cb-font-name">{face.styleName || styleName(face.weight, face.italic)}</span>
                  <span className="cb-font-sample" style={sampleStyle(family, face)}>Sample</span>
                </div>
              ))}
            </div>
          );
        })}
      </div>
      <button type="button" className="cb-font-card-close" onClick={onClose} aria-label="Close fonts">×</button>
    </div>
  );
}

/** A family's styles (Light, Light Italic, Regular, Italic…) with a ✓ on the one in use. */
export function StyleList({ family, weight, italic, onPick }: { family: FontFamilyInfo; weight: number; italic: boolean; onPick: (face: FontFaceInfo) => void }) {
  const currentFace = closestFace(family.faces, weight, italic);
  return (
    <div className="cb-style-card" role="listbox" aria-label="Font styles" data-text-ui>
      <div className="cb-style-list">
        {family.faces.map((face) => (
          <button key={`${face.weight}-${face.italic}-${face.postscriptName || ""}`} type="button" role="option" aria-selected={face === currentFace}
            className={face === currentFace ? "current" : ""} style={sampleStyle(family, face)} onClick={() => onPick(face)}>
            <span className="cb-style-check" aria-hidden="true">{face === currentFace ? "✓" : ""}</span>
            {face.styleName || styleName(face.weight, face.italic)}
          </button>
        ))}
      </div>
    </div>
  );
}
