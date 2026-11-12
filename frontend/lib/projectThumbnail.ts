import type { EditorData } from "@/types";
import { renderStage } from "@/lib/stageSnapshot";

// Project thumbnails: a small JPEG of the scene's first frame for the Open Project panel.
// The scene is drawn by renderStage (characters by their own players, so complete and sharp).

const MAX_WIDTH = 360;
const MAX_HEIGHT = 240;

export async function renderProjectThumbnail(
  data: EditorData,
  projectWidth: number,
  projectHeight: number,
  elementFor: (id: string) => HTMLElement | null,
): Promise<Blob | null> {
  const fit = Math.min(MAX_WIDTH / projectWidth, MAX_HEIGHT / projectHeight);
  const canvas = await renderStage(data, projectWidth, projectHeight, { width: projectWidth * fit, firstFrameOnly: true, elementFor });
  if (!canvas) return null;
  return new Promise((resolve) => {
    try { canvas.toBlob((blob) => resolve(blob), "image/jpeg", 0.82); } catch { resolve(null); }
  });
}
