/**
 * Native canvas renderer: draws a pose (a library symbol of an imported .fla) at any frame straight
 * from the document's own layers, keyframes, tweens and masks. No Animate player in between, so
 * what the editor shows is exactly what the editor holds. Ported from the tools/fla-spike renderer
 * (which matched Animate's own HTML5 publish to 0.44% of pixels, edges only).
 */
import type { Brush, Cmd, FlaDocument, FlaElement, Fill, InstanceElement, Keyframe, Layer, Matrix, Path, ShapeElement, Stroke, Timeline } from "../fla/xfl";
import { prepareRules, recolourFill, recolourStroke, rulesAt, type ColourRule, type PreparedRule } from "./colour";
import { frameStyles, innerFrame, layerStateAt, lerp, tweenMatrix, tweenProgress, type LayerState } from "./evaluate";

export type NativeAssets = {
  /** Library bitmap name → decoded picture. */
  images: Map<string, CanvasImageSource & { width: number; height: number }>;
};

export type RenderStats = { shapes: number; instances: number; masks: number; morphs: number; tweens: number; missing: Set<string> };

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
const GRADIENT_HALF = 819.2;
const CAPS: Record<string, CanvasLineCap> = { none: "butt", round: "round", square: "square" };

const rgba = (color: string, alpha: number) => {
  const h = color.replace("#", "");
  return `rgba(${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)},${alpha})`;
};
function mixFill(a: Fill, b: Fill, t: number): Fill {
  if (a.t !== "solid" || b.t !== "solid") return a;
  const c = (s: string, i: number) => parseInt(s.replace("#", "").slice(i, i + 2), 16);
  const color = "#" + [0, 2, 4].map((i) => Math.round(lerp(c(a.color, i), c(b.color, i), t)).toString(16).padStart(2, "0")).join("");
  return { t: "solid", color, alpha: lerp(a.alpha, b.alpha, t) };
}

function pathOf(cmds: Cmd[]): Path2D {
  const p = new Path2D();
  for (const c of cmds) {
    if (c[0] === "M") p.moveTo(c[1], c[2]);
    else if (c[0] === "L") p.lineTo(c[1], c[2]);
    else p.quadraticCurveTo(c[1], c[2], c[3], c[4]);
  }
  return p;
}
function paint(ctx: Ctx, style: Fill, path: Path2D, rule: CanvasFillRule | null, stroke = false) {
  if (style.t === "solid") {
    const colour = rgba(style.color, style.alpha);
    if (stroke) { ctx.strokeStyle = colour; ctx.stroke(path); } else { ctx.fillStyle = colour; ctx.fill(path, rule || "nonzero"); }
    return;
  }
  const R = GRADIENT_HALF;
  const g = style.t === "linear" ? ctx.createLinearGradient(-R, 0, R, 0) : ctx.createRadialGradient(style.focal * R, 0, 0, 0, 0, R);
  for (const [ratio, colour, alpha] of style.stops) g.addColorStop(Math.max(0, Math.min(1, ratio)), rgba(colour, alpha));
  if (stroke) {
    const first = style.stops[0];
    ctx.strokeStyle = first ? rgba(first[1], first[2]) : "#000";
    ctx.stroke(path);
    return;
  }
  ctx.save();
  ctx.clip(path, rule || "nonzero");
  ctx.transform(...style.m);
  ctx.fillStyle = g;
  ctx.fillRect(-R * 50, -R * 50, R * 100, R * 100);
  ctx.restore();
}
function strokeSetup(ctx: Ctx, s: Stroke, width = s.w) {
  ctx.lineWidth = Math.max(width, 0.05);
  ctx.lineCap = CAPS[s.caps] || "round";
  ctx.lineJoin = s.joints === "miter" ? "miter" : s.joints === "bevel" ? "bevel" : "round";
  ctx.miterLimit = s.miter || 3;
}
const lastPoint = (cmds: Cmd[]): [number, number] => { const c = cmds[cmds.length - 1]; return [c[c.length - 2] as number, c[c.length - 1] as number]; };

export class NativeRenderer {
  readonly stats: RenderStats = { shapes: 0, instances: 0, masks: 0, morphs: 0, tweens: 0, missing: new Set() };
  /** Edited timelines by library name, laid over the document's own (the editor's working copy). */
  readonly overrides = new Map<string, Timeline>();
  private brushImages = new Map<string, HTMLImageElement>();
  private pathCache = new WeakMap<ShapeElement, { fills: Path2D[]; strokes: Path2D[] }>();
  private styleCache = new WeakMap<Keyframe, ReturnType<typeof frameStyles>>();

  /** The character's colour rules, applied to every shape as it is drawn (originals are never changed, so rules never chain). */
  private rules: PreparedRule[] = [];
  /** Names of the instances being drawn, outermost first: what part-scoped colour rules are matched against. */
  private trail: string[] = [];

