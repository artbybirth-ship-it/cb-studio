/**
 * Fonts for text layers. Google fonts load from fonts.googleapis.com (app layout and the export
 * render harness, with every weight and italic listed here); system fonts need nothing. Fonts from
 * the person's computer are uploaded once (Text panel) and drawn from their file everywhere (see
 * ensureFontFace). Keep FONT_CSS and the Google link in public/render-harness.html in sync.
 */

export type FontOption = { name: string; css: string; google?: string };
/** One style of a family: weight 100–900, italic or not; url = an uploaded font file. */
export type FontFaceInfo = { weight: number; italic: boolean; url?: string; postscriptName?: string; styleName?: string };
export type FontFamilyInfo = { name: string; css: string; faces: FontFaceInfo[]; source: "builtin" | "team" | "system" };

export const DEFAULT_FONT = "Arial";

const both = (weights: number[]) => weights.flatMap((weight) => [{ weight, italic: false }, { weight, italic: true }]);
const upright = (weights: number[]) => weights.map((weight) => ({ weight, italic: false }));
const range = (from: number, to: number) => Array.from({ length: (to - from) / 100 + 1 }, (_, index) => from + index * 100);

/** The fonts that come with CB Studio, with the styles each one has. */
const BUILTIN: { name: string; css: string; google?: boolean; faces: { weight: number; italic: boolean }[] }[] = [
  { name: "Arial", css: "Arial, Helvetica, sans-serif", faces: both([400, 700]) },
  { name: "Poppins", css: "'Poppins', sans-serif", google: true, faces: both(range(100, 900)) },
  { name: "Mukta", css: "'Mukta', sans-serif", google: true, faces: upright(range(200, 800)) },
  { name: "Noto Sans Devanagari", css: "'Noto Sans Devanagari', sans-serif", google: true, faces: upright(range(100, 900)) },
  { name: "Hind", css: "'Hind', sans-serif", google: true, faces: upright(range(300, 700)) },
  { name: "Baloo 2", css: "'Baloo 2', cursive", google: true, faces: upright(range(400, 800)) },
  { name: "Montserrat", css: "'Montserrat', sans-serif", google: true, faces: both(range(100, 900)) },
  { name: "Roboto", css: "'Roboto', sans-serif", google: true, faces: both(range(100, 900)) },
  { name: "Open Sans", css: "'Open Sans', sans-serif", google: true, faces: both(range(300, 800)) },
  { name: "Lato", css: "'Lato', sans-serif", google: true, faces: both([100, 300, 400, 700, 900]) },
  { name: "Playfair Display", css: "'Playfair Display', serif", google: true, faces: both(range(400, 900)) },
  { name: "Georgia", css: "Georgia, serif", faces: both([400, 700]) },
  { name: "Times New Roman", css: "'Times New Roman', Times, serif", faces: both([400, 700]) },
  { name: "Verdana", css: "Verdana, Geneva, sans-serif", faces: both([400, 700]) },
  { name: "Trebuchet MS", css: "'Trebuchet MS', sans-serif", faces: both([400, 700]) },
  { name: "Courier New", css: "'Courier New', Courier, monospace", faces: both([400, 700]) },
  { name: "Impact", css: "Impact, 'Arial Black', sans-serif", faces: upright([400]) },
];

export const BUILTIN_FAMILIES: FontFamilyInfo[] = BUILTIN.map((font) => ({ name: font.name, css: font.css, faces: font.faces, source: "builtin" }));
export const FONT_OPTIONS: FontOption[] = BUILTIN.map((font) => ({ name: font.name, css: font.css }));

/** CSS font-family for a text layer's font name (unknown names are tried first, then Arial). */
export const fontCss = (name?: string | null) => {
  const font = FONT_OPTIONS.find((option) => option.name === (name || DEFAULT_FONT));
  return font ? font.css : `'${String(name)}', Arial, sans-serif`;
};

// Google's css2 API wants every (italic, weight) pair, sorted.
const googleFamily = (font: (typeof BUILTIN)[number]) => {
  const name = font.name.replace(/ /g, "+");
  if (!font.faces.some((face) => face.italic)) return `family=${name}:wght@${font.faces.map((face) => face.weight).join(";")}`;
  const pairs = [...font.faces].sort((a, b) => Number(a.italic) - Number(b.italic) || a.weight - b.weight);
  return `family=${name}:ital,wght@${pairs.map((face) => `${face.italic ? 1 : 0},${face.weight}`).join(";")}`;
};
export const GOOGLE_FONTS_HREF = `https://fonts.googleapis.com/css2?${BUILTIN.filter((font) => font.google).map(googleFamily).join("&")}&display=swap`;

const WEIGHT_NAMES: Record<number, string> = { 100: "Thin", 200: "ExtraLight", 300: "Light", 400: "Regular", 500: "Medium", 600: "SemiBold", 700: "Bold", 800: "ExtraBold", 900: "Black" };

/** "Light Italic", "Regular", "Italic", "Bold"… (Illustrator's style names). */
export const styleName = (weight: number, italic: boolean) => {
  const base = WEIGHT_NAMES[Math.round(weight / 100) * 100] || String(weight);
  return italic ? (base === "Regular" ? "Italic" : `${base} Italic`) : base;
};

/** A font file's style name ("Semibold Italic", "Heavy", "Book"…) as weight and italic. */
export const parseStyleName = (style: string) => {
  const name = style.toLowerCase().replace(/[\s_-]+/g, "");
  const italic = /italic|oblique/.test(name);
  const weight = /thin|hairline/.test(name) ? 100
    : /extralight|ultralight/.test(name) ? 200
      : /light/.test(name) ? 300
        : /medium/.test(name) ? 500
          : /semibold|demibold/.test(name) ? 600
            : /extrabold|ultrabold/.test(name) ? 800
              : /black|heavy/.test(name) ? 900
                : /bold/.test(name) ? 700
                  : 400;
  return { weight, italic };
};

/** The face of a family closest to weight / italic (Regular when there is no match). */
export const closestFace = (faces: FontFaceInfo[], weight = 400, italic = false) =>
  [...faces].sort((a, b) => (Number(a.italic !== italic) * 1000 + Math.abs(a.weight - weight)) - (Number(b.italic !== italic) * 1000 + Math.abs(b.weight - weight)))[0];

// Uploaded font files: registered once per (family, weight, style, file) with the FontFace API.
const registered = new Set<string>();
export const ensureFontFace = (family: string, weight: number, italic: boolean, url: string) => {
  if (typeof document === "undefined" || !url) return;
  const key = `${family}|${weight}|${italic}|${url}`;
  if (registered.has(key)) return;
  registered.add(key);
  try {
    const face = new FontFace(family, `url(${JSON.stringify(url)})`, { weight: String(weight), style: italic ? "italic" : "normal" });
    document.fonts.add(face);
    void face.load().catch(() => registered.delete(key));
  } catch { registered.delete(key); }
};
