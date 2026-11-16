/**
 * Native canvas renderer: draws a pose (a library symbol of an imported .fla) at any frame straight
 * from the document's own layers, keyframes, tweens and masks. No Animate player in between, so
 * what the editor shows is exactly what the editor holds. Ported from the tools/fla-spike renderer
 * (which matched Animate's own HTML5 publish to 0.44% of pixels, edges only).
 */
import type { Brush, Cmd, FlaDocument, FlaElement, Fill, InstanceElement, Keyframe, Layer, Matrix, Path, ShapeElement, Stroke, Timeline } from "../fla/xfl";
import { hexOf, mapColour, parseColour } from "./colour";
import { autoNameAt, autoNames, layerKey, type AutoNames } from "./names";
import { classOf, partNameOfClass, prepareRules, recolourFill, recolourStroke, rulesAt, scopeMatches, type ColourRule, type PreparedRule, type Trail } from "./colour";
import { frameStyles, innerFrame, layerStateAt, lerp, tweenMatrix, tweenProgress, type LayerState } from "./evaluate";

export type NativeAssets = {
  /** Library bitmap name → decoded picture. */
  images: Map<string, CanvasImageSource & { width: number; height: number }>;
};

/**
 * What the editor's part tools (Move / Rotate / Scale / Flip / Skew / Stretch / Hide on a rig part such as Head or Left arm, outside a pose) hold
 * for one part at a time: the same numbers the Animate player is sent (cb-animate-bridge.js applyNode). 
 * the pivot is a fraction of the part's own unedited box (default: bottom centre). Offsets are in the Animate document's pixels.
 */
export type PartEdit = { offsetX?: number; offsetY?: number; rotation?: number; scale?: number; flipX?: boolean; skewX?: number; skewY?: number; stretchX?: number; stretchY?: number; pivotX?: number; pivotY?: number; visible?: boolean; swapSymbol?: string };
/** The box the player is shown in (lib/native/character.ts BOX_W / BOX_H). */
const BOX_W = 720, BOX_H = 960;
const stretchOf = (v: unknown) => Math.max(0.02, Number(v ?? 1) || 1);
export const isIdentity = (o: PartEdit) => !o.offsetX && !o.offsetY && !o.rotation && (o.scale == null || Number(o.scale) === 1) && !o.flipX && !o.skewX && !o.skewY && stretchOf(o.stretchX) === 1 && stretchOf(o.stretchY) === 1;