  constructor(readonly doc: FlaDocument, readonly assets: NativeAssets) {}

  setColourRules(list: ColourRule[] | undefined) { this.rules = prepareRules(list); }
  private rulesHere() { return this.rules.length ? rulesAt(this.rules, this.trail.join("/")) : this.rules; }

  /** Art-brush pictures must be decoded before the first draw that uses them. */
  async loadBrushes(brushes: Record<string, Brush> = this.doc.brushes) {
    await Promise.all(Object.entries(brushes).map(([id, brush]) => new Promise<void>((done) => {
      if (!brush.svg) return done();
      const img = new Image();
      img.onload = () => { this.brushImages.set(id, img); done(); };
      img.onerror = () => done();
      img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(brush.svg);
    })));
  }

  timelineOf(item: string): Timeline | undefined { return this.overrides.get(item) ?? this.doc.symbols.get(item)?.timeline; }

  /** Draws the library symbol `item` at `frame` into ctx, in the symbol's own coordinates. */
  drawSymbol(ctx: Ctx, item: string, frame: number) {
    const timeline = this.timelineOf(item);
    if (!timeline) { this.stats.missing.add(item); return; }
    this.drawTimeline(ctx, timeline, frame);
  }

  private drawBrush(ctx: Ctx, style: Stroke, x0: number, y0: number, x1: number, y1: number) {
    const img = style.brush ? this.brushImages.get(style.brush) : undefined;
    if (!img) return false;
    const length = Math.hypot(x1 - x0, y1 - y0);
    if (length < 0.01) return true;
    ctx.save();
    ctx.translate(x0, y0);
    ctx.rotate(Math.atan2(y1 - y0, x1 - x0));
    ctx.drawImage(img, 0, -(length * (img.naturalHeight / img.naturalWidth)) / 2, length, length * (img.naturalHeight / img.naturalWidth));
    ctx.restore();
    return true;
  }

  private drawShape(ctx: Ctx, el: ShapeElement) {
    let cached = this.pathCache.get(el);
    if (!cached) {
      const build = (list: Array<{ paths: Path[] }>) => list.map((entry) => { const p = new Path2D(); entry.paths.forEach((c) => p.addPath(pathOf(c))); return p; });
      cached = { fills: build(el.fills), strokes: build(el.strokes) };
      this.pathCache.set(el, cached);
    }
    const rules = this.rulesHere();
    ctx.save();
    ctx.transform(...el.m);
    el.fills.forEach((f, i) => paint(ctx, recolourFill(f.style, rules, false), cached!.fills[i], "evenodd"));
    el.strokes.forEach((s0, i) => {
      const s = { ...s0, style: recolourStroke(s0.style, rules) };
      if (s.style.brush && s.paths.every((c) => this.drawBrush(ctx, s.style, c[0][1] as number, c[0][2] as number, ...lastPoint(c)))) return;
      strokeSetup(ctx, s.style);
      paint(ctx, s.style.fill, cached!.strokes[i], null, true);
    });
    ctx.restore();
    this.stats.shapes += 1;
  }

  private stylesOf(key: Keyframe) {
    let styles = this.styleCache.get(key);
    if (!styles) { styles = frameStyles(key.elements); this.styleCache.set(key, styles); }
    return styles;
  }

  /** Shape tween: Animate's matched start/end curves (timeline space), blended at t. */
  private drawMorph(ctx: Ctx, key: Keyframe, next: Keyframe, t: number) {
    const A = this.stylesOf(key), B = this.stylesOf(next), rules = this.rulesHere();
    const groups = new Map<string, { seg: NonNullable<Keyframe["morph"]>[number]; path: Path2D; ends: Array<[number, number, number, number]> }>();
    for (const seg of key.morph || []) {
      const p = new Path2D();
      const x0 = lerp(seg.a[0], seg.b[0], t), y0 = lerp(seg.a[1], seg.b[1], t);
      let x1 = x0, y1 = y0;
      p.moveTo(x0, y0);
      for (const c of seg.curves) {
        x1 = lerp(c[3], c[7], t); y1 = lerp(c[4], c[8], t);
        if (c[0]) p.lineTo(x1, y1); else p.quadraticCurveTo(lerp(c[1], c[5], t), lerp(c[2], c[6], t), x1, y1);
      }
      const k = `${seg.f1}|${seg.f2}|${seg.s1}|${seg.s2}`;
      const group = groups.get(k) || groups.set(k, { seg, path: new Path2D(), ends: [] }).get(k)!;
      group.path.addPath(p);
      group.ends.push([x0, y0, x1, y1]);
    }
    for (const { seg, path, ends } of groups.values()) {
      const fa = A.fills[seg.f1], fb = B.fills[seg.f2] || fa;
      if (fa) { paint(ctx, recolourFill(mixFill(fa, fb, t), rules, false), path, "evenodd"); continue; }
      const sa = A.strokes[seg.s1], sb = B.strokes[seg.s2] || sa;
      if (!sa) continue;
      if (sa.brush && ends.every((e) => this.drawBrush(ctx, sa, ...e))) continue;
      strokeSetup(ctx, sa, lerp(sa.w, sb.w, t));
      paint(ctx, recolourFill(mixFill(sa.fill, sb.fill, t), rules, true), path, null, true);
    }
    this.stats.morphs += 1;
  }

