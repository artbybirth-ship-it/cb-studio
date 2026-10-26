import type { EditorObject } from "@/types";

/**
 * Display name of a character part key. Top-level keys use the player's labels ("Head"); pieces
 * inside a part are path keys ("head/hair", "head/lips/shape_3+shape_7") shown as
 * "Head › Hair" or "Head › Lips › 2 shapes".
 */
const pretty = (value: string) => value.replace(/(\d+)$/, " $1").replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (c) => c.toUpperCase());
const segmentLabel = (segment: string) =>
  segment.includes("+") ? `${segment.split("+").length} shapes`
    : /^(shape|instance)(_\d+)?(\.|$)|^#|\./.test(segment) ? "Shape"
      : pretty(segment);

export function partLabel(object: Pick<EditorObject, "sourceParts"> | null | undefined, key: string | null | undefined): string {
  if (!key) return "";
  const [top, ...rest] = key.split("/");
  const topLabel = object?.sourceParts?.find((part) => part.key === top)?.label || pretty(top);
  return [topLabel, ...rest.map(segmentLabel)].join(" › ");
}
