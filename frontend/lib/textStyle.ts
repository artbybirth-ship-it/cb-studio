import type { CSSProperties } from "react";
import type { EditorObject } from "@/types";
import { fontCss } from "@/lib/fonts";

/**
 * How a text layer looks (editor canvas; public/render-harness.html addText draws the same). Older
 * text layers keep their look: weight 800, centred, with the drop shadow.
 */
export const textCss = (object: EditorObject): CSSProperties => ({
  color: object.fillColor || "#fff",
  fontFamily: fontCss(object.fontFamily),
  fontWeight: object.fontWeight ?? 800,
  fontStyle: object.fontStyle || "normal",
  fontSize: `${Number(object.fontSize || 52)}px`,
  lineHeight: object.lineHeight ? `${object.lineHeight}px` : 1.2,
  letterSpacing: `${Number(object.letterSpacing || 0) / 1000}em`,
  textAlign: object.textAlign || "center",
  textShadow: textShadowCss(object),
  whiteSpace: "pre",
  // The outline is drawn under the letters (paint-order), so it shows its full width outside them.
  ...(object.textStrokeColor ? { WebkitTextStroke: `${2 * textStrokeWidth(object)}px ${object.textStrokeColor}`, paintOrder: "stroke fill" } : {}),
});

export const textStrokeWidth = (object: EditorObject) => Math.max(0, Number(object.textStrokeWidth ?? 2));
export const textShadowCss = (object: EditorObject) =>
  object.textShadowColor ? `0 2px 8px ${object.textShadowColor}` : object.textShadow === false ? "none" : "0 2px 8px #000";

const ALIGN_X = { left: 0, center: 0.5, right: 1 } as const;

/**
 * Point text (Illustrator): a text layer is placed by its centre (x, y), but it stays put at its
 * anchor — the left, middle or right of its first line, by alignment — while it is typed into or
 * restyled. This is the stage offset from the centre to that anchor for a w × h text box.
 */
export const textAnchorOffset = (object: EditorObject, width: number, height: number, align = object.textAlign || "center") => {
  const scale = Number(object.scale || 1);
  const ux = (ALIGN_X[align] - 0.5) * width * scale * Number(object.stretchX ?? 1) * (object.flipX ? -1 : 1);
  const uy = -0.5 * height * scale * Number(object.stretchY ?? 1);
  const radians = (Number(object.rotation || 0) * Math.PI) / 180;
  return { x: ux * Math.cos(radians) - uy * Math.sin(radians), y: ux * Math.sin(radians) + uy * Math.cos(radians) };
};

/** The new centre that keeps the anchor still when the box goes from `before` to `after` (and,
 *  for an alignment change, the anchor from one alignment to the other). */
export const keepTextAnchor = (object: EditorObject, before: { width: number; height: number }, after: { width: number; height: number },
  alignBefore = object.textAlign || "center", alignAfter = object.textAlign || "center") => {
  const from = textAnchorOffset(object, before.width, before.height, alignBefore);
  const to = textAnchorOffset(object, after.width, after.height, alignAfter);
  return { x: Number(object.x || 0) + from.x - to.x, y: Number(object.y || 0) + from.y - to.y };
};
