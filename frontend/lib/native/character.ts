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
import { NativeRenderer, isIdentity, type PartEdit } from "./render";
import { hexOf, parseColour, sameFamily, toHsl, type ColourRule } from "./colour";
import { resolvePoseSource, type PoseSource } from "./resolve";

export const BOX_W = 720, BOX_H = 960;
/** A part of the character's box, as 0..1 of it. */
/** The most pixels one character canvas may have (about 32 million: a 5K screen's worth with a margin). */
const MAX_CANVAS_PIXELS = 32_000_000;
export type NativeView = { x: number; y: number; width: number; height: number };
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

/** Where the unedited pose `item` of the .fla at `flaUrl` sits in its box, from its artwork (when neither the player nor a saved placement is there). */
export const artworkFit = (flaUrl: string, loaded: NativeLoaded, item: string): Fit => fitOf(`${flaUrl}|${item}`, loaded, item);

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

export type NativeCharacterSource = { assetUrl?: string; loopMode?: string; nativePose?: Record<string, NativeEdits>; colorReplacements?: ColourRule[]; onlyParts?: string[] };

/** The placed character's fields that decide whether the native drawing can stand in for its Animate player. */
export type CoverageSource = NativeCharacterSource & {
  symbolKeys?: unknown; symbolValues?: unknown; symbolEases?: unknown; symbolLayers?: unknown;
  partReplacements?: unknown; colorOverrides?: unknown; strokeScale?: number;
  partOverrides?: Record<string, PartEdit | undefined>; partKeyframes?: Record<string, unknown>;
};
const holdsSomething = (value: unknown): boolean => {
  if (!value || typeof value !== "object") return Boolean(value);
  return Object.values(value as Record<string, unknown>).some((v) => (v && typeof v === "object" ? Object.keys(v).length > 0 : v != null && v !== ""));
};
export const hasNativePose = (object: CoverageSource) => Boolean(object.nativePose && Object.keys(object.nativePose).length);
/**
 * Whether a character is drawn natively by default (Phase 6): always when it has native edits; otherwise only when nothing on it is
 * drawn by the Animate player alone — edits from the old pose timeline, image part replacements, region colours, stroke weight.
 * Whether its part edits name parts the drawing knows is checked once the file is loaded (NativeCharacter.covers); a character
 * whose Animate file (.fla) is not available keeps its player too (load() answers false).
 */
export function drawsNatively(object: CoverageSource): boolean {
  if (hasNativePose(object)) return true;
  // For side-by-side checks (tools/native-test): every character without native edits stays on its player.
  if ((globalThis as { __CBS_PLAYER_ONLY__?: boolean }).__CBS_PLAYER_ONLY__) return false;
  if (holdsSomething(object.symbolKeys) || holdsSomething(object.symbolValues) || holdsSomething(object.symbolEases) || holdsSomething(object.symbolLayers)) return false;
  if (holdsSomething(object.partReplacements) || holdsSomething(object.colorOverrides)) return false;
  if (object.strokeScale != null && Number(object.strokeScale) !== 1) return false;
  return true;
}
/** The part keys a character's part edits and part layers name (edits that change nothing are left out). */
export function partKeysUsed(object: CoverageSource): string[] {
  const keys = new Set<string>();
  for (const [key, edit] of Object.entries(object.partOverrides || {})) if (edit && (edit.visible === false || edit.swapSymbol || !isIdentity(edit))) keys.add(key);
  for (const [key, frames] of Object.entries(object.partKeyframes || {})) if (Array.isArray(frames) && frames.length) keys.add(key);
  for (const key of object.onlyParts || []) keys.add(String(key));
  return [...keys];
}

