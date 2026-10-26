import { execFile as execFileCallback } from "child_process";
import { promises as fs } from "fs";
import path from "path";
import { promisify } from "util";

const execFile = promisify(execFileCallback);

export const MAX_LIBRARY_BYTES = 500 * 1024 * 1024;
const MAX_EXTRACTED_BYTES = 1024 * 1024 * 1024;
const MAX_LIBRARY_FILES = 10000;

export function safeRelative(raw: string): string | null {
  const normalized = raw.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!normalized || normalized.includes("\0")) return null;
  const parts = normalized.split("/").filter(Boolean);
  if (!parts.length || parts.some((part) => part === "..")) return null;
  return parts.join(path.sep);
}

/** Extract an uploaded library ZIP into `destination`, rejecting unsafe paths, zip bombs and symlinks. */
export async function extractZipSafely(zipPath: string, destination: string): Promise<void> {
  const unzipBinary = process.platform === "darwin" ? "/usr/bin/unzip" : "unzip";
  try {
    const { stdout: listing } = await execFile(unzipBinary, ["-Z1", zipPath], { maxBuffer: 16 * 1024 * 1024 });
    const entryNames = String(listing || "").split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
    const fileNames = entryNames.filter((name) => !name.endsWith("/"));
    if (fileNames.length > MAX_LIBRARY_FILES) throw new Error(`Library contains too many files; max ${MAX_LIBRARY_FILES}`);
    for (const name of entryNames) {
      if (!safeRelative(name)) throw new Error("Library ZIP contains an unsafe path");
    }

    // Inspect uncompressed sizes before extraction to reject accidental zip bombs.
    const { stdout: longListing } = await execFile(unzipBinary, ["-l", zipPath], { maxBuffer: 32 * 1024 * 1024 });
    let expandedBytes = 0;
    for (const line of String(longListing || "").split(/\r?\n/)) {
      const match = line.match(/^\s*(\d+)\s+\d{2,4}[-/]\d{2}[-/]\d{2,4}\s+\d{2}:\d{2}\s+/);
      if (match) expandedBytes += Number(match[1]) || 0;
    }
    if (expandedBytes > MAX_EXTRACTED_BYTES) throw new Error("Expanded library is too large");

    await execFile(unzipBinary, ["-qq", "-o", zipPath, "-d", destination], { maxBuffer: 4 * 1024 * 1024 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/ENOENT/.test(message) && /unzip/i.test(message)) {
      throw new Error("The local unzip utility is unavailable. On macOS it should exist at /usr/bin/unzip.");
    }
    if (/End-of-central-directory|cannot find zipfile directory/i.test(message)) throw new Error("Invalid ZIP file");
    throw error;
  }

  // Never accept symlinks from an uploaded library.
  const verify = async (dir: string): Promise<void> => {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      const stat = await fs.lstat(full);
      if (stat.isSymbolicLink()) throw new Error("Library ZIP may not contain symbolic links");
      if (stat.isDirectory()) await verify(full);
    }
  };
  await verify(destination);
}
