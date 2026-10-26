import { createHash, randomUUID } from "crypto";
import { promises as fs } from "fs";
import path from "path";
import type { Html5CharacterLibraryAction, Html5CharacterLibraryCharacter } from "@/lib/html5CharacterCatalog";
import { listCharacterPackages, localDataRoot, localMediaRoot, registerCharacterPackage, removeCharacterPackage, type LocalCharacterPackage } from "@/lib/server/localStore";
import { extractZipSafely, MAX_LIBRARY_BYTES, safeRelative } from "@/lib/server/zipExtract";

function slug(value: string, fallback = "item"): string {
  const clean = value.trim().replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase();
  return clean.slice(0, 80) || fallback;
}

function cleanLabel(value: string): string {
  const cleaned = value
    .replace(/[_-]+/g, " ")
    .replace(/\bhtml5\s*canvas\b/gi, "")
    .replace(/^[\s\-_]+|[\s\-_]+$/g, "")
    .replace(/\s+/g, " ");
  return cleaned || "Action";
}

export const CUSTOM_CHARACTER_CATEGORY = "My Characters";
const DEFAULT_CHARACTER_CATEGORY = "Other";
// Wrapper folders that group a whole export rather than name a category.
const GENERIC_WRAPPER_FOLDER = /^(librar(y|ies)|characters?|html ?5|exports?|assets|animate)$/i;

/** The nearest meaningful folder above the character folder is its category: "Village/Kallu/idle.html" → "Village". */
function categoryFromCharacterDir(characterDirRel: string, packageLabel: string): string {
  const parents = characterDirRel.split(/[\\/]/).filter(Boolean).slice(0, -1);
  for (let index = parents.length - 1; index >= 0; index -= 1) {
    const label = cleanLabel(parents[index]);
    if (!GENERIC_WRAPPER_FOLDER.test(label) && label.toLowerCase() !== packageLabel.toLowerCase()) return label.slice(0, 80);
  }
  return DEFAULT_CHARACTER_CATEGORY;
}

/** Packages installed before categories existed: derive one from the stored action folder. */
export function withCharacterCategory(character: Html5CharacterLibraryCharacter, packageLabel: string): Html5CharacterLibraryCharacter {
  if (character.category) return character;
  const action = character.actions[0];
  if (!action) return { ...character, category: DEFAULT_CHARACTER_CATEGORY };
  // player.html sits in an action folder inside the character folder; raw exports sit in the character folder.
  const isPlayer = /\/player\.html(?:\?|$)/i.test(action.assetUrl);
  const folder = action.sourceFolder || "";
  const characterDirRel = isPlayer ? folder.split("/").slice(0, -1).join("/") : folder;
  return { ...character, category: categoryFromCharacterDir(characterDirRel, packageLabel) };
}

/** Packages installed while a renamed split character gave every pose the same id: give each its own again. */
export function withUniqueActionIds(character: Html5CharacterLibraryCharacter): Html5CharacterLibraryCharacter {
  if (new Set(character.actions.map((action) => action.id)).size === character.actions.length) return character;
  const used = new Set<string>();
  const actions = character.actions.map((action, index) => {
    const base = `${character.id}-${slug(action.actionName, `pose-${index + 1}`)}`;
    let id = base;
    for (let suffix = 2; used.has(id); suffix += 1) id = `${base}-${suffix}`;
    used.add(id);
    return { ...action, id };
  });
  return { ...character, actions };
}

function escapeXml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function mediaUrl(packageId: string, relativePath: string): string {
  return `/media/character_libraries/${packageId}/${relativePath.split(path.sep).join("/").split("/").map(encodeURIComponent).join("/")}`;
}

async function walk(root: string): Promise<string[]> {
  const output: string[] = [];
  const visit = async (dir: string) => {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      if (entry.name === "__MACOSX" || entry.name === ".DS_Store" || entry.name.startsWith("._")) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await visit(full);
      else if (entry.isFile()) output.push(full);
    }
  };
  await visit(root);
  return output.sort();
}

async function parseMetadata(jsPath: string | null, htmlPath: string): Promise<[number, number, number, number]> {
  let width = 1080;
  let height = 1920;
  let fps = 30;
  let frames = 180;
  let js = "";
  let html = "";
  if (jsPath) {
    try { js = await fs.readFile(jsPath, "utf8"); } catch { js = ""; }
  }
  try { html = await fs.readFile(htmlPath, "utf8"); } catch { html = ""; }
  const source = js || html;
  const readNumber = (key: string) => {
    const match = source.match(new RegExp(`\\b${key}\\s*:\\s*([0-9]+(?:\\.[0-9]+)?)`));
    return match ? Math.max(1, Math.floor(Number(match[1]))) : null;
  };
  width = readNumber("width") || width;
  height = readNumber("height") || height;
  fps = readNumber("fps") || fps;

  if (!js) {
    const canvas = html.match(/<canvas[^>]*\bwidth=["']?(\d+)["']?[^>]*\bheight=["']?(\d+)/i);
    if (canvas) {
      width = Math.max(1, Number(canvas[1]));
      height = Math.max(1, Number(canvas[2]));
    }
  }
  if (js) {
    const waits = Array.from(js.matchAll(/\.wait\((\d+)\)/g)).map((match) => Number(match[1]));
    const totals = Array.from(js.matchAll(/\btotalFrames\s*=\s*(\d+)/g)).map((match) => Number(match[1]));
    const candidates = [...waits, ...totals].filter(Number.isFinite);
    if (candidates.length) frames = Math.max(1, ...candidates);
  }
  return [width, height, fps, Math.max(100, Math.round((frames / Math.max(1, fps)) * 1000))];
}

