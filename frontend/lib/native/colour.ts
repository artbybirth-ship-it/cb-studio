/**
 * The character's colour rules (Recolour panel: palette, Find & Replace, Light/Dark, Adjust) for the
 * native drawing. Same rules and maths as the Animate player (public/vendor/cb-animate-bridge.js and
 * cb-symbol-player.html): every colour is recomputed from its ORIGINAL, so rules never chain; an
 * "exact" rule swaps one colour, a "shades" rule moves a whole colour family (the lighter and darker
 * versions of it) by the same hue/saturation/lightness difference. Pure functions, no drawing.
 */
import type { Fill, Stroke } from "../fla/xfl";

/** What a rule needs from the editor's ColorReplacement. */
export type ColourRule = { from: string; to: string; target?: "fill" | "stroke" | "both"; scope?: string; match?: "exact" | "shades" };
type Rgba = { r: number; g: number; b: number; a: number };
type Hsl = { h: number; s: number; l: number };
export type PreparedRule = { target: "fill" | "stroke" | "both"; match: "exact" | "shades"; fromHex: string; fromHsl: Hsl; toRgb: Rgba; toHsl: Hsl; scope: string };

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export function parseColour(value: string | undefined): Rgba | null {
  const s = String(value || "").trim();
  let m = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(s);
  if (m) return { r: parseInt(m[1] + m[1], 16), g: parseInt(m[2] + m[2], 16), b: parseInt(m[3] + m[3], 16), a: 1 };
  m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(s);
  if (m) return { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16), a: 1 };
  m = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(s);
  if (m) return { r: +m[1], g: +m[2], b: +m[3], a: m[4] == null ? 1 : +m[4] };
  return null;
}
const hexOf = (c: Rgba) => "#" + [c.r, c.g, c.b].map((v) => ("0" + Math.round(clamp(v, 0, 255)).toString(16)).slice(-2)).join("");

export function toHsl(c: Rgba): Hsl {
  const r = c.r / 255, g = c.g / 255, b = c.b / 255, max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
  let h = 0, s = 0;
  if (d > 1e-6) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h *= 60;
  }
  return { h, s, l };
}
export function fromHsl(h0: number, s0: number, l0: number, a: number): Rgba {
  const h = ((h0 % 360) + 360) % 360, s = clamp(s0, 0, 1), l = clamp(l0, 0, 1);
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (h < 60) { r = c; g = x; } else if (h < 120) { r = x; g = c; } else if (h < 180) { g = c; b = x; } else if (h < 240) { g = x; b = c; } else if (h < 300) { r = x; b = c; } else { r = c; b = x; }
  return { r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255, a };
}
function sameFamily(a: Hsl, b: Hsl) {
  if (Math.abs(a.l - b.l) > 0.22) return false;
  if (a.s < 0.12 && b.s < 0.12) return true;
  if (a.s < 0.12 || b.s < 0.12) return false;
  let dh = Math.abs(a.h - b.h); dh = Math.min(dh, 360 - dh);
  return dh <= 5 && Math.abs(a.s - b.s) <= 0.3;
}

/** Rules ready to apply. Whole-character rules ("*") come first, then part rules, in the order given (as the player does). */
export function prepareRules(list: ColourRule[] | undefined): PreparedRule[] {
  const rules = (list || []).flatMap((r) => {
    const from = parseColour(r.from), to = parseColour(r.to);
    if (!from || !to) return [];
    return [{ target: r.target || "both", match: r.match === "shades" ? "shades" : "exact", fromHex: hexOf(from), fromHsl: toHsl(from), toRgb: to, toHsl: toHsl(to), scope: String(r.scope || "*") } as PreparedRule];
  });
  return [...rules.filter((r) => r.scope === "*"), ...rules.filter((r) => r.scope !== "*")];
}

/** The rules that apply to a shape drawn inside the instances named `path` (outermost first): whole-character rules, and rules of any part the shape is inside. */
export function rulesAt(rules: PreparedRule[], path: string): PreparedRule[] {
  return rules.filter((r) => r.scope === "*" || path === r.scope || path.startsWith(r.scope + "/"));
}

/** One colour through the rules: an exact match wins over a shades match; null when no rule touches it. */
export function mapColour(c: Rgba, rules: PreparedRule[], isStroke: boolean): Rgba | null {
  let exact: Rgba | null = null, shade: Rgba | null = null, hsl: Hsl | null = null;
  const hex = hexOf(c);
  for (const r of rules) {
    if (r.target !== "both" && (r.target === "stroke") !== isStroke) continue;
    if (r.match === "exact") { if (hex === r.fromHex) exact = { r: r.toRgb.r, g: r.toRgb.g, b: r.toRgb.b, a: c.a }; continue; }
    if (!hsl) hsl = toHsl(c);
    if (!sameFamily(hsl, r.fromHsl)) continue;
    shade = fromHsl(r.toHsl.h + (hsl.h - r.fromHsl.h), r.toHsl.s + (hsl.s - r.fromHsl.s), r.toHsl.l + (hsl.l - r.fromHsl.l), c.a);
  }
  return exact || shade;
}

const hexString = (c: Rgba) => hexOf(c);
function recolourStop(color: string, alpha: number, rules: PreparedRule[], isStroke: boolean): [string, number] {
  const parsed = parseColour(color);
  const out = parsed && mapColour({ ...parsed, a: alpha }, rules, isStroke);
  return out ? [hexString(out), out.a] : [color, alpha];
}

/** A fill (or a stroke's fill) through the rules: the same object back when nothing changes. */
export function recolourFill(style: Fill, rules: PreparedRule[], isStroke: boolean): Fill {
  if (!rules.length) return style;
  if (style.t === "solid") {
    const [color, alpha] = recolourStop(style.color, style.alpha, rules, isStroke);
    return color === style.color && alpha === style.alpha ? style : { ...style, color, alpha };
  }
  let changed = false;
  const stops = style.stops.map(([ratio, color, alpha]) => {
    const [c, a] = recolourStop(color, alpha, rules, isStroke);
    if (c !== color || a !== alpha) changed = true;
    return [ratio, c, a] as [number, string, number];
  });
  return changed ? { ...style, stops } : style;
}
export const recolourStroke = (style: Stroke, rules: PreparedRule[]): Stroke => {
  const fill = recolourFill(style.fill, rules, true);
  return fill === style.fill ? style : { ...style, fill };
};
