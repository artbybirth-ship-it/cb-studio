// Packs a folder picked with <input webkitdirectory> into an uncompressed ZIP so
// "Upload custom" can reuse the existing ZIP install path in both backends.

const MAX_FOLDER_BYTES = 500 * 1024 * 1024;
const MAX_FOLDER_FILES = 10000;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

const isNoise = (relativePath: string) =>
  relativePath.split("/").some((part) => part === "__MACOSX" || part === ".DS_Store" || part.startsWith("._"));

/** Returns a ZIP named after the picked folder, e.g. "Kallu.zip". */
export async function zipPickedFolder(files: File[]): Promise<File> {
  const entries = files
    .map((file) => ({ file, name: (file.webkitRelativePath || file.name).replace(/\\/g, "/") }))
    .filter((entry) => !isNoise(entry.name));
  if (!entries.length) throw new Error("The selected folder is empty");
  if (entries.length > MAX_FOLDER_FILES) throw new Error(`Folder contains too many files; max ${MAX_FOLDER_FILES}`);
  const totalBytes = entries.reduce((sum, entry) => sum + entry.file.size, 0);
  if (totalBytes > MAX_FOLDER_BYTES) throw new Error("Folder is too large; max 500 MB");
  if (!entries.some((entry) => /\.html?$/i.test(entry.name))) throw new Error("No HTML5 export (.html) found in the selected folder");

  const encoder = new TextEncoder();
  const parts: BlobPart[] = [];
  const central: Uint8Array<ArrayBuffer>[] = [];
  let offset = 0;
  for (const { file, name } of entries) {
    const nameBytes = new Uint8Array(encoder.encode(name));
    const crc = crc32(new Uint8Array(await file.arrayBuffer()));
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true); // UTF-8 names
    local.setUint16(8, 0, true); // stored, no compression
    local.setUint32(14, crc, true);
    local.setUint32(18, file.size, true);
    local.setUint32(22, file.size, true);
    local.setUint16(26, nameBytes.length, true);
    parts.push(local.buffer, nameBytes, file);

    const entry = new DataView(new ArrayBuffer(46));
    entry.setUint32(0, 0x02014b50, true);
    entry.setUint16(4, 20, true);
    entry.setUint16(6, 20, true);
    entry.setUint16(8, 0x0800, true);
    entry.setUint32(16, crc, true);
    entry.setUint32(20, file.size, true);
    entry.setUint32(24, file.size, true);
    entry.setUint16(28, nameBytes.length, true);
    entry.setUint32(42, offset, true);
    const record = new Uint8Array(46 + nameBytes.length);
    record.set(new Uint8Array(entry.buffer), 0);
    record.set(nameBytes, 46);
    central.push(record);
    offset += 30 + nameBytes.length + file.size;
  }
  const centralSize = central.reduce((sum, record) => sum + record.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);

  const folderName = entries[0].name.split("/")[0] || "custom-character";
  return new File([...parts, ...central, end.buffer], `${folderName}.zip`, { type: "application/zip" });
}