function compositionId(jsText: string): string | null {
  // Adobe Animate may contain dozens of unrelated ids before lib.properties.
  const match = jsText.match(/lib\.properties\s*=\s*\{\s*id\s*:\s*["']([^"']+)["']/)
    || jsText.match(/compositions\[["']([^"']+)["']\]\s*=/);
  return match?.[1] || null;
}

function topLevelSymbols(jsText: string): string[] {
  const start = jsText.indexOf("// stage content:");
  if (start < 0) return [];
  const end = jsText.indexOf("// library properties:", start);
  const block = jsText.slice(start, end >= 0 ? end : undefined);
  const rx = /this\.([A-Za-z0-9_$]+)\s*=\s*new\s+lib\.([A-Za-z0-9_$]+)\([^;]*\);\s*this\.\1\.setTransform\([^;]*\);/gs;
  const output: string[] = [];
  const seen = new Set<string>();
  for (const match of block.matchAll(rx)) {
    const symbol = match[2];
    if (!symbol || seen.has(symbol)) continue;
    seen.add(symbol);
    output.push(symbol);
  }
  return output;
}

function symbolLabel(symbol: string, documentName: string, index: number): string {
  const text = symbol
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text || /^(symbol|instance|movie\s*clip)\s*\d*(?:\s*copy\s*\d*)?$/i.test(text)) {
    return `${cleanLabel(documentName)} ${String(index + 1).padStart(2, "0")}`;
  }
  return text.slice(0, 200);
}

// Every player loads the one shared bridge (public/vendor/cb-animate-bridge.js), so desktop
// and Docker installs run identical code and old installs can be upgraded in place.
export const CHARACTER_BRIDGE_VERSION = 2;
const BRIDGE_SRC = `/vendor/cb-animate-bridge.js?v=${CHARACTER_BRIDGE_VERSION}`;

function bridgeScript(width: number, height: number, fps: number): string {
  return `<script src="${BRIDGE_SRC}" data-cb-bridge data-width="${Math.round(width)}" data-height="${Math.round(height)}" data-fps="${Math.round(fps)}"></script>`;
}

/** Swap the inline bridge baked into players by older installs for the shared bridge tag. */
function upgradeBridgeHtml(text: string): string | null {
  // Older desktop pose players lost the regex backslashes (template literal) and crashed on load.
  const repaired = text.replace("/.(?:mp3|wav|ogg|m4a)(?:?|$)/i", "/\\.(?:mp3|wav|ogg|m4a)(?:\\?|$)/i");
  const inline = repaired.match(/<script id="cb-uploaded-library-bridge">[\s\S]*?<\/script>/);
  if (!inline) return repaired === text ? null : repaired;
  text = repaired;
  const old = inline[0];
  const canvas = text.match(/<canvas[^>]*\bwidth=["']?(\d+)["']?[^>]*\bheight=["']?(\d+)/i);
  const width = Number(old.match(/\bW=(\d+)/)?.[1] || old.match(/width:(\d+),height:\d+/)?.[1] || canvas?.[1] || 1080);
  const height = Number(old.match(/\bH=(\d+)/)?.[1] || old.match(/width:\d+,height:(\d+)/)?.[1] || canvas?.[2] || 1920);
  const fps = Number(old.match(/\bFPS=(\d+)/)?.[1] || old.match(/\/1000\*(\d+)\)/)?.[1] || 30);
  return text
    .replace(old, () => bridgeScript(width, height, fps))
    // Older Docker players painted a white page behind the character.
    .replace("overflow:hidden;background:#fff}canvas", "overflow:hidden;background:transparent}canvas");
}

/** One-time upgrade of an installed package's players to the shared bridge. */
export async function upgradeCharacterPackageBridges(packageId: string): Promise<number> {
  const packageRoot = path.join(localMediaRoot(), "character_libraries", packageId);
  let files: string[] = [];
  try { files = await walk(packageRoot); } catch { return 0; }
  let upgraded = 0;
  for (const file of files) {
    if (path.extname(file).toLowerCase() !== ".html") continue;
    let text: string;
    try { text = await fs.readFile(file, "utf8"); } catch { continue; }
    const next = upgradeBridgeHtml(text);
    if (next == null) continue;
    await fs.writeFile(file, next, "utf8");
    upgraded += 1;
  }
  return upgraded;
}