export type NativeCharacter = {
  /** Loads the Animate file and the edits; resolves true when the character can be drawn. */
  load(): Promise<boolean>;
  readonly ready: boolean;
  /** Colour rules to draw with (the character's Recolour rules); call draw again after changing them. */
  setColourRules(rules: ColourRule[] | undefined): void;
  /** The part tools' edits (move / rotate / scale / flip / skew / stretch / hide of a rig part), by part key, for the next draws. */
  setPartEdits(edits: Record<string, PartEdit> | undefined | null): void;
  /** Part layers (Distribute to Layers): only these rig parts are drawn; empty draws the whole character. */
  setOnlyParts(keys: string[] | undefined | null): void;
  /**
   * Whether this drawing shows the character as its player would: true with native edits (the drawing is then the only one that is
   * right); otherwise when drawsNatively(object) and every part its edits name is a part this pose has. False until loaded.
   */
  covers(object: CoverageSource): boolean;
  /** Draws source time `seekMs` onto `canvas`, at `resolution` times the 720 × 960 box. With `view` (0..1 of the box: x, y, width, height), only that part
   *  is drawn: the canvas covers just it, `resolution` pixels per box pixel, so a zoomed-in character stays sharp at a cost set by the screen, not the zoom. */
  draw(canvas: HTMLCanvasElement, seekMs: number, resolution?: number, fit?: Fit | null, view?: NativeView | null): void;
  /** What the Animate player's colour finder answers, for this drawing (the colour tools use these when the native drawing is what is on screen). (x, y) are 0..1 over the 720 × 960 box. */
  colourAt(x: number, y: number, scope: string): { picked: string; original: string; current: string } | null;
  palette(scope: string): ColourEntry[];
  relatives(hex: string, scope: string): { strokes: string[]; shadows: string[]; lights: string[] };
};
export type ColourEntry = { color: string; current: string; fills: number; strokes: number };

