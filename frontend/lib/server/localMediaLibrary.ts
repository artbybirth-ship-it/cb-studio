import { randomUUID } from "crypto";
import { promises as fs } from "fs";
import path from "path";
import {
  MEDIA_DISPLAY_EXTENSIONS,
  MEDIA_LIBRARY_COPY,
  MEDIA_MIME_TYPES,
  MEDIA_PREVIEW_EXTENSIONS,
  MEDIA_VECTOR_EXTENSIONS,
  type MediaLibraryItem,
  type MediaLibraryType,
} from "@/lib/mediaLibrary";
import { listMediaPackages, localDataRoot, localMediaRoot, registerMediaPackage, removeMediaPackage, type LocalMediaPackage } from "@/lib/server/localStore";
import { extractZipSafely, MAX_LIBRARY_BYTES } from "@/lib/server/zipExtract";

// Mirrors backend/projects/media_library.py so Docker and the desktop app index ZIPs identically.

function cleanLabel(value: string): string {
  return value.replace(/[_-]+/g, " ").replace(/^[\s\-_]+|[\s\-_]+$/g, "").replace(/\s+/g, " ") || "Item";
}

const isNoise = (name: string) => name === "__MACOSX" || name === ".DS_Store" || name.startsWith("._");

async function walk(root: string): Promise<string[]> {
  const output: string[] = [];
  const visit = async (dir: string) => {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      if (isNoise(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await visit(full);
      else if (entry.isFile()) output.push(full);
    }
  };
  await visit(root);
  return output.sort();
}

const toPosix = (value: string) => value.split(path.sep).join("/");

type ManifestEntry = { file: string; name?: string; category?: string };

async function loadManifest(root: string, files: string[]): Promise<Map<string, ManifestEntry>> {
  const result = new Map<string, ManifestEntry>();
  const manifestPath = files.find((file) => path.basename(file) === "cb-library.json");
  if (!manifestPath) return result;
  try {
    const data = JSON.parse(await fs.readFile(manifestPath, "utf8"));
    const entries = Array.isArray(data?.items) ? data.items : [];
    for (const entry of entries) {
      if (!entry || typeof entry.file !== "string") continue;
      const target = path.resolve(path.dirname(manifestPath), entry.file);
      if (!target.startsWith(`${path.resolve(root)}${path.sep}`)) continue;
      result.set(toPosix(path.relative(root, target)).toLowerCase(), entry);
    }
  } catch {
    // An unreadable manifest is ignored; folder/file names are used instead.
  }
  return result;
}

async function categoryFor(file: string, root: string): Promise<string> {
  let parts = toPosix(path.relative(root, file)).split("/").slice(0, -1);
  // A single wrapping folder (e.g. "MyPack/...") is not a category.
  const top = (await fs.readdir(root)).filter((name) => !name.startsWith(".") && !isNoise(name));
  if (parts.length && top.length === 1) parts = parts.slice(1);
  return parts.length ? cleanLabel(parts.join(" / ")) : "General";
}

async function exists(file: string) {
  try { await fs.access(file); return true; } catch { return false; }
}

async function findPreview(source: string): Promise<string | null> {
  const base = source.slice(0, -path.extname(source).length);
  for (const ext of MEDIA_PREVIEW_EXTENSIONS) {
    for (const variant of [ext, ext.toUpperCase()]) {
      if (await exists(base + variant)) return base + variant;
    }
  }
  return null;
}

export async function discoverMediaItems(type: MediaLibraryType, packageId: string, root: string): Promise<{ items: MediaLibraryItem[]; skipped: string[] }> {
  const displayExts = new Set(MEDIA_DISPLAY_EXTENSIONS[type]);
  const vectorExts = new Set(MEDIA_VECTOR_EXTENSIONS[type]);
  const files = await walk(root);
  const manifest = await loadManifest(root, files);
  const items: MediaLibraryItem[] = [];
  const skipped: string[] = [];
  const usedAsPreview = new Set<string>();
  const url = (file: string) => `/media/media_libraries/${type}/${packageId}/${toPosix(path.relative(root, file)).split("/").map(encodeURIComponent).join("/")}`;

  const makeItem = async (display: string, source: string | null): Promise<MediaLibraryItem> => {
    const primary = source || display;
    const rel = toPosix(path.relative(root, primary));
    const entry = manifest.get(rel.toLowerCase()) || manifest.get(toPosix(path.relative(root, display)).toLowerCase());
    const displayUrl = url(display);
    const item: MediaLibraryItem = {
      id: `${packageId}:${rel}`,
      packageId,
      type,
      name: String(entry?.name || cleanLabel(path.basename(primary, path.extname(primary)))).slice(0, 160),
      category: String(entry?.category || await categoryFor(primary, root)).slice(0, 160),
      url: displayUrl,
      previewUrl: type === "sfx" ? "" : displayUrl,
      format: path.extname(primary).toLowerCase().slice(1),
      mimeType: MEDIA_MIME_TYPES[path.extname(display).toLowerCase()] || "application/octet-stream",
      size: (await fs.stat(primary)).size,
    };
    if (source) item.sourceUrl = url(source);
    return item;
  };

  // Vector sources first so their previews are not also listed as separate items.
  for (const file of files) {
    if (!vectorExts.has(path.extname(file).toLowerCase())) continue;
    const rel = toPosix(path.relative(root, file));
    const preview = await findPreview(file);
    if (!preview) {
      skipped.push(`${rel} (needs a preview image with the same name, e.g. ${path.basename(file, path.extname(file))}.png)`);
      continue;
    }
    usedAsPreview.add(preview);
    items.push(await makeItem(preview, file));
  }

  for (const file of files) {
    const ext = path.extname(file).toLowerCase();
    if (path.basename(file) === "cb-library.json" || usedAsPreview.has(file) || vectorExts.has(ext)) continue;
    if (!displayExts.has(ext)) {
      skipped.push(`${toPosix(path.relative(root, file))} (unsupported file type)`);
      continue;
    }
    items.push(await makeItem(file, null));
  }
  return { items, skipped };
}

export async function installLocalMediaLibrary(type: MediaLibraryType, buffer: Uint8Array, originalName: string): Promise<LocalMediaPackage> {
  if (!originalName.toLowerCase().endsWith(".zip")) throw new Error("Library must be uploaded as a ZIP file");
  if (buffer.byteLength > MAX_LIBRARY_BYTES) throw new Error("Library ZIP is too large; max 500 MB");

  const packageId = randomUUID().replace(/-/g, "");
  const packageRoot = path.join(localMediaRoot(), "media_libraries", type, packageId);
  const tempRoot = path.join(localDataRoot(), "tmp");
  const tempZip = path.join(tempRoot, `${packageId}.zip`);
  await fs.mkdir(tempRoot, { recursive: true });
  await fs.mkdir(packageRoot, { recursive: true });
  await fs.writeFile(tempZip, buffer);
  let registered = false;
  try {
    await extractZipSafely(tempZip, packageRoot);
    const { items, skipped } = await discoverMediaItems(type, packageId, packageRoot);
    if (!items.length) throw new Error(`No supported ${MEDIA_LIBRARY_COPY[type].label} files found in this ZIP`);
    const pkg: LocalMediaPackage = {
      id: packageId,
      packageId,
      type,
      name: cleanLabel(path.basename(originalName, path.extname(originalName))).slice(0, 200),
      url: `/media/media_libraries/${type}/${packageId}/`,
      created_at: new Date().toISOString(),
      itemCount: items.length,
      skipped,
      items,
    };
    await registerMediaPackage(pkg);
    registered = true;
    return pkg;
  } finally {
    await fs.rm(tempZip, { force: true }).catch(() => undefined);
    if (!registered) await fs.rm(packageRoot, { recursive: true, force: true }).catch(() => undefined);
  }
}

export async function deleteLocalMediaLibrary(type: MediaLibraryType, packageId: string): Promise<boolean> {
  const removed = await removeMediaPackage(type, packageId);
  if (!removed || !/^[a-f0-9]{32}$/.test(removed.packageId)) return Boolean(removed);
  await fs.rm(path.join(localMediaRoot(), "media_libraries", type, removed.packageId), { recursive: true, force: true }).catch(() => undefined);
  return true;
}

export { listMediaPackages };
