"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent, MutableRefObject, PointerEvent as ReactPointerEvent, WheelEvent as ReactWheelEvent } from "react";
import type { CharacterPartDescriptor, CharacterPartKey, ColorReplacement, EditorData, EditorObject } from "@/types";
import { textCss } from "@/lib/textStyle";
import RenderDiagnostics, { type RenderDiagnosticsInfo } from "@/components/RenderDiagnostics";
import type { LayerGeometry } from "@/lib/layerTransform";
import { resolveCharacterTransformAtTime, type CharacterTransform } from "@/lib/keyframes";
import { resolvePartOverridesAtTime, resolvePartTransformAtTime, resolveSourceSeekMs, type PartTransform } from "@/lib/partKeyframes";

type Props = {
  data: EditorData;
  width: number;
  height: number;
  selectedObjectId: string | null;
  /** Full multi-selection (Shift+click / marquee). Defaults to [selectedObjectId]. */
  selectedObjectIds?: string[];
  onSelectionChange?: (ids: string[]) => void;
  /** Batch move (multi-selection drag) committed as one edit. */
  onMoveMany?: (moves: Array<{ id: string; x: number; y: number }>) => void;
  /** Option/Alt + drag: duplicate (a copy stays at the start) instead of a plain move. */
  onDuplicateMoved?: (moves: Array<{ id: string; x: number; y: number }>) => void;
  /** Adobe Animate tools: "select" (V) shows a blue outline; "transform" (Q) shows the handles;
   *  "scale" (S, Illustrator) drags anywhere to scale the selection about its registration point. */
  toolMode?: "select" | "transform" | "scale" | "zoom" | "text";
  /** Text tool (Illustrator point type): the text layer being typed into (caret at clientX/Y, else
   *  at the end). The text is uncontrolled while editing; every change goes out through onTextInput. */
  editingText?: { id: string; clientX?: number; clientY?: number; nonce: number } | null;
  /** Text tool: a press on the stage (not on a text layer) starts new text there (stage px). */
  onCreateText?: (x: number, y: number) => void;
  /** Text tool press, or a double-click with the selection tools, on a text layer. */
  onEditText?: (id: string, clientX?: number, clientY?: number) => void;
  onTextInput?: (id: string, text: string) => void;
  /** Esc in the text being typed. */
  onTextEditEnd?: () => void;
  /** Filled by the canvas: a text layer's box in its own (unscaled) stage px. */
  textSizeRef?: MutableRefObject<((objectId: string) => { width: number; height: number } | null) | null>;
  /** Show the graph-paper transparency grid instead of the canvas colour (editor view only). */
  transparencyGrid?: boolean;
  /** Animate's "Clip content outside the Stage". Off: objects overlap the pasteboard while editing. Render mode always clips. */
  clipToStage?: boolean;
  isPlaying: boolean;
  playhead: number;
  onSelect: (id: string | null) => void;
  onMove: (id: string, x: number, y: number) => void;
  onTransform?: (id: string, patch: TransformPatch) => void;
  activeCharacterPart?: CharacterPartKey | null;
  onMoveCharacterPart?: (id: string, partKey: CharacterPartKey, offsetX: number, offsetY: number) => void;
  onTransformCharacterPart?: (id: string, partKey: CharacterPartKey, patch: Partial<{ offsetX: number; offsetY: number; rotation: number; scale: number; stretchX: number; stretchY: number; flipX: boolean; skewX: number; skewY: number }>) => void;
  /** Moves a part's registration point; (dx, dy) = old − new point in stage units, for offset compensation. */
  onSetCharacterPartPivot?: (id: string, partKey: CharacterPartKey, pivotX: number, pivotY: number, dx: number, dy: number) => void;
  onActiveCharacterPart?: (partKey: CharacterPartKey | null) => void;
  /** Double-click on a part; alreadySelected = that part was the selected part before the gesture. */
  onCharacterPartDoubleClick?: (partKey: CharacterPartKey, alreadySelected: boolean) => void;
  /** The selected part has been entered: the rest of the character is dimmed. */
  characterPartEntered?: boolean;
  /** Recolour rule shown live while the Recolour panel is editing (not saved). */
  previewColorReplacement?: { objectId: string; rule: ColorReplacement } | null;
  /** Lets the editor reach a character's player frame (palette, eyedropper). */
  frameAccessRef?: MutableRefObject<((objectId: string) => HTMLIFrameElement | undefined) | null>;
  /** Lighten/Darken tool or a colour eyedropper is on: double-clicks never select or enter parts. */
  blockDoubleClick?: boolean;
  /** Filled by the canvas: the stage point at the centre of what is visible (Paste in Center). */
  viewCenterRef?: MutableRefObject<(() => { x: number; y: number }) | null>;
  /** Filled by the canvas: a layer's artwork box (Transform panel, Align). */
  layerGeometryRef?: MutableRefObject<((objectId: string) => LayerGeometry | null) | null>;
  /** Eyedropper mode: the next press on the stage is handed to onColorPick instead of selecting. */
  colorPickActive?: boolean;
  /** Cursor while picking: eyedropper, or the Lighten / Darken tool's + / −. */
  colorPickCursor?: "pick" | "lighten" | "darken";
  onColorPick?: (clientX: number, clientY: number, modifiers: { altKey: boolean; shiftKey: boolean }) => void;
  onCharacterPartsReady?: (id: string, parts: CharacterPartDescriptor[], autoDetected: boolean, contentBounds?: { width: number; height: number }) => void;
  renderMode?: boolean;
  renderSeekRevision?: number;
  zoom?: number;
  onZoomChange?: (zoom: number) => void;
  onFitScaleChange?: (scale: number) => void;
  viewResetRevision?: number;
};

export type TransformPatch = Partial<Pick<EditorObject, "x" | "y" | "scale" | "rotation" | "pivotX" | "pivotY" | "stretchX" | "stretchY" | "skewX" | "skewY">>;
type Fit = { scale: number; left: number; top: number };
type VisualBounds = { x: number; y: number; width: number; height: number };
type NormalizedBounds = { x: number; y: number; width: number; height: number };
type PartBoundsEntry = { space: "source" | "camera"; bounds: NormalizedBounds };

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 200;
const clampZoom = (value: number) => Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, value));

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

/**
 * The stage is zoomed with CSS `zoom`, not `transform: scale`. A transform makes the browser
 * resample each character player's finished bitmap on its way to the screen (a half-pixel blur,
 * plain on 1× / Full HD screens), while `zoom` lays the players out at their real screen size so
 * the vectors are drawn straight onto the pixel grid, as in Animate. Needs standard zoom (Chrome
 * 128+ / Electron 32+, Firefox 126+): the zoomed element's own left/top and its children's
 * layout scale, element sizes stay unzoomed. Otherwise the stage keeps the transform.
 */
let standardZoomSupport: boolean | null = null;
const supportsStandardZoom = () => {
  if (standardZoomSupport !== null) return standardZoomSupport;
  if (typeof document === "undefined" || !document.body) return false;
  const host = document.createElement("div");
  host.style.cssText = "position:absolute;left:-9999px;top:0;width:100px;height:100px;visibility:hidden";
  host.innerHTML = '<div style="position:absolute;left:10px;top:0;zoom:2"><div style="width:10px;height:10px"></div></div>';
  document.body.appendChild(host);
  const zoomed = host.firstElementChild as HTMLElement;
  const child = zoomed.firstElementChild as HTMLElement;
  const hostRect = host.getBoundingClientRect();
  const childRect = child.getBoundingClientRect();
  standardZoomSupport = Math.abs(childRect.width - 20) < 0.5 && child.offsetWidth === 10 && Math.abs(childRect.left - hostRect.left - 20) < 0.5;
  host.remove();
  return standardZoomSupport;
};
const normalizeDegrees = (value: number) => {
  let next = value % 360;
  if (next > 180) next -= 360;
  if (next <= -180) next += 360;
  return next;
};
const pointerAngle = (clientX: number, clientY: number, centerX: number, centerY: number) => Math.atan2(clientY - centerY, clientX - centerX) * 180 / Math.PI;

// ---- Free Transform geometry (Animate): objects are positioned by their centre, rotated
// about it and sized by scale × stretch. Scaling/rotating about any other point (opposite
// handle, registration point) is expressed by also moving the centre.
const PIVOT_MIN = -2;
const PIVOT_MAX = 3;
const stretchOf = (object: EditorObject) => ({
  x: clamp(Number(object.stretchX ?? 1) || 1, 0.02, 50),
  y: clamp(Number(object.stretchY ?? 1) || 1, 0.02, 50),
});
/** Skew in degrees (Animate's skew: drag a bounding-box edge). */
type Skew = { x: number; y: number };
const MAX_SKEW = 80;
const skewOf = (object: EditorObject): Skew => ({
  x: clamp(Number(object.skewX || 0), -MAX_SKEW, MAX_SKEW),
  y: clamp(Number(object.skewY || 0), -MAX_SKEW, MAX_SKEW),
});
/** CSS transform for non-character layers (characters are sized in px instead). */
const layerTransformCss = (object: EditorObject, rotation: number, scale: number, stretchX: number, stretchY: number, skew: Skew = skewOf(object)) =>
  `translate(-50%, -50%) rotate(${rotation}deg) skew(${skew.x}deg, ${skew.y}deg) scale(${scale * stretchX}, ${scale * stretchY})${object.flipX ? " scaleX(-1)" : ""}`;
/**
 * CSS transform for a character element (sized in px; rotation, skew and flip only). It is centred
 * on left/top by negative margins (characterBoxCss), not translate(-50%, -50%): a transform makes
 * the browser resample the player's bitmap (soft on Full HD screens), layout snaps to the pixel
 * grid. So an upright, unskewed, unflipped character has no transform at all.
 */
const characterTransformCss = (object: EditorObject, rotation: number, skew: Skew = skewOf(object)) =>
  rotation || skew.x || skew.y || object.flipX
    ? `rotate(${rotation}deg) skew(${skew.x}deg, ${skew.y}deg) scaleX(${object.flipX ? -1 : 1})`
    : "none";
/** Size of a character element, centred on its left/top. */
const characterBoxCss = (width: number, height: number) => ({
  width: `${width}px`,
  height: `${height}px`,
  marginLeft: `${-width / 2}px`,
  marginTop: `${-height / 2}px`,
});
const SKEW_CURSOR_H = `url("data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 26 26"><g stroke="#fff" stroke-width="3.2" stroke-linejoin="round"><path d="M5 9h12V5.5l6 4.5-6 4.5V11H5z"/><path d="M21 15H9v-3.5L3 16l6 4.5V17h12z"/></g><path d="M5 9h12V5.5l6 4.5-6 4.5V11H5z"/><path d="M21 15H9v-3.5L3 16l6 4.5V17h12z"/></svg>')}") 13 13, ew-resize`;
const SKEW_CURSOR_V = `url("data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 26 26"><g stroke="#fff" stroke-width="3.2" stroke-linejoin="round"><path d="M9 21V9H5.5L10 3l4.5 6H11v12z"/><path d="M15 5v12h-3.5l4.5 6 4.5-6H17V5z"/></g><path d="M9 21V9H5.5L10 3l4.5 6H11v12z"/><path d="M15 5v12h-3.5l4.5 6 4.5-6H17V5z"/></svg>')}") 13 13, ns-resize`;
/** A client (screen) point in a character player's own CSS px, undoing the element's
 *  rotate · skew · flip around its centre. null when the point is outside the player. */
const playerPointFromClient = (frame: HTMLIFrameElement, rotation: number, skew: Skew, flipX: boolean, clientX: number, clientY: number) => {
  const width = frame.offsetWidth;
  const height = frame.offsetHeight;
  if (width <= 0 || height <= 0) return null;
  const radians = rotation * Math.PI / 180;
  const tanX = Math.tan(skew.x * Math.PI / 180);
  const tanY = Math.tan(skew.y * Math.PI / 180);
  const flip = flipX ? -1 : 1;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const m00 = cos * flip - sin * tanY * flip;
  const m01 = cos * tanX - sin;
  const m10 = sin * flip + cos * tanY * flip;
  const m11 = sin * tanX + cos;
  const determinant = m00 * m11 - m01 * m10 || 1;
  const rect = frame.getBoundingClientRect();
  const screenScale = rect.width / Math.max(0.001, Math.abs(m00) * width + Math.abs(m01) * height);
  const dx = (clientX - (rect.left + rect.width / 2)) / screenScale;
  const dy = (clientY - (rect.top + rect.height / 2)) / screenScale;
  const x = (m11 * dx - m01 * dy) / determinant + width / 2;
  const y = (-m10 * dx + m00 * dy) / determinant + height / 2;
  return x < 0 || y < 0 || x > width || y > height ? null : { x, y };
};

/** Skew cursor for an edge, turned with the object (top/bottom edges skew sideways). */
const skewCursorFor = (edge: "top" | "bottom" | "left" | "right", rotation: number) => {
  const direction = (((edge === "top" || edge === "bottom" ? 0 : 90) + rotation) % 180 + 180) % 180;
  return direction < 45 || direction > 135 ? SKEW_CURSOR_H : SKEW_CURSOR_V;
};
/** World vector → the object's local axes (rotation in degrees, clockwise on screen). */
const toLocal = (dx: number, dy: number, rotation: number) => {
  const r = rotation * Math.PI / 180;
  return { x: dx * Math.cos(r) + dy * Math.sin(r), y: -dx * Math.sin(r) + dy * Math.cos(r) };
};
const toWorld = (lx: number, ly: number, rotation: number) => {
  const r = rotation * Math.PI / 180;
  return { x: lx * Math.cos(r) - ly * Math.sin(r), y: lx * Math.sin(r) + ly * Math.cos(r) };
};
/** Resize cursor for a handle, turned with the object (and mirrored when flipped). */
const HANDLE_ANGLE: Record<string, number> = { e: 0, se: 45, s: 90, sw: 135, w: 180, nw: 225, n: 270, ne: 315 };
const handleCursor = (handle: string, rotation: number, flipX?: boolean) => {
  const base = flipX ? 180 - HANDLE_ANGLE[handle] : HANDLE_ANGLE[handle];
  const step = Math.round((((base + rotation) % 180) + 180) % 180 / 45) % 4;
  return ["ew-resize", "nwse-resize", "ns-resize", "nesw-resize"][step];
};

// Moving a character part needs a half-second press first, so the clicks of a double-click (which
// select and enter parts) never nudge it. Moving more than a few px before then cancels the move.
const PART_HOLD_MS = 500;
const PART_HOLD_SLOP = 4;
/** Calls arm(x, y) once the pointer has been held still for PART_HOLD_MS; until then moves are ignored.
 *  Returns per-event callbacks: move(e) → true while armed; end() → whether it was armed. */
const holdToMove = (startX: number, startY: number, box: HTMLElement | null, arm: (x: number, y: number) => void) => {
  let armed = false, cancelled = false, lastX = startX, lastY = startY;
  const timer = window.setTimeout(() => {
    if (cancelled) return;
    armed = true;
    box?.classList.add("cb-part-armed");
    arm(lastX, lastY);
  }, PART_HOLD_MS);
  return {
    move: (event: PointerEvent) => {
      lastX = event.clientX; lastY = event.clientY;
      if (!armed && !cancelled && Math.hypot(event.clientX - startX, event.clientY - startY) > PART_HOLD_SLOP) { cancelled = true; window.clearTimeout(timer); }
      return armed;
    },
    end: () => { window.clearTimeout(timer); box?.classList.remove("cb-part-armed"); return armed; },
  };
};

