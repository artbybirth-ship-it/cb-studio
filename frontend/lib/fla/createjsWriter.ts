/**
 * Writes an HTML5 Canvas export (CreateJS), as Adobe Animate publishes it, from an .fla read by
 * xfl.ts. Installed like any Animate export, so the character library, the player bridge,
 * "step inside" (it reads the .fla next to this .js) and video export all work unchanged, in
 * Docker and in the desktop app.
 *
 * Kept from Animate's output on purpose:
 * - Class names come from library names ("Symbol 1" → Symbol1, then Symbol1_1…); the bridge
 *   names body parts after them. Each class also says which library symbol it is
 *   (comment "fla: <name>") so "step inside" links renamed poses too.
 * - A "// <layer name>" comment starts each layer's code ("(mask)" for mask layers).
 * - Every keyframe starts a new tween step, which is where a Graphic symbol restarts from its
 *   first frame (CreateJS synched offset). Classic tweens tween the instance around its
 *   transformation point (regX/regY), like Animate; shape tweens are drawn frame by frame.
 * - A simple ease of intensity −100 is Ease.get(1) (ease out): Animate's sign is flipped.
 */
import { displayName, type Brush, type Ease, type Fill, type FlaDocument, type FlaElement, type InstanceElement, type Keyframe, type Layer, type Matrix, type Path, type ShapeElement, type Stroke, type Timeline } from "./xfl";
import { decodeBitmap } from "./bitmaps";

export type PoseChoice = { item: string; name: string; include: boolean };
/** generic: an unnamed library symbol ("Symbol 1 copy 6"); the library then shows "<character> 01". */
export type StagePose = { item: string; name: string; symbolType: string; generic: boolean };

/** A pose's name before it is renamed: its library name without folders. */
export const defaultPoseName = (item: string) => displayName(item.split("/").pop() || item);
const GENERIC_NAME = /^(symbol|instance|movie\s*clip)\s*\d*(?:\s*copy\s*\d*)?$/i;

/** The library symbols placed on the stage's first frame: each becomes a pose. Listed in reading
 *  order (rows top to bottom, each left to right), as a model sheet is laid out. */
export function stagePoses(doc: FlaDocument): StagePose[] {
  const found: Array<StagePose & { x: number; y: number }> = [];
  for (const layer of doc.stage.layers) {
    if (layer.type === "guide" || layer.type === "folder") continue;
    const first = layer.frames.find((frame) => frame.i === 0);
    for (const element of first?.elements || []) {
      if (element.k !== "instance" || !doc.symbols.has(element.item) || found.some((pose) => pose.item === element.item)) continue;
      const [x, y] = apply(element.m, element.pivot[0], element.pivot[1]);
      const name = defaultPoseName(element.item);
      found.push({ item: element.item, name, symbolType: element.symbolType, generic: GENERIC_NAME.test(name.replace(/[_-]+/g, " ").trim()), x, y });
    }
  }
  found.sort((a, b) => a.y - b.y);
  const rowGap = doc.height * 0.12;
  const rows: Array<typeof found> = [];
  for (const pose of found) {
    const row = rows[rows.length - 1];
    if (row && pose.y - row[0].y < rowGap) row.push(pose); else rows.push([pose]);
  }
  return rows.flatMap((row) => row.sort((a, b) => a.x - b.x)).map(({ x: _x, y: _y, ...pose }) => pose);
}

// ---------- numbers and names
const r = (value: number, digits = 4) => { const k = 10 ** digits; const v = Math.round(value * k) / k; return Object.is(v, -0) ? 0 : v; };
const q = (text: string) => JSON.stringify(text);
const plainName = (name: string) => (displayName(name).split("/").pop() || "").replace(/[^A-Za-z0-9_$]/g, "");
/** A pose name typed on import → a class name the library shows back as that name ("Arms crossed" → Arms_crossed). */
export const poseClassName = (name: string) => name.trim().replace(/\s+/g, "_").replace(/[^A-Za-z0-9_$]/g, "");
const RESERVED = new Set(["AnMovieClip", "Stage", "properties", "ssMetadata", "webFontTxtInst"]);

function uniqueName(base: string, taken: Set<string>, fallback: string): string {
  let root = base || fallback;
  if (/^\d/.test(root)) root = `_${root}`;
  let name = root;
  for (let n = 1; taken.has(name) || RESERVED.has(name); n += 1) name = `${root}_${n}`;
  taken.add(name);
  return name;
}

// ---------- geometry
type Point = [number, number];
const apply = (m: Matrix, x: number, y: number): Point => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
const multiply = (a: Matrix, b: Matrix): Matrix => [
  a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1],
  a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3],
  a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5],
];
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];
const isIdentity = (m: Matrix) => m.every((v, i) => Math.abs(v - IDENTITY[i]) < 1e-9);
type Box = [number, number, number, number]; // x0 y0 x1 y1
const growBox = (box: Box | null, x: number, y: number): Box => (box ? [Math.min(box[0], x), Math.min(box[1], y), Math.max(box[2], x), Math.max(box[3], y)] : [x, y, x, y]);
const unionBox = (a: Box | null, b: Box | null): Box | null => (!a ? b : !b ? a : [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])]);
function pathsBox(paths: Path[], m: Matrix = IDENTITY, pad = 0): Box | null {
  let box: Box | null = null;
  for (const path of paths) for (const cmd of path) for (let i = 1; i < cmd.length; i += 2) { const [x, y] = apply(m, cmd[i] as number, cmd[i + 1] as number); box = growBox(box, x, y); }
  return box && pad ? [box[0] - pad, box[1] - pad, box[2] + pad, box[3] + pad] : box;
}
const transformBox = (box: Box | null, m: Matrix): Box | null => {
  if (!box) return null;
  let out: Box | null = null;
  for (const [x, y] of [[box[0], box[1]], [box[2], box[1]], [box[2], box[3]], [box[0], box[3]]]) { const p = apply(m, x, y); out = growBox(out, p[0], p[1]); }
  return out;
};
const transformPath = (path: Path, m: Matrix): Path => path.map((cmd) => {
  if (cmd[0] === "Q") { const c = apply(m, cmd[1], cmd[2]); const p = apply(m, cmd[3], cmd[4]); return ["Q", c[0], c[1], p[0], p[1]]; }
  const p = apply(m, cmd[1], cmd[2]);
  return [cmd[0], p[0], p[1]];
});

