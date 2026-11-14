/**
 * A placed character drawn natively, without React: what the scene editor's canvas
 * (components/NativeCharacterCanvas.tsx) and the video renderer's page (public/render-harness.html,
 * through public/vendor/cb-native.js, built by tools/native-test/build-native-bundle.js) both use,
 * so the editor and the exported video draw the same pixels.
 *
 * The character's pose is drawn from its own layers and keyframes with the edits made in the native
 * editor (object.nativePose) laid over them, on a 720 × 960 canvas that covers the character's box
 * the way its Animate player does: the unedited pose fitted at 92% and centred, so edits never
 * move the character.
 */
import type { NativeEdits } from "./store";
import { loadNativeDoc, type NativeLoaded } from "./loadDoc";
import { registerLibrary } from "./library";
import { NativeRenderer } from "./render";
import { hexOf, parseColour, sameFamily, toHsl, type ColourRule } from "./colour";
import { resolvePoseSource, type PoseSource } from "./resolve";

export const BOX_W = 720, BOX_H = 960;
/** Where the pose sits in its box: scale and offset, in box pixels. */
export type Fit = { s: number; tx: number; ty: number };
const fitCache = new Map<string, Fit>();

/** The player's own fit, read from its running page (exportRoot is what its fit() positioned): exactly where the pose is drawn. Null until the player is up. */
export function playerFitOf(frame: HTMLIFrameElement | null | undefined): Fit | null {
  try {
    const root = (frame?.contentWindow as unknown as { exportRoot?: { scaleX: number; x: number; y: number } } | null)?.exportRoot;
    return root && Number.isFinite(root.scaleX) && root.scaleX > 0 ? { s: root.scaleX, tx: root.x, ty: root.y } : null;
  } catch { return null; }
}

/** Where the unedited pose sits in its box, worked out from its artwork when the player is not available. Cached per pose. */
function fitOf(key: string, loaded: NativeLoaded, item: string) {
  const cached = fitCache.get(key);
  if (cached) return cached;
  const SIZE = 1400, S = 0.5;
  const scratch = new OffscreenCanvas(SIZE, SIZE), ctx = scratch.getContext("2d", { willReadFrequently: true })!;
  const plain = new NativeRenderer(loaded.doc, loaded.renderer.assets);
  ctx.setTransform(S, 0, 0, S, SIZE / 2, SIZE / 2);
  plain.drawSymbol(ctx, item, 0);
  const data = ctx.getImageData(0, 0, SIZE, SIZE).data;
  let x0 = SIZE, y0 = SIZE, x1 = -1, y1 = -1;
  for (let y = 0; y < SIZE; y += 1) for (let x = 0; x < SIZE; x += 1) if (data[(y * SIZE + x) * 4 + 3] > 8) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  const bx = x1 < 0 ? -BOX_W / 2 : (x0 - SIZE / 2) / S, by = x1 < 0 ? -BOX_H / 2 : (y0 - SIZE / 2) / S;
  const bw = x1 < 0 ? BOX_W : (x1 - x0) / S, bh = x1 < 0 ? BOX_H : (y1 - y0) / S;
  const s = Math.min((BOX_W * 0.92) / bw, (BOX_H * 0.92) / bh);
  const fit = { s, tx: (BOX_W - bw * s) / 2 - bx * s, ty: (BOX_H - bh * s) / 2 - by * s };
  fitCache.set(key, fit);
  return fit;
}

export type NativeCharacterSource = { assetUrl?: string; loopMode?: string; nativePose?: Record<string, NativeEdits>; colorReplacements?: ColourRule[] };

export type NativeCharacter = {
  /** Loads the Animate file and the edits; resolves true when the character can be drawn. */
  load(): Promise<boolean>;
  readonly ready: boolean;
  /** Colour rules to draw with (the character's Recolour rules); call draw again after changing them. */
  setColourRules(rules: ColourRule[] | undefined): void;
  /** Draws source time `seekMs` onto `canvas`, at `resolution` times the 720 × 960 box. */
  draw(canvas: HTMLCanvasElement, seekMs: number, resolution?: number, fit?: Fit | null): void;
  /** What the Animate player's colour finder answers, for this drawing (the colour tools use these when the native drawing is what is on screen). (x, y) are 0..1 over the 720 × 960 box. */
  colourAt(x: number, y: number, scope: string): { picked: string; original: string } | null;
  palette(scope: string): ColourEntry[];
  relatives(hex: string, scope: string): { strokes: string[]; shadows: string[] };
};
export type ColourEntry = { color: string; current: string; fills: number; strokes: number };

