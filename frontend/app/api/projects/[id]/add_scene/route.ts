import { NextResponse } from "next/server";
import { addScene } from "@/lib/server/localStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const scene = await addScene(id);
  if (!scene) return NextResponse.json({ detail: "project not found" }, { status: 404 });
  return NextResponse.json(scene, { status: 201 });
}
