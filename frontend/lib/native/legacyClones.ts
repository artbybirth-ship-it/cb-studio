/**
 * The layers the old editor made from a picture, a library symbol, or a part of another character
 * (Paste as layer, Add part): built natively here, so lib/native/legacy.ts can place them among the
 * pose's layers. Pictures are fetched and registered as library pictures; a part of another character
 * is copied in from that character's .fla exactly as a native paste does (lib/native/library.ts).
 * Async because it loads files; everything it makes is saved with the pose edits like any pasted part.
 */
import type { BitmapElement, FlaElement, InstanceElement, Layer, Matrix } from "../fla/xfl";
import type { NativeLoaded } from "./loadDoc";
import { loadNativeDoc } from "./loadDoc";
import { importElements, mul, poseScale, registerLibrary } from "./library";
import type { SymbolLayerEdit } from "./legacy";

const plain = (name: string) => (name.split("/").pop() || name).toLowerCase().replace(/[^a-z0-9]/g, "");
const findSymbol = (loaded: NativeLoaded, cls: string): string | null => {
  const found = [...loaded.doc.symbols.keys()].filter((name) => plain(name) === plain(cls));
  const top = found.filter((name) => !name.includes("/"));
  return found.length === 1 ? found[0] : top.length === 1 ? top[0] : null;
};
const bytesToBase64 = (bytes: Uint8Array) => { let out = ""; for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(out); };

/** The export's .js the old edit named, to the .fla that sits beside it. */
export const flaOfExport = (lib: string) => lib.replace(/\.js(\?.*)?$/i, ".fla");

/**
 * One layer per clone of the edit that is not a plain duplicate, in clone order (undefined where the clone is a duplicate,
 * or could not be built: then the old edit stays in charge). `poseItem` is the library name of the pose the clones sit in.
 */
export async function buildClones(target: NativeLoaded, edit: SymbolLayerEdit, poseItem: string, length: number): Promise<Array<Layer | undefined>> {
  const { doc } = target;
  const out: Array<Layer | undefined> = [];
  for (const clone of edit.clones || []) {
    try {
      const shown = Math.max(1, Math.min(length, clone.end ?? length));
      const layer = (name: string, elements: FlaElement[]): Layer => ({ name, type: "normal", parent: null, hidden: false, frames: [{ i: 0, d: shown, elements }] });
      const centre: Matrix = [1, 0, 0, 1, doc.width / 2, doc.height / 2];
      if (clone.image) {
        const image = clone.image as { url: string; w: number; h: number; name: string };
        const response = await fetch(image.url);
        if (!response.ok) { out.push(undefined); continue; }
        const bytes = new Uint8Array(await response.arrayBuffer());
        const picture = await createImageBitmap(new Blob([bytes as BlobPart]));
        const name = `Picture/${image.name || "Picture"}/${image.url.split("/").pop()}`;
        await registerLibrary(target, { symbols: {}, brushes: {}, bitmaps: { [name]: { name, width: picture.width, height: picture.height, data: bytesToBase64(bytes) } } });
        // As the old player built it: a container centred on its origin (which starts at the stage's centre), the picture inside.
        // A pasted part keeps its size on the stage (so it is divided by the pose's own scale); another picture is fitted to 40% of the stage.
        const ih = Math.max(1, image.h || 100), iw = Math.max(1, image.w || 100);
        const keep = (image as { keep?: boolean }).keep;
        const fit = keep ? 1 : Math.min(1, (doc.height * 0.4) / ih, (doc.width * 0.4) / iw);
        const own = keep ? poseScale(doc, poseItem) : 1;
        const pw = (iw * fit) / own, ph = (ih * fit) / own, k = pw / (picture.width || iw);
        const local: Matrix = [k, 0, 0, k, -pw / 2, -ph / 2];
        const el: BitmapElement = { k: "bitmap", item: name, name: clone.prop, m: mul([1, 0, 0, 1, doc.width / 2, doc.height / 2], local), local };
        out.push(layer(clone.name || image.name || "Picture", [el]));
      } else if (clone.symbol) {
        const foreign = clone.foreign as { lib: string; scale?: number; frame?: number; mode?: string; loop?: number | boolean } | undefined;
        const source = foreign ? await loadNativeDoc(flaOfExport(foreign.lib)) : target;
        const item = findSymbol(source, clone.symbol);
        if (!item) { out.push(undefined); continue; }
        const f = foreign ? (foreign.scale || 1) / poseScale(doc, poseItem) : 1;
        const el: InstanceElement = { k: "instance", item, symbolType: source.doc.symbols.get(item)!.type, m: [f, 0, 0, f, centre[4], centre[5]], pivot: [0, 0], loop: "loop", first: foreign?.frame ?? 0, name: clone.prop };
        const [placed] = await importElements(source, [el], target);
        out.push(layer(clone.name || clone.symbol.replace(/(?:copy\d*|_\d+)+$/i, "") || "Layer", [placed]));
      } else out.push(undefined);
    } catch {
      out.push(undefined);
    }
  }
  return out;
}