export type RenderStats = { shapes: number; instances: number; masks: number; morphs: number; tweens: number; missing: Set<string> };

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
/** A shape found under a point: its original colour, whether it was an outline, and the instances it sits inside. */
export type ShapeHit = { color: string; stroke: boolean; trail: Trail; part?: string };
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
    const part = this.partOf(this.inside[0], this.trail);
    if (inside && scopeMatches(probe.scope, this.trail, part)) probe.hit = { color, stroke, trail: this.trail.map((t) => ({ ...t })), part };
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
  eachShape(item: string, scope: string, fn: (shape: ShapeElement, trail: Trail, owner: string, part?: string) => void) {
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
          if (el.k === "shape") { const part = this.partOf(item, trail);
            if (scopeMatches(scope, trail, part)) fn(el, trail, name, part);
            return;
          }
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
  shownColour(color: string, stroke: boolean, trail: Trail, part?: string): string {
    const parsed = parseColour(color);
    const out = parsed && this.rules.length ? mapColour(parsed, rulesAt(this.rules, trail, part), stroke) : null;
    return out ? hexOf(out) : color;
  }

  setColourRules(list: ColourRule[] | undefined) { this.rules = prepareRules(list); }
  /** Library items whose Animate class is not their own name (a pose called "Symbol 1" that the player knows as "Sardar_01"). */
  readonly classes = new Map<string, string>();
  private classFor(item: string) { return this.classes.get(item) ?? classOf(item); }
  private rulesHere() { return this.rules.length ? rulesAt(this.rules, this.trail, this.partOf(this.inside[0], this.trail)) : this.rules; }

  private partEdits = new Map<string, PartEdit>();
  private partBase: DOMMatrix | null = null;
  /** The player's stage size (the units part offsets are in); the box it is shown in is 720 × 960. */
  stage = { width: BOX_W, height: BOX_H };
  /** The part edits to draw with (by rig part key); only parts that change something are kept. */
  setPartEdits(edits: Record<string, PartEdit> | undefined | null) {
    this.partEdits = new Map(Object.entries(edits || {}).filter(([, o]) => o && (o.visible === false || o.swapSymbol || !isIdentity(o))));
  }
  /**
   * Part layers (Distribute to Layers, CHARACTER_EDITS.onlyParts): only these rig parts are drawn, as the player does it: along the way
   * from the pose to each kept part every other piece is left out; inside a kept part everything draws. Parts that are not found draw
   * the whole character (as the player).
   */
  private onlyKeys: string[] = [];
  private only: { keep: Set<string>; path: Set<string> } | null = null;
  private onlyRoot = "";
  private insideKept = 0;
  setOnlyParts(keys: string[] | undefined | null) { this.onlyKeys = (keys || []).map(String).filter(Boolean); this.onlyRoot = ""; this.only = null; }
  /** The kept parts' instance paths for the pose `root` (worked out once per pose). */
  private onlyFor(root: string) {
    if (!this.onlyKeys.length) return null;
    if (this.onlyRoot === root) return this.only;
    this.onlyRoot = root;
    const keep = new Set<string>(), path = new Set<string>();
    for (const [at, key] of this.piecesOf(root)) {
      if (!this.onlyKeys.includes(key)) continue;
      keep.add(at);
      const names = at.split("/");
      for (let k = 1; k < names.length; k += 1) path.add(names.slice(0, k).join("/"));
    }
    this.only = keep.size ? { keep, path } : null;
    return this.only;
  }
  /** Part layers: "draw" (a kept part, or nothing is filtered), "path" (a piece on the way to one: draw it, its other pieces are left out) or "skip". */
  private onlyState(el: FlaElement, autoName: string): "draw" | "path" | "skip" {
    if (this.insideKept || !this.onlyKeys.length) return "draw";
    const root = this.inside[0];
    const only = root ? this.onlyFor(root) : null;
    if (!only) return "draw";
    if (el.k !== "instance") return "skip";
    const at = [...this.trail.map((t) => t.name), el.name || autoName].join("/");
    return only.keep.has(at) ? "draw" : only.path.has(at) ? "path" : "skip";
  }
  /** The library symbol drawn for a swapped variant (partOverrides[key].swapSymbol, the export's class name, e.g. "Headcopy5"). */
  private swapItemOf(symbol: string): string | undefined {
    if (this.doc.symbols.has(symbol)) return symbol;
    for (const item of this.doc.symbols.keys()) if (this.classFor(item) === symbol) return item;
    return undefined;
  }
  /** The transform that takes the 720 × 960 box to the canvas, for the next draw (part edits are made in the box's units). */
  setPartBase(boxToCanvas: DOMMatrix) { this.partBase = boxToCanvas; }

  /**
   * Where a part's unedited drawing lies in the box: the pixels it covers at this frame (as the player's own tight measure does), looked for on a
   * half-size drawing of just that part.
   */
  private boxOf(ctx: Ctx, el: FlaElement, offset: number, override: { m?: Matrix; alpha?: number } | undefined, autoName: string): { x0: number; y0: number; x1: number; y1: number } | null {
    if (!this.partBase) return null;
    const Q = 0.5, W = Math.round(BOX_W * Q), H = Math.round(BOX_H * Q);
    const off = new OffscreenCanvas(W, H), octx = off.getContext("2d", { willReadFrequently: true })!;
    // The parent's place in the box, then at half size.
    octx.setTransform(new DOMMatrix().scale(Q).multiply(this.partBase.inverse()).multiply(ctx.getTransform()));
    const savedEdits = this.partEdits, savedProbe = this.probe;
    // The part is measured as it is drawn, so a swapped variant is measured with its own artwork (as the player does).
    this.partEdits = new Map([...savedEdits].flatMap(([k, o]): Array<[string, PartEdit]> => (o.swapSymbol ? [[k, { swapSymbol: o.swapSymbol }]] : []))); this.probe = null;
    const savedOnly = this.insideKept; this.insideKept = 1;
    try { this.drawElement(octx, el, offset, override, autoName); } finally { this.partEdits = savedEdits; this.probe = savedProbe; this.insideKept = savedOnly; }
    const data = octx.getImageData(0, 0, W, H).data;
    let x0 = W, y0 = H, x1 = -1, y1 = -1;
    for (let y = 0; y < H; y += 1) for (let x = 0; x < W; x += 1) if (data[(y * W + x) * 4 + 3] > 24) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    if (x1 < x0) return null;
    return { x0: x0 / Q, y0: y0 / Q, x1: (x1 + 1) / Q, y1: (y1 + 1) / Q };
  }
  /** The part edit that applies to this instance (a top-level rig piece of the pose), as a canvas transform to lay over it. */
  private partEditFor(ctx: Ctx, el: InstanceElement, offset: number, override: { m?: Matrix; alpha?: number } | undefined, autoName: string): { hide: boolean; m?: DOMMatrix; swap?: string } | undefined {
    const root = this.inside[0];
    if (!root || !this.partBase) return undefined;
    const names = [...this.trail.map((t) => t.name), el.name || autoName];
    if (names.some((n) => !n)) return undefined;
    const key = this.piecesOf(root).get(names.join("/"));
    const edit = key ? this.partEdits.get(key) : undefined;
    if (!edit) return undefined;
    if (edit.visible === false) return { hide: true };
    // A same-character variant: the part keeps its place, motion and edit, and draws another library symbol's artwork in its own space.
    const swap = edit.swapSymbol ? this.swapItemOf(String(edit.swapSymbol)) : undefined;
    if (isIdentity(edit)) return swap ? { hide: false, swap } : undefined;
    const box = this.boxOf(ctx, el, offset, override, autoName);
    if (!box) return swap ? { hide: false, swap } : undefined;
    const th = (Number(edit.rotation || 0) * Math.PI) / 180, c = Math.cos(th), sn = Math.sin(th);
    const sc = Math.max(0.02, Number(edit.scale == null ? 1 : edit.scale || 1)), sx = sc * stretchOf(edit.stretchX) * (edit.flipX ? -1 : 1), sy = sc * stretchOf(edit.stretchY);
    const tx = Math.tan((Number(edit.skewX || 0) * Math.PI) / 180), ty = Math.tan((Number(edit.skewY || 0) * Math.PI) / 180);
    const a11 = sx * (c - sn * ty), a12 = sy * (c * tx - sn), a21 = sx * (sn + c * ty), a22 = sy * (sn * tx + c);
    const fx = edit.pivotX == null || !isFinite(Number(edit.pivotX)) ? 0.5 : Number(edit.pivotX), fy = edit.pivotY == null || !isFinite(Number(edit.pivotY)) ? 1 : Number(edit.pivotY);
    const pivotX = box.x0 + fx * (box.x1 - box.x0), pivotY = box.y0 + fy * (box.y1 - box.y0);
    // Offsets are in the player's stage units (the Animate document's pixels), the box is 720 × 960.
    const kx = BOX_W / Math.max(1, this.stage.width), ky = BOX_H / Math.max(1, this.stage.height);
    const ex = Number(edit.offsetX || 0) * kx + pivotX - (a11 * pivotX + a12 * pivotY), ey = Number(edit.offsetY || 0) * ky + pivotY - (a21 * pivotX + a22 * pivotY);
    const inBox = new DOMMatrix([a11, a21, a12, a22, ex, ey]);
    return { hide: false, m: this.partBase.multiply(inBox).multiply(this.partBase.inverse()), swap };
  }

  private pieceCache = new Map<string, Map<string, string>>();
  /**
   * The rig's parts as the Animate player finds them (cb-animate-bridge.js discoverNamed): the pose's instances whose symbol has a
   * real name ("Head", "Leftarm"; copies and numbers dropped), looking through unnamed wrappers; one lone piece is opened up. Each gets
   * the key "head", "leftArm"… (a repeat gets a number). Worked out from the pose's first frame and the file's own timelines, by the
   * names of the instances leading to the piece. Plain colour-rule scopes ("symbol3") are matched against these.
   */
  private piecesOf(root: string): Map<string, string> {
    let found = this.pieceCache.get(root);
    if (found) return found;
    type Piece = { path: string[]; name: string; item: string };
    const collect = (item: string, path: string[], depth: number, out: Piece[]) => {
      const timeline = this.doc.symbols.get(item)?.timeline ?? this.timelineOf(item);
      if (!timeline) return;
      const names = this.namesOf(item);
      // Display order, back to front: the bottom layer first.
      for (let li = timeline.layers.length - 1; li >= 0; li -= 1) {
        const layer = timeline.layers[li];
        if (layer.type === "folder" || layer.type === "guide") continue;
        const state = layerStateAt(layer, 0);
        if (!state) continue;
        state.key.elements.forEach((el, e) => {
          if (el.k !== "instance") return;
          const at = [...path, el.name || autoNameAt(names, layerKey(timeline.layers, li), state.key.i, e)];
          const name = partNameOfClass(classOf(el.item));
          if (name) out.push({ path: at, name, item: el.item });
          else if (depth < 6) collect(el.item, at, depth + 1, out);
        });
      }
    };
    let pieces: Piece[] = [];
    collect(root, [], 0, pieces);
    for (let i = 0; i < 3 && pieces.length === 1; i += 1) {
      const inner: Piece[] = [];
      collect(pieces[0].item, pieces[0].path, 0, inner);
      if (inner.length < 2) break;
      pieces = inner;
    }
    found = new Map();
    if (pieces.length >= 2) {
      const used = new Set<string>();
      for (const piece of pieces) {
        const lower = piece.name.charAt(0).toLowerCase() + piece.name.slice(1);
        let key = lower, n = 2;
        while (used.has(key)) key = lower + n++;
        used.add(key);
        found.set(piece.path.join("/"), key);
      }
    }
    this.pieceCache.set(root, found);
    return found;
  }
  /** The rig part keys the pose `root` has (what part edits and part layers can name). */
  partKeys(root: string): Set<string> { return new Set(this.piecesOf(root).values()); }
  /** The key of the rig part a shape drawn at `trail` is inside (the outermost one), or undefined. */
  partOf(root: string | undefined, trail: Trail): string | undefined {
    if (!root || !trail.length) return undefined;
    const pieces = this.piecesOf(root);
    if (!pieces.size) return undefined;
    const names = trail.map((t) => t.name);
    for (let k = 1; k <= names.length; k += 1) {
      if (names[k - 1] === "") break;
      const key = pieces.get(names.slice(0, k).join("/"));
      if (key) return key;
    }
    return undefined;
  }

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
    const only = this.onlyState(el, autoName);
    if (only === "skip") return;
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
    const part = this.partEdits.size ? this.partEditFor(ctx, el, offset, override, autoName) : undefined;
    if (part?.hide) return;
    const item = part?.swap || el.item;
    const timeline = this.timelineOf(item);
    if (!timeline) { this.stats.missing.add(item); return; }
    this.stats.instances += 1;
    ctx.save();
    if (part?.m) ctx.setTransform(part.m.multiply(ctx.getTransform()));
    ctx.transform(...(override?.m || el.m));
    const alpha = override?.alpha ?? el.alpha;
    if (alpha != null) ctx.globalAlpha *= alpha;
    if (this.probe && alpha === 0) { ctx.restore(); return; }
    this.trail.push({ cls: this.classFor(this.inside[this.inside.length - 1] || ""), name: el.name || autoName || "" });
    this.inside.push(item);
    if (only === "draw" && this.onlyKeys.length) this.insideKept += 1;
    try { this.drawTimeline(ctx, timeline, innerFrame(el, offset, timeline.length)); } finally { if (only === "draw" && this.onlyKeys.length) this.insideKept -= 1; }
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
    const names = (this.rules.length || this.partEdits.size || this.onlyKeys.length) && lkey ? this.namesOf(this.inside[this.inside.length - 1]) : undefined;
    const auto = (e: number) => (names ? autoNameAt(names, lkey, key.i, e) : "");
    if (t != null && next) {
      if (key.tween === "shape" && key.morph) { if (!this.insideKept && this.onlyKeys.length && this.onlyFor(this.inside[0] || "")) return; this.drawMorph(ctx, key, next, t); return; }
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
      // Picking a colour: the top-most shape among the masked layers counts only where the mask covers the point.
      const outer = this.probe;
      const inner = outer ? { ...outer, hit: null as ShapeHit | null } : null;
      this.probe = inner;
      kids.forEach((j) => this.drawLayer(cc, layers[j], frame, timeline.length, layerKey(layers, j)));
      const coverage = outer ? { x: outer.x, y: outer.y, scope: "", hit: null as ShapeHit | null } : null;
      this.probe = coverage;
      this.drawLayer(mc, layers[maskIndex], frame, timeline.length, layerKey(layers, maskIndex));
      this.probe = outer;
      if (outer) { if (inner?.hit && coverage?.hit) outer.hit = inner.hit; continue; }
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
