import { NextResponse } from "next/server";
import {
  clearAdminSession,
  createAdminSession,
  isAdminAuthenticated,
  verifyAdminCredentials,
} from "@/lib/server/adminAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ authenticated: await isAdminAuthenticated() });
}

export async function POST(request: Request) {
  let payload: { loginId?: string; password?: string } = {};
  try { payload = await request.json(); } catch {}
  if (!verifyAdminCredentials(String(payload.loginId || ""), String(payload.password || ""))) {
    return NextResponse.json({ detail: "Invalid admin ID or password" }, { status: 401 });
  }
  await createAdminSession();
  return NextResponse.json({ authenticated: true });
}

export async function DELETE() {
  await clearAdminSession();
  return new Response(null, { status: 204 });
}
