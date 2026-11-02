import { hexToRgb, hsbToRgb, rgbToHex, rgbToHsb } from "@/lib/color";

/**
 * Adjust Colour Balance (Illustrator's Edit › Edit Colours › Adjust Colour Balance): each slider moves
 * a channel by −100…100 % — up towards its full value, down towards none (Hue turns by up to ±180°).
 * Greyscale turns colours grey only with Convert (otherwise it changes just the greys) and its one
 * slider is Black.
 */
export type AdjustMode = "rgb" | "hsb" | "grey";
export type AdjustSettings = {
  mode: AdjustMode;
  convert: boolean;
  /** −100…100: R, G, B · H, S, B · Black (the first only). */
  values: [number, number, number];
  fill: boolean;
  stroke: boolean;
  shadow: boolean;
};

export const ADJUST_CHANNELS: Record<AdjustMode, string[]> = {
  rgb: ["Red", "Green", "Blue"],
  hsb: ["Hue", "Saturation", "Brightness"],
  grey: ["Black"],
};

const towards = (value: number, max: number, percent: number) =>
  percent >= 0 ? value + (max - value) * (percent / 100) : value + value * (percent / 100);

export function adjustHex(hex: string, settings: AdjustSettings): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  const [a, b, c] = settings.values;
  if (settings.mode === "rgb") return rgbToHex({ r: towards(rgb.r, 255, a), g: towards(rgb.g, 255, b), b: towards(rgb.b, 255, c) });
  if (settings.mode === "hsb") {
    const hsb = rgbToHsb(rgb);
    return rgbToHex(hsbToRgb({ h: (hsb.h + a * 1.8 + 360) % 360, s: towards(hsb.s, 100, b), b: towards(hsb.b, 100, c) }));
  }
  const isGrey = Math.max(rgb.r, rgb.g, rgb.b) - Math.min(rgb.r, rgb.g, rgb.b) <= 8;
  if (!settings.convert && !isGrey) return hex;
  const black = 100 - ((0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b) / 255) * 100;
  const level = 255 * (1 - towards(black, 100, a) / 100);
  return rgbToHex({ r: level, g: level, b: level });
}

/** Nothing would change (all sliders at 0, and no grey conversion). */
export const isIdentity = (settings: AdjustSettings) =>
  settings.values.every((value) => !value) && !(settings.mode === "grey" && settings.convert);
