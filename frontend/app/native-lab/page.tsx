"use client";

/**
 * Native renderer lab (Phase 1): open an .fla, pick a pose, scrub or play it. Everything on screen
 * comes from lib/native/render.ts reading the document's own layers and keyframes — no Animate
 * player. A scratch page for checking the native model; the editor does not use it yet.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { readFla, type FlaDocument } from "../../lib/fla/xfl";
import { stagePoses } from "../../lib/fla/createjsWriter";
import { decodeBitmap } from "../../lib/fla/bitmaps";
import { NativeRenderer } from "../../lib/native/render";
import { matchShapes } from "../../lib/native/shapeTween";
import NativePoseEditor from "../../components/NativePoseEditor";

type Loaded = { doc: FlaDocument; renderer: NativeRenderer; poses: ReturnType<typeof stagePoses> };

type PubWindow = Window & { AdobeAn?: { getComposition(id: string): { getLibrary(): Record<string, unknown> } }; createjs?: { Stage: new (c: HTMLCanvasElement) => { scaleX: number; scaleY: number; tickOnUpdate: boolean; addChild(x: unknown): void; update(): void } } };

/** Draws the whole stage at each frame with the native renderer and with Animate's own publish
 *  (CreateJS), and reports how many visible pixels differ. */
async function compareWithPublish(loaded: Loaded, js: string, frames: number[], shrink = 0.5) {
  const id = js.match(/an\.compositions\['([0-9A-F]+)'\]/i)?.[1];
  if (!id) throw new Error("not an Animate publish (.js)");
  const url = URL.createObjectURL(new Blob([js], { type: "text/javascript" }));
  const iframe = document.createElement("iframe");
  iframe.style.cssText = "position:fixed;left:-10000px;width:10px;height:10px;visibility:hidden";
  const ready = new Promise<void>((resolve) => { iframe.onload = () => resolve(); });
  iframe.srcdoc = `<!doctype html><html><head><script src="/vendor/createjs"></script><script src="${url}"></script></head><body></body></html>`;
  document.body.appendChild(iframe);
  await ready;
  try {
    const win = iframe.contentWindow as PubWindow;
    const lib = win.AdobeAn!.getComposition(id).getLibrary() as Record<string, new () => { gotoAndStop(f: number): void; advance(): void; paused: boolean }> & { properties: { width: number; height: number } };
    const w = Math.round(lib.properties.width * shrink), h = Math.round(lib.properties.height * shrink);
    const out: Array<{ frame: number; differ: number; ink: number; percent: number }> = [];
    for (const frame of frames) {
      const a = document.createElement("canvas"), b = win.document.createElement("canvas");
      a.width = b.width = w; a.height = b.height = h;
      const stage = new win.createjs!.Stage(b);
      stage.scaleX = stage.scaleY = shrink;
      stage.tickOnUpdate = false;
      const root = new lib[loaded.doc.name]();
      stage.addChild(root);
      const ticker = stage as unknown as { tick(props: object): void };
      for (let k = 0; k < frame; k += 1) ticker.tick({ paused: false, delta: 1000 / loaded.doc.fps });
      stage.update();
      const ctx = a.getContext("2d")!;
      ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, w, h);
      ctx.scale(shrink, shrink);
      loaded.renderer.drawTimeline(ctx, loaded.doc.stage, frame);
      const flat = (c: HTMLCanvasElement) => { const t = document.createElement("canvas"); t.width = w; t.height = h; const x = t.getContext("2d")!; x.fillStyle = "#fff"; x.fillRect(0, 0, w, h); x.drawImage(c, 0, 0); return x.getImageData(0, 0, w, h).data; };
      const da = flat(a), db = flat(b as unknown as HTMLCanvasElement);
      let differ = 0, ink = 0;
      for (let i = 0; i < da.length; i += 4) {
        const inkA = da[i] < 250 || da[i + 1] < 250 || da[i + 2] < 250, inkB = db[i] < 250 || db[i + 1] < 250 || db[i + 2] < 250;
        if (inkA || inkB) ink += 1;
        if (Math.abs(da[i] - db[i]) > 40 || Math.abs(da[i + 1] - db[i + 1]) > 40 || Math.abs(da[i + 2] - db[i + 2]) > 40) differ += 1;
      }
      out.push({ frame, differ, ink, percent: ink ? Math.round((differ / ink) * 10000) / 100 : 0 });
      const copy = document.createElement("canvas");
      copy.width = w; copy.height = h;
      copy.getContext("2d")!.drawImage(b as unknown as HTMLCanvasElement, 0, 0);
      const w2 = window as unknown as { __cmp?: Array<{ native: HTMLCanvasElement; publish: HTMLCanvasElement }> };
      (w2.__cmp ||= []).push({ native: a, publish: copy });
    }
    return out;
  } finally { iframe.remove(); URL.revokeObjectURL(url); }
}

