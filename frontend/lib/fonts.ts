/**
 * Fonts for text layers. Google fonts load from fonts.googleapis.com (app layout and the export
 * render harness); system fonts need nothing. Without internet a Google font falls back to the
 * generic family. Keep FONT_CSS in public/render-harness.html in sync with this list.
 */

export type FontOption = { name: string; css: string; google?: string };

export const DEFAULT_FONT = "Arial";

export const FONT_OPTIONS: FontOption[] = [
  { name: "Arial", css: "Arial, Helvetica, sans-serif" },
  { name: "Poppins", css: "'Poppins', sans-serif", google: "Poppins:wght@400;600;800" },
  { name: "Mukta", css: "'Mukta', sans-serif", google: "Mukta:wght@400;600;800" },
  { name: "Noto Sans Devanagari", css: "'Noto Sans Devanagari', sans-serif", google: "Noto+Sans+Devanagari:wght@400;600;800" },
  { name: "Hind", css: "'Hind', sans-serif", google: "Hind:wght@400;600;700" },
  { name: "Baloo 2", css: "'Baloo 2', cursive", google: "Baloo+2:wght@400;600;800" },
  { name: "Montserrat", css: "'Montserrat', sans-serif", google: "Montserrat:wght@400;600;800" },
  { name: "Roboto", css: "'Roboto', sans-serif", google: "Roboto:wght@400;700;900" },
  { name: "Open Sans", css: "'Open Sans', sans-serif", google: "Open+Sans:wght@400;600;800" },
  { name: "Lato", css: "'Lato', sans-serif", google: "Lato:wght@400;700;900" },
  { name: "Playfair Display", css: "'Playfair Display', serif", google: "Playfair+Display:wght@400;700;900" },
  { name: "Georgia", css: "Georgia, serif" },
  { name: "Times New Roman", css: "'Times New Roman', Times, serif" },
  { name: "Verdana", css: "Verdana, Geneva, sans-serif" },
  { name: "Trebuchet MS", css: "'Trebuchet MS', sans-serif" },
  { name: "Courier New", css: "'Courier New', Courier, monospace" },
  { name: "Impact", css: "Impact, 'Arial Black', sans-serif" },
];

/** CSS font-family for a text layer's font name (unknown names are tried first, then Arial). */
export const fontCss = (name?: string | null) => {
  const font = FONT_OPTIONS.find((option) => option.name === (name || DEFAULT_FONT));
  return font ? font.css : `'${String(name)}', Arial, sans-serif`;
};

export const GOOGLE_FONTS_HREF = `https://fonts.googleapis.com/css2?${FONT_OPTIONS
  .filter((option) => option.google)
  .map((option) => `family=${option.google}`)
  .join("&")}&display=swap`;
