/**
 * ZIP for the browser .fla importer. Reading walks the local file headers instead of trusting the
 * central directory: Animate writes .fla files whose directory stricter readers refuse ("bad
 * magic number"). Writing deflates the entries marked compress (the generated .js shrinks several
 * times) and stores the rest (the .fla is compressed already).
 */

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Every file in the archive (folders left out); entries that cannot be read are skipped. */
export async function readZip(bytes: Uint8Array, wanted: (name: string) => boolean = () => true): Promise<Map<string, Uint8Array>> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const files = new Map<string, Uint8Array>();
  const decoder = new TextDecoder();
  let at = 0;
  while (at + 30 <= bytes.length) {
    if (view.getUint32(at, true) !== 0x04034b50) {
      // Not a local header here: look for the next one (data descriptors, padding).
      const next = bytes.indexOf(0x50, at + 1);
      if (next < 0) break;
      at = next;
      continue;
    }
    const flags = view.getUint16(at + 6, true);
    const method = view.getUint16(at + 8, true);
    let size = view.getUint32(at + 18, true);
    const nameLength = view.getUint16(at + 26, true);
    const extraLength = view.getUint16(at + 28, true);
    const name = decoder.decode(bytes.subarray(at + 30, at + 30 + nameLength));
    const start = at + 30 + nameLength + extraLength;
    // Sizes written after the data (flag 8): the data runs to the next header.
    if (flags & 8 && !size) {
      let end = start;
      for (;;) {
        end = bytes.indexOf(0x50, end + 1);
        if (end < 0 || end + 4 > bytes.length) { end = bytes.length; break; }
        const signature = view.getUint32(end, true);
        if (signature === 0x04034b50 || signature === 0x02014b50) break;
      }
      size = end - start;
    }
    const raw = bytes.subarray(start, start + size);
    if (!name.endsWith("/") && wanted(name)) {
      try {
        files.set(name, method === 8 ? await inflateRaw(raw) : method === 0 ? raw.slice() : new Uint8Array());
      } catch { /* one damaged entry must not stop the import */ }
    }
    at = Math.max(start + size, at + 4);
  }
  return files;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();
function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i += 1) crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

async function deflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new CompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** A ZIP of the given files, names in UTF-8. */
export async function writeZip(files: Array<{ name: string; data: Uint8Array | string; compress?: boolean }>): Promise<Uint8Array> {
  const encoder = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const file of files) {
    const name = encoder.encode(file.name);
    const raw = typeof file.data === "string" ? encoder.encode(file.data) : file.data;
    const crc = crc32(raw);
    const packed = file.compress ? await deflateRaw(raw) : raw;
    const method = file.compress && packed.length < raw.length ? 8 : 0;
    const data = method ? packed : raw;
    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0x0800, true); // UTF-8 names
    lv.setUint16(8, method, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, data.length, true);
    lv.setUint32(22, raw.length, true);
    lv.setUint16(26, name.length, true);
    local.set(name, 30);
    const central = new Uint8Array(46 + name.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, method, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, raw.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    central.set(name, 46);
    locals.push(local, data);
    centrals.push(central);
    offset += local.length + data.length;
  }
  const centralSize = centrals.reduce((sum, part) => sum + part.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);
  const out = new Uint8Array(offset + centralSize + 22);
  let at = 0;
  for (const part of [...locals, ...centrals, end]) { out.set(part, at); at += part.length; }
  return out;
}
