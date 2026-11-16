"use client";

/**
 * A placed character drawn natively: its pose's own layers and keyframes, with the edits made in
 * the native editor (object.nativePose) laid over them, on a canvas that covers the character's
 * box exactly as its Animate player does. The scene editor uses this; the video renderer uses the
 * same drawing (lib/native/character.ts) from its own page, so a pasted head, retimed frames or a
 * moved part shows in playback and in the exported video.
 *
 * The character's colour rules (Recolour panel), the part tools' edits, part layers and variant swaps are drawn here too. A character
 * with no native edits is drawn here by default when its Animate file is available and nothing on it is drawn only by the player
 * (lib/native/character.ts drawsNatively / covers); otherwise its player stays.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { EditorObject } from "@/types";
import type { PartEdit } from "@/lib/native/render";
import { createNativeCharacter, hasNativePose, playerFitOf, type CoverageSource, type Fit, type NativeCharacter } from "@/lib/native/character";

/** How many native characters are still loading: the render page waits for zero before it starts. */
const pending = (delta: number) => {
  const w = window as unknown as { __CBS_NATIVE_PENDING__?: number };
  w.__CBS_NATIVE_PENDING__ = Math.max(0, (w.__CBS_NATIVE_PENDING__ || 0) + delta);
};

export default function NativeCharacterCanvas({ object, seekMs, hueFilter, onCanvas, onHandle, onReady, playerFrame, playerReady, savedFit, partEdits, standDown }: {
  object: EditorObject;
  /** The part tools' edits at the playhead (lib/partKeyframes.ts resolvePartOverridesAtTime): drawn over the pose. */
  partEdits?: Record<string, PartEdit>;
  /** Source time to show, in ms (the same number the player is sent). */
  seekMs: number;
  hueFilter?: string;
  onCanvas?: (id: string, canvas: HTMLCanvasElement | null) => void;
  /** The drawing itself once it is ready: the colour tools ask it for colours (what the Animate player's colour finder does for a player). */
  onHandle?: (id: string, handle: NativeCharacter | null) => void;
  /** Told when the native drawing is ready to replace the player's. */
  onReady?: (id: string, ready: boolean) => void;
  /** The character's Animate player: the pose is placed exactly where the player placed it. */
  playerFrame?: () => HTMLIFrameElement | null | undefined;
  /** True once that player is running (draws again then, with its placement). */
  playerReady?: boolean;
  /** The placement saved with the edits, used until (or without) the player. */
  savedFit?: Fit | null;
  /** The player is shown instead for now (part editing on a character with no native edits: the player draws the drag and the picked part). */
  standDown?: boolean;
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

  // A character with no native edits is drawn natively only while the drawing shows it as its player does (Phase 6: drawn natively by
  // default), and only once the player's own placement is known, so switching over never moves it. Native edits are always drawn.
  const ownPose = hasNativePose(object);
  const covered = Boolean(character && character.covers(object as CoverageSource));
  const fitNow = playerFitOf(playerFrame?.()) ?? savedFit ?? null;
  const placed = ownPose || Boolean(fitNow);
  const ready = covered && placed;
  useEffect(() => {
    onReady?.(object.id, ready);
    return () => onReady?.(object.id, false);
  }, [ready, object.id, onReady]);
  useEffect(() => {
    onHandle?.(object.id, character);
    return () => onHandle?.(object.id, null);
  }, [character, object.id, onHandle]);
  useEffect(() => {
    onCanvas?.(object.id, canvas.current);
    return () => onCanvas?.(object.id, null);
  }, [character, object.id, onCanvas]);

  const rulesKey = JSON.stringify(object.colorReplacements || []);
  const partsKey = JSON.stringify(partEdits || {}) + JSON.stringify(object.onlyParts || []);
  useEffect(() => {
    const el = canvas.current;
    if (el && character) character.setColourRules(object.colorReplacements);
    if (el && character) character.setPartEdits(partEdits);
    if (el && character) character.setOnlyParts(object.onlyParts);
    if (el && character && ready) character.draw(el, seekMs, Math.min(2, window.devicePixelRatio || 1), playerFitOf(playerFrame?.()) ?? savedFit ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [character, ready, seekMs, playerReady, rulesKey, partsKey]);

  return (
    <canvas ref={canvas} width={720} height={960} data-native-character={object.id} className="cb-native-character-canvas"
      style={{ filter: hueFilter, visibility: ready && !standDown ? "visible" : "hidden" }} />
  );
}
