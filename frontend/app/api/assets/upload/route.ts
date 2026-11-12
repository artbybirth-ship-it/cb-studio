import { randomUUID } from "crypto";
import path from "path";
import { NextResponse } from "next/server";
import type { Asset } from "@/types";
import { addAsset, getProject, saveMediaFile } from "@/lib/server/localStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FONT_EXTENSIONS = new Set([".ttf", ".otf", ".woff", ".woff2"]);
const FONT_FIELDS = ["family", "style", "weight", "italic", "postscriptName", "fullName"] as const;

const safeExt = (name: string) => {
  const ext = path.extname(name).toLowerCase();
  return /^\.[a-z0-9]{1,9}$/.test(ext) ? ext : "";
};

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const file = form.get("file");
    const kind = String(form.get("kind") || "");
    const projectId = String(form.get("project") || "");
    if (!(file instanceof File)) return NextResponse.json({ detail: "file is required" }, { status: 400 });
    if (kind !== "background" && kind !== "audio" && kind !== "font") return NextResponse.json({ detail: "kind must be background, audio or font" }, { status: 400 });
    if (projectId && !(await getProject(projectId))) return NextResponse.json({ detail: "project not found" }, { status: 404 });

    const contentType = (file.type || "").toLowerCase();
    if (kind === "background" && contentType && !contentType.startsWith("image/")) {
      return NextResponse.json({ detail: "background upload must be an image" }, { status: 400 });
    }
    if (kind === "audio" && contentType && !contentType.startsWith("audio/")) {
      return NextResponse.json({ detail: "voice upload must be an audio file" }, { status: 400 });
    }
    // A font from the person's computer (Text panel), so exports and other computers draw the same text.
    if (kind === "font" && !FONT_EXTENSIONS.has(path.extname(file.name).toLowerCase())) {
      return NextResponse.json({ detail: "font upload must be a .ttf, .otf, .woff or .woff2 file" }, { status: 400 });
    }
    const maxSize = kind === "background" ? 50 * 1024 * 1024 : 30 * 1024 * 1024;
    if (file.size > maxSize) return NextResponse.json({ detail: `file is too large; max ${maxSize / (1024 * 1024)} MB` }, { status: 400 });

    const id = randomUUID();
    const relative = `assets/${kind}/${id.replace(/-/g, "")}${safeExt(file.name)}`;
    const url = await saveMediaFile(relative, new Uint8Array(await file.arrayBuffer()));
    const asset: Asset = {
      id,
      project: projectId || null,
      kind,
      name: path.basename(file.name).slice(0, 200),
      url,
      metadata: {
        mimeType: contentType, size: file.size, originalName: path.basename(file.name),
        ...(kind === "font" ? Object.fromEntries(FONT_FIELDS.map((key) => [key, String(form.get(key) || "").slice(0, 200)])) : {}),
      },
      created_at: new Date().toISOString(),
    };
    await addAsset(asset);
    return NextResponse.json(asset, { status: 201 });
  } catch (error) {
    return NextResponse.json({ detail: error instanceof Error ? error.message : "Upload failed" }, { status: 400 });
  }
}
