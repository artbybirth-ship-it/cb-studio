"use client";

/**
 * A placed character drawn natively: its pose's own layers and keyframes, with the edits made in
 * the native editor (object.nativePose) laid over them, on a canvas that covers the character's
 * box exactly as its Animate player does. The scene editor uses this; the video renderer uses the
 * same drawing (lib/native/character.ts) from its own page, so a pasted head, retimed frames or a
 * moved part shows in playback and in the exported video.
 *
 * The character's colour rules (Recolour panel) are drawn here too (lib/native/colour.ts). Limit for now:
 * part-transform edits made with the old tools are applied by the Animate player and are not drawn here.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { EditorObject } from "@/types";
import { createNativeCharacter, playerFitOf, type Fit, type NativeCharacter } from "@/lib/native/character";

/** How many native characters are still loading: the render page waits for zero before it starts. */
const pending = (delta: number) => {
  const w = window as unknown as { __CBS_NATIVE_PENDING__?: number };
  w.__CBS_NATIVE_PENDING__ = Math.max(0, (w.__CBS_NATIVE_PENDING__ || 0) + delta);
};

export default function NativeCharacterCanvas({ object, seekMs, hueFilter, onCanvas, onReady, playerFrame, playerReady, savedFit }: {
  object: EditorObject;
  /** Source time to show, in ms (the same number the player is sent). */
  seekMs: number;
  hueFilter?: string;
  onCanvas?: (id: string, canvas: HTMLCanvasElement | null) => void;
  /** Told when the native drawing is ready to replace the player's. */
  onReady?: (id: string, ready: boolean) => void;
  /** The character's Animate player: the pose is placed exactly where the player placed it. */
  playerFrame?: () => HTMLIFrameElement | null | undefined;
  /** True once that player is running (draws again then, with its placement). */
  playerReady?: boolean;
  /** The placement saved with the edits, used until (or without) the player. */
  savedFit?: Fit | null;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [character, setCharacter] = useState<NativeCharacter | null>(null);
  const nativePose = object.nativePose;
  const assetUrl = object.assetUrl;
  const loopMode = object.loopMode;
  const made = useMemo(() => createNativeCharacter({ assetUrl, loopMode, nativePose }), [assetUrl, loopMode, nativePose]);

  useEffect(() => {
    let alive = true;
    pending(1);
    made.load().then((ok) => { if (alive && ok) setCharacter(made); }).catch(() => { /* the player's own drawing stays */ }).finally(() => pending(-1));
    // The drawing on screen stays until the new one is ready, so an edit never flashes the player's original.
    return () => { alive = false; };
  }, [made]);

  useEffect(() => {
    onReady?.(object.id, Boolean(character));
    return () => onReady?.(object.id, false);
  }, [character, object.id, onReady]);
  useEffect(() => {
    onCanvas?.(object.id, canvas.current);
    return () => onCanvas?.(object.id, null);
  }, [character, object.id, onCanvas]);

  const rulesKey = JSON.stringify(object.colorReplacements || []);
  useEffect(() => {
    const el = canvas.current;
    if (el && character) character.setColourRules(object.colorReplacements);
    if (el && character) character.draw(el, seekMs, Math.min(2, window.devicePixelRatio || 1), playerFitOf(playerFrame?.()) ?? savedFit ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [character, seekMs, playerReady, rulesKey]);

  return (
    <canvas ref={canvas} width={720} height={960} data-native-character={object.id} className="cb-native-character-canvas"
      style={{ filter: hueFilter, visibility: character ? "visible" : "hidden" }} />
  );
}
