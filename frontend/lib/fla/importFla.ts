/**
 * Browser .fla import: read the file, list its poses, draw their previews, and build the package
 * the library upload installs (an HTML5 Canvas export written by createjsWriter.ts, with the .fla
 * beside it for "step inside").
 */
import { readFla, type FlaDocument } from "./xfl";
import { stagePoses, writeCreateJs, type PoseChoice, type StagePose } from "./createjsWriter";
import { writeZip } from "./zip";

export type OpenedFla = { file: File; doc: FlaDocument; poses: StagePose[] };

export const isFlaFile = (file: File) => /\.fla$/i.test(file.name);

export async function openFla(file: File, onProgress?: (fraction: number) => void): Promise<OpenedFla> {
  const doc = await readFla(file, file.name, onProgress);
  const poses = stagePoses(doc);
  if (!poses.length) throw new Error("The stage of this file has no symbols on its first frame, so there is no pose to import.");
  return { file, doc, poses };
}

/** A name that is safe as a folder and file name (and becomes the character's name). */
export const safeFileName = (name: string) => name.replace(/[\\/:*?"<>|#%]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80) || "Character";

/** 32 hex digits from the file and the choices: importing the same thing twice gives the same
 *  package, which the library recognises as already there. (No crypto.subtle: LAN pages are http.) */
function stableId(bytes: Uint8Array, extra: string): string {
  const text = new TextEncoder().encode(extra);
  const hash = (seed: number) => {
    let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
    const feed = (b: number) => { h1 = Math.imul(h1 ^ b, 2654435761); h2 = Math.imul(h2 ^ b, 1597334677); };
    for (let i = 0; i < bytes.length; i += 1) feed(bytes[i]);
    for (let i = 0; i < text.length; i += 1) feed(text[i]);
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (h2 >>> 0).toString(16).padStart(8, "0") + (h1 >>> 0).toString(16).padStart(8, "0");
  };
  return (hash(1) + hash(2)).toUpperCase();
}

/** Frame 0 of every pose, fitted into width × height (data URLs by library item), and what the
 *  poses use that is not imported yet. */
export async function posePreviews(opened: OpenedFla, width = 150, height = 190): Promise<{ images: Record<string, string>; skipped: string[] }> {
  const id = `PREVIEW${Date.now().toString(16).toUpperCase()}`;
  const result = await writeCreateJs(opened.doc, "Preview", opened.poses.map((pose) => ({ item: pose.item, name: pose.name, include: true })), id);
  const jsUrl = URL.createObjectURL(new Blob([result.js], { type: "text/javascript" }));
  const iframe = document.createElement("iframe");
  iframe.setAttribute("aria-hidden", "true");
  iframe.style.cssText = "position:fixed;left:-10000px;top:0;width:10px;height:10px;border:0;visibility:hidden";
  try {
    const loaded = new Promise<void>((resolve, reject) => { iframe.onload = () => resolve(); iframe.onerror = () => reject(new Error("preview failed")); });
    iframe.srcdoc = `<!doctype html><html><head><script src="/vendor/createjs"></script><script src="${jsUrl}"></script></head><body></body></html>`;
    document.body.appendChild(iframe);
    await loaded;
    type PreviewWindow = Window & { AdobeAn?: { getComposition(id: string): { getLibrary(): Record<string, unknown>; getImages(): Record<string, unknown> } }; createjs?: { Stage: new (canvas: HTMLCanvasElement) => { addChild(child: unknown): void; update(): void } } };
    const win = iframe.contentWindow as PreviewWindow | null;
    const comp = win?.AdobeAn?.getComposition(id);
    if (!win || !comp || !win.createjs) return { images: {}, skipped: result.skipped };
    const lib = comp.getLibrary(), images = comp.getImages();
    await Promise.all(result.images.map((image) => new Promise<void>((resolve) => {
      const element = win.document.createElement("img");
      element.onload = element.onerror = () => resolve();
      element.src = URL.createObjectURL(new Blob([image.data as BlobPart]));
      images[image.path.replace(/^images\//, "").replace(/\.\w+$/, "")] = element;
    })));
    const out: Record<string, string> = {};
    for (const pose of opened.poses) {
      try {
        type Clip = { nominalBounds?: { x: number; y: number; width: number; height: number } | null; scaleX: number; scaleY: number; x: number; y: number; gotoAndStop(frame: number): void };
        const Pose = lib[result.poseClasses[pose.item]] as (new () => Clip) | undefined;
        if (!Pose) continue;
        const canvas = win.document.createElement("canvas");
        canvas.width = width * 2;
        canvas.height = height * 2;
        const stage = new win.createjs.Stage(canvas);
        const root = new Pose();
        const b = root.nominalBounds;
        if (b && b.width > 0 && b.height > 0) {
          const s = Math.min((canvas.width * 0.92) / b.width, (canvas.height * 0.92) / b.height);
          root.scaleX = root.scaleY = s;
          root.x = (canvas.width - b.width * s) / 2 - b.x * s;
          root.y = (canvas.height - b.height * s) / 2 - b.y * s;
        }
        stage.addChild(root);
        root.gotoAndStop(0);
        stage.update();
        out[pose.item] = canvas.toDataURL("image/png");
      } catch { /* one pose without a preview still imports */ }
    }
    return { images: out, skipped: result.skipped };
  } finally {
    iframe.remove();
    URL.revokeObjectURL(jsUrl);
  }
}

/** The ZIP to upload: <Name>/<Name>.html, .js, .fla and images/. With one pose the library does not
 *  split the export: the folder names the character and the files name the pose. */
export async function buildFlaPackage(opened: OpenedFla, characterName: string, choices: PoseChoice[]): Promise<{ zip: File; skipped: string[] }> {
  const name = safeFileName(characterName);
  const included = choices.filter((choice) => choice.include);
  const fileName = included.length === 1 ? safeFileName(included[0].name) : name;
  const fla = new Uint8Array(await opened.file.arrayBuffer());
  const id = stableId(fla, JSON.stringify([name, choices]));
  const result = await writeCreateJs(opened.doc, fileName, choices, id);
  const zip = await writeZip([
    { name: `${name}/${fileName}.html`, data: result.html, compress: true },
    { name: `${name}/${fileName}.js`, data: result.js, compress: true },
    { name: `${name}/${fileName}.fla`, data: fla },
    ...result.images.map((image) => ({ name: `${name}/${image.path}`, data: image.data })),
  ]);
  return { zip: new File([zip as BlobPart], `${name}.zip`, { type: "application/zip" }), skipped: result.skipped };
}
