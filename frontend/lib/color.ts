/** Small colour helpers for the editor (hex ⇄ HSL), matching the player bridge's maths. */

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

export function hexToHsl(hex: string): { h: number; s: number; l: number } | null {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
  if (!match) return null;
  const [r, g, b] = [match[1], match[2], match[3]].map((part) => parseInt(part, 16) / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
  let h = 0, s = 0;
  if (d > 1e-6) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h *= 60;
  }
  return { h, s, l };
}

export function hslToHex(h: number, s: number, l: number): string {
  const hue = ((h % 360) + 360) % 360, sat = clamp01(s), light = clamp01(l);
  const c = (1 - Math.abs(2 * light - 1)) * sat, x = c * (1 - Math.abs(((hue / 60) % 2) - 1)), m = light - c / 2;
  const [r, g, b] = hue < 60 ? [c, x, 0] : hue < 120 ? [x, c, 0] : hue < 180 ? [0, c, x] : hue < 240 ? [0, x, c] : hue < 300 ? [x, 0, c] : [c, 0, x];
  return `#${[r, g, b].map((value) => Math.round((value + m) * 255).toString(16).padStart(2, "0")).join("")}`;
}

// ---- HSB (Illustrator / Photoshop "HSB": hue 0–360, saturation and brightness 0–100) and RGB 0–255.
export type Rgb = { r: number; g: number; b: number };
export type Hsb = { h: number; s: number; b: number };

export function hsbToRgb({ h, s, b }: Hsb): Rgb {
  const sat = Math.max(0, Math.min(100, s)) / 100, val = Math.max(0, Math.min(100, b)) / 100;
  const hue = (((h % 360) + 360) % 360) / 60, chroma = val * sat, x = chroma * (1 - Math.abs((hue % 2) - 1)), m = val - chroma;
  const [r, g, bl] = hue < 1 ? [chroma, x, 0] : hue < 2 ? [x, chroma, 0] : hue < 3 ? [0, chroma, x] : hue < 4 ? [0, x, chroma] : hue < 5 ? [x, 0, chroma] : [chroma, 0, x];
  return { r: Math.round((r + m) * 255), g: Math.round((g + m) * 255), b: Math.round((bl + m) * 255) };
}

/** RGB to HSB; a grey keeps `keepHue` (so dragging to grey and back does not lose the hue). */
export function rgbToHsb({ r, g, b }: Rgb, keepHue = 0): Hsb {
  const rr = r / 255, gg = g / 255, bb = b / 255, max = Math.max(rr, gg, bb), min = Math.min(rr, gg, bb), d = max - min;
  let h = keepHue;
  if (d > 1e-9) {
    h = max === rr ? ((gg - bb) / d) % 6 : max === gg ? (bb - rr) / d + 2 : (rr - gg) / d + 4;
    h = ((h * 60) + 360) % 360;
  }
  return { h, s: max ? (d / max) * 100 : 0, b: max * 100 };
}

export const rgbToHex = ({ r, g, b }: Rgb) => `#${[r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("")}`;
export function hexToRgb(hex: string): Rgb | null {
  const match = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
  return match ? { r: parseInt(match[1], 16), g: parseInt(match[2], 16), b: parseInt(match[3], 16) } : null;
}

/** The same hue and saturation, lightness moved by delta (−1…1), kept just inside black and white. */
export function shiftLightness(hex: string, delta: number): string {
  const hsl = hexToHsl(hex);
  if (!hsl) return hex;
  return hslToHex(hsl.h, hsl.s, Math.max(0.02, Math.min(0.98, hsl.l + delta)));
}
