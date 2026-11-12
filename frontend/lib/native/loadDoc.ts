/**
 * Loads a character's .fla into the native model: reads the document, decodes its pictures and
 * art brushes, and returns a renderer. One load per URL (a .fla is several MB).
 */
import { readFla, type FlaDocument } from "../fla/xfl";
import { decodeBitmap } from "../fla/bitmaps";
import { NativeRenderer } from "./render";

export type NativeLoaded = { doc: FlaDocument; renderer: NativeRenderer };

const cache = new Map<string, Promise<NativeLoaded>>();

export async function loadNativeFromBlob(blob: Blob, name: string, onProgress?: (fraction: number) => void): Promise<NativeLoaded> {
  const doc = await readFla(blob, name, onProgress);
  const images = new Map<string, ImageBitmap>();
  for (const [bitmapName, item] of doc.bitmaps) {
    const decoded = await decodeBitmap(item.data);
    if (decoded) images.set(bitmapName, await createImageBitmap(new Blob([decoded.bytes as BlobPart])));
  }
  const renderer = new NativeRenderer(doc, { images: images as never });
  await renderer.loadBrushes();
  return { doc, renderer };
}

export function loadNativeDoc(url: string, onProgress?: (fraction: number) => void): Promise<NativeLoaded> {
  let found = cache.get(url);
  if (!found) {
    found = (async () => {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`The character's Animate file could not be loaded (${response.status}).`);
      const file = url.split("/").pop() || "character.fla";
      let name = file;
      try { name = decodeURIComponent(file); } catch { /* keep the raw name */ }
      return loadNativeFromBlob(await response.blob(), name, onProgress);
    })();
    found.catch(() => cache.delete(url)); // a failed load can be tried again
    cache.set(url, found);
  }
  return found;
}

/** Where a character package keeps its .fla: next to its export, in the folder the upload came in. */
export async function findFlaUrl(timelineBase: string, documentName: string, sourceFolder?: string): Promise<string | null> {
  const root = timelineBase.replace(/cb-fla-timeline\/.*$/, "");
  const file = `${documentName}.fla`;
  const candidates = [...(sourceFolder ? [`${root}${encodeURIComponent(sourceFolder)}/${encodeURIComponent(file)}`] : []), `${root}${encodeURIComponent(documentName)}/${encodeURIComponent(file)}`, `${root}${encodeURIComponent(file)}`];
  for (const url of candidates) {
    try { if ((await fetch(url, { method: "HEAD" })).ok) return url; } catch { /* try the next place */ }
  }
  return null;
}
