import { execFile as execFileCallback } from "child_process";
import { createHash, randomUUID } from "crypto";
import { promises as fs } from "fs";
import path from "path";
import { promisify } from "util";
import { localDataRoot } from "@/lib/server/localStore";
import { extractZipSafely } from "@/lib/server/zipExtract";

/**
 * Desktop import of Adobe Animate source files (.fla). Animate itself does the conversion: a JSFL
 * script opens the file, converts an ActionScript 3 document to HTML5 Canvas when needed, and
 * publishes it. The published export is zipped and installed like any HTML5 upload. macOS only,
 * and Animate must be installed (the Docker/Django backend cannot run it).
 */

const execFile = promisify(execFileCallback);
const POLL_MS = 2000;
const NOT_STARTED_RESEND_MS = 60_000;   // ask Animate again if the script has not started yet
const NOT_STARTED_FAIL_MS = 4 * 60_000; // first launch of Animate can be slow
const STALL_FAIL_MS = 20 * 60_000;      // publishing large files takes minutes with no log output

export const isFlaFileName = (name: string) => /\.fla$/i.test(name);

/** Newest "Adobe Animate <year>" in /Applications, or null. */
async function findAnimateApp(): Promise<string | null> {
  if (process.platform !== "darwin") return null;
  const folders = (await fs.readdir("/Applications").catch(() => [] as string[]))
    .filter((name) => /^Adobe Animate/i.test(name))
    .sort()
    .reverse();
  for (const folder of folders) {
    const full = path.join("/Applications", folder);
    if (folder.endsWith(".app")) return full;
    const app = (await fs.readdir(full).catch(() => [] as string[])).find((name) => /^Adobe Animate.*\.app$/i.test(name));
    if (app) return path.join(full, app);
  }
  return null;
}

/** JSFL for Animate's ES3 engine (no toISOString, map, forEach…). Writes progress lines to the log. */
function conversionScript(flaPath: string, convertedPath: string, logPath: string): string {
  const q = (value: string) => JSON.stringify(value);
  return `(function () {
  var log = FLfile.platformPathToURI(${q(logPath)});
  if (FLfile.exists(log)) return; // a repeated launch request: this conversion already started
  var lines = [];
  function note(text) { lines.push(text); FLfile.write(log, lines.join("\\n") + "\\n"); }
  try {
    note("STARTED");
    var doc = fl.openDocument(FLfile.platformPathToURI(${q(flaPath)}));
    note("OPENED " + doc.type);
    var target = doc;
    if (doc.type !== "htmlcanvas") {
      doc.convertToDoc(FLfile.platformPathToURI(${q(convertedPath)}), "htmlcanvas", false);
      note("CONVERTED");
      target = null;
      for (var i = 0; i < fl.documents.length; i++) if (fl.documents[i].name === ${q(path.basename(convertedPath))}) target = fl.documents[i];
      if (!target) target = fl.openDocument(FLfile.platformPathToURI(${q(convertedPath)}));
    }
    note("PUBLISHING");
    target.publish();
    note("PUBLISHED");
    if (target !== doc) fl.closeDocument(target, false);
    fl.closeDocument(doc, false);
    note("DONE");
  } catch (e) {
    note("ERROR " + e);
  }
})();
`;
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** A ZIP that holds an Animate source file but no HTML export is treated as a .fla upload. */
async function flaFromZip(buffer: Uint8Array, work: string): Promise<string | null> {
  const zipPath = path.join(work, "upload.zip");
  const unpacked = path.join(work, "upload");
  await fs.writeFile(zipPath, buffer);
  await fs.mkdir(unpacked, { recursive: true });
  await extractZipSafely(zipPath, unpacked);
  const files: string[] = [];
  const walk = async (dir: string) => {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      if (entry.name === "__MACOSX" || entry.name.startsWith("._")) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else files.push(full);
    }
  };
  await walk(unpacked);
  if (files.some((file) => /\.html?$/i.test(file))) return null;
  return files.find((file) => isFlaFileName(file)) || null;
}

/** True when this upload must go through Animate: a .fla, or a ZIP with a .fla and no HTML export. */
export async function needsAnimateConversion(buffer: Uint8Array, originalName: string): Promise<boolean> {
  if (isFlaFileName(originalName)) return true;
  if (!/\.zip$/i.test(originalName)) return false;
  const work = path.join(localDataRoot(), "tmp", `fla-probe-${randomUUID()}`);
  await fs.mkdir(work, { recursive: true });
  try { return Boolean(await flaFromZip(buffer, work)); } catch { return false; }
  finally { await fs.rm(work, { recursive: true, force: true }).catch(() => undefined); }
}

