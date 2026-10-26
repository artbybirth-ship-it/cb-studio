import { NextResponse } from "next/server";
import { createProject, listProjects } from "@/lib/server/localStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(await listProjects());
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { title?: unknown; width?: unknown; height?: unknown };
    const title = String(body.title || "Untitled Project-01").trim().slice(0, 200) || "Untitled Project-01";
    const width = Math.max(64, Math.min(7680, Math.round(Number(body.width) || 1280)));
    const height = Math.max(64, Math.min(7680, Math.round(Number(body.height) || 720)));
    const project = await createProject(title, width, height);
    return NextResponse.json(project, { status: 201 });
  } catch (error) {
    return NextResponse.json({ detail: error instanceof Error ? error.message : "Could not create project" }, { status: 400 });
  }
}