/** setTransform arguments for a matrix (rotation kept as skew, like a classic tween needs). */
function decompose(m: Matrix, pivot: Point = [0, 0]) {
  const [a, b, c, d] = m;
  const [x, y] = apply(m, pivot[0], pivot[1]);
  return { x, y, scaleX: Math.hypot(a, b), scaleY: Math.hypot(c, d), skewX: (Math.atan2(-c, d) * 180) / Math.PI, skewY: (Math.atan2(b, a) * 180) / Math.PI, regX: pivot[0], regY: pivot[1] };
}
type Props = ReturnType<typeof decompose> & { alpha?: number };
/** setTransform arguments. A tweened instance keeps skewX/skewY even for a plain rotation: its
 *  tween steps set the skews, and a rotation left over would turn it twice. */
const transformArgs = (p: Props, allowRotation = true) => {
  const rotation = allowRotation && Math.abs(p.skewX - p.skewY) < 1e-6 ? p.skewX : 0;
  const skewX = rotation ? 0 : p.skewX, skewY = rotation ? 0 : p.skewY;
  const args = [p.x, p.y, p.scaleX, p.scaleY, rotation, skewX, skewY, p.regX, p.regY].map((v) => r(v));
  while (args.length > 2 && args[args.length - 1] === (args.length <= 4 ? 1 : 0)) args.pop();
  return args.join(",");
};

// ---------- CreateJS compact path encoding (Graphics.decodePath): base64, values in 1/10 px,
// each relative to the previous value on its axis (control points included); moveTo resets.
const BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
function encodePaths(paths: Path[], dx: number, dy: number): string {
  let out = "";
  for (const path of paths) {
    let x = 0, y = 0;
    for (const cmd of path) {
      const code = cmd[0] === "M" ? 0 : cmd[0] === "L" ? 1 : 2;
      if (code === 0) { x = 0; y = 0; }
      const values: number[] = [];
      for (let i = 1; i < cmd.length; i += 2) {
        const tx = Math.round(((cmd[i] as number) - dx) * 10), ty = Math.round(((cmd[i + 1] as number) - dy) * 10);
        values.push(tx - x, ty - y);
        x = tx; y = ty;
      }
      const wide = values.some((v) => Math.abs(v) > 2047);
      out += BASE64[(code << 3) | (wide ? 4 : 0)];
      for (const v of values) {
        const n = Math.min(Math.abs(v), wide ? 131071 : 2047);
        const sign = v < 0 ? 32 : 0;
        if (wide) out += BASE64[sign | ((n >> 12) & 31)] + BASE64[(n >> 6) & 63] + BASE64[n & 63];
        else out += BASE64[sign | ((n >> 6) & 31)] + BASE64[n & 63];
      }
    }
  }
  return out;
}

// ---------- paint
const hexRgba = (color: string, alpha: number) => {
  if (alpha >= 1) return color.toUpperCase();
  const h = color.replace("#", "");
  return `rgba(${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)},${r(alpha, 3)})`;
};
const mixFill = (a: Fill, b: Fill, t: number): Fill => {
  if (a.t !== "solid" || b.t !== "solid" || t <= 0) return a;
  const c = (s: string, i: number) => parseInt(s.replace("#", "").slice(i, i + 2), 16);
  const color = "#" + [0, 2, 4].map((i) => Math.round(c(a.color, i) + (c(b.color, i) - c(a.color, i)) * t).toString(16).padStart(2, "0")).join("").toUpperCase();
  return { t: "solid", color, alpha: a.alpha + (b.alpha - a.alpha) * t };
};
const G = 819.2; // gradient square half size (px)
/** Fill command; coordinates in the shape's (offset) space. */
function fillCommand(style: Fill, dx: number, dy: number): string {
  if (style.t === "solid") return `f(${q(hexRgba(style.color, style.alpha))})`;
  const colors = `[${style.stops.map((s) => q(hexRgba(s[1], s[2]))).join(",")}]`;
  const ratios = `[${style.stops.map((s) => r(Math.max(0, Math.min(1, s[0])), 3)).join(",")}]`;
  const m = style.m;
  if (style.t === "linear") {
    // The colour changes along u where p = M·(u, v): its gradient is M⁻¹'s first row.
    const det = m[0] * m[3] - m[1] * m[2] || 1e-9;
    const w: Point = [m[3] / det, -m[2] / det];
    const p0 = apply(m, -G, 0);
    const k = (2 * G) / (w[0] * w[0] + w[1] * w[1]);
    return `lf(${colors},${ratios},${r(p0[0] - dx)},${r(p0[1] - dy)},${r(p0[0] + w[0] * k - dx)},${r(p0[1] + w[1] * k - dy)})`;
  }
  const centre = apply(m, 0, 0);
  const focus = apply(m, style.focal * G, 0);
  const radius = Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) * G;
  return `rf(${colors},${ratios},${r(focus[0] - dx)},${r(focus[1] - dy)},0,${r(centre[0] - dx)},${r(centre[1] - dy)},${r(radius)})`;
}
const CAPS: Record<string, number> = { none: 0, round: 1, square: 2 };
const JOINTS: Record<string, number> = { miter: 0, round: 1, bevel: 2 };
function strokeCommand(style: Stroke): string {
  const fill = style.fill;
  const color = fill.t === "solid" ? hexRgba(fill.color, fill.alpha) : fill.stops[0] ? hexRgba(fill.stops[0][1], fill.stops[0][2]) : "#000000";
  const ignoreScale = style.scale === "none" ? 1 : 0;
  return `f().s(${q(color)}).ss(${r(Math.max(style.w, 0.1), 3)},${CAPS[style.caps] ?? 1},${JOINTS[style.joints] ?? 1},${r(style.miter, 2)}${ignoreScale ? ",1" : ""})`;
}