export function createNativeCharacter(object: NativeCharacterSource): NativeCharacter {
  let state: { source: PoseSource; renderer: NativeRenderer; loaded: NativeLoaded } | null = null;
  const edits = Object.values(object.nativePose || {});
  let rulesNow = object.colorReplacements;
  /** Where the last draw put the pose: the frame and placement the colour finder looks at. */
  let last: { frame: number; fit: Fit } | null = null;
  const huesOf = (style: import("../fla/xfl").Fill): string[] => (style.t === "solid" ? [style] : style.stops.map(([, color, alpha]) => ({ color, alpha }))).flatMap((c) => (c.alpha >= 0.05 ? [hexOf(parseColour(c.color) ?? { r: 0, g: 0, b: 0, a: 1 })] : []));
  return {
    get ready() { return Boolean(state); },
    setColourRules(rules) { rulesNow = rules; state?.renderer.setColourRules(rules); },
    async load() {
      const source = object.assetUrl ? await resolvePoseSource(object.assetUrl) : null;
      if (!source) return false;
      const loaded = await loadNativeDoc(source.flaUrl);
      for (const edit of edits) await registerLibrary(loaded, edit.library);
      // This character's own renderer over the shared document: its edits are laid over the pose, other placed characters keep theirs.
      const renderer = new NativeRenderer(loaded.doc, loaded.renderer.assets);
      await renderer.loadBrushes();
      for (const [cls, edit] of Object.entries(object.nativePose || {})) {
        const keys = Object.keys(edit.symbols);
        const item = edit.pose ?? (keys.includes(source.item) ? source.item : keys[0]);
        if (item) renderer.classes.set(item, cls);
      }
      renderer.setColourRules(rulesNow);
      for (const edit of edits) for (const [name, timeline] of Object.entries(edit.symbols)) if (loaded.doc.symbols.has(name)) renderer.overrides.set(name, timeline);
      fitOf(`${source.flaUrl}|${source.item}`, loaded, source.item);
      state = { source, renderer, loaded };
      return true;
    },
    draw(canvas, seekMs, resolution = 1, fitOverride) {
      if (!state) return;
      const { source, renderer, loaded } = state;
      const timeline = renderer.timelineOf(source.item);
      if (!timeline) return;
      const frames = Math.max(1, timeline.length);
      const raw = Math.floor((seekMs / 1000) * source.fps + 1e-6);
      const frame = object.loopMode === "loop" ? raw % frames : Math.min(frames - 1, raw);
      const scale = Math.max(1, Math.min(4, resolution));
      if (canvas.width !== Math.round(BOX_W * scale)) { canvas.width = Math.round(BOX_W * scale); canvas.height = Math.round(BOX_H * scale); }
      const ctx = canvas.getContext("2d")!;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const fit = fitOverride || fitOf(`${source.flaUrl}|${source.item}`, loaded, source.item);
      ctx.setTransform(fit.s * scale, 0, 0, fit.s * scale, fit.tx * scale, fit.ty * scale);
      renderer.drawSymbol(ctx, source.item, frame);
      last = { frame, fit };
    },
    colourAt(x, y, scope) {
      if (!state || !last) return null;
      const { source, renderer } = state, { frame, fit } = last;
      const ctx = new OffscreenCanvas(1, 1).getContext("2d")!;
      // The pose's own placement, shifted so the asked-for point of the box lands on the middle of the one pixel.
      ctx.setTransform(fit.s, 0, 0, fit.s, fit.tx - x * BOX_W + 0.5, fit.ty - y * BOX_H + 0.5);
      const hit = renderer.hitAt(ctx, source.item, frame, 0.5, 0.5, scope);
      if (!hit) return null;
      return { picked: renderer.shownColour(hit.color, hit.stroke, hit.trail), original: hexOf(parseColour(hit.color) ?? { r: 0, g: 0, b: 0, a: 1 }) };
    },
    palette(scope) {
      if (!state) return [];
      const found = new Map<string, ColourEntry>();
      state.renderer.eachShape(state.source.item, scope, (shape, trail) => {
        const note = (style: import("../fla/xfl").Fill, stroke: boolean) => {
          for (const hex of huesOf(style)) {
            const entry = found.get(hex) ?? found.set(hex, { color: hex, current: state!.renderer.shownColour(hex, stroke, trail), fills: 0, strokes: 0 }).get(hex)!;
            if (stroke) entry.strokes += 1; else entry.fills += 1;
            const now = state!.renderer.shownColour(hex, stroke, trail);
            if (now !== hex) entry.current = now;
          }
        };
        shape.fills.forEach((f) => note(f.style, false));
        shape.strokes.forEach((s) => note(s.style.fill, true));
      });
      return [...found.values()].sort((a, b) => b.fills + b.strokes - (a.fills + a.strokes)).slice(0, 80);
    },
    relatives(hexIn, scope) {
      const none = { strokes: [], shadows: [] };
      const base = parseColour(hexIn);
      if (!state || !base) return none;
      const baseHex = hexOf(base), baseHsl = toHsl(base);
      const strokes = new Set<string>(), shadows = new Set<string>(), ownersWithBase = new Set<string>(), linesByOwner = new Map<string, Set<string>>();
      // An outline of this colour: darker, and its hue (or grey / black), not a neighbour's outline drawn in the same shape.
      const outlineOf = (h: string) => {
        if (h === baseHex) return false;
        const c = toHsl(parseColour(h)!);
        if (c.l >= baseHsl.l) return false;
        if (c.s < 0.08 || baseHsl.s < 0.12) return true;
        const dh = Math.abs(c.h - baseHsl.h);
        return Math.min(dh, 360 - dh) <= 30;
      };
      state.renderer.eachShape(state.source.item, scope, (shape, _trail, owner) => {
        const fills = shape.fills.flatMap((f) => huesOf(f.style)), lines = shape.strokes.flatMap((s) => huesOf(s.style.fill));
        if (fills.includes(baseHex)) { ownersWithBase.add(owner); lines.forEach((h) => { if (outlineOf(h)) strokes.add(h); }); }
        const own = linesByOwner.get(owner) ?? linesByOwner.set(owner, new Set()).get(owner)!;
        lines.forEach((h) => own.add(h));
        for (const h of fills) {
          if (h === baseHex || shadows.has(h)) continue;
          const hsl = toHsl(parseColour(h)!);
          if (hsl.l < baseHsl.l - 0.01 && sameFamily(hsl, baseHsl)) shadows.add(h);
        }
      });
      // Outlines drawn as shapes of their own: those of the symbols that hold the colour.
      if (!strokes.size) for (const owner of ownersWithBase) for (const h of linesByOwner.get(owner) ?? []) if (outlineOf(h)) strokes.add(h);
      return { strokes: [...strokes], shadows: [...shadows] };
    },
  };
}
