/**
 * Reflect (Illustrator's Reflect tool, O then Enter) for layers and character parts.
 *
 * A layer or part is drawn as rotate(r) · skew(sx, sy) · scale(with flipX), the same order on the
 * canvas, in the export harness and in the player bridge's part edits. Mirroring that across a line
 * keeps the same form: the flip toggles, the skew changes sign and the rotation becomes
 * 180 − 2·angle − r. So there is no "flip vertically" setting to add: upside down = flip + 180°.
 *
 * Angles are Illustrator's: degrees counter-clockwise from horizontal, so the Vertical axis
 * (mirror left ↔ right) is 90° and the Horizontal axis (upside down) is 0°. Rotations are the
 * editor's: degrees clockwise on screen.
 */

export type ReflectAxis = "horizontal" | "vertical" | "angle";

export const axisAngle = (axis: ReflectAxis, angle: number) => (axis === "horizontal" ? 0 : axis === "vertical" ? 90 : angle);

/** Degrees in (−180, 180]. */
export const wrapDegrees = (value: number) => {
  let next = ((value % 360) + 360) % 360;
  if (next > 180) next -= 360;
  return Math.round(next * 1000) / 1000;
};

export type Orientation = { rotation: number; flipX: boolean; skewX: number; skewY: number };

/** The orientation mirrored across a line at `angle` (Illustrator degrees). */
export const reflectOrientation = ({ rotation, flipX, skewX, skewY }: Orientation, angle: number): Orientation => ({
  rotation: wrapDegrees(180 - 2 * angle - rotation),
  flipX: !flipX,
  skewX: skewX ? -skewX : 0,
  skewY: skewY ? -skewY : 0,
});

/** A point mirrored across the line through (cx, cy) at `angle` (screen y points down). */
export const reflectPoint = (x: number, y: number, cx: number, cy: number, angle: number) => {
  const t = (-angle * Math.PI) / 180, ux = Math.cos(t), uy = Math.sin(t);
  const dx = x - cx, dy = y - cy, along = dx * ux + dy * uy;
  return { x: cx + 2 * along * ux - dx, y: cy + 2 * along * uy - dy };
};

/**
 * The same screen axis seen from inside a character (its parts are edited in the character's own
 * space): undo the character's clockwise rotation, then its mirror.
 */
export const axisInsideCharacter = (angle: number, characterRotation: number, characterFlipX: boolean) => {
  const local = angle + characterRotation;
  return characterFlipX ? 180 - local : local;
};
