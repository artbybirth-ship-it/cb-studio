import { NextResponse } from "next/server";
import { createRenderJob } from "@/lib/server/localStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const job = await createRenderJob(id);
  if (!job) return NextResponse.json({ detail: "project not found" }, { status: 404 });
  return NextResponse.json(job, { status: 202 });
}