/** One shape-tween layer drawn at the middle of the keyframe, on its own 400 px canvas (null when empty). */
type Framing = { x0: number; x1: number; y0: number; y1: number };
function framingOf(key: import("../../lib/fla/xfl").Keyframe): Framing | null {
  const pts = (key.morph || []).flatMap((m) => [m.a, m.b, ...m.curves.map((c): [number, number] => [c[3], c[4]]), ...m.curves.map((c): [number, number] => [c[7], c[8]])]);
  if (!pts.length) return null;
  return { x0: Math.min(...pts.map((p) => p[0])), x1: Math.max(...pts.map((p) => p[0])), y0: Math.min(...pts.map((p) => p[1])), y1: Math.max(...pts.map((p) => p[1])) };
}
function drawTween(renderer: NativeRenderer, layer: import("../../lib/fla/xfl").Layer, key: import("../../lib/fla/xfl").Keyframe, framing: Framing | null): ImageData | null {
  if (!framing) return null;
  const { x0, x1, y0, y1 } = framing;
  const size = 400, scale = Math.min(1, (size * 0.8) / Math.max(x1 - x0, y1 - y0, 1));
  const canvas = new OffscreenCanvas(size, size), ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.setTransform(scale, 0, 0, scale, size / 2 - ((x0 + x1) / 2) * scale, size / 2 - ((y0 + y1) / 2) * scale);
  renderer.drawTimeline(ctx, { name: "", layers: [{ ...layer, frames: layer.frames }], length: key.i + key.d + 1 }, key.i + Math.floor(key.d / 2));
  return ctx.getImageData(0, 0, size, size);
}
/** Percent of pixels with ink in either picture that differ clearly. */
function inkDiff(a: ImageData, b: ImageData): number {
  let ink = 0, diff = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    const ia = a.data[i + 3] > 20, ib = b.data[i + 3] > 20;
    if (ia || ib) ink += 1;
    if (ia !== ib || Math.abs(a.data[i] - b.data[i]) > 40 || Math.abs(a.data[i + 1] - b.data[i + 1]) > 40 || Math.abs(a.data[i + 2] - b.data[i + 2]) > 40) diff += 1;
  }
  return ink ? (diff / ink) * 100 : 0;
}

