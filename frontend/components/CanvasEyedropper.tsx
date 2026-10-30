"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useEscClose } from "@/lib/escClose";
import { getStageRenderer } from "@/lib/stageSnapshot";

/**
 * Eyedropper for the canvas: the scene is drawn once, sharp, at twice its size (characters from their
 * vectors), and a round magnifier (2.5× the view) follows the pointer smoothly — never blocky, unlike
 * the browser's screen eyedropper. Click picks the colour under the centre square; Esc cancels.
 */
const LOUPE = 116; // CSS px
const MAGNIFY = 2.5;

export default function CanvasEyedropper({ onPick, onCancel }: { onPick: (hex: string) => void; onCancel: () => void }) {
  useEscClose(true, onCancel);
  const loupeRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<{ canvas: HTMLCanvasElement } | null>(null);
  const [state, setState] = useState<"drawing" | "ready" | "unavailable">("drawing");
  const [pointer, setPointer] = useState<{ x: number; y: number; hex: string | null } | null>(null);

  useEffect(() => {
    const render = getStageRenderer();
    if (!render) { setState("unavailable"); return; }
    let cancelled = false;
    void (async () => {
      // Twice the project size: sharp for the 2.5× loupe at the usual zoom, and smooth beyond that.
      const canvas = await render(2);
      if (cancelled) return;
      if (!canvas) { setState("unavailable"); return; }
      sceneRef.current = { canvas };
      setState("ready");
    })();
    return () => { cancelled = true; };
  }, []);

  /** Where the pointer is on the drawn scene (px), or null outside the stage. */
  const sceneAt = (clientX: number, clientY: number) => {
    const scene = sceneRef.current;
    const stage = document.querySelector(".cb-stage-world")?.getBoundingClientRect();
    if (!scene || !stage || clientX < stage.left || clientY < stage.top || clientX > stage.right || clientY > stage.bottom) return null;
    const perCss = scene.canvas.width / stage.width;
    return { x: (clientX - stage.left) * perCss, y: (clientY - stage.top) * perCss, perCss };
  };
  const colourAt = (x: number, y: number) => {
    const context = sceneRef.current?.canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return null;
    const [r, g, b] = context.getImageData(Math.max(0, Math.floor(x)), Math.max(0, Math.floor(y)), 1, 1).data;
    return `#${[r, g, b].map((value) => value.toString(16).padStart(2, "0")).join("")}`;
  };

  useEffect(() => {
    if (state !== "ready" || !pointer) return;
    const loupe = loupeRef.current;
    const scene = sceneRef.current;
    const at = sceneAt(pointer.x, pointer.y);
    if (!loupe || !scene || !at) return;
    const dpr = window.devicePixelRatio || 1;
    loupe.width = Math.round(LOUPE * dpr);
    loupe.height = Math.round(LOUPE * dpr);
    const context = loupe.getContext("2d");
    if (!context) return;
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    const span = (LOUPE / MAGNIFY) * at.perCss; // scene px shown across the loupe
    context.fillStyle = "#fff";
    context.fillRect(0, 0, loupe.width, loupe.height);
    context.drawImage(scene.canvas, at.x - span / 2, at.y - span / 2, span, span, 0, 0, loupe.width, loupe.height);
  }, [pointer, state]);

  const move = (clientX: number, clientY: number) => {
    const at = sceneAt(clientX, clientY);
    setPointer({ x: clientX, y: clientY, hex: at ? colourAt(at.x, at.y) : null });
  };

  return createPortal(
    <div className={`cb-eyedropper ${state}`} data-text-ui
      onPointerMove={(event) => move(event.clientX, event.clientY)}
      onPointerDown={(event) => {
        event.preventDefault();
        event.stopPropagation();
        if (state !== "ready") return;
        const at = sceneAt(event.clientX, event.clientY);
        const hex = at ? colourAt(at.x, at.y) : null;
        if (hex) onPick(hex);
      }}>
      {state === "drawing" && <div className="cb-eyedropper-note">Getting the canvas ready…</div>}
      {state === "unavailable" && <div className="cb-eyedropper-note">The eyedropper works on the canvas of an open scene. Esc to close.</div>}
      {state === "ready" && <div className="cb-eyedropper-note">Click a colour on the canvas · Esc to cancel</div>}
      {state === "ready" && pointer?.hex && (
        <div className="cb-eyedropper-loupe" style={{ left: pointer.x, top: pointer.y }}>
          <canvas ref={loupeRef} aria-hidden="true" />
          <i aria-hidden="true" />
          <span style={{ background: pointer.hex }} />
          <b>{pointer.hex}</b>
        </div>
      )}
    </div>,
    document.body,
  );
}
