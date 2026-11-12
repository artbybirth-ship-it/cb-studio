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

export type NativeCharacterSource = { assetUrl?: string; loopMode?: string; nativePose?: Record<string, NativeEdits> };

export type NativeCharacter = {
  /** Loads the Animate file and the edits; resolves true when the character can be drawn. */
  load(): Promise<boolean>;
  readonly ready: boolean;
  /** Draws source time `seekMs` onto `canvas`, at `resolution` times the 720 × 960 box. */
  draw(canvas: HTMLCanvasElement, seekMs: number, resolution?: number, fit?: Fit | null): void;
};

export function createNativeCharacter(object: NativeCharacterSource): NativeCharacter {
  let state: { source: PoseSource; renderer: NativeRenderer; loaded: NativeLoaded } | null = null;
  const edits = Object.values(object.nativePose || {});
  return {
    get ready() { return Boolean(state); },
    async load() {
      const source = object.assetUrl ? await resolvePoseSource(object.assetUrl) : null;
      if (!source) return false;
      const loaded = await loadNativeDoc(source.flaUrl);
      for (const edit of edits) await registerLibrary(loaded, edit.library);
      // This character's own renderer over the shared document: its edits are laid over the pose, other placed characters keep theirs.
      const renderer = new NativeRenderer(loaded.doc, loaded.renderer.assets);
      await renderer.loadBrushes();
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
    },
  };
}
