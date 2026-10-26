import { NextResponse } from "next/server";
import { getProject, saveMediaFile, setProjectThumbnail } from "@/lib/server/localStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 2 * 1024 * 1024;
const TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

/** Small snapshot of the project's first frame for the editor's Open Project panel. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!(await getProject(id))) return NextResponse.json({ detail: "project not found" }, { status: 404 });
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return NextResponse.json({ detail: "file is required" }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ detail: "thumbnail is too large" }, { status: 400 });
  if (!TYPES.has(file.type.toLowerCase())) return NextResponse.json({ detail: "thumbnail must be a JPEG, PNG or WebP image" }, { status: 400 });
  const url = await saveMediaFile(`project_thumbnails/${id.replace(/[^a-zA-Z0-9-]/g, "")}.jpg`, new Uint8Array(await file.arrayBuffer()));
  const project = await setProjectThumbnail(id, `${url}?v=${Date.now()}`);
  return NextResponse.json(project);
}