// ---------- art brushes: the brush artwork (SVG) laid along the stroke as filled paths
type BrushArt = { width: number; height: number; parts: Array<{ color: string; alpha: number; paths: Path[] }> };
function svgPathToPaths(d: string, m: Matrix): Path[] {
  const tokens = d.match(/[MmLlHhVvQqCcZz]|-?(?:\d+\.?\d*|\.\d+)(?:e-?\d+)?/g) || [];
  const paths: Path[] = [];
  let path: Path | null = null;
  let cmd = "M", x = 0, y = 0, sx = 0, sy = 0;
  const n = () => Number(tokens.shift());
  const push = (c: Path[number]) => { if (!path) { path = [["M", x, y]]; paths.push(path); } path.push(c); };
  while (tokens.length) {
    if (/[A-Za-z]/.test(tokens[0] ?? "")) cmd = tokens.shift()!;
    const rel = cmd === cmd.toLowerCase();
    const ox = rel ? x : 0, oy = rel ? y : 0;
    switch (cmd.toUpperCase()) {
      case "M": x = ox + n(); y = oy + n(); sx = x; sy = y; path = [["M", x, y]]; paths.push(path); cmd = rel ? "l" : "L"; break;
      case "L": x = ox + n(); y = oy + n(); push(["L", x, y]); break;
      case "H": x = ox + n(); push(["L", x, y]); break;
      case "V": y = oy + n(); push(["L", x, y]); break;
      case "Q": { const cx = ox + n(), cy = oy + n(); x = ox + n(); y = oy + n(); push(["Q", cx, cy, x, y]); break; }
      case "C": {
        // One quadratic per half of the cubic (close enough for brush artwork).
        const p0: Point = [x, y], c1: Point = [ox + n(), oy + n()], c2: Point = [ox + n(), oy + n()], p3: Point = [ox + n(), oy + n()];
        const mid = (a: Point, b: Point): Point => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
        const ab = mid(p0, c1), bc = mid(c1, c2), cd = mid(c2, p3), abc = mid(ab, bc), bcd = mid(bc, cd), half = mid(abc, bcd);
        push(["Q", (3 * (ab[0] + abc[0]) / 2 - p0[0] - half[0]) / 2, (3 * (ab[1] + abc[1]) / 2 - p0[1] - half[1]) / 2, half[0], half[1]]);
        push(["Q", (3 * (bcd[0] + cd[0]) / 2 - half[0] - p3[0]) / 2, (3 * (bcd[1] + cd[1]) / 2 - half[1] - p3[1]) / 2, p3[0], p3[1]]);
        x = p3[0]; y = p3[1];
        break;
      }
      case "Z": x = sx; y = sy; path = null; break;
      default: tokens.shift();
    }
  }
  return paths.map((p) => transformPath(p, m));
}
function parseBrush(brush: Brush): BrushArt | null {
  try {
    const svg = new DOMParser().parseFromString(brush.svg, "image/svg+xml").documentElement;
    const box = (svg.getAttribute("viewBox") || "").split(/[\s,]+/).map(Number);
    const width = box[2] || Number.parseFloat(svg.getAttribute("width") || "0"), height = box[3] || Number.parseFloat(svg.getAttribute("height") || "0");
    if (!width || !height) return null;
    const matrixOfAttr = (el: Element): Matrix => {
      const m = (el.getAttribute("transform") || "").match(/matrix\(([^)]+)\)/);
      if (!m) return [...IDENTITY];
      const v = m[1].split(/[\s,]+/).filter(Boolean).map(Number);
      return v.length === 6 ? [v[0], v[1], v[2], v[3], v[4], v[5]] : [...IDENTITY];
    };
    const parts: BrushArt["parts"] = [];
    const visit = (el: Element, m: Matrix) => {
      const here = multiply(m, matrixOfAttr(el));
      if (el.localName === "use") {
        const id = (el.getAttribute("xlink:href") || el.getAttribute("href") || "").replace(/^#/, "");
        const target = id ? svg.querySelector(`[id="${id}"]`) : null;
        if (target) visit(target, here);
        return;
      }
      if (el.localName === "path" && el.getAttribute("fill") && el.getAttribute("fill") !== "none") {
        parts.push({ color: el.getAttribute("fill")!.toUpperCase(), alpha: Number(el.getAttribute("fill-opacity") ?? 1), paths: svgPathToPaths(el.getAttribute("d") || "", here) });
        return;
      }
      if (el.localName === "defs") return;
      for (const kid of Array.from(el.children)) visit(kid, here);
    };
    visit(svg, [...IDENTITY]);
    return parts.length ? { width, height, parts } : null;
  } catch { return null; }
}
/** The artwork along the straight line from (x0, y0) to (x1, y1), keeping its proportions. */
function brushAlong(art: BrushArt, x0: number, y0: number, x1: number, y1: number): Array<{ style: Fill; paths: Path[] }> {
  const length = Math.hypot(x1 - x0, y1 - y0);
  if (length < 0.01) return [];
  const ux = (x1 - x0) / length, uy = (y1 - y0) / length;
  const thick = length * (art.height / art.width);
  const m: Matrix = [ux * (length / art.width), uy * (length / art.width), -uy * (thick / art.height), ux * (thick / art.height), 0, 0];
  m[4] = x0 + m[2] * (-art.height / 2);
  m[5] = y0 + m[3] * (-art.height / 2);
  return art.parts.map((part) => ({ style: { t: "solid", color: part.color, alpha: part.alpha }, paths: part.paths.map((p) => transformPath(p, m)) }));
}
const firstPoint = (path: Path): Point => [path[0][1] as number, path[0][2] as number];
const lastPoint = (path: Path): Point => { const c = path[path.length - 1]; return [c[c.length - 2] as number, c[c.length - 1] as number]; };

// ---------- eases (the same curves in the generated code and when baking shape tweens)
function easeFunction(ease: Ease | undefined): (t: number) => number {
  if (!ease) return (t) => t;
  if (ease.custom && ease.custom.length >= 4) {
    const p = ease.custom;
    return (x) => {
      for (let i = 0; i + 3 < p.length; i += 3) {
        if (x > p[i + 3][0] && i + 6 < p.length) continue;
        const [p0, p1, p2, p3] = [p[i], p[i + 1], p[i + 2], p[i + 3]];
        const bx = (u: number) => (1 - u) ** 3 * p0[0] + 3 * (1 - u) ** 2 * u * p1[0] + 3 * (1 - u) * u * u * p2[0] + u ** 3 * p3[0];
        let lo = 0, hi = 1;
        for (let k = 0; k < 30; k += 1) { const mid = (lo + hi) / 2; if (bx(mid) < x) lo = mid; else hi = mid; }
        const u = (lo + hi) / 2;
        return (1 - u) ** 3 * p0[1] + 3 * (1 - u) ** 2 * u * p1[1] + 3 * (1 - u) * u * u * p2[1] + u ** 3 * p3[1];
      }
      return x;
    };
  }
  const a = Math.max(-1, Math.min(1, -(ease.intensity || 0) / 100));
  if (!a) return (t) => t;
  return a < 0 ? (t) => t * (t * -a + 1 + a) : (t) => t * ((2 - t) * a + (1 - a));
}
const CREATEJS_EASES = ["quadIn", "quadOut", "quadInOut", "cubicIn", "cubicOut", "cubicInOut", "quartIn", "quartOut", "quartInOut", "quintIn", "quintOut", "quintInOut", "sineIn", "sineOut", "sineInOut", "backIn", "backOut", "backInOut", "circIn", "circOut", "circInOut", "bounceIn", "bounceOut", "bounceInOut", "elasticIn", "elasticOut", "elasticInOut"];
function easeArgument(ease: Ease | undefined): string {
  if (!ease) return "";
  if (ease.custom && ease.custom.length >= 4) return `,cbCustomEase(${JSON.stringify(ease.custom.map(([x, y]) => [r(x, 5), r(y, 5)]))})`;
  if (ease.method) {
    const name = CREATEJS_EASES.find((known) => known.toLowerCase() === ease.method!.toLowerCase().replace(/^ease/, ""));
    if (name) return `,cjs.Ease.${name}`;
  }
  const a = Math.max(-1, Math.min(1, -(ease.intensity || 0) / 100));
  return a ? `,cjs.Ease.get(${r(a, 2)})` : "";
}

