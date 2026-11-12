"use client";

import { useEffect, useState } from "react";

/**
 * Hidden sharpness readout, shown only with ?cbdiag=1 in the editor's address. It reports what this
 * browser and screen actually do (pixel ratio, page zoom, the sharp rendering path, the first
 * character's drawing size against its size on screen) so a blurry setup can be diagnosed from one
 * screenshot.
 */
export type RenderDiagnosticsInfo = {
  stageZoom: number;
  cssZoom: boolean;
  screenDpr: number;
  browserZoomFactor: number;
  frame: HTMLIFrameElement | null;
  lastView: Record<string, unknown> | null;
};

type Row = [string, string];

const round = (value: number, digits = 3) => Math.round(value * 10 ** digits) / 10 ** digits;

function readRows(info: RenderDiagnosticsInfo): { rows: Row[]; verdict: string; ok: boolean } {
  const dpr = Number(window.devicePixelRatio || 1);
  const pageZoom = window.innerWidth > 0 && window.outerWidth > 0 ? window.outerWidth / window.innerWidth : 1;
  const chrome = /Chrome\/(\d+)/.exec(navigator.userAgent)?.[1];
  const rows: Row[] = [
    ["Browser", chrome ? `Chrome ${chrome}` : navigator.userAgent.slice(0, 60)],
    ["Screen", `${window.screen.width}×${window.screen.height} pt, pixel ratio ${round(dpr)}`],
    ["Page zoom (estimate)", `${Math.round(pageZoom * 100)}%`],
    ["Screen density used", `${round(info.screenDpr)}× · browser zoom factor ${round(info.browserZoomFactor)}`],
    ["Sharp method (CSS zoom)", info.cssZoom ? "on" : "OFF (older browser fallback)"],
    ["Stage zoom", `${round(info.stageZoom, 4)}`],
  ];
  const warnings: string[] = [];
  if (!info.cssZoom) warnings.push("This browser lacks standard CSS zoom (needs Chrome 128+): characters use the blurry fallback.");
  if (Math.abs(dpr - Math.round(dpr)) > 0.01) warnings.push(`Pixel ratio ${round(dpr)} is fractional: Chrome page zoom is probably not 100% (press ⌘0).`);
  let ok = info.cssZoom && warnings.length === 0;
  const frame = info.frame;
  const win = frame?.contentWindow as (Window & { stage?: unknown }) | null | undefined;
  const canvas = win?.document?.querySelector?.("canvas") as HTMLCanvasElement | null | undefined;
  if (!frame || !win || !canvas) {
    rows.push(["Character", "none loaded yet"]);
  } else {
    const innerDpr = Number(win.devicePixelRatio || 1);
    const box = canvas.getBoundingClientRect();
    const deviceW = box.width * innerDpr, deviceH = box.height * innerDpr;
    const view = info.lastView || {};
    rows.push(
      ["Character pixel ratio", `${round(innerDpr, 4)}`],
      ["Drawing", `${canvas.width}×${canvas.height} px`],
      ["Its space on screen", `${round(deviceW, 2)}×${round(deviceH, 2)} px`],
      ["View settings", `exact ${view.exact ? "yes" : "no"} · outline min ${view.minStroke ?? "–"} · seal ${view.seal ?? "–"}`],
    );
    const sizeOk = Math.abs(canvas.width - deviceW) < 1 && Math.abs(canvas.height - deviceH) < 1;
    if (!sizeOk) warnings.push("The drawing is not the size of its space on screen, so the browser resizes it (soft edges).");
    if (!view.exact && info.cssZoom) warnings.push("The character has not received the exact view yet.");
    ok = ok && sizeOk && !!view.exact;
  }
  const verdict = ok ? "✓ Characters are drawn 1:1 on this screen (sharp)." : warnings.join(" ") || "Checking…";
  return { rows, verdict, ok };
}

export default function RenderDiagnostics({ read }: { read: () => RenderDiagnosticsInfo }) {
  const [state, setState] = useState<{ rows: Row[]; verdict: string; ok: boolean } | null>(null);
  useEffect(() => {
    const update = () => { try { setState(readRows(read())); } catch { /* frame not ready */ } };
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [read]);
  if (!state) return null;
  return (
    <div className="cb-render-diagnostics" role="status">
      <strong>CB Studio sharpness check</strong>
      <p className={state.ok ? "ok" : "warn"}>{state.verdict}</p>
      <table><tbody>{state.rows.map(([name, value]) => <tr key={name}><th>{name}</th><td>{value}</td></tr>)}</tbody></table>
    </div>
  );
}