function isolatedSymbolPlayerHtml(sourceJsUrl: string, compId: string, symbol: string, width: number, height: number, fps: number): string {
  const sourceBase = `${sourceJsUrl.slice(0, sourceJsUrl.lastIndexOf("/") + 1)}`;
  const bridge = bridgeScript(width, height, fps);
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:transparent}canvas{display:block;width:100%;height:100%;background:transparent}</style>
</head><body><canvas id="canvas" width="${width}" height="${height}"></canvas>
<script src="/vendor/createjs"></script>
<script src="${sourceJsUrl}"></script>
<script>(function(){
var canvas=document.getElementById('canvas'),W=${width},H=${height},COMP=${JSON.stringify(compId)},SYMBOL=${JSON.stringify(symbol)},SRC_BASE=${JSON.stringify(sourceBase)};
var preview=new URLSearchParams(location.search).get('cbPreview')==='1',stage=null,root=null,lib=null;
function absSrc(src){try{return new URL(String(src||''),location.origin+SRC_BASE).href;}catch(e){return src;}}
function fit(){var gb=root&&root.getBounds&&root.getBounds(),nb=root&&root.nominalBounds;if(gb&&nb&&(gb.width>nb.width*5||gb.height>nb.height*5))gb=null;var b=gb||nb||(lib&&lib[SYMBOL]&&lib[SYMBOL].prototype&&lib[SYMBOL].prototype.nominalBounds)||{x:0,y:0,width:W,height:H};var bw=Math.max(1,Number(b.width)||W),bh=Math.max(1,Number(b.height)||H),pad=.92,s=Math.min(W*pad/bw,H*pad/bh);root.scaleX=root.scaleY=s;root.x=(W-bw*s)/2-(Number(b.x)||0)*s;root.y=(H-bh*s)/2-(Number(b.y)||0)*s;}
function render(){try{var C=lib&&lib[SYMBOL];if(!C)throw new Error('Missing Animate library symbol '+SYMBOL);root=new C();window.exportRoot=root;stage=new createjs.Stage(canvas);window.stage=stage;stage.addChild(root);fit();if(root.gotoAndStop)root.gotoAndStop(0);stage.update();if(!preview){createjs.Ticker.framerate=(lib.properties&&lib.properties.fps)||${fps};createjs.Ticker.addEventListener('tick',stage);}}catch(err){console.error(err);}}
function ready(comp){lib=comp.getLibrary();var manifest=(lib.properties&&lib.properties.manifest)||[];if(!manifest.length){render();return;}var queue=new createjs.LoadQueue(false);queue.addEventListener('fileload',function(evt){if(evt&&evt.item&&evt.item.type==='image')comp.getImages()[evt.item.id]=evt.result;});queue.addEventListener('complete',function(evt){try{var ss=comp.getSpriteSheet(),meta=lib.ssMetadata||[];for(var i=0;i<meta.length;i++)ss[meta[i].name]=new createjs.SpriteSheet({images:[evt.target.getResult(meta[i].name)],frames:meta[i].frames});}catch(e){}render();});var visible=manifest.filter(function(item){return !/\\.(?:mp3|wav|ogg|m4a)(?:\\?|$)/i.test(String(item.src||''));});if(!visible.length){render();return;}queue.loadManifest(visible.map(function(item){var copy=Object.assign({},item);copy.src=absSrc(copy.src);return copy;}));}
try{var comp=window.AdobeAn&&AdobeAn.getComposition(COMP);if(!comp)throw new Error('Animate composition not found: '+COMP);ready(comp);}catch(err){console.error(err);}
})();</script>
${bridge}
</body></html>`;
}

async function splitCombinedAnimateExport(
  packageId: string,
  packageRoot: string,
  htmlPath: string,
  jsPath: string | null,
  sourceFolder: string,
): Promise<Html5CharacterLibraryCharacter[]> {
  if (!jsPath) return [];
  let jsText = "";
  try { jsText = await fs.readFile(jsPath, "utf8"); } catch { return []; }
  const symbols = topLevelSymbols(jsText);
  const compId = compositionId(jsText);
  if (symbols.length < 2 || !compId) return [];

  const docName = cleanLabel(path.basename(htmlPath, path.extname(htmlPath)));
  const generatedRoot = path.join(packageRoot, "cb-isolated-symbols", slug(docName, "document"));
  await fs.mkdir(generatedRoot, { recursive: true });
  const jsRel = relativeInside(packageRoot, jsPath);
  if (!jsRel) return [];
  const sourceJsUrl = mediaUrl(packageId, jsRel);
  const [, , fps, durationMs] = await parseMetadata(jsPath, htmlPath);
  const width = 720;
  const height = 960;
  // A combined Animate stage represents one character with multiple pose clips.
  // Keep its poses as actions so the library can present them independently while
  // retaining a single character identity for replacement and similarity search.
  const characterId = `upload-${packageId.slice(0, 8)}-${slug(docName, "character")}`;
  const actions: Html5CharacterLibraryCharacter["actions"] = [];
  const used = new Set<string>();
  for (let index = 0; index < symbols.length; index += 1) {
    const symbol = symbols[index];
    const name = symbolLabel(symbol, docName, index);
    let key = slug(name, `pose-${index + 1}`);
    let suffix = 2;
    while (used.has(key)) key = `${slug(name, `pose-${index + 1}`)}-${suffix++}`;
    used.add(key);
    const symbolDir = path.join(generatedRoot, `${String(index + 1).padStart(3, "0")}-${slug(symbol, "symbol")}`);
    await fs.mkdir(symbolDir, { recursive: true });
    const playerPath = path.join(symbolDir, "player.html");
    await fs.writeFile(playerPath, isolatedSymbolPlayerHtml(sourceJsUrl, compId, symbol, width, height, fps), "utf8");
    const playerRel = relativeInside(packageRoot, playerPath);
    if (!playerRel) continue;
    const playerUrl = mediaUrl(packageId, playerRel);
    actions.push({
      id: `${characterId}-${key}`,
      characterId,
      characterName: docName,
      actionName: name,
      thumbUrl: `${playerUrl}?cbPreview=1`,
      sourceSvgName: `${symbol} (isolated Animate pose)`,
      sourceFolder,
      assetUrl: playerUrl,
      sourceWidth: width,
      sourceHeight: height,
      fps,
      durationMs,
    });
  }
  return actions.length ? [{
    id: characterId, name: docName, sourceFolder,
    origin: "uploaded", packageId, actions,
  }] : [];

}

async function patchAnimateHtml(htmlPath: string, width: number, height: number, fps: number): Promise<void> {
  let text: string;
  try { text = await fs.readFile(htmlPath, "utf8"); } catch { return; }
  if (text.includes("data-cb-bridge")) return;
  const upgraded = upgradeBridgeHtml(text);
  if (upgraded != null) { await fs.writeFile(htmlPath, upgraded, "utf8"); return; }
  text = text.replace(/<script[^>]+src=["']https?:\/\/code\.createjs\.com\/[^"']+["'][^>]*><\/script>/gi, '<script src="/vendor/createjs"></script>');
  const bridge = bridgeScript(width, height, fps);
  if (/<\/body\s*>/i.test(text)) text = text.replace(/<\/body\s*>/i, `${bridge}\n</body>`);
  else text += `\n${bridge}`;
  await fs.writeFile(htmlPath, text, "utf8");
}

async function previewFor(htmlPath: string, character: string, action: string): Promise<string> {
  const dir = path.dirname(htmlPath);
  const base = htmlPath.slice(0, -path.extname(htmlPath).length);
  const candidates = [
    `${base}.svg`, `${base}.png`, `${base}.jpg`, `${base}.jpeg`,
    path.join(dir, "preview.svg"), path.join(dir, "preview.png"), path.join(dir, "preview.jpg"), path.join(dir, "preview.jpeg"),
  ];
  for (const candidate of candidates) {
    try { if ((await fs.stat(candidate)).isFile()) return candidate; } catch {}
  }
  const files = await fs.readdir(dir);
  const first = files.sort().find((name) => !name.startsWith("._") && /\.(svg|png|jpe?g)$/i.test(name));
  if (first) return path.join(dir, first);
  const generated = path.join(dir, "cb-preview.svg");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 540 720"><rect width="540" height="720" rx="28" fill="#f5f3ee"/><circle cx="270" cy="218" r="92" fill="#d4c8b6"/><rect x="165" y="320" width="210" height="230" rx="70" fill="#b7aa96"/><text x="270" y="625" text-anchor="middle" font-family="Arial,sans-serif" font-size="30" fill="#2b2925">${escapeXml(character)}</text><text x="270" y="665" text-anchor="middle" font-family="Arial,sans-serif" font-size="22" fill="#6d675e">${escapeXml(action)}</text></svg>`;
  await fs.writeFile(generated, svg, "utf8");
  return generated;
}

