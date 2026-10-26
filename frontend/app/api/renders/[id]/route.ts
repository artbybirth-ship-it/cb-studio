import { NextResponse } from "next/server";
import { getRenderJob } from "@/lib/server/localStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const job = await getRenderJob(id);
  if (!job) return NextResponse.json({ detail: "render job not found" }, { status: 404 });
  return NextResponse.json(job);
}
