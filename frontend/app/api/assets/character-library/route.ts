import { NextResponse } from "next/server";
import { CHARACTER_BRIDGE_VERSION, characterPackageFingerprint, deleteLocalCharacterLibrary, duplicateLocalCharacterLibrary, installLocalCharacterLibrary, upgradeCharacterPackageBridges, withCharacterCategory, withUniqueActionIds } from "@/lib/server/localCharacterLibrary";
import { listCharacterPackages, localMediaRoot, updateCharacterPackage } from "@/lib/server/localStore";
import path from "path";
import { isAdminAuthenticated } from "@/lib/server/adminAuth";
import { convertFlaUpload, flaSourceFingerprint, needsAnimateConversion } from "@/lib/server/flaImport";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  let stored = await listCharacterPackages();
  // One-time maintenance of older installs: move players to the shared bridge, and
  // fingerprint custom uploads so uploading the same export again is recognised.
  const outdated = stored.filter((pkg) => (pkg.bridgeVersion || 0) < CHARACTER_BRIDGE_VERSION || (pkg.scope === "custom" && !pkg.fingerprint));
  if (outdated.length) {
    for (const pkg of outdated) {
      const patch: { bridgeVersion: number; fingerprint?: string } = { bridgeVersion: CHARACTER_BRIDGE_VERSION };
      if ((pkg.bridgeVersion || 0) < CHARACTER_BRIDGE_VERSION) await upgradeCharacterPackageBridges(pkg.id);
      if (pkg.scope === "custom" && !pkg.fingerprint) {
        patch.fingerprint = await characterPackageFingerprint(path.join(localMediaRoot(), "character_libraries", pkg.id)).catch(() => undefined);
      }
      await updateCharacterPackage(pkg.id, patch);
    }
    stored = await listCharacterPackages();
  }
  return NextResponse.json({
    packages: stored.map(({ characters: _characters, ...pkg }) => pkg),
    characters: stored.flatMap((pkg) => pkg.characters.map((character) => ({
      ...withCharacterCategory(withUniqueActionIds(character), pkg.name),
      libraryPackageId: pkg.id,
      ...(pkg.colorReplacements?.length ? { colorReplacements: pkg.colorReplacements } : {}),
    }))),
  });
}

export async function POST(request: Request) {
  // My characters: duplicate a package under a new name (JSON body), see duplicateLocalCharacterLibrary.
  if ((request.headers.get("content-type") || "").includes("application/json")) {
    try {
      const body = await request.json() as { duplicateOf?: string; name?: string; characterId?: string };
      if (new URL(request.url).searchParams.get("scope") !== "custom") return NextResponse.json({ detail: "Only My characters can be duplicated" }, { status: 403 });
      const { characters, ...packageSummary } = await duplicateLocalCharacterLibrary(String(body.duplicateOf || ""), String(body.name || ""), body.characterId ? String(body.characterId) : undefined);
      return NextResponse.json({ package: packageSummary, characters }, { status: 201 });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not duplicate the character";
      return NextResponse.json({ detail: message }, { status: /not found/i.test(message) ? 404 : 400 });
    }
  }
  try {
    const form = await request.formData();
    // Editor "Upload custom" needs no admin login; everything else is the admin library.
    const custom = form.get("scope") === "custom";
    if (!custom && !(await isAdminAuthenticated())) {
      return NextResponse.json({ detail: "Admin login required" }, { status: 401 });
    }
    const file = form.get("file");
    if (!(file instanceof File)) return NextResponse.json({ detail: "file is required" }, { status: 400 });
    let buffer = new Uint8Array(await file.arrayBuffer());
    let name = file.name;
    let fingerprint: string | undefined;
    // An Animate source file (.fla, or a ZIP holding one) is converted with Adobe Animate first.
    // It is identified by its .fla, so uploading the same file again is recognised before converting.
    if (await needsAnimateConversion(buffer, name)) {
      fingerprint = await flaSourceFingerprint(buffer, name);
      const existing = custom ? (await listCharacterPackages()).find((pkg) => pkg.scope === "custom" && pkg.fingerprint === fingerprint) : undefined;
      if (existing) {
        const { characters, ...packageSummary } = existing;
        return NextResponse.json({ package: packageSummary, characters, duplicate: true }, { status: 200 });
      }
      const converted = await convertFlaUpload(buffer, name);
      buffer = new Uint8Array(converted.zip);
      name = converted.name;
    }
    const { duplicate, ...pkg } = await installLocalCharacterLibrary(buffer, name, { custom, fingerprint });
    const { characters, ...packageSummary } = pkg;
    // 200 + duplicate:true when this exact export was already uploaded; nothing new is stored.
    return NextResponse.json({ package: packageSummary, characters, duplicate: Boolean(duplicate) }, { status: duplicate ? 200 : 201 });
  } catch (error) {
    return NextResponse.json({ detail: error instanceof Error ? error.message : "Character library upload failed" }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  const url = new URL(request.url);
  const custom = url.searchParams.get("scope") === "custom";
  if (!custom && !(await isAdminAuthenticated())) {
    return NextResponse.json({ detail: "Admin login required" }, { status: 401 });
  }
  const packageId = url.searchParams.get("packageId") || "";
  if (!packageId) return NextResponse.json({ detail: "packageId is required" }, { status: 400 });
  const removed = await deleteLocalCharacterLibrary(packageId, { customOnly: custom });
  if (!removed) return NextResponse.json({ detail: "Character library package not found" }, { status: 404 });
  return new Response(null, { status: 204 });
}

// My characters: save the recolour rules every future use of the character starts with.
export async function PATCH(request: Request) {
  try {
    const body = await request.json() as { packageId?: string; colorReplacements?: unknown };
    const packageId = String(body.packageId || "");
    const pkg = (await listCharacterPackages()).find((item) => item.id === packageId);
    if (!pkg) return NextResponse.json({ detail: "Character library package not found" }, { status: 404 });
    if (pkg.scope !== "custom") return NextResponse.json({ detail: "Only My characters can be recoloured in the library" }, { status: 403 });
    const rules = cleanColorRules(body.colorReplacements);
    await updateCharacterPackage(packageId, { colorReplacements: rules });
    return NextResponse.json({ packageId, colorReplacements: rules });
  } catch (error) {
    return NextResponse.json({ detail: error instanceof Error ? error.message : "Could not save colours" }, { status: 400 });
  }
}

const HEX = /^#[0-9a-f]{6}$/;
function cleanColorRules(value: unknown) {
  if (!Array.isArray(value)) throw new Error("colorReplacements must be a list");
  return value.slice(0, 200).map((item) => {
    const rule = (item || {}) as Record<string, unknown>;
    const from = String(rule.from || "").toLowerCase(), to = String(rule.to || "").toLowerCase();
    if (!HEX.test(from) || !HEX.test(to)) throw new Error("Colours must be #rrggbb");
    return {
      id: String(rule.id || `lib-${Date.now()}`).slice(0, 60),
      from, to,
      target: rule.target === "fill" || rule.target === "stroke" ? rule.target : "both",
      scope: "*",
      match: rule.match === "shades" ? "shades" : "exact",
    } as const;
  });
}