// ---------- shape tweens (Animate's matched curves, drawn at t)
type Group = { fill?: Fill; stroke?: Stroke; paths: Path[] };
function frameStyles(elements: FlaElement[]) {
  const shapes = elements.filter((e): e is ShapeElement => e.k === "shape");
  const unique = <T,>(list: T[]) => { const seen = new Map<string, T>(); list.forEach((s) => { const k = JSON.stringify(s); if (!seen.has(k)) seen.set(k, s); }); return [...seen.values()]; };
  const scale = (m: Matrix) => Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) || 1;
  const byIndex = <T,>(record: Record<number, T>) => Object.keys(record).map(Number).sort((a, b) => a - b).map((k) => record[k]);
  return {
    fills: unique(shapes.flatMap((s) => byIndex(s.fillStyles))),
    strokes: unique(shapes.flatMap((s) => byIndex(s.strokeStyles).map((style) => ({ ...style, w: style.w * scale(s.m) })))),
  };
}
function morphGroups(frame: Keyframe, next: Keyframe, t: number, brushes: Map<string, BrushArt | null>): Group[] {
  const A = frameStyles(frame.elements), B = frameStyles(next.elements);
  const groups = new Map<string, { seg: NonNullable<Keyframe["morph"]>[number]; paths: Path[] }>();
  const lerp = (a: number, b: number) => a + (b - a) * t;
  for (const seg of frame.morph || []) {
    const path: Path = [["M", lerp(seg.a[0], seg.b[0]), lerp(seg.a[1], seg.b[1])]];
    for (const c of seg.curves) {
      const x = lerp(c[3], c[7]), y = lerp(c[4], c[8]);
      path.push(c[0] ? ["L", x, y] : ["Q", lerp(c[1], c[5]), lerp(c[2], c[6]), x, y]);
    }
    const key = `${seg.f1}|${seg.f2}|${seg.s1}|${seg.s2}`;
    if (!groups.has(key)) groups.set(key, { seg, paths: [] });
    groups.get(key)!.paths.push(path);
  }
  const out: Group[] = [];
  for (const { seg, paths } of groups.values()) {
    const fa = A.fills[seg.f1], fb = B.fills[seg.f2] || fa;
    if (fa) { out.push({ fill: mixFill(fa, fb, t), paths }); continue; }
    const sa = A.strokes[seg.s1], sb = B.strokes[seg.s2] || sa;
    if (!sa) continue;
    const art = sa.brush ? brushes.get(sa.brush) : null;
    if (art) { for (const p of paths) for (const g of brushAlong(art, ...firstPoint(p), ...lastPoint(p))) out.push({ fill: g.style, paths: g.paths }); continue; }
    const fill = sa.fill.t === "solid" && sb.fill.t === "solid" ? mixFill(sa.fill, sb.fill, t) : sa.fill;
    out.push({ stroke: { ...sa, w: lerp(sa.w, sb.w), fill }, paths });
  }
  return out;
}

// ---------- the writer
type ClassInfo = { name: string; item: string; type: string };
type Emit = { lines: string[]; names: Set<string>; counters: Record<string, number> };

/** skipped: what the chosen poses use that is not imported (text, sound…) or could not be read. */
export type WriteResult = { js: string; html: string; images: Array<{ path: string; data: Uint8Array }>; poseClasses: Record<string, string>; skipped: string[] };