function relativeInside(root: string, target: string): string | null {
  const rel = path.relative(root, target);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return rel === "" ? "" : null;
  return rel;
}

function canonicalPartKey(value: string): string | null {
  const key = value.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (/(head|face|hair|turban|pagdi)/.test(key)) return "head";
  if (/(baniyan|vest|shirt|uppercloth|jacket|kurta|blouse)/.test(key)) return "baniyan";
  if (/(lungi|dhoti|pant|trouser|lowercloth|skirt|pyjama|pajama)/.test(key)) return "lungi";
  if (/(lefthand|leftarm|lhand|larm)/.test(key)) return "leftHand";
  if (/(righthand|rightarm|rhand|rarm)/.test(key)) return "rightHand";
  if (/(leftleg|leftfoot|lleg|lfoot)/.test(key)) return "leftLeg";
  if (/(rightleg|rightfoot|rleg|rfoot)/.test(key)) return "rightLeg";
  if (/(torso|body|chest|trunk)/.test(key)) return "torso";
  return null;
}

async function discoverPartAssets(packageId: string, packageRoot: string, actionDir: string): Promise<Html5CharacterLibraryAction["partAssets"]> {
  const output: NonNullable<Html5CharacterLibraryAction["partAssets"]> = {};
  const candidateDirs = [path.join(actionDir, "parts"), actionDir];
  for (const dir of candidateDirs) {
    let entries: string[] = [];
    try { entries = await fs.readdir(dir); } catch { continue; }
    for (const name of entries) {
      if (!/\.(svg|png|jpe?g|webp)$/i.test(name)) continue;
      const partKey = canonicalPartKey(path.basename(name, path.extname(name)));
      if (!partKey || output[partKey]) continue;
      const full = path.join(dir, name);
      const rel = relativeInside(packageRoot, full);
      if (!rel) continue;
      const url = mediaUrl(packageId, rel);
      output[partKey] = { assetUrl: url, thumbUrl: url, renderKind: "image" };
    }
  }
  return Object.keys(output).length ? output : undefined;
}

