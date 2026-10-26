import { readFile } from "node:fs/promises";
import path from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FILES = [
  ["easeljs", "lib", "easeljs.min.js"],
  ["tweenjs", "lib", "tweenjs.min.js"],
  ["preloadjs", "lib", "preloadjs.min.js"],
  ["soundjs", "lib", "soundjs.min.js"],
] as const;

// Where the packages live: the app folder's node_modules (Docker, dev), then every module root on
// NODE_PATH. The packaged desktop app keeps them in app.asar/node_modules, which its server runner
// puts on NODE_PATH; its own nextapp folder has no node_modules.
const moduleRoots = () => Array.from(new Set([
  path.join(process.cwd(), "node_modules"),
  ...(process.env.NODE_PATH || "").split(path.delimiter).filter(Boolean),
]));

const readPackageFile = async (parts: readonly string[]) => {
  let lastError: unknown = null;
  for (const root of moduleRoots()) {
    try { return await readFile(path.join(root, ...parts), "utf8"); } catch (error) { lastError = error; }
  }
  throw lastError ?? new Error(`${parts.join("/")} not found`);
};

export async function GET() {
  try {
    const sources = await Promise.all(FILES.map((parts) => readPackageFile(parts)));
    const source = [
      "/* CharacterBazaarStudio local CreateJS runtime: EaselJS + TweenJS + PreloadJS + SoundJS */",
      ...sources,
      "if (!globalThis.createjs) { throw new Error('CreateJS runtime did not initialize'); }",
    ].join("\n;\n");
    return new Response(source, {
      status: 200,
      headers: {
        "Content-Type": "application/javascript; charset=utf-8",
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[CBS] Local CreateJS runtime missing", message);
    return new Response(
      `console.error(${JSON.stringify("Local CreateJS runtime is missing: " + message)});`,
      { status: 500, headers: { "Content-Type": "application/javascript; charset=utf-8" } },
    );
  }
}
