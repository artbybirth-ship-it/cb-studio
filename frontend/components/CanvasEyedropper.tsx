"use client";

import { useEffect, useRef, useState, type MutableRefObject, type RefObject } from "react";
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

type Scene = { canvas: HTMLCanvasElement };
type Pointer = { x: number; y: number; hex: string | null };

/** Where the pointer is on the drawn scene (px), or null outside the stage. */
const sceneAt = (scene: Scene | null, clientX: number, clientY: number) => {
  const stage = document.querySelector(".cb-stage-world")?.getBoundingClientRect();
  if (!scene || !stage || clientX < stage.left || clientY < stage.top || clientX > stage.right || clientY > stage.bottom) return null;
  const perCss = scene.canvas.width / stage.width;
  return { x: (clientX - stage.left) * perCss, y: (clientY - stage.top) * perCss, perCss };
};
const colourAt = (scene: Scene | null, x: number, y: number) => {
  const context = scene?.canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return null;
  const [r, g, b] = context.getImageData(Math.max(0, Math.floor(x)), Math.max(0, Math.floor(y)), 1, 1).data;
  return `#${[r, g, b].map((value) => value.toString(16).padStart(2, "0")).join("")}`;
};
const sampleAt = (scene: Scene | null, clientX: number, clientY: number) => {
  const at = sceneAt(scene, clientX, clientY);
  return at ? colourAt(scene, at.x, at.y) : null;
};

/** The scene drawn once for sampling. */
function useStageScene() {
  const sceneRef = useRef<Scene | null>(null);
  const [state, setState] = useState<"drawing" | "ready" | "unavailable">("drawing");
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
  return { sceneRef, state };
}

/** The colour at a point on the stage, read from the scene drawn at the playhead (Colour Dropper). */
export async function sampleStageColour(clientX: number, clientY: number): Promise<string | null> {
  const canvas = await getStageRenderer()?.(1);
  return canvas ? sampleAt({ canvas }, clientX, clientY) : null;
}

function useLoupeDrawing(loupeRef: RefObject<HTMLCanvasElement | null>, sceneRef: MutableRefObject<Scene | null>, pointer: Pointer | null, ready: boolean) {
  useEffect(() => {
    if (!ready || !pointer) return;
    const loupe = loupeRef.current;
    const scene = sceneRef.current;
    const at = sceneAt(scene, pointer.x, pointer.y);
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
  }, [pointer, ready]); // eslint-disable-line react-hooks/exhaustive-deps
}

function Loupe({ pointer, loupeRef }: { pointer: Pointer; loupeRef: RefObject<HTMLCanvasElement | null> }) {
  return (
    <div className="cb-eyedropper-loupe" style={{ left: pointer.x, top: pointer.y }}>
      <canvas ref={loupeRef} aria-hidden="true" />
      <i aria-hidden="true" />
      <span style={{ background: pointer.hex || "transparent" }} />
      <b>{pointer.hex}</b>
    </div>
  );
}

export default function CanvasEyedropper({ onPick, onCancel }: { onPick: (hex: string) => void; onCancel: () => void }) {
  useEscClose(true, onCancel);
  const loupeRef = useRef<HTMLCanvasElement>(null);
  const { sceneRef, state } = useStageScene();
  const [pointer, setPointer] = useState<Pointer | null>(null);
  useLoupeDrawing(loupeRef, sceneRef, pointer, state === "ready");

  return createPortal(
    <div className={`cb-eyedropper ${state}`} data-text-ui
      onPointerMove={(event) => setPointer({ x: event.clientX, y: event.clientY, hex: sampleAt(sceneRef.current, event.clientX, event.clientY) })}
      onPointerDown={(event) => {
        event.preventDefault();
        event.stopPropagation();
        if (state !== "ready") return;
        const hex = sampleAt(sceneRef.current, event.clientX, event.clientY);
        if (hex) onPick(hex);
      }}>
      {state === "drawing" && <div className="cb-eyedropper-note">Getting the canvas ready…</div>}
      {state === "unavailable" && <div className="cb-eyedropper-note">The eyedropper works on the canvas of an open scene. Esc to close.</div>}
      {state === "ready" && <div className="cb-eyedropper-note">Click a colour on the canvas · Esc to cancel</div>}
      {state === "ready" && pointer?.hex && <Loupe pointer={pointer} loupeRef={loupeRef} />}
    </div>,
    document.body,
  );
}