export default function StageCanvas({ data, width, height, selectedObjectId, selectedObjectIds, onSelectionChange, onMoveMany, onDuplicateMoved, toolMode = "transform", editingText = null, onCreateText, onEditText, onTextInput, onTextEditEnd, textSizeRef, transparencyGrid = false, clipToStage = false, isPlaying, playhead, onSelect, onMove, onTransform, activeCharacterPart = null, onMoveCharacterPart, onTransformCharacterPart, onSetCharacterPartPivot, onActiveCharacterPart, onCharacterPartDoubleClick, characterPartEntered = false, previewColorReplacement = null, frameAccessRef, viewCenterRef, layerGeometryRef, blockDoubleClick = false, colorPickActive = false, colorPickCursor = "pick", onColorPick, onCharacterPartsReady, renderMode = false, renderSeekRevision = 0, zoom = 1, onZoomChange, onFitScaleChange, viewResetRevision = 0 }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const frameRefs = useRef<Map<string, HTMLIFrameElement>>(new Map());
  const replacementFrameRefs = useRef<Map<string, HTMLIFrameElement>>(new Map());
  const [readyCharacterIds, setReadyCharacterIds] = useState<Set<string>>(() => new Set());
  const [characterVisualBounds, setCharacterVisualBounds] = useState<Record<string, VisualBounds>>({});
  const [characterPartBounds, setCharacterPartBounds] = useState<Record<string, PartBoundsEntry>>({});
  const [savedPartBounds, setSavedPartBounds] = useState<Record<string, Record<string, PartBoundsEntry>>>({});
  const [previewPartOverrides, setPreviewPartOverrides] = useState<Record<string, Record<string, Partial<PartTransform & { pivotX: number; pivotY: number }>>>>({});
  const [readyReplacementKeys, setReadyReplacementKeys] = useState<Set<string>>(() => new Set());
  const [fit, setFit] = useState<Fit>({ scale: 1, left: 0, top: 0 });
  const [hostSize, setHostSize] = useState({ width: 1, height: 1 });
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [spacePanning, setSpacePanning] = useState(false);
  const [rotationToolActive, setRotationToolActive] = useState(false);
  const panDragRef = useRef<{ pointerId: number; startClientX: number; startClientY: number; startPanX: number; startPanY: number } | null>(null);
  // Part selected when the current click gesture began, and characters whose pending
  // HIT_TEST_PART answer came from a double-click.
  const gestureStartPartRef = useRef<{ objectId: string | null | undefined; part: string | null }>({ objectId: null, part: null });
  const pendingPartDoubleClickRef = useRef<Set<string>>(new Set());
  const previousZoomRef = useRef(clampZoom(Number(zoom || 1)));
  const wheelZoomTargetRef = useRef<number | null>(null);
  // Set when a zoom step has just corrected the pan: the players' view waits for that re-render.
  const zoomPanPendingRef = useRef(false);
  // Keep the editor canvas visually stable when the browser page zoom changes.
  // Chrome/Safari desktop page zoom changes devicePixelRatio; we use the DPR at
  // editor mount as the baseline and counter-scale the entire stage viewport.
  const initialDevicePixelRatioRef = useRef(typeof window !== "undefined" ? Math.max(0.25, Number(window.devicePixelRatio || 1)) : 1);
  const [browserZoomFactor, setBrowserZoomFactor] = useState(1);
  // The screen's own density without page zoom: 1 on Full HD, 2 on 4K / Retina.
  const [screenDpr, setScreenDpr] = useState(1);
  const [useCssZoom, setUseCssZoom] = useState(false);
  useEffect(() => { setUseCssZoom(supportsStandardZoom()); }, []);

  if (frameAccessRef) frameAccessRef.current = (objectId: string) => frameRefs.current.get(objectId);

  const getPlayerQualityScale = useCallback((sourceWidth: number, sourceHeight: number) => {
    const requestedZoom = Math.max(1, Number(zoom || 1));
    const deviceScale = typeof window !== "undefined" ? Math.max(1, Number(window.devicePixelRatio || 1)) : 1;
    const requestedScale = Math.max(deviceScale, Math.ceil(requestedZoom));
    const maxCanvasEdge = 12000;
    const maxQualityByDimension = Math.max(1, Math.floor(maxCanvasEdge / Math.max(1, sourceWidth, sourceHeight)));
    return Math.max(1, Math.min(16, maxQualityByDimension, requestedScale));
  }, [zoom]);

  const objects = data.objects || [];
  const selectedIds = useMemo(
    () => selectedObjectIds ?? (selectedObjectId ? [selectedObjectId] : []),
    [selectedObjectId, selectedObjectIds],
  );
  const [marquee, setMarquee] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  const characterObjects = useMemo(
    () => objects.filter((item) => item.type === "character" && item.assetKind === "animate-createjs" && item.assetUrl),
    [objects],
  );
  // v104: uploaded libraries use one generic CreateJS bridge. No character-specific
  // camera renderer is selected by a hard-coded ID.
  const cameraCharacterObjects = useMemo(() => [] as EditorObject[], []);

  const replacementReadyKey = useCallback((objectId: string, partKey: string, assetUrl: string) => `${objectId}::${partKey}::${assetUrl}`, []);

  const getCharacterVisualBounds = useCallback((object: EditorObject): VisualBounds => {
    const sourceWidth = Math.max(1, Number(object.sourceWidth || 1920));
    const sourceHeight = Math.max(1, Number(object.sourceHeight || 1920));
    const detected = characterVisualBounds[object.id];
    if (detected && detected.width > 1 && detected.height > 1) {
      const widthValue = Math.min(sourceWidth, Math.max(1, detected.width));
      const heightValue = Math.min(sourceHeight, Math.max(1, detected.height));
      return {
        x: clamp(Number.isFinite(detected.x) ? detected.x : (sourceWidth - widthValue) / 2, 0, Math.max(0, sourceWidth - widthValue)),
        y: clamp(Number.isFinite(detected.y) ? detected.y : (sourceHeight - heightValue) / 2, 0, Math.max(0, sourceHeight - heightValue)),
        width: widthValue,
        height: heightValue,
      };
    }
    // Before the source player reports raster bounds, use the same centered fit
    // region as the CreateJS player. READY replaces this with pixel-accurate bounds.
    const fallbackWidth = sourceWidth * 0.52;
    const fallbackHeight = sourceHeight * 0.78;
    return {
      x: (sourceWidth - fallbackWidth) / 2,
      y: (sourceHeight - fallbackHeight) / 2,
      width: fallbackWidth,
      height: fallbackHeight,
    };
  }, [characterVisualBounds]);

  const expandSourcePartBounds = useCallback((object: EditorObject, bounds: NormalizedBounds): NormalizedBounds => {
    const sourceWidth = Math.max(1, Number(object.sourceWidth || 1920));
    const sourceHeight = Math.max(1, Number(object.sourceHeight || 1920));
    const resolvedTransform = object.type === "character"
      ? resolveCharacterTransformAtTime(object, playhead)
      : { x: object.x, y: object.y, scale: object.scale || 1, rotation: object.rotation || 0 };
    const displayWidth = Math.max(1, sourceWidth * Math.max(0.05, Number(resolvedTransform.scale || 1)));
    const displayHeight = Math.max(1, sourceHeight * Math.max(0.05, Number(resolvedTransform.scale || 1)));
    const padX = Math.min(0.05, 12 / displayWidth);
    const padY = Math.min(0.05, 12 / displayHeight);
    const minWidth = Math.min(0.32, 56 / displayWidth);
    const minHeight = Math.min(0.32, 56 / displayHeight);
    let x = bounds.x - padX;
    let y = bounds.y - padY;
    let width = bounds.width + padX * 2;
    let height = bounds.height + padY * 2;
    if (width < minWidth) {
      const extra = (minWidth - width) / 2;
      x -= extra;
      width = minWidth;
    }
    if (height < minHeight) {
      const extra = (minHeight - height) / 2;
      y -= extra;
      height = minHeight;
    }
    return {
      x: clamp(x, 0, 1),
      y: clamp(y, 0, 1),
      width: clamp(width, 0.001, 1),
      height: clamp(height, 0.001, 1),
    };
  }, [playhead]);

  const expandCameraPartBounds = useCallback((bounds: NormalizedBounds): NormalizedBounds => {
    const padX = 14 / Math.max(1, hostSize.width);
    const padY = 14 / Math.max(1, hostSize.height);
    const minWidth = 64 / Math.max(1, hostSize.width);
    const minHeight = 64 / Math.max(1, hostSize.height);
    let x = bounds.x - padX;
    let y = bounds.y - padY;
    let width = bounds.width + padX * 2;
    let height = bounds.height + padY * 2;
    if (width < minWidth) {
      const extra = (minWidth - width) / 2;
      x -= extra;
      width = minWidth;
    }
    if (height < minHeight) {
      const extra = (minHeight - height) / 2;
      y -= extra;
      height = minHeight;
    }
    return {
      x: clamp(x, 0, 1),
      y: clamp(y, 0, 1),
      width: clamp(width, 0.001, 1),
      height: clamp(height, 0.001, 1),
    };
  }, [hostSize.height, hostSize.width]);

  const getCharacterBoxStyle = useCallback((object: EditorObject) => {
    const sourceWidth = Math.max(1, Number(object.sourceWidth || 1920));
    const sourceHeight = Math.max(1, Number(object.sourceHeight || 1920));
    const visualBounds = getCharacterVisualBounds(object);
    return {
      left: `${clamp((visualBounds.x / sourceWidth) * 100, 0, 100)}%`,
      top: `${clamp((visualBounds.y / sourceHeight) * 100, 0, 100)}%`,
      width: `${clamp((visualBounds.width / sourceWidth) * 100, 0.25, 100)}%`,
      height: `${clamp((visualBounds.height / sourceHeight) * 100, 0.25, 100)}%`,
      transform: "none",
    };
  }, [getCharacterVisualBounds]);

  const rememberPartBounds = useCallback((objectId: string, rawBounds: any, space: "source" | "camera", partKey?: string) => {
    if (!rawBounds) return;
    const next = {
      x: Number(rawBounds.x),
      y: Number(rawBounds.y),
      width: Number(rawBounds.width),
      height: Number(rawBounds.height),
    };
    if (![next.x, next.y, next.width, next.height].every(Number.isFinite) || next.width <= 0 || next.height <= 0) return;
    const entry: PartBoundsEntry = { space, bounds: next };
    setCharacterPartBounds((current) => {
      const previous = current[objectId];
      if (previous
        && previous.space === space
        && Math.abs(previous.bounds.x - next.x) < 0.0001
        && Math.abs(previous.bounds.y - next.y) < 0.0001
        && Math.abs(previous.bounds.width - next.width) < 0.0001
        && Math.abs(previous.bounds.height - next.height) < 0.0001) return current;
      return { ...current, [objectId]: entry };
    });
    if (partKey) {
      setSavedPartBounds((current) => ({
        ...current,
        [objectId]: { ...(current[objectId] || {}), [partKey]: entry },
      }));
    }
  }, []);

  // Guessed zones, only for library characters whose player found no real parts (unnamed rigs).
  const resolveHtml5FallbackPartAtPoint = useCallback((object: EditorObject, normalizedX: number, normalizedY: number) => {
    if (!String(object.characterId || "").startsWith("html5:") || object.autoDetectedParts) return null;
    const zones = [
      { key: "head", x: 0.36, y: 0.067, width: 0.28, height: 0.172 },
      // Garments are checked before the broader torso/leg zones so clicking
      // directly on the vest or lungi selects that garment, not the whole torso.
      { key: "baniyan", x: 0.335, y: 0.255, width: 0.33, height: 0.285 },
      { key: "lungi", x: 0.31, y: 0.585, width: 0.38, height: 0.195 },
      { key: "leftHand", x: 0.235, y: 0.50, width: 0.115, height: 0.155 },
      { key: "rightHand", x: 0.65, y: 0.50, width: 0.115, height: 0.155 },
      { key: "torso", x: 0.29, y: 0.25, width: 0.42, height: 0.34 },
      { key: "leftLeg", x: 0.345, y: 0.69, width: 0.145, height: 0.245 },
      { key: "rightLeg", x: 0.51, y: 0.69, width: 0.145, height: 0.245 },
    ];
    return zones.find((zone) => normalizedX >= zone.x && normalizedX <= zone.x + zone.width && normalizedY >= zone.y && normalizedY <= zone.y + zone.height) || null;
  }, []);

  // A part picked on the canvas: plain selection, or (double-click) select-then-enter.
  const pickCharacterPart = useCallback((objectId: string, partKey: string, viaDoubleClick: boolean) => {
    onSelect(objectId);
    if (viaDoubleClick && onCharacterPartDoubleClick) {
      const start = gestureStartPartRef.current;
      onCharacterPartDoubleClick(partKey, start.objectId === objectId && start.part === partKey);
    } else {
      onActiveCharacterPart?.(partKey);
    }
  }, [onActiveCharacterPart, onCharacterPartDoubleClick, onSelect]);

  const requestCharacterPartAtPoint = useCallback((object: EditorObject, clientX: number, clientY: number, viaDoubleClick = false) => {
    const frame = frameRefs.current.get(object.id);
    if (!frame) return;
    const rect = frame.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const normalizedX = clamp((clientX - rect.left) / rect.width, 0, 1);
    const normalizedY = clamp((clientY - rect.top) / rect.height, 0, 1);
    const fallback = resolveHtml5FallbackPartAtPoint(object, normalizedX, normalizedY);
    if (fallback) {
      rememberPartBounds(object.id, { x: fallback.x, y: fallback.y, width: fallback.width, height: fallback.height }, "source", fallback.key);
      pickCharacterPart(object.id, fallback.key, viaDoubleClick);
      return;
    }
    if (viaDoubleClick) pendingPartDoubleClickRef.current.add(object.id);
    frame.contentWindow?.postMessage({
      source: "characterbazaarstudio-editor",
      type: "HIT_TEST_PART",
      normalizedX,
      normalizedY,
    }, "*");
  }, [pickCharacterPart, rememberPartBounds, resolveHtml5FallbackPartAtPoint]);

  // ---- Pieces inside a part (Animate's double-click into a symbol): inside an entered part a click
  // selects the piece under the pointer (Hair, Eyes, Lips…) or, where there is no named piece, the
  // drawn shape; Shift+click adds or removes shapes. The player answers with a path key such as
  // "head/hair" or "head/lips/shape_3+shape_7".
  type SubPart = { key: string; label?: string; bounds?: { x: number; y: number; width: number; height: number } };
  const subPartAt = (object: EditorObject, parentKey: string, clientX: number, clientY: number, add = false): SubPart | null => {
    const frame = frameRefs.current.get(object.id);
    const rect = frame?.getBoundingClientRect();
    if (!frame || !rect || rect.width <= 0 || rect.height <= 0) return null;
    try {
      const fn = (frame.contentWindow as (Window & { cbSubPartAt?: (parentKey: string, x: number, y: number, current: string, add: boolean) => SubPart | null }) | null)?.cbSubPartAt;
      const result = typeof fn === "function" ? fn(parentKey, (clientX - rect.left) / rect.width, (clientY - rect.top) / rect.height, activeCharacterPart || "", add) : null;
      return result && result.key ? result : null;
    } catch { return null; }
  };
  const parentPartOf = (key: string | null) => (key && key.includes("/") ? key.slice(0, key.lastIndexOf("/")) : null);
  /** Selects (or, enter = true, selects and enters) a piece found by subPartAt. */
  const chooseSubPart = (object: EditorObject, found: SubPart, enter: boolean) => {
    if (found.bounds) rememberPartBounds(object.id, found.bounds, "source", found.key);
    if (enter && onCharacterPartDoubleClick) onCharacterPartDoubleClick(found.key, true);
    else onActiveCharacterPart?.(found.key);
  };
  /** A press inside part editing that picks a piece; false = not handled here. */
  const pressSubPart = (object: EditorObject, clientX: number, clientY: number, shiftKey: boolean) => {
    if (!activeCharacterPart) return false;
    const parent = parentPartOf(activeCharacterPart);
    // Shift+click: add / remove a drawn shape next to the selected shape(s) of the same part.
    if (shiftKey && parent) { const found = subPartAt(object, parent, clientX, clientY, true); if (found) { chooseSubPart(object, found, false); return true; } }
    if (characterPartEntered) {
      const found = subPartAt(object, activeCharacterPart, clientX, clientY);
      if (found) { chooseSubPart(object, found, false); return true; }
      return false;
    }
    // A selected piece: another piece of the same part is picked; anything else is ignored.
    if (parent) { const found = subPartAt(object, parent, clientX, clientY); if (found) chooseSubPart(object, found, false); return true; }
    return false;
  };
  /** Double-click in part editing: enter the selected piece, or pick a piece and enter it. */
  const doubleClickSubPart = (object: EditorObject, clientX: number, clientY: number) => {
    if (!activeCharacterPart) return false;
    const parent = parentPartOf(activeCharacterPart);
    if (!characterPartEntered && parent && isPartPixelAt(object, activeCharacterPart, clientX, clientY)) { onCharacterPartDoubleClick?.(activeCharacterPart, true); return true; }
    const container = characterPartEntered ? activeCharacterPart : parent;
    if (!container) return false;
    const found = subPartAt(object, container, clientX, clientY);
    if (found) { chooseSubPart(object, found, true); return true; }
    return Boolean(parent); // inside a piece, double-clicks never jump to another top-level part
  };
  // The part box follows the selected part: refreshed from the player when the selection changes
  // (Esc back to the parent…) or when edits move a piece's parent.
  const selectedEditSignature = useMemo(() => {
    const item = objects.find((entry) => entry.id === selectedObjectId);
    return item ? JSON.stringify([item.partOverrides || {}, item.partKeyframes || {}]) : "";
  }, [objects, selectedObjectId]);
  useEffect(() => {
    if (renderMode || !selectedObjectId || !activeCharacterPart) return;
    const timer = window.setTimeout(() => {
      const frame = frameRefs.current.get(selectedObjectId);
      try {
        const fn = (frame?.contentWindow as (Window & { cbPartBoundsOf?: (key: string) => SubPart | null }) | null | undefined)?.cbPartBoundsOf;
        const found = typeof fn === "function" ? fn(activeCharacterPart) : null;
        if (found?.bounds) rememberPartBounds(selectedObjectId, found.bounds, "source", found.key);
      } catch { /* player not reachable */ }
    }, 90);
    return () => window.clearTimeout(timer);
  }, [activeCharacterPart, renderMode, rememberPartBounds, selectedEditSignature, selectedObjectId]);

  const beginCharacterPartDrag = useCallback((event: ReactPointerEvent<HTMLElement>, object: EditorObject) => {
    if (renderMode || !activeCharacterPart || object.id !== selectedObjectId || spacePanning) return;
    const frame = frameRefs.current.get(object.id);
    if (!frame) return;
    const rect = frame.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;

    event.preventDefault();
    event.stopPropagation();
    const pointerId = event.pointerId;
    const captureTarget = event.currentTarget;
    captureTarget.setPointerCapture?.(pointerId);
    const normalizedPoint = (clientX: number, clientY: number) => ({
      normalizedX: (clientX - rect.left) / rect.width,
      normalizedY: (clientY - rect.top) / rect.height,
    });
    const hold = holdToMove(event.clientX, event.clientY, captureTarget.closest<HTMLElement>(".cb-character-part-hitbox") || captureTarget, (x, y) => {
      frame.contentWindow?.postMessage({
        source: "characterbazaarstudio-editor",
        type: "BEGIN_PART_DRAG",
        partKey: activeCharacterPart,
        ...normalizedPoint(x, y),
      }, "*");
    });

    const move = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) return;
      if (!hold.move(moveEvent)) return; // not held long enough yet: the part stays put
      const point = normalizedPoint(moveEvent.clientX, moveEvent.clientY);
      frame.contentWindow?.postMessage({
        source: "characterbazaarstudio-editor",
        type: "MOVE_PART_DRAG",
        partKey: activeCharacterPart,
        ...point,
      }, "*");
    };
    const up = (upEvent: PointerEvent) => {
      if (upEvent.pointerId !== pointerId) return;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      if (hold.end()) {
        const point = normalizedPoint(upEvent.clientX, upEvent.clientY);
        frame.contentWindow?.postMessage({
          source: "characterbazaarstudio-editor",
          type: "END_PART_DRAG",
          partKey: activeCharacterPart,
          ...point,
        }, "*");
      }
      try { captureTarget.releasePointerCapture?.(pointerId); } catch { /* ignore */ }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  }, [activeCharacterPart, renderMode, selectedObjectId, spacePanning]);

  useEffect(() => {
    if (renderMode || typeof window === "undefined") return;
    // Page zoom changes the page's width against the window's (outerWidth / innerWidth); moving the
    // window to a screen of another density (4K ↔ Full HD) changes devicePixelRatio but not that. A
    // screen move must not count as page zoom, so it moves the baseline instead.
    const zoomRatio = () => (window.innerWidth > 0 && window.outerWidth > 0 ? window.outerWidth / window.innerWidth : 1);
    let lastDpr = Math.max(0.25, Number(window.devicePixelRatio || 1));
    let lastRatio = zoomRatio();
    let densityQuery: MediaQueryList | null = null;
    const updateBrowserZoom = () => {
      const currentDpr = Math.max(0.25, Number(window.devicePixelRatio || 1));
      const ratio = zoomRatio();
      if (Math.abs(currentDpr - lastDpr) > 0.001 && Math.abs(ratio - lastRatio) < 0.02) {
        initialDevicePixelRatioRef.current = Math.max(0.25, initialDevicePixelRatioRef.current || 1) * currentDpr / lastDpr;
      }
      lastDpr = currentDpr;
      lastRatio = ratio;
      const baselineDpr = Math.max(0.25, initialDevicePixelRatioRef.current || 1);
      const next = clamp(currentDpr / baselineDpr, 0.5, 3);
      setBrowserZoomFactor((current) => Math.abs(current - next) < 0.001 ? current : next);
      setScreenDpr((current) => Math.abs(current - currentDpr / next) < 0.001 ? current : currentDpr / next);
      watchDensity();
    };
    // A screen move fires no resize event: listen for the pixel ratio itself.
    function watchDensity() {
      densityQuery?.removeEventListener("change", updateBrowserZoom);
      densityQuery = window.matchMedia?.(`(resolution: ${window.devicePixelRatio}dppx)`) || null;
      densityQuery?.addEventListener("change", updateBrowserZoom);
    }
    updateBrowserZoom();
    window.addEventListener("resize", updateBrowserZoom);
    window.visualViewport?.addEventListener("resize", updateBrowserZoom);
    // Backstop where the media query does not report the change.
    const densityCheck = window.setInterval(() => { if (Math.abs(Number(window.devicePixelRatio || 1) - lastDpr) > 0.001) updateBrowserZoom(); }, 1000);
    return () => {
      window.clearInterval(densityCheck);
      densityQuery?.removeEventListener("change", updateBrowserZoom);
      window.removeEventListener("resize", updateBrowserZoom);
      window.visualViewport?.removeEventListener("resize", updateBrowserZoom);
    };
  }, [renderMode]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const update = () => {
      const rect = host.getBoundingClientRect();
      const logicalWidth = Math.max(1, rect.width * (renderMode ? 1 : browserZoomFactor));
      const logicalHeight = Math.max(1, rect.height * (renderMode ? 1 : browserZoomFactor));
      setHostSize({ width: logicalWidth, height: logicalHeight });
      const paddingScale = renderMode ? 1 : 0.965;
      const scale = Math.max(0.01, Math.min(logicalWidth / width, logicalHeight / height) * paddingScale);
      onFitScaleChange?.(scale);
      setFit({
        scale,
        left: (logicalWidth - width * scale) / 2,
        top: (logicalHeight - height * scale) / 2,
      });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(host);
    return () => observer.disconnect();
  }, [browserZoomFactor, height, onFitScaleChange, renderMode, width]);

  useEffect(() => {
    if (renderMode) return;
    const isEditableTarget = (target: EventTarget | null) => {
      const el = target as HTMLElement | null;
      if (!el) return false;
      const tag = el.tagName?.toLowerCase();
      return tag === "input" || tag === "textarea" || tag === "select" || el.isContentEditable;
    };
    const down = (event: KeyboardEvent) => {
      if (event.code === "Space" && !isEditableTarget(event.target)) {
        event.preventDefault();
        setSpacePanning(true);
        return;
      }
      if (event.key === "Escape") setRotationToolActive(false);
    };
    const up = (event: KeyboardEvent) => {
      if (event.code === "Space") setSpacePanning(false);
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [renderMode, selectedObjectId]);

  useEffect(() => {
    setPan({ x: 0, y: 0 });
    // Fit in Window also sets zoom back to 1 in the same click. Mark that zoom as already
    // applied, so the zoom-anchor effect below doesn't move the stage off-centre again.
    previousZoomRef.current = clampZoom(Number(zoom || 1));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewResetRevision]);

  useEffect(() => {
    if (!selectedObjectId) setRotationToolActive(false);
  }, [selectedObjectId]);

  const editorZoom = renderMode ? 1 : clampZoom(Number(zoom || 1));
  const effectiveScale = Math.max(0.001, fit.scale * editorZoom);
  if (viewCenterRef) viewCenterRef.current = () => ({ x: (hostSize.width / 2 - fit.left - pan.x) / effectiveScale, y: (hostSize.height / 2 - fit.top - pan.y) / effectiveScale });
  // A layer's artwork box (the box the selection hugs) in its own unrotated stage px, relative to its
  // position. Characters: their measured artwork; text and props: the element, scaled.
  if (layerGeometryRef) layerGeometryRef.current = (objectId: string) => {
    const object = objects.find((item) => item.id === objectId);
    if (!object || object.type === "background" || object.type === "audio" || object.type === "empty") return null;
    const stretch = stretchOf(object);
    if (object.type === "character") {
      const sourceWidth = Math.max(1, Number(object.sourceWidth || 1920));
      const sourceHeight = Math.max(1, Number(object.sourceHeight || 1920));
      const kx = Math.max(0.02, Number(object.scale || 1)) * stretch.x, ky = Math.max(0.02, Number(object.scale || 1)) * stretch.y;
      const visual = getCharacterVisualBounds(object);
      return { left: (visual.x - sourceWidth / 2) * kx, top: (visual.y - sourceHeight / 2) * ky, width: visual.width * kx, height: visual.height * ky };
    }
    const element = hostRef.current?.querySelector<HTMLElement>(`[data-editor-object-id="${CSS.escape(objectId)}"]`);
    if (!element) return null;
    const kx = Number(object.scale || 1) * stretch.x, ky = Number(object.scale || 1) * stretch.y;
    return { left: (-element.offsetWidth / 2) * kx, top: (-element.offsetHeight / 2) * ky, width: element.offsetWidth * kx, height: element.offsetHeight * ky };
  };
  // Text being typed: filled once when editing starts (then left to the browser), focused, with the
  // caret where the text was clicked (else at the end).
  const textEditRef = useRef<HTMLSpanElement | null>(null);
  useLayoutEffect(() => {
    const element = textEditRef.current;
    if (!editingText || !element) return;
    const object = objects.find((item) => item.id === editingText.id);
    element.textContent = object?.text ?? "";
    element.focus({ preventScroll: true });
    const selection = window.getSelection();
    if (!selection) return;
    const range = editingText.clientX != null && editingText.clientY != null
      ? (document as Document & { caretRangeFromPoint?: (x: number, y: number) => Range | null }).caretRangeFromPoint?.(editingText.clientX, editingText.clientY)
      : null;
    const caret = range && element.contains(range.startContainer) ? range : document.createRange();
    if (caret !== range) { caret.selectNodeContents(element); caret.collapse(false); }
    selection.removeAllRanges();
    selection.addRange(caret);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingText?.id, editingText?.nonce]);
  if (textSizeRef) textSizeRef.current = (objectId: string) => {
    const element = hostRef.current?.querySelector<HTMLElement>(`.cb-stage-text[data-editor-object-id="${CSS.escape(objectId)}"]`);
    return element ? { width: element.offsetWidth, height: element.offsetHeight } : null;
  };
  const showTransparencyGrid = transparencyGrid && !renderMode;
  const gridScreenScale = Math.max(0.001, effectiveScale / Math.max(0.001, browserZoomFactor));
  const hasDetachedSourcePartEdits = useMemo(() => cameraCharacterObjects.some((object) => {
    const replacements = object.partReplacements || {};
    const hasOverride = Object.entries(object.partOverrides || {}).some(([partKey, override]) => {
      // Replaced parts are rendered by React in the same stage-world coordinate system
      // as the body. Their move/scale/rotation must NOT switch the whole character into
      // the legacy camera renderer, otherwise zooming can split the replacement from the body.
      if (replacements[partKey]?.assetUrl) return false;
      return Math.abs(Number(override.offsetX || 0)) > 0.001
        || Math.abs(Number(override.offsetY || 0)) > 0.001
        || Math.abs(Number(override.rotation || 0)) > 0.001
        || Math.abs(Number(override.scale ?? 1) - 1) > 0.001
        || Math.abs(Number(override.stretchX ?? 1) - 1) > 0.001
        || Math.abs(Number(override.stretchY ?? 1) - 1) > 0.001
        || Boolean(override.flipX);
    });
    const hasPartKeys = Object.entries(object.partKeyframes || {}).some(([partKey, frames]) =>
      !replacements[partKey]?.assetUrl && frames.length > 0
    );
    return hasOverride || hasPartKeys;
  }), [cameraCharacterObjects]);
  // v62: editor zoom itself NEVER changes the character renderer. The body and all
  // replacements remain in one coordinate system while zooming in/out. Camera mode
  // is reserved only for truly detached ORIGINAL source parts that need full-stage travel.
  const useCameraRendering = !renderMode && hasDetachedSourcePartEdits;

  // Toolbar +/- zoom keeps the current viewport center stable instead of scaling
  // everything away from the top-left corner. Mouse-wheel zoom has its own cursor anchor.
  // A layout effect: the corrected pan renders before the browser paints, so a zoom step never
  // shows one frame of the new zoom at the old position (Cmd +/- made the stage jump).
  useLayoutEffect(() => {
    if (renderMode) return;
    const previousZoom = previousZoomRef.current;
    if (Math.abs(previousZoom - editorZoom) < 0.00001) return;
    if (wheelZoomTargetRef.current != null && Math.abs(wheelZoomTargetRef.current - editorZoom) < 0.00001) {
      wheelZoomTargetRef.current = null;
      previousZoomRef.current = editorZoom;
      return;
    }
    const oldScale = Math.max(0.001, fit.scale * previousZoom);
    const newScale = Math.max(0.001, fit.scale * editorZoom);
    const selectedAnchor = objects.find((item) => item.id === selectedObjectId && item.type !== "background" && item.type !== "audio") || null;
    if (selectedAnchor) {
      const anchor = selectedAnchor.type === "character"
        ? resolveCharacterTransformAtTime(selectedAnchor, playhead)
        : { x: selectedAnchor.x, y: selectedAnchor.y, scale: selectedAnchor.scale || 1, rotation: selectedAnchor.rotation || 0 };
      const screenX = fit.left + pan.x + anchor.x * oldScale;
      const screenY = fit.top + pan.y + anchor.y * oldScale;
      setPan({
        x: screenX - fit.left - anchor.x * newScale,
        y: screenY - fit.top - anchor.y * newScale,
      });
      zoomPanPendingRef.current = true;
    } else {
      const centerX = hostSize.width / 2;
      const centerY = hostSize.height / 2;
      const worldX = (centerX - fit.left - pan.x) / oldScale;
      const worldY = (centerY - fit.top - pan.y) / oldScale;
      setPan({
        x: centerX - fit.left - worldX * newScale,
        y: centerY - fit.top - worldY * newScale,
      });
      zoomPanPendingRef.current = true;
    }
    previousZoomRef.current = editorZoom;
  }, [editorZoom, fit.left, fit.scale, fit.top, hostSize.height, hostSize.width, objects, pan.x, pan.y, playhead, renderMode, selectedObjectId]);

  const handleWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    if (renderMode || !onZoomChange) return;
    event.preventDefault();
    const host = hostRef.current;
    if (!host) return;
    const rect = host.getBoundingClientRect();
    const pointerCompensation = renderMode ? 1 : browserZoomFactor;
    const mouseX = (event.clientX - rect.left) * pointerCompensation;
    const mouseY = (event.clientY - rect.top) * pointerCompensation;
    const oldScale = effectiveScale;
    const worldX = (mouseX - fit.left - pan.x) / oldScale;
    const worldY = (mouseY - fit.top - pan.y) / oldScale;
    const factor = event.deltaY < 0 ? 1.15 : 1 / 1.15;
    const nextZoom = clampZoom(editorZoom * factor);
    wheelZoomTargetRef.current = nextZoom;
    const nextScale = Math.max(0.001, fit.scale * nextZoom);
    setPan({
      x: mouseX - fit.left - worldX * nextScale,
      y: mouseY - fit.top - worldY * nextScale,
    });
    onZoomChange(nextZoom);
  };

  // ---- Zoom tool (Z, Illustrator): click = zoom in on that spot, Option/Alt + click = zoom out,
  // drag a rectangle = that area fills the window. Only the view changes, never the project.
  // Clicks step through Illustrator's zoom levels (screen %).
  const ZOOM_STEPS = [3.13, 4.17, 6.25, 8.33, 12.5, 16.67, 25, 33.33, 50, 66.67, 100, 150, 200, 300, 400, 600, 800, 1200, 1600, 2400, 3200, 6400];
  /** Zoom so the stage point under host point (anchorX, anchorY) — or `world`, if given — sits there. */
  const zoomViewAt = (nextZoomRaw: number, anchorX: number, anchorY: number, world?: { x: number; y: number }) => {
    if (!onZoomChange) return;
    const point = world || { x: (anchorX - fit.left - pan.x) / effectiveScale, y: (anchorY - fit.top - pan.y) / effectiveScale };
    const nextZoom = clampZoom(nextZoomRaw);
    const nextScale = Math.max(0.001, fit.scale * nextZoom);
    wheelZoomTargetRef.current = nextZoom; // keeps the zoom effect from re-centring the view
    setPan({ x: anchorX - fit.left - point.x * nextScale, y: anchorY - fit.top - point.y * nextScale });
    onZoomChange(nextZoom);
  };
  const [zoomToolOut, setZoomToolOut] = useState(false);
  useEffect(() => {
    if (toolMode !== "zoom") { setZoomToolOut(false); return; }
    const sync = (event: KeyboardEvent | PointerEvent) => setZoomToolOut(event.altKey);
    window.addEventListener("keydown", sync); window.addEventListener("keyup", sync); window.addEventListener("pointermove", sync);
    return () => { window.removeEventListener("keydown", sync); window.removeEventListener("keyup", sync); window.removeEventListener("pointermove", sync); };
  }, [toolMode]);
  const beginZoomTool = (event: ReactPointerEvent<HTMLElement>) => {
    const host = hostRef.current;
    if (!host || !onZoomChange) return;
    event.preventDefault();
    event.stopPropagation();
    const hostRect = host.getBoundingClientRect();
    const compensation = browserZoomFactor;
    const startX = event.clientX, startY = event.clientY;
    let dragging = false;
    const move = (moveEvent: PointerEvent) => {
      if (!dragging && Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY) < 5) return;
      dragging = true;
      setMarquee({ left: Math.min(startX, moveEvent.clientX) - hostRect.left, top: Math.min(startY, moveEvent.clientY) - hostRect.top, width: Math.abs(moveEvent.clientX - startX), height: Math.abs(moveEvent.clientY - startY) });
    };
    const up = (upEvent: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setMarquee(null);
      const out = upEvent.altKey || event.altKey;
      if (dragging && !out) {
        // The dragged rectangle fills the window, centred.
        const left = (Math.min(startX, upEvent.clientX) - hostRect.left) * compensation, top = (Math.min(startY, upEvent.clientY) - hostRect.top) * compensation;
        const w = Math.max(4, Math.abs(upEvent.clientX - startX) * compensation), h = Math.max(4, Math.abs(upEvent.clientY - startY) * compensation);
        const centre = { x: (left + w / 2 - fit.left - pan.x) / effectiveScale, y: (top + h / 2 - fit.top - pan.y) / effectiveScale };
        const nextScale = effectiveScale * Math.min(hostSize.width / w, hostSize.height / h);
        zoomViewAt(nextScale / Math.max(0.001, fit.scale), hostSize.width / 2, hostSize.height / 2, centre);
        return;
      }
      // A click: the next zoom level in or out, keeping the clicked spot under the pointer.
      const percent = effectiveScale * 100;
      const target = out ? [...ZOOM_STEPS].reverse().find((step) => step < percent * 0.995) ?? ZOOM_STEPS[0] : ZOOM_STEPS.find((step) => step > percent * 1.005) ?? ZOOM_STEPS[ZOOM_STEPS.length - 1];
      zoomViewAt((target / 100) / Math.max(0.001, fit.scale), (startX - hostRect.left) * compensation, (startY - hostRect.top) * compensation);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up, { once: true });
  };

  const beginPan = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (renderMode) return false;
    const shouldPan = event.button === 1 || (spacePanning && event.button === 0);
    if (!shouldPan) return false;
    event.preventDefault();
    event.stopPropagation();
    panDragRef.current = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startPanX: pan.x,
      startPanY: pan.y,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
    return true;
  };

  const movePan = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = panDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    const pointerCompensation = renderMode ? 1 : browserZoomFactor;
    setPan({
      x: drag.startPanX + (event.clientX - drag.startClientX) * pointerCompensation,
      y: drag.startPanY + (event.clientY - drag.startClientY) * pointerCompensation,
    });
  };

  const endPan = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = panDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    panDragRef.current = null;
    try { event.currentTarget.releasePointerCapture?.(event.pointerId); } catch { /* ignore */ }
  };

  const postCharacterEdits = useCallback((
    frame: HTMLIFrameElement,
    object: EditorObject,
    temporaryPartOverrides?: EditorObject["partOverrides"],
    transformOverride?: CharacterTransform,
  ) => {
    const resolvedTransform = transformOverride || resolveCharacterTransformAtTime(object, playhead);
    const resolvedPartOverrides = temporaryPartOverrides || resolvePartOverridesAtTime(object, playhead);
    frame.contentWindow?.postMessage({
      source: "characterbazaarstudio-editor",
      type: "CHARACTER_EDITS",
      partOverrides: resolvedPartOverrides,
      colorOverrides: object.colorOverrides || {},
      // Recolour rules, plus the rule being previewed in the Recolour panel (not saved yet).
      colorReplacements: [...(object.colorReplacements || []), ...(previewColorReplacement && previewColorReplacement.objectId === object.id ? [previewColorReplacement.rule] : [])],
      strokeScale: object.strokeScale ?? 1,
      selectedPart: object.id === selectedObjectId ? (activeCharacterPart || "") : "",
      // Entered part: the player dims everything outside it (never in render mode).
      // Entered part, or the part a selected piece sits in (its parent), keeps full strength.
      focusPart: !renderMode && object.id === selectedObjectId && activeCharacterPart
        ? (characterPartEntered ? activeCharacterPart : activeCharacterPart.includes("/") ? activeCharacterPart.slice(0, activeCharacterPart.lastIndexOf("/")) : "")
        : "",
      viewport: { width, height },
      camera: useCameraRendering ? {
        enabled: true,
        originX: fit.left + pan.x,
        originY: fit.top + pan.y,
        scale: effectiveScale,
        viewportWidth: hostSize.width,
        viewportHeight: hostSize.height,
      } : { enabled: false },
      characterTransform: {
        x: resolvedTransform.x,
        y: resolvedTransform.y,
        scale: resolvedTransform.scale,
        rotation: resolvedTransform.rotation,
        flipX: !!object.flipX,
      },
    }, "*");
  }, [activeCharacterPart, characterPartEntered, previewColorReplacement, effectiveScale, fit.left, fit.top, height, hostSize.height, hostSize.width, pan.x, pan.y, playhead, readyReplacementKeys, renderMode, replacementReadyKey, selectedObjectId, useCameraRendering, width]);

  useEffect(() => {
    for (const object of characterObjects) {
      const frame = frameRefs.current.get(object.id);
      if (frame) postCharacterEdits(frame, object);
    }
  }, [characterObjects, postCharacterEdits]);

  const postReplacementSeek = useCallback((frame: HTMLIFrameElement) => {
    frame.contentWindow?.postMessage({
      source: "characterbazaarstudio-editor",
      type: "REPLACEMENT_SEEK",
      timeSeconds: Math.max(0, playhead),
      playing: isPlaying,
    }, "*");
  }, [isPlaying, playhead]);

  useEffect(() => {
    replacementFrameRefs.current.forEach((frame) => postReplacementSeek(frame));
  }, [postReplacementSeek]);

  /** Store artwork bounds (source px) reported by a player; returns them when valid. */
  const applyContentBounds = useCallback((object: EditorObject, rawBounds: any): VisualBounds | undefined => {
    const sourceWidth = Math.max(1, Number(object.sourceWidth || 1920));
    const sourceHeight = Math.max(1, Number(object.sourceHeight || 1920));
    const contentBounds: VisualBounds | undefined = rawBounds && Number(rawBounds.width) > 1 && Number(rawBounds.height) > 1
      ? {
          x: clamp(Number(rawBounds.x ?? (sourceWidth - Number(rawBounds.width)) / 2), 0, sourceWidth),
          y: clamp(Number(rawBounds.y ?? (sourceHeight - Number(rawBounds.height)) / 2), 0, sourceHeight),
          width: Math.min(sourceWidth, Number(rawBounds.width)),
          height: Math.min(sourceHeight, Number(rawBounds.height)),
        }
      : undefined;
    if (contentBounds) {
      setCharacterVisualBounds((current) => {
        const previous = current[object.id];
        if (
          previous
          && Math.abs(previous.x - contentBounds.x) < 0.01
          && Math.abs(previous.y - contentBounds.y) < 0.01
          && Math.abs(previous.width - contentBounds.width) < 0.01
          && Math.abs(previous.height - contentBounds.height) < 0.01
        ) return current;
        return { ...current, [object.id]: contentBounds };
      });
    }
    return contentBounds;
  }, []);

  // Sharp zoom: tell every character player how many device pixels one of its CSS pixels
  // covers on screen and which part of it is visible. The shared bridge redraws the vectors
  // at exactly that resolution for the visible region (cb-animate-bridge.js SET_VIEW), so
  // zooming in never stretches a bitmap and memory stays bounded by the screen size.
  // Same-origin players get the message at once (dispatched, not posted), so they redraw before the
  // browser paints this frame; players on another origin fall back to postMessage.
  const sendToPlayerNow = (frame: HTMLIFrameElement, message: Record<string, unknown>) => {
    const target = frame.contentWindow;
    if (!target) return;
    try {
      if (target.location.origin === window.location.origin) {
        const PlayerMessageEvent = (target as unknown as typeof globalThis).MessageEvent;
        target.dispatchEvent(new PlayerMessageEvent("message", { data: message, origin: window.location.origin, source: window }));
        return;
      }
    } catch { /* another origin */ }
    target.postMessage(message, "*");
  };
  const lastViewKeyRef = useRef<Map<string, string>>(new Map());
  const lastViewSentRef = useRef<Map<string, Record<string, unknown>>>(new Map());
  const postCharacterViews = useCallback(() => {
    const host = hostRef.current;
    if (!host) return;
    const hostRect = host.getBoundingClientRect();
    const dpr = Math.max(0.25, Number(window.devicePixelRatio || 1));
    for (const object of characterObjects) {
      const frame = frameRefs.current.get(object.id);
      if (!frame?.contentWindow) continue;
      const localWidth = frame.offsetWidth;
      const localHeight = frame.offsetHeight;
      if (localWidth <= 0 || localHeight <= 0) continue;
      const rect = frame.getBoundingClientRect();
      const radians = (resolveCharacterTransformAtTime(object, playhead).rotation || 0) * Math.PI / 180;
      // The element's 2D matrix on screen: rotate · skew · flip (scale comes from its px size).
      const skew = skewOf(object);
      const tanX = Math.tan(skew.x * Math.PI / 180);
      const tanY = Math.tan(skew.y * Math.PI / 180);
      const flipSign = object.flipX ? -1 : 1;
      const cos = Math.cos(radians);
      const sin = Math.sin(radians);
      const m00 = cos * flipSign - sin * tanY * flipSign;
      const m01 = cos * tanX - sin;
      const m10 = sin * flipSign + cos * tanY * flipSign;
      const m11 = sin * tanX + cos;
      const determinant = m00 * m11 - m01 * m10 || 1;
      // Screen CSS px per player CSS px, recovered from the (rotated / skewed) bounding box.
      const screenScale = rect.width / Math.max(0.001, Math.abs(m00) * localWidth + Math.abs(m01) * localHeight);
      let view = { x: 0, y: 0, width: 1, height: 1 };
      if (!renderMode) {
        // Map the visible canvas corners into the player's own 0..1 space (invert the matrix).
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        let minU = Infinity, minV = Infinity, maxU = -Infinity, maxV = -Infinity;
        for (const [px, py] of [[hostRect.left, hostRect.top], [hostRect.right, hostRect.top], [hostRect.right, hostRect.bottom], [hostRect.left, hostRect.bottom]]) {
          const dx = (px - centerX) / screenScale;
          const dy = (py - centerY) / screenScale;
          const u = ((m11 * dx - m01 * dy) / determinant) / localWidth + 0.5;
          const v = ((-m10 * dx + m00 * dy) / determinant) / localHeight + 0.5;
          minU = Math.min(minU, u); maxU = Math.max(maxU, u);
          minV = Math.min(minV, v); maxV = Math.max(maxV, v);
        }
        // Round outward to 1/32 with a margin so small pans don't force a re-render.
        const step = 1 / 32;
        const x0 = clamp(Math.floor((minU - 0.03) / step) * step, 0, 1);
        const y0 = clamp(Math.floor((minV - 0.03) / step) * step, 0, 1);
        const x1 = clamp(Math.ceil((maxU + 0.03) / step) * step, 0, 1);
        const y1 = clamp(Math.ceil((maxV + 0.03) / step) * step, 0, 1);
        view = { x: x0, y: y0, width: Math.max(0, x1 - x0), height: Math.max(0, y1 - y0) };
      }
      // Exactly the device pixels the screen shows (not rounded to 5% steps, which made the
      // browser resize the drawing by up to ~2% and soften every edge).
      const pixelScale = Math.max(0.05, Math.round(screenScale * dpr * 1000) / 1000);
      // exact: with CSS zoom the player's own devicePixelRatio is exact, so it sizes and aligns its
      // canvas to whole screen pixels from that (cb-animate-bridge.js applyView).
      const exact = useCssZoom && !renderMode;
      // Thinnest outline in device pixels: 1.5 on 1× (Full HD) screens, Animate's outline weight there;
      // 1 on 4K / Retina screens, unchanged.
      const minStroke = screenDpr < 1.5 ? 1.5 : 1;
      // Seamless joins between touching pieces, as in Animate, on 1× screens (4K unchanged).
      const seal = screenDpr < 1.5 ? 0.5 : 0;
      const key = `${pixelScale}|${view.x}|${view.y}|${view.width}|${view.height}|${exact}|${minStroke}|${seal}|${dpr}`;
      if (lastViewKeyRef.current.get(object.id) === key) continue;
      lastViewKeyRef.current.set(object.id, key);
      lastViewSentRef.current.set(object.id, { pixelScale, ...view, exact, minStroke, seal });
      sendToPlayerNow(frame, { source: "characterbazaarstudio-editor", type: "SET_VIEW", pixelScale, ...view, exact, minStroke, seal });
    }
  }, [characterObjects, playhead, renderMode, useCssZoom, screenDpr]);
  const postCharacterViewsRef = useRef(postCharacterViews);
  postCharacterViewsRef.current = postCharacterViews;

  // Sharpness readout for diagnosing a screen (?cbdiag=1 in the address; never in render mode).
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  useEffect(() => { setShowDiagnostics(!renderMode && new URLSearchParams(window.location.search).get("cbdiag") === "1"); }, [renderMode]);
  const diagnosticsRef = useRef<() => RenderDiagnosticsInfo>(() => ({ stageZoom: 1, cssZoom: false, screenDpr: 1, browserZoomFactor: 1, frame: null, lastView: null }));
  diagnosticsRef.current = () => {
    const first = characterObjects.find((object) => frameRefs.current.get(object.id));
    return {
      stageZoom: effectiveScale,
      cssZoom: useCssZoom,
      screenDpr,
      browserZoomFactor,
      frame: first ? frameRefs.current.get(first.id) || null : null,
      lastView: first ? lastViewSentRef.current.get(first.id) || null : null,
    };
  };
  const readDiagnostics = useCallback(() => diagnosticsRef.current(), []);

  // Before paint, so a zoom or resize shows the players already redrawn for it. Zooming out grows
  // the visible region; sent a frame later, the old region was all that showed for a frame (flicker).
  // Skipped while a zoom step's pan correction is still to render (that render sends it).
  useLayoutEffect(() => {
    if (zoomPanPendingRef.current) {
      zoomPanPendingRef.current = false;
      const frameId = window.requestAnimationFrame(() => postCharacterViewsRef.current());
      return () => window.cancelAnimationFrame(frameId);
    }
    postCharacterViews();
  }, [postCharacterViews, effectiveScale, pan.x, pan.y, hostSize.width, hostSize.height, browserZoomFactor, screenDpr, readyCharacterIds]);

  useEffect(() => {
    const findObjectForSource = (source: MessageEventSource | null) => {
      for (const object of characterObjects) {
        const frame = frameRefs.current.get(object.id);
        if (frame?.contentWindow === source) return object;
      }
      return null;
    };
    const handlePlayerMessage = (event: MessageEvent) => {
      if (event.data?.source === "characterbazaarstudio-replacement") {
        const objectId = String(event.data.objectId || "");
        const partKey = String(event.data.partKey || "");
        const assetUrl = String(event.data.assetUrl || "");
        if (objectId && partKey && assetUrl) {
          const key = replacementReadyKey(objectId, partKey, assetUrl);
          if (event.data.type === "READY") {
            setReadyReplacementKeys((current) => {
              if (current.has(key)) return current;
              const next = new Set(current);
              next.add(key);
              return next;
            });
          } else if (event.data.type === "ERROR") {
            setReadyReplacementKeys((current) => {
              if (!current.has(key)) return current;
              const next = new Set(current);
              next.delete(key);
              return next;
            });
          }
        }
        return;
      }
      if (event.data?.source !== "characterbazaarstudio-animate") return;
      const object = findObjectForSource(event.source);
      if (!object) return;
      if (event.data?.type === "READY") {
        setReadyCharacterIds((current) => {
          if (current.has(object.id)) return current;
          const next = new Set(current);
          next.add(object.id);
          return next;
        });
        const readyParts = Array.isArray(event.data.parts)
          ? event.data.parts.filter((part: any) => part && part.key).map((part: any, index: number) => ({
              key: String(part.key),
              label: String(part.label || `Body Part ${String(index + 1).padStart(2, "0")}`),
              thumb: String(part.thumb || ""),
            }))
          : [];
        const sourceFrame = frameRefs.current.get(object.id);
        const isCameraFrame = Boolean(sourceFrame?.contentWindow === event.source && sourceFrame.classList.contains("cb-character-camera-frame"));
        const readySpace: "source" | "camera" = isCameraFrame ? "camera" : "source";
        if (Array.isArray(event.data.parts)) {
          event.data.parts.forEach((part: any) => {
            if (part?.key && part?.bounds) rememberPartBounds(object.id, part.bounds, readySpace, String(part.key));
          });
        }
        const rawBounds = isCameraFrame ? event.data?.sourceContentBounds : event.data?.contentBounds;
        const contentBounds = applyContentBounds(object, rawBounds);
        // The player (re)loaded: send it the current sharp-render view again.
        lastViewKeyRef.current.delete(object.id);
        window.requestAnimationFrame(() => postCharacterViewsRef.current());
        if (readyParts.length > 0) {
          onCharacterPartsReady?.(
            object.id,
            readyParts,
            Boolean(event.data.autoDetected),
            contentBounds ? { width: contentBounds.width, height: contentBounds.height } : undefined,
          );
        }
        window.setTimeout(() => {
          const frame = frameRefs.current.get(object.id);
          if (frame) postCharacterEdits(frame, object);
        }, 0);
        return;
      }
      if (event.data?.type === "ERROR") {
        // Keep the supplied SVG preview visible if the CreateJS source player cannot
        // initialize. This prevents a selected character from disappearing completely.
        setReadyCharacterIds((current) => {
          if (!current.has(object.id)) return current;
          const next = new Set(current);
          next.delete(object.id);
          return next;
        });
        return;
      }
      if (event.data?.type === "CONTENT_BOUNDS") {
        // The pose's artwork bounds changed (new frame): keep the selection box tight to it.
        applyContentBounds(object, event.data.contentBounds);
        return;
      }
      const currentFrame = frameRefs.current.get(object.id);
      const sourceSpace: "source" | "camera" = currentFrame?.classList.contains("cb-character-camera-frame") ? "camera" : "source";
      if (event.data?.type === "PART_SELECTED" && event.data.partKey) {
        rememberPartBounds(object.id, event.data.partBounds, sourceSpace, String(event.data.partKey));
        const viaDoubleClick = pendingPartDoubleClickRef.current.delete(object.id);
        pickCharacterPart(object.id, String(event.data.partKey), viaDoubleClick);
        return;
      }
      if (event.data?.type === "PART_BOUNDS" && event.data.partKey) {
        rememberPartBounds(object.id, event.data.partBounds, sourceSpace, String(event.data.partKey));
        return;
      }
      if (event.data?.type === "PART_DRAG_PREVIEW" && event.data.partKey) {
        const key = String(event.data.partKey);
        rememberPartBounds(object.id, event.data.partBounds, sourceSpace, key);
        setPreviewPartOverrides((state) => ({
          ...state,
          [object.id]: {
            ...(state[object.id] || {}),
            [key]: {
              ...(state[object.id]?.[key] || {}),
              offsetX: Number(event.data.offsetX || 0),
              offsetY: Number(event.data.offsetY || 0),
            },
          },
        }));
        return;
      }
      if (event.data?.type === "PART_DRAG_END" && event.data.partKey && onMoveCharacterPart) {
        const key = String(event.data.partKey);
        rememberPartBounds(object.id, event.data.partBounds, sourceSpace, key);
        setPreviewPartOverrides((state) => ({ ...state, [object.id]: { ...(state[object.id] || {}), [key]: {} } }));
        onSelect(object.id);
        onActiveCharacterPart?.(key);
        onMoveCharacterPart(object.id, key, Number(event.data.offsetX || 0), Number(event.data.offsetY || 0));
      }
    };
    window.addEventListener("message", handlePlayerMessage);
    return () => window.removeEventListener("message", handlePlayerMessage);
  }, [applyContentBounds, characterObjects, onActiveCharacterPart, onCharacterPartsReady, onMoveCharacterPart, onSelect, pickCharacterPart, postCharacterEdits, rememberPartBounds, replacementReadyKey]);

  useEffect(() => {
    // The editor owns the master clock. Keep the CreateJS source timeline paused and
    // seek it from the real-time editor playhead. This prevents exported source clips
    // from running faster than the 30 FPS timeline on high-refresh-rate displays.
    for (const object of characterObjects) {
      const frame = frameRefs.current.get(object.id);
      if (!frame) continue;
      frame.contentWindow?.postMessage({
        source: "characterbazaarstudio-editor",
        type: "PAUSE",
      }, "*");
    }
  }, [characterObjects, isPlaying, renderMode]);

  useEffect(() => {
    // Exact frame synchronization is used while paused, while playing, and by the
    // headless renderer. The player converts this time to its native source frame.
    for (const object of characterObjects) {
      const frame = frameRefs.current.get(object.id);
      if (!frame) continue;
      frame.contentWindow?.postMessage({
        source: "characterbazaarstudio-editor",
        type: "SEEK",
        seekMs: resolveSourceSeekMs(object, playhead),
        loop: object.loopMode === "loop",
      }, "*");
    }
  }, [characterObjects, isPlaying, playhead, renderMode, renderSeekRevision]);

  const beginDrag = (event: ReactPointerEvent<HTMLElement>, object: EditorObject, onClickWithoutDrag?: (clientX: number, clientY: number) => void) => {
    if (renderMode || object.type === "background" || object.type === "audio" || object.locked) return;
    if (spacePanning) return;
    event.preventDefault();
    event.stopPropagation();
    // Animate: Shift+click adds the object to (or removes it from) the selection; nothing moves.
    if (event.shiftKey && onSelectionChange) {
      onSelectionChange(selectedIds.includes(object.id) ? selectedIds.filter((id) => id !== object.id) : [...selectedIds, object.id]);
      return;
    }
    // Pressing on a member of a multi-selection drags the whole selection.
    const groupIds = selectedIds.length > 1 && selectedIds.includes(object.id) ? selectedIds : null;
    if (!groupIds) onSelect(object.id);
    const captureTarget = event.currentTarget;
    const target = captureTarget.closest<HTMLElement>("[data-editor-object-id]") || captureTarget;
    captureTarget.setPointerCapture?.(event.pointerId);
    const startClientX = event.clientX;
    const startClientY = event.clientY;

    // Body-part dragging for CreateJS characters is handled inside the same-origin
    // player iframe after a part has been selected.
    if (!groupIds && object.type === "character" && activeCharacterPart && object.id === selectedObjectId) return;

    const movers = (groupIds || [object.id]).flatMap((id) => {
      const item = objects.find((candidate) => candidate.id === id);
      if (!item || item.type === "background" || item.type === "audio") return [];
      const element = id === object.id
        ? target
        : hostRef.current?.querySelector<HTMLElement>(`[data-editor-object-id="${CSS.escape(id)}"]`) || null;
      const start = item.type === "character"
        ? resolveCharacterTransformAtTime(item, playhead)
        : { x: item.x, y: item.y, scale: item.scale || 1, rotation: item.rotation || 0 };
      return [{ item, element, start, x: start.x, y: start.y }];
    });
    let moved = false;
    const move = (moveEvent: PointerEvent) => {
      const dx = moveEvent.clientX - startClientX;
      const dy = moveEvent.clientY - startClientY;
      if (!moved && Math.hypot(dx, dy) < 3) return;
      moved = true;
      const pointerCompensation = renderMode ? 1 : browserZoomFactor;
      for (const mover of movers) {
        mover.x = clamp(mover.start.x + (dx * pointerCompensation) / effectiveScale, -width, width * 2);
        mover.y = clamp(mover.start.y + (dy * pointerCompensation) / effectiveScale, -height, height * 2);
        if (mover.element) {
          mover.element.style.left = `${mover.x}px`;
          mover.element.style.top = `${mover.y}px`;
        }
        if (mover.item.type === "character") {
          const frame = frameRefs.current.get(mover.item.id);
          if (frame) postCharacterEdits(frame, mover.item, undefined, { ...mover.start, x: mover.x, y: mover.y });
        }
      }
    };
    const up = (upEvent: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      if (moved && (event.altKey || upEvent.altKey) && onDuplicateMoved) {
        onDuplicateMoved(movers.map((mover) => ({ id: mover.item.id, x: mover.x, y: mover.y })));
      } else if (moved) {
        if (movers.length > 1 && onMoveMany) onMoveMany(movers.map((mover) => ({ id: mover.item.id, x: mover.x, y: mover.y })));
        else movers.forEach((mover) => onMove(mover.item.id, mover.x, mover.y));
      } else if (groupIds) {
        // A plain click on one member of a multi-selection selects just that object.
        onSelect(object.id);
      } else {
        onClickWithoutDrag?.(startClientX, startClientY);
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up, { once: true });
  };

  // Empty-stage press: drag draws an Animate-style selection marquee, a plain click deselects.
  const beginMarquee = (event: ReactPointerEvent<HTMLElement>) => {
    const host = hostRef.current;
    if (!host || renderMode || spacePanning || event.button !== 0) return;
    const hostRect = host.getBoundingClientRect();
    const startX = event.clientX;
    const startY = event.clientY;
    const additive = event.shiftKey;
    let dragging = false;
    const rectTo = (x: number, y: number) => ({
      left: Math.min(startX, x), top: Math.min(startY, y), right: Math.max(startX, x), bottom: Math.max(startY, y),
    });
    const move = (moveEvent: PointerEvent) => {
      if (!dragging && Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY) < 4) return;
      dragging = true;
      const rect = rectTo(moveEvent.clientX, moveEvent.clientY);
      setMarquee({ left: rect.left - hostRect.left, top: rect.top - hostRect.top, width: rect.right - rect.left, height: rect.bottom - rect.top });
    };
    const up = (upEvent: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setMarquee(null);
      if (!dragging) {
        if (additive) return;
        if (activeCharacterPart) onActiveCharacterPart?.(null);
        else onSelect(null);
        return;
      }
      const rect = rectTo(upEvent.clientX, upEvent.clientY);
      // Anything the marquee touches is selected; characters use their tight artwork box.
      const hits = objects.filter((item) => item.type !== "background" && item.type !== "audio" && !item.locked).filter((item) => {
        const element = host.querySelector<HTMLElement>(`[data-editor-object-id="${CSS.escape(item.id)}"]`);
        if (!element) return false;
        const box = (element.querySelector<HTMLElement>(".cb-character-tight-hitbox") || element).getBoundingClientRect();
        return box.width > 0 && box.right >= rect.left && box.left <= rect.right && box.bottom >= rect.top && box.top <= rect.bottom;
      }).map((item) => item.id);
      const next = additive ? Array.from(new Set([...selectedIds, ...hits])) : hits;
      if (onSelectionChange) onSelectionChange(next);
      else onSelect(next[0] ?? null);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const clientToWorld = (clientX: number, clientY: number) => {
    const rect = hostRef.current?.getBoundingClientRect();
    const compensation = renderMode ? 1 : browserZoomFactor;
    return {
      x: (((clientX - (rect?.left || 0)) * compensation) - fit.left - pan.x) / effectiveScale,
      y: (((clientY - (rect?.top || 0)) * compensation) - fit.top - pan.y) / effectiveScale,
    };
  };

  const OPPOSITE_HANDLE: Record<string, string> = { nw: "se", ne: "sw", se: "nw", sw: "ne", n: "s", s: "n", e: "w", w: "e" };

  // ---- Free Transform (Animate). Every drag previews by writing the DOM directly and commits
  // one onTransform on release, so a drag is a single undo step.
  type ScaleSession = {
    object: EditorObject;
    element: HTMLElement;
    start: CharacterTransform;
    stretch: { x: number; y: number };
  };
  const startScaleSession = (object: EditorObject, element: HTMLElement): ScaleSession => {
    const t = object.type === "character"
      ? resolveCharacterTransformAtTime(object, playhead)
      : { x: object.x, y: object.y, scale: object.scale || 1, rotation: object.rotation || 0 };
    return {
      object,
      element,
      start: { x: t.x, y: t.y, scale: Math.max(0.02, Number(t.scale || 1)), rotation: Number(t.rotation || 0) },
      stretch: stretchOf(object),
    };
  };
  /** Scale by (fx, fy) along the object's own axes about a fixed world point, and preview it.
   *  Uniform changes go to `scale`; non-uniform ones to `stretchX/Y`. */
  const previewScale = (session: ScaleSession, anchor: { x: number; y: number }, fxRaw: number, fyRaw: number, uniform: boolean) => {
    const { object, element, start, stretch } = session;
    let fx = fxRaw;
    let fy = fyRaw;
    let scale = start.scale;
    let stretchX = stretch.x;
    let stretchY = stretch.y;
    if (uniform) {
      fx = fy = clamp(fxRaw, 0.02 / start.scale, 20 / start.scale);
      scale = start.scale * fx;
    } else {
      fx = clamp(fxRaw, 0.02 / stretch.x, 50 / stretch.x);
      fy = clamp(fyRaw, 0.02 / stretch.y, 50 / stretch.y);
      stretchX = stretch.x * fx;
      stretchY = stretch.y * fy;
    }
    const local = toLocal(start.x - anchor.x, start.y - anchor.y, start.rotation);
    const moved = toWorld(local.x * fx, local.y * fy, start.rotation);
    const x = anchor.x + moved.x;
    const y = anchor.y + moved.y;
    element.style.left = `${x}px`;
    element.style.top = `${y}px`;
    if (object.type === "character") {
      Object.assign(element.style, characterBoxCss((object.sourceWidth || 1920) * scale * stretchX, (object.sourceHeight || 1920) * scale * stretchY));
      const frame = frameRefs.current.get(object.id);
      if (frame) postCharacterEdits(frame, object, undefined, { ...start, x, y, scale });
    } else {
      element.style.transform = layerTransformCss(object, start.rotation, scale, stretchX, stretchY);
    }
    return { x, y, scale, stretchX, stretchY };
  };
  const worldCentreOf = (element: Element) => {
    const rect = element.getBoundingClientRect();
    return clientToWorld(rect.left + rect.width / 2, rect.top + rect.height / 2);
  };

  const beginScale = (event: ReactPointerEvent<HTMLButtonElement>, object: EditorObject, handle = "se") => {
    if (renderMode || !onTransform) return;
    event.preventDefault();
    event.stopPropagation();
    onSelect(object.id);
    const element = event.currentTarget.closest<HTMLElement>("[data-editor-object-id]");
    const box = element?.querySelector<HTMLElement>(".cb-transform-box");
    const pivotElement = box?.querySelector<HTMLElement>(".cb-transform-center-point");
    if (!element || !box || !pivotElement) return;

    // Animate: a handle scales from the opposite handle; Option/Alt scales from the
    // registration point (both sides move); Shift keeps the proportions (corners).
    // Modifiers are read live, so they can be pressed or released mid-drag.
    const oppositeHandle = OPPOSITE_HANDLE[handle] || "nw";
    const oppositeElement = box.querySelector<HTMLElement>(`.cb-corner-${oppositeHandle} .cb-corner-scale-handle, .cb-transform-handle-${oppositeHandle}`);
    const pivotAnchor = worldCentreOf(pivotElement);
    const handleAnchor = oppositeElement ? worldCentreOf(oppositeElement) : pivotAnchor;
    const session = startScaleSession(object, element);
    const pointerStart = clientToWorld(event.clientX, event.clientY);
    const corner = handle.length === 2;
    const scalesX = corner || handle === "e" || handle === "w";
    const scalesY = corner || handle === "n" || handle === "s";
    const minSpan = 1 / Math.max(0.001, effectiveScale);
    let latest: ReturnType<typeof previewScale> | null = null;

    const move = (moveEvent: PointerEvent) => {
      const anchor = moveEvent.altKey ? pivotAnchor : handleAnchor;
      const pointer = clientToWorld(moveEvent.clientX, moveEvent.clientY);
      const from = toLocal(pointerStart.x - anchor.x, pointerStart.y - anchor.y, session.start.rotation);
      const to = toLocal(pointer.x - anchor.x, pointer.y - anchor.y, session.start.rotation);
      const uniform = corner && moveEvent.shiftKey;
      let fx = scalesX && Math.abs(from.x) > minSpan ? to.x / from.x : 1;
      let fy = scalesY && Math.abs(from.y) > minSpan ? to.y / from.y : 1;
      if (uniform) {
        // Project the pointer onto the handle's diagonal so both axes share one factor.
        const length = from.x * from.x + from.y * from.y;
        fx = fy = length > minSpan * minSpan ? (to.x * from.x + to.y * from.y) / length : 1;
      }
      latest = previewScale(session, anchor, fx, fy, uniform);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      if (latest) onTransform(object.id, latest);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up, { once: true });
  };

  // ---- Animate selection: a character is picked only where it is actually drawn. The pixel
  // under the pointer is read from the character's own player canvas; transparent pixels let
  // the press through to whatever is underneath (another object, or the empty canvas).
  const isCharacterPixelOpaque = (object: EditorObject, clientX: number, clientY: number) => {
    const frame = frameRefs.current.get(object.id);
    if (!frame) return true;
    try {
      const canvas = frame.contentDocument?.querySelector("canvas");
      if (!canvas || !canvas.width || !canvas.height) return true;
      const rotation = resolveCharacterTransformAtTime(object, playhead).rotation || 0;
      const point = playerPointFromClient(frame, rotation, skewOf(object), Boolean(object.flipX), clientX, clientY);
      if (!point) return false;
      // The canvas may cover only the visible part of the player (sharp rendering).
      const canvasRect = canvas.getBoundingClientRect();
      if (canvasRect.width <= 0 || canvasRect.height <= 0) return true;
      const px = Math.floor(((point.x - canvasRect.left) / canvasRect.width) * canvas.width);
      const py = Math.floor(((point.y - canvasRect.top) / canvasRect.height) * canvas.height);
      if (px < 0 || py < 0 || px >= canvas.width || py >= canvas.height) return false;
      const context = canvas.getContext("2d");
      if (!context) return true;
      // A 1-screen-px tolerance so thin outlines are still easy to click.
      const reach = Math.max(1, Math.round(canvas.width / Math.max(1, canvasRect.width)));
      const x0 = Math.max(0, px - reach), y0 = Math.max(0, py - reach);
      const data = context.getImageData(x0, y0, Math.min(canvas.width - x0, reach * 2 + 1), Math.min(canvas.height - y0, reach * 2 + 1)).data;
      for (let index = 3; index < data.length; index += 4) if (data[index] > 16) return true;
      return false;
    } catch {
      return true; // unreadable player: keep the bounding-box behaviour
    }
  };

  /** Where a press that fell on a transparent part of a character should go instead. */
  const pressTargetBelow = (clientX: number, clientY: number, skipId: string): HTMLElement | null => {
    for (const element of document.elementsFromPoint(clientX, clientY) as HTMLElement[]) {
      const owner = element.closest<HTMLElement>("[data-editor-object-id]");
      if (owner) {
        const id = owner.getAttribute("data-editor-object-id");
        if (!id || id === skipId) continue;
        if (element.classList.contains("cb-character-tight-hitbox")) {
          const below = objects.find((item) => item.id === id);
          if (below && isCharacterPixelOpaque(below, clientX, clientY)) return element;
          continue;
        }
        if (owner.matches(".cb-stage-text, .cb-stage-prop")) return element;
        continue;
      }
      if (element.classList.contains("cb-stage-world")) return element;
      if (element.closest(".cb-stage-background")) return element.closest<HTMLElement>(".cb-stage-world");
      if (element === hostRef.current || element.classList.contains("cb-browser-zoom-stable-viewport")) return element;
    }
    return hostRef.current;
  };

  const redirectTransparentPress = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (renderMode || event.button !== 0) return false;
    const hitbox = (event.target as HTMLElement).closest<HTMLElement>(".cb-character-tight-hitbox");
    if (!hitbox || hitbox.classList.contains("part-mode")) return false;
    const objectId = hitbox.closest<HTMLElement>("[data-editor-object-id]")?.getAttribute("data-editor-object-id");
    const object = objectId ? objects.find((item) => item.id === objectId) : undefined;
    if (!object || !objectId || isCharacterPixelOpaque(object, event.clientX, event.clientY)) return false;
    event.preventDefault();
    event.stopPropagation();
    const next = pressTargetBelow(event.clientX, event.clientY, objectId);
    next?.dispatchEvent(new PointerEvent("pointerdown", {
      bubbles: true, cancelable: true, composed: true,
      clientX: event.clientX, clientY: event.clientY, screenX: event.screenX, screenY: event.screenY,
      button: 0, buttons: event.buttons || 1, pointerId: event.pointerId, pointerType: event.pointerType, isPrimary: event.isPrimary,
      shiftKey: event.shiftKey, altKey: event.altKey, ctrlKey: event.ctrlKey, metaKey: event.metaKey,
    }));
    return true;
  };

  // Illustrator Scale tool (S): press anywhere and drag. The size follows the pointer's distance
  // from the registration point compared with where the press started: dragging away from it
  // makes the object bigger, towards it smaller (each of the object's own axes separately).
  // Shift keeps the proportions. It never flips through the registration point.
  const beginScaleToolDrag = (event: ReactPointerEvent<HTMLElement>) => {
    if (renderMode || !onTransform || toolMode !== "scale" || event.button !== 0 || selectedIds.length !== 1) return false;
    const target = event.target as HTMLElement;
    if (target.closest?.(".cb-transform-handle, .cb-rotate-handle, .cb-transform-center-point, .cb-whole-corner-control, .cb-skew-edge")) return false;
    const object = objects.find((item) => item.id === selectedIds[0]);
    const element = object ? hostRef.current?.querySelector<HTMLElement>(`[data-editor-object-id="${CSS.escape(object.id)}"]`) : null;
    const pivotElement = element?.querySelector<HTMLElement>(".cb-transform-center-point");
    if (!object || !element || !pivotElement) return false;
    event.preventDefault();
    event.stopPropagation();
    const anchor = worldCentreOf(pivotElement);
    const session = startScaleSession(object, element);
    const pointerStart = clientToWorld(event.clientX, event.clientY);
    const from = toLocal(pointerStart.x - anchor.x, pointerStart.y - anchor.y, session.start.rotation);
    // An axis the press started almost on top of the registration point can't be scaled (8 px).
    const minSpan = 8 / Math.max(0.001, effectiveScale);
    let latest: ReturnType<typeof previewScale> | null = null;
    const move = (moveEvent: PointerEvent) => {
      const pointer = clientToWorld(moveEvent.clientX, moveEvent.clientY);
      const to = toLocal(pointer.x - anchor.x, pointer.y - anchor.y, session.start.rotation);
      if (moveEvent.shiftKey) {
        const length = from.x * from.x + from.y * from.y;
        const factor = length > minSpan * minSpan ? (to.x * from.x + to.y * from.y) / length : 1;
        latest = previewScale(session, anchor, factor, factor, true);
      } else {
        const fx = Math.abs(from.x) > minSpan ? to.x / from.x : 1;
        const fy = Math.abs(from.y) > minSpan ? to.y / from.y : 1;
        latest = previewScale(session, anchor, fx, fy, false);
      }
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      if (latest) onTransform(object.id, latest);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up, { once: true });
    return true;
  };

  // Skew (Animate): drag a bounding-box edge. Top/bottom edges slant sideways (skew X),
  // left/right edges up and down (skew Y). The opposite edge stays put; Option/Alt skews
  // around the registration point instead. Shift snaps to 15°.
  const beginSkew = (event: ReactPointerEvent<HTMLElement>, object: EditorObject, edge: "top" | "bottom" | "left" | "right") => {
    if (renderMode || !onTransform) return;
    event.preventDefault();
    event.stopPropagation();
    onSelect(object.id);
    const element = event.currentTarget.closest<HTMLElement>("[data-editor-object-id]");
    const box = element?.querySelector<HTMLElement>(".cb-transform-box");
    if (!element || !box) return;
    const corner = (name: string) => {
      const handle = box.querySelector<HTMLElement>(`.cb-corner-${name} .cb-corner-scale-handle`);
      return handle ? worldCentreOf(handle) : null;
    };
    const nw = corner("nw"), ne = corner("ne"), se = corner("se"), sw = corner("sw");
    if (!nw || !ne || !se || !sw) return;
    const middle = (a: { x: number; y: number }, b: { x: number; y: number }) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
    const dragged = edge === "top" ? middle(nw, ne) : edge === "bottom" ? middle(sw, se) : edge === "left" ? middle(nw, sw) : middle(ne, se);
    const opposite = edge === "top" ? middle(sw, se) : edge === "bottom" ? middle(nw, ne) : edge === "left" ? middle(ne, se) : middle(nw, sw);
    const pivotElement = box.querySelector<HTMLElement>(".cb-transform-center-point");
    const pivot = pivotElement ? worldCentreOf(pivotElement) : opposite;
    const { start, stretch } = startScaleSession(object, element);
    const startSkew = skewOf(object);
    const tanX0 = Math.tan(startSkew.x * Math.PI / 180);
    const tanY0 = Math.tan(startSkew.y * Math.PI / 180);
    // Point in the object's unskewed local frame: q = K₀⁻¹ · R⁻¹ · (p − centre).
    const toUnskewed = (point: { x: number; y: number }) => {
      const local = toLocal(point.x - start.x, point.y - start.y, start.rotation);
      const det = 1 - tanX0 * tanY0 || 1;
      return { u: (local.x - tanX0 * local.y) / det, v: (-tanY0 * local.x + local.y) / det };
    };
    const draggedQ = toUnskewed(dragged);
    const pointerStart = clientToWorld(event.clientX, event.clientY);
    const sideways = edge === "top" || edge === "bottom";
    let latest: TransformPatch | null = null;

    const move = (moveEvent: PointerEvent) => {
      const anchor = moveEvent.altKey ? pivot : opposite;
      const anchorQ = toUnskewed(anchor);
      const pointer = clientToWorld(moveEvent.clientX, moveEvent.clientY);
      const delta = toLocal(pointer.x - pointerStart.x, pointer.y - pointerStart.y, start.rotation);
      let tanX = tanX0;
      let tanY = tanY0;
      if (sideways) {
        const span = draggedQ.v - anchorQ.v;
        if (Math.abs(span) > 0.001) tanX = tanX0 + delta.x / span;
      } else {
        const span = draggedQ.u - anchorQ.u;
        if (Math.abs(span) > 0.001) tanY = tanY0 + delta.y / span;
      }
      let skewX = clamp(Math.atan(tanX) * 180 / Math.PI, -MAX_SKEW, MAX_SKEW);
      let skewY = clamp(Math.atan(tanY) * 180 / Math.PI, -MAX_SKEW, MAX_SKEW);
      if (moveEvent.shiftKey) {
        if (sideways) skewX = Math.round(skewX / 15) * 15;
        else skewY = Math.round(skewY / 15) * 15;
      }
      tanX = Math.tan(skewX * Math.PI / 180);
      tanY = Math.tan(skewY * Math.PI / 180);
      // Keep the anchor where it was: centre = anchor − R · K · q(anchor).
      const skewed = { x: anchorQ.u + tanX * anchorQ.v, y: tanY * anchorQ.u + anchorQ.v };
      const offset = toWorld(skewed.x, skewed.y, start.rotation);
      const x = anchor.x - offset.x;
      const y = anchor.y - offset.y;
      const skew = { x: Math.round(skewX * 100) / 100, y: Math.round(skewY * 100) / 100 };
      element.style.left = `${x}px`;
      element.style.top = `${y}px`;
      element.style.transform = object.type === "character"
        ? characterTransformCss(object, start.rotation, skew)
        : layerTransformCss(object, start.rotation, start.scale, stretch.x, stretch.y, skew);
      latest = { x, y, skewX: skew.x, skewY: skew.y };
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      if (latest) onTransform(object.id, latest);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up, { once: true });
  };

  // Rotation turns about the registration point (Animate), so the centre orbits around it.
  const beginRotation = (event: ReactPointerEvent<HTMLElement>, object: EditorObject) => {
    if (renderMode || !onTransform) return;
    event.preventDefault();
    event.stopPropagation();
    onSelect(object.id);
    const element = event.currentTarget.closest<HTMLElement>("[data-editor-object-id]");
    const box = element?.querySelector<HTMLElement>(".cb-transform-box");
    if (!element || !box) return;
    const pivotRect = (box.querySelector<HTMLElement>(".cb-transform-center-point") || box).getBoundingClientRect();
    const pivotClientX = pivotRect.left + pivotRect.width / 2;
    const pivotClientY = pivotRect.top + pivotRect.height / 2;
    const pivot = clientToWorld(pivotClientX, pivotClientY);
    const startPointerAngle = pointerAngle(event.clientX, event.clientY, pivotClientX, pivotClientY);
    const { start, stretch } = startScaleSession(object, element);
    let latest = { x: start.x, y: start.y, rotation: start.rotation };

    const move = (moveEvent: PointerEvent) => {
      const nowAngle = pointerAngle(moveEvent.clientX, moveEvent.clientY, pivotClientX, pivotClientY);
      const raw = normalizeDegrees(start.rotation + (nowAngle - startPointerAngle));
      const rotation = moveEvent.shiftKey ? Math.round(raw / 45) * 45 : raw;
      const orbit = toWorld(start.x - pivot.x, start.y - pivot.y, rotation - start.rotation);
      latest = { x: pivot.x + orbit.x, y: pivot.y + orbit.y, rotation };
      element.style.left = `${latest.x}px`;
      element.style.top = `${latest.y}px`;
      if (object.type === "character") {
        element.style.transform = characterTransformCss(object, rotation);
        const frame = frameRefs.current.get(object.id);
        if (frame) postCharacterEdits(frame, object, undefined, { ...start, ...latest });
      } else {
        element.style.transform = layerTransformCss(object, rotation, start.scale, stretch.x, stretch.y);
      }
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      onTransform(object.id, latest);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up, { once: true });
  };

  // The registration point can sit anywhere, even off the object; double-click re-centres it.
  const beginPivotDrag = (event: ReactPointerEvent<HTMLButtonElement>, object: EditorObject) => {
    if (renderMode || !onTransform) return;
    event.preventDefault();
    event.stopPropagation();
    onSelect(object.id);
    const marker = event.currentTarget;
    const transformBox = marker.closest<HTMLElement>(".cb-transform-box");
    if (!transformBox) return;
    // Map the pointer into the box's own axes using its corner handles, which already
    // carry the object's rotation, flip and stretch: p = nw + a·(ne − nw) + b·(sw − nw).
    const cornerAt = (corner: string) => {
      const handle = transformBox.querySelector<HTMLElement>(`.cb-corner-${corner} .cb-corner-scale-handle`);
      if (!handle) return null;
      const rect = handle.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    };
    const nw = cornerAt("nw");
    const ne = cornerAt("ne");
    const sw = cornerAt("sw");
    if (!nw || !ne || !sw) return;
    const ux = ne.x - nw.x, uy = ne.y - nw.y, vx = sw.x - nw.x, vy = sw.y - nw.y;
    const determinant = ux * vy - uy * vx;
    if (Math.abs(determinant) < 1) return;
    let latestX = object.pivotX ?? 0.5;
    let latestY = object.pivotY ?? 0.5;
    let moved = false;

    const move = (moveEvent: PointerEvent) => {
      moved = true;
      const px = moveEvent.clientX - nw.x;
      const py = moveEvent.clientY - nw.y;
      latestX = clamp((px * vy - py * vx) / determinant, PIVOT_MIN, PIVOT_MAX);
      latestY = clamp((ux * py - uy * px) / determinant, PIVOT_MIN, PIVOT_MAX);
      marker.style.left = `${latestX * 100}%`;
      marker.style.top = `${latestY * 100}%`;
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      if (moved) onTransform(object.id, { pivotX: latestX, pivotY: latestY });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up, { once: true });
  };

  const previewCharacterPartTransform = useCallback((object: EditorObject, partKey: CharacterPartKey, patch: Partial<{ offsetX: number; offsetY: number; rotation: number; scale: number; stretchX: number; stretchY: number; flipX: boolean; skewX: number; skewY: number; pivotX: number; pivotY: number }>) => {
    const frame = frameRefs.current.get(object.id);
    if (!frame) return;
    const resolved = resolvePartOverridesAtTime(object, playhead);
    const current = resolved[partKey] || resolvePartTransformAtTime(object, partKey, playhead);
    const nextOverride = { ...current, ...patch };
    setPreviewPartOverrides((state) => ({
      ...state,
      [object.id]: { ...(state[object.id] || {}), [partKey]: nextOverride },
    }));
    postCharacterEdits(frame, object, {
      ...resolved,
      [partKey]: { ...(object.partOverrides?.[partKey] || {}), ...nextOverride },
    });
  }, [playhead, postCharacterEdits]);

  const beginCharacterPartScale = (event: ReactPointerEvent<HTMLButtonElement>, object: EditorObject) => {
    if (renderMode || !activeCharacterPart || !onTransformCharacterPart) return;
    event.preventDefault();
    event.stopPropagation();
    const box = event.currentTarget.closest<HTMLElement>(".cb-character-part-hitbox");
    if (!box) return;
    // The part turns and scales about its registration point, so measure from the pivot dot.
    const rect = (box.querySelector(".cb-part-pivot-point") || box).getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const startDistance = Math.max(6, Math.hypot(event.clientX - centerX, event.clientY - centerY));
    const current = resolvePartTransformAtTime(object, activeCharacterPart, playhead);
    const startScale = Math.max(0.02, Number(current.scale || 1));
    let latestScale = startScale;

    const move = (moveEvent: PointerEvent) => {
      const distance = Math.max(3, Math.hypot(moveEvent.clientX - centerX, moveEvent.clientY - centerY));
      latestScale = clamp(startScale * distance / startDistance, 0.05, 20);
      previewCharacterPartTransform(object, activeCharacterPart, { scale: latestScale });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setPreviewPartOverrides((state) => ({ ...state, [object.id]: { ...(state[object.id] || {}), [activeCharacterPart]: {} } }));
      onTransformCharacterPart(object.id, activeCharacterPart, { scale: latestScale });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up, { once: true });
  };

  const beginCharacterPartRotation = (event: ReactPointerEvent<HTMLElement>, object: EditorObject) => {
    if (renderMode || !activeCharacterPart || !onTransformCharacterPart) return;
    event.preventDefault();
    event.stopPropagation();
    const box = event.currentTarget.closest<HTMLElement>(".cb-character-part-hitbox");
    if (!box) return;
    // The part turns and scales about its registration point, so measure from the pivot dot.
    const rect = (box.querySelector(".cb-part-pivot-point") || box).getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const startPointerAngle = pointerAngle(event.clientX, event.clientY, centerX, centerY);
    const current = resolvePartTransformAtTime(object, activeCharacterPart, playhead);
    const startRotation = Number(current.rotation || 0);
    let latestRotation = startRotation;

    const move = (moveEvent: PointerEvent) => {
      const nowAngle = pointerAngle(moveEvent.clientX, moveEvent.clientY, centerX, centerY);
      const raw = normalizeDegrees(startRotation + (nowAngle - startPointerAngle));
      latestRotation = moveEvent.shiftKey ? Math.round(raw / 45) * 45 : raw;
      previewCharacterPartTransform(object, activeCharacterPart, { rotation: latestRotation });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setPreviewPartOverrides((state) => ({ ...state, [object.id]: { ...(state[object.id] || {}), [activeCharacterPart]: {} } }));
      onTransformCharacterPart(object.id, activeCharacterPart, { rotation: latestRotation });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up, { once: true });
  };

  // Registration point: drag the dot to move it (the part stays put, as in Animate); double-click
  // resets it to bottom-centre. The player does the stage-space maths for the current edit.
  type PivotResult = { pivotX: number; pivotY: number; dx: number; dy: number; offsetX: number; offsetY: number };
  const partPivotAt = (object: EditorObject, partKey: string, clientX: number, clientY: number, reset: boolean): PivotResult | null => {
    const frame = frameRefs.current.get(object.id);
    const rect = frame?.getBoundingClientRect();
    if (!frame || !rect || rect.width <= 0 || rect.height <= 0) return null;
    try {
      const fn = (frame.contentWindow as (Window & { cbPartPivotAt?: (key: string, x: number, y: number, reset: boolean, saved: object) => PivotResult | null }) | null)?.cbPartPivotAt;
      // Measured against the saved edit at the playhead (not a drag preview), so the commit's compensation is exact.
      const saved = resolvePartOverridesAtTime(object, playhead)[partKey] || {};
      return typeof fn === "function" ? fn(partKey, (clientX - rect.left) / rect.width, (clientY - rect.top) / rect.height, reset, saved) : null;
    } catch { return null; }
  };
  const beginPartPivotDrag = (event: ReactPointerEvent<HTMLElement>, object: EditorObject) => {
    if (renderMode || !activeCharacterPart || !onSetCharacterPartPivot) return;
    event.preventDefault();
    event.stopPropagation();
    const partKey = activeCharacterPart;
    let latest: PivotResult | null = null;
    const move = (moveEvent: PointerEvent) => {
      latest = partPivotAt(object, partKey, moveEvent.clientX, moveEvent.clientY, false);
      if (latest) previewCharacterPartTransform(object, partKey, { pivotX: latest.pivotX, pivotY: latest.pivotY, offsetX: latest.offsetX, offsetY: latest.offsetY });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setPreviewPartOverrides((state) => ({ ...state, [object.id]: { ...(state[object.id] || {}), [partKey]: {} } }));
      const result = latest as PivotResult | null;
      if (result) onSetCharacterPartPivot(object.id, partKey, result.pivotX, result.pivotY, result.dx, result.dy);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up, { once: true });
  };
  const resetPartPivot = (event: ReactMouseEvent<HTMLElement>, object: EditorObject) => {
    event.preventDefault();
    event.stopPropagation();
    if (!activeCharacterPart || !onSetCharacterPartPivot) return;
    const result = partPivotAt(object, activeCharacterPart, 0, 0, true);
    if (result) onSetCharacterPartPivot(object.id, activeCharacterPart, result.pivotX, result.pivotY, result.dx, result.dy);
  };

  // Skew: drag an edge of the part box (top/bottom slant sideways, left/right slant up and down),
  // about the registration point. The player turns the drag into skew angles in stage space.
  const beginCharacterPartSkew = (event: ReactPointerEvent<HTMLElement>, object: EditorObject, edge: "top" | "bottom" | "left" | "right") => {
    if (renderMode || !activeCharacterPart || !onTransformCharacterPart) return;
    event.preventDefault();
    event.stopPropagation();
    const partKey = activeCharacterPart;
    const frame = frameRefs.current.get(object.id);
    const rect = frame?.getBoundingClientRect();
    if (!frame || !rect || rect.width <= 0 || rect.height <= 0) return;
    const solve = (frame.contentWindow as (Window & { cbPartSkewAt?: (key: string, edge: string, x0: number, y0: number, x1: number, y1: number, saved: object) => { skewX: number; skewY: number } | null }) | null)?.cbPartSkewAt;
    if (typeof solve !== "function") return;
    const saved = resolvePartOverridesAtTime(object, playhead)[partKey] || {};
    const x0 = (event.clientX - rect.left) / rect.width, y0 = (event.clientY - rect.top) / rect.height;
    let latest: { skewX: number; skewY: number } | null = null;
    const move = (moveEvent: PointerEvent) => {
      try { latest = solve(partKey, edge, x0, y0, (moveEvent.clientX - rect.left) / rect.width, (moveEvent.clientY - rect.top) / rect.height, saved); } catch { latest = null; }
      if (latest) previewCharacterPartTransform(object, partKey, latest);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setPreviewPartOverrides((state) => ({ ...state, [object.id]: { ...(state[object.id] || {}), [partKey]: {} } }));
      if (latest) onTransformCharacterPart(object.id, partKey, latest);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up, { once: true });
  };

  // Stretch (side handles of the part box, like Animate's): top/bottom change the height, left/right
  // the width, about the registration point. Progress is measured along the part's own width (or
  // height) direction on screen, from the opposite side's handle to this one, so the dragged side
  // follows the pointer under any rotation, skew or zoom and wherever the registration point is.
  // Shift scales both ways (uniform scale) instead.
  const beginCharacterPartStretch = (event: ReactPointerEvent<HTMLElement>, object: EditorObject, side: "n" | "e" | "s" | "w") => {
    if (renderMode || !activeCharacterPart || !onTransformCharacterPart) return;
    event.preventDefault();
    event.stopPropagation();
    const partKey = activeCharacterPart;
    const box = event.currentTarget.closest<HTMLElement>(".cb-character-part-hitbox");
    if (!box) return;
    const centre = (element: Element | null) => { const r = (element || box).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; };
    const pivot = centre(box.querySelector(".cb-part-pivot-point"));
    const handle = centre(event.currentTarget);
    const opposite = centre(box.querySelector(`.cb-part-stretch-handle.${{ n: "s", s: "n", e: "w", w: "e" }[side]}`));
    const ax = handle.x - opposite.x, ay = handle.y - opposite.y, axisLength = Math.hypot(ax, ay);
    if (axisLength < 1) return;
    const ux = ax / axisLength, uy = ay / axisLength;
    const startReach = (handle.x - pivot.x) * ux + (handle.y - pivot.y) * uy;
    if (Math.abs(startReach) < 4) return; // the registration point sits on this side: nothing to stretch from
    const current = resolvePartTransformAtTime(object, partKey, playhead);
    const axis = side === "n" || side === "s" ? "stretchY" : "stretchX";
    const startScale = Math.max(0.02, Number(current.scale || 1)), startStretch = Math.max(0.02, Number(current[axis] ?? 1));
    let latest: Partial<Record<"scale" | "stretchX" | "stretchY", number>> | null = null;
    const move = (moveEvent: PointerEvent) => {
      const factor = clamp(((moveEvent.clientX - pivot.x) * ux + (moveEvent.clientY - pivot.y) * uy) / startReach, 0.05, 20);
      latest = moveEvent.shiftKey
        ? { scale: clamp(startScale * factor, 0.05, 20), [axis]: startStretch }
        : { scale: startScale, [axis]: clamp(startStretch * factor, 0.05, 20) };
      previewCharacterPartTransform(object, partKey, latest);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setPreviewPartOverrides((state) => ({ ...state, [object.id]: { ...(state[object.id] || {}), [partKey]: {} } }));
      if (latest) onTransformCharacterPart(object.id, partKey, latest);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up, { once: true });
  };

  // Part editing state for the canvas: the selected character with one of its parts open.
  const partEditing = !renderMode && Boolean(activeCharacterPart) && Boolean(selectedObjectId);
  const selectedObject = partEditing ? data.objects.find((item) => item.id === selectedObjectId) || null : null;
  const isInsideSelectedCharacter = (target: EventTarget | null) => {
    const element = target as HTMLElement | null;
    if (!element?.closest) return false;
    if (element.closest(".cb-character-part-hitbox, .cb-character-part-hitbox-camera, .cb-persistent-part-replacement-camera")) return true;
    return element.closest("[data-editor-object-id]")?.getAttribute("data-editor-object-id") === selectedObjectId;
  };

  // Is any of the character's artwork under the pointer (within ~2 screen px)? Rigs with named parts
  // answer from the player's per-part pixel test; others fall back to the rendered-canvas check.
  const isCharacterArtworkAt = (object: EditorObject, clientX: number, clientY: number) => {
    const frame = frameRefs.current.get(object.id);
    const rect = frame?.getBoundingClientRect();
    if (frame && rect && rect.width > 0 && rect.height > 0) {
      try {
        const anyPart = (frame.contentWindow as (Window & { cbAnyPartAt?: (x: number, y: number, tol: number) => string | null }) | null)?.cbAnyPartAt;
        const found = typeof anyPart === "function" ? anyPart((clientX - rect.left) / rect.width, (clientY - rect.top) / rect.height, 2 / rect.width) : null;
        if (typeof found === "string") return found !== "";
      } catch { /* fall through */ }
    }
    return isCharacterPixelOpaque(object, clientX, clientY);
  };

  // Is there artwork of this part under the pointer? Asks the (same-origin) player; unknown → yes.
  const isPartPixelAt = (object: EditorObject, partKey: string, clientX: number, clientY: number) => {
    const frame = frameRefs.current.get(object.id);
    const rect = frame?.getBoundingClientRect();
    if (!frame || !rect || rect.width <= 0 || rect.height <= 0) return true;
    try {
      const test = (frame.contentWindow as (Window & { cbPartHitTest?: (key: string, x: number, y: number) => boolean | null }) | null)?.cbPartHitTest;
      return typeof test !== "function" || test(partKey, (clientX - rect.left) / rect.width, (clientY - rect.top) / rect.height) !== false;
    } catch { return true; }
  };

  // Like the Selection (V) tool, only the part's own artwork grabs it. A press on blank space in
  // its box picks another part of the character under the pointer, if any.
  const pressPartBox = (event: ReactPointerEvent<HTMLElement>, object: EditorObject) => {
    if (!activeCharacterPart) return;
    if (object.partReplacements?.[activeCharacterPart]?.assetUrl) { beginReplacementPartDrag(event, object, activeCharacterPart); return; }
    // Inside an entered part a press picks its piece; Shift+click adds shapes to a shape selection.
    if ((characterPartEntered || event.shiftKey) && pressSubPart(object, event.clientX, event.clientY, event.shiftKey)) { event.preventDefault(); event.stopPropagation(); return; }
    if (isPartPixelAt(object, activeCharacterPart, event.clientX, event.clientY)) { beginCharacterPartDrag(event, object); return; }
    // A selected piece: a press on another piece of the same part selects that one.
    if (activeCharacterPart.includes("/") && pressSubPart(object, event.clientX, event.clientY, false)) { event.preventDefault(); event.stopPropagation(); return; }
    event.preventDefault();
    event.stopPropagation();
    // Blank space does nothing on a single press; part editing closes on a double-click outside.
    if (isCharacterArtworkAt(object, event.clientX, event.clientY)) requestCharacterPartAtPoint(object, event.clientX, event.clientY);
  };

  const renderPartTransformControls = (object: EditorObject) => (
    <>
      {(["nw", "ne", "se", "sw"] as const).map((handle) => (
        <span key={`part-corner-${handle}`} className={`cb-part-corner-control cb-corner-${handle}`}>
          <button
            type="button"
            className="cb-part-scale-handle"
            onPointerDown={(event) => beginCharacterPartScale(event, object)}
            title="Scale selected group"
            aria-label={`Scale selected body-part group ${handle}`}
          />
          <button
            type="button"
            className="cb-rotate-handle cb-part-rotate-handle"
            onPointerDown={(event) => beginCharacterPartRotation(event, object)}
            title="Rotate selected group. Hold Shift to snap 45°"
            aria-label={`Rotate selected body-part group ${handle}`}
          >↻</button>
        </span>
      ))}
      {/* No ⇄ flip button: Reflect (O, then Enter) mirrors a part on any axis. */}
      {(["top", "bottom", "left", "right"] as const).map((edge) => (
        <b key={`part-skew-${edge}`} className={`cb-part-skew-edge ${edge}`} onPointerDown={(event) => beginCharacterPartSkew(event, object, edge)}
          style={{ cursor: skewCursorFor(edge, activeCharacterPart ? Number(getLivePartTransform(object, activeCharacterPart).rotation || 0) : 0) }}
          title="Skew: drag along this edge" />
      ))}
      {(["n", "e", "s", "w"] as const).map((side) => {
        const live = activeCharacterPart ? getLivePartTransform(object, activeCharacterPart) : null;
        return (
          <button key={`part-stretch-${side}`} type="button" className={`cb-part-stretch-handle ${side}`}
            onPointerDown={(event) => beginCharacterPartStretch(event, object, side)}
            style={{ cursor: handleCursor(side, Number(live?.rotation || 0), Boolean(live?.flipX)) }}
            title={side === "n" || side === "s" ? "Stretch the height (Shift = scale both ways)" : "Stretch the width (Shift = scale both ways)"}
            aria-label={`Stretch selected body-part group ${side === "n" ? "top" : side === "s" ? "bottom" : side === "e" ? "right" : "left"}`} />
        );
      })}
      {/* Registration point, like the V tool's: the part rotates and scales about it. Drag to move, double-click to reset. */}
      {activeCharacterPart && (() => {
        const pivot = livePartPivot(object, activeCharacterPart);
        return (
          <span
            className="cb-part-pivot-point"
            style={{ left: `${pivot.x * 100}%`, top: `${pivot.y * 100}%` }}
            onPointerDown={(event) => beginPartPivotDrag(event, object)}
            onDoubleClick={(event) => resetPartPivot(event, object)}
            title="Registration point: drag to move where this part rotates and scales from. Double-click to reset."
          />
        );
      })()}
    </>
  );

  const renderCharacterTightHitArea = (object: EditorObject, selected: boolean) => {
    if (renderMode || object.type !== "character") return null;
    const partMode = selected && Boolean(activeCharacterPart);
    // Keep an invisible full-character hit area behind the active part. This lets
    // a double-click on a different body part switch groups immediately while the
    // visible whole-character selection box remains closed during part edit mode.
    return (
      <div
        className={`cb-character-tight-hitbox ${selected ? "selected" : ""} ${partMode ? "part-mode" : ""}`}
        style={getWholeCharacterGroupBoxStyle(object)}
        onPointerDown={(event) => {
          if (partMode) {
            event.preventDefault();
            event.stopPropagation();
            if (pressSubPart(object, event.clientX, event.clientY, event.shiftKey)) return;
            requestCharacterPartAtPoint(object, event.clientX, event.clientY);
            return;
          }
          // Animate: a click selects the whole character (symbol); double-click goes inside it
          // to select a body part (handled by onDoubleClick below).
          beginDrag(event, object);
        }}
        onDoubleClick={(event) => {
          // A double-click on a transparent spot does not enter the character.
          if (!isCharacterPixelOpaque(object, event.clientX, event.clientY)) return;
          event.preventDefault();
          event.stopPropagation();
          if (partMode && doubleClickSubPart(object, event.clientX, event.clientY)) return;
          onSelect(object.id);
          requestCharacterPartAtPoint(object, event.clientX, event.clientY, true);
        }}
        title={selected ? "Drag to move. Double-click a body part to edit just that part." : "Click to select the character. Double-click to edit a body part."}
      />
    );
  };

  const getLivePartTransform = (object: EditorObject, partKey: string): PartTransform => {
    const base = resolvePartTransformAtTime(object, partKey, playhead);
    const preview = previewPartOverrides[object.id]?.[partKey] || {};
    return { ...base, ...preview, scale: Math.max(0.02, Number(preview.scale ?? base.scale ?? 1)), flipX: typeof preview.flipX === "boolean" ? preview.flipX : Boolean(base.flipX) };
  };

  const getPartControlScreenScale = (object: EditorObject, partKey: string, space: "source" | "camera") => {
    const partScale = Math.max(0.02, Math.abs(Number(getLivePartTransform(object, partKey).scale || 1)));
    // Controls inherit every transform above them. In source mode that is:
    //   stage-world zoom × selected-part scale × browser-zoom counter scale.
    // In camera mode the stage-world scale is not inherited, only part scale and
    // the browser-zoom counter scale are. Divide control dimensions by this exact
    // visual scale so buttons stay the same physical screen size at every zoom.
    const inheritedScale = space === "source"
      ? (effectiveScale * partScale) / Math.max(0.001, browserZoomFactor)
      : partScale / Math.max(0.001, browserZoomFactor);
    return Math.max(0.02, inheritedScale);
  };

  // Registration point of a part (fraction of its box), including a pivot drag in progress.
  const livePartPivot = (object: EditorObject, partKey: string) => {
    const preview = previewPartOverrides[object.id]?.[partKey] || {};
    const saved = object.partOverrides?.[partKey] || {};
    return { x: Number(preview.pivotX ?? saved.pivotX ?? 0.5), y: Number(preview.pivotY ?? saved.pivotY ?? 1) };
  };
  /** A part's box widened / heightened by its stretch about the registration point. Stretch is the
   *  innermost step of A = R·K·S, so this plus the box's usual transform matches the player exactly,
   *  and the handles inside the box keep their uniform counter-scale. */
  const stretchPartBounds = <B extends { x: number; y: number; width: number; height: number }>(object: EditorObject, partKey: string, bounds: B): B => {
    const live = getLivePartTransform(object, partKey);
    const sx = Math.max(0.02, Number(live.stretchX ?? 1)), sy = Math.max(0.02, Number(live.stretchY ?? 1));
    if (sx === 1 && sy === 1) return bounds;
    const pivot = livePartPivot(object, partKey);
    return { ...bounds, x: bounds.x + pivot.x * bounds.width * (1 - sx), y: bounds.y + pivot.y * bounds.height * (1 - sy), width: bounds.width * sx, height: bounds.height * sy };
  };

  const getReplacementTransformStyle = (object: EditorObject, partKey: string, space: "source" | "camera") => {
    const transform = getLivePartTransform(object, partKey);
    const characterTransform = resolveCharacterTransformAtTime(object, playhead);
    const characterScale = Math.max(0.02, Number(characterTransform.scale || 1));
    const translateX = Number(transform.offsetX || 0) * characterScale * (space === "camera" ? effectiveScale : 1);
    const translateY = Number(transform.offsetY || 0) * characterScale * (space === "camera" ? effectiveScale : 1);
    const scale = Math.max(0.02, Number(transform.scale || 1));
    const pivot = livePartPivot(object, partKey);
    return {
      transformOrigin: `${pivot.x * 100}% ${pivot.y * 100}%`,
      // Same order as the player's A = R·K·S: scale (incl. flip), then skew, then rotate.
      transform: `translate(${translateX}px, ${translateY}px) rotate(${Number(transform.rotation || 0)}deg) skew(${Number(transform.skewX || 0)}deg, ${Number(transform.skewY || 0)}deg) scale(${transform.flipX ? -scale : scale}, ${scale})`,
    } as const;
  };

  const resolveEditablePartEntry = (object: EditorObject, partKey: string, desiredSpace: "source" | "camera") => {
    if (object.partReplacements?.[partKey]?.assetUrl) return resolveReplacementEntry(object, partKey, desiredSpace);
    const live = characterPartBounds[object.id];
    if (live && live.space === desiredSpace) return live;
    return null;
  };

  const beginReplacementPartDrag = (event: ReactPointerEvent<HTMLElement>, object: EditorObject, partKey: CharacterPartKey) => {
    if (renderMode || !onTransformCharacterPart || spacePanning) return;
    event.preventDefault();
    event.stopPropagation();
    onSelect(object.id);
    onActiveCharacterPart?.(partKey);

    // First double-click/select establishes part-edit mode. Once active, dragging the
    // replacement moves the replacement itself rather than the hidden source part.
    if (activeCharacterPart !== partKey) return;

    const pointerId = event.pointerId;
    let startClientX = event.clientX;
    let startClientY = event.clientY;
    const hold = holdToMove(event.clientX, event.clientY, event.currentTarget as HTMLElement, (x, y) => { startClientX = x; startClientY = y; });
    const current = getLivePartTransform(object, partKey);
    const startOffsetX = Number(current.offsetX || 0);
    const startOffsetY = Number(current.offsetY || 0);
    const characterTransform = resolveCharacterTransformAtTime(object, playhead);
    const renderedScale = Math.max(0.0001, Number(characterTransform.scale || 1) * effectiveScale);
    const characterRotation = Number(characterTransform.rotation || 0) * Math.PI / 180;
    const flip = object.flipX ? -1 : 1;
    let latestX = startOffsetX;
    let latestY = startOffsetY;

    const move = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) return;
      if (!hold.move(moveEvent)) return; // not held long enough yet: the part stays put
      const pointerCompensation = renderMode ? 1 : browserZoomFactor;
      const screenDx = (moveEvent.clientX - startClientX) * pointerCompensation;
      const screenDy = (moveEvent.clientY - startClientY) * pointerCompensation;
      // Convert screen delta back into the source-character coordinate system.
      const localDx = (screenDx * Math.cos(characterRotation) + screenDy * Math.sin(characterRotation)) / renderedScale * flip;
      const localDy = (-screenDx * Math.sin(characterRotation) + screenDy * Math.cos(characterRotation)) / renderedScale;
      latestX = startOffsetX + localDx;
      latestY = startOffsetY + localDy;
      setPreviewPartOverrides((state) => ({
        ...state,
        [object.id]: {
          ...(state[object.id] || {}),
          [partKey]: { ...(state[object.id]?.[partKey] || {}), offsetX: latestX, offsetY: latestY },
        },
      }));
    };

    const up = (upEvent: PointerEvent) => {
      if (upEvent.pointerId !== pointerId) return;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      setPreviewPartOverrides((state) => ({ ...state, [object.id]: { ...(state[object.id] || {}), [partKey]: {} } }));
      if (hold.end() && (latestX !== startOffsetX || latestY !== startOffsetY)) onTransformCharacterPart(object.id, partKey, { offsetX: latestX, offsetY: latestY });
    };

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };

  const renderReplacementContent = (object: EditorObject, partKey: string, replacement: NonNullable<EditorObject["partReplacements"]>[string], label: string) => {
    if (replacement.renderKind === "source-symbol") {
      const effectiveAssetUrl = replacement.assetUrl;
      const separator = effectiveAssetUrl.includes("?") ? "&" : "?";
      const src = `${effectiveAssetUrl}${separator}objectId=${encodeURIComponent(object.id)}&partKey=${encodeURIComponent(partKey)}&assetUrl=${encodeURIComponent(replacement.assetUrl)}`;
      return (
        <iframe
          ref={(node) => {
            const key = `${object.id}::${partKey}`;
            if (node) replacementFrameRefs.current.set(key, node);
            else replacementFrameRefs.current.delete(key);
          }}
          src={src}
          title={replacement.name || label}
          className="cb-part-replacement-source-frame"
          tabIndex={-1}
          onLoad={(event) => postReplacementSeek(event.currentTarget)}
        />
      );
    }
    return <img src={replacement.assetUrl} alt={replacement.name || label} className="cb-part-replacement-preview" draggable={false} />;
  };

  const fallbackReplacementBounds = (object: EditorObject, partKey: string): PartBoundsEntry | null => {
    const key = String(partKey || "").toLowerCase();
    if (String(object.characterId || "").startsWith("html5:")) {
      if (key === "head") return { space: "source", bounds: { x: 0.36, y: 0.067, width: 0.28, height: 0.172 } };
      if (key === "torso") return { space: "source", bounds: { x: 0.29, y: 0.25, width: 0.42, height: 0.34 } };
      if (key === "lefthand") return { space: "source", bounds: { x: 0.235, y: 0.50, width: 0.115, height: 0.155 } };
      if (key === "righthand") return { space: "source", bounds: { x: 0.65, y: 0.50, width: 0.115, height: 0.155 } };
      if (key === "leftleg") return { space: "source", bounds: { x: 0.345, y: 0.69, width: 0.145, height: 0.245 } };
      if (key === "rightleg") return { space: "source", bounds: { x: 0.51, y: 0.69, width: 0.145, height: 0.245 } };
    }
    return null;
  };

  const resolveReplacementEntry = (object: EditorObject, partKey: string, desiredSpace: "source" | "camera"): PartBoundsEntry | null => {
    const saved = savedPartBounds[object.id]?.[partKey];
    if (saved && saved.space === desiredSpace && desiredSpace === "camera") return saved;
    if (desiredSpace === "source") {
      // Prefer the exact source-part bounds captured BEFORE the old part is hidden.
      // This makes a replacement occupy the old head/hand/body slot rather than a
      // guessed character-relative rectangle.
      if (saved && saved.space === "source") {
        const b = saved.bounds;
        const sane = b.width > 0.025 && b.width < 0.65 && b.height > 0.025 && b.height < 0.65;
        if (sane) return saved;
      }
      if (activeCharacterPart === partKey && characterPartBounds[object.id]?.space === "source") {
        const live = characterPartBounds[object.id];
        const b = live.bounds;
        const sane = b.width > 0.025 && b.width < 0.65 && b.height > 0.025 && b.height < 0.65;
        if (sane) return live;
      }
      return fallbackReplacementBounds(object, partKey);
    }
    if (saved && saved.space === "source") {
      const b = saved.bounds;
      const sourceWidth = Math.max(1, Number(object.sourceWidth || 420));
      const sourceHeight = Math.max(1, Number(object.sourceHeight || 760));
      const characterTransform = resolveCharacterTransformAtTime(object, playhead);
      const characterScale = Math.max(0.02, Number(characterTransform.scale || 1));
      const objectLeft = Number(characterTransform.x || 0) - sourceWidth * characterScale / 2;
      const objectTop = Number(characterTransform.y || 0) - sourceHeight * characterScale / 2;
      const stageX = objectLeft + b.x * sourceWidth * characterScale;
      const stageY = objectTop + b.y * sourceHeight * characterScale;
      const stageW = b.width * sourceWidth * characterScale;
      const stageH = b.height * sourceHeight * characterScale;
      return {
        space: "camera",
        bounds: {
          x: (fit.left + pan.x + stageX * effectiveScale) / Math.max(1, hostSize.width),
          y: (fit.top + pan.y + stageY * effectiveScale) / Math.max(1, hostSize.height),
          width: (stageW * effectiveScale) / Math.max(1, hostSize.width),
          height: (stageH * effectiveScale) / Math.max(1, hostSize.height),
        },
      };
    }
    const fallback = fallbackReplacementBounds(object, partKey);
    if (fallback) {
      const b = fallback.bounds;
      const sourceWidth = Math.max(1, Number(object.sourceWidth || 420));
      const sourceHeight = Math.max(1, Number(object.sourceHeight || 760));
      const characterTransform = resolveCharacterTransformAtTime(object, playhead);
      const characterScale = Math.max(0.02, Number(characterTransform.scale || 1));
      const objectLeft = Number(characterTransform.x || 0) - sourceWidth * characterScale / 2;
      const objectTop = Number(characterTransform.y || 0) - sourceHeight * characterScale / 2;
      const stageX = objectLeft + b.x * sourceWidth * characterScale;
      const stageY = objectTop + b.y * sourceHeight * characterScale;
      const stageW = b.width * sourceWidth * characterScale;
      const stageH = b.height * sourceHeight * characterScale;
      return {
        space: "camera",
        bounds: {
          x: (fit.left + pan.x + stageX * effectiveScale) / Math.max(1, hostSize.width),
          y: (fit.top + pan.y + stageY * effectiveScale) / Math.max(1, hostSize.height),
          width: (stageW * effectiveScale) / Math.max(1, hostSize.width),
          height: (stageH * effectiveScale) / Math.max(1, hostSize.height),
        },
      };
    }
    return null;
  };

  const getWholeCharacterGroupBoxStyle = (object: EditorObject) => {
    const sourceWidth = Math.max(1, Number(object.sourceWidth || 1920));
    const sourceHeight = Math.max(1, Number(object.sourceHeight || 1920));
    const visual = getCharacterVisualBounds(object);
    let minX = visual.x / sourceWidth;
    let minY = visual.y / sourceHeight;
    let maxX = (visual.x + visual.width) / sourceWidth;
    let maxY = (visual.y + visual.height) / sourceHeight;

    Object.entries(object.partReplacements || {}).forEach(([partKey, replacement]) => {
      if (!replacement?.assetUrl) return;
      const entry = resolveReplacementEntry(object, partKey, "source");
      if (!entry) return;
      const b = entry.bounds;
      const t = getLivePartTransform(object, partKey);
      const scale = Math.max(0.02, Number(t.scale || 1));
      const sx = t.flipX ? -scale : scale;
      const sy = scale;
      const angle = Number(t.rotation || 0) * Math.PI / 180;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      const originX = b.x + b.width / 2;
      const originY = b.y + b.height;
      const dx = Number(t.offsetX || 0) / sourceWidth;
      const dy = Number(t.offsetY || 0) / sourceHeight;
      const corners = [
        [b.x, b.y],
        [b.x + b.width, b.y],
        [b.x + b.width, b.y + b.height],
        [b.x, b.y + b.height],
      ];
      corners.forEach(([x, y]) => {
        const localX = (x - originX) * sx;
        const localY = (y - originY) * sy;
        const tx = originX + localX * cos - localY * sin + dx;
        const ty = originY + localX * sin + localY * cos + dy;
        minX = Math.min(minX, tx);
        minY = Math.min(minY, ty);
        maxX = Math.max(maxX, tx);
        maxY = Math.max(maxY, ty);
      });
    });

    const padX = 8 / sourceWidth;
    const padY = 8 / sourceHeight;
    minX -= padX;
    minY -= padY;
    maxX += padX;
    maxY += padY;

    return {
      left: `${minX * 100}%`,
      top: `${minY * 100}%`,
      width: `${Math.max(0.002, maxX - minX) * 100}%`,
      height: `${Math.max(0.002, maxY - minY) * 100}%`,
      transform: "none",
    };
  };

  // Single click on a replaced part selects the whole character, unless that part is already selected.
  const clickReplacedPart = (event: ReactMouseEvent<HTMLElement>, object: EditorObject, partKey: string) => {
    event.preventDefault();
    event.stopPropagation();
    onSelect(object.id);
    if (!(selectedObjectId === object.id && activeCharacterPart === partKey)) onActiveCharacterPart?.(null);
  };
  // While a part is entered, the character's other replaced parts are dimmed like the rest of it.
  const isDimmedReplacement = (object: EditorObject, partKey: string) =>
    !renderMode && characterPartEntered && selectedObjectId === object.id && activeCharacterPart !== partKey;

  const renderSourcePartReplacements = (object: EditorObject) => Object.entries(object.partReplacements || {}).map(([partKey, replacement]) => {
    if (!replacement?.assetUrl) return null;
    const entry = resolveReplacementEntry(object, partKey, "source");
    if (!entry) return null;
    const bounds = stretchPartBounds(object, partKey, entry.bounds);
    return (
      <div
        key={`replacement-source-${object.id}-${partKey}`}
        className={`cb-persistent-part-replacement ${replacement.renderKind === "source-symbol" ? "source-symbol" : "image"} ${isDimmedReplacement(object, partKey) ? "cb-part-dimmed" : ""}`}
        style={{
          left: `${bounds.x * 100}%`,
          top: `${bounds.y * 100}%`,
          width: `${Math.max(0.001, bounds.width) * 100}%`,
          height: `${Math.max(0.001, bounds.height) * 100}%`,
          ...getReplacementTransformStyle(object, partKey, "source"),
        }}
        onPointerDown={(event) => {
          if (activeCharacterPart === partKey && selectedObjectId === object.id) beginReplacementPartDrag(event, object, partKey);
          else beginDrag(event, object);
        }}
        onClick={(event) => clickReplacedPart(event, object, partKey)}
        onDoubleClick={(event) => { event.preventDefault(); event.stopPropagation(); pickCharacterPart(object.id, partKey, true); }}
        title={`Click to select only replaced ${partKey}.`}
      >
        {renderReplacementContent(object, partKey, replacement, partKey)}
      </div>
    );
  });

  const renderCameraPartReplacements = (object: EditorObject, index: number) => Object.entries(object.partReplacements || {}).map(([partKey, replacement]) => {
    if (!replacement?.assetUrl) return null;
    const entry = resolveReplacementEntry(object, partKey, "camera");
    if (!entry) return null;
    const bounds = stretchPartBounds(object, partKey, entry.bounds);
    return (
      <div
        key={`replacement-camera-${object.id}-${partKey}`}
        className={`cb-persistent-part-replacement cb-persistent-part-replacement-camera ${replacement.renderKind === "source-symbol" ? "source-symbol" : "image"} ${isDimmedReplacement(object, partKey) ? "cb-part-dimmed" : ""}`}
        style={{
          left: `${bounds.x * hostSize.width}px`,
          top: `${bounds.y * hostSize.height}px`,
          width: `${Math.max(1, bounds.width * hostSize.width)}px`,
          height: `${Math.max(1, bounds.height * hostSize.height)}px`,
          zIndex: 430 + index,
          ...getReplacementTransformStyle(object, partKey, "camera"),
        }}
        onPointerDown={(event) => {
          if (activeCharacterPart === partKey && selectedObjectId === object.id) beginReplacementPartDrag(event, object, partKey);
          else beginDrag(event, object);
        }}
        onClick={(event) => clickReplacedPart(event, object, partKey)}
        onDoubleClick={(event) => { event.preventDefault(); event.stopPropagation(); pickCharacterPart(object.id, partKey, true); }}
        title={`Click to select only replaced ${partKey}.`}
      >
        {renderReplacementContent(object, partKey, replacement, partKey)}
      </div>
    );
  });

  const renderCharacterPartHitArea = (object: EditorObject, selected: boolean) => {
    if (renderMode || !selected || !activeCharacterPart || object.type !== "character") return null;
    const entry = resolveEditablePartEntry(object, activeCharacterPart, "source");
    if (!entry) return null;
    // Measured parts: exactly their pixels (the player pivots on fractions of these bounds). Guessed zones keep padding.
    const bounds = stretchPartBounds(object, activeCharacterPart, object.autoDetectedParts ? entry.bounds : expandSourcePartBounds(object, entry.bounds));
    return (
      <div
        className="cb-character-part-hitbox"
        style={{
          left: `${bounds.x * 100}%`,
          top: `${bounds.y * 100}%`,
          width: `${Math.max(0.001, bounds.width) * 100}%`,
          height: `${Math.max(0.001, bounds.height) * 100}%`,
          ...getReplacementTransformStyle(object, activeCharacterPart, "source"),
          borderWidth: `${1 / getPartControlScreenScale(object, activeCharacterPart, "source")}px`,
          ["--part-control-zoom" as string]: String(getPartControlScreenScale(object, activeCharacterPart, "source")),
        }}
        onPointerDown={(event) => pressPartBox(event, object)}
        onDoubleClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          if (doubleClickSubPart(object, event.clientX, event.clientY)) return;
          requestCharacterPartAtPoint(object, event.clientX, event.clientY, true);
        }}
        title={characterPartEntered ? "Click a piece inside to select it (Shift+click adds shapes). Double-click a piece to go inside it." : "Drag to move, corners scale or rotate, sides stretch, edges skew. Double-click to go inside."}
      >
        {/* Inside an entered part you work on its pieces (as inside a symbol in Animate): no handles. */}
        {!characterPartEntered && renderPartTransformControls(object)}
      </div>
    );
  };

  const renderSelectionGizmo = (object: EditorObject, selected: boolean) => {
    if (renderMode || !selected) return null;
    const partMode = object.type === "character" && Boolean(activeCharacterPart);
    if (partMode) return null;
    const pivotX = clamp(object.pivotX ?? 0.5, PIVOT_MIN, PIVOT_MAX);
    const pivotY = clamp(object.pivotY ?? 0.5, PIVOT_MIN, PIVOT_MAX);
    const characterBoxStyle = object.type === "character" ? getWholeCharacterGroupBoxStyle(object) : undefined;
    // Screen px per box px along each axis. Characters are sized in px; other layers are
    // CSS-scaled (scale × stretch), so their gizmo is counter-scaled per axis to stay crisp.
    const viewScale = Math.max(0.02, effectiveScale / Math.max(0.001, browserZoomFactor));
    const stretch = stretchOf(object);
    const layerScale = object.type === "character" ? 1 : Math.max(0.02, Number(object.scale || 1));
    const zoomX = object.type === "character" ? viewScale : viewScale * layerScale * stretch.x;
    const zoomY = object.type === "character" ? viewScale : viewScale * layerScale * stretch.y;
    const lineWidths = `${1 / zoomY}px ${1 / zoomX}px`;
    if ((toolMode !== "transform" && toolMode !== "scale") || selectedIds.length > 1) {
      // Selection tool (V) / multi-selection: Animate's thin blue box hugging the artwork.
      return (
        <div
          className={`cb-selection-outline ${object.type === "character" ? "cb-transform-box-character" : ""}`}
          style={{ ...(characterBoxStyle || {}), borderWidth: lineWidths }}
        />
      );
    }
    const boxStyle = {
      ...(characterBoxStyle || {}),
      ["--whole-control-zoom" as string]: String(Math.sqrt(zoomX * zoomY)),
      ["--cb-gz-x" as string]: String(zoomX),
      ["--cb-gz-y" as string]: String(zoomY),
      // Handles stay upright on a skewed box (see the v134 counter-skew CSS).
      ["--cb-skew-x" as string]: `${skewOf(object).x}deg`,
      ["--cb-skew-y" as string]: `${skewOf(object).y}deg`,
      borderWidth: lineWidths,
    };
    const rotation = object.type === "character" ? resolveCharacterTransformAtTime(object, playhead).rotation || 0 : object.rotation || 0;
    const corners = ["nw", "ne", "se", "sw"] as const;
    const sides = ["n", "e", "s", "w"] as const;
    return (
      <div className={`cb-transform-box ${object.type === "character" ? "cb-transform-box-character" : ""} ${rotationToolActive ? "rotation-tool-active" : ""}`} style={boxStyle}>
        {corners.map((handle) => (
          <span key={`whole-corner-${handle}`} className={`cb-whole-corner-control cb-corner-${handle}`}>
            <button
              type="button"
              className="cb-transform-handle cb-corner-scale-handle"
              style={{ cursor: handleCursor(handle, rotation, object.flipX) }}
              onPointerDown={(event) => beginScale(event, object, handle)}
              tabIndex={-1}
              title="Scale. Shift keeps proportions, Option/Alt scales from the registration point."
              aria-label={`Scale ${handle}`}
            />
            <button
              type="button"
              className="cb-rotate-handle cb-corner-rotate-handle"
              onPointerDown={(event) => beginRotation(event, object)}
              title="Rotate. Hold Shift to snap 45°."
              aria-label={`Rotate ${handle}`}
            >↻</button>
          </span>
        ))}
        {(["top", "bottom", "left", "right"] as const).map((edge) => (
          <b key={`skew-${edge}`} className={`cb-skew-edge ${edge}`} style={{ cursor: skewCursorFor(edge, rotation) }}
            onPointerDown={(event) => beginSkew(event, object, edge)} title="Skew: drag along this edge (Option/Alt = around the registration point, Shift = 15° steps)" />
        ))}
        {sides.map((handle) => (
          <button
            key={`side-${handle}`}
            type="button"
            className={`cb-transform-handle cb-transform-handle-${handle}`}
            style={{ cursor: handleCursor(handle, rotation, object.flipX) }}
            onPointerDown={(event) => beginScale(event, object, handle)}
            tabIndex={-1}
            title="Stretch. Option/Alt stretches from the registration point."
            aria-label={`Scale ${handle}`}
          />
        ))}
        <button
          type="button"
          className="cb-transform-center-point"
          style={{ left: `${pivotX * 100}%`, top: `${pivotY * 100}%` }}
          onPointerDown={(event) => beginPivotDrag(event, object)}
          onDoubleClick={(event) => { event.stopPropagation(); onTransform?.(object.id, { pivotX: 0.5, pivotY: 0.5 }); }}
          title="Registration point: rotation and Option-scaling happen around it. Drag to move, double-click to re-centre."
          aria-label="Registration point"
        />
      </div>
    );
  };

  return (
    <div
      ref={hostRef}
      className={`studio-stage-host relative h-full min-h-[360px] w-full overflow-hidden ${colorPickActive ? `color-pick-active pick-${colorPickCursor}` : ""} ${spacePanning ? "space-panning" : ""} ${rotationToolActive ? "rotation-tool-active" : ""} ${toolMode === "scale" && !renderMode ? "scale-tool-active" : ""} ${toolMode === "zoom" && !renderMode ? `zoom-tool-active ${zoomToolOut ? "zoom-out" : ""}` : ""} ${toolMode === "text" && !renderMode ? "text-tool-active" : ""}`}
      onWheel={handleWheel}
      // Scale tool (S) takes the drag before objects or the marquee see it.
      onPointerDownCapture={(event) => {
        // The first press of a click/double-click remembers which part was selected before it,
        // so a double-click can tell "select this part" from "enter the already-selected part".
        if (event.detail <= 1) gestureStartPartRef.current = { objectId: selectedObjectId, part: activeCharacterPart };
        // Hand tool (Space held): pan from anywhere on the canvas. Taken here, before any part, handle
        // or object sees the press, so nothing is picked or moved in any mode.
        if (spacePanning) { beginPan(event); return; }
        // A press in the text being typed moves the caret: nothing is selected or dragged.
        if ((event.target as HTMLElement).closest?.(".cb-stage-text-editing")) { event.stopPropagation(); return; }
        // Text tool (T): a press on a text layer types into it; anywhere else starts new text there.
        if (toolMode === "text" && !renderMode && event.button === 0) {
          event.preventDefault();
          event.stopPropagation();
          const id = (event.target as HTMLElement).closest?.<HTMLElement>("[data-editor-object-id]")?.dataset.editorObjectId;
          const hit = id ? objects.find((item) => item.id === id) : undefined;
          if (hit?.type === "text" && !hit.locked) onEditText?.(hit.id, event.clientX, event.clientY);
          else { const point = clientToWorld(event.clientX, event.clientY); onCreateText?.(point.x, point.y); }
          return;
        }
        // Zoom tool: every press zooms; nothing is selected or moved.
        if (toolMode === "zoom" && !renderMode && event.button === 0) { beginZoomTool(event); return; }
        // Eyedropper (Recolour panel): this press samples a colour and selects nothing.
        if (colorPickActive && onColorPick) {
          event.preventDefault();
          event.stopPropagation();
          onColorPick(event.clientX, event.clientY, { altKey: event.altKey, shiftKey: event.shiftKey });
          return;
        }
        // Part editing (double-click mode) is left only by a double-click outside the part, so single
        // presses elsewhere — empty canvas, background, other objects — are ignored while it is open.
        if (partEditing) {
          if (!isInsideSelectedCharacter(event.target)) event.stopPropagation();
          return;
        }
        if (!beginScaleToolDrag(event)) redirectTransparentPress(event);
      }}
      onDoubleClickCapture={(event) => {
        // With the Zoom tool a double-click is just two zoom clicks, and with Lighten/Darken or an
        // eyedropper two colour clicks: it never selects or enters a part.
        if (toolMode === "zoom" || blockDoubleClick || colorPickActive) { event.preventDefault(); event.stopPropagation(); return; }
        // Double-click outside the part's solid artwork (blank space, canvas, other objects) closes part
        // editing and returns to the whole character, like double-clicking outside a symbol in Animate.
        if (!partEditing || !selectedObject) return;
        const target = event.target as HTMLElement | null;
        if (target?.closest?.(".cb-part-pivot-point, .cb-part-corner-control, .cb-part-flip-handle, .cb-part-skew-edge, .cb-part-stretch-handle, .cb-persistent-part-replacement")) return;
        if (isInsideSelectedCharacter(event.target) && isCharacterArtworkAt(selectedObject, event.clientX, event.clientY)) return;
        event.preventDefault();
        event.stopPropagation();
        onActiveCharacterPart?.(null);
      }}
      onPointerDown={(event) => {
        if (beginPan(event)) return;
        // The grey area around the stage (host or its zoom viewport layer) counts as empty canvas.
        const target = event.target as HTMLElement;
        if (target === event.currentTarget || target.classList?.contains("cb-browser-zoom-stable-viewport")) beginMarquee(event);
      }}
      onPointerMove={movePan}
      onPointerUp={endPan}
      onPointerCancel={endPan}
    >
      {marquee && <div className="cb-selection-marquee" style={marquee} aria-hidden="true" />}
      {showDiagnostics && <RenderDiagnostics read={readDiagnostics} />}
      <div
        className="cb-browser-zoom-stable-viewport"
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: `${hostSize.width}px`,
          height: `${hostSize.height}px`,
          transformOrigin: "0 0",
          ...(renderMode ? { transform: "none" }
            : useCssZoom ? { zoom: 1 / Math.max(0.001, browserZoomFactor) }
              : { transform: `scale(${1 / Math.max(0.001, browserZoomFactor)})` }),
        }}
      >
      <div
        className={`cb-stage-world ${renderMode ? "render-mode" : ""} ${renderMode || clipToStage ? "cb-stage-clipped" : ""} ${showTransparencyGrid ? "cb-transparency-grid" : ""}`}
        style={{
          width: `${width}px`,
          height: `${height}px`,
          // With CSS zoom the element's own left/top are zoomed too, so they are given in stage px.
          ...(useCssZoom ? {
            left: `${(fit.left + pan.x) / effectiveScale}px`,
            top: `${(fit.top + pan.y) / effectiveScale}px`,
            zoom: effectiveScale,
          } : {
            left: `${fit.left + pan.x}px`,
            top: `${fit.top + pan.y}px`,
            transform: `scale(${effectiveScale})`,
          }),
          background: data.background || "#ffffff",
          // Grid squares and lines keep a fixed on-screen size at every zoom (world px = screen px / scale).
          ...(showTransparencyGrid ? {
            ["--cb-grid-line" as string]: `${1 / gridScreenScale}px`,
            ["--cb-grid-minor" as string]: `${5 / gridScreenScale}px`,
            ["--cb-grid-major" as string]: `${50 / gridScreenScale}px`,
          } : {}),
        }}
        onPointerDown={(event) => {
          const target = event.target as HTMLElement;
          const clickedStage = event.target === event.currentTarget || Boolean(target.closest?.(".cb-stage-background"));
          if (!clickedStage) return;
          beginMarquee(event);
        }}
      >
        {data.backgroundImage && <img className="cb-stage-background" src={data.backgroundImage} alt="" draggable={false} />}

        {objects.map((object, index) => {
          if (object.type !== "background" || object.assetKind !== "image" || !object.assetUrl || (object.hidden && !renderMode)) return null;
          return <img key={object.id} className="cb-stage-background" src={object.assetUrl} alt="" draggable={false} style={{ opacity: object.opacity ?? 1, zIndex: index + 1 }} />;
        })}

        {objects.map((object, index) => {
          // Empty timeline layers draw nothing; hidden layers only disappear in the editor.
          if (object.type === "background" || object.type === "audio" || object.type === "empty" || (object.hidden && !renderMode)) return null;
          const lockClass = object.locked && !renderMode ? "cb-layer-locked" : "";
          const layerStart = Math.max(0, Number(object.startTime || 0));
          const layerDuration = object.actionDurationMs ? Math.max(0.1, Number(object.actionDurationMs) / 1000) : null;
          if (playhead + 0.0001 < layerStart) return null;
          if (layerDuration != null && playhead > layerStart + layerDuration + 0.0001) return null;
          const selected = selectedIds.includes(object.id);
          const resolvedTransform = object.type === "character"
            ? resolveCharacterTransformAtTime(object, playhead)
            : { x: object.x, y: object.y, scale: object.scale || 1, rotation: object.rotation || 0 };
          const baseStyle = {
            left: `${resolvedTransform.x}px`,
            top: `${resolvedTransform.y}px`,
            opacity: object.opacity ?? 1,
            zIndex: 100 + index,
          };

          if (object.type === "character" && object.assetKind === "animate-createjs" && object.assetUrl) {
            const sourceWidth = object.sourceWidth || 1920;
            const sourceHeight = object.sourceHeight || 1920;
            const scale = resolvedTransform.scale || 0.28;
            const hue = object.characterHue ?? 0;
            const saturation = object.characterSaturation ?? 100;
            const brightness = object.characterBrightness ?? 100;
            const isFreePartCharacter = false;

            // Kissan uses a stage-sized CreateJS viewport. The character root is positioned
            // inside that viewport, so detached source body parts are no longer clipped by
            // the original character bounding box and may travel anywhere on the white stage.
            if (isFreePartCharacter && !renderMode && useCameraRendering) {
              const placeholderStyle = {
                left: `${resolvedTransform.x}px`,
                top: `${resolvedTransform.y}px`,
                ...characterBoxCss(sourceWidth * scale, sourceHeight * scale),
                transform: characterTransformCss(object, resolvedTransform.rotation || 0),
                transformOrigin: "50% 50%",
                zIndex: 350 + index,
                pointerEvents: "none" as const,
              };
              return (
                <div key={object.id} className="cb-freepart-character-layer cb-camera-placeholder-layer" style={{ zIndex: 100 + index }}>
                  <div data-editor-object-id={object.id} className="cb-camera-placeholder-object" style={placeholderStyle}>
                    {/* Replacement parts are rendered once in camera space below. Rendering
                        them here as well caused the duplicate-head issue after a part moved. */}
                    {renderCharacterTightHitArea(object, selected)}
                    {renderSelectionGizmo(object, selected)}
                  </div>
                </div>
              );
            }

            if (isFreePartCharacter && renderMode) {
              return (
                <div key={object.id} className="cb-freepart-character-layer" style={{ zIndex: 100 + index }}>
                  <iframe
                    ref={(node) => {
                      if (node) frameRefs.current.set(object.id, node);
                      else frameRefs.current.delete(object.id);
                    }}
                    data-animate-player="1"
                    title={`${object.name} ${object.actionName || "action"}`}
                    src={`${object.assetUrl}?autoplay=0&muted=1&interactive=0&editorStage=1&viewportWidth=${width}&viewportHeight=${height}&bridge=v30-render`}
                    className="cb-character-source-frame cb-character-stage-frame"
                    style={{ filter: `hue-rotate(${hue}deg) saturate(${saturation}%) brightness(${brightness}%)`, pointerEvents: "none" }}
                    tabIndex={-1}
                  />
                </div>
              );
            }

            return (
              <div
                key={object.id}
                data-editor-object-id={object.id}
                className={`cb-stage-character ${lockClass} ${selected && !renderMode ? "selected" : ""} ${selected && activeCharacterPart && !renderMode ? "part-edit-mode" : ""}`}
                style={{
                  ...baseStyle,
                  ...characterBoxCss(sourceWidth * scale * stretchOf(object).x, sourceHeight * scale * stretchOf(object).y),
                  transform: characterTransformCss(object, resolvedTransform.rotation || 0),
                  transformOrigin: "50% 50%",
                  pointerEvents: "none",
                }}
              >
                {!readyCharacterIds.has(object.id) && object.previewUrl && (
                  <img
                    src={object.previewUrl}
                    alt=""
                    draggable={false}
                    className="cb-character-preview-fallback"
                  />
                )}
                {renderCharacterTightHitArea(object, selected)}
                <iframe
                  ref={(node) => {
                    if (node) frameRefs.current.set(object.id, node);
                    else frameRefs.current.delete(object.id);
                  }}
                  data-animate-player="1"
                  title={`${object.name} ${object.actionName || "action"}`}
                  // Resolution comes from SET_VIEW messages, not the URL, so zooming never reloads the player.
                  src={`${object.assetUrl}?autoplay=0&muted=1&interactive=1&embeddedMode=1&viewportWidth=${sourceWidth}&viewportHeight=${sourceHeight}&bridge=v92`}
                  className="cb-character-source-frame"
                  style={{
                    filter: `hue-rotate(${hue}deg) saturate(${saturation}%) brightness(${brightness}%)`,
                    pointerEvents: "none",
                  }}
                  tabIndex={-1}
                />
                {renderSourcePartReplacements(object)}
                {renderCharacterPartHitArea(object, selected)}
                {renderSelectionGizmo(object, selected)}
              </div>
            );
          }

          if (object.type === "prop" && object.assetKind === "image" && object.assetUrl) {
            // FX / image layers from the library keep their original pixel size, scaled by the layer transform.
            return (
              <div
                key={object.id}
                data-editor-object-id={object.id}
                className={`cb-stage-prop cb-stage-prop-image ${lockClass} ${selected && !renderMode ? "selected" : ""}`}
                style={{
                  ...baseStyle,
                  width: `${object.sourceWidth || 300}px`,
                  height: `${object.sourceHeight || 300}px`,
                  transform: layerTransformCss(object, resolvedTransform.rotation || 0, resolvedTransform.scale || 1, stretchOf(object).x, stretchOf(object).y),
                  transformOrigin: "50% 50%",
                }}
                onPointerDown={(event) => beginDrag(event, object)}
              >
                <img src={object.assetUrl} alt={object.name} draggable={false} />
                {renderSelectionGizmo(object, selected)}
              </div>
            );
          }

          if (object.type === "text") {
            const editing = !renderMode && editingText?.id === object.id;
            return (
              <div
                key={object.id}
                data-editor-object-id={object.id}
                className={`cb-stage-text ${lockClass} ${selected && !renderMode && !editing ? "selected" : ""} ${editing ? "cb-stage-text-editing" : ""}`}
                style={{ ...baseStyle, ...textCss(object), transform: layerTransformCss(object, object.rotation || 0, object.scale || 1, stretchOf(object).x, stretchOf(object).y), transformOrigin: "50% 50%" }}
                onPointerDown={(event) => { if (!editing) beginDrag(event, object); }}
                onDoubleClick={(event) => { if (!editing && !object.locked && toolMode !== "zoom") { event.stopPropagation(); onEditText?.(object.id, event.clientX, event.clientY); } }}
              >
                {editing
                  ? <span key={`edit-${editingText?.nonce}`} ref={textEditRef} className="cb-stage-text-input" contentEditable="plaintext-only" suppressContentEditableWarning spellCheck={false}
                      onInput={(event) => onTextInput?.(object.id, event.currentTarget.innerText.replace(/\n$/, ""))}
                      onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onTextEditEnd?.(); } }} />
                  : <span className="cb-stage-text-content">{object.text ?? object.name}</span>}
                {!editing && renderSelectionGizmo(object, selected)}
              </div>
            );
          }

          return (
            <div
              key={object.id}
              data-editor-object-id={object.id}
              className={`cb-stage-prop ${lockClass} ${selected && !renderMode ? "selected" : ""}`}
              style={{ ...baseStyle, background: object.fillColor || "#17343a", transform: layerTransformCss(object, object.rotation || 0, object.scale || 1, stretchOf(object).x, stretchOf(object).y), transformOrigin: "50% 50%" }}
              onPointerDown={(event) => beginDrag(event, object)}
            >
              <span>◇</span><small>{object.name}</small>{renderSelectionGizmo(object, selected)}
            </div>
          );
        })}
      </div>

      {!renderMode && useCameraRendering && cameraCharacterObjects.map((object, index) => {
        const selected = selectedObjectId === object.id;
        const hue = object.characterHue ?? 0;
        const saturation = object.characterSaturation ?? 100;
        const brightness = object.characterBrightness ?? 100;
        return (
          <iframe
            key={`camera-${object.id}`}
            ref={(node) => {
              if (node) frameRefs.current.set(object.id, node);
              else frameRefs.current.delete(object.id);
            }}
            data-animate-player="1"
            title={`${object.name} ${object.actionName || "action"}`}
            src={`${object.assetUrl}?autoplay=0&muted=1&interactive=1&editorStage=1&cameraMode=1&viewportWidth=${width}&viewportHeight=${height}&characterBoxWidth=${object.sourceWidth || 420}&characterBoxHeight=${object.sourceHeight || 760}&qualityScale=${getPlayerQualityScale(width, height)}&bridge=v91`}
            className="cb-character-source-frame cb-character-camera-frame"
            style={{
              filter: `hue-rotate(${hue}deg) saturate(${saturation}%) brightness(${brightness}%)`,
              pointerEvents: "none",
              opacity: object.opacity ?? 1,
              zIndex: 300 + index,
            }}
            tabIndex={-1}
          />
        );
      })}

      {!renderMode && useCameraRendering && cameraCharacterObjects.map((object, index) => (
        <div key={`camera-replacements-${object.id}`}>{renderCameraPartReplacements(object, index)}</div>
      ))}

      {!renderMode && useCameraRendering && cameraCharacterObjects.map((object, index) => {
        if (selectedObjectId !== object.id || !activeCharacterPart) return null;
        const entry = resolveEditablePartEntry(object, activeCharacterPart, "camera");
        if (!entry) return null;
        const bounds = stretchPartBounds(object, activeCharacterPart, object.autoDetectedParts ? entry.bounds : expandCameraPartBounds(entry.bounds));
        return (
          <div
            key={`camera-part-hit-${object.id}`}
            className="cb-character-part-hitbox cb-character-part-hitbox-camera"
            style={{
              left: `${bounds.x * hostSize.width}px`,
              top: `${bounds.y * hostSize.height}px`,
              width: `${Math.max(1, bounds.width * hostSize.width)}px`,
              height: `${Math.max(1, bounds.height * hostSize.height)}px`,
              zIndex: 500 + index,
              ...getReplacementTransformStyle(object, activeCharacterPart, "camera"),
              borderWidth: `${1 / getPartControlScreenScale(object, activeCharacterPart, "camera")}px`,
              ["--part-control-zoom" as string]: String(getPartControlScreenScale(object, activeCharacterPart, "camera")),
            }}
            onPointerDown={(event) => pressPartBox(event, object)}
            onDoubleClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              requestCharacterPartAtPoint(object, event.clientX, event.clientY, true);
            }}
            title={`Selected ${activeCharacterPart}. Drag the box to move, drag a corner to scale, or hover a corner to reveal rotate.`}
          >
            {renderPartTransformControls(object)}
          </div>
        );
      })}
      </div>
    </div>
  );
}
