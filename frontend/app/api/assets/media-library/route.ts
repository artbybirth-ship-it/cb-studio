import { NextResponse } from "next/server";
import { MEDIA_LIBRARY_TYPES, type MediaLibraryType } from "@/lib/mediaLibrary";
import { deleteLocalMediaLibrary, installLocalMediaLibrary, listMediaPackages } from "@/lib/server/localMediaLibrary";
import { isAdminAuthenticated } from "@/lib/server/adminAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const libraryType = (value: unknown): MediaLibraryType | null =>
  MEDIA_LIBRARY_TYPES.includes(value as MediaLibraryType) ? (value as MediaLibraryType) : null;

const badType = () => NextResponse.json({ detail: "type must be backgrounds, fx or sfx" }, { status: 400 });

export async function GET(request: Request) {
  const type = libraryType(new URL(request.url).searchParams.get("type"));
  if (!type) return badType();
  const stored = await listMediaPackages(type);
  return NextResponse.json({
    packages: stored.map(({ items: _items, packageId: _packageId, ...pkg }) => pkg),
    items: stored.flatMap((pkg) => pkg.items),
  });
}

export async function POST(request: Request) {
  if (!(await isAdminAuthenticated())) return NextResponse.json({ detail: "Admin login required" }, { status: 401 });
  try {
    const form = await request.formData();
    const type = libraryType(form.get("type"));
    if (!type) return badType();
    const file = form.get("file");
    if (!(file instanceof File)) return NextResponse.json({ detail: "file is required" }, { status: 400 });
    const { items, packageId: _packageId, ...pkg } = await installLocalMediaLibrary(type, new Uint8Array(await file.arrayBuffer()), file.name);
    return NextResponse.json({ package: pkg, items, skipped: pkg.skipped }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ detail: error instanceof Error ? error.message : "Library upload failed" }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  if (!(await isAdminAuthenticated())) return NextResponse.json({ detail: "Admin login required" }, { status: 401 });
  const url = new URL(request.url);
  const type = libraryType(url.searchParams.get("type"));
  if (!type) return badType();
  const packageId = url.searchParams.get("packageId") || "";
  if (!packageId) return NextResponse.json({ detail: "packageId is required" }, { status: 400 });
  if (!(await deleteLocalMediaLibrary(type, packageId))) return NextResponse.json({ detail: "Library package not found" }, { status: 404 });
  return new Response(null, { status: 204 });
}
