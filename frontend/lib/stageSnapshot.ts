import type { EditorData, EditorObject } from "@/types";
import { resolveCharacterTransformAtTime } from "@/lib/keyframes";
import { resolveSourceSeekMs } from "@/lib/partKeyframes";
import { textStrokeWidth } from "@/lib/textStyle";

/**
 * The scene drawn into a canvas at any size (project thumbnails; the canvas eyedropper's sharp
 * magnifier). Characters are drawn by their own players from their vectors (cbSnapshot in
 * cb-animate-bridge.js), so they stay sharp at any size; other layers are read from the stage DOM.
 */
type SnapshotWindow = Window & { cbSnapshot?: (width: number, height: number, seekMs?: number, loop?: boolean) => HTMLCanvasElement | null };

const loadImage = (src: string) => new Promise<HTMLImageElement | null>((resolve) => {
  const image = new Image();
  image.onload = () => resolve(image);
  image.onerror = () => resolve(null);
  image.src = src;
});

const drawCover = (context: CanvasRenderingContext2D, image: CanvasImageSource & { width: number; height: number }, width: number, height: number) => {
  const scale = Math.max(width / image.width, height / image.height);
  context.drawImage(image, (width - image.width * scale) / 2, (height - image.height * scale) / 2, image.width * scale, image.height * scale);
};

/** Same transform order as the stage CSS: translate · rotate · skew · flip. */
const placed = (context: CanvasRenderingContext2D, k: number, object: EditorObject, x: number, y: number, rotation: number, draw: () => void) => {
  context.save();
  context.globalAlpha = Math.max(0, Math.min(1, object.opacity ?? 1));
  context.translate(x * k, y * k);
  context.rotate((rotation * Math.PI) / 180);
  context.transform(1, Math.tan(((object.skewY || 0) * Math.PI) / 180), Math.tan(((object.skewX || 0) * Math.PI) / 180), 1, 0, 0);
  draw();
  context.restore();
};

/** Shown at `seconds` (the stage's time spans). */
const onStageAt = (object: EditorObject, seconds: number) => {
  const start = Math.max(0, Number(object.startTime || 0));
  const length = object.actionDurationMs ? Math.max(0.1, Number(object.actionDurationMs) / 1000) : null;
  return seconds + 0.0001 >= start && (length == null || seconds <= start + length + 0.0001);
};