export function createNativeCharacter(object: NativeCharacterSource): NativeCharacter {
  let state: { source: PoseSource; renderer: NativeRenderer; loaded: NativeLoaded } | null = null;
  const edits = Object.values(object.nativePose || {});
  let rulesNow = object.colorReplacements;
  let partEditsNow: Record<string, PartEdit> | undefined | null;
  let onlyNow: string[] | undefined | null = object.onlyParts;
  /** Where the last draw put the pose: the frame and placement the colour finder looks at. */
  let last: { frame: number; fit: Fit } | null = null;
  return {
    get ready() { return Boolean(state); },
    setColourRules(rules) { rulesNow = rules; state?.renderer.setColourRules(rules); },
    setPartEdits(edits) { partEditsNow = edits; state?.renderer.setPartEdits(edits); },
    setOnlyParts(keys) { if (JSON.stringify(keys || []) === JSON.stringify(onlyNow || [])) return; onlyNow = keys; state?.renderer.setOnlyParts(keys); },
    covers(target) {
      if (!state) return false;
      if (hasNativePose(target)) return true;
      if (!drawsNatively(target)) return false;
      const known = state.renderer.partKeys(state.source.item);
      return partKeysUsed(target).every((key) => known.has(key));
    },
    async load() {
      const source = object.assetUrl ? await resolvePoseSource(object.assetUrl) : null;
      if (!source) return false;
      const loaded = await loadNativeDoc(source.flaUrl);
      for (const edit of edits) await registerLibrary(loaded, edit.library);
      // This character's own renderer over the shared document: its edits are laid over the pose, other placed characters keep theirs.
      const renderer = new NativeRenderer(loaded.doc, loaded.renderer.assets);
      await renderer.loadBrushes();
      // The pose by the class its player knows it by ("Sardar_01" for "Symbol 1"): part-scoped colour rules ("@Sardar_01/instance_7") name it so.
      renderer.classes.set(source.item, source.js);
      for (const [cls, edit] of Object.entries(object.nativePose || {})) {
        const keys = Object.keys(edit.symbols);
        const item = edit.pose ?? (keys.includes(source.item) ? source.item : keys[0]);
        if (item) renderer.classes.set(item, cls);
      }
      renderer.setColourRules(rulesNow);
      renderer.setPartEdits(partEditsNow);
      renderer.setOnlyParts(onlyNow);
      if (source.width && source.height) renderer.stage = { width: source.width, height: source.height };
      for (const edit of edits) for (const [name, timeline] of Object.entries(edit.symbols)) if (loaded.doc.symbols.has(name)) renderer.overrides.set(name, timeline);
      fitOf(`${source.flaUrl}|${source.item}`, loaded, source.item);
      state = { source, renderer, loaded };
      return true;
    },
    draw(canvas, seekMs, resolution = 1, fitOverride, view) {
      if (!state) return;
      const { source, renderer, loaded } = state;
      const timeline = renderer.timelineOf(source.item);
      if (!timeline) return;
      const frames = Math.max(1, timeline.length);
      const raw = Math.floor((seekMs / 1000) * source.fps + 1e-6);
      const frame = object.loopMode === "loop" ? raw % frames : Math.min(frames - 1, raw);
      // A view draws only that part of the box, at the asked resolution (any amount above 0.05, up to a pixel budget).
      const v = view && view.width > 0 && view.height > 0 ? view : null;
      const wanted = v ? Math.max(0.05, resolution) : Math.max(1, Math.min(4, resolution));
      const cells = Math.max(1, (v ? v.width * v.height : 1) * BOX_W * BOX_H);
      const scale = Math.min(wanted, Math.sqrt(MAX_CANVAS_PIXELS / cells));
      const cw = Math.max(1, Math.round((v ? v.width : 1) * BOX_W * scale)), ch = Math.max(1, Math.round((v ? v.height : 1) * BOX_H * scale));
      if (canvas.width !== cw || canvas.height !== ch) { canvas.width = cw; canvas.height = ch; }
      const offX = v ? v.x * BOX_W : 0, offY = v ? v.y * BOX_H : 0;
      const ctx = canvas.getContext("2d")!;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const fit = fitOverride || fitOf(`${source.flaUrl}|${source.item}`, loaded, source.item);
      ctx.setTransform(fit.s * scale, 0, 0, fit.s * scale, (fit.tx - offX) * scale, (fit.ty - offY) * scale);
      renderer.setPartBase(new DOMMatrix().translate(-offX * scale, -offY * scale).scale(scale));
      renderer.drawSymbol(ctx, source.item, frame);
      last = { frame, fit };
    },
    colourAt(x, y, scope) {
      if (!state || !last) return null;
      const { source, renderer } = state, { frame, fit } = last;
      return colourAtPoint(renderer, source.item, frame, fit, x * BOX_W, y * BOX_H, scope);
    },
    palette(scope) { return state ? paletteOf(state.renderer, state.source.item, scope) : []; },
    relatives(hexIn, scope) { return state ? relativesOf(state.renderer, state.source.item, hexIn, scope) : { strokes: [], shadows: [], lights: [] }; },
  };
}

// ---------- the colour tools' questions, for any drawing (the scene's character, or the level open in the native pose editor)
const huesOf = (style: import("../fla/xfl").Fill): string[] => (style.t === "solid" ? [style] : style.stops.map(([, color, alpha]) => ({ color, alpha }))).flatMap((c) => (c.alpha >= 0.05 ? [hexOf(parseColour(c.color) ?? { r: 0, g: 0, b: 0, a: 1 })] : []));

/** The colour drawn at (px, py) of a drawing of `item` at `frame` placed by `fit` (pixels of that drawing; or a whole matrix, for a turned or
 *  flipped placement): as shown, and as the file has it. */
export function colourAtPoint(renderer: NativeRenderer, item: string, frame: number, fit: Fit | readonly number[], px: number, py: number, scope: string): { picked: string; original: string; current: string } | null {
  const ctx = new OffscreenCanvas(1, 1).getContext("2d")!;
  const m = "s" in fit ? [fit.s, 0, 0, fit.s, fit.tx, fit.ty] : fit;
  // The placement, shifted so the asked-for point lands on the middle of the one pixel.
  ctx.setTransform(m[0], m[1], m[2], m[3], m[4] - px + 0.5, m[5] - py + 0.5);
  renderer.setPartBase(new DOMMatrix().translate(-px + 0.5, -py + 0.5));
  const hit = renderer.hitAt(ctx, item, frame, 0.5, 0.5, scope);
  if (!hit) return null;
  const shown = renderer.shownColour(hit.color, hit.stroke, hit.trail, hit.part);
  return { picked: shown, original: hexOf(parseColour(hit.color) ?? { r: 0, g: 0, b: 0, a: 1 }), current: shown };
}

