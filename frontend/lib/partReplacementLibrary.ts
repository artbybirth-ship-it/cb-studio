export type ReplacementLibraryCategory = "head" | "hand" | "body";

export type ReplacementLibraryItem = {
  id: string;
  library: string;
  sourceZipName: string;
  label: string;
  partCategory: ReplacementLibraryCategory;
  assetUrl: string;
  thumbUrl: string;
  notes?: string;
  renderKind?: "image" | "source-symbol";
};

// v104 intentionally ships no character-specific replacement assets.
// Replacements come from runtime-discovered uploaded characters or user uploads.
export const PART_REPLACEMENT_LIBRARY: ReplacementLibraryItem[] = [];

export function resolveReplacementCategory(partKey: string | null | undefined): ReplacementLibraryCategory {
  const value = String(partKey || "").toLowerCase();
  if (/(head|face|eye|ear|nose|lip|mouth|pagdi|turban)/.test(value)) return "head";
  if (/(hand|arm|forearm|palm)/.test(value)) return "hand";
  return "body";
}