/** Text as the stage draws it: lines, alignment, tracking, outline and shadow. */
const drawText = (context: CanvasRenderingContext2D, object: EditorObject, element: HTMLElement, width: number, height: number) => {
  const style = getComputedStyle(element);
  context.font = style.font;
  (context as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = style.letterSpacing === "normal" ? "0px" : style.letterSpacing;
  context.textBaseline = "middle";
  const lines = String(object.text ?? object.name ?? "").split("\n");
  const lineHeight = parseFloat(style.lineHeight) || Number(object.fontSize || 52) * 1.2;
  const align = object.textAlign || "center";
  context.textAlign = align;
  const x = align === "left" ? -width / 2 : align === "right" ? width / 2 : 0;
  const shadow = style.textShadow && style.textShadow !== "none" ? style.textShadow : "";
  if (shadow) { context.shadowColor = object.textShadowColor || "rgba(0,0,0,.85)"; context.shadowBlur = 8; context.shadowOffsetY = 2; }
  lines.forEach((line, index) => {
    const y = -height / 2 + lineHeight * (index + 0.5);
    if (object.textStrokeColor) {
      context.lineJoin = "round";
      context.lineWidth = 2 * textStrokeWidth(object);
      context.strokeStyle = object.textStrokeColor;
      context.strokeText(line, x, y);
      context.shadowColor = "transparent";
    }
    context.fillStyle = style.color;
    context.fillText(line, x, y);
  });
};

/**
 * The scene at `seconds`, `width` px wide. `characterCap` limits each character's own drawing (px),
 * `firstFrameOnly` keeps only what starts on the first frame (thumbnails).
 */
export async function renderStage(data: EditorData, projectWidth: number, projectHeight: number, options: {
  width: number; seconds?: number; characterCap?: number; firstFrameOnly?: boolean; elementFor: (id: string) => HTMLElement | null;
}): Promise<HTMLCanvasElement | null> {
  const { seconds = 0, characterCap = 800, firstFrameOnly = false, elementFor } = options;
  const width = Math.max(1, Math.round(options.width));
  const height = Math.max(1, Math.round(width * (projectHeight / projectWidth)));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return null;
  const k = width / projectWidth;
  context.fillStyle = data.background || "#ffffff";
  context.fillRect(0, 0, width, height);
  if (data.backgroundImage) {
    const image = await loadImage(data.backgroundImage);
    if (image) drawCover(context, image, width, height);
  }

  // Background pictures always sit behind every other layer (as on the stage and in exports).
  const ordered = [...data.objects.filter((object) => object.type === "background"), ...data.objects.filter((object) => object.type !== "background")];
  for (const object of ordered) {
    if (object.type === "audio" || object.type === "empty" || object.hidden) continue;
    if (firstFrameOnly ? Math.max(0, Number(object.startTime || 0)) > 1 / 60 : !onStageAt(object, seconds)) continue;
    try {
      if (object.type === "background") {
        if (object.assetKind !== "image" || !object.assetUrl) continue;
        const image = await loadImage(object.assetUrl);
        if (!image) continue;
        context.save();
        context.globalAlpha = object.opacity ?? 1;
        drawCover(context, image, width, height);
        context.restore();
        continue;
      }
      const element = elementFor(object.id);
      if (object.type === "character") {
        const frame = element?.querySelector<HTMLIFrameElement>("iframe[data-animate-player]");
        const snapshot = (frame?.contentWindow as SnapshotWindow | null)?.cbSnapshot;
        if (!snapshot) continue;
        const transform = resolveCharacterTransformAtTime(object, seconds);
        const scale = transform.scale || 0.28;
        const drawWidth = (object.sourceWidth || 1920) * scale * (object.stretchX ?? 1) * k;
        const drawHeight = (object.sourceHeight || 1920) * scale * (object.stretchY ?? 1) * k;
        const ratio = Math.min(2, characterCap / Math.max(drawWidth, drawHeight));
        const picture = snapshot(drawWidth * ratio, drawHeight * ratio, resolveSourceSeekMs(object, seconds), object.loopMode === "loop");
        if (!picture) continue;
        placed(context, k, object, transform.x, transform.y, transform.rotation || 0, () => {
          if (object.flipX) context.scale(-1, 1);
          if (frame?.style.filter) context.filter = frame.style.filter;
          context.drawImage(picture, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight);
        });
        continue;
      }
      if (!element) continue;
      const scale = object.scale || 1;
      const localWidth = element.offsetWidth;
      const localHeight = element.offsetHeight;
      const image = object.type === "prop" && object.assetKind === "image" && object.assetUrl ? await loadImage(object.assetUrl) : null;
      placed(context, k, object, object.x, object.y, object.rotation || 0, () => {
        context.scale(scale * (object.stretchX ?? 1) * k, scale * (object.stretchY ?? 1) * k);
        if (object.flipX) context.scale(-1, 1);
        if (image) context.drawImage(image, -localWidth / 2, -localHeight / 2, localWidth, localHeight);
        else if (object.type === "text") drawText(context, object, element, localWidth, localHeight);
        else { context.fillStyle = object.fillColor || "#17343a"; context.fillRect(-localWidth / 2, -localHeight / 2, localWidth, localHeight); }
      });
    } catch {
      // One unreadable layer must not stop the picture.
    }
  }
  return canvas;
}

// The editor registers how to draw its current scene (at `scale` × the project size, at the playhead),
// so a colour picker anywhere can sample it.
type StageRenderer = (scale: number) => Promise<HTMLCanvasElement | null>;
let stageRenderer: StageRenderer | null = null;
export const setStageRenderer = (renderer: StageRenderer | null) => { stageRenderer = renderer; };
export const getStageRenderer = () => stageRenderer;
