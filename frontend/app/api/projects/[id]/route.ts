import { NextResponse } from "next/server";
import { getProject } from "@/lib/server/localStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const project = await getProject(id);
  if (!project) return NextResponse.json({ detail: "project not found" }, { status: 404 });
  return NextResponse.json(project);
}
