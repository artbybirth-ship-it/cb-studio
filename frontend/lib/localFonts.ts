import { api } from "@/lib/api";
import { parseStyleName, type FontFamilyInfo } from "@/lib/fonts";

/**
 * Fonts on the person's computer (Text panel › System font), through the browser's Local Font Access
 * (Chrome, Edge and the desktop app; it asks for permission once). A font used for text is uploaded
 * with the project, so exports and other computers draw it from the same file.
 */
type LocalFontData = { family: string; fullName: string; postscriptName: string; style: string; blob: () => Promise<Blob> };
type LocalFontWindow = Window & { queryLocalFonts?: () => Promise<LocalFontData[]> };

export const localFontsSupported = () => typeof window !== "undefined" && typeof (window as LocalFontWindow).queryLocalFonts === "function";

const fontData = new Map<string, LocalFontData>();
let systemFamilies: FontFamilyInfo[] | null = null;
/** The computer's families once listed (this session), for the style list. */
export const listedSystemFamilies = () => systemFamilies;

/** Every font family on this computer, A–Z, each with its styles. */
export async function loadSystemFamilies(): Promise<FontFamilyInfo[]> {
  if (systemFamilies) return systemFamilies;
  const query = (window as LocalFontWindow).queryLocalFonts;
  if (!query) throw new Error("This browser can't list the fonts on your computer (use Chrome, Edge or the desktop app)");
  const families = new Map<string, FontFamilyInfo>();
  for (const font of await query.call(window)) {
    fontData.set(font.postscriptName, font);
    const { weight, italic } = parseStyleName(font.style);
    const family = families.get(font.family) || { name: font.family, css: `'${font.family}', sans-serif`, faces: [], source: "system" as const };
    family.faces.push({ weight, italic, postscriptName: font.postscriptName, styleName: font.style });
    families.set(font.family, family);
  }
  systemFamilies = [...families.values()]
    .map((family) => ({ ...family, faces: family.faces.sort((a, b) => a.weight - b.weight || Number(a.italic) - Number(b.italic)) }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return systemFamilies;
}

// ---- One font out of a font file. macOS keeps many families in .ttc collections, which browsers
// can't load with @font-face: the chosen font's tables are copied into a single .ttf / .otf.
const tagAt = (view: DataView, offset: number) => String.fromCharCode(view.getUint8(offset), view.getUint8(offset + 1), view.getUint8(offset + 2), view.getUint8(offset + 3));

const tableRecords = (view: DataView, directory: number) =>
  Array.from({ length: view.getUint16(directory + 4) }, (_, index) => {
    const record = directory + 12 + index * 16;
    return { tag: tagAt(view, record), checksum: view.getUint32(record + 4), offset: view.getUint32(record + 8), length: view.getUint32(record + 12) };
  });

/** nameID 6 (PostScript name) of the font whose table directory starts at `directory`. */
const postscriptNameAt = (view: DataView, directory: number) => {
  const name = tableRecords(view, directory).find((table) => table.tag === "name");
  if (!name) return "";
  const count = view.getUint16(name.offset + 2);
  const strings = name.offset + view.getUint16(name.offset + 4);
  for (let index = 0; index < count; index += 1) {
    const record = name.offset + 6 + index * 12;
    if (view.getUint16(record + 6) !== 6) continue;
    const platform = view.getUint16(record);
    const length = view.getUint16(record + 8);
    const start = strings + view.getUint16(record + 10);
    let text = "";
    if (platform === 3 || platform === 0) for (let at = 0; at + 1 < length; at += 2) text += String.fromCharCode(view.getUint16(start + at));
    else for (let at = 0; at < length; at += 1) text += String.fromCharCode(view.getUint8(start + at));
    if (text) return text;
  }
  return "";
};

const singleFont = (view: DataView, directory: number) => {
  const tables = tableRecords(view, directory);
  const headerSize = 12 + tables.length * 16;
  let size = headerSize;
  const placed = tables.map((table) => { const at = size; size += (table.length + 3) & ~3; return { ...table, at }; });
  const out = new Uint8Array(size);
  const write = new DataView(out.buffer);
  out.set(new Uint8Array(view.buffer, view.byteOffset + directory, 12), 0); // version, table count, search fields
  placed.forEach((table, index) => {
    const record = 12 + index * 16;
    for (let char = 0; char < 4; char += 1) write.setUint8(record + char, table.tag.charCodeAt(char));
    write.setUint32(record + 4, table.checksum);
    write.setUint32(record + 8, table.at);
    write.setUint32(record + 12, table.length);
    out.set(new Uint8Array(view.buffer, view.byteOffset + table.offset, table.length), table.at);
  });
  return out;
};

/** The font file for one PostScript name: unchanged, or cut out of a .ttc collection. */
export function extractFont(buffer: ArrayBuffer, postscriptName: string): { bytes: Uint8Array; extension: string } {
  const view = new DataView(buffer);
  let bytes = new Uint8Array(buffer);
  if (tagAt(view, 0) === "ttcf") {
    const offsets = Array.from({ length: view.getUint32(8) }, (_, index) => view.getUint32(12 + index * 4));
    const directory = offsets.find((offset) => postscriptNameAt(view, offset) === postscriptName) ?? offsets[0];
    bytes = singleFont(view, directory);
  }
  const magic = tagAt(new DataView(bytes.buffer, bytes.byteOffset), 0);
  const extension = magic === "OTTO" ? "otf" : magic === "wOFF" ? "woff" : magic === "wOF2" ? "woff2" : "ttf";
  return { bytes, extension };
}

// ---- Upload once: remembered per PostScript name (this browser), or found among the team's fonts.
const CACHE_KEY = "cb-uploaded-fonts";
const readCache = (): Record<string, string> => { try { return JSON.parse(window.localStorage.getItem(CACHE_KEY) || "{}"); } catch { return {}; } };

export type TeamFont = { url: string; family: string; style: string; weight: string; italic: string; postscriptName: string; fullName: string };

/** The uploaded file's URL for a font on this computer (uploading it the first time). */
export async function uploadSystemFont(projectId: string, postscriptName: string, teamFonts: TeamFont[] = []): Promise<string> {
  const known = readCache()[postscriptName] || teamFonts.find((font) => font.postscriptName === postscriptName)?.url;
  if (known) return known;
  const data = fontData.get(postscriptName);
  if (!data) throw new Error("Open System font again: this font is no longer listed");
  const { bytes, extension } = extractFont(await (await data.blob()).arrayBuffer(), postscriptName);
  const { weight, italic } = parseStyleName(data.style);
  const asset = await api.uploadFont(projectId, new File([bytes as BlobPart], `${postscriptName}.${extension}`, { type: `font/${extension}` }), {
    family: data.family, style: data.style, weight: String(weight), italic: String(italic), postscriptName, fullName: data.fullName,
  });
  try { window.localStorage.setItem(CACHE_KEY, JSON.stringify({ ...readCache(), [postscriptName]: asset.url })); } catch { /* not remembered */ }
  return asset.url;
}

/** The team's uploaded fonts as families (Installed font). */
export const teamFamilies = (fonts: TeamFont[]): FontFamilyInfo[] => {
  const families = new Map<string, FontFamilyInfo>();
  for (const font of fonts) {
    if (!font.family || !font.url) continue;
    const family = families.get(font.family) || { name: font.family, css: `'${font.family}', sans-serif`, faces: [], source: "team" as const };
    family.faces.push({ weight: Number(font.weight) || 400, italic: font.italic === "true", url: font.url, postscriptName: font.postscriptName, styleName: font.style });
    families.set(font.family, family);
  }
  return [...families.values()];
};

// ---- Language filter: does the font file have letters of the script? Read from its character map
// (cmap), so it is exact (measuring drawn text is fooled by the browser borrowing missing letters from
// another font). Built-in fonts are known; others are read once and remembered.
export type Script = "latin" | "devanagari";
const SCRIPT_CODES: Record<Script, number[]> = { latin: [0x41, 0x61], devanagari: [0x905, 0x915] };
const DEVANAGARI_BUILTIN = new Set(["Poppins", "Mukta", "Noto Sans Devanagari", "Hind", "Baloo 2"]);
const SCRIPT_CACHE_KEY = "cb-font-scripts";
const scriptCache: Record<string, boolean> = (() => { try { return JSON.parse(window.localStorage.getItem(SCRIPT_CACHE_KEY) || "{}"); } catch { return {}; } })();

/** Glyph for a code point in the cmap of the font whose table directory starts at `directory`. */
const hasCodePoint = (view: DataView, directory: number, code: number) => {
  const cmap = tableRecords(view, directory).find((table) => table.tag === "cmap");
  if (!cmap) return false;
  const count = view.getUint16(cmap.offset + 2);
  for (let index = 0; index < count; index += 1) {
    const record = cmap.offset + 4 + index * 8;
    const platform = view.getUint16(record);
    const encoding = view.getUint16(record + 2);
    if (!(platform === 0 || (platform === 3 && (encoding === 1 || encoding === 10)))) continue;
    const table = cmap.offset + view.getUint32(record + 4);
    const format = view.getUint16(table);
    if (format === 12) {
      const groups = view.getUint32(table + 12);
      for (let group = 0; group < groups; group += 1) {
        const at = table + 16 + group * 12;
        if (code >= view.getUint32(at) && code <= view.getUint32(at + 4)) return true;
      }
    } else if (format === 4 && code <= 0xffff) {
      const segments = view.getUint16(table + 6) / 2;
      const ends = table + 14, starts = ends + segments * 2 + 2, deltas = starts + segments * 2, ranges = deltas + segments * 2;
      for (let segment = 0; segment < segments; segment += 1) {
        const end = view.getUint16(ends + segment * 2);
        if (code > end) continue;
        const start = view.getUint16(starts + segment * 2);
        if (code < start) break;
        const rangeOffset = view.getUint16(ranges + segment * 2);
        if (rangeOffset === 0) return ((code + view.getInt16(deltas + segment * 2)) & 0xffff) !== 0;
        const glyphAt = ranges + segment * 2 + rangeOffset + (code - start) * 2;
        return glyphAt + 1 < view.byteLength && view.getUint16(glyphAt) !== 0;
      }
    }
  }
  return false;
};

const fileHasScript = (buffer: ArrayBuffer, postscriptName: string | undefined, script: Script) => {
  const view = new DataView(buffer);
  const kind = tagAt(view, 0);
  if (kind === "wOFF" || kind === "wOF2") return true; // compressed: not read, kept in the list
  let directory = 0;
  if (kind === "ttcf") {
    const offsets = Array.from({ length: view.getUint32(8) }, (_, index) => view.getUint32(12 + index * 4));
    directory = offsets.find((offset) => postscriptName && postscriptNameAt(view, offset) === postscriptName) ?? offsets[0];
  }
  return SCRIPT_CODES[script].every((code) => hasCodePoint(view, directory, code));
};

/** Can this family show the script? */
export async function familyHasScript(family: FontFamilyInfo, script: Script): Promise<boolean> {
  if (family.source === "builtin") return script === "latin" || DEVANAGARI_BUILTIN.has(family.name);
  const face = family.faces.find((item) => !item.italic) || family.faces[0];
  const key = `${face?.postscriptName || face?.url || family.name}|${script}`;
  if (key in scriptCache) return scriptCache[key];
  let found = true;
  try {
    const buffer = family.source === "system" && face?.postscriptName && fontData.get(face.postscriptName)
      ? await (await fontData.get(face.postscriptName)!.blob()).arrayBuffer()
      : face?.url ? await (await fetch(face.url)).arrayBuffer() : null;
    if (buffer) found = fileHasScript(buffer, face?.postscriptName, script);
  } catch { found = true; }
  scriptCache[key] = found;
  try { window.localStorage.setItem(SCRIPT_CACHE_KEY, JSON.stringify(scriptCache)); } catch { /* not remembered */ }
  return found;
}