async function normalizeManifest(
  manifest: unknown,
  packageId: string,
  packageRoot: string,
): Promise<Html5CharacterLibraryCharacter[]> {
  if (!manifest || typeof manifest !== "object") return [];
  const rawCharacters = (manifest as { characters?: unknown }).characters;
  if (!Array.isArray(rawCharacters)) return [];
  const output: Html5CharacterLibraryCharacter[] = [];
  for (let charIndex = 0; charIndex < rawCharacters.length; charIndex += 1) {
    const rawCharacter = rawCharacters[charIndex];
    if (!rawCharacter || typeof rawCharacter !== "object") continue;
    const character = rawCharacter as Record<string, unknown>;
    const name = String(character.name || `Character ${charIndex + 1}`).slice(0, 200);
    const characterId = `upload-${packageId.slice(0, 8)}-${slug(String(character.id || name), `character-${charIndex + 1}`)}`;
    const actions: Html5CharacterLibraryAction[] = [];
    const rawActions = Array.isArray(character.actions) ? character.actions : [];
    for (let actionIndex = 0; actionIndex < rawActions.length; actionIndex += 1) {
      const rawAction = rawActions[actionIndex];
      if (!rawAction || typeof rawAction !== "object") continue;
      const action = rawAction as Record<string, unknown>;
      const playerRel = safeRelative(String(action.player || action.assetUrl || ""));
      if (!playerRel) continue;
      const playerPath = path.resolve(packageRoot, playerRel);
      if (!relativeInside(packageRoot, playerPath)) continue;
      try { if (!(await fs.stat(playerPath)).isFile()) continue; } catch { continue; }
      const actionName = String(action.actionName || action.name || `Action ${actionIndex + 1}`).slice(0, 200);
      let previewPath: string | null = null;
      const previewRel = safeRelative(String(action.preview || action.thumbUrl || ""));
      if (previewRel) {
        const candidate = path.resolve(packageRoot, previewRel);
        if (relativeInside(packageRoot, candidate)) {
          try { if ((await fs.stat(candidate)).isFile()) previewPath = candidate; } catch {}
        }
      }
      let siblingJs = playerPath.slice(0, -path.extname(playerPath).length) + ".js";
      try {
        if (!(await fs.stat(siblingJs)).isFile()) throw new Error();
      } catch {
        const animationJs = path.join(path.dirname(playerPath), "animation.js");
        try { siblingJs = (await fs.stat(animationJs)).isFile() ? animationJs : ""; } catch { siblingJs = ""; }
      }
      const [detectedWidth, detectedHeight, detectedFps, detectedDurationMs] = await parseMetadata(siblingJs || null, playerPath);
      const sourceWidth = Math.max(1, Number(action.sourceWidth || detectedWidth));
      const sourceHeight = Math.max(1, Number(action.sourceHeight || detectedHeight));
      const fps = Math.max(1, Number(action.fps || detectedFps));
      const durationMs = Math.max(100, Number(action.durationMs || detectedDurationMs));
      await patchAnimateHtml(playerPath, sourceWidth, sourceHeight, fps);

      previewPath ||= await previewFor(playerPath, name, actionName);
      const playerUrlRel = relativeInside(packageRoot, playerPath);
      const previewUrlRel = relativeInside(packageRoot, previewPath);
      if (!playerUrlRel || !previewUrlRel) continue;

      let partAssets = await discoverPartAssets(packageId, packageRoot, path.dirname(playerPath));
      const manifestParts = action.parts;
      if (manifestParts && typeof manifestParts === "object" && !Array.isArray(manifestParts)) {
        const explicit: NonNullable<Html5CharacterLibraryAction["partAssets"]> = { ...(partAssets || {}) };
        for (const [rawKey, rawValue] of Object.entries(manifestParts as Record<string, unknown>)) {
          const partKey = canonicalPartKey(rawKey) || rawKey;
          const descriptor = typeof rawValue === "string" ? { asset: rawValue } : (rawValue && typeof rawValue === "object" ? rawValue as Record<string, unknown> : null);
          if (!descriptor) continue;
          const assetRel = safeRelative(String(descriptor.asset || descriptor.assetUrl || descriptor.player || ""));
          if (!assetRel) continue;
          const assetPath = path.resolve(packageRoot, assetRel);
          if (!relativeInside(packageRoot, assetPath)) continue;
          try { if (!(await fs.stat(assetPath)).isFile()) continue; } catch { continue; }
          const thumbRel = safeRelative(String(descriptor.thumb || descriptor.thumbUrl || assetRel));
          let thumbPath = assetPath;
          if (thumbRel) {
            const candidate = path.resolve(packageRoot, thumbRel);
            if (relativeInside(packageRoot, candidate)) {
              try { if ((await fs.stat(candidate)).isFile()) thumbPath = candidate; } catch {}
            }
          }
          const assetUrlRel = relativeInside(packageRoot, assetPath);
          const thumbUrlRel = relativeInside(packageRoot, thumbPath);
          if (!assetUrlRel || !thumbUrlRel) continue;
          explicit[partKey] = {
            assetUrl: mediaUrl(packageId, assetUrlRel),
            thumbUrl: mediaUrl(packageId, thumbUrlRel),
            renderKind: String(descriptor.renderKind || "").toLowerCase() === "source-symbol" || /\.html?$/i.test(assetPath) ? "source-symbol" : "image",
          };
        }
        partAssets = Object.keys(explicit).length ? explicit : undefined;
      }

      actions.push({
        id: `${characterId}-${slug(String(action.id || actionName), `action-${actionIndex + 1}`)}`,
        characterId,
        characterName: name,
        actionName,
        thumbUrl: mediaUrl(packageId, previewUrlRel),
        sourceSvgName: path.basename(previewPath),
        sourceFolder: String(action.sourceFolder || path.dirname(playerUrlRel).split(path.sep).join("/")),
        assetUrl: mediaUrl(packageId, playerUrlRel),
        sourceWidth,
        sourceHeight,
        fps,
        durationMs,
        partAssets,
      });
    }
    if (actions.length) {
      output.push({
        id: characterId,
        name,
        sourceFolder: String(character.sourceFolder || name),
        category: String(character.category || "").trim().slice(0, 80) || DEFAULT_CHARACTER_CATEGORY,
        origin: "uploaded",
        packageId,
        actions,
      });
    }
  }
  return output;
}

