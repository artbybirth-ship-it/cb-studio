/**
 * Pictures stored inside an .fla (bin/*.dat). JPEG, PNG and GIF data is kept as it is; Animate's
 * own lossless format (header 03 05: size, then zlib-compressed premultiplied ARGB in chunks) is
 * turned into a PNG. Returns null for formats it does not know (the picture is then left out).
 */
export type DecodedBitmap = { bytes: Uint8Array; extension: "png" | "jpg" | "gif"; width: number; height: number };

const starts = (data: Uint8Array, ...signature: number[]) => signature.every((byte, index) => data[index] === byte);

async function inflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function imageSize(bytes: Uint8Array, mime: string): Promise<[number, number]> {
  try {
    const bitmap = await createImageBitmap(new Blob([bytes as BlobPart], { type: mime }));
    const size: [number, number] = [bitmap.width, bitmap.height];
    bitmap.close();
    return size;
  } catch { return [0, 0]; }
}

export async function decodeBitmap(data: Uint8Array | undefined): Promise<DecodedBitmap | null> {
  if (!data || data.length < 8) return null;
  if (starts(data, 0xff, 0xd8)) { const [w, h] = await imageSize(data, "image/jpeg"); return { bytes: data, extension: "jpg", width: w, height: h }; }
  if (starts(data, 0x89, 0x50, 0x4e, 0x47)) { const [w, h] = await imageSize(data, "image/png"); return { bytes: data, extension: "png", width: w, height: h }; }
  if (starts(data, 0x47, 0x49, 0x46)) { const [w, h] = await imageSize(data, "image/gif"); return { bytes: data, extension: "gif", width: w, height: h }; }
  if (!starts(data, 0x03, 0x05)) return null;

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const width = view.getUint16(4, true);
  const height = view.getUint16(6, true);
  if (!width || !height) return null;
  // 2 + 2 (row bytes) + 2 + 2 + 16 (frame in twips) + 1 (has alpha) + 1 (compressed)
  const compressed = data[25] === 1;
  let pixels: Uint8Array;
  if (compressed) {
    const parts: Uint8Array[] = [];
    let at = 26;
    while (at + 2 <= data.length) {
      const size = view.getUint16(at, true);
      at += 2;
      if (!size) break;
      parts.push(data.subarray(at, at + size));
      at += size;
    }
    const joined = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
    let offset = 0;
    for (const part of parts) { joined.set(part, offset); offset += part.length; }
    pixels = await inflate(joined);
  } else pixels = data.subarray(26);
  if (pixels.length < width * height * 4) return null;

  // ARGB, alpha premultiplied → RGBA for the canvas.
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) return null;
  const image = context.createImageData(width, height);
  for (let i = 0; i < width * height; i += 1) {
    const a = pixels[i * 4];
    const scale = a ? 255 / a : 0;
    image.data[i * 4] = Math.min(255, Math.round(pixels[i * 4 + 1] * scale));
    image.data[i * 4 + 1] = Math.min(255, Math.round(pixels[i * 4 + 2] * scale));
    image.data[i * 4 + 2] = Math.min(255, Math.round(pixels[i * 4 + 3] * scale));
    image.data[i * 4 + 3] = a;
  }
  context.putImageData(image, 0, 0);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) return null;
  return { bytes: new Uint8Array(await blob.arrayBuffer()), extension: "png", width, height };
}
