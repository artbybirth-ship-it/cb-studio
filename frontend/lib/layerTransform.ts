/**
 * Geometry for the Transform panel and Align (Illustrator). A layer is drawn at its position (the
 * centre of its box) as rotate(r) · skew(kx, ky) · scaleX(flip), the same order as the editor's CSS
 * (StageCanvas characterTransformCss / layerTransformCss). Its artwork box is given in the layer's
 * own, unrotated stage px relative to that position, already including scale and stretch.
 */

/** A layer's artwork box in its own unrotated stage px, relative to its position (centre). */
export type LayerGeometry = { left: number; top: number; width: number; height: number };

export type Orientation = { rotation: number; skewX: number; skewY: number; flipX: boolean };

export type Point = { x: number; y: number };

/** The layer's 2×2 matrix, CSS order: x' = a·x + c·y, y' = b·x + d·y. */
export function layerMatrix({ rotation, skewX, skewY, flipX }: Orientation) {
  const r = (rotation * Math.PI) / 180, cos = Math.cos(r), sin = Math.sin(r);
  const tx = Math.tan((skewX * Math.PI) / 180), ty = Math.tan((skewY * Math.PI) / 180);
  const f = flipX ? -1 : 1;
  return { a: (cos - sin * ty) * f, b: (sin + cos * ty) * f, c: cos * tx - sin, d: sin * tx + cos };
}

const apply = (m: ReturnType<typeof layerMatrix>, p: Point): Point => ({ x: m.a * p.x + m.c * p.y, y: m.b * p.x + m.d * p.y });

/** Registration point (0, ½ or 1 of the box per axis) in the layer's own coordinates. */
export const localReference = (box: LayerGeometry, rx: number, ry: number): Point => ({ x: box.left + rx * box.width, y: box.top + ry * box.height });

/** A point of the layer in stage coordinates. */
export const toStage = (position: Point, orientation: Orientation, local: Point): Point => {
  const p = apply(layerMatrix(orientation), local);
  return { x: position.x + p.x, y: position.y + p.y };
};

/** The position that puts `local` exactly on `stagePoint` for the given orientation. */
export const positionFor = (stagePoint: Point, orientation: Orientation, local: Point): Point => {
  const p = apply(layerMatrix(orientation), local);
  return { x: stagePoint.x - p.x, y: stagePoint.y - p.y };
};

/** Axis-aligned bounds of the layer's artwork on the stage. */
export function stageBounds(position: Point, orientation: Orientation, box: LayerGeometry) {
  const corners = [[0, 0], [1, 0], [1, 1], [0, 1]].map(([rx, ry]) => toStage(position, orientation, localReference(box, rx, ry)));
  const xs = corners.map((p) => p.x), ys = corners.map((p) => p.y);
  return { left: Math.min(...xs), top: Math.min(...ys), right: Math.max(...xs), bottom: Math.max(...ys) };
}

export type AlignAction = "left" | "hcenter" | "right" | "top" | "vcenter" | "bottom" | "hdistribute" | "vdistribute";
type Bounds = ReturnType<typeof stageBounds>;

/**
 * Moves (dx, dy per layer) for an Align panel action. `reference` is the selection's bounds, or the
 * stage when aligning to the stage. Distribute spaces the centres evenly between the outermost two.
 */
export function alignMoves(items: Array<{ id: string; bounds: Bounds }>, action: AlignAction, reference: Bounds): Array<{ id: string; dx: number; dy: number }> {
  const cx = (b: Bounds) => (b.left + b.right) / 2, cy = (b: Bounds) => (b.top + b.bottom) / 2;
  if (action === "hdistribute" || action === "vdistribute") {
    const horizontal = action === "hdistribute";
    const centre = horizontal ? cx : cy;
    const sorted = [...items].sort((p, q) => centre(p.bounds) - centre(q.bounds));
    if (sorted.length < 3) return [];
    const first = centre(sorted[0].bounds), last = centre(sorted[sorted.length - 1].bounds);
    const step = (last - first) / (sorted.length - 1);
    return sorted.map((item, index) => {
      const delta = first + step * index - centre(item.bounds);
      return { id: item.id, dx: horizontal ? delta : 0, dy: horizontal ? 0 : delta };
    });
  }
  return items.map(({ id, bounds }) => {
    switch (action) {
      case "left": return { id, dx: reference.left - bounds.left, dy: 0 };
      case "hcenter": return { id, dx: cx(reference) - cx(bounds), dy: 0 };
      case "right": return { id, dx: reference.right - bounds.right, dy: 0 };
      case "top": return { id, dx: 0, dy: reference.top - bounds.top };
      case "vcenter": return { id, dx: 0, dy: cy(reference) - cy(bounds) };
      default: return { id, dx: 0, dy: reference.bottom - bounds.bottom };
    }
  });
}
