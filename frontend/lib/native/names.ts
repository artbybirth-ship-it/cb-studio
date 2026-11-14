/**
 * The names the Animate player gives instances that have no name of their own: "instance",
 * "instance_1", "instance_2"… in the order the published code builds them (layer by layer from the
 * top, each new instance on a layer next; the instances of a motion tween share one name). Colour
 * rules made in the pose view are saved against these names ("@Sardar_01/instance_9"), so the native
 * drawing has to know them. They are worked out from the file's own timeline, so editing a layer
 * afterwards (adding, deleting, reordering layers) never renames what was already there.
 */
import type { Layer, Timeline } from "../fla/xfl";

type Row = { i: number; names: string[] };
export type AutoNames = Map<string, Row[]>;

const nameOf = (count: number) => (count === 0 ? "instance" : `instance_${count}`);
/** Layers are found by name and, for repeated names, by which one of them it is. */
export const layerKey = (layers: Layer[], index: number) => {
  let nth = 0;
  for (let i = 0; i < index; i += 1) if (layers[i].name === layers[index].name) nth += 1;
  return `${layers[index].name}\u0000${nth}`;
};

export function autoNames(timeline: Timeline): AutoNames {
  const out: AutoNames = new Map();
  let count = 0;
  timeline.layers.forEach((layer, index) => {
    if (layer.type === "folder") return;
    const rows: Row[] = [];
    let prev: Row | undefined, prevKey: Layer["frames"][number] | undefined;
    for (const k of layer.frames) {
      // The same symbol carrying on from the keyframe before (no gap) is the same instance.
      const continues = !!prevKey && prevKey.i + prevKey.d === k.i;
      const names = k.elements.map((el, e) => {
        if (el.k !== "instance") return "";
        const before = continues ? prevKey!.elements[e] : undefined;
        return before?.k === "instance" && before.item === el.item && prev?.names[e] ? prev.names[e] : nameOf(count++);
      });
      const row = { i: k.i, names };
      rows.push(row);
      prev = row; prevKey = k;
    }
    out.set(layerKey(timeline.layers, index), rows);
  });
  return out;
}

/** The player's name for element `e` of the keyframe showing at `i` on a layer: the last original keyframe at or before it (an F6 copy is the same instance). */
export function autoNameAt(names: AutoNames | undefined, key: string, i: number, e: number): string {
  const rows = names?.get(key);
  if (!rows) return "";
  let row: Row | undefined;
  for (const r of rows) if (r.i <= i) row = r; else break;
  return row?.names[e] ?? "";
}
