import { promises as fs } from "fs";
import path from "path";
import { NextResponse } from "next/server";
import { localMediaRoot } from "@/lib/server/localStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
  ".ogg": "audio/ogg",
  ".flac": "audio/flac",
  ".apng": "image/apng",
  ".ai": "application/postscript",
  ".eps": "application/postscript",
};

export async function GET(_request: Request, context: { params: Promise<{ path: string[] }> }) {
  const params = await context.params;
  const parts = Array.isArray(params.path) ? params.path : [];
  if (!parts.length || parts.some((part) => !part || part === "." || part === ".." || part.includes("/") || part.includes("\\"))) {
    return NextResponse.json({ detail: "invalid media path" }, { status: 400 });
  }
  const root = path.resolve(localMediaRoot());
  const target = path.resolve(root, ...parts);
  if (!target.startsWith(`${root}${path.sep}`)) return NextResponse.json({ detail: "invalid media path" }, { status: 400 });
  try {
    const data = await fs.readFile(target);
    const contentType = MIME[path.extname(target).toLowerCase()] || "application/octet-stream";
    return new Response(new Uint8Array(data), {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "no-cache",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error: unknown) {
    const code = (error as NodeJS.ErrnoException)?.code;
    return NextResponse.json({ detail: code === "ENOENT" ? "media not found" : "could not read media" }, { status: code === "ENOENT" ? 404 : 500 });
  }
}