async function discoverCatalog(packageId: string, packageRoot: string, packageLabel: string): Promise<Html5CharacterLibraryCharacter[]> {
  const files = await walk(packageRoot);
  const manifestPath = files.find((file) => path.basename(file).toLowerCase() === "cb-library.json");
  if (manifestPath) {
    try {
      const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
      const normalized = await normalizeManifest(manifest, packageId, packageRoot);
      if (normalized.length) return normalized;
    } catch {}
  }

  const playerFiles = files.filter((file) => path.basename(file).toLowerCase() === "player.html");
  const playerDirs = new Set(playerFiles.map((file) => path.dirname(file)));
  const rawHtmlFiles = files.filter((file) => path.extname(file).toLowerCase() === ".html" && path.basename(file).toLowerCase() !== "player.html" && !playerDirs.has(path.dirname(file)));
  const htmlFiles = [...playerFiles, ...rawHtmlFiles];
  if (!htmlFiles.length) throw new Error("No HTML5 character actions found in the ZIP");

  const grouped = new Map<string, Html5CharacterLibraryCharacter>();
  const usedActionIds = new Set<string>();
  for (let index = 0; index < htmlFiles.length; index += 1) {
    const htmlPath = htmlFiles[index];
    const rel = path.relative(packageRoot, htmlPath);
    const parent = path.dirname(htmlPath);
    const parentRel = path.dirname(rel);
    const isPlayer = path.basename(htmlPath).toLowerCase() === "player.html";
    const relParts = rel.split(path.sep);

    let characterName: string;
    let actionName: string;
    let sourceFolder: string;
    let characterDirRel: string;
    if (relParts.length === 1) {
      characterName = cleanLabel(path.basename(htmlPath, path.extname(htmlPath)));
      actionName = characterName;
      sourceFolder = characterName;
      characterDirRel = "";
    } else if (isPlayer) {
      // player.html normally lives inside an action folder. Its parent is the
      // action and its grandparent is the character. This remains correct when
      // the ZIP also contains an extra top-level "Library" folder.
      characterName = cleanLabel(relParts.length >= 3 ? path.basename(path.dirname(parent)) : path.basename(parent));
      actionName = cleanLabel(path.basename(parent));
      sourceFolder = parentRel.split(path.sep).join("/");
      characterDirRel = relParts.length >= 3 ? path.dirname(parentRel) : parentRel;
    } else {
      // Raw Adobe Animate exports usually place action .html/.js files directly
      // inside the character folder, even if there is an outer library folder.
      characterName = cleanLabel(path.basename(parent));
      actionName = cleanLabel(path.basename(htmlPath, path.extname(htmlPath)));
      sourceFolder = parentRel.split(path.sep).join("/");
      characterDirRel = parentRel;
    }
    const category = categoryFromCharacterDir(characterDirRel, packageLabel);

    const characterId = `upload-${packageId.slice(0, 8)}-${slug(characterName, `character-${index + 1}`)}`;
    let jsPath = htmlPath.slice(0, -path.extname(htmlPath).length) + ".js";
    try {
      if (!(await fs.stat(jsPath)).isFile()) throw new Error();
    } catch {
      const animationJs = path.join(parent, "animation.js");
      try { jsPath = (await fs.stat(animationJs)).isFile() ? animationJs : ""; } catch { jsPath = ""; }
    }
    const [width, height, fps, durationMs] = await parseMetadata(jsPath || null, htmlPath);
    if (!isPlayer) {
      const splitCharacters = await splitCombinedAnimateExport(packageId, packageRoot, htmlPath, jsPath || null, sourceFolder);
      if (splitCharacters.length) {
        for (const splitCharacter of splitCharacters) {
          splitCharacter.category = category;
          let candidateId = splitCharacter.id;
          let suffix = 2;
          while (grouped.has(candidateId)) candidateId = `${splitCharacter.id}-${suffix++}`;
          if (candidateId !== splitCharacter.id) {
            const previousId = splitCharacter.id;
            splitCharacter.id = candidateId;
            for (const action of splitCharacter.actions) {
              action.characterId = candidateId;
              // Keep each pose's own key: "<old id>-<pose>" becomes "<new id>-<pose>".
              action.id = action.id.startsWith(`${previousId}-`) ? `${candidateId}${action.id.slice(previousId.length)}` : `${candidateId}-${action.id}`;
            }
          }
          grouped.set(splitCharacter.id, splitCharacter);
        }
        continue;
      }
    }
    // Created after the split check (as in Django) so a split export doesn't clash with an empty placeholder.
    let character = grouped.get(characterId);
    if (!character) {
      character = {
        id: characterId,
        name: characterName,
        sourceFolder: sourceFolder.includes("/") ? sourceFolder.slice(0, sourceFolder.lastIndexOf("/")) : sourceFolder,
        category,
        origin: "uploaded",
        packageId,
        actions: [],
      };
      grouped.set(characterId, character);
    }
    await patchAnimateHtml(htmlPath, width, height, fps);
    const preview = await previewFor(htmlPath, characterName, actionName);

    let actionId = `${characterId}-${slug(actionName, `action-${index + 1}`)}`;
    let suffix = 2;
    while (usedActionIds.has(actionId)) actionId = `${characterId}-${slug(actionName, `action-${index + 1}`)}-${suffix++}`;
    usedActionIds.add(actionId);

    const htmlRel = relativeInside(packageRoot, htmlPath);
    const previewRel = relativeInside(packageRoot, preview);
    if (!htmlRel || !previewRel) continue;
    const partAssets = await discoverPartAssets(packageId, packageRoot, path.dirname(htmlPath));
    character.actions.push({
      id: actionId,
      characterId,
      characterName,
      actionName,
      thumbUrl: mediaUrl(packageId, previewRel),
      sourceSvgName: path.basename(preview),
      sourceFolder,
      assetUrl: mediaUrl(packageId, htmlRel),
      sourceWidth: width,
      sourceHeight: height,
      fps,
      durationMs, 
      partAssets,
    });
  }
  return Array.from(grouped.values()).filter((character) => character.actions.length > 0);
}


