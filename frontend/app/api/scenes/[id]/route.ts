import { NextResponse } from "next/server";
import { deleteScene, updateScene } from "@/lib/server/localStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  try {
    const body = await request.json();
    const scene = await updateScene(id, body || {});
    if (!scene) return NextResponse.json({ detail: "scene not found" }, { status: 404 });
    return NextResponse.json(scene);
  } catch (error) {
    return NextResponse.json({ detail: error instanceof Error ? error.message : "Could not save scene" }, { status: 400 });
  }
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const result = await deleteScene(id);
  if (result === "not-found") return NextResponse.json({ detail: "scene not found" }, { status: 404 });
  if (result === "last-scene") return NextResponse.json({ detail: "A project needs at least one scene." }, { status: 400 });
  return new NextResponse(null, { status: 204 });
}
