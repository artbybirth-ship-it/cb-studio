import type { EditorData, EditorObject } from "@/types";
import { resolveCharacterTransformAtTime } from "@/lib/keyframes";
import { resolveSourceSeekMs } from "@/lib/partKeyframes";

// Project thumbnails: a small JPEG of the scene's first frame for the Open Project panel.
// Characters are drawn in full by their own players (cbSnapshot in cb-animate-bridge.js), so
// the picture is complete and sharp whatever the editor's zoom; other layers come from the DOM.

const MAX_WIDTH = 360;
const MAX_HEIGHT = 240;

type SnapshotWindow = Window & { cbSnapshot?: (width: number, height: number, seekMs?: number, loop?: boolean) => HTMLCanvasElement | null };

const loadImage = (src: string) => new Promise<HTMLImageElement | null>((resolve) => {
  const image = new Image();
  image.onload = () => resolve(image);
  image.onerror = () => resolve(null);
  image.src = src;
});

const drawCover = (context: CanvasRenderingContext2D, image: CanvasImageSource & { width: number; height: number }, width: number, height: number) => {
  const scale = Math.max(width / image.width, height / image.height);
  const drawWidth = image.width * scale;
  const drawHeight = image.height * scale;
  context.drawImage(image, (width - drawWidth) / 2, (height - drawHeight) / 2, drawWidth, drawHeight);
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

export async function renderProjectThumbnail(
  data: EditorData,
  projectWidth: number,
  projectHeight: number,
  elementFor: (id: string) => HTMLElement | null,
): Promise<Blob | null> {
  const fit = Math.min(MAX_WIDTH / projectWidth, MAX_HEIGHT / projectHeight);
  const width = Math.max(1, Math.round(projectWidth * fit));
  const height = Math.max(1, Math.round(projectHeight * fit));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) return null;
  const k = width / projectWidth;
  context.fillStyle = data.background || "#ffffff";
  context.fillRect(0, 0, width, height);
  if (data.backgroundImage) {
    const image = await loadImage(data.backgroundImage);
    if (image) drawCover(context, image, width, height);
  }

  for (const object of data.objects) {
    if (object.type === "audio" || object.type === "empty" || object.hidden) continue;
    if (Math.max(0, Number(object.startTime || 0)) > 1 / 60) continue; // not on the first frame
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
        const transform = resolveCharacterTransformAtTime(object, 0);
        const scale = transform.scale || 0.28;
        const drawWidth = (object.sourceWidth || 1920) * scale * (object.stretchX ?? 1) * k;
        const drawHeight = (object.sourceHeight || 1920) * scale * (object.stretchY ?? 1) * k;
        const ratio = Math.min(2, 800 / Math.max(drawWidth, drawHeight));
        const picture = snapshot(drawWidth * ratio, drawHeight * ratio, resolveSourceSeekMs(object, 0), object.loopMode === "loop");
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
        if (image) {
          context.drawImage(image, -localWidth / 2, -localHeight / 2, localWidth, localHeight);
        } else if (object.type === "text") {
          const style = getComputedStyle(element);
          context.font = style.font;
          context.fillStyle = style.color;
          context.textAlign = "center";
          context.textBaseline = "middle";
          // Keep light text readable on a light canvas, like its shadow does on the stage.
          if (style.textShadow && style.textShadow !== "none") { context.shadowColor = "rgba(0,0,0,.55)"; context.shadowBlur = 6; }
          context.fillText(object.text || object.name, 0, 0);
        } else {
          context.fillStyle = object.fillColor || "#17343a";
          context.fillRect(-localWidth / 2, -localHeight / 2, localWidth, localHeight);
        }
      });
    } catch {
      // One unreadable layer must not stop the thumbnail.
    }
  }
  return new Promise((resolve) => {
    try { canvas.toBlob((blob) => resolve(blob), "image/jpeg", 0.82); } catch { resolve(null); }
  });
}