  private drawElement(ctx: Ctx, el: FlaElement, offset: number, override?: { m?: Matrix; alpha?: number }) {
    if (el.k === "shape") { this.drawShape(ctx, el); return; }
    if (el.k === "bitmap") {
      const image = this.assets.images.get(el.item);
      if (!image) { this.stats.missing.add(el.item); return; }
      ctx.save();
      ctx.transform(...(override?.m || el.m));
      ctx.drawImage(image, 0, 0);
      ctx.restore();
      return;
    }
    const timeline = this.timelineOf(el.item);
    if (!timeline) { this.stats.missing.add(el.item); return; }
    this.stats.instances += 1;
    ctx.save();
    ctx.transform(...(override?.m || el.m));
    const alpha = override?.alpha ?? el.alpha;
    if (alpha != null) ctx.globalAlpha *= alpha;
    if (el.name) this.trail.push(el.name);
    this.drawTimeline(ctx, timeline, innerFrame(el, offset, timeline.length));
    if (el.name) this.trail.pop();
    ctx.restore();
  }

  private drawLayer(ctx: Ctx, layer: Layer, frame: number, length: number) {
    if (layer.off) return;
    // The playhead loops: past the end the layer shows frame % length. A keyframe that holds the
    // whole timeline is the same object after the wrap, so what runs inside it keeps its clock.
    const state: LayerState | null = layerStateAt(layer, frame % length);
    if (!state) return;
    const { key, next } = state;
    const offset = key.i === 0 && key.d >= length && !next ? frame - key.i : state.offset;
    const t = tweenProgress(state);
    if (t != null && next) {
      if (key.tween === "shape" && key.morph) { this.drawMorph(ctx, key, next, t); return; }
      if (key.tween === "motion") {
        this.stats.tweens += 1;
        key.elements.forEach((el, i) => {
          const end = next.elements[i];
          if (el.k === "instance" && end?.k === "instance") {
            this.drawElement(ctx, el, offset, { m: tweenMatrix(el.m, end.m, (el as InstanceElement).pivot, t, key.rotate), alpha: lerp(el.alpha ?? 1, end.alpha ?? 1, t) });
          } else this.drawElement(ctx, el, offset);
        });
        return;
      }
    }
    key.elements.forEach((el) => this.drawElement(ctx, el, offset));
  }

  drawTimeline(ctx: Ctx, timeline: Timeline, frame: number) {
    const layers = timeline.layers;
    const done = new Set<number>();
    for (let i = layers.length - 1; i >= 0; i -= 1) {
      const layer = layers[i];
      if (done.has(i) || layer.type === "folder" || layer.type === "guide") continue;
      const maskIndex = layer.type === "mask" ? i : layer.parent != null && layers[layer.parent]?.type === "mask" ? layer.parent : null;
      if (maskIndex == null) { this.drawLayer(ctx, layer, frame, timeline.length); continue; }
      // Masked group: the content layers, then keep only what the mask layer covers.
      done.add(maskIndex);
      const kids: number[] = [];
      for (let j = layers.length - 1; j >= 0; j -= 1) if (layers[j].parent === maskIndex) { kids.push(j); done.add(j); }
      this.stats.masks += 1;
      const { width, height } = ctx.canvas;
      const content = new OffscreenCanvas(width, height), mask = new OffscreenCanvas(width, height);
      const cc = content.getContext("2d")!, mc = mask.getContext("2d")!;
      cc.setTransform(ctx.getTransform());
      mc.setTransform(ctx.getTransform());
      cc.globalAlpha = ctx.globalAlpha;
      kids.forEach((j) => this.drawLayer(cc, layers[j], frame, timeline.length));
      this.drawLayer(mc, layers[maskIndex], frame, timeline.length);
      cc.setTransform(1, 0, 0, 1, 0, 0);
      cc.globalAlpha = 1;
      cc.globalCompositeOperation = "destination-in";
      cc.drawImage(mask, 0, 0);
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 1;
      ctx.drawImage(content, 0, 0);
      ctx.restore();
    }
  }
}