/** documentName: the .html / .js file name (the library's character name when poses are split). */
export async function writeCreateJs(doc: FlaDocument, documentName: string, poses: PoseChoice[], compositionId: string): Promise<WriteResult> {
  const brushes = new Map<string, BrushArt | null>(Object.entries(doc.brushes).map(([id, b]) => [id, parseBrush(b)]));
  const skipped = new Set<string>();
  const included = new Set(poses.filter((p) => p.include).map((p) => p.item));

  // The stage, keeping only the chosen poses.
  const stage: Timeline = {
    ...doc.stage,
    layers: doc.stage.layers.map((layer) => ({ ...layer, frames: layer.frames.map((frame) => ({ ...frame, elements: frame.elements.filter((e) => e.k !== "instance" || !doc.symbols.has(e.item) || included.has(e.item) || frame.i > 0) })) })),
  };

  // Symbols and bitmaps reachable from the stage, and their class names.
  const taken = new Set<string>();
  const classes = new Map<string, ClassInfo>();
  const bitmapClasses = new Map<string, string>();
  const rootName = uniqueName(`${poseClassName(documentName) || "Character"}_Stage`, taken, "Character_Stage");
  const visit = (timeline: Timeline) => {
    for (const layer of timeline.layers) for (const frame of layer.frames) for (const el of frame.elements) {
      if (el.k === "instance") {
        const symbol = doc.symbols.get(el.item);
        if (!symbol) { skipped.add(`missing symbol ${displayName(el.item)}`); continue; }
        if (classes.has(el.item)) continue;
        classes.set(el.item, { name: uniqueName(plainName(el.item), taken, "Symbol"), item: el.item, type: symbol.type });
        visit(symbol.timeline);
      } else if (el.k === "bitmap" && !bitmapClasses.has(el.item)) bitmapClasses.set(el.item, uniqueName(plainName(el.item), taken, "Bitmap"));
    }
  };
  // Poses first, so they keep the names typed on import.
  const chosen = poses.filter((pose) => pose.include && doc.symbols.has(pose.item));
  // A pose keeps Animate's class name unless it was renamed.
  const poseBase = (pose: PoseChoice) => (pose.name.trim() === defaultPoseName(pose.item) ? plainName(pose.item) : poseClassName(pose.name));
  for (const pose of chosen) classes.set(pose.item, { name: uniqueName(poseBase(pose), taken, "Pose"), item: pose.item, type: "pose" });
  for (const pose of chosen) visit(doc.symbols.get(pose.item)!.timeline);
  visit(stage);
  for (const warning of doc.warnings) skipped.add(warning);
  for (const info of classes.values()) for (const warning of doc.symbols.get(info.item)?.warnings || []) skipped.add(warning);

  // Pictures: decoded to files in images/ and listed in the manifest (Animate's layout).
  const images: WriteResult["images"] = [];
  const bitmapSizes = new Map<string, [number, number]>();
  const binNumber = (name: string) => name.match(/(\d+)\s*$/)?.[1];
  for (const [item, className] of bitmapClasses) {
    const record = doc.bitmaps.get(item);
    let data = record?.data;
    if (!data && binNumber(item)) data = doc.binData.get(binNumber(item)!); // items missing from the document: "Bitmap 2" ↔ bin/M 2 ….dat
    const decoded = await decodeBitmap(data);
    if (!decoded) { skipped.add(`picture ${displayName(item)}`); continue; }
    images.push({ path: `images/${className}.${decoded.extension}`, data: decoded.bytes });
    bitmapSizes.set(item, [decoded.width, decoded.height]);
  }

  // Bounds at frame 0 (nominalBounds), children first.
  const bounds = new Map<string, Box | null>();
  const boundsOf = (item: string, stack: Set<string>): Box | null => {
    if (bounds.has(item)) return bounds.get(item)!;
    const symbol = doc.symbols.get(item);
    if (!symbol || stack.has(item)) return null;
    stack.add(item);
    const box = timelineBounds(symbol.timeline, stack);
    stack.delete(item);
    bounds.set(item, box);
    return box;
  };
  const elementBounds = (el: FlaElement, stack: Set<string>): Box | null => {
    if (el.k === "shape") {
      let box: Box | null = null;
      for (const f of el.fills) box = unionBox(box, pathsBox(f.paths, el.m));
      for (const s of el.strokes) box = unionBox(box, pathsBox(s.paths, el.m, s.style.w / 2));
      return box;
    }
    if (el.k === "instance") return transformBox(boundsOf(el.item, stack), el.m);
    const size = bitmapSizes.get(el.item);
    return size ? transformBox([0, 0, size[0], size[1]], el.m) : null;
  };
  const timelineBounds = (timeline: Timeline, stack: Set<string>): Box | null => {
    let box: Box | null = null;
    for (const layer of timeline.layers) {
      if (layer.type === "guide" || layer.type === "folder" || layer.type === "mask") continue;
      const frame = layer.frames.find((f) => f.i === 0);
      for (const el of frame?.elements || []) box = unionBox(box, elementBounds(el, stack));
    }
    return box;
  };
  const rect = (box: Box | null) => (box ? `new cjs.Rectangle(${r(box[0], 2)},${r(box[1], 2)},${r(box[2] - box[0], 2)},${r(box[3] - box[1], 2)})` : "null");

  // Mask outlines: every filled area of the mask layer's elements (symbols at their first frame).
  const maskPaths = (elements: FlaElement[], m: Matrix, depth: number): Path[] => {
    const out: Path[] = [];
    for (const el of elements) {
      if (el.k === "shape") { const mm = multiply(m, el.m); for (const f of el.fills) out.push(...f.paths.map((p) => transformPath(p, mm))); }
      else if (el.k === "instance" && depth < 8) {
        const symbol = doc.symbols.get(el.item);
        if (!symbol) continue;
        for (const layer of symbol.timeline.layers) {
          if (layer.type === "guide" || layer.type === "folder" || layer.type === "mask") continue;
          const at = el.symbolType === "movie clip" ? 0 : el.first;
          const frame = layer.frames.find((f) => at >= f.i && at < f.i + f.d);
          if (frame) out.push(...maskPaths(frame.elements, multiply(m, el.m), depth + 1));
        }
      }
    }
    return out;
  };

  // ----- one class body
  const counter = (emit: Emit, base: string) => {
    for (;;) {
      const n = emit.counters[base] = (emit.counters[base] ?? -1) + 1;
      const name = n ? `${base}_${n}` : base;
      if (!emit.names.has(name)) { emit.names.add(name); return name; }
    }
  };
  const IDENT = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
  const RESERVED_PROPS = new Set(["timeline", "mask", "children", "parent", "name", "id", "x", "y", "alpha", "visible", "mode", "loop", "paused", "shape", "instance", "frameBounds", "nominalBounds", "graphics"]);

  /** Shapes for one element group list; returns the property names created (bottom first). */
  const emitShapes = (emit: Emit, groups: Group[], m: Matrix, maskVar: string | null): string[] => {
    const names: string[] = [];
    for (const group of groups) {
      const box = pathsBox(group.paths);
      if (!box) continue;
      const cx = r((box[0] + box[2]) / 2, 2), cy = r((box[1] + box[3]) / 2, 2);
      const encoded = encodePaths(group.paths, cx, cy);
      if (!encoded) continue;
      const name = counter(emit, "shape");
      const paint = group.fill ? `${fillCommand(group.fill, cx, cy)}.s()` : strokeCommand(group.stroke!);
      emit.lines.push(`\tthis.${name} = new cjs.Shape();`);
      emit.lines.push(`\tthis.${name}.graphics.${paint}.p(${q(encoded)});`);
      const placed = multiply(m, [1, 0, 0, 1, cx, cy]);
      emit.lines.push(`\tthis.${name}.setTransform(${transformArgs(decompose(placed))});`);
      if (maskVar) emit.lines.push(`\tthis.${name}.mask = ${maskVar};`);
      emit.lines.push("");
      names.push(name);
    }
    return names;
  };
  const shapeGroups = (el: ShapeElement): Group[] => {
    const groups: Group[] = el.fills.map((f) => ({ fill: f.style, paths: f.paths }));
    for (const s of el.strokes) {
      const art = s.style.brush ? brushes.get(s.style.brush) : null;
      if (art) { for (const p of s.paths) for (const g of brushAlong(art, ...firstPoint(p), ...lastPoint(p))) groups.push({ fill: g.style, paths: g.paths }); }
      else groups.push({ stroke: s.style, paths: s.paths });
    }
    return groups;
  };
  const constructorArgs = (el: InstanceElement) => {
    if (el.symbolType !== "graphic") return "";
    switch (el.loop) {
      case "single frame": return `"single",${el.first}`;
      case "play once": return `"synched",${el.first},false`;
      case "loop reverse": return `"synched",${el.first},true,true`;
      case "play once reverse": return `"synched",${el.first},false,true`;
      default: return `"synched",${el.first}`;
    }
  };
  const emitInstance = (emit: Emit, el: InstanceElement, maskVar: string | null, tweened = false): string | null => {
    const info = classes.get(el.item);
    if (!info) return null;
    const name = el.name && IDENT.test(el.name) && !RESERVED_PROPS.has(el.name) && !emit.names.has(el.name) ? (emit.names.add(el.name), el.name) : counter(emit, "instance");
    emit.lines.push(`\tthis.${name} = new lib.${info.name}(${constructorArgs(el)});`);
    emit.lines.push(`\tthis.${name}.setTransform(${transformArgs(decompose(el.m, el.pivot), !tweened)});`);
    if (el.alpha != null && el.alpha < 1) emit.lines.push(`\tthis.${name}.alpha = ${r(el.alpha, 3)};`);
    if (maskVar) emit.lines.push(`\tthis.${name}.mask = ${maskVar};`);
    return name;
  };
  const emitBitmap = (emit: Emit, item: string, m: Matrix, maskVar: string | null): string | null => {
    const className = bitmapClasses.get(item);
    if (!className || !bitmapSizes.has(item)) return null;
    const name = counter(emit, "instance");
    emit.lines.push(`\tthis.${name} = new lib.${className}();`);
    if (!isIdentity(m)) emit.lines.push(`\tthis.${name}.setTransform(${transformArgs(decompose(m))});`);
    if (maskVar) emit.lines.push(`\tthis.${name}.mask = ${maskVar};`);
    return name;
  };
  const propsLiteral = (p: Props, extra: Record<string, number | boolean> = {}) => {
    const entries: Array<[string, number | boolean]> = [["x", r(p.x)], ["y", r(p.y)], ["scaleX", r(p.scaleX)], ["scaleY", r(p.scaleY)], ["skewX", r(p.skewX)], ["skewY", r(p.skewY)], ["regX", r(p.regX)], ["regY", r(p.regY)]];
    if (p.alpha != null) entries.push(["alpha", r(p.alpha, 3)]);
    for (const [k, v] of Object.entries(extra)) entries.push([k, v]);
    return `{${entries.map(([k, v]) => `${k}:${v}`).join(",")}}`;
  };
  const propsOf = (el: InstanceElement): Props => ({ ...decompose(el.m, el.pivot), alpha: el.alpha ?? 1 });
  /** End props of a classic tween, angles turned the way Animate turns them. */
  const tweenTarget = (from: Props, to: Props, rotate?: [string, number]): Props => {
    const turn = (a: number, b: number) => {
      let delta = b - a;
      while (delta > 180) delta -= 360;
      while (delta < -180) delta += 360;
      if (rotate?.[0] === "clockwise") { if (delta < 0) delta += 360; delta += 360 * rotate[1]; }
      if (rotate?.[0] === "counter-clockwise") { if (delta > 0) delta -= 360; delta -= 360 * rotate[1]; }
      if (rotate?.[0] === "none") delta = 0;
      return a + delta;
    };
    return { ...to, skewX: turn(from.skewX, to.skewX), skewY: turn(from.skewY, to.skewY) };
  };

  /** order: the order objects are created in (the library lists stage poses in that order); the
   *  stacking order stays the file's. */
  const emitLayer = (emit: Emit, layer: Layer, maskVar: string | null, tweenLines: string[], order?: (elements: FlaElement[]) => number[]) => {
    // Classic tween runs: keyframes with one instance that tween into the next keyframe's instance.
    const frames = layer.frames;
    const single = (f: Keyframe | undefined) => (f && f.elements.length === 1 && f.elements[0].k === "instance" ? f.elements[0] as InstanceElement : null);
    const inTrack = new Set<number>();
    type Segment = { start: number; dur: number; el: InstanceElement; to?: { el: InstanceElement; ease?: Ease; rotate?: [string, number] } };
    const tracks: Segment[][] = [];
    for (let k = 0; k < frames.length; k += 1) {
      if (inTrack.has(k)) continue;
      const el = single(frames[k]);
      if (!el || frames[k].tween !== "motion" || !classes.has(el.item)) continue;
      const track: Segment[] = [];
      let j = k;
      while (j < frames.length) {
        const here = single(frames[j]);
        if (!here || (track.length && here.item !== track[0].el.item)) break;
        const next = frames[j + 1];
        const nextEl = next && next.i === frames[j].i + frames[j].d ? single(next) : null;
        const segment: Segment = { start: frames[j].i, dur: frames[j].d, el: here };
        if (frames[j].tween === "motion" && nextEl) segment.to = { el: nextEl, ease: frames[j].ease, rotate: frames[j].rotate };
        track.push(segment);
        inTrack.add(j);
        if (!nextEl || nextEl.item !== here.item) break;
        j += 1;
      }
      tracks.push(track);
    }

    // Everything else is shown keyframe by keyframe (shape tweens frame by frame).
    const states: Array<{ start: number; dur: number; names: string[] }> = [];
    let end = 0;
    frames.forEach((frame, k) => {
      if (frame.i > end) states.push({ start: end, dur: frame.i - end, names: [] });
      end = frame.i + frame.d;
      if (inTrack.has(k)) { states.push({ start: frame.i, dur: frame.d, names: [] }); return; }
      const next = frames[k + 1];
      const morphing = frame.tween === "shape" && frame.morph && next && next.i === end;
      const created: string[][] = frame.elements.map(() => []);
      for (const index of order ? order(frame.elements) : frame.elements.map((_, i) => i)) {
        const el = frame.elements[index];
        if (el.k === "shape") created[index] = emitShapes(emit, shapeGroups(el), el.m, maskVar);
        else if (el.k === "instance") { const name = emitInstance(emit, el, maskVar); if (name) created[index] = [name]; }
        else { const name = emitBitmap(emit, el.item, el.m, maskVar); if (name) created[index] = [name]; }
      }
      const names = created.flat();
      if (!morphing) { states.push({ start: frame.i, dur: frame.d, names }); return; }
      states.push({ start: frame.i, dur: 1, names });
      const ease = easeFunction(frame.ease);
      for (let f = 1; f < frame.d; f += 1) {
        states.push({ start: frame.i + f, dur: 1, names: emitShapes(emit, morphGroups(frame, next!, ease(f / frame.d), brushes), IDENTITY, maskVar) });
      }
    });

    // Tween chains for the classic-tween objects.
    for (const track of tracks) {
      const first = track[0];
      const name = emitInstance(emit, first.el, maskVar, true);
      if (!name) continue;
      const graphic = first.el.symbolType === "graphic";
      let chain = `cjs.Tween.get(this.${name})`;
      if (first.start > 0) { emit.lines.push(`\tthis.${name}._off = true;`); chain += `.wait(${first.start}).to({_off:false},0)`; }
      track.forEach((segment, n) => {
        const from = propsOf(segment.el);
        if (n > 0) chain += `.to(${propsLiteral(from, graphic ? { startPosition: segment.el.first } : {})},0)`;
        if (segment.to) {
          // The end keyframe's pivot can differ: tween the start pivot to where the end matrix puts it.
          const endProps = { ...decompose(segment.to.el.m, segment.el.pivot), alpha: segment.to.el.alpha ?? 1 };
          chain += `.to(${propsLiteral(tweenTarget(from, endProps, segment.to.rotate))},${segment.dur}${easeArgument(segment.to.ease)})`;
        } else chain += `.wait(${segment.dur})`;
      });
      chain += ".to({_off:true},0)";
      emit.lines.push("");
      tweenLines.push(`\tthis.timeline.addTween(${chain});`);
    }

    if (states.some((s) => s.names.length)) {
      const literal = (names: string[]) => `[${names.map((n) => `{t:this.${n}}`).join(",")}]`;
      let chain = `cjs.Tween.get({}).to({state:${literal(states[0].names)}})`;
      for (let i = 1; i < states.length; i += 1) chain += `.to({state:${literal(states[i].names)}},${states[i - 1].dur})`;
      chain += `.wait(${states[states.length - 1].dur})`;
      tweenLines.push(`\tthis.timeline.addTween(${chain});`);
    }
  };

  const emitMask = (emit: Emit, layer: Layer): string => {
    const name = counter(emit, "mask");
    emit.lines.push(`\tvar ${name} = new cjs.Shape();`);
    emit.lines.push(`\t${name}._off = true;`);
    // Outline per frame: a keyframe's outline lasts its span; a shape tween changes it every frame.
    const outlines: Array<{ start: number; paths: Path[] }> = [];
    layer.frames.forEach((frame, k) => {
      const next = layer.frames[k + 1];
      outlines.push({ start: frame.i, paths: maskPaths(frame.elements, IDENTITY, 0) });
      if (frame.tween === "shape" && frame.morph && next && next.i === frame.i + frame.d) {
        const ease = easeFunction(frame.ease);
        for (let f = 1; f < frame.d; f += 1) outlines.push({ start: frame.i + f, paths: morphGroups(frame, next, ease(f / frame.d), brushes).flatMap((g) => (g.fill ? g.paths : [])) });
      }
    });
    const graphicsOf = (paths: Path[]) => {
      const box = pathsBox(paths);
      if (!box) return null;
      const cx = r((box[0] + box[2]) / 2, 2), cy = r((box[1] + box[3]) / 2, 2);
      return { code: `p(${q(encodePaths(paths, cx, cy))})`, cx, cy };
    };
    if (outlines.length === 1 && outlines[0].start === 0) {
      const g = graphicsOf(outlines[0].paths);
      if (g) { emit.lines.push(`\t${name}.graphics.${g.code};`); emit.lines.push(`\t${name}.setTransform(${g.cx},${g.cy});`); }
    } else {
      let chain = `cjs.Tween.get(${name})`;
      let at = 0;
      outlines.forEach((outline, i) => {
        const g = graphicsOf(outline.paths);
        const graphicsVar = `${name}_graphics_${outline.start}`;
        if (g) emit.lines.push(`\tvar ${graphicsVar} = new cjs.Graphics().${g.code};`);
        const props = g ? `{graphics:${graphicsVar},x:${g.cx},y:${g.cy}}` : "{graphics:null,x:0,y:0}";
        chain += i === 0 && outline.start === 0 ? `.to(${props})` : `.wait(${outline.start - at}).to(${props},0)`;
        at = outline.start;
      });
      emit.lines.push(`\tthis.timeline.addTween(${chain});`);
    }
    emit.lines.push("");
    return name;
  };

  /** The constructor body of a timeline: layers top first, each after its "// name" comment. */
  const emitTimeline = (timeline: Timeline, order?: (elements: FlaElement[]) => number[]): string[] => {
    const emit: Emit = { lines: [], names: new Set(), counters: {} };
    const masks = new Map<number, string>();
    timeline.layers.forEach((layer, index) => {
      if (layer.type === "folder" || layer.type === "guide" || !layer.frames.length) return;
      if (layer.type === "mask") {
        emit.lines.push(`\t// ${layer.name} (mask)`);
        masks.set(index, emitMask(emit, layer));
        return;
      }
      emit.lines.push(`\t// ${layer.name}`);
      const parent = layer.parent != null ? timeline.layers[layer.parent] : null;
      const maskVar = parent && parent.type === "mask" ? masks.get(layer.parent!) ?? null : null;
      const tweenLines: string[] = [];
      emitLayer(emit, layer, maskVar, tweenLines, order);
      emit.lines.push(...tweenLines, "");
    });
    return emit.lines;
  };
  const labelsOf = (timeline: Timeline) => {
    const labels: Record<string, number> = {};
    for (const layer of timeline.layers) for (const frame of layer.frames) if (frame.label) labels[frame.label] = frame.i;
    return JSON.stringify(labels).replace(/"([A-Za-z_$][\w$]*)":/g, "$1:");
  };
  const classCode = (name: string, item: string | null, timeline: Timeline, prototype: string, order?: (elements: FlaElement[]) => number[]) => [
    `(lib.${name} = function(mode,startPosition,loop,reversed) {`,
    "if (loop == null) { loop = true; }",
    "if (reversed == null) { reversed = false; }",
    "\tvar props = new Object();",
    "\tprops.mode = mode;",
    "\tprops.startPosition = startPosition;",
    `\tprops.labels = ${labelsOf(timeline)};`,
    "\tprops.loop = loop;",
    "\tprops.reversed = reversed;",
    "\tcjs.MovieClip.apply(this,[props]);",
    ...(item ? [`\t/* fla: ${displayName(item).replace(/\*\//g, "* /")} */`] : []),
    "",
    ...emitTimeline(timeline, order),
    "\tthis._renderFirstFrame();",
    "",
    `}).prototype = ${prototype};`,
  ].join("\n");

  // Stage poses are created in the order given (the library lists them so); other objects after.
  const poseRank = new Map(poses.map((pose, index) => [pose.item, index]));
  const rank = (el: FlaElement) => (el.k === "instance" && poseRank.has(el.item) ? poseRank.get(el.item)! : poses.length);
  const stageOrder = (elements: FlaElement[]) => elements.map((_, i) => i).sort((a, b) => rank(elements[a]) - rank(elements[b]) || a - b);

  // ----- the file
  const parts: string[] = [
    "(function (cjs, an) {",
    "",
    "var p; // shortcut to reference prototypes",
    "var lib={};var ss={};var img={};",
    "lib.ssMetadata = [];",
    "",
    "",
    "(lib.AnMovieClip = function(){",
    "\tthis.actionFrames = [];",
    "\tthis.ignorePause = false;",
    "}).prototype = p = new cjs.MovieClip();",
    "// symbols:",
    "",
  ];
  for (const [item, className] of bitmapClasses) {
    const size = bitmapSizes.get(item);
    if (!size) continue;
    parts.push(`(lib.${className} = function() {`, `\tthis.initialize(img.${className});`, "}).prototype = p = new cjs.Bitmap();", `p.nominalBounds = new cjs.Rectangle(0,0,${size[0]},${size[1]});`, "");
  }
  parts.push(
    "// helper functions:",
    "",
    "function mc_symbol_clone() {",
    "\tvar clone = this._cloneProps(new this.constructor(this.mode, this.startPosition, this.loop, this.reversed));",
    "\tclone.gotoAndStop(this.currentFrame);",
    "\tclone.paused = this.paused;",
    "\tclone.framerate = this.framerate;",
    "\treturn clone;",
    "}",
    "",
    "function getMCSymbolPrototype(symbol, nominalBounds, frameBounds) {",
    "\tvar prototype = cjs.extend(symbol, cjs.MovieClip);",
    "\tprototype.clone = mc_symbol_clone;",
    "\tprototype.nominalBounds = nominalBounds;",
    "\tprototype.frameBounds = frameBounds;",
    "\treturn prototype;",
    "}",
    "",
    "// Animate custom ease curves (cubic Bézier segments through (0,0) and (1,1)).",
    "function cbCustomEase(p) {",
    "\treturn function (x) {",
    "\t\tfor (var i = 0; i + 3 < p.length; i += 3) {",
    "\t\t\tif (x > p[i + 3][0] && i + 6 < p.length) continue;",
    "\t\t\tvar a = p[i], b = p[i + 1], c = p[i + 2], d = p[i + 3], lo = 0, hi = 1, u;",
    "\t\t\tfor (var k = 0; k < 30; k++) { u = (lo + hi) / 2; var v = 1 - u; if (v*v*v*a[0] + 3*v*v*u*b[0] + 3*v*u*u*c[0] + u*u*u*d[0] < x) lo = u; else hi = u; }",
    "\t\t\tu = (lo + hi) / 2; var w = 1 - u;",
    "\t\t\treturn w*w*w*a[1] + 3*w*w*u*b[1] + 3*w*u*u*c[1] + u*u*u*d[1];",
    "\t\t}",
    "\t\treturn x;",
    "\t};",
    "}",
    "",
  );
  for (const info of classes.values()) {
    const symbol = doc.symbols.get(info.item)!;
    parts.push(classCode(info.name, info.item, symbol.timeline, `getMCSymbolPrototype(lib.${info.name}, ${rect(boundsOf(info.item, new Set()))}, null)`), "", "");
  }
  parts.push(
    "// stage content:",
    classCode(rootName, null, stage, "p = new lib.AnMovieClip()", stageOrder),
    `p.nominalBounds = ${rect(timelineBounds(stage, new Set()))};`,
    "// library properties:",
    "lib.properties = {",
    `\tid: '${compositionId}',`,
    `\twidth: ${Math.round(doc.width)},`,
    `\theight: ${Math.round(doc.height)},`,
    `\tfps: ${r(doc.fps, 3)},`,
    `\tcolor: ${q(doc.background)},`,
    "\topacity: 1.00,",
    `\tmanifest: [${images.map((image) => `\n\t\t{src:${q(image.path)}, id:${q(image.path.replace(/^images\//, "").replace(/\.\w+$/, ""))}}`).join(",")}${images.length ? "\n\t" : ""}],`,
    "\tpreloads: []",
    "};",
    "",
    "// bootstrap callback support:",
    "",
    "(lib.Stage = function(canvas) {",
    "\tcreatejs.Stage.call(this, canvas);",
    "}).prototype = p = new createjs.Stage();",
    "",
    "an.bootcompsLoaded = an.bootcompsLoaded || [];",
    "if (!an.bootstrapListeners) an.bootstrapListeners = [];",
    "an.bootstrapCallback = function(callback) {",
    "\tan.bootstrapListeners.push(callback);",
    "\tfor (var i = 0; i < an.bootcompsLoaded.length; ++i) callback(an.bootcompsLoaded[i]);",
    "};",
    "an.compositions = an.compositions || {};",
    `an.compositions['${compositionId}'] = {`,
    "\tgetStage: function() { return exportRoot.stage; },",
    "\tgetLibrary: function() { return lib; },",
    "\tgetSpriteSheet: function() { return ss; },",
    "\tgetImages: function() { return img; }",
    "};",
    "an.compositionLoaded = function(id) {",
    "\tan.bootcompsLoaded.push(id);",
    "\tfor (var j = 0; j < an.bootstrapListeners.length; j++) an.bootstrapListeners[j](id);",
    "};",
    "an.getComposition = function(id) { return an.compositions[id]; };",
    "",
    "})(createjs = createjs||{}, AdobeAn = AdobeAn||{});",
    "var createjs, AdobeAn;",
    "",
  );

  const fileName = documentName;
  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="authoring-tool" content="CharacterBazaar Studio (.fla import)">
<title>${fileName.replace(/[<&]/g, "")}</title>
<script src="https://code.createjs.com/1.0.0/createjs.min.js"></script>
<script src="${encodeURI(fileName)}.js"></script>
<script>
var canvas, stage, exportRoot;
function init() {
	canvas = document.getElementById("canvas");
	var comp = AdobeAn.getComposition("${compositionId}");
	var lib = comp.getLibrary();
	var manifest = lib.properties.manifest;
	if (!manifest.length) { start(comp); return; }
	var loader = new createjs.LoadQueue(false);
	loader.addEventListener("fileload", function(evt) { if (evt.item.type == "image") comp.getImages()[evt.item.id] = evt.result; });
	loader.addEventListener("complete", function() { start(comp); });
	loader.loadManifest(manifest);
}
function start(comp) {
	var lib = comp.getLibrary();
	exportRoot = new lib.${rootName}();
	stage = new lib.Stage(canvas);
	stage.addChild(exportRoot);
	createjs.Ticker.framerate = lib.properties.fps;
	createjs.Ticker.addEventListener("tick", stage);
	AdobeAn.compositionLoaded(lib.properties.id);
}
</script>
</head>
<body onload="init();" style="margin:0px;">
	<canvas id="canvas" width="${Math.round(doc.width)}" height="${Math.round(doc.height)}" style="display: block; background-color:${doc.background};"></canvas>
</body>
</html>
`;
  const poseClasses: Record<string, string> = {};
  for (const pose of poses) if (pose.include && classes.has(pose.item)) poseClasses[pose.item] = classes.get(pose.item)!.name;
  return { js: parts.join("\n"), html, images, poseClasses, skipped: [...skipped] };
}
