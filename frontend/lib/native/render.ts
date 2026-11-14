/**
 * Native canvas renderer: draws a pose (a library symbol of an imported .fla) at any frame straight
 * from the document's own layers, keyframes, tweens and masks. No Animate player in between, so
 * what the editor shows is exactly what the editor holds. Ported from the tools/fla-spike renderer
 * (which matched Animate's own HTML5 publish to 0.44% of pixels, edges only).
 */
import type { Brush, Cmd, FlaDocument, FlaElement, Fill, InstanceElement, Keyframe, Layer, Matrix, Path, ShapeElement, Stroke, Timeline } from "../fla/xfl";
import { hexOf, mapColour, parseColour } from "./colour";
import { autoNameAt, autoNames, layerKey, type AutoNames } from "./names";
import { classOf, prepareRules, recolourFill, recolourStroke, rulesAt, scopeMatches, type ColourRule, type PreparedRule, type Trail } from "./colour";
import { frameStyles, innerFrame, layerStateAt, lerp, tweenMatrix, tweenProgress, type LayerState } from "./evaluate";

export type NativeAssets = {
  /** Library bitmap name → decoded picture. */
  images: Map<string, CanvasImageSource & { width: number; height: number }>;
};

export type RenderStats = { shapes: number; instances: number; masks: number; morphs: number; tweens: number; missing: Set<string> };

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
/** A shape found under a point: its original colour, whether it was an outline, and the instances it sits inside. */
export type ShapeHit = { color: string; stroke: boolean; trail: Trail };
/** The colour a fill stands for when picking it: the colour of a solid, the first stop of a gradient; nothing when it is see-through. */
export const styleColour = (style: Fill): string | null => (style.t === "solid" ? (style.alpha >= 0.05 ? style.color : null) : (style.stops.find((s) => s[2] >= 0.05)?.[1] ?? null));
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
  /** The instances being drawn, outermost first, and the symbols they sit in: what part-scoped colour rules are matched against. */
  private trail: Trail = [];
  private inside: string[] = [];
  private originalNames = new Map<string, AutoNames>();
  /** The names the player gives the unnamed instances of a library symbol, from the file's own timeline. */
  private namesOf(item: string): AutoNames | undefined {
    let names = this.originalNames.get(item);
    if (!names) { const original = this.doc.symbols.get(item)?.timeline; if (!original) return undefined; names = autoNames(original); this.originalNames.set(item, names); }
    return names;
  }

  constructor(readonly doc: FlaDocument, readonly assets: NativeAssets) {}

  /** While set, drawing tests shapes against one point instead of painting (see hitAt). */
  private probe: { x: number; y: number; scope: string; hit: ShapeHit | null } | null = null;
  private probeTest(ctx: Ctx, path: Path2D, style: Fill, stroke: boolean, rule?: CanvasFillRule) {
    const probe = this.probe;
    if (!probe) return;
    const color = styleColour(style);
    if (!color) return;
    const inside = stroke ? ctx.isPointInStroke(path, probe.x, probe.y) : ctx.isPointInPath(path, probe.x, probe.y, rule || "nonzero");
    if (inside && scopeMatches(probe.scope, this.trail)) probe.hit = { color, stroke, trail: this.trail.map((t) => ({ ...t })) };
  }
  /**
   * The top-most shape under one point, as the Animate player's colour picker finds it: its original
   * colour (the file's, before any colour rule), whether it was an outline, and where in the pose it
   * sits. (x, y) is a device point of `ctx`, whose transform places the pose. Masks are not applied.
   */
  hitAt(ctx: Ctx, item: string, frame: number, x: number, y: number, scope: string): ShapeHit | null {
    this.probe = { x, y, scope, hit: null };
    try { this.drawSymbol(ctx, item, frame); return this.probe.hit; } finally { this.probe = null; this.trail = []; this.inside = []; }
  }
  /** Every shape of the pose (all frames, every symbol inside it), once each, with where it sits when `scope` names a part; the whole character when scope is empty. */
  eachShape(item: string, scope: string, fn: (shape: ShapeElement, trail: Trail, owner: string) => void) {
    if (!scope) {
      const seenItems = new Set<string>(), seenShapes = new Set<ShapeElement>();
      const visit = (name: string) => {
        if (seenItems.has(name)) return;
        seenItems.add(name);
        for (const layer of this.timelineOf(name)?.layers ?? []) for (const key of layer.frames) for (const el of key.elements) {
          if (el.k === "shape") { if (!seenShapes.has(el)) { seenShapes.add(el); fn(el, [], name); } } else if (el.k === "instance") visit(el.item);
        }
      };
      visit(item);
      return;
    }
    let budget = 400000;
    const trail: Trail = [];
    const walk = (name: string, depth: number) => {
      const timeline = this.timelineOf(name);
      if (!timeline || depth > 14) return;
      const names = this.namesOf(name);
      timeline.layers.forEach((layer, li) => {
        if (layer.type === "folder" || layer.type === "guide") return;
        const lkey = layerKey(timeline.layers, li);
        for (const key of layer.frames) key.elements.forEach((el, e) => {
          if (budget-- < 0) return;
          if (el.k === "shape") { if (scopeMatches(scope, trail)) fn(el, trail, name); return; }
          if (el.k !== "instance") return;
          trail.push({ cls: this.classFor(name), name: el.name || autoNameAt(names, lkey, key.i, e) });
          walk(el.item, depth + 1);
          trail.pop();
        });
      });
    };
    walk(item, 0);
  }
  /** The colour shown for an original colour at a place in the pose (the colour rules applied). */
  shownColour(color: string, stroke: boolean, trail: Trail): string {
    const parsed = parseColour(color);
    const out = parsed && this.rules.length ? mapColour(parsed, rulesAt(this.rules, trail), stroke) : null;
    return out ? hexOf(out) : color;
  }

  setColourRules(list: ColourRule[] | undefined) { this.rules = prepareRules(list); }
  /** Library items whose Animate class is not their own name (a pose called "Symbol 1" that the player knows as "Sardar_01"). */
  readonly classes = new Map<string, string>();
  private classFor(item: string) { return this.classes.get(item) ?? classOf(item); }
  private rulesHere() { return this.rules.length ? rulesAt(this.rules, this.trail) : this.rules; }

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
    this.inside.push(item);
    this.drawTimeline(ctx, timeline, frame);
    this.inside.pop();
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
    if (this.probe) {
      ctx.save();
      ctx.transform(...el.m);
      el.fills.forEach((f, i) => this.probeTest(ctx, cached!.fills[i], f.style, false, "evenodd"));
      el.strokes.forEach((s, i) => { strokeSetup(ctx, s.style); this.probeTest(ctx, cached!.strokes[i], s.style.fill, true); });
      ctx.restore();
      return;
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
      if (this.probe) {
        if (fa) this.probeTest(ctx, path, mixFill(fa, fb, t), false, "evenodd");
        else { const sa = A.strokes[seg.s1]; if (sa) { strokeSetup(ctx, sa); this.probeTest(ctx, path, sa.fill, true); } }
        continue;
      }
      if (fa) { paint(ctx, recolourFill(mixFill(fa, fb, t), rules, false), path, "evenodd"); continue; }
      const sa = A.strokes[seg.s1], sb = B.strokes[seg.s2] || sa;
      if (!sa) continue;
      if (sa.brush && ends.every((e) => this.drawBrush(ctx, sa, ...e))) continue;
      strokeSetup(ctx, sa, lerp(sa.w, sb.w, t));
      paint(ctx, recolourFill(mixFill(sa.fill, sb.fill, t), rules, true), path, null, true);
    }
    this.stats.morphs += 1;
  }

  private drawElement(ctx: Ctx, el: FlaElement, offset: number, override?: { m?: Matrix; alpha?: number }, autoName = "") {
    if (el.k === "shape") { this.drawShape(ctx, el); return; }
    if (el.k === "bitmap") {
      if (this.probe) return;
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
    if (this.probe && alpha === 0) { ctx.restore(); return; }
    this.trail.push({ cls: this.classFor(this.inside[this.inside.length - 1] || ""), name: el.name || autoName || "" });
    this.inside.push(el.item);
    this.drawTimeline(ctx, timeline, innerFrame(el, offset, timeline.length));
    this.inside.pop();
    this.trail.pop();
    ctx.restore();
  }

  private drawLayer(ctx: Ctx, layer: Layer, frame: number, length: number, lkey = "") {
    if (layer.off) return;
    // The playhead loops: past the end the layer shows frame % length. A keyframe that holds the
    // whole timeline is the same object after the wrap, so what runs inside it keeps its clock.
    const state: LayerState | null = layerStateAt(layer, frame % length);
    if (!state) return;
    const { key, next } = state;
    const offset = key.i === 0 && key.d >= length && !next ? frame - key.i : state.offset;
    const t = tweenProgress(state);
    // What the player calls each unnamed instance, for part-scoped colour rules (only worked out when there are rules).
    const names = this.rules.length && lkey ? this.namesOf(this.inside[this.inside.length - 1]) : undefined;
    const auto = (e: number) => (names ? autoNameAt(names, lkey, key.i, e) : "");
    if (t != null && next) {
      if (key.tween === "shape" && key.morph) { this.drawMorph(ctx, key, next, t); return; }
      if (key.tween === "motion") {
        this.stats.tweens += 1;
        key.elements.forEach((el, i) => {
          const end = next.elements[i];
          if (el.k === "instance" && end?.k === "instance") {
            this.drawElement(ctx, el, offset, { m: tweenMatrix(el.m, end.m, (el as InstanceElement).pivot, t, key.rotate), alpha: lerp(el.alpha ?? 1, end.alpha ?? 1, t) }, auto(i));
          } else this.drawElement(ctx, el, offset, undefined, auto(i));
        });
        return;
      }
    }
    key.elements.forEach((el, e) => this.drawElement(ctx, el, offset, undefined, auto(e)));
  }

  drawTimeline(ctx: Ctx, timeline: Timeline, frame: number) {
    const layers = timeline.layers;
    const done = new Set<number>();
    for (let i = layers.length - 1; i >= 0; i -= 1) {
      const layer = layers[i];
      if (done.has(i) || layer.type === "folder" || layer.type === "guide") continue;
      const maskIndex = layer.type === "mask" ? i : layer.parent != null && layers[layer.parent]?.type === "mask" ? layer.parent : null;
      if (maskIndex == null) { this.drawLayer(ctx, layer, frame, timeline.length, layerKey(layers, i)); continue; }
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
      kids.forEach((j) => this.drawLayer(cc, layers[j], frame, timeline.length, layerKey(layers, j)));
      const keep = this.probe; this.probe = null;
      this.drawLayer(mc, layers[maskIndex], frame, timeline.length, layerKey(layers, maskIndex));
      this.probe = keep;
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
