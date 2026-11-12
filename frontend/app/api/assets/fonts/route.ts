import { NextResponse } from "next/server";
import { readStore } from "@/lib/server/localStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FONT_FIELDS = ["family", "style", "weight", "italic", "postscriptName", "fullName"] as const;

/** Fonts uploaded from people's computers (newest first, one per PostScript name): the Text panel's
 *  "Installed font" list. Same answer as the Django /assets/fonts. */
export async function GET() {
  const store = await readStore();
  const seen = new Set<string>();
  const fonts = [];
  for (const asset of [...store.assets].filter((item) => item.kind === "font").reverse()) {
    const meta = asset.metadata || {};
    const key = String(meta.postscriptName || asset.url);
    if (seen.has(key)) continue;
    seen.add(key);
    fonts.push({ url: asset.url, ...Object.fromEntries(FONT_FIELDS.map((field) => [field, meta[field] ?? ""])) });
  }
  return NextResponse.json(fonts);
}