export default function NativeLab() {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [status, setStatus] = useState("Choose an .fla file");
  const [pose, setPose] = useState("");
  const [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);

  const [report, setReport] = useState("");
  const [editing, setEditing] = useState(false);
  async function compare(file: File) {
    if (!loaded) return;
    setReport("Comparing…");
    try {
      const frames = [0, 6, 12, 24, 36, 48, 60, 72, 96, 120, 150, 179];
      const rows = await compareWithPublish(loaded, await file.text(), frames);
      setReport(rows.map((r) => `frame ${r.frame}: ${r.percent}% of ${r.ink} px differ`).join("\n"));
    } catch (error) { setReport(error instanceof Error ? error.message : String(error)); }
  }

  /** Replaces Animate's matched curves of every shape tween with the ones lib/native/shapeTween.ts works out. */
  function rematchAll(): string {
    if (!loaded) return "";
    const visual: number[] = [];
    const pairs: Array<{ d: number; name: string; before: ImageData; after: ImageData }> = [];
    (window as unknown as { __pairs?: typeof pairs }).__pairs = pairs;
    let worstVisual = { d: 0, name: "", layer: "", at: 0 };
    let count = 0, skipped = 0, segDiff = 0, curveDiff = 0, oldSegs = 0, newSegs = 0, maxMove = 0;
    const started = performance.now();
    for (const [symbolName, symbol] of loaded.doc.symbols) {
      for (const layer of symbol.timeline.layers) {
        layer.frames.forEach((key, i) => {
          const next = layer.frames[i + 1];
          if (key.tween !== "shape" || !key.morph || !next || next.i !== key.i + key.d) { if (key.tween === "shape") skipped += 1; return; }
          const fresh = matchShapes(key.elements, next.elements);
          oldSegs += key.morph.length; newSegs += fresh.length;
          if (fresh.length !== key.morph.length) segDiff += 1;
          // how far the halfway outline moves between Animate's curves and ours (px, anchors only)
          const old = key.morph.flatMap((m) => m.curves.map((c) => [(c[3] + c[7]) / 2, (c[4] + c[8]) / 2]));
          const neu = fresh.flatMap((m) => m.curves.map((c) => [(c[3] + c[7]) / 2, (c[4] + c[8]) / 2]));
          if (old.length === neu.length) { const d = old.reduce((a, p, j) => a + Math.hypot(p[0] - neu[j][0], p[1] - neu[j][1]), 0) / (old.length || 1); maxMove = Math.max(maxMove, d); curveDiff += d > 0.5 ? 1 : 0; }
          const framing = framingOf(key);
          const before = drawTween(loaded.renderer, layer, key, framing);
          const oldMorph = key.morph;
          key.morph = fresh;
          const after = drawTween(loaded.renderer, layer, key, framing);
          if (before && after) { const d = inkDiff(before, after); visual.push(d); if (d > 10 && pairs.length < 6 && count % 7 === 0) pairs.push({ d, name: symbolName, before, after }); if (d > worstVisual.d) worstVisual = { d, name: symbolName, layer: layer.name, at: key.i }; }
          void oldMorph;
          count += 1;
        });
      }
    }
    const text = `re-matched ${count} shape tweens (${skipped} skipped; segment count differs in ${segDiff}, halfway outline moves >0.5px in ${curveDiff}, worst mean move ${maxMove.toFixed(1)}px; segments ${oldSegs}→${newSegs}; picture at the tween's middle: ${visual.filter((d) => d > 2).length} of ${visual.length} differ by >2% of ink, ${visual.filter((d) => d > 10).length} by >10%, worst ${(worstVisual.d).toFixed(1)}% in ${worstVisual.name} / ${worstVisual.layer} @${worstVisual.at}) in ${Math.round(performance.now() - started)} ms`;
    setReport(text);
    return text;
  }
  useEffect(() => { (window as unknown as { __rematch?: () => string }).__rematch = rematchAll; });

  const length = useMemo(() => (loaded && pose ? loaded.doc.symbols.get(pose)?.timeline.length || 1 : 1), [loaded, pose]);

  async function open(file: File) {
    setStatus("Reading…");
    setLoaded(null);
    try {
      const doc = await readFla(file, file.name, (f) => setStatus(`Reading ${Math.round(f * 100)}%`));
      const images = new Map<string, HTMLCanvasElement | ImageBitmap>();
      for (const [name, item] of doc.bitmaps) {
        const decoded = await decodeBitmap(item.data);
        if (decoded) images.set(name, await createImageBitmap(new Blob([decoded.bytes as BlobPart])));
      }
      const renderer = new NativeRenderer(doc, { images: images as never });
      await renderer.loadBrushes();
      const poses = stagePoses(doc);
      setLoaded({ doc, renderer, poses });
      setPose(poses[0]?.item || "");
      setFrame(0);
      setStatus(`${doc.name}: stage ${doc.stage.length} frames (${doc.stage.layers.map((l) => l.frames.map((k) => k.i + "+" + k.d).join(",")).join(" | ")}), ${poses.length} poses, ${doc.symbols.size} symbols, ${doc.fps} fps`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  useEffect(() => {
    const el = canvas.current;
    if (!el || !loaded || !pose) return;
    const ctx = el.getContext("2d")!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, el.width, el.height);
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, el.width, el.height);
    // Fit the pose's first-frame size to the canvas: poses are modelled around their own origin.
    const { doc } = loaded;
    const scale = Math.min(el.width / doc.width, el.height / doc.height) * 0.9;
    ctx.setTransform(scale, 0, 0, scale, el.width / 2, el.height / 2);
    loaded.renderer.stats.missing.clear();
    const started = performance.now();
    loaded.renderer.drawSymbol(ctx, pose, frame);
    const ms = performance.now() - started;
    const s = loaded.renderer.stats;
    el.dataset.ms = ms.toFixed(1);
    el.dataset.missing = [...s.missing].join("|");
  }, [loaded, pose, frame]);

  useEffect(() => {
    if (!playing || !loaded) return;
    const timer = window.setInterval(() => setFrame((f) => (f + 1) % length), 1000 / loaded.doc.fps);
    return () => window.clearInterval(timer);
  }, [playing, loaded, length]);

  return (
    <main style={{ padding: 16, font: "14px system-ui", display: "grid", gap: 12 }}>
      <h1 style={{ fontSize: 18, margin: 0 }}>Native renderer lab</h1>
      <input type="file" accept=".fla" onChange={(e) => e.target.files?.[0] && open(e.target.files[0])} />
      <div>{status}</div>
      {loaded && <button data-testid="toggle-editor" onClick={() => setEditing((e) => !e)}>{editing ? "Back to viewer" : "Open native editor"}</button>}
      {loaded && <button onClick={rematchAll}>Re-match all shape tweens</button>}
      {loaded && <label>Compare with Animate publish (.js): <input type="file" accept=".js" onChange={(e) => e.target.files?.[0] && compare(e.target.files[0])} /></label>}
      {report && <pre id="report" style={{ margin: 0 }}>{report}</pre>}
      {loaded && (
        <>
          <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
            <select value={pose} onChange={(e) => { setPose(e.target.value); setFrame(0); }}>
              {loaded.poses.map((p) => <option key={p.item} value={p.item}>{p.name}</option>)}
            </select>
            <button onClick={() => setPlaying((p) => !p)}>{playing ? "Pause" : "Play"}</button>
            <input type="range" min={0} max={length - 1} value={frame} onChange={(e) => setFrame(Number(e.target.value))} style={{ width: 360 }} />
            <span>frame {frame + 1} / {length}</span>
          </div>
          {editing && <NativePoseEditor doc={loaded.doc} renderer={loaded.renderer} poses={loaded.poses} />}
          {!editing && <canvas ref={canvas} width={1100} height={800} style={{ border: "1px solid #ccc", width: 825, height: 600 }} />}
        </>
      )}
    </main>
  );
}