export async function deleteLocalCharacterLibrary(packageId: string, options: { customOnly?: boolean } = {}): Promise<boolean> {
  const safeId = String(packageId || "").replace(/[^a-zA-Z0-9]/g, "");
  if (!safeId || safeId !== packageId) return false;
  if (options.customOnly) {
    // Editor users may only remove their own Upload custom packages, never the admin library.
    const found = (await listCharacterPackages()).find((pkg) => pkg.id === packageId);
    if (found?.scope !== "custom") return false;
  }
  const removed = await removeCharacterPackage(packageId);
  if (!removed) return false;
  const packageRoot = path.join(localMediaRoot(), "character_libraries", packageId);
  await fs.rm(packageRoot, { recursive: true, force: true }).catch(() => undefined);
  return true;
}

/**
 * Identity of an installed export, independent of how it was packed (ZIP or picked folder):
 * every original file's path + content, skipping generated files. HTML is identified by path
 * only, because installs patch it. Same algorithm as the Django backend.
 */
export async function characterPackageFingerprint(packageRoot: string): Promise<string> {
  const hash = createHash("sha256");
  const files = (await walk(packageRoot))
    .map((file) => ({ file, rel: path.relative(packageRoot, file).split(path.sep).join("/") }))
    .filter(({ rel }) => !rel.split("/").includes("cb-isolated-symbols") && path.posix.basename(rel) !== "cb-preview.svg")
    .sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
  for (const { file, rel } of files) {
    hash.update(rel); hash.update("\0");
    if (path.extname(rel).toLowerCase() !== ".html") hash.update(createHash("sha256").update(await fs.readFile(file)).digest());
  }
  return hash.digest("hex");
}

// Files that can hold the package's own /media/character_libraries/<id>/ address.
const REWRITE_EXTENSIONS = new Set([".html", ".htm", ".json", ".svg", ".css", ".js"]);

/**
 * My characters: a full copy of a package under a new name (Find and Replace "create a duplicate
 * library before proceeding"). Files are copied, the package address inside them is rewritten, and
 * the copy gets its own ids; colour rules carry over. The renamed character is `characterId`
 * (or the only one). Mirrors duplicate_character_package() in the Django backend.
 */