/** Identity of an Animate upload: a hash of its .fla, so the same source is recognised before converting. */
export async function flaSourceFingerprint(buffer: Uint8Array, originalName: string): Promise<string> {
  let source: Uint8Array = buffer;
  if (!isFlaFileName(originalName)) {
    const work = path.join(localDataRoot(), "tmp", `fla-print-${randomUUID()}`);
    await fs.mkdir(work, { recursive: true });
    try {
      const inner = await flaFromZip(buffer, work);
      if (inner) source = await fs.readFile(inner);
    } finally { await fs.rm(work, { recursive: true, force: true }).catch(() => undefined); }
  }
  return `fla:${createHash("sha256").update(source).digest("hex")}`;
}

let queue: Promise<unknown> = Promise.resolve();

/**
 * Converts an uploaded .fla (or a ZIP holding one) with Adobe Animate and returns the published
 * HTML5 Canvas export as a ZIP named after the document. One conversion runs at a time.
 */
export function convertFlaUpload(buffer: Uint8Array, originalName: string): Promise<{ zip: Uint8Array; name: string }> {
  const run = queue.then(() => convert(buffer, originalName));
  queue = run.catch(() => undefined);
  return run;
}

async function convert(buffer: Uint8Array, originalName: string): Promise<{ zip: Uint8Array; name: string }> {
  const app = await findAnimateApp();
  if (!app) {
    throw new Error(process.platform === "darwin"
      ? "Adobe Animate isn't installed on this Mac. Install Animate, or publish the file as HTML5 Canvas in Animate and upload the export ZIP."
      : "Importing .fla files needs Adobe Animate on macOS. Publish the file as HTML5 Canvas in Animate and upload the export ZIP.");
  }
  const work = path.join(localDataRoot(), "tmp", `fla-${randomUUID()}`);
  await fs.mkdir(work, { recursive: true });
  try {
    let sourceName = originalName;
    let source: Uint8Array = buffer;
    if (!isFlaFileName(originalName)) {
      const inner = await flaFromZip(buffer, work);
      if (!inner) throw new Error("This ZIP has no Animate .fla file or HTML5 export in it");
      sourceName = path.basename(inner);
      source = await fs.readFile(inner);
    }
    const base = path.basename(sourceName, path.extname(sourceName)).replace(/[^\w .()-]+/g, "_").trim() || "Animate character";
    const outDir = path.join(work, "publish");
    await fs.mkdir(outDir, { recursive: true });
    const flaPath = path.join(outDir, `${base}.fla`);
    const convertedPath = path.join(outDir, `${base}_HTML5 Canvas.fla`);
    const logPath = path.join(work, "convert-log.txt");
    const scriptPath = path.join(work, "cb-convert.jsfl");
    await fs.writeFile(flaPath, source);
    await fs.writeFile(scriptPath, conversionScript(flaPath, convertedPath, logPath), "utf8");

    const launch = () => execFile("/usr/bin/open", ["-g", "-a", app, scriptPath]);
    await launch();
    const started = Date.now();
    let resent = false;
    let lastLog = "";
    let lastChange = Date.now();
    for (;;) {
      await delay(POLL_MS);
      const logText = await fs.readFile(logPath, "utf8").catch(() => "");
      if (logText !== lastLog) { lastLog = logText; lastChange = Date.now(); }
      const error = /^ERROR (.*)$/m.exec(logText);
      if (error) throw new Error(`Animate could not convert this file: ${error[1]}`);
      if (/^DONE$/m.test(logText)) break;
      if (!logText) {
        if (!resent && Date.now() - started > NOT_STARTED_RESEND_MS) { resent = true; await launch().catch(() => undefined); }
        if (Date.now() - started > NOT_STARTED_FAIL_MS) {
          throw new Error("Adobe Animate didn't start the conversion. If Animate is showing a dialog (sign-in, update, missing fonts or a script error), close it and try again.");
        }
      } else if (Date.now() - lastChange > STALL_FAIL_MS) {
        throw new Error("Adobe Animate stopped responding while converting. Check Animate for an open dialog, close it and try again.");
      }
    }

    // Zip the published export: HTML, scripts, images, sounds — not the source documents.
    const entries = (await fs.readdir(outDir)).filter((name) => !isFlaFileName(name) && !name.startsWith("."));
    if (!entries.some((name) => /\.html?$/i.test(name))) throw new Error("Animate finished but produced no HTML5 Canvas export");
    const zipPath = path.join(work, `${base}.zip`);
    await execFile("/usr/bin/zip", ["-r", "-q", zipPath, ...entries], { cwd: outDir, maxBuffer: 16 * 1024 * 1024 });
    return { zip: await fs.readFile(zipPath), name: `${base}.zip` };
  } finally {
    await fs.rm(work, { recursive: true, force: true }).catch(() => undefined);
  }
}
