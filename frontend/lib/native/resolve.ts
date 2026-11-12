/**
 * Finds what a placed character is made of, from the player page it already points at: the pose's
 * published class (SYMBOL), the .fla beside its script, the pose's library name (from the
 * character's cb-fla-timeline index) and the frame rate the player runs at. Nothing about the
 * character has to be passed in, so the scene editor and the render page resolve it the same way.
 */
export type PoseSource = { flaUrl: string; js: string; item: string; fps: number };

const cache = new Map<string, Promise<PoseSource | null>>();

async function resolve(assetUrl: string): Promise<PoseSource | null> {
  const page = await fetch(assetUrl);
  if (!page.ok) return null;
  const html = await page.text();
  const js = html.match(/SYMBOL="([^"]+)"/)?.[1];
  const script = [...html.matchAll(/<script[^>]+src="([^"]+\.js)(?:\?[^"]*)?"/gi)].map((m) => m[1]).find((src) => !/\/vendor\/|cb-animate-bridge/.test(src));
  const fps = Number(html.match(/data-fps="([\d.]+)"/)?.[1]) || 30;
  const where = assetUrl.match(/^(.*?\/)cb-isolated-symbols\/([^/]+)\//);
  if (!js || !script || !where) return null;
  const flaUrl = script.replace(/\.js$/i, ".fla");
  const index = await fetch(`${where[1]}cb-fla-timeline/${where[2]}/index.json`);
  if (!index.ok) return null;
  const item = ((await index.json()) as { symbols?: Record<string, { name: string }> }).symbols?.[js]?.name;
  if (!item) return null;
  // The .fla has to be there to draw from.
  try { if (!(await fetch(flaUrl, { method: "HEAD" })).ok) return null; } catch { return null; }
  return { flaUrl, js, item, fps };
}

export function resolvePoseSource(assetUrl: string): Promise<PoseSource | null> {
  let found = cache.get(assetUrl.split("?")[0]);
  if (!found) {
    found = resolve(assetUrl.split("?")[0]).catch(() => null);
    cache.set(assetUrl.split("?")[0], found);
  }
  return found;
}