export async function duplicateLocalCharacterLibrary(packageId: string, name: string, characterId?: string): Promise<LocalCharacterPackage> {
  const source = (await listCharacterPackages()).find((pkg) => pkg.id === packageId);
  if (!source || source.scope !== "custom" || !/^[a-f0-9]{32}$/.test(source.id)) throw new Error("Character library package not found");
  const cleanName = String(name || "").replace(/\s+/g, " ").trim().slice(0, 80); // the user's name, as typed
  if (!cleanName) throw new Error("Name the copy first");

  const newId = randomUUID().replace(/-/g, "");
  const librariesRoot = path.join(localMediaRoot(), "character_libraries");
  const sourceRoot = path.join(librariesRoot, source.id);
  const targetRoot = path.join(librariesRoot, newId);
  await fs.cp(sourceRoot, targetRoot, { recursive: true });
  try {
    for (const file of await walk(targetRoot)) {
      if (!REWRITE_EXTENSIONS.has(path.extname(file).toLowerCase())) continue;
      const text = await fs.readFile(file, "utf8");
      if (text.includes(source.id)) await fs.writeFile(file, text.split(source.id).join(newId), "utf8");
    }
    const oldPrefix = `upload-${source.id.slice(0, 8)}-`, newPrefix = `upload-${newId.slice(0, 8)}-`;
    const characters = JSON.parse(JSON.stringify(source.characters).split(source.id).join(newId).split(oldPrefix).join(newPrefix)) as Html5CharacterLibraryCharacter[];
    const renamedId = characterId ? characterId.split(oldPrefix).join(newPrefix) : "";
    for (const character of characters) {
      if (characters.length > 1 && character.id !== renamedId) continue;
      character.name = cleanName;
      character.userNamed = true;
      for (const action of character.actions) action.characterName = cleanName;
    }
    const pkg: LocalCharacterPackage = {
      ...source,
      id: newId,
      name: cleanName,
      url: `/media/character_libraries/${newId}/`,
      created_at: new Date().toISOString(),
      // Its own fingerprint: uploading the original export again still finds the original.
      fingerprint: `copy:${newId}`,
      userNamed: true,
      colorReplacements: (source.colorReplacements || []).map((rule) => ({ ...rule })),
      characters,
    };
    await registerCharacterPackage(pkg);
    return pkg;
  } catch (error) {
    await fs.rm(targetRoot, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}

export async function installLocalCharacterLibrary(buffer: Uint8Array, originalName: string, options: { custom?: boolean; fingerprint?: string } = {}): Promise<LocalCharacterPackage & { duplicate?: boolean }> {
  if (!originalName.toLowerCase().endsWith(".zip")) throw new Error("Character library must be uploaded as a ZIP file");
  if (buffer.byteLength > MAX_LIBRARY_BYTES) throw new Error("Character library ZIP is too large; max 500 MB");

  const packageId = randomUUID().replace(/-/g, "");
  const packageRoot = path.join(localMediaRoot(), "character_libraries", packageId);
  const tempRoot = path.join(localDataRoot(), "tmp");
  const tempZip = path.join(tempRoot, `${packageId}.zip`);
  await fs.mkdir(tempRoot, { recursive: true });
  await fs.mkdir(path.dirname(packageRoot), { recursive: true });
  await fs.mkdir(packageRoot, { recursive: false });
  await fs.writeFile(tempZip, buffer);

  try {
    await extractZipSafely(tempZip, packageRoot);
    // A converted Animate file is identified by its source .fla: every publish writes slightly different files.
    const fingerprint = options.fingerprint || await characterPackageFingerprint(packageRoot);
    if (options.custom) {
      // The same export uploaded again reuses the saved copy (the new extraction is discarded below).
      const existing = (await listCharacterPackages()).find((pkg) => pkg.scope === "custom" && pkg.fingerprint === fingerprint);
      if (existing) return { ...existing, duplicate: true };
    }

    const name = cleanLabel(path.basename(originalName, path.extname(originalName))).slice(0, 200);
    const characters = await discoverCatalog(packageId, packageRoot, name);
    if (options.custom) {
      for (const character of characters) {
        character.origin = "custom";
        character.category = CUSTOM_CHARACTER_CATEGORY;
      }
    }
    const created = new Date().toISOString();
    const pkg: LocalCharacterPackage = {
      id: packageId,
      name,
      url: `/media/character_libraries/${packageId}/`,
      created_at: created,
      characterCount: characters.length,
      actionCount: characters.reduce((sum, character) => sum + character.actions.length, 0),
      bridgeVersion: CHARACTER_BRIDGE_VERSION,
      fingerprint,
      ...(options.custom ? { scope: "custom" as const } : {}),
      characters,
    };
    await registerCharacterPackage(pkg);
    return pkg;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/ENOENT/.test(message) && /unzip/i.test(message)) {
      throw new Error("The local unzip utility is unavailable. On macOS it should exist at /usr/bin/unzip.");
    }
    throw error;
  } finally {
    await fs.rm(tempZip, { force: true }).catch(() => undefined);
    // Keep extracted files only when registration succeeded. If discovery failed,
    // remove the incomplete package.
    const packages = await listCharacterPackages().catch(() => []);
    if (!packages.some((pkg) => pkg.id === packageId)) {
      await fs.rm(packageRoot, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}