/** The colours `item` is drawn with (most used first), each with what it shows as now. */
export function paletteOf(renderer: NativeRenderer, item: string, scope: string): ColourEntry[] {
  const found = new Map<string, ColourEntry>();
  renderer.eachShape(item, scope, (shape, trail, _owner, part) => {
    const note = (style: import("../fla/xfl").Fill, stroke: boolean) => {
      for (const hex of huesOf(style)) {
        const entry = found.get(hex) ?? found.set(hex, { color: hex, current: renderer.shownColour(hex, stroke, trail, part), fills: 0, strokes: 0 }).get(hex)!;
        if (stroke) entry.strokes += 1; else entry.fills += 1;
        const now = renderer.shownColour(hex, stroke, trail, part);
        if (now !== hex) entry.current = now;
      }
    };
    shape.fills.forEach((f) => note(f.style, false));
    shape.strokes.forEach((st) => note(st.style.fill, true));
  });
  return [...found.values()].sort((a, b) => b.fills + b.strokes - (a.fills + a.strokes)).slice(0, 80);
}

/** The outlines, shadows and light tones that go with a colour (Light/Dark's Include Stroke / Include Shadow). */
export function relativesOf(renderer: NativeRenderer, item: string, hexIn: string, scope: string): { strokes: string[]; shadows: string[]; lights: string[] } {
  const none = { strokes: [], shadows: [], lights: [] };
  const base = parseColour(hexIn);
  if (!base) return none;
  const baseHex = hexOf(base), baseHsl = toHsl(base);
  const strokes = new Set<string>(), shadows = new Set<string>(), lights = new Set<string>(), ownersWithBase = new Set<string>(), linesByOwner = new Map<string, Set<string>>();
  // An outline of this colour: darker, and its hue (or grey / black), not a neighbour's outline drawn in the same shape.
  const outlineOf = (h: string) => {
    if (h === baseHex) return false;
    const c = toHsl(parseColour(h)!);
    if (c.l >= baseHsl.l) return false;
    if (c.s < 0.08 || baseHsl.s < 0.12) return true;
    const dh = Math.abs(c.h - baseHsl.h);
    return Math.min(dh, 360 - dh) <= 30;
  };
  renderer.eachShape(item, scope, (shape, _trail, owner) => {
    const fills = shape.fills.flatMap((f) => huesOf(f.style)), lines = shape.strokes.flatMap((st) => huesOf(st.style.fill));
    if (fills.includes(baseHex)) { ownersWithBase.add(owner); lines.forEach((h) => { if (outlineOf(h)) strokes.add(h); }); }
    const own = linesByOwner.get(owner) ?? linesByOwner.set(owner, new Set()).get(owner)!;
    lines.forEach((h) => own.add(h));
    for (const h of fills) {
      if (h === baseHex || shadows.has(h) || lights.has(h)) continue;
      const hsl = toHsl(parseColour(h)!);
      if (hsl.l < baseHsl.l - 0.01 && sameFamily(hsl, baseHsl)) shadows.add(h);
      else if (hsl.l > baseHsl.l + 0.01 && sameFamily(hsl, baseHsl)) lights.add(h);
    }
  });
  // Outlines drawn as shapes of their own: those of the symbols that hold the colour.
  if (!strokes.size) for (const owner of ownersWithBase) for (const h of linesByOwner.get(owner) ?? []) if (outlineOf(h)) strokes.add(h);
  return { strokes: [...strokes], shadows: [...shadows], lights: [...lights] };
}
