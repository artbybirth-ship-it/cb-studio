"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api";
import { compileAnimationPlan } from "@/lib/animationCompiler";
import { resolveCharacterTransformAtTime, sortKeyframes, upsertCharacterKeyframe } from "@/lib/keyframes";
import { partEditMatrix, resolvePartTransformAtTime, upsertPartKeyframe } from "@/lib/partKeyframes";
import { useCharacterLibrary } from "@/lib/characterLibrary";
import { useEditorStore } from "@/store/editor";
import type { AnimationPlan, CharacterPartDescriptor, CharacterPartKey, ColorReplacement, EditorData, EditorObject, Project, RenderJob, Scene } from "@/types";
import AssetPanel, { showLibrariesHome } from "./AssetPanel";
import StageCanvas, { type TransformPatch } from "./StageCanvas";
import { readOpenProjects, recentProjectsOf, removeOpenProject, upsertOpenProject, type OpenProjectTab } from "@/lib/openProjects";
import { buildProjectFile, formatEditedAgo, openProjectFileAsNew, saveProjectFile } from "@/lib/projectFile";
import Timeline, { selectionLayerIds, type FrameAction, type FrameSelection } from "./Timeline";
import CharacterEditPanel from "./CharacterEditPanel";
import RecolorPanel from "./RecolorPanel";
import TextLayerPanel from "./TextLayerPanel";
import FindReplaceDialog from "./FindReplaceDialog";
import { addColorRule, addCounts, applyToEditorData, charactersUsingColour, describeCounts, emptyCounts, libraryIdOf, normalizeHex, totalCount, visibleAt, type FindRequest } from "@/lib/findReplace";
import { shiftLightness } from "@/lib/color";
import ColourPicker from "./ColourPicker";
import ReflectDialog from "./ReflectDialog";
import { partLabel } from "@/lib/partLabels";
import { axisInsideCharacter, reflectOrientation, reflectPoint } from "@/lib/reflect";
import AIAnimatePanel from "./AIAnimatePanel";
import HeaderUserIcon from "./HeaderUserIcon";
import Popover from "./Popover";
import { renderProjectThumbnail } from "@/lib/projectThumbnail";
import ScaleRotateDialog from "./ScaleRotateDialog";
import type { MediaLibraryItem } from "@/lib/mediaLibrary";

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));

// The timeline ends at the last frame of the longest timed layer (Animate): layers without
// their own clip length (text, shapes) just run to that end. 0 = nothing timed.
const timedContentEnd = (objects: EditorObject[]) => objects.reduce((end, object) => (
  object.actionDurationMs && object.actionDurationMs > 0
    ? Math.max(end, Math.max(0, Number(object.startTime || 0)) + object.actionDurationMs / 1000)
    : end
), 0);
const DEFAULT_SCENE_SECONDS = 5;

const TIMELINE_FPS = 30;

/** Animate: moving a keyframed character never creates a keyframe. The change goes into the
 *  keyframe on this frame, or else the keyframe that controls it (the previous one). */
const moveKeyframedPosition = (item: EditorObject, time: number, x: number, y: number) => {
  const frames = sortKeyframes(item.keyframes || []);
  if (!frames.length) { item.x = x; item.y = y; return; }
  const current = resolveCharacterTransformAtTime(item, time);
  const dx = x - current.x;
  const dy = y - current.y;
  const frame = Math.round(time * TIMELINE_FPS);
  const target = frames.find((key) => Math.round(key.time * TIMELINE_FPS) === frame)
    || [...frames].reverse().find((key) => key.time <= time + 1e-6)
    || frames[0];
  item.keyframes = frames.map((key) => (key.id === target.id ? { ...key, x: key.x + dx, y: key.y + dy } : key));
};

/** A keyframe made by the user. It holds (no tween) unless it splits an existing tween, which
 *  then continues on both sides. The layer's very first keyframe also fixes its first frame,
 *  so the frames before it keep their original position. */
const insertManualKeyframe = (item: EditorObject, time: number) => {
  const transform = resolveCharacterTransformAtTime(item, time);
  const start = Math.max(0, Number(item.startTime || 0));
  let keyframes = sortKeyframes(item.keyframes || []);
  if (!keyframes.length && Math.round(time * TIMELINE_FPS) !== Math.round(start * TIMELINE_FPS)) {
    keyframes = upsertCharacterKeyframe({ ...item, keyframes }, start, resolveCharacterTransformAtTime(item, start), "manual", false);
  }
  const previous = [...keyframes].reverse().find((key) => key.time < time - 1e-6);
  const next = keyframes.find((key) => key.time > time + 1e-6);
  const tween = previous && next && previous.tween !== false ? (previous.tween ? { ...previous.tween } : { easeIn: 0, easeOut: 0 }) : false;
  item.keyframes = upsertCharacterKeyframe({ ...item, keyframes }, time, transform, "manual", tween);
};

/** Writes a part's edit at `time`: a keyframe when the part is keyed, otherwise its base edit. */
type PartPatch = Partial<{ offsetX: number; offsetY: number; rotation: number; scale: number; stretchX: number; stretchY: number; flipX: boolean; skewX: number; skewY: number }>;
const writePartTransform = (item: EditorObject, partKey: CharacterPartKey, patch: PartPatch, time: number) => {
  const current = resolvePartTransformAtTime(item, partKey, time);
  const next = {
    ...current,
    ...patch,
    scale: Math.max(0.02, Number(patch.scale ?? current.scale ?? 1)),
    flipX: typeof patch.flipX === "boolean" ? patch.flipX : Boolean(current.flipX),
  };
  const keyed = (item.partKeyframes?.[partKey] || []).length > 0;
  if (keyed) {
    const base = item.partOverrides?.[partKey] || {};
    const baseScale = Math.max(0.02, Number(base.scale ?? 1));
    item.partKeyframes = item.partKeyframes || {};
    item.partKeyframes[partKey] = upsertPartKeyframe(item, partKey, time, {
      offsetX: next.offsetX - Number(base.offsetX || 0),
      offsetY: next.offsetY - Number(base.offsetY || 0),
      rotation: next.rotation - Number(base.rotation || 0),
      scale: next.scale / baseScale,
      flipX: next.flipX,
      skewX: Number(next.skewX || 0) - Number(base.skewX || 0),
      skewY: Number(next.skewY || 0) - Number(base.skewY || 0),
      stretchX: Number(next.stretchX ?? 1) / Math.max(0.02, Number(base.stretchX ?? 1)),
      stretchY: Number(next.stretchY ?? 1) / Math.max(0.02, Number(base.stretchY ?? 1)),
    });
  } else {
    item.partOverrides = {
      ...(item.partOverrides || {}),
      [partKey]: {
        ...(item.partOverrides?.[partKey] || {}),
        offsetX: next.offsetX,
        offsetY: next.offsetY,
        rotation: next.rotation,
        scale: next.scale,
        flipX: next.flipX,
        skewX: Number(next.skewX || 0),
        skewY: Number(next.skewY || 0),
        // Width / height stretch (side handles); kept off the data while it is 1.
        stretchX: Math.abs(Number(next.stretchX ?? 1) - 1) > 1e-6 ? Number(next.stretchX) : undefined,
        stretchY: Math.abs(Number(next.stretchY ?? 1) - 1) > 1e-6 ? Number(next.stretchY) : undefined,
      },
    };
  }
};

// Layer clipboard (Copy / Cut / Paste): kept in memory and in this browser's session storage, so
// it survives switching scenes and projects while CB Studio is open.
type LayerClipboard = { objects: EditorObject[]; centre: { x: number; y: number } };
const LAYER_CLIPBOARD_KEY = "cb-layer-clipboard";
let layerClipboard: LayerClipboard | null = null;
const writeLayerClipboard = (clip: LayerClipboard) => {
  layerClipboard = clip;
  try { window.sessionStorage.setItem(LAYER_CLIPBOARD_KEY, JSON.stringify(clip)); } catch { /* too large or blocked: memory only */ }
};
const readLayerClipboard = (): LayerClipboard | null => {
  if (layerClipboard) return layerClipboard;
  try {
    const saved = JSON.parse(window.sessionStorage.getItem(LAYER_CLIPBOARD_KEY) || "null");
    if (saved && Array.isArray(saved.objects) && saved.objects.length && saved.centre) layerClipboard = saved;
  } catch { /* nothing saved */ }
  return layerClipboard;
};

/** New objects fill the selected empty layer (its blank keyframe) instead of adding a layer. */
const placeInLayer = (data: EditorData, object: EditorObject, targetId: string | null | undefined) => {
  const index = targetId ? data.objects.findIndex((item) => item.id === targetId && item.type === "empty") : -1;
  if (index >= 0) data.objects.splice(index, 1, object);
  else data.objects.push(object);
};

// Per-scene safety copy in this browser, kept until the autosave reaches the server.
type SceneBackup = { savedAt: number; duration: number; editor_data: EditorData };
const sceneBackupKey = (sceneId: string) => `cb-scene-backup:${sceneId}`;
const readSceneBackup = (sceneId: string): SceneBackup | null => {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(sceneBackupKey(sceneId)) || "null");
    return parsed && typeof parsed.savedAt === "number" && parsed.editor_data ? parsed : null;
  } catch { return null; }
};
const writeSceneBackup = (sceneId: string, backup: SceneBackup) => {
  try { window.localStorage.setItem(sceneBackupKey(sceneId), JSON.stringify(backup)); } catch { /* storage full or blocked */ }
};
const clearSceneBackup = (sceneId: string) => {
  try { window.localStorage.removeItem(sceneBackupKey(sceneId)); } catch { /* storage blocked */ }
};

const normalizeEditorData = (value: EditorData | null | undefined): EditorData => {
  const objects = Array.isArray(value?.objects) ? value!.objects.filter((item) => {
    if (item.type !== "character") return true;
    return item.assetKind === "animate-createjs"
      && String(item.characterId || "").startsWith("html5:")
      && Boolean(item.assetUrl);
  }) : [];
  const storedBackground = value?.background || "#ffffff";
  return {
    background: storedBackground === "#172033" && objects.length === 0 ? "#ffffff" : storedBackground,
    backgroundImage: value?.backgroundImage || null,
    objects,
  };
};

const readAudioDuration = (file: File): Promise<number> => new Promise((resolve) => {
  const objectUrl = URL.createObjectURL(file);
  const audio = document.createElement("audio");
  const finish = (seconds: number) => {
    URL.revokeObjectURL(objectUrl);
    resolve(Number.isFinite(seconds) && seconds > 0 ? seconds : 0);
  };
  audio.preload = "metadata";
  audio.onloadedmetadata = () => finish(audio.duration);
  audio.onerror = () => finish(0);
  audio.src = objectUrl;
});

const readUrlImageDimensions = (url: string): Promise<{ width: number; height: number }> => new Promise((resolve) => {
  const image = new Image();
  image.onload = () => resolve({ width: image.naturalWidth || 0, height: image.naturalHeight || 0 });
  image.onerror = () => resolve({ width: 0, height: 0 });
  image.src = url;
});

const readUrlAudioDuration = (url: string): Promise<number> => new Promise((resolve) => {
  const audio = document.createElement("audio");
  audio.preload = "metadata";
  audio.onloadedmetadata = () => resolve(Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : 0);
  audio.onerror = () => resolve(0);
  audio.src = url;
});

const readImageDimensions = (file: File): Promise<{ width: number; height: number }> => new Promise((resolve, reject) => {
  const objectUrl = URL.createObjectURL(file);
  const image = new Image();
  image.onload = () => {
    const width = image.naturalWidth;
    const height = image.naturalHeight;
    URL.revokeObjectURL(objectUrl);
    if (width > 0 && height > 0) resolve({ width, height });
    else reject(new Error("Could not read original image dimensions"));
  };
  image.onerror = () => {
    URL.revokeObjectURL(objectUrl);
    reject(new Error("Could not read imported image"));
  };
  image.src = objectUrl;
});

const MIN_CANVAS_ZOOM = 0.1;
const MAX_CANVAS_ZOOM = 200;
const clampCanvasZoom = (value: number) => Math.max(MIN_CANVAS_ZOOM, Math.min(MAX_CANVAS_ZOOM, value));

type EyeDropperResult = { sRGBHex: string };
type EyeDropperInstance = { open: () => Promise<EyeDropperResult> };
type WindowWithEyeDropper = Window & { EyeDropper?: new () => EyeDropperInstance };

export default function EditorShell({ projectId }: { projectId: string }) {
  const router = useRouter();
  const { project, scene, selectedObjectId, selectedObjectIds, isPlaying, setProject, setScene, selectObject, setSelection, setPlaying, refreshScene } = useEditorStore();
  const { findCharacter, actions: characterLibraryActions, characters: characterLibraryCharacters, refresh: refreshCharacterLibrary } = useCharacterLibrary();
  const [draft, setDraft] = useState<EditorData | null>(null);
  const [duration, setDuration] = useState(5);
  const [busy, setBusy] = useState(true);
  // Short pop-up at the bottom of the canvas for errors and hints only (fades after 4s);
  // routine confirmations are not shown. Load errors stay on the loading screen.
  const [notice, setNotice] = useState<{ id: number; text: string; tone: "info" | "error" } | null>(null);
  const [loadError, setLoadError] = useState("");
  const [render, setRender] = useState<RenderJob | null>(null);
  const [playhead, setPlayhead] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [saveState, setSaveState] = useState<"saved" | "saving" | "unsaved" | "error">("saved");
  const [openTabs, setOpenTabs] = useState<OpenProjectTab[]>([]);
  const [activeCharacterPart, setActiveCharacterPart] = useState<CharacterPartKey | null>(null);
  const [canvasZoom, setCanvasZoom] = useState(1);
  // View-only transparency grid (Shift+T); never saved or exported.
  const [transparencyGrid, setTransparencyGrid] = useState(false);
  // Animate's "Clip content outside the Stage" (view only, remembered per browser). Off by
  // default so characters overlap the pasteboard; exports always clip to the stage.
  const [clipToStage, setClipToStage] = useState(false);
  useEffect(() => {
    try { setClipToStage(window.localStorage.getItem("cb-clip-to-stage") === "1"); } catch { /* storage unavailable */ }
  }, []);
  const toggleClipToStage = useCallback(() => {
    const next = !clipToStage;
    setClipToStage(next);
    try { window.localStorage.setItem("cb-clip-to-stage", next ? "1" : "0"); } catch { /* not persisted */ }
  }, [clipToStage]);
  // Animate's Scale and Rotate dialog (Cmd/Ctrl+Option/Alt+S). The editor's own key handlers
  // check the ref so keys typed into the dialog never reach playback/delete shortcuts.
  const [scaleRotateOpen, setScaleRotateOpen] = useState(false);
  const scaleRotateOpenRef = useRef(false);
  // Reflect dialog (Reflect tool O, then Enter). The draft as it was when it opened, for Preview/Cancel.
  const [reflectOpen, setReflectOpen] = useState(false);
  const reflectBaseRef = useRef<EditorData | null>(null);
  const openReflectRef = useRef<() => void>(() => undefined);
  // While either transform dialog is open, the editor's keyboard shortcuts stay off.
  scaleRotateOpenRef.current = scaleRotateOpen || reflectOpen;
  const [canvasFitScale, setCanvasFitScale] = useState(1);
  // Actual Size (100%): Cmd/Ctrl+1 or a double-click on the Zoom tool, as in Illustrator.
  const zoomToActualSize = () => setCanvasZoom(clampCanvasZoom(1 / Math.max(0.01, canvasFitScale)));
  const zoomToActualSizeRef = useRef(zoomToActualSize);
  zoomToActualSizeRef.current = zoomToActualSize;
  const [zoomMenuOpen, setZoomMenuOpen] = useState(false);
  // Open Project panel: the 5 most recently edited projects + Open from device.
  const [openPanel, setOpenPanel] = useState(false);
  const [recentProjects, setRecentProjects] = useState<Project[] | null>(null);
  const openButtonRef = useRef<HTMLButtonElement>(null);
  const [canvasViewResetRevision, setCanvasViewResetRevision] = useState(0);
  const [partReplacementBrowserOpen, setPartReplacementBrowserOpen] = useState(false);
  const [referenceCharacterId, setReferenceCharacterId] = useState("");
  const [aiAnimateOpen, setAIAnimateOpen] = useState(false);
  // "select" = Animate Selection tool (V), "transform" = Free Transform tool (Q).
  // Recolour (Fill/Stroke boxes at the bottom of the tool palette, Illustrator-style).
  const [recolorOpen, setRecolorOpen] = useState(false);
  const [recolorTarget, setRecolorTarget] = useState<ColorReplacement["target"]>("both");
  // Fill / Stroke boxes (Illustrator): click = active box, double-click = Colour Picker. For a
  // character they hold an ORIGINAL colour of its artwork (picked with the eyedropper, else its
  // most-used fill / outline colour) and show what that colour currently looks like.
  const [activeBox, setActiveBox] = useState<"fill" | "stroke">("fill");
  const [boxPicks, setBoxPicks] = useState<{ objectId: string; scope: string; fill?: string; stroke?: string } | null>(null);
  const [boxPalette, setBoxPalette] = useState<{ key: string; entries: { color: string; current: string; fills: number; strokes: number }[] } | null>(null);
  const [boxPicking, setBoxPicking] = useState(false);
  const [boxPicker, setBoxPicker] = useState<"fill" | "stroke" | null>(null);
  const [colorPickActive, setColorPickActive] = useState(false);
  const [pickedColor, setPickedColor] = useState<{ color: string; nonce: number } | null>(null);
  const [previewColorReplacement, setPreviewColorReplacement] = useState<{ objectId: string; rule: ColorReplacement } | null>(null);
  const [recolorPosition, setRecolorPosition] = useState({ left: 70, bottom: 40 });
  const frameAccessRef = useRef<((objectId: string) => HTMLIFrameElement | undefined) | null>(null);
  const viewCenterRef = useRef<(() => { x: number; y: number }) | null>(null);
  const fillStrokeRef = useRef<HTMLDivElement>(null);
  const pickScopeRef = useRef("*");
  // Lighten / Darken tool: click = lighter, Alt/Option = darker, Shift = fine step.
  const [toneShades, setToneShades] = useState(true);
  const [toneDarken, setToneDarken] = useState(false);
  const [toneBarPosition, setToneBarPosition] = useState({ left: 70, top: 300 });
  const toneButtonRef = useRef<HTMLButtonElement>(null);
  // Find and Replace dialog (Cmd/Ctrl+F or the magnifier in the tool palette).
  const [findReplaceOpen, setFindReplaceOpen] = useState(false);
  const [frPicking, setFrPicking] = useState<"find" | "replace" | null>(null);
  const [frPicked, setFrPicked] = useState<{ target: "find" | "replace"; color: string; nonce: number } | null>(null);
  const [activeTool, setActiveTool] = useState<"select" | "transform" | "scale" | "reflect" | "zoom" | "import" | "text" | "eyedropper" | "bone" | "tone" | null>("select");
  const activeToolRef = useRef(activeTool);
  activeToolRef.current = activeTool;
  const audioPlayersRef = useRef<Map<string, HTMLAudioElement>>(new Map());
  const voiceUploadRef = useRef<HTMLInputElement>(null);
  const playClockRef = useRef(performance.now());
  const historyPastRef = useRef<EditorData[]>([]);
  const historyFutureRef = useRef<EditorData[]>([]);
  const canvasHoverRef = useRef(false);
  const zoomToolbarRef = useRef<HTMLDivElement>(null);
  const zoomValueRef = useRef<HTMLButtonElement>(null);

  // A refresh must never lose work: every change is also kept in this browser until the
  // autosave reaches the server, and a newer local copy wins when the scene is opened.
  const openSceneDraft = useCallback((target: Scene) => {
    const backup = readSceneBackup(target.id);
    const useBackup = Boolean(backup && backup.savedAt > (Date.parse(target.updated_at) || 0));
    if (backup && !useBackup) clearSceneBackup(target.id);
    setDraft(clone(normalizeEditorData(useBackup ? backup!.editor_data : target.editor_data)));
    setDuration(useBackup ? backup!.duration : target.duration_seconds);
    historyPastRef.current = [];
    historyFutureRef.current = [];
    setDirty(useBackup);
  }, []);

  const load = useCallback(async (preferSceneId?: string) => {
    const data = await api.getProject(projectId);
    setProject(data);
    setOpenTabs(upsertOpenProject({ id: data.id, title: data.title || "Untitled Project-01" }));
    const nextScene = data.scenes.find((item) => item.id === preferSceneId) || data.scenes[0] || null;
    if (nextScene) {
      setScene(nextScene);
      openSceneDraft(nextScene);
    } else {
      historyPastRef.current = [];
      historyFutureRef.current = [];
      setDirty(false);
    }
    setBusy(false);
  }, [openSceneDraft, projectId, setProject, setScene]);

  useEffect(() => {
    void load().catch((error) => {
      setLoadError(error instanceof Error ? error.message : "Load failed");
      setBusy(false);
    });
  }, [load]);

  useEffect(() => {
    if (characterLibraryCharacters.length === 0) {
      if (referenceCharacterId) setReferenceCharacterId("");
      return;
    }
    if (!referenceCharacterId || !characterLibraryCharacters.some((item) => item.id === referenceCharacterId)) {
      setReferenceCharacterId(characterLibraryCharacters[0].id);
    }
  }, [characterLibraryCharacters, referenceCharacterId]);

  useEffect(() => {
    if (!isPlaying) return;
    // Position keyframes are evaluated at ~30 FPS so whole-character motion stays
    // visually synchronized with the original 30 FPS CreateJS source animation.
    playClockRef.current = performance.now();
    const timer = window.setInterval(() => {
      const now = performance.now();
      const delta = Math.max(0, (now - playClockRef.current) / 1000);
      playClockRef.current = now;
      setPlayhead((current) => Math.min(duration, current + delta));
    }, 33);
    return () => window.clearInterval(timer);
  }, [isPlaying, duration]);

  // Scene length follows the content: it grows and shrinks with the clips, but waits until a
  // clip drag ends so the ruler never rescales under the mouse.
  const clipDraggingRef = useRef(false);
  // A whole clip drag is one undo step: only its first change is recorded in the history.
  const dragHistoryRef = useRef(false);
  const [clipDragEndTick, setClipDragEndTick] = useState(0);
  const onClipDragChange = useCallback((active: boolean) => {
    clipDraggingRef.current = active;
    dragHistoryRef.current = false;
    if (!active) setClipDragEndTick((tick) => tick + 1);
  }, []);
  useEffect(() => {
    if (!draft || clipDraggingRef.current) return;
    const end = timedContentEnd(draft.objects);
    const next = end > 0 ? Math.max(0.1, Math.round(end * 1000) / 1000) : DEFAULT_SCENE_SECONDS;
    if (Math.abs(duration - next) < 0.0005) return;
    setDuration(next);
    setDirty(true); // so the corrected length is saved (and used by MP4 export)
    setPlayhead((current) => Math.min(current, next));
  }, [draft, clipDragEndTick, duration]);

  // Playback stops and holds on the last frame; pressing Play there starts again from frame 0.
  useEffect(() => {
    if (isPlaying && playhead >= duration) setPlaying(false);
  }, [isPlaying, playhead, duration, setPlaying]);
  useEffect(() => {
    // The former scene "Loop playback" toggle no longer exists; drop its stored setting.
    try { window.localStorage.removeItem("cb-loop-playback"); } catch { /* storage unavailable */ }
  }, []);

  useEffect(() => {
    if (!render || !["queued", "running"].includes(render.status)) return;
    const timer = window.setInterval(async () => {
      const latest = await api.getRender(render.id);
      setRender(latest);
      if (latest.status === "complete") {
        showNotice("MP4 render complete - Download MP4 is ready.");
        window.clearInterval(timer);
      } else if (latest.status === "failed") {
        showNotice(`Render failed: ${latest.error || "Unknown render error"}`, "error");
        window.clearInterval(timer);
      }
    }, 1500);
    return () => window.clearInterval(timer);
  }, [render]);

  const resetCanvasView = useCallback(() => {
    setCanvasZoom(1);
    setCanvasViewResetRevision((value) => value + 1);
  }, []);

  // Part editing has two levels, like an Animate symbol: a part can be selected (1st double-click)
  // and then entered (2nd double-click on the same part; partReplacementBrowserOpen = entered).
  const partLevelRef = useRef({ part: activeCharacterPart, entered: partReplacementBrowserOpen });
  partLevelRef.current = { part: activeCharacterPart, entered: partReplacementBrowserOpen };

  // Plain selection (click, drag, panel): keeps the part entered only when it is the same part.
  // Set both explicitly: canvas picks re-select the character first, which resets the part level.
  const handleActiveCharacterPart = useCallback((partKey: CharacterPartKey | null) => {
    const { part, entered } = partLevelRef.current;
    setActiveCharacterPart(partKey || null);
    setPartReplacementBrowserOpen(Boolean(partKey) && partKey === part && entered);
  }, []);

  // Canvas double-click: selects a part, or enters it when it was already the selected part
  // before the gesture began. The canvas re-selects the character first, which clears the part,
  // so the part is always set again here.
  const handleCharacterPartDoubleClick = useCallback((partKey: CharacterPartKey, alreadySelected: boolean) => {
    setActiveCharacterPart(partKey);
    setPartReplacementBrowserOpen(alreadySelected);
  }, []);


  const selected = useMemo(() => draft?.objects.find((item) => item.id === selectedObjectId) || null, [draft, selectedObjectId]);
  const selectedCharacterTransform = useMemo(() => selected?.type === "character" ? resolveCharacterTransformAtTime(selected, playhead) : null, [playhead, selected]);

  useEffect(() => {
    if (selected?.type === "character" && String(selected.characterId || "").startsWith("html5:")) {
      setReferenceCharacterId(String(selected.characterId).replace(/^html5:/, ""));
    }
  }, [selected]);
  const audioLayers = useMemo(() => (draft?.objects || []).filter((item) => item.type === "audio" && item.assetUrl), [draft]);

  useEffect(() => {
    const players = new Map<string, HTMLAudioElement>();
    for (const layer of audioLayers) {
      if (!layer.assetUrl) continue;
      const audio = new Audio(layer.assetUrl);
      audio.preload = "auto";
      audio.volume = Math.max(0, Math.min(1, layer.volume ?? 1));
      players.set(layer.id, audio);
    }
    audioPlayersRef.current.forEach((audio) => audio.pause());
    audioPlayersRef.current = players;
    return () => players.forEach((audio) => audio.pause());
  }, [audioLayers]);

  useEffect(() => {
    for (const layer of audioLayers) {
      const audio = audioPlayersRef.current.get(layer.id);
      if (!audio) continue;
      const start = Math.max(0, layer.startTime ?? 0);
      const clipDuration = (layer.actionDurationMs || duration * 1000) / 1000;
      const shouldPlay = isPlaying && playhead >= start && playhead < Math.min(duration, start + clipDuration);
      if (shouldPlay) {
        const target = Math.max(0, playhead - start);
        if (audio.paused) {
          try { audio.currentTime = target; } catch { /* metadata pending */ }
          void audio.play().catch(() => undefined);
        } else if (Math.abs(audio.currentTime - target) > 0.3) {
          // The playhead jumped (loop playback restart or a seek while playing): follow it.
          try { audio.currentTime = target; } catch { /* metadata pending */ }
        }
      } else if (!audio.paused) audio.pause();
    }
  }, [audioLayers, duration, isPlaying, playhead]);

  const mutate = useCallback((fn: (data: EditorData) => void) => {
    setDirty(true);
    setDraft((current) => {
      if (!current) return current;
      historyPastRef.current.push(clone(current));
      if (historyPastRef.current.length > 60) historyPastRef.current.shift();
      historyFutureRef.current = [];
      const next = clone(current);
      fn(next);
      return next;
    });
  }, []);

  const mutateSelected = useCallback((fn: (item: EditorObject) => void) => {
    if (!selectedObjectId) return;
    mutate((data) => {
      const item = data.objects.find((object) => object.id === selectedObjectId);
      if (item) fn(item);
    });
  }, [mutate, selectedObjectId]);

  // ---- Recolour panel (opened from the Fill/Stroke boxes at the bottom of the tool palette).
  const openRecolor = (target: ColorReplacement["target"]) => {
    const rect = fillStrokeRef.current?.getBoundingClientRect();
    if (rect) setRecolorPosition({ left: Math.round(rect.right + 14), bottom: Math.max(12, Math.round(window.innerHeight - rect.bottom)) });
    setRecolorTarget(target);
    setRecolorOpen(true);
  };
  const closeRecolor = () => { setRecolorOpen(false); setColorPickActive(false); setPreviewColorReplacement(null); };
  const commitColorReplacement = (rule: Omit<ColorReplacement, "id">) => {
    if (selected?.type !== "character") return;
    mutateSelected((item) => {
      item.colorReplacements = [...(item.colorReplacements || []), { ...rule, id: `cr-${Date.now()}-${Math.random().toString(36).slice(2, 7)}` }];
    });
  };
  const removeColorReplacement = (id: string) => mutateSelected((item) => { item.colorReplacements = (item.colorReplacements || []).filter((rule) => rule.id !== id); });
  const resetColorReplacements = () => mutateSelected((item) => { item.colorReplacements = []; });
  // Eyedropper: the source colour under the pointer becomes the panel's "Find" colour.
  const pickCharacterColor = (clientX: number, clientY: number) => {
    setColorPickActive(false);
    if (selected?.type !== "character") return;
    const frame = frameAccessRef.current?.(selected.id);
    const rect = frame?.getBoundingClientRect();
    if (!frame || !rect || rect.width <= 0 || rect.height <= 0) return;
    try {
      const colorAt = (frame.contentWindow as (Window & { cbColorAt?: (x: number, y: number, scope: string) => { picked: string; original: string } | null }) | null)?.cbColorAt;
      const result = typeof colorAt === "function"
        ? colorAt((clientX - rect.left) / rect.width, (clientY - rect.top) / rect.height, pickScopeRef.current === "*" ? "" : pickScopeRef.current)
        : null;
      if (result) setPickedColor((previous) => ({ color: result.original, nonce: (previous?.nonce || 0) + 1 }));
      else showNotice("No character colour there. Click on the character's artwork.");
    } catch { /* player not reachable */ }
  };

  // Cmd/Ctrl+F opens Find and Replace (Animate); Esc cancels its canvas eyedropper.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (frPicking && event.key === "Escape") { event.preventDefault(); event.stopImmediatePropagation(); setFrPicking(null); return; }
      if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === "f") {
        const element = event.target as HTMLElement | null;
        if (element && (element.isContentEditable || /^(input|textarea|select)$/i.test(element.tagName))) return;
        event.preventDefault();
        setFindReplaceOpen(true);
      }
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  }, [frPicking]);

  // Fill / Stroke keys, as in Illustrator: X = make the other box active, Shift+X = swap the colours;
  // Esc cancels the box eyedropper.
  const swapBoxColoursRef = useRef<() => void>(() => undefined);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (boxPicking && event.key === "Escape") { event.preventDefault(); setBoxPicking(false); setActiveTool("select"); return; }
      if (event.code !== "KeyX" || event.metaKey || event.ctrlKey || event.altKey || event.repeat) return;
      const element = event.target as HTMLElement | null;
      if (element && (element.isContentEditable || /^(input|textarea|select)$/i.test(element.tagName))) return;
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
      event.preventDefault();
      if (event.shiftKey) swapBoxColoursRef.current();
      else setActiveBox((box) => (box === "fill" ? "stroke" : "fill"));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [boxPicking]);

  // Alt/Option flips the Lighten / Darken tool to darken (cursor shows − instead of +).
  useEffect(() => {
    if (activeTool !== "tone") { setToneDarken(false); return; }
    const sync = (event: KeyboardEvent | PointerEvent) => setToneDarken(event.altKey);
    window.addEventListener("keydown", sync);
    window.addEventListener("keyup", sync);
    window.addEventListener("pointermove", sync);
    return () => {
      window.removeEventListener("keydown", sync);
      window.removeEventListener("keyup", sync);
      window.removeEventListener("pointermove", sync);
    };
  }, [activeTool]);

  // ---- Lighten / Darken tool. A click finds the ORIGINAL colour under the pointer (as the eyedropper
  // does) and adds or updates one recolour rule for it, moving only its lightness (hue and saturation
  // stay). Repeated clicks keep adjusting the same rule; back at the original, the rule is removed.
  const adjustCharacterTone = (clientX: number, clientY: number, darker: boolean, fine: boolean) => {
    if (selected?.type !== "character") return;
    const scope = activeCharacterPart || "*";
    const frame = frameAccessRef.current?.(selected.id);
    const rect = frame?.getBoundingClientRect();
    if (!frame || !rect || rect.width <= 0 || rect.height <= 0) return;
    let original = "";
    try {
      const colorAt = (frame.contentWindow as (Window & { cbColorAt?: (x: number, y: number, scope: string) => { picked: string; original: string } | null }) | null)?.cbColorAt;
      const result = typeof colorAt === "function" ? colorAt((clientX - rect.left) / rect.width, (clientY - rect.top) / rect.height, scope === "*" ? "" : scope) : null;
      original = result?.original || "";
    } catch { original = ""; }
    if (!/^#[0-9a-f]{6}$/i.test(original)) { showNotice("No character colour there. Click on the character's artwork."); return; }
    original = original.toLowerCase();
    // An existing rule for this colour (e.g. a find-and-replace) is adjusted from its current result.
    const existing = [...(selected.colorReplacements || [])].reverse().find((rule) => rule.from === original && rule.scope === scope);
    const next = shiftLightness(existing?.to || original, (darker ? -1 : 1) * (fine ? 0.03 : 0.08));
    mutateSelected((item) => {
      const rules = item.colorReplacements || [];
      if (existing) {
        item.colorReplacements = next === original
          ? rules.filter((rule) => rule.id !== existing.id)
          : rules.map((rule) => (rule.id === existing.id ? { ...rule, to: next } : rule));
      } else {
        item.colorReplacements = [...rules, { id: `tone-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, from: original, to: next, target: "both", scope, match: toneShades ? "shades" : "exact" }];
      }
    });
  };
  // Find and Replace eyedropper: the colour of whatever is under the pointer. A character gives the
  // original colour of the shape there; text and props their colour; empty stage the background.
  const pickDialogColour = (clientX: number, clientY: number) => {
    const target = frPicking;
    setFrPicking(null);
    if (!target || !draft) return;
    const holder = (document.elementsFromPoint(clientX, clientY) as HTMLElement[])
      .map((element) => element.closest<HTMLElement>("[data-editor-object-id]"))
      .find((element): element is HTMLElement => Boolean(element));
    const object = holder ? draft.objects.find((item) => item.id === holder.getAttribute("data-editor-object-id")) : undefined;
    let colour: string | null = null;
    if (object?.type === "character") {
      const frame = frameAccessRef.current?.(object.id);
      const rect = frame?.getBoundingClientRect();
      try {
        const colorAt = (frame?.contentWindow as (Window & { cbColorAt?: (x: number, y: number, scope: string) => { picked: string; original: string } | null }) | null | undefined)?.cbColorAt;
        if (rect && typeof colorAt === "function") colour = colorAt((clientX - rect.left) / rect.width, (clientY - rect.top) / rect.height, "")?.original || null;
      } catch { colour = null; }
    } else if (object?.type === "text") colour = object.fillColor || "#ffffff";
    else if (object?.type === "prop") colour = object.fillColor || null;
    else colour = draft.background || null;
    const hex = normalizeHex(colour);
    if (hex) setFrPicked((previous) => ({ target, color: hex, nonce: (previous?.nonce || 0) + 1 }));
    else showNotice("No colour there. Click on a character, text or the background.");
  };

  // "All character library": which My characters (one per package) use the colour, so the dialog
  // can offer to duplicate them first; takenNames keeps the copies' names unique.
  const prepareLibraryReplace = async (request: FindRequest) => {
    const custom = characterLibraryCharacters.filter((character) => character.origin === "custom");
    const using = await charactersUsingColour(characterLibraryCharacters, custom.map((character) => character.id), normalizeHex(request.find) || "");
    const perPackage = new Map<string, { id: string; name: string }>();
    for (const character of custom) {
      if (using.has(character.id) && character.libraryPackageId && !perPackage.has(character.libraryPackageId)) perPackage.set(character.libraryPackageId, { id: character.id, name: character.name });
    }
    return {
      characters: Array.from(perPackage.values()),
      takenNames: custom.map((character) => character.name),
      message: perPackage.size ? undefined : "No character in My characters uses this colour.",
    };
  };

  // Find and Replace across a context. Runs on copies first to count; the current scene changes
  // through the undo history, other scenes and open projects are saved straight to the server.
  const runFindReplace = async (request: FindRequest, extra?: { duplicates?: { characterId: string; name: string }[] }): Promise<{ message: string; changed: boolean }> => {
    if (!draft || !project || !scene) return { message: "Open a project first.", changed: false };
    const contextLabel = { frame: "the current frame", scene: "this scene", document: "this document", "open-files": "the open files", library: "My characters" }[request.context];
    const findHex = normalizeHex(request.find) || "";
    const replaceHex = normalizeHex(request.replace) || "";

    // "Create a duplicate library before proceeding": each copy gets the new colour, the original
    // and every character already placed in a scene stay as they are.
    if (request.context === "library" && extra?.duplicates?.length) {
      const created: string[] = [];
      for (const item of extra.duplicates) {
        const character = characterLibraryCharacters.find((entry) => entry.id === item.characterId);
        if (!character?.libraryPackageId) continue;
        const copy = await api.duplicateCustomCharacter(character.libraryPackageId, item.name, character.id);
        const holder = { colorReplacements: [...(character.colorReplacements || [])] } as EditorObject;
        addColorRule(holder, findHex, replaceHex);
        await api.setCustomCharacterColors(copy.package.id, holder.colorReplacements || []);
        created.push(copy.package.name);
      }
      await refreshCharacterLibrary();
      if (!created.length) return { message: "No character in My characters uses this colour.", changed: false };
      const message = `Created ${created.map((name) => `“${name}”`).join(", ")} in My characters with the new colour. Original${created.length === 1 ? "" : "s"} unchanged.`;
      showNotice(message);
      return { message, changed: true };
    }
    type Target = { sceneId: string; projectId: string; data: EditorData; current: boolean };
    const newest = (item: Scene): EditorData => {
      const backup = readSceneBackup(item.id);
      return clone(normalizeEditorData(backup && backup.savedAt > (Date.parse(item.updated_at) || 0) ? backup.editor_data : item.editor_data));
    };
    const targets: Target[] = [{ sceneId: scene.id, projectId: project.id, data: clone(draft), current: true }];
    if (request.context === "document" || request.context === "open-files" || request.context === "library") {
      for (const other of project.scenes) if (other.id !== scene.id) targets.push({ sceneId: other.id, projectId: project.id, data: newest(other), current: false });
    }
    if (request.context === "open-files") {
      for (const tab of readOpenProjects()) {
        if (tab.id === project.id) continue;
        try {
          const other = await api.getProject(tab.id);
          for (const item of other.scenes) targets.push({ sceneId: item.id, projectId: other.id, data: newest(item), current: false });
        } catch { /* a closed or deleted project is skipped */ }
      }
    }

    let using = new Set<string>();
    let libraryCharacters = 0;
    if (request.kind === "colour") {
      const ids = request.context === "library"
        ? characterLibraryCharacters.filter((character) => character.origin === "custom").map((character) => character.id)
        : targets.flatMap((target) => (target.data.objects || []).filter((object) => object.type === "character").map(libraryIdOf));
      using = await charactersUsingColour(characterLibraryCharacters, ids, findHex);
      if (request.context === "library") {
        if (!using.size) return { message: "No character in My characters uses this colour.", changed: false };
        const byPackage = new Map<string, (typeof characterLibraryCharacters)[number]>();
        for (const character of characterLibraryCharacters) if (using.has(character.id) && character.libraryPackageId) byPackage.set(character.libraryPackageId, character);
        for (const [packageId, character] of byPackage) {
          const holder = { colorReplacements: [...(character.colorReplacements || [])] } as EditorObject;
          if (!addColorRule(holder, findHex, replaceHex)) continue;
          await api.setCustomCharacterColors(packageId, holder.colorReplacements || []);
          libraryCharacters += 1;
        }
        await refreshCharacterLibrary();
      }
    }

    const onlyIds = request.context === "frame" ? new Set(draft.objects.filter((object) => visibleAt(object, playhead)).map((object) => object.id)) : undefined;
    const options = { onlyIds, usesColour: (object: EditorObject) => using.has(libraryIdOf(object)), charactersOnly: request.context === "library" };
    let counts = emptyCounts();
    const scenesChanged = new Set<string>();
    const projectsChanged = new Set<string>();
    for (const target of targets) {
      const found = applyToEditorData(target.data, request, target.current ? options : { ...options, onlyIds: undefined });
      if (!totalCount(found)) continue;
      counts = addCounts(counts, found);
      scenesChanged.add(target.sceneId);
      projectsChanged.add(target.projectId);
      if (target.current) mutate((data) => { applyToEditorData(data, request, options); });
      else {
        const saved = await api.updateScene(target.sceneId, { editor_data: target.data });
        clearSceneBackup(target.sceneId);
        if (target.projectId === project.id) refreshScene(saved);
      }
    }

    if (!totalCount(counts) && !libraryCharacters) return { message: `No matches found in ${contextLabel}.`, changed: false };
    const message = request.context === "library"
      ? `Saved on ${libraryCharacters} character${libraryCharacters === 1 ? "" : "s"} in My characters${totalCount(counts) ? `; ${describeCounts(counts, scenesChanged.size, "scenes").replace(/^Replaced in /, "also updated ")}` : "."}`
      : describeCounts(counts, projectsChanged.size > 1 ? projectsChanged.size : scenesChanged.size, projectsChanged.size > 1 ? "projects" : "scenes");
    showNotice(message);
    return { message, changed: true };
  };

  // Stage presses while picking: the dialogs' eyedroppers first, otherwise the Lighten / Darken tool.
  const handleStageColorPress = (clientX: number, clientY: number, modifiers: { altKey: boolean; shiftKey: boolean }) => {
    if (frPicking) { pickDialogColour(clientX, clientY); return; }
    if (boxPicking) { pickBoxColour(clientX, clientY); return; }
    if (colorPickActive) { pickCharacterColor(clientX, clientY); return; }
    if (activeTool === "tone") adjustCharacterTone(clientX, clientY, modifiers.altKey, modifiers.shiftKey);
  };
  const toneToolLive = activeTool === "tone" && selected?.type === "character";

  // ---- Fill / Stroke boxes (Illustrator). What they hold depends on the selection:
  // text → its colour (no stroke); prop → its fill; nothing (or an empty layer) → the scene
  // background; character → an original colour of its artwork, in the part being edited if any.
  const boxScope = activeCharacterPart || "*";
  const characterRulesKey = selected?.type === "character" ? JSON.stringify(selected.colorReplacements || []) : "";
  useEffect(() => {
    if (selected?.type !== "character") { setBoxPalette(null); return; }
    const objectId = selected.id, scope = boxScope;
    let cancelled = false;
    const read = () => {
      try {
        const frame = frameAccessRef.current?.(objectId);
        const palette = (frame?.contentWindow as (Window & { cbColorPalette?: (scope: string) => { color: string; current: string; fills: number; strokes: number }[] }) | null | undefined)?.cbColorPalette?.(scope === "*" ? "" : scope);
        if (!cancelled && Array.isArray(palette) && palette.length) setBoxPalette({ key: `${objectId}|${scope}`, entries: palette });
      } catch { /* player not reachable yet */ }
    };
    // The player shows new rules a moment after an edit, and may still be loading.
    const timers = [120, 450, 1200, 3000].map((ms) => window.setTimeout(read, ms));
    return () => { cancelled = true; timers.forEach((timer) => window.clearTimeout(timer)); };
  }, [selected?.id, selected?.type, boxScope, characterRulesKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setBoxPicking(false); }, [selected?.id]);

  type BoxState = { kind: "character" | "text" | "prop" | "background" | "none"; fill: string | null; stroke: string | null; fillOriginal?: string; strokeOriginal?: string };
  const boxState: BoxState = (() => {
    if (!selected || selected.type === "empty") return { kind: "background", fill: normalizeHex(draft?.background) || "#ffffff", stroke: null };
    if (selected.type === "text") return { kind: "text", fill: normalizeHex(selected.fillColor) || "#ffffff", stroke: null };
    if (selected.type === "prop") return { kind: "prop", fill: normalizeHex(selected.fillColor) || "#17343a", stroke: null };
    if (selected.type !== "character") return { kind: "none", fill: null, stroke: null };
    const entries = boxPalette?.key === `${selected.id}|${boxScope}` ? boxPalette.entries : [];
    const picks = boxPicks?.objectId === selected.id && boxPicks.scope === boxScope ? boxPicks : null;
    // What an original colour shows now: the last exact rule for it wins, as in the player.
    const currentOf = (original: string, box: "fill" | "stroke") => {
      const rule = [...(selected.colorReplacements || [])].reverse().find((item) => item.match !== "shades" && item.from === original
        && (item.scope === "*" || item.scope === boxScope) && (item.target === "both" || item.target === box));
      return rule?.to || entries.find((entry) => entry.color === original)?.current || original;
    };
    const originalOf = (box: "fill" | "stroke") => picks?.[box]
      || [...entries].filter((entry) => (box === "fill" ? entry.fills : entry.strokes) > 0).sort((a, b) => (box === "fill" ? b.fills - a.fills : b.strokes - a.strokes))[0]?.color;
    const fillOriginal = originalOf("fill"), strokeOriginal = originalOf("stroke");
    return { kind: "character", fill: fillOriginal ? currentOf(fillOriginal, "fill") : null, stroke: strokeOriginal ? currentOf(strokeOriginal, "stroke") : null, fillOriginal, strokeOriginal };
  })();

  /** Rules with "original → hex" for that box (fills or outlines) in the current scope, placed last so it wins. */
  const withBoxRule = (rules: ColorReplacement[], original: string, box: "fill" | "stroke", hex: string) => {
    const mine = rules.find((rule) => rule.from === original && rule.scope === boxScope && rule.target === box && rule.match === "exact");
    const rest = rules.filter((rule) => rule !== mine);
    const othersApply = rest.some((rule) => rule.from === original && (rule.scope === "*" || rule.scope === boxScope) && (rule.target === "both" || rule.target === box));
    if (hex === original && !othersApply) return rest; // back to the artwork's own colour
    return [...rest, { id: mine?.id || `box-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, from: original, to: hex, target: box, scope: boxScope, match: "exact" as const }];
  };
  const applyBoxColour = (box: "fill" | "stroke", hex: string) => {
    if (boxState.kind === "background") mutate((data) => { data.background = hex; });
    else if ((boxState.kind === "text" || boxState.kind === "prop") && box === "fill") mutateSelected((item) => { item.fillColor = hex; });
    else if (boxState.kind === "character") {
      const original = box === "fill" ? boxState.fillOriginal : boxState.strokeOriginal;
      if (original) mutateSelected((item) => { item.colorReplacements = withBoxRule(item.colorReplacements || [], original, box, hex); });
    }
  };
  // ⇄ / Shift+X: a character's fill colour and outline colour trade places.
  const swapBoxColours = () => {
    if (boxState.kind !== "character" || !boxState.fillOriginal || !boxState.strokeOriginal || !boxState.fill || !boxState.stroke) return;
    const { fillOriginal, strokeOriginal, fill, stroke } = boxState;
    mutateSelected((item) => { item.colorReplacements = withBoxRule(withBoxRule(item.colorReplacements || [], fillOriginal, "fill", stroke), strokeOriginal, "stroke", fill); });
  };
  swapBoxColoursRef.current = swapBoxColours;
  // Eyedropper on a character: the original colour under the pointer goes into the active box.
  const pickBoxColour = (clientX: number, clientY: number) => {
    setBoxPicking(false);
    setActiveTool("select");
    if (selected?.type !== "character") return;
    const frame = frameAccessRef.current?.(selected.id);
    const rect = frame?.getBoundingClientRect();
    if (!frame || !rect || rect.width <= 0 || rect.height <= 0) return;
    try {
      const colorAt = (frame.contentWindow as (Window & { cbColorAt?: (x: number, y: number, scope: string) => { picked: string; original: string } | null }) | null)?.cbColorAt;
      const result = typeof colorAt === "function" ? colorAt((clientX - rect.left) / rect.width, (clientY - rect.top) / rect.height, boxScope === "*" ? "" : boxScope) : null;
      const original = normalizeHex(result?.original);
      if (!original) { showNotice("No character colour there. Click on the character's artwork."); return; }
      const objectId = selected.id;
      setBoxPicks((previous) => ({ ...(previous?.objectId === objectId && previous.scope === boxScope ? previous : {}), objectId, scope: boxScope, [activeBox]: original }));
    } catch { /* player not reachable */ }
  };

  const sampleCanvasColor = async () => {
    // On a character the eyedropper loads one of its colours into the active Fill / Stroke box.
    if (selected?.type === "character") {
      setActiveTool("eyedropper");
      setBoxPicking(true);
      showNotice(`Click a colour on the character: it goes into the ${activeBox === "fill" ? "Fill" : "Stroke"} box.`);
      return;
    }
    setActiveTool("eyedropper");
    const EyeDropper = (window as WindowWithEyeDropper).EyeDropper;
    if (!EyeDropper) {
      showNotice("Canvas color sampling is not supported in this browser. Try Chrome or the CB Studio desktop app.");
      return;
    }

    try {
      const { sRGBHex } = await new EyeDropper().open();
      if (selected?.type === "text" || selected?.type === "prop") {
        mutateSelected((item) => { item.fillColor = sRGBHex; });
      } else {
        mutate((data) => { data.background = sRGBHex; });
      }
    } catch (cause) {
      if (!(cause instanceof DOMException && cause.name === "AbortError")) {
        showNotice(cause instanceof Error ? cause.message : "Could not sample canvas color", "error");
      }
    }
  };

  const draftRef = useRef(draft);
  draftRef.current = draft;
  const sceneRef = useRef(scene);
  sceneRef.current = scene;
  const durationRef = useRef(duration);
  durationRef.current = duration;
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;

  // Autosave: ~1s after the last change the scene is saved to the server (one save at a time).
  const draftRevisionRef = useRef(0);
  const savingRef = useRef<Promise<void> | null>(null);
  const scheduleThumbnailRef = useRef<() => void>(() => undefined);
  const retryTimerRef = useRef<number | null>(null);
  const flushAutosave = useCallback(async () => {
    while (savingRef.current) await savingRef.current;
    const target = sceneRef.current;
    const data = draftRef.current;
    if (!dirtyRef.current || !target || !data) return;
    const revision = draftRevisionRef.current;
    setSaveState("saving");
    const run = (async () => {
      try {
        const saved = await api.updateScene(target.id, { editor_data: data, duration_seconds: durationRef.current });
        refreshScene(saved);
        if (draftRevisionRef.current === revision && sceneRef.current?.id === target.id) {
          dirtyRef.current = false;
          setDirty(false);
          clearSceneBackup(target.id);
          setSaveState("saved");
          scheduleThumbnailRef.current();
        }
      } catch {
        setSaveState("error");
        // The local copy is safe; try the server again shortly.
        if (retryTimerRef.current) window.clearTimeout(retryTimerRef.current);
        retryTimerRef.current = window.setTimeout(() => { void flushAutosave(); }, 5000);
      }
    })();
    savingRef.current = run;
    try { await run; } finally { savingRef.current = null; }
  }, [refreshScene]);

  useEffect(() => {
    if (!dirty || !scene || !draft) return;
    draftRevisionRef.current += 1;
    writeSceneBackup(scene.id, { savedAt: Date.now(), duration, editor_data: draft });
    setSaveState("unsaved");
    const timer = window.setTimeout(() => { void flushAutosave(); }, 1000);
    return () => window.clearTimeout(timer);
  }, [dirty, draft, duration, flushAutosave, scene]);
  const selectedIdsRef = useRef(selectedObjectIds);
  selectedIdsRef.current = selectedObjectIds;
  const noticeTimerRef = useRef<number | null>(null);
  const showNotice = useCallback((text: string, tone: "info" | "error" = "info") => {
    setNotice({ id: Date.now(), text, tone });
    if (noticeTimerRef.current) window.clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = window.setTimeout(() => setNotice(null), 4000);
  }, []);
  const selectEditorObject = useCallback((id: string | null) => {
    selectObject(id);
    setActiveCharacterPart(null);
      setPartReplacementBrowserOpen(false);
    // Selecting never creates keyframes; only the user does (K / F6 / Insert Keyframe).
  }, [selectObject]);

  /** Multi-selection (Shift+click, marquee, Select All). One id behaves exactly like a click. */
  const changeSelection = useCallback((ids: string[]) => {
    if (ids.length === 1) { selectEditorObject(ids[0]); return; }
    setSelection(ids);
    setActiveCharacterPart(null);
    setPartReplacementBrowserOpen(false);
  }, [selectEditorObject, setSelection]);

  // ---- Animate frame timeline: frame selection, keyframe/frame commands, empty layers.
  const [frameSelection, setFrameSelection] = useState<FrameSelection>(null);
  const frameSelectionRef = useRef<FrameSelection>(null);
  frameSelectionRef.current = frameSelection;
  const playheadRef = useRef(playhead);
  playheadRef.current = playhead;

  const selectFrames = useCallback((selection: FrameSelection) => {
    setFrameSelection(selection);
    if (!selection) return;
    setPlaying(false);
    // The selected layers are selected on the canvas too.
    const ids = selectionLayerIds(selection);
    if (ids.length > 1) {
      const current = selectedIdsRef.current;
      if (current.length !== ids.length || ids.some((id) => !current.includes(id))) changeSelection(ids);
    } else if (selectedObjectId !== selection.layerId) selectEditorObject(selection.layerId);
    // The playhead follows the selection but never goes past the last frame.
    setPlayhead(Math.min(duration, selection.from / TIMELINE_FPS));
  }, [changeSelection, duration, selectEditorObject, selectedObjectId, setPlaying]);
  // Picking something on the canvas ends the frame selection (Delete then removes objects again).
  const selectFromCanvas = useCallback((id: string | null) => { setFrameSelection(null); selectEditorObject(id); }, [selectEditorObject]);
  const changeSelectionFromCanvas = useCallback((ids: string[]) => { setFrameSelection(null); changeSelection(ids); }, [changeSelection]);

  // Frame commands act on every selected layer. Each layer is checked on its own: layers the
  // command doesn't fit are skipped, and the reason is shown only when it fits none of them.
  const frameAction = useCallback((action: FrameAction, layerIds: string | string[], from: number, to: number) => {
    const ids = Array.isArray(layerIds) ? layerIds : [layerIds];
    const fps = TIMELINE_FPS;
    const lastSceneFrame = Math.max(0, Math.ceil(duration * fps - 1e-6) - 1);
    const spanOf = (item: EditorObject) => {
      const start = Math.max(0, Number(item.startTime || 0));
      const startFrame = Math.round(start * fps);
      const endFrame = item.actionDurationMs ? Math.max(startFrame, Math.round((start + item.actionDurationMs / 1000) * fps) - 1) : Math.max(startFrame, lastSceneFrame);
      return { startFrame, endFrame };
    };
    const frameOf = (time: number) => Math.round(time * fps);
    // Tweens run from the keyframe at/before the frame to the next keyframe.
    const segmentAt = (item: EditorObject, frame: number) => {
      const keys = sortKeyframes(item.keyframes || []);
      const left = [...keys].reverse().find((key) => frameOf(key.time) <= frame);
      const right = keys.find((key) => frameOf(key.time) > frame);
      return { left, right };
    };
    const problemWith = (layer: EditorObject): string | null => {
      const span = spanOf(layer);
      if (layer.type === "empty") return "This layer is empty — add a character or object from the library to fill it.";
      if (action === "keyframe" && layer.type !== "character" && from >= span.startFrame && from <= span.endFrame) {
        return "Keyframes move characters. On this layer a keyframe can only add frames after its end.";
      }
      if (action === "blank" && (from <= span.startFrame || from > span.endFrame)) {
        return from <= span.startFrame ? "A blank keyframe here would empty the whole layer — remove the layer instead." : "These frames are already empty.";
      }
      if (action === "clear-keyframe" && (layer.type !== "character" || !(layer.keyframes || []).some((frame) => frameOf(frame.time) >= from && frameOf(frame.time) <= to))) {
        return "There is no keyframe on the selected frame.";
      }
      if (action === "tween" || action === "remove-tween") {
        if (layer.type !== "character") return "Tweens move characters between two keyframes.";
        const { left, right } = segmentAt(layer, from);
        if (!left || !right) return "Select a frame between two keyframes to tween them (add keyframes with K).";
        if (action === "remove-tween" && left.tween === false) return "There is no tween here.";
      }
      if (action === "remove-frames") {
        const first = Math.max(from, span.startFrame);
        const last = Math.min(to, span.endFrame);
        if (first > last) return "Those frames are already empty.";
        if (last - first + 1 >= span.endFrame - span.startFrame + 1) return "A layer needs at least one frame — remove the layer instead.";
      }
      return null;
    };
    const targets: string[] = [];
    let firstProblem: string | null = null;
    for (const id of ids) {
      const layer = draft?.objects.find((item) => item.id === id);
      if (!layer) continue;
      const problem = problemWith(layer);
      if (problem) firstProblem = firstProblem || problem;
      else targets.push(id);
    }
    if (targets.length === 0) { if (firstProblem) showNotice(firstProblem); return; }
    mutate((data) => {
      for (const layerId of targets) {
        const item = data.objects.find((object) => object.id === layerId);
        if (!item) continue;
        const current = spanOf(item);
        const setSpan = (startFrame: number, endFrame: number) => {
          item.startTime = startFrame / fps;
          item.actionDurationMs = ((endFrame - startFrame + 1) / fps) * 1000;
        };
        const shiftKeyframesAfter = (frame: number, deltaFrames: number) => {
          if (item.type !== "character") return;
          item.keyframes = (item.keyframes || []).map((key) => (frameOf(key.time) > frame ? { ...key, time: Math.max(0, key.time + deltaFrames / fps) } : key));
        };
        if (action === "keyframe") {
          if (from < current.startFrame) setSpan(from, current.endFrame);
          else if (from > current.endFrame) setSpan(current.startFrame, from);
          if (item.type === "character") insertManualKeyframe(item, from / fps);
        } else if (action === "blank") {
          // Content ends here: the frames from the blank keyframe on are empty.
          setSpan(current.startFrame, from - 1);
          if (item.type === "character") item.keyframes = (item.keyframes || []).filter((key) => frameOf(key.time) < from);
        } else if (action === "insert-frame") {
          const count = to - from + 1;
          if (from > current.endFrame) setSpan(current.startFrame, to);
          else if (from < current.startFrame) { setSpan(current.startFrame + count, current.endFrame + count); shiftKeyframesAfter(-1, count); }
          else { setSpan(current.startFrame, current.endFrame + count); shiftKeyframesAfter(from, count); }
        } else if (action === "remove-frames") {
          const first = Math.max(from, current.startFrame);
          const last = Math.min(to, current.endFrame);
          const count = last - first + 1;
          if (item.type === "character") item.keyframes = (item.keyframes || []).filter((key) => frameOf(key.time) < first || frameOf(key.time) > last);
          shiftKeyframesAfter(last, -count);
          setSpan(current.startFrame, current.endFrame - count);
        } else if (action === "clear-keyframe") {
          item.keyframes = (item.keyframes || []).filter((key) => frameOf(key.time) < from || frameOf(key.time) > to);
        } else if (action === "tween" || action === "remove-tween") {
          const { left } = segmentAt(item, from);
          if (left) item.keyframes = (item.keyframes || []).map((key) => (key.id === left.id
            ? { ...key, tween: action === "tween" ? (key.tween ? key.tween : { easeIn: 0, easeOut: 0 }) : false as const }
            : key));
        }
        if (item.type === "character" && (item.keyframes || []).length < 2) item.manualMotionRange = null;
      }
    });
    if (action === "keyframe" || action === "insert-frame") {
      setPlaying(false);
      setPlayhead(from / fps);
    }
  }, [draft, duration, mutate, setPlaying, showNotice]);
  const frameActionRef = useRef(frameAction);
  frameActionRef.current = frameAction;

  // Drag a keyframe to another frame (Animate). Frames extend to follow it past either end;
  // dropping onto another keyframe is refused so nothing is overwritten.
  const moveKeyframe = useCallback((layerId: string, fromFrame: number, toFrame: number) => {
    const fps = TIMELINE_FPS;
    const layer = draft?.objects.find((item) => item.id === layerId);
    const keys = sortKeyframes(layer?.keyframes || []);
    const moving = keys.find((key) => Math.round(key.time * fps) === fromFrame);
    if (!layer || !moving || fromFrame === toFrame) return;
    if (keys.some((key) => key.id !== moving.id && Math.round(key.time * fps) === toFrame)) {
      showNotice("There is already a keyframe on that frame."); return;
    }
    // The first keyframe sits where the layer's content starts: the content start moves with it
    // (Animate), so frame 1 doesn't keep a second keyframe. It can't pass the next keyframe.
    const layerStartFrame = Math.round(Math.max(0, Number(layer.startTime || 0)) * fps);
    const movesContentStart = keys[0]?.id === moving.id && fromFrame === layerStartFrame;
    const nextKey = keys[1];
    if (movesContentStart && nextKey && toFrame > Math.round(nextKey.time * fps)) {
      showNotice("The first keyframe can't move past the next keyframe."); return;
    }
    mutate((data) => {
      const item = data.objects.find((object) => object.id === layerId);
      if (!item) return;
      const start = Math.max(0, Number(item.startTime || 0));
      const startFrame = Math.round(start * fps);
      const endFrame = item.actionDurationMs ? Math.max(startFrame, Math.round((start + item.actionDurationMs / 1000) * fps) - 1) : null;
      const target = Math.max(0, toFrame);
      if (movesContentStart) {
        // The end stays put; frames before the new start become empty.
        const end = endFrame == null ? null : Math.max(endFrame, target);
        item.startTime = target / fps;
        if (end != null) item.actionDurationMs = ((end - target + 1) / fps) * 1000;
      } else if (target < startFrame) {
        item.startTime = target / fps;
        if (endFrame != null) item.actionDurationMs = ((endFrame - target + 1) / fps) * 1000;
      } else if (endFrame != null && target > endFrame) {
        item.actionDurationMs = ((target - startFrame + 1) / fps) * 1000;
      }
      item.keyframes = sortKeyframes((item.keyframes || []).map((key) => (key.id === moving.id ? { ...key, time: target / fps } : key)));
      if ((item.keyframes || []).length < 2) item.manualMotionRange = null;
    });
  }, [draft, mutate, showNotice]);

  const setTweenEase = useCallback((layerId: string, keyframeId: string, easeIn: number, easeOut: number) => {
    mutate((data) => {
      const item = data.objects.find((object) => object.id === layerId);
      if (!item) return;
      item.keyframes = (item.keyframes || []).map((key) => (key.id === keyframeId
        ? { ...key, tween: { easeIn: Math.max(0, Math.min(100, Math.round(easeIn))), easeOut: Math.max(0, Math.min(100, Math.round(easeOut))) } }
        : key));
    });
  }, [mutate]);

  const addLayer = useCallback(() => {
    const layer: EditorObject = {
      id: `layer-${Date.now()}`, type: "empty", name: "Empty layer",
      x: (project?.width || 1280) / 2, y: (project?.height || 720) / 2, startTime: 0,
    };
    mutate((data) => { data.objects.push(layer); });
    selectObject(layer.id);
    setFrameSelection({ layerId: layer.id, from: 0, to: 0 });
  }, [mutate, project, selectObject]);

  const toggleLayerFlag = useCallback((id: string, flag: "hidden" | "locked") => {
    mutate((data) => {
      const item = data.objects.find((object) => object.id === id);
      if (item) item[flag] = !item[flag];
    });
  }, [mutate]);

  const patchSelected = useCallback((patch: Partial<EditorObject>, recordHistory = true) => {
    if (!selectedObjectId) return;
    if (recordHistory) {
      mutate((data) => {
        const item = data.objects.find((object) => object.id === selectedObjectId);
        if (item) Object.assign(item, patch);
      });
      return;
    }
    setDirty(true);
    setDraft((current) => {
      if (!current) return current;
      return {
        ...current,
        objects: current.objects.map((item) => item.id === selectedObjectId ? { ...item, ...patch } : item),
      };
    });
  }, [mutate, selectedObjectId]);

  const undo = useCallback(() => {
    setDraft((current) => {
      if (!current || historyPastRef.current.length === 0) return current;
      const previous = historyPastRef.current.pop()!;
      historyFutureRef.current.push(clone(current));
      setDirty(true);
      return previous;
    });
  }, []);

  const redo = useCallback(() => {
    setDraft((current) => {
      if (!current || historyFutureRef.current.length === 0) return current;
      const next = historyFutureRef.current.pop()!;
      historyPastRef.current.push(clone(current));
      setDirty(true);
      return next;
    });
  }, []);

  useEffect(() => {
    const isEditableTarget = (target: EventTarget | null) => {
      const element = target as HTMLElement | null;
      if (!element) return false;
      const tag = element.tagName?.toLowerCase();
      return tag === "input" || tag === "textarea" || tag === "select" || element.isContentEditable;
    };

    const onEditorShortcut = (event: KeyboardEvent) => {
      if (scaleRotateOpenRef.current) return;
      if ((event.metaKey || event.ctrlKey) && event.altKey && event.code === "KeyS" && !isEditableTarget(event.target)) {
        // Matched by physical key: Option+S types "ß" on macOS.
        event.preventDefault();
        event.stopImmediatePropagation();
        if (selectedIdsRef.current.length) setScaleRotateOpen(true);
        else showNotice("Select a character or object first");
        return;
      }
      const plainKey = !event.metaKey && !event.ctrlKey && !event.altKey && !isEditableTarget(event.target);
      if (plainKey && event.shiftKey && event.key.toLowerCase() === "t") {
        event.preventDefault();
        setTransparencyGrid((value) => !value);
        return;
      }
      // Animate timeline keys: K/F6 keyframe, F7 blank keyframe, F5 insert frame,
      // Shift+F5 remove frames, Shift+F6 clear keyframe, "," / "." previous / next frame.
      const timelineCommand = (action: FrameAction) => {
        const selection = frameSelectionRef.current;
        const layerId = selection?.layerId || selectedIdsRef.current[0];
        if (!layerId) { showNotice("Select a layer or a frame on the timeline first"); return; }
        const frame = selection ? selection.from : Math.floor(playheadRef.current * TIMELINE_FPS + 1e-6);
        frameActionRef.current(action, selection ? selectionLayerIds(selection) : layerId, frame, selection ? selection.to : frame);
      };
      const functionKey = !event.metaKey && !event.ctrlKey && !event.altKey && !isEditableTarget(event.target);
      if (functionKey && (event.key === "F5" || event.key === "F6" || event.key === "F7")) {
        event.preventDefault();
        if (event.key === "F5") timelineCommand(event.shiftKey ? "remove-frames" : "insert-frame");
        else if (event.key === "F6") timelineCommand(event.shiftKey ? "clear-keyframe" : "keyframe");
        else timelineCommand("blank");
        return;
      }
      // Option/Alt+Shift+M removes the tween (matched by key position: Option changes the letter on macOS).
      if (!event.metaKey && !event.ctrlKey && event.altKey && event.shiftKey && event.code === "KeyM" && !isEditableTarget(event.target)) {
        event.preventDefault();
        timelineCommand("remove-tween");
        return;
      }
      if (plainKey && event.shiftKey && event.key.toLowerCase() === "m") {
        event.preventDefault();
        timelineCommand("tween");
        return;
      }
      if (plainKey && !event.shiftKey && event.key.toLowerCase() === "k") {
        event.preventDefault();
        timelineCommand("keyframe");
        return;
      }
      if (plainKey && (event.key === "," || event.key === ".")) {
        event.preventDefault();
        setPlaying(false);
        const frame = Math.max(0, Math.floor(playheadRef.current * TIMELINE_FPS + 1e-6) + (event.key === "," ? -1 : 1));
        const lastFrame = Math.max(0, Math.ceil(durationRef.current * TIMELINE_FPS - 1e-6) - 1);
        const target = Math.min(lastFrame, frame);
        setPlayhead(target / TIMELINE_FPS);
        setFrameSelection(null); // the playhead moved: the frame selection ends
        return;
      }
      if (plainKey && event.key.toLowerCase() === "v") {
        event.preventDefault();
        setActiveTool("select");
        return;
      }
      if (plainKey && event.key.toLowerCase() === "q") {
        // Free Transform is part of the Selection tool now; Q keeps working as a shortcut to it.
        event.preventDefault();
        setActiveTool("select");
        return;
      }
      if (plainKey && !event.shiftKey && event.key.toLowerCase() === "z") {
        // Illustrator's Zoom tool (Cmd/Ctrl+Z stays Undo).
        event.preventDefault();
        setActiveTool("zoom");
        return;
      }
      if (plainKey && !event.shiftKey && event.key.toLowerCase() === "o") {
        // Illustrator's Reflect tool; Enter then opens the Reflect dialog (Cmd+O stays Open).
        event.preventDefault();
        setActiveTool("reflect");
        return;
      }
      if (plainKey && !event.shiftKey && event.key.toLowerCase() === "s") {
        // Illustrator's Scale tool (Cmd+S stays Save: plainKey excludes modifiers).
        event.preventDefault();
        setActiveTool("scale");
        return;
      }
      if (event.key === "Escape" && !activeCharacterPart) setActiveTool((tool) => (tool === "scale" || tool === "tone" || tool === "reflect" || tool === "zoom" ? "select" : tool));

      const commandOrControl = event.metaKey || event.ctrlKey;
      // Cmd/Ctrl+S save (.cb), Shift = Save As; Cmd/Ctrl+O open a .cb — also while typing.
      if (commandOrControl && !event.altKey && event.code === "KeyS") {
        event.preventDefault();
        void fileActionsRef.current.save(event.shiftKey);
        return;
      }
      if (commandOrControl && !event.altKey && !event.shiftKey && event.code === "KeyO") {
        event.preventDefault();
        void fileActionsRef.current.open();
        return;
      }
      if (!commandOrControl || isEditableTarget(event.target)) return;

      const key = event.key.toLowerCase();
      // Copy / Cut / Paste layers (in text boxes these stay normal text copy and paste, above).
      if (!event.altKey && (event.code === "KeyC" || event.code === "KeyX" || event.code === "KeyV") && !document.querySelector('[role="dialog"][aria-modal="true"]')) {
        if (event.code === "KeyC" && event.shiftKey) return;
        // Nothing selected: Copy / Cut stay the browser's own (e.g. text highlighted on the page).
        if (event.code !== "KeyV" && selectedIdsRef.current.length === 0) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        if (event.code === "KeyC") clipboardActionsRef.current.copy();
        else if (event.code === "KeyX") { if (!event.shiftKey) clipboardActionsRef.current.cut(); }
        else clipboardActionsRef.current.paste(event.shiftKey);
        return;
      }
      if (key === "a" && !event.shiftKey) {
        // Select All (Animate: Cmd/Ctrl+A) — every visual layer in the scene.
        event.preventDefault();
        changeSelection((draftRef.current?.objects || []).filter((item) => item.type !== "background" && item.type !== "audio").map((item) => item.id));
        return;
      }
      if (key === "z") {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
        return;
      }

      // Cmd/Ctrl +/- is reserved for CANVAS zoom only. This intentionally
      // overrides the browser zoom shortcut and never scales the selected part.
      if (event.key === "+" || event.key === "=" || event.code === "NumpadAdd") {
        event.preventDefault();
        event.stopImmediatePropagation();
        setCanvasZoom((value) => clampCanvasZoom(value * 1.25));
        return;
      }
      if (event.key === "-" || event.code === "NumpadSubtract") {
        event.preventDefault();
        event.stopImmediatePropagation();
        setCanvasZoom((value) => clampCanvasZoom(value / 1.25));
        return;
      }
      if (event.key === "0") {
        event.preventDefault();
        event.stopImmediatePropagation();
        resetCanvasView();
        return;
      }
      if (event.key === "1" && !event.shiftKey && !event.altKey) {
        // Illustrator: Cmd/Ctrl+1 = Actual Size (100%).
        event.preventDefault();
        event.stopImmediatePropagation();
        zoomToActualSizeRef.current();
        return;
      }

      if (!canvasHoverRef.current) return;
    };

    window.addEventListener("keydown", onEditorShortcut, { capture: true });
    return () => window.removeEventListener("keydown", onEditorShortcut, { capture: true });
  }, [activeCharacterPart, changeSelection, redo, resetCanvasView, showNotice, undo]);

  const addText = () => {
    if (!project) return;
    const object: EditorObject = {
      id: `text-${Date.now()}`, type: "text", name: "Text", text: "Your text",
      x: project.width / 2, y: project.height / 2, scale: 1, rotation: 0, opacity: 1, startTime: 0,
    };
    mutate((data) => placeInLayer(data, object, selectedIdsRef.current[0]));
    selectObject(object.id);
  };

  const addProp = (name = "Static Prop") => {
    if (!project) return;
    const object: EditorObject = {
      id: `prop-${Date.now()}`, type: "prop", name,
      x: project.width / 2, y: project.height / 2, scale: 0.75, rotation: 0, opacity: 1, startTime: 0,
    };
    mutate((data) => placeInLayer(data, object, selectedIdsRef.current[0]));
    selectObject(object.id);
  };

  const addReferenceBrowserCharacter = useCallback((referenceCharacterIdValue: string, actionId?: string, options?: { x?: number; y?: number }) => {
    if (!project) return;
    const libraryCharacter = findCharacter(referenceCharacterIdValue);
    if (!libraryCharacter) return;
    const action = libraryCharacter.actions.find((item) => item.id === actionId) || libraryCharacter.actions[0];
    if (!action) return;
    const x = options?.x ?? project.width / 2;
    const y = options?.y ?? project.height / 2;
    setReferenceCharacterId(libraryCharacter.id);
    const object: EditorObject = {
      id: `html5-${libraryCharacter.id}-${action.id}-${Date.now()}`,
      type: "character",
      name: libraryCharacter.name,
      characterId: `html5:${libraryCharacter.id}`,
      x,
      y,
      scale: 0.34,
      rotation: 0,
      opacity: 1,
      assetKind: "animate-createjs",
      assetUrl: action.assetUrl,
      previewUrl: action.thumbUrl,
      actionName: action.actionName,
      sourceFormat: "vector-createjs",
      sourceWidth: action.sourceWidth,
      sourceHeight: action.sourceHeight,
      actionDurationMs: action.durationMs,
      startTime: 0,
      // No keyframe until the user adds one; the layer's first frame is its implicit start keyframe.
      keyframes: [],
      partOverrides: {},
      partKeyframes: {},
      animationClips: [],
      sourceAnimationClips: [],
      manualMotionRange: null,
      colorOverrides: {},
      // My characters recoloured in the library start with those colours.
      ...(libraryCharacter.colorReplacements?.length ? { colorReplacements: libraryCharacter.colorReplacements.map((rule) => ({ ...rule })) } : {}),
      sourceParts: [],
      autoDetectedParts: false,
    };
    mutate((data) => placeInLayer(data, object, selectedIdsRef.current[0]));
    setDuration((current) => Math.max(current, action.durationMs / 1000));
    selectObject(object.id);
    setActiveCharacterPart(null);
    setPartReplacementBrowserOpen(false);
  }, [findCharacter, mutate, project, selectObject]);

  const setReferenceActionOnSelected = useCallback((actionId: string) => {
    const action = characterLibraryActions.find((item) => item.id === actionId);
    if (!action || !selectedObjectId) return;
    setReferenceCharacterId(action.characterId);
    mutate((data) => {
      const item = data.objects.find((object) => object.id === selectedObjectId);
      if (!item || item.type !== "character") return;
      item.name = action.characterName;
      item.characterId = `html5:${action.characterId}`;
      item.actionName = action.actionName;
      item.assetKind = "animate-createjs";
      item.assetUrl = action.assetUrl;
      item.previewUrl = action.thumbUrl;
      item.sourceWidth = action.sourceWidth;
      item.sourceHeight = action.sourceHeight;
      item.actionDurationMs = action.durationMs;
      item.sourceParts = [];
      item.autoDetectedParts = false;
      item.partReplacements = {};
      item.partOverrides = {};
    });
    setActiveCharacterPart(null);
    setPartReplacementBrowserOpen(false);
  }, [characterLibraryActions, mutate, selectedObjectId]);


  const setCharacterPartsReady = useCallback((id: string, parts: CharacterPartDescriptor[], autoDetected: boolean, contentBounds?: { width: number; height: number }) => {
    setDraft((current) => {
      if (!current || parts.length === 0) return current;
      let changed = false;
      const objects = current.objects.map((item) => {
        if (item.id !== id) return item;
        const before = JSON.stringify(item.sourceParts || []);
        const after = JSON.stringify(parts);
        if (before === after && Boolean(item.autoDetectedParts) === autoDetected) return item;
        changed = true;
        return { ...item, sourceParts: parts, autoDetectedParts: autoDetected, partOverrides: item.partOverrides || {}, colorOverrides: item.colorOverrides || {} };
      });
      if (!changed) return current;
      setDirty(true);
      return { ...current, objects };
    });
  }, []);

  const moveObject = useCallback((id: string, x: number, y: number) => {
    mutate((data) => {
      const item = data.objects.find((object) => object.id === id);
      if (!item) return;
      if (item.type === "character" && (item.keyframes || []).length > 0) moveKeyframedPosition(item, playhead, x, y);
      else { item.x = x; item.y = y; }
    });
  }, [mutate, playhead]);

  /** Multi-selection drag: every moved layer is committed in one edit (one undo step). */
  const moveObjects = useCallback((moves: Array<{ id: string; x: number; y: number }>) => {
    const byId = new Map(moves.map((entry) => [entry.id, entry]));
    mutate((data) => {
      for (const item of data.objects) {
        const target = byId.get(item.id);
        if (!target) continue;
        if (item.type === "character" && (item.keyframes || []).length > 0) moveKeyframedPosition(item, playhead, target.x, target.y);
        else { item.x = target.x; item.y = target.y; }
      }
    });
  }, [mutate, playhead]);

  const applyScaleRotate = useCallback((scalePercent: number, rotateDegrees: number) => {
    const ids = new Set(selectedObjectIds);
    if (!ids.size) return;
    const factor = scalePercent / 100;
    // A selected character part (double-click mode): only that part scales and turns, around its
    // registration point, exactly like the part box's corner handles.
    const partOwner = selectedObjectIds.length === 1 && activeCharacterPart ? draft?.objects.find((item) => item.id === selectedObjectIds[0] && item.type === "character") : undefined;
    if (partOwner && activeCharacterPart) {
      const current = resolvePartTransformAtTime(partOwner, activeCharacterPart, playhead);
      const rotation = Number(current.rotation || 0) + rotateDegrees;
      transformCharacterPart(partOwner.id, activeCharacterPart, {
        scale: Math.min(20, Math.max(0.02, Number(current.scale ?? 1) * factor)),
        rotation: ((rotation % 360) + 540) % 360 - 180,
      });
      return;
    }
    const radians = (rotateDegrees * Math.PI) / 180;
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);
    const wrapDegrees = (value: number) => {
      let next = value % 360;
      if (next > 180) next -= 360;
      if (next <= -180) next += 360;
      return next;
    };
    mutate((data) => {
      const states = data.objects
        .filter((item) => ids.has(item.id) && item.type !== "background" && item.type !== "audio")
        .map((item) => ({
          item,
          current: item.type === "character"
            ? resolveCharacterTransformAtTime(item, playhead)
            : { x: item.x, y: item.y, scale: item.scale || 1, rotation: item.rotation || 0 },
        }));
      if (!states.length) return;
      const xs = states.map((state) => state.current.x);
      const ys = states.map((state) => state.current.y);
      const centerX = (Math.min(...xs) + Math.max(...xs)) / 2;
      const centerY = (Math.min(...ys) + Math.max(...ys)) / 2;
      for (const { item, current } of states) {
        let x = current.x;
        let y = current.y;
        if (states.length > 1) {
          // Group transform: positions scale and turn (clockwise, like Animate) around the selection centre.
          const dx = (current.x - centerX) * factor;
          const dy = (current.y - centerY) * factor;
          x = centerX + dx * cos - dy * sin;
          y = centerY + dx * sin + dy * cos;
        }
        const scale = Math.min(20, Math.max(0.02, Number(current.scale || 1) * factor));
        const rotation = wrapDegrees(Number(current.rotation || 0) + rotateDegrees);
        // Character keyframes animate position only; scale and rotation live on the object.
        if (item.type === "character" && (item.keyframes || []).length > 0) moveKeyframedPosition(item, playhead, x, y);
        else { item.x = x; item.y = y; }
        item.scale = scale; item.rotation = rotation;
      }
    });
    // transformCharacterPart is declared below; it only depends on mutate and playhead (listed here).
  }, [activeCharacterPart, draft, mutate, playhead, selectedObjectIds]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- Reflect (Illustrator). One layer mirrors in place around its centre; several also mirror
  // their positions around the selection's centre; a selected part mirrors around its registration
  // point, inside its character. Copy reflects duplicates (new ids given) and keeps the originals.
  const reflectInto = (data: EditorData, angle: number, copyIds?: string[]) => {
    const partOwner = selectedObjectIds.length === 1 && activeCharacterPart ? data.objects.find((item) => item.id === selectedObjectIds[0] && item.type === "character") : undefined;
    if (partOwner && activeCharacterPart) {
      const current = resolvePartTransformAtTime(partOwner, activeCharacterPart, playhead);
      const local = axisInsideCharacter(angle, Number(partOwner.rotation || 0), Boolean(partOwner.flipX));
      const next = reflectOrientation({ rotation: Number(current.rotation || 0), flipX: Boolean(current.flipX), skewX: Number(current.skewX || 0), skewY: Number(current.skewY || 0) }, local);
      writePartTransform(partOwner, activeCharacterPart, next, playhead);
      return;
    }
    const ids = new Set(selectedObjectIds);
    let states = data.objects
      .filter((item) => ids.has(item.id) && item.type !== "background" && item.type !== "audio")
      .map((item) => ({ item, current: item.type === "character" ? resolveCharacterTransformAtTime(item, playhead) : { x: item.x, y: item.y } }));
    if (!states.length) return;
    if (copyIds) {
      // Each copy goes right above its original, as a new layer.
      states = states.map((state, index) => {
        const duplicate = clone(state.item);
        duplicate.id = copyIds[index];
        data.objects.splice(data.objects.indexOf(state.item) + 1, 0, duplicate);
        return { ...state, item: duplicate };
      });
    }
    const xs = states.map((state) => state.current.x), ys = states.map((state) => state.current.y);
    const centerX = (Math.min(...xs) + Math.max(...xs)) / 2, centerY = (Math.min(...ys) + Math.max(...ys)) / 2;
    for (const { item, current } of states) {
      const next = reflectOrientation({ rotation: Number(item.rotation || 0), flipX: Boolean(item.flipX), skewX: Number(item.skewX || 0), skewY: Number(item.skewY || 0) }, angle);
      item.rotation = next.rotation;
      item.flipX = next.flipX;
      if (item.skewX || next.skewX) item.skewX = next.skewX;
      if (item.skewY || next.skewY) item.skewY = next.skewY;
      if (states.length > 1) {
        const point = reflectPoint(current.x, current.y, centerX, centerY, angle);
        if (item.type === "character" && (item.keyframes || []).length > 0) moveKeyframedPosition(item, playhead, point.x, point.y);
        else { item.x = point.x; item.y = point.y; }
      }
    }
  };
  const reflectTarget = selectedObjectIds.length === 1 && selected?.type === "character" && activeCharacterPart
    ? partLabel(selected, activeCharacterPart) : undefined;
  const openReflect = () => {
    if (!draft || !selectedObjectIds.length) { showNotice("Select a character or object first"); return; }
    reflectBaseRef.current = draft;
    setReflectOpen(true);
  };
  openReflectRef.current = openReflect;
  // Preview: redrawn from the original each time (not saved, not in the undo history).
  const previewReflect = (angle: number | null) => {
    const base = reflectBaseRef.current;
    if (!base) return;
    if (angle == null) { setDraft(base); return; }
    const next = clone(base);
    reflectInto(next, angle);
    setDraft(next);
  };
  const closeReflect = () => { reflectBaseRef.current = null; setReflectOpen(false); };
  const cancelReflect = () => {
    const base = reflectBaseRef.current;
    if (base) { setDraft(base); setDirty(true); } // an autosave during the preview is undone by saving again
    closeReflect();
  };
  const applyReflect = (angle: number, copy: boolean) => {
    const base = reflectBaseRef.current;
    if (!base) return;
    const stamp = Date.now();
    const copyIds = copy ? selectedObjectIds.map((id, index) => `${id}-copy-${stamp}${index}`) : undefined;
    setDraft(base); // the preview is replaced by one undoable change
    mutate((data) => reflectInto(data, angle, copyIds));
    if (copyIds) changeSelection(copyIds);
    closeReflect();
  };

  // ---- Copy / Cut / Paste layers (Cmd/Ctrl+C, X, V; Cmd/Ctrl+Shift+V = Paste in Place), as in
  // Animate. Whole layers with everything on them (pose, part edits, colours, keyframes, timing).
  // The clipboard lives in this browser / app while it is open, so it works across scenes and projects.
  const copyLayers = (): boolean => {
    if (!draft) return false;
    if (activeCharacterPart) { showNotice("Press Esc to select the whole character, then copy."); return false; }
    const ids = new Set(selectedObjectIds);
    const objects = draft.objects.filter((item) => ids.has(item.id) && item.type !== "empty");
    if (!objects.length) return false;
    const points = objects.map((item) => (item.type === "character" ? resolveCharacterTransformAtTime(item, playhead) : { x: Number(item.x || 0), y: Number(item.y || 0) }));
    const centre = {
      x: (Math.min(...points.map((point) => point.x)) + Math.max(...points.map((point) => point.x))) / 2,
      y: (Math.min(...points.map((point) => point.y)) + Math.max(...points.map((point) => point.y))) / 2,
    };
    writeLayerClipboard({ objects: clone(objects), centre });
    return true;
  };
  const cutLayers = () => {
    if (!copyLayers()) return;
    const ids = new Set(selectedObjectIds);
    mutate((data) => { data.objects = data.objects.filter((item) => !ids.has(item.id)); });
    selectObject(null);
  };
  const pasteLayers = (inPlace: boolean) => {
    const clip = readLayerClipboard();
    if (!clip || !draft) { showNotice("Nothing to paste. Select layers and press Cmd/Ctrl+C first."); return; }
    const target = inPlace ? clip.centre : (viewCenterRef.current?.() || clip.centre);
    const dx = target.x - clip.centre.x, dy = target.y - clip.centre.y;
    const stamp = Date.now();
    const pasted = clip.objects.map((item, index) => {
      const copy = clone(item);
      copy.id = `${String(item.id).split("-copy-")[0]}-copy-${stamp}${index}`;
      if (dx || dy) {
        // Paste in Center moves the copy and its whole motion path with it.
        copy.x = Number(copy.x || 0) + dx;
        copy.y = Number(copy.y || 0) + dy;
        copy.keyframes = (copy.keyframes || []).map((frame) => ({ ...frame, x: Number(frame.x || 0) + dx, y: Number(frame.y || 0) + dy }));
      }
      return copy;
    });
    mutate((data) => { data.objects.push(...pasted); }); // new layers on top, in the copied order
    setActiveCharacterPart(null);
    setPartReplacementBrowserOpen(false);
    changeSelection(pasted.map((item) => item.id));
  };
  const clipboardActionsRef = useRef({ copy: copyLayers, cut: cutLayers, paste: pasteLayers });
  clipboardActionsRef.current = { copy: copyLayers, cut: cutLayers, paste: pasteLayers };

  const transformObject = useCallback((id: string, patch: TransformPatch) => {
    mutate((data) => {
      const item = data.objects.find((object) => object.id === id);
      if (!item) return;
      // Character keyframes animate position only (see resolveCharacterTransformAtTime);
      // scale and rotation always live on the object, or they would silently not apply.
      const hasPositionPatch = patch.x != null || patch.y != null;
      if (item.type === "character" && (item.keyframes || []).length > 0 && hasPositionPatch) {
        const current = resolveCharacterTransformAtTime(item, playhead);
        moveKeyframedPosition(item, playhead, patch.x ?? current.x, patch.y ?? current.y);
      } else {
        if (patch.x != null) item.x = patch.x;
        if (patch.y != null) item.y = patch.y;
      }
      if (patch.scale != null) item.scale = patch.scale;
      if (patch.rotation != null) item.rotation = patch.rotation;
      if (patch.skewX != null) item.skewX = Math.max(-80, Math.min(80, patch.skewX));
      if (patch.skewY != null) item.skewY = Math.max(-80, Math.min(80, patch.skewY));
      if (patch.stretchX != null) item.stretchX = Math.max(0.02, Math.min(50, patch.stretchX));
      if (patch.stretchY != null) item.stretchY = Math.max(0.02, Math.min(50, patch.stretchY));
      // The registration point may sit outside the object (Animate), within reason.
      if (patch.pivotX != null) item.pivotX = Math.max(-2, Math.min(3, patch.pivotX));
      if (patch.pivotY != null) item.pivotY = Math.max(-2, Math.min(3, patch.pivotY));
    });
  }, [mutate, playhead]);

  const createMotion = useCallback((id?: string | null) => {
    const targetId = id || selectedObjectId;
    if (!targetId) {
      showNotice("Select a character first, then choose Create Motion.");
      return;
    }
    const item = draft?.objects.find((object) => object.id === targetId);
    if (!item || item.type !== "character") {
      showNotice("Create Motion works on a selected character layer.");
      return;
    }

    setPlaying(false);
    setActiveCharacterPart(null);
      setPartReplacementBrowserOpen(false);
    selectObject(targetId);

    const frame = 1 / 30;
    const currentTime = Math.max(0, Math.min(duration, playhead));
    const existingFrames = [...(item.keyframes || [])].sort((a, b) => a.time - b.time);
    const leftFrame = [...existingFrames].reverse().find((keyframe) => keyframe.time < currentTime - frame / 2);
    const rightFrame = existingFrames.find((keyframe) => keyframe.time > currentTime + frame / 2);
    const useSurroundingTween = Boolean(leftFrame && rightFrame);

    let startTime = leftFrame?.time ?? currentTime;
    let endTime = rightFrame?.time ?? Math.min(duration, currentTime + 1);
    if (!useSurroundingTween && endTime - startTime < frame) {
      endTime = currentTime;
      startTime = Math.max(0, currentTime - 1);
    }
    if (endTime - startTime < frame) {
      showNotice("Increase the scene duration or place two position keyframes before creating motion.");
      return;
    }

    mutate((data) => {
      const character = data.objects.find((object) => object.id === targetId);
      if (!character || character.type !== "character") return;

      // When the playhead is between two existing position keyframes, Create Motion
      // uses those exact points as the tween boundaries. It does not insert an
      // unwanted one-second range or create motion from a normal timeline click.
      if (!useSurroundingTween) {
        const startTransform = resolveCharacterTransformAtTime(character, startTime);
        character.keyframes = upsertCharacterKeyframe(character, startTime, startTransform);
        const endTransform = resolveCharacterTransformAtTime(character, endTime);
        character.keyframes = upsertCharacterKeyframe(character, endTime, endTransform);
      }
      // The motion range is a tween from its first keyframe to the next.
      character.keyframes = (character.keyframes || []).map((key) => (Math.abs(key.time - startTime) <= 1 / 120 && key.tween === false ? { ...key, tween: { easeIn: 0, easeOut: 0 } } : key));
      character.manualMotionRange = {
        id: `manual-motion-${Date.now()}`,
        start: startTime,
        end: endTime,
      };
    });

    if (useSurroundingTween) {
      setPlayhead(currentTime);
    } else {
      setPlayhead(endTime);
      showNotice(`Motion range created from frame ${Math.round(startTime * 30)} to ${Math.round(endTime * 30)}. Drag the character now to set the end position.`);
    }
  }, [draft, duration, mutate, playhead, selectObject, selectedObjectId, setPlaying]);

  const addOrUpdateCharacterKeyframe = useCallback((id: string, time = playhead) => {
    mutate((data) => {
      const item = data.objects.find((object) => object.id === id);
      if (!item || item.type !== "character") return;
      insertManualKeyframe(item, time);
    });
  }, [mutate, playhead]);

  const deleteCharacterKeyframe = useCallback((id: string, keyframeId: string) => {
    mutate((data) => {
      const item = data.objects.find((object) => object.id === id);
      if (!item || item.type !== "character") return;
      item.keyframes = (item.keyframes || []).filter((frame) => frame.id !== keyframeId);
      if ((item.keyframes || []).length < 2) item.manualMotionRange = null;
    });
  }, [mutate]);

  const clearCharacterKeyframes = useCallback((id: string) => {
    mutate((data) => {
      const item = data.objects.find((object) => object.id === id);
      if (!item || item.type !== "character") return;
      // Keep the current visible position when returning to normal whole-character mode.
      const current = resolveCharacterTransformAtTime(item, playhead);
      item.x = current.x; item.y = current.y; item.scale = current.scale; item.rotation = current.rotation;
      item.keyframes = [];
      item.manualMotionRange = null;
    });
  }, [mutate, playhead]);

  const reorderLayer = useCallback((draggedId: string, targetId: string) => {
    if (draggedId === targetId) return;
    mutate((data) => {
      const fromIndex = data.objects.findIndex((item) => item.id === draggedId);
      const targetIndex = data.objects.findIndex((item) => item.id === targetId);
      if (fromIndex < 0 || targetIndex < 0 || fromIndex === targetIndex) return;
      const [moving] = data.objects.splice(fromIndex, 1);
      const targetAfterRemoval = data.objects.findIndex((item) => item.id === targetId);
      const insertIndex = fromIndex < targetIndex ? targetAfterRemoval + 1 : targetAfterRemoval;
      data.objects.splice(Math.max(0, insertIndex), 0, moving);
    });
  }, [mutate]);

  const deleteLayer = useCallback((id: string) => {
    mutate((data) => {
      data.objects = data.objects.filter((item) => item.id !== id);
    });
    if (selectedObjectId === id) {
      selectObject(null);
      setActiveCharacterPart(null);
      setPartReplacementBrowserOpen(false);
    }
  }, [mutate, selectObject, selectedObjectId]);

  // Remove one body part from a placed character (Delete in double-click mode): the part is hidden,
  // any replacement on it is dropped, and editing returns to the whole character. Undo or the
  // panel's "Removed parts" row brings it back.
  const removeCharacterPart = useCallback((id: string, partKey: CharacterPartKey) => {
    mutate((data) => {
      const item = data.objects.find((object) => object.id === id);
      if (!item || item.type !== "character") return;
      if (item.partReplacements?.[partKey]) {
        const next = { ...item.partReplacements };
        delete next[partKey];
        item.partReplacements = next;
      }
      item.partOverrides = { ...(item.partOverrides || {}), [partKey]: { ...(item.partOverrides?.[partKey] || {}), visible: false } };
    });
    setActiveCharacterPart(null);
    setPartReplacementBrowserOpen(false);
  }, [mutate]);

  const restoreCharacterPart = useCallback((id: string, partKey: CharacterPartKey) => {
    mutate((data) => {
      const item = data.objects.find((object) => object.id === id);
      if (!item || item.type !== "character") return;
      item.partOverrides = { ...(item.partOverrides || {}), [partKey]: { ...(item.partOverrides?.[partKey] || {}), visible: true, animate: true } };
    });
  }, [mutate]);

  useEffect(() => {
    const isEditableTarget = (target: EventTarget | null) => {
      const element = target as HTMLElement | null;
      if (!element) return false;
      const tag = element.tagName?.toLowerCase();
      return tag === "input" || tag === "textarea" || tag === "select" || element.isContentEditable;
    };

    const deleteSelectedObject = (event: KeyboardEvent) => {
      if (scaleRotateOpenRef.current || (event.key !== "Delete" && event.key !== "Backspace") || isEditableTarget(event.target)) return;
      const frames = frameSelectionRef.current;
      if (frames) {
        // Frames are selected on the timeline: Delete clears the keyframe there (Animate).
        event.preventDefault();
        event.stopImmediatePropagation();
        frameActionRef.current("clear-keyframe", selectionLayerIds(frames), frames.from, frames.to);
        return;
      }
      if (selectedObjectIds.length === 0) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      // A body part is open (double-click mode): remove only that part, not the character.
      if (activeCharacterPart && selectedObjectIds.length === 1) {
        removeCharacterPart(selectedObjectIds[0], activeCharacterPart);
        return;
      }
      // Removes the selected layers from this scene only; library characters are untouched.
      const ids = new Set(selectedObjectIds);
      mutate((data) => { data.objects = data.objects.filter((item) => !ids.has(item.id)); });
      selectObject(null);
      setActiveCharacterPart(null);
      setPartReplacementBrowserOpen(false);
    };

    window.addEventListener("keydown", deleteSelectedObject, { capture: true });
    return () => window.removeEventListener("keydown", deleteSelectedObject, { capture: true });
  }, [activeCharacterPart, mutate, removeCharacterPart, selectObject, selectedObjectIds]);

  const transformCharacterPart = useCallback((id: string, partKey: CharacterPartKey, patch: PartPatch) => {
    mutate((data) => {
      const item = data.objects.find((object) => object.id === id);
      if (item && item.type === "character") writePartTransform(item, partKey, patch, playhead);
    });
  }, [mutate, playhead]);

  const moveCharacterPart = useCallback((id: string, partKey: CharacterPartKey, offsetX: number, offsetY: number) => {
    transformCharacterPart(id, partKey, { offsetX, offsetY });
  }, [transformCharacterPart]);

  useEffect(() => {
    const isTypingTarget = (target: EventTarget | null) => {
      const node = target as HTMLElement | null;
      if (!node) return false;
      const tag = (node.tagName || "").toLowerCase();
      return tag === "input" || tag === "textarea" || tag === "select" || Boolean(typeof node.closest === "function" && node.closest('[contenteditable="true"]'));
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (scaleRotateOpenRef.current || isTypingTarget(event.target)) return;

      // Esc steps out one level: entered part → selected part → (a piece inside a part: back to that
      // part, entered) → whole character.
      if (event.key === "Escape" && activeCharacterPart) {
        event.preventDefault();
        if (partReplacementBrowserOpen) setPartReplacementBrowserOpen(false);
        else if (activeCharacterPart.includes("/")) {
          setActiveCharacterPart(activeCharacterPart.slice(0, activeCharacterPart.lastIndexOf("/")));
          setPartReplacementBrowserOpen(true);
        } else setActiveCharacterPart(null);
        return;
      }

      if (event.key === "Enter" && activeToolRef.current === "reflect") {
        // Reflect tool + Enter = the Reflect dialog (Illustrator); otherwise Enter plays (Animate).
        event.preventDefault();
        openReflectRef.current();
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        setFrameSelection(null); // playback moves the playhead: the frame selection ends
        if (!isPlaying && playhead >= duration) setPlayhead(0);
        setPlaying(!isPlaying);
        return;
      }

      const arrows: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
      if (!activeCharacterPart && selectedObjectIds.length > 0 && arrows[event.key] && !event.metaKey && !event.ctrlKey && !event.altKey) {
        // Animate-style nudge of the whole selection: 1 px, Shift = 10 px.
        event.preventDefault();
        const step = event.shiftKey ? 10 : 1;
        const [dx, dy] = arrows[event.key];
        const ids = new Set(selectedObjectIds);
        mutate((data) => {
          for (const item of data.objects) {
            if (!ids.has(item.id)) continue;
            if (item.type === "character" && (item.keyframes || []).length > 0) {
              const current = resolveCharacterTransformAtTime(item, playhead);
              moveKeyframedPosition(item, playhead, current.x + dx * step, current.y + dy * step);
            } else {
              item.x += dx * step; item.y += dy * step;
            }
          }
        });
        return;
      }

      if (!selectedObjectId || !activeCharacterPart) return;
      const selectedCharacter = draft?.objects.find((item) => item.id === selectedObjectId && item.type === "character");
      if (!selectedCharacter || selectedCharacter.type !== "character") return;

      // Cmd/Ctrl +/- is handled by the canvas-zoom shortcut above.
      if ((event.metaKey || event.ctrlKey) && (event.key === "+" || event.key === "=" || event.key === "-" || event.code === "NumpadAdd" || event.code === "NumpadSubtract")) return;

      const current = resolvePartTransformAtTime(selectedCharacter, activeCharacterPart, playhead);
      const fineStep = 1;
      const bigStep = 10;
      const moveStep = event.shiftKey ? bigStep : fineStep;

      if (event.key === "ArrowLeft") {
        event.preventDefault();
        moveCharacterPart(selectedObjectId, activeCharacterPart, Number(current.offsetX || 0) - moveStep, Number(current.offsetY || 0));
        return;
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        moveCharacterPart(selectedObjectId, activeCharacterPart, Number(current.offsetX || 0) + moveStep, Number(current.offsetY || 0));
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        moveCharacterPart(selectedObjectId, activeCharacterPart, Number(current.offsetX || 0), Number(current.offsetY || 0) - moveStep);
        return;
      }
      if (event.key === "ArrowDown") {
        event.preventDefault();
        moveCharacterPart(selectedObjectId, activeCharacterPart, Number(current.offsetX || 0), Number(current.offsetY || 0) + moveStep);
      }
    };
    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", onKeyDown, { capture: true });
  }, [activeCharacterPart, draft, duration, isPlaying, moveCharacterPart, mutate, partReplacementBrowserOpen, playhead, selectedObjectId, selectedObjectIds, setPlaying, transformCharacterPart]);

  const addOrUpdatePartKeyframe = useCallback((id: string, partKey: CharacterPartKey, time = playhead) => {
    mutate((data) => {
      const item = data.objects.find((object) => object.id === id);
      if (!item || item.type !== "character") return;
      const base = item.partOverrides?.[partKey] || {};
      const current = resolvePartTransformAtTime(item, partKey, time);
      const baseScale = Math.max(0.02, Number(base.scale ?? 1));
      item.partKeyframes = item.partKeyframes || {};
      item.partKeyframes[partKey] = upsertPartKeyframe(item, partKey, time, {
        offsetX: current.offsetX - Number(base.offsetX || 0),
        offsetY: current.offsetY - Number(base.offsetY || 0),
        rotation: current.rotation - Number(base.rotation || 0),
        scale: current.scale / baseScale,
        flipX: current.flipX,
      });
    });
  }, [mutate, playhead]);

  const deletePartKeyframe = useCallback((id: string, partKey: CharacterPartKey, keyframeId: string) => {
    mutate((data) => {
      const item = data.objects.find((object) => object.id === id);
      if (!item || item.type !== "character") return;
      item.partKeyframes = { ...(item.partKeyframes || {}), [partKey]: (item.partKeyframes?.[partKey] || []).filter((frame) => frame.id !== keyframeId) };
    });
  }, [mutate]);

  const clearPartKeyframes = useCallback((id: string, partKey: CharacterPartKey) => {
    mutate((data) => {
      const item = data.objects.find((object) => object.id === id);
      if (!item || item.type !== "character") return;
      const next = { ...(item.partKeyframes || {}) };
      delete next[partKey];
      item.partKeyframes = next;
    });
  }, [mutate]);

  useEffect(() => {
    const isEditableTarget = (target: EventTarget | null) => {
      const element = target as HTMLElement | null;
      if (!element) return false;
      const tag = element.tagName?.toLowerCase();
      return tag === "input" || tag === "textarea" || tag === "select" || element.isContentEditable;
    };
    const handleKeyframeShortcut = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "k" || isEditableTarget(event.target)) return;
      if (!selectedObjectId) return;
      const character = draft?.objects.find((item) => item.id === selectedObjectId);
      if (!character || character.type !== "character") return;
      event.preventDefault();
      event.stopPropagation();
      if (activeCharacterPart) addOrUpdatePartKeyframe(character.id, activeCharacterPart, playhead);
      else addOrUpdateCharacterKeyframe(character.id, playhead);
    };
    window.addEventListener("keydown", handleKeyframeShortcut, { capture: true });
    return () => window.removeEventListener("keydown", handleKeyframeShortcut, { capture: true });
  }, [activeCharacterPart, addOrUpdateCharacterKeyframe, addOrUpdatePartKeyframe, draft, playhead, selectedObjectId]);

  const applyAIAnimationPlan = useCallback((plan: AnimationPlan) => {
    if (!project || !draft) return;
    const next = clone(draft);
    const compiled = compileAnimationPlan(next, plan, project.width, project.height);
    historyPastRef.current.push(clone(draft));
    if (historyPastRef.current.length > 60) historyPastRef.current.shift();
    historyFutureRef.current = [];
    setDraft(compiled.data);
    setDirty(true);
    setDuration((current) => Math.max(current, plan.duration));
    setPlayhead(0);
    setPlaying(false);
    setAIAnimateOpen(false);
    if (compiled.skippedActions.length) showNotice(`AI animation applied: ${compiled.appliedActions} action${compiled.appliedActions === 1 ? "" : "s"} · ${compiled.skippedActions.length} skipped.`);
  }, [draft, project, setPlaying]);

  const uploadBackground = async (file: File) => {
    if (!project) return;
    try {
      const dimensions = await readImageDimensions(file);
      const asset = await api.uploadAsset(project.id, "background", file);
      const layer: EditorObject = {
        id: `background-${Date.now()}`, type: "background", name: file.name,
        x: project.width / 2, y: project.height / 2, scale: 1, assetKind: "image", assetUrl: asset.url,
        sourceWidth: dimensions.width, sourceHeight: dimensions.height,
        opacity: 1, startTime: 0, actionDurationMs: duration * 1000, mimeType: String(asset.metadata?.mimeType || file.type),
      };
      mutate((data) => { data.backgroundImage = null; placeInLayer(data, layer, selectedIdsRef.current[0]); });
      selectObject(layer.id);
    } catch (error) { showNotice(error instanceof Error ? error.message : "Background upload failed", "error"); }
  };

  /** Adds a Backgrounds / FX / SFX library item to the current scene (files are already on the server). */
  const addMediaLibraryItem = async (item: MediaLibraryItem) => {
    if (!project) return;
    const stamp = Date.now();
    if (item.type === "backgrounds") {
      const dimensions = await readUrlImageDimensions(item.url);
      const layer: EditorObject = {
        id: `background-${stamp}`, type: "background", name: item.name,
        x: project.width / 2, y: project.height / 2, scale: 1, assetKind: "image", assetUrl: item.url,
        sourceWidth: dimensions.width || undefined, sourceHeight: dimensions.height || undefined,
        opacity: 1, startTime: 0, actionDurationMs: duration * 1000, mimeType: item.mimeType,
      };
      mutate((data) => { data.backgroundImage = null; placeInLayer(data, layer, selectedIdsRef.current[0]); });
      selectObject(layer.id);
      return;
    }
    if (item.type === "fx") {
      const dimensions = await readUrlImageDimensions(item.url);
      const width = dimensions.width || 300;
      const height = dimensions.height || 300;
      // Fit large effects to ~40% of the canvas; never upscale small ones.
      const scale = Math.min(1, (project.height * 0.4) / height, (project.width * 0.4) / width);
      const layer: EditorObject = {
        id: `fx-${stamp}`, type: "prop", name: item.name,
        x: project.width / 2, y: project.height / 2, scale, rotation: 0, opacity: 1,
        assetKind: "image", assetUrl: item.url, sourceWidth: width, sourceHeight: height,
        startTime: Math.max(0, playhead), mimeType: item.mimeType,
      };
      mutate((data) => placeInLayer(data, layer, selectedIdsRef.current[0]));
      selectObject(layer.id);
      return;
    }
    const audioDuration = await readUrlAudioDuration(item.url);
    const clipDuration = audioDuration > 0 ? audioDuration : duration;
    const audioStart = Math.max(0, playhead);
    const layer: EditorObject = {
      id: `audio-${stamp}`, type: "audio", name: item.name, x: 0, y: 0, scale: 1,
      assetKind: "audio", assetUrl: item.url, startTime: audioStart, actionDurationMs: clipDuration * 1000,
      volume: 1, mimeType: item.mimeType,
    };
    mutate((data) => placeInLayer(data, layer, selectedIdsRef.current[0]));
    setDuration((current) => Math.max(current, audioStart + clipDuration));
    selectObject(layer.id);
  };

  const uploadVoice = async (file: File) => {
    if (!project) return;
    try {
      const [asset, audioDuration] = await Promise.all([api.uploadAsset(project.id, "audio", file), readAudioDuration(file)]);
      const clipDuration = audioDuration > 0 ? audioDuration : duration;
      const audioStart = Math.max(0, playhead);
      const layer: EditorObject = {
        id: `audio-${Date.now()}`, type: "audio", name: file.name, x: 0, y: 0, scale: 1,
        assetKind: "audio", assetUrl: asset.url, startTime: audioStart, actionDurationMs: clipDuration * 1000,
        volume: 1, mimeType: String(asset.metadata?.mimeType || file.type),
      };
      mutate((data) => placeInLayer(data, layer, selectedIdsRef.current[0]));
      setDuration((current) => Math.max(current, audioStart + clipDuration));
      selectObject(layer.id);
    } catch (error) { showNotice(error instanceof Error ? error.message : "Audio upload failed", "error"); }
  };

  const replaceCharacterPartAsset = useCallback(async (partKey: string, file: File) => {
    if (!selectedObjectId) return;
    try {
      const assetUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(new Error("Replacement image could not be read."));
        reader.readAsDataURL(file);
      });
      mutate((data) => {
        const item = data.objects.find((object) => object.id === selectedObjectId);
        if (!item || item.type !== "character") return;
        item.partReplacements = {
          ...(item.partReplacements || {}),
          [partKey]: { assetUrl, name: file.name, renderKind: "image" },
        };
        item.partOverrides = {
          ...(item.partOverrides || {}),
          [partKey]: { ...(item.partOverrides?.[partKey] || {}), visible: false, animate: false },
        };
      });
      setActiveCharacterPart(null);
      setPartReplacementBrowserOpen(false);
    } catch (error) {
      showNotice(error instanceof Error ? error.message : "Replacement upload failed", "error");
    }
  }, [mutate, selectedObjectId]);

  const clearCharacterPartReplacement = useCallback((partKey: string) => {
    if (!selectedObjectId) return;
    mutate((data) => {
      const item = data.objects.find((object) => object.id === selectedObjectId);
      if (!item || item.type !== "character" || !item.partReplacements) return;
      const next = { ...item.partReplacements };
      delete next[partKey];
      item.partReplacements = next;
      item.partOverrides = {
        ...(item.partOverrides || {}),
        [partKey]: { ...(item.partOverrides?.[partKey] || {}), visible: true, animate: true },
      };
    });
  }, [mutate, selectedObjectId]);

  // Move a part's registration point. (dx, dy) = old − new point in stage units. Each saved state of
  // the part gets offset += (I − A)(dx, dy) for that state's own rotation/scale/flip/skew, so moving
  // the point never moves the part — as in Animate. Keyframes hold values relative to the base edit,
  // so a keyframe's offset changes by its effective correction minus the base's.
  const setCharacterPartPivot = useCallback((id: string, partKey: CharacterPartKey, pivotX: number, pivotY: number, dx: number, dy: number) => {
    mutate((data) => {
      const item = data.objects.find((object) => object.id === id);
      if (!item || item.type !== "character") return;
      const correction = (state: Parameters<typeof partEditMatrix>[0]) => {
        const a = partEditMatrix(state);
        return { x: dx - (a.a11 * dx + a.a12 * dy), y: dy - (a.a21 * dx + a.a22 * dy) };
      };
      const base = item.partOverrides?.[partKey] || {};
      const baseFix = correction(base);
      item.partOverrides = {
        ...(item.partOverrides || {}),
        [partKey]: { ...base, offsetX: Number(base.offsetX || 0) + baseFix.x, offsetY: Number(base.offsetY || 0) + baseFix.y, pivotX, pivotY },
      };
      const frames = item.partKeyframes?.[partKey];
      if (frames?.length) {
        item.partKeyframes = {
          ...item.partKeyframes,
          [partKey]: frames.map((frame) => {
            const fix = correction({
              rotation: Number(base.rotation || 0) + Number(frame.rotation || 0),
              scale: Math.max(0.02, Number(base.scale ?? 1)) * Math.max(0.02, Number(frame.scale ?? 1)),
              flipX: typeof frame.flipX === "boolean" ? frame.flipX : Boolean(base.flipX),
              skewX: Number(base.skewX || 0) + Number(frame.skewX || 0),
              skewY: Number(base.skewY || 0) + Number(frame.skewY || 0),
            });
            return { ...frame, offsetX: frame.offsetX + fix.x - baseFix.x, offsetY: frame.offsetY + fix.y - baseFix.y };
          }),
        };
      }
    });
  }, [mutate]);

  // Swap a part for another of the same character's variants (null = back to the pose's own part).
  // The swap lives inside the rig, so it replaces any overlay replacement on that part.
  const swapCharacterPartSymbol = useCallback((partKey: string, symbol: string | null) => {
    if (!selectedObjectId) return;
    mutate((data) => {
      const item = data.objects.find((object) => object.id === selectedObjectId);
      if (!item || item.type !== "character") return;
      const hadReplacement = Boolean(item.partReplacements?.[partKey]);
      if (hadReplacement) {
        const next = { ...item.partReplacements };
        delete next[partKey];
        item.partReplacements = next;
      }
      const override = { ...(item.partOverrides?.[partKey] || {}) };
      if (symbol) override.swapSymbol = symbol;
      else delete override.swapSymbol;
      if (hadReplacement) { override.visible = true; override.animate = true; }
      item.partOverrides = { ...(item.partOverrides || {}), [partKey]: override };
    });
  }, [mutate, selectedObjectId]);

  const applyLibraryPartReplacement = useCallback((partKey: string, assetUrl: string, name: string, renderKind: "image" | "source-symbol" = "image") => {
    if (!selectedObjectId) return;
    mutate((data) => {
      const item = data.objects.find((object) => object.id === selectedObjectId);
      if (!item || item.type !== "character") return;
      item.partReplacements = {
        ...(item.partReplacements || {}),
        [partKey]: { assetUrl, name, renderKind },
      };
      const existing = item.partOverrides?.[partKey] || {};
      item.partOverrides = {
        ...(item.partOverrides || {}),
        [partKey]: { ...(existing || {}), visible: false, animate: false },
      };
    });
    setActiveCharacterPart(null);
      setPartReplacementBrowserOpen(false);
  }, [mutate, selectedObjectId]);

  const toggleLayerLoop = useCallback((id: string) => {
    mutate((data) => {
      const item = data.objects.find((object) => object.id === id);
      if (item) item.loopMode = item.loopMode === "loop" ? "once" : "loop";
    });
  }, [mutate]);

  // Source animation length per character layer, so the timeline can mark where each loop restarts.
  const sourceDurations = useMemo(() => {
    const byAsset = new Map(characterLibraryActions.map((action) => [action.assetUrl, action.durationMs]));
    const result: Record<string, number> = {};
    for (const object of draft?.objects || []) {
      const ms = object.type === "character" && object.assetUrl ? byAsset.get(object.assetUrl) : undefined;
      if (ms && ms > 0) result[object.id] = ms / 1000;
    }
    return result;
  }, [characterLibraryActions, draft?.objects]);

  const updateLayerTiming = useCallback((id: string, patch: { startTime?: number; actionDurationMs?: number }) => {
    const apply = (data: EditorData) => {
      const item = data.objects.find((object) => object.id === id);
      if (!item) return;
      if (typeof patch.startTime === "number") {
        const nextStart = Math.max(0, patch.startTime);
        // Moving a whole clip carries its keyframes and motion range along with it.
        if (typeof patch.actionDurationMs !== "number") {
          const delta = nextStart - Math.max(0, Number(item.startTime || 0));
          if (delta && item.keyframes?.length) item.keyframes = item.keyframes.map((frame) => ({ ...frame, time: Math.max(0, frame.time + delta) }));
          if (delta && item.manualMotionRange) item.manualMotionRange = { ...item.manualMotionRange, start: item.manualMotionRange.start + delta, end: item.manualMotionRange.end + delta };
        }
        item.startTime = nextStart;
      }
      if (typeof patch.actionDurationMs === "number") item.actionDurationMs = Math.max(1000 / TIMELINE_FPS, patch.actionDurationMs);
    };
    if (clipDraggingRef.current && dragHistoryRef.current) {
      setDirty(true);
      setDraft((current) => {
        if (!current) return current;
        const next = clone(current);
        apply(next);
        return next;
      });
    } else {
      mutate(apply);
      if (clipDraggingRef.current) dragHistoryRef.current = true;
    }
    setDuration((current) => {
      const next = draft?.objects.reduce((maxValue, item) => {
        const start = item.id === id && typeof patch.startTime === "number" ? Math.max(0, patch.startTime) : Math.max(0, item.startTime ?? 0);
        const durMs = item.id === id && typeof patch.actionDurationMs === "number" ? Math.max(1000 / TIMELINE_FPS, patch.actionDurationMs) : Math.max(1000 / TIMELINE_FPS, item.actionDurationMs ?? current * 1000);
        return Math.max(maxValue, start + durMs / 1000);
      }, current) ?? current;
      return Math.max(current, next);
    });
  }, [draft, mutate]);

  const generateBackground = async (prompt: string) => {
    if (!project) return;
    showNotice("Generating AI image background…");
    try {
      const result = await api.generateBackground(prompt, project.width, project.height);
      let assetUrl = result.image_url;
      let mimeType = result.image_url.startsWith("data:image/png") ? "image/png" : "image/svg+xml";
      if (result.image_url.startsWith("data:")) {
        try {
          const blob = await fetch(result.image_url).then((response) => response.blob());
          mimeType = blob.type || mimeType;
          const extension = mimeType.includes("png") ? "png" : mimeType.includes("webp") ? "webp" : "svg";
          const file = new File([blob], `ai-background-${Date.now()}.${extension}`, { type: mimeType });
          const stored = await api.uploadAsset(project.id, "background", file);
          assetUrl = stored.url;
        } catch { /* provider data URL remains usable */ }
      }
      const layer: EditorObject = {
        id: `ai-background-${Date.now()}`, type: "background", name: `AI Background`,
        x: project.width / 2, y: project.height / 2, scale: 1, assetKind: "image", assetUrl,
        opacity: 1, startTime: 0, actionDurationMs: duration * 1000, prompt, mimeType,
      };
      mutate((data) => { data.backgroundImage = null; placeInLayer(data, layer, selectedIdsRef.current[0]); });
      selectObject(layer.id);
      showNotice(`AI background generated via ${result.provider}`);
    } catch (error) {
      showNotice(error instanceof Error ? error.message : "AI background failed", "error");
      throw error;
    }
  };

  const saveCurrentScene = async () => {
    if (!scene || !draft) return null;
    await flushAutosave();
    if (dirtyRef.current) throw new Error("Could not save to the server. Check your connection and try again.");
    return useEditorStore.getState().scene;
  };

  // Save Project: store on the server, then write a .cb file to a place the user picks
  // (asked the first time; later saves overwrite that file, Save As asks again).
  const save = async (saveAs = false) => {
    try {
      await saveCurrentScene();
      const current = useEditorStore.getState().project;
      if (!current) return;
      const result = await saveProjectFile(current.id, buildProjectFile(current, current.scenes), saveAs);
      if (result.status === "saved") showNotice(`Saved to ${result.name}`);
      else if (result.status === "downloaded") showNotice(`${result.name} saved to your Downloads folder (this browser can't choose a folder).`);
    } catch (error) { showNotice(error instanceof Error ? error.message : "Save failed", "error"); }
  };

  // Open Project: a .cb file becomes a new project in a new tab.
  const openProjectFile = async () => {
    try {
      const createdId = await openProjectFileAsNew(flushAutosave);
      if (!createdId) return;
      setPlaying(false);
      router.push(`/editor/${createdId}`);
    } catch (error) { showNotice(error instanceof Error ? error.message : "Could not open the project file", "error"); }
  };

  // ---- Project thumbnails: a snapshot of the first scene's first frame, taken a few seconds
  // after autosave (at most every 20 s), or once when a project without one is opened.
  const thumbnailTimerRef = useRef<number | null>(null);
  const lastThumbnailRef = useRef(0);
  const captureThumbnail = useCallback(async () => {
    const { project: currentProject, scene: currentScene } = useEditorStore.getState();
    const data = draftRef.current;
    if (!currentProject || !currentScene || !data) return;
    const firstScene = [...currentProject.scenes].sort((a, b) => a.order - b.order)[0];
    if (firstScene?.id !== currentScene.id) return;
    const image = await renderProjectThumbnail(data, currentProject.width, currentProject.height,
      (id) => document.querySelector<HTMLElement>(`.cb-stage-world [data-editor-object-id="${CSS.escape(id)}"]`));
    if (!image) return;
    try {
      await api.uploadProjectThumbnail(currentProject.id, image);
      lastThumbnailRef.current = Date.now();
    } catch { /* thumbnails are best-effort */ }
  }, []);
  const scheduleThumbnail = useCallback((delay?: number) => {
    if (thumbnailTimerRef.current) window.clearTimeout(thumbnailTimerRef.current);
    const wait = delay ?? Math.max(3000, 20000 - (Date.now() - lastThumbnailRef.current));
    thumbnailTimerRef.current = window.setTimeout(() => { void captureThumbnail(); }, wait);
  }, [captureThumbnail]);
  scheduleThumbnailRef.current = () => scheduleThumbnail();
  useEffect(() => {
    // A project that has no thumbnail yet gets one once its characters have loaded.
    if (project && !project.thumbnail_url) scheduleThumbnail(6000);
    return () => { if (thumbnailTimerRef.current) window.clearTimeout(thumbnailTimerRef.current); };
  }, [project?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleOpenPanel = () => {
    if (openPanel) { setOpenPanel(false); return; }
    setOpenPanel(true);
    setRecentProjects(null);
    void api.listProjects().then((list) => {
      setRecentProjects(recentProjectsOf(list, 5, projectId));
    }).catch(() => setRecentProjects([]));
  };

  // Keep the current project's tab visible when the tab strip has to scroll.
  useEffect(() => {
    document.querySelector(".cb-project-tab.active")?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [openTabs, project?.id]);

  // Project tabs: switching saves first; closing a tab never deletes the project.
  const switchProject = async (id: string) => {
    if (id === projectId) return;
    await flushAutosave();
    setPlaying(false);
    setPlayhead(0);
    router.push(`/editor/${id}`);
  };
  const closeProjectTab = async (id: string) => {
    const before = readOpenProjects();
    const remaining = removeOpenProject(id);
    setOpenTabs(remaining);
    if (id !== projectId) return;
    await flushAutosave();
    const index = Math.max(0, before.findIndex((tab) => tab.id === id));
    const next = remaining[Math.min(index, remaining.length - 1)];
    setPlaying(false);
    router.push(next ? `/editor/${next.id}` : "/dashboard");
  };
  const fileActionsRef = useRef({ save, open: openProjectFile });
  fileActionsRef.current = { save, open: openProjectFile };

  const startRender = async () => {
    try {
      await saveCurrentScene();
      showNotice("Render queued…");
      setRender(await api.startRender(projectId));
    } catch (error) { showNotice(error instanceof Error ? error.message : "Render failed to start", "error"); }
  };

  const resetScene = () => {
    if (!scene) return;
    setDraft(clone(normalizeEditorData(scene.editor_data)));
    setDuration(scene.duration_seconds);
    setPlayhead(0);
    setPlaying(false);
    selectObject(null);
    resetCanvasView();
    setDirty(false);
  };

  const addScene = async () => {
    try {
      await flushAutosave();
      const created = await api.addScene(projectId);
      await load(created.id);
      setPlayhead(0);
      setPlaying(false);
    } catch (error) { showNotice(error instanceof Error ? error.message : "Scene create failed", "error"); }
  };

  // Closing a scene tab deletes the scene (scenes only live inside their project), so it asks
  // first. The open scene moves to its left neighbour (or the right one for the first scene).
  const deleteScene = async (target: Scene) => {
    const scenes = useEditorStore.getState().project?.scenes || [];
    if (scenes.length <= 1) return;
    if (!window.confirm(`Delete "${target.name}" and everything in it? This can't be undone.`)) return;
    const deletingOpenScene = sceneRef.current?.id === target.id;
    try {
      setPlaying(false);
      if (deletingOpenScene) {
        // Its unsaved changes are going away with it: stop autosave from writing to it.
        if (retryTimerRef.current) window.clearTimeout(retryTimerRef.current);
        while (savingRef.current) await savingRef.current;
        dirtyRef.current = false;
        setDirty(false);
      } else {
        await flushAutosave();
      }
      await api.deleteScene(target.id);
      clearSceneBackup(target.id);
      const latest = useEditorStore.getState().project;
      if (!latest) return;
      const index = latest.scenes.findIndex((item) => item.id === target.id);
      const remaining = latest.scenes.filter((item) => item.id !== target.id);
      setProject({ ...latest, scenes: remaining });
      if (deletingOpenScene) {
        const neighbour = remaining[Math.max(0, index - 1)];
        if (neighbour) await changeScene(neighbour);
      }
      showNotice(`Deleted ${target.name}`);
    } catch (error) {
      showNotice(error instanceof Error ? error.message : "Could not delete the scene", "error");
    }
  };

  const changeScene = async (target: Scene) => {
    setPlaying(false);
    await flushAutosave();
    // Use the freshest copy of the scene (autosave keeps the store's project up to date).
    const next = useEditorStore.getState().project?.scenes.find((item) => item.id === target.id) || target;
    setScene(next);
    openSceneDraft(next);
    setPlayhead(0);
    selectObject(null);
    setActiveCharacterPart(null);
      setPartReplacementBrowserOpen(false);
    resetCanvasView();
  };

  if (busy || !project || !scene || !draft) {
    return <div className="cb-loading"><div className="cb-logo-mark">CB</div><strong>Loading CB Studio</strong><span>{loadError}</span></div>;
  }

  return (
    <main className="cb-editor-shell">
      <input ref={voiceUploadRef} type="file" accept="audio/*" hidden onChange={(event) => {
        const file = event.currentTarget.files?.[0];
        if (file) void uploadVoice(file);
        event.currentTarget.value = "";
      }} />
      <header className="cb-editor-topbar">
        <button type="button" className="cb-global-home cb-editor-home-button" onClick={() => router.push("/dashboard")} aria-label="Home" title="Home">
          <img src="/opening-screen/home-button.svg" alt="" />
        </button>
        <div className="cb-opening-logo"><img src="/opening-screen/cb-studio-logo.svg" alt="Character Bazaar Studio" /></div>
        <div className="cb-top-actions">
          <HeaderUserIcon />
        </div>
      </header>
      {reflectOpen && (
        <ReflectDialog target={reflectTarget} canCopy={!reflectTarget} onPreview={previewReflect} onApply={applyReflect} onCancel={cancelReflect} />
      )}
      {scaleRotateOpen && <ScaleRotateDialog onApply={applyScaleRotate} onClose={() => setScaleRotateOpen(false)}
        target={selectedObjectIds.length === 1 && selected?.type === "character" && activeCharacterPart ? partLabel(selected, activeCharacterPart) : undefined} />}

      <div className="cb-editor-grid">
        <aside className="cb-tool-rail">
          <button type="button" className={activeTool === "select" ? "active" : ""} aria-label="Selection tool" aria-pressed={activeTool === "select"} title="Selection tool (V) — click to select (Shift+click to add), drag to move. Handles: corner = scale (Shift keeps proportions, Option/Alt from the registration point), side = stretch, just outside a corner = rotate, edge = skew." onClick={() => setActiveTool("select")}>
            <svg viewBox="31.86 37.09 32 32" aria-hidden="true"><path d="M55.58,56.94l-5.3-.88c-.65-.11-1.58-.07-1.88.51l-2.22,5.03c-.72,1.37-2.79.92-2.87-.63l-.88-15.6c-.08-1.34,1.49-2.12,2.52-1.25l11.88,10.15c1.18,1,.28,2.92-1.24,2.67Z" fill="none" stroke="currentColor" strokeMiterlimit="10"/></svg>
          </button>
          <button type="button" className={activeTool === "scale" ? "active" : ""} aria-label="Scale tool" aria-pressed={activeTool === "scale"} title="Scale tool (S) — drag anywhere: left/right changes the width, up/down the height, around the registration point. Shift keeps proportions." onClick={() => setActiveTool("scale")}>
            <svg viewBox="0 0 32 32" aria-hidden="true"><g fill="none" stroke="currentColor" strokeMiterlimit="10"><rect x="7.5" y="13.5" width="11" height="11"/><path d="M12.5 8.5h11v11" strokeDasharray="2 1.6"/><path d="M15.5 16.5l9-9M19.5 7.5h5v5"/></g></svg>
          </button>
          <button type="button" className={activeTool === "reflect" ? "active" : ""} aria-label="Reflect tool" aria-pressed={activeTool === "reflect"}
            title="Reflect tool (O) — then Enter (or double-click this button) for the Reflect dialog: mirror the selection or the selected part"
            onClick={() => setActiveTool("reflect")} onDoubleClick={() => { setActiveTool("reflect"); openReflect(); }}>
            <svg viewBox="0 0 32 32" aria-hidden="true"><path d="M16 6v20" stroke="currentColor" strokeWidth="1.1" strokeDasharray="2 1.8"/><path d="M14 10l-7 12h7z" fill="currentColor"/><path d="M18 10l7 12h-7z" fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round"/></svg>
          </button>
          <button
            type="button"
            className={activeTool === "import" ? "active" : ""}
            aria-pressed={activeTool === "import"}
            disabled={characterLibraryCharacters.length === 0}
            onClick={() => {
              setActiveTool("import");
              const first = characterLibraryCharacters[0];
              if (first) addReferenceBrowserCharacter(first.id, first.actions[0]?.id);
            }}
            aria-label="Import character"
            title={characterLibraryCharacters.length ? "Add first Admin Library character" : "Admin must upload a character library first"}
          ><svg viewBox="31.86 95.67 32 32" aria-hidden="true"><path d="M47.86,103.2v16.94M56.33,111.67h-16.94" fill="none" stroke="currentColor" strokeMiterlimit="10"/></svg></button>
          <button type="button" className={activeTool === "text" ? "active" : ""} aria-label="Text tool" aria-pressed={activeTool === "text"} title="Text tool" onClick={() => { setActiveTool("text"); addText(); }}>
            <svg viewBox="31.86 152.09 32 32" aria-hidden="true"><path d="M47.86,160.92v14.34M55.49,160.92h-15.25M55.49,160.92v1.8M40.24,160.92v1.8M49.66,175.26h-3.6" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </button>
          <button
            type="button"
            ref={toneButtonRef}
            className={activeTool === "tone" ? "active" : ""}
            aria-label="Lighten / Darken tool"
            aria-pressed={activeTool === "tone"}
            title="Lighten / Darken (click a colour of the selected character: lighter · Alt/Option: darker · Shift: fine step)"
            onClick={() => {
              const rect = toneButtonRef.current?.getBoundingClientRect();
              if (rect) setToneBarPosition({ left: Math.round(rect.right + 14), top: Math.round(rect.top) });
              setActiveTool((tool) => (tool === "tone" ? "select" : "tone"));
            }}
          >
            <svg viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="8" fill="none" stroke="currentColor" strokeWidth="1.5"/><path d="M16 8a8 8 0 0 1 0 16z" fill="currentColor"/></svg>
          </button>
          <button type="button" className={activeTool === "eyedropper" ? "active" : ""} aria-label="Color picker tool" aria-pressed={activeTool === "eyedropper"} title="Sample a color from the screen and apply it to the selection or canvas" onClick={() => void sampleCanvasColor()}>
            <svg viewBox="31.86 207.79 32 32" aria-hidden="true">
              <rect x="47.14" y="219.27" width="5.27" height="4.41" transform="translate(171.18 29.67) rotate(45)" fill="currentColor"/>
              <path d="M52.56,221.13l2.1-2.14c.67-.67.67-1.77,0-2.44h0c-.67-.67-1.77-.67-2.44,0l-2.1,2.14" fill="currentColor"/>
              <path d="M47.27,222.08l-7.04,7.04c-.52.52-.52,1.37,0,1.9h0c.52.52,1.37.52,1.9,0l7.04-7.04" fill="none" stroke="currentColor" strokeWidth=".5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
          <button type="button" className={activeTool === "bone" ? "active" : ""} aria-label="Bone tool" aria-pressed={activeTool === "bone"} title="Create Motion from position keyframes" onClick={() => { setActiveTool("bone"); createMotion(); }}>
            <svg viewBox="31.86 265.2 32 32" aria-hidden="true"><path d="M49.74,283.99l-6.67-7.55s-1.11,0-2.57-.35c-.85-.21-1.8-1.13-1.79-2.12,0-.42.21-1.08.54-1.34.52-.41.89-.75,1.76-.86.33.61.41,1.35.21,2.01.11-.18.19-.37.25-.56.07-.22.11-.46.09-.69-.01-.16-.06-.31-.08-.46-.14-.94.56-2.05,1.53-2.2.97-.15,1.74.79,2,1.62.36,1.17-.19,2.6.25,3.01l6.67,7.55s1.11,0,2.57.35c.85.21,1.8,1.13,1.79,2.12,0,.42-.24.84-.57,1.09-.31.24-1.48,1.33-1.89,1.01-.1-.07-.14-.19-.18-.31-.15-.53-.1-1.09.03-1.62-.12.28-.27.63-.32.93-.08.42,0,.86-.04,1.28-.03.37-.16.75-.39,1.04s-.58.51-.95.55c-.57.06-1.12-.28-1.51-.7-.54-.57-.64-1.3-.61-2.06.02-.45.26-1.38-.13-1.74Z" fill="currentColor"/></svg>
          </button>
          {/* Illustrator Fill / Stroke boxes: click = active box (X), double-click = Colour Picker, ⇄ = swap (Shift+X). */}
          <div className={`cb-fillstroke ${activeBox === "stroke" ? "stroke-front" : ""}`} ref={fillStrokeRef}>
            <button type="button" className={`cb-fill-box ${boxState.fill ? "" : "none"} ${activeBox === "fill" ? "active" : ""}`} style={boxState.fill ? { background: boxState.fill } : undefined}
              aria-label={`Fill: ${boxState.fill || "none"}`} aria-pressed={activeBox === "fill"}
              title={boxState.fill ? `Fill ${boxState.fill}${boxState.kind === "background" ? " (scene background)" : ""} · double-click to choose a colour` : "This layer has no fill colour"}
              onClick={() => setActiveBox("fill")} onDoubleClick={() => { setActiveBox("fill"); if (boxState.fill) setBoxPicker("fill"); }} />
            <button type="button" className={`cb-stroke-box ${boxState.stroke ? "" : "none"} ${activeBox === "stroke" ? "active" : ""}`} style={boxState.stroke ? { borderColor: boxState.stroke } : undefined}
              aria-label={`Stroke: ${boxState.stroke || "none"}`} aria-pressed={activeBox === "stroke"}
              title={boxState.stroke ? `Stroke ${boxState.stroke} · double-click to choose a colour` : boxState.kind === "text" ? "Text has no stroke" : "No stroke colour here"}
              onClick={() => setActiveBox("stroke")} onDoubleClick={() => { setActiveBox("stroke"); if (boxState.stroke) setBoxPicker("stroke"); }} />
            <button type="button" className="cb-fillstroke-swap" title="Swap fill and stroke colours (Shift+X)" aria-label="Swap fill and stroke colours" disabled={!(boxState.kind === "character" && boxState.fill && boxState.stroke)} onClick={swapBoxColours}>
              <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2 4h6.5L7 2.5M10 8H3.5L5 9.5" fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </button>
          </div>
          <button type="button" className={`cb-recolor-open ${recolorOpen ? "active" : ""}`} title="Recolour… (the selected character's palette, colour by colour)" aria-label="Recolour" onClick={() => openRecolor("both")}>
            <svg viewBox="0 0 32 32" aria-hidden="true"><circle cx="11" cy="12" r="4" fill="#e0624f"/><circle cx="20" cy="11" r="4" fill="#e8c34d"/><circle cx="16" cy="19" r="4" fill="#4f8fe0"/><path d="M8 24h16" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>
          </button>
          <button type="button" className={activeTool === "zoom" ? "active" : ""} aria-label="Zoom tool" aria-pressed={activeTool === "zoom"}
            title="Zoom tool (Z) — click to zoom in, Option/Alt + click to zoom out, drag to zoom to an area. Double-click: Actual Size (100%)"
            onClick={() => setActiveTool("zoom")} onDoubleClick={() => { setActiveTool("zoom"); zoomToActualSize(); }}>
            <svg viewBox="0 0 32 32" aria-hidden="true"><circle cx="14" cy="14" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.6"/><path d="M19 19l5.5 5.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/><path d="M11 14h6M14 11v6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>
          </button>
          <button type="button" className={`cb-find-replace-color ${findReplaceOpen ? "active" : ""}`} title="Find and Replace (Cmd/Ctrl+F): colour, text or font" aria-label="Find and Replace" onClick={() => setFindReplaceOpen(true)}>
            {/* "A → B": find something and replace it (the magnifier belongs to the Zoom tool). */}
            <svg viewBox="0 0 32 32" aria-hidden="true"><path d="M5 20l3.5-9 3.5 9M6.3 17h4.4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/><path d="M13.5 16h5M17 13.5l2.5 2.5-2.5 2.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/><path d="M21.5 11h3.2a2.2 2.2 0 0 1 0 4.4h-3.2zM21.5 15.4h3.7a2.3 2.3 0 0 1 0 4.6h-3.7z" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"/></svg>
          </button>
        </aside>
        {activeTool === "tone" && (
          <div className="cb-tone-bar" style={{ left: toneBarPosition.left, top: toneBarPosition.top }} role="toolbar" aria-label="Lighten / Darken options">
            <div className="cb-tone-head" data-drag-handle title="Drag to move">
              <strong>{toneDarken ? "Darken" : "Lighten"}</strong>
              <span className="cb-drag-grip" aria-hidden="true" />
            </div>
            <div className="cb-tone-toggle" role="radiogroup" aria-label="What changes">
              <button type="button" className={toneShades ? "active" : ""} aria-pressed={toneShades} onClick={() => setToneShades(true)}>With shades</button>
              <button type="button" className={!toneShades ? "active" : ""} aria-pressed={!toneShades} onClick={() => setToneShades(false)}>This colour only</button>
            </div>
            <small>{selected?.type === "character" ? `Click = lighter · Alt/Option = darker · Shift = fine · ${activeCharacterPart ? "selected part only" : "whole character"}` : "Select a character first, then click its colours."}</small>
          </div>
        )}
        {boxPicker && (boxPicker === "fill" ? boxState.fill : boxState.stroke) && (
          <ColourPicker
            initial={(boxPicker === "fill" ? boxState.fill : boxState.stroke) || "#000000"}
            onOk={(hex) => { applyBoxColour(boxPicker, hex); setBoxPicker(null); }}
            onCancel={() => setBoxPicker(null)}
          />
        )}
        {findReplaceOpen && (
          <FindReplaceDialog
            onClose={() => { setFindReplaceOpen(false); setFrPicking(null); }}
            onReplace={runFindReplace}
            onPrepareLibrary={prepareLibraryReplace}
            onRequestPick={(target) => setFrPicking(target)}
            picking={frPicking}
            picked={frPicked}
          />
        )}
        {recolorOpen && (
          <RecolorPanel
            character={selected?.type === "character" ? selected : null}
            activePart={selected?.type === "character" ? activeCharacterPart : null}
            activePartLabel={selected?.type === "character" && activeCharacterPart ? partLabel(selected, activeCharacterPart) : undefined}
            getFrame={() => (selected ? frameAccessRef.current?.(selected.id) : undefined)}
            initialTarget={recolorTarget}
            pickedColor={pickedColor?.color || null}
            pickNonce={pickedColor?.nonce || 0}
            pickActive={colorPickActive}
            onRequestPick={(scope) => { pickScopeRef.current = scope; setColorPickActive((active) => !active); }}
            onPreview={(rule) => setPreviewColorReplacement(rule && selected?.type === "character" ? { objectId: selected.id, rule } : null)}
            onCommit={commitColorReplacement}
            onRemove={removeColorReplacement}
            onResetAll={resetColorReplacements}
            onClose={closeRecolor}
            position={recolorPosition}
          />
        )}

        <section className="cb-workspace">
          <div className="cb-project-tab-row">
            <div className="cb-project-tabs" role="tablist" aria-label="Open projects">
              {(openTabs.length ? openTabs : [{ id: project.id, title: project.title || "Untitled Project-01" }]).map((tab) => (
                <div key={tab.id} className={`cb-project-tab ${tab.id === project.id ? "active" : ""}`} title={tab.title}>
                  <button type="button" role="tab" aria-selected={tab.id === project.id} className="cb-project-tab-label" onClick={() => void switchProject(tab.id)}>
                    {tab.id === project.id ? (project.title || tab.title) : tab.title}
                  </button>
                  {tab.id === project.id && (
                    <span className={`cb-tab-save-state ${saveState}`} role="status" title={saveState === "error" ? "Could not reach the server — your work is kept in this browser and saving will retry" : "Your work saves automatically"}>
                      {saveState === "saving" ? "Saving…" : saveState === "unsaved" ? "Unsaved" : saveState === "error" ? "Not saved" : "Saved"}
                    </span>
                  )}
                  <button type="button" className="cb-project-tab-close" onClick={() => void closeProjectTab(tab.id)} aria-label={`Close ${tab.title}`} title="Close tab (the project is kept)">×</button>
                </div>
              ))}
            </div>
            <div className="cb-scene-tabs" role="tablist" aria-label="Scenes">
              {project.scenes.map((item) => (
                <div key={item.id} className={`cb-scene-tab ${item.id === scene.id ? "active" : ""}`} title={item.name}>
                  <button type="button" role="tab" aria-selected={item.id === scene.id} className="cb-scene-tab-label" onClick={() => void changeScene(item)}>{item.name}</button>
                  {project.scenes.length > 1 && (
                    <button type="button" className="cb-scene-tab-close" onClick={() => void deleteScene(item)} aria-label={`Delete ${item.name}`} title="Delete this scene">×</button>
                  )}
                </div>
              ))}
              <button type="button" className="cb-scene-add" onClick={addScene} aria-label="Add scene" title="Add scene">＋</button>
            </div>
            <div className="cb-editor-project-actions">
              <button onClick={() => { void flushAutosave().then(() => router.push("/dashboard?newProject=1")); }}>New Project</button>
              <button ref={openButtonRef} onClick={toggleOpenPanel} aria-haspopup="menu" aria-expanded={openPanel} title="Recent projects, or open a .cb file from this device (Cmd/Ctrl+O)">Open Project</button>
              <Popover open={openPanel} anchorRef={openButtonRef} onClose={() => setOpenPanel(false)} align="start" offset={14} className="cb-open-panel" aria-label="Open project">
                <div className="cb-open-panel-head">Recent projects</div>
                {recentProjects == null ? <p className="cb-open-panel-note">Loading…</p>
                  : recentProjects.length === 0 ? <p className="cb-open-panel-note">No recent projects.</p>
                  : recentProjects.map((item) => (
                    <button key={item.id} type="button" role="menuitem" className="cb-open-recent" onClick={() => { setOpenPanel(false); void switchProject(item.id); }} title={`Open ${item.title}`}>
                      <span className="cb-open-recent-thumb">
                        {item.thumbnail_url ? <img src={item.thumbnail_url} alt="" draggable={false} /> : <i aria-hidden="true">{(item.title || "U").trim().charAt(0).toUpperCase()}</i>}
                      </span>
                      <span className="cb-open-recent-meta"><strong>{item.title || "Untitled"}</strong><small>{formatEditedAgo(item.updated_at)}</small></span>
                    </button>
                  ))}
                <button type="button" role="menuitem" className="cb-open-device" onClick={() => { setOpenPanel(false); void openProjectFile(); }}>
                  Open from device…<kbd>⌘O</kbd>
                </button>
              </Popover>
              <button className="render" onClick={startRender} disabled={render?.status === "queued" || render?.status === "running"}>{render?.status === "queued" ? "Queued…" : render?.status === "running" ? `Exporting ${render.progress}%` : "Export"}</button>
              <button onClick={() => void save()} title="Save to a .cb file on this device (Cmd/Ctrl+S, Shift for Save As)">Save Project</button>
              {render?.status === "complete" && render.output_url && <a className="cb-download-mp4" href={render.output_url} download={`characterbazaar-${project.title || "project"}.mp4`}>⇩ Download</a>}
              {render?.status === "failed" && <button className="cb-render-error" title={render.error || "Export failed"} onClick={() => showNotice(`Export failed: ${render.error || "Unknown error"}`, "error")}>Export Error</button>}
            </div>
            <div className="cb-canvas-zoom-toolbar" ref={zoomToolbarRef} title="Editor viewport zoom. Hold Space + drag to pan.">
              {/* option 2: one up/down stepper instead of − and ＋; "Fit" lives in the menu */}
              <span className="cb-zoom-stepper" role="group" aria-label="Canvas zoom steps">
                <button type="button" aria-label="Zoom in" title="Zoom in" onClick={() => setCanvasZoom((value) => clampCanvasZoom(value * 1.25))}>
                  <svg viewBox="0 0 14 8" aria-hidden="true"><path d="M1 7l6-6 6 6" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
                </button>
                <button type="button" aria-label="Zoom out" title="Zoom out" onClick={() => setCanvasZoom((value) => clampCanvasZoom(value / 1.25))}>
                  <svg viewBox="0 0 14 8" aria-hidden="true"><path d="M1 1l6 6 6-6" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
                </button>
              </span>
              <button type="button" ref={zoomValueRef} className="cb-canvas-zoom-value" aria-haspopup="menu" aria-expanded={zoomMenuOpen} onClick={() => setZoomMenuOpen((open) => !open)}>
                Canvas {Math.round(canvasFitScale * canvasZoom * 100)}%
                <svg className="cb-zoom-chevron" viewBox="0 0 14 8" aria-hidden="true"><path d="M1 1l6 6 6-6" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </button>
              <Popover open={zoomMenuOpen} anchorRef={zoomValueRef} onClose={() => setZoomMenuOpen(false)} align="end" offset={14} className="cb-canvas-zoom-menu cb-zoom-menu-v2" aria-label="Canvas zoom">
                <button type="button" role="menuitem" className={canvasZoom === 1 ? "current" : ""} onClick={() => { setCanvasZoom(1); resetCanvasView(); setZoomMenuOpen(false); }}>Fit in Window</button>
                {[25, 50, 75, 100, 200, 500, 1000, 1500, 2000].map((percent) => (
                  <button key={percent} type="button" role="menuitem" className={canvasZoom !== 1 && Math.round(canvasFitScale * canvasZoom * 100) === percent ? "current" : ""}
                    onClick={() => { setCanvasZoom(clampCanvasZoom((percent / 100) / Math.max(0.01, canvasFitScale))); setZoomMenuOpen(false); }}>
                    {percent}%
                  </button>
                ))}
              </Popover>
              <button type="button" className={`cb-canvas-grid-toggle ${transparencyGrid ? "active" : ""}`} aria-pressed={transparencyGrid} aria-label="Transparency grid"
                title="Transparency grid (Shift+T) — hides the canvas colour so transparent areas show" onClick={() => setTransparencyGrid((value) => !value)}>
                <svg viewBox="0 0 16 16" aria-hidden="true"><g fill="none" stroke="currentColor"><rect x="1.5" y="1.5" width="13" height="13" strokeWidth="1.2" /><path d="M6 1.5v13M10.5 1.5v13M1.5 6h13M1.5 10.5h13" strokeWidth=".7" /></g></svg>
              </button>
              <button type="button" className={`cb-canvas-grid-toggle ${clipToStage ? "active" : ""}`} aria-pressed={clipToStage} aria-label="Clip content outside the Stage"
                title="Clip content outside the Stage" onClick={toggleClipToStage}>
                <svg viewBox="0 0 16 16" aria-hidden="true"><g fill="none" stroke="currentColor" strokeWidth="1.2"><rect x="4" y="4" width="8" height="8" /><path d="M4 .5V4H.5M12 15.5V12h3.5M15.5 4H12V.5M.5 12H4v3.5" /></g></svg>
              </button>
            </div>
          </div>

          <div
            className="cb-canvas-wrap"
            onPointerEnter={() => { canvasHoverRef.current = true; }}
            onPointerLeave={() => { canvasHoverRef.current = false; }}
            onDragOver={(event) => {
              if (event.dataTransfer.types.includes("application/x-cb-reference-character")) {
                event.preventDefault();
                event.dataTransfer.dropEffect = "copy";
              }
            }}
            onDrop={(event) => {
              const payload = event.dataTransfer.getData("application/x-cb-reference-character");
              if (!payload || !project) return;
              event.preventDefault();
              try {
                const data = JSON.parse(payload) as { characterId?: string; actionId?: string };
                const rect = event.currentTarget.getBoundingClientRect();
                const x = ((event.clientX - rect.left) / Math.max(1, rect.width)) * project.width;
                const y = ((event.clientY - rect.top) / Math.max(1, rect.height)) * project.height;
                const characterId = data.characterId || characterLibraryCharacters[0]?.id;
                if (characterId) addReferenceBrowserCharacter(characterId, data.actionId, { x, y });
              } catch {
                const first = characterLibraryCharacters[0];
                if (first) addReferenceBrowserCharacter(first.id, first.actions[0]?.id);
              }
            }}
          >
            {notice && (
              <div key={notice.id} className={`cb-canvas-notice ${notice.tone === "error" ? "error" : ""}`} role={notice.tone === "error" ? "alert" : "status"}>
                {notice.text}
              </div>
            )}
            <StageCanvas
              data={draft}
              width={project.width}
              height={project.height}
              selectedObjectId={selectedObjectId}
              selectedObjectIds={selectedObjectIds}
              onSelectionChange={changeSelectionFromCanvas}
              toolMode={activeTool === "scale" ? "scale" : activeTool === "zoom" ? "zoom" : "transform"}
              transparencyGrid={transparencyGrid}
              clipToStage={clipToStage}
              isPlaying={isPlaying}
              playhead={playhead}
              onSelect={selectFromCanvas}
              onMove={moveObject}
              onMoveMany={moveObjects}
              onTransform={transformObject}
              activeCharacterPart={selected?.type === "character" ? activeCharacterPart : null}
              onMoveCharacterPart={moveCharacterPart}
              onTransformCharacterPart={transformCharacterPart}
              onSetCharacterPartPivot={setCharacterPartPivot}
              onActiveCharacterPart={handleActiveCharacterPart}
              onCharacterPartDoubleClick={handleCharacterPartDoubleClick}
              characterPartEntered={selected?.type === "character" && Boolean(activeCharacterPart) && partReplacementBrowserOpen}
              previewColorReplacement={previewColorReplacement}
              frameAccessRef={frameAccessRef}
              viewCenterRef={viewCenterRef}
              blockDoubleClick={activeTool === "tone" || colorPickActive || boxPicking || Boolean(frPicking)}
              colorPickActive={colorPickActive || toneToolLive || Boolean(frPicking) || boxPicking}
              colorPickCursor={colorPickActive || frPicking || boxPicking ? "pick" : toneDarken ? "darken" : "lighten"}
              onColorPick={handleStageColorPress}
              onCharacterPartsReady={setCharacterPartsReady}
              zoom={canvasZoom}
              onZoomChange={(value) => setCanvasZoom(clampCanvasZoom(value))}
              onFitScaleChange={setCanvasFitScale}
              viewResetRevision={canvasViewResetRevision}
            />
          </div>

          <Timeline
            scenes={project.scenes}
            activeId={scene.id}
            layers={draft.objects}
            selectedObjectId={selectedObjectId}
            isPlaying={isPlaying}
            playhead={playhead}
            activeDuration={duration}
            onSelect={changeScene}
            onSelectLayer={selectEditorObject}
            onAdd={addScene}
            onSeek={(seconds) => setPlayhead(Math.max(0, Math.min(duration, seconds)))}
            onPlay={() => { if (!isPlaying && playhead >= duration) setPlayhead(0); setPlaying(!isPlaying); }}
            onAddKeyframe={(id, time) => addOrUpdateCharacterKeyframe(id, time)}
            onImportAudio={() => voiceUploadRef.current?.click()}
            onCreateMotion={(id) => createMotion(id)}
            onReorderLayer={reorderLayer}
            onDeleteLayer={deleteLayer}
            onUpdateLayerTiming={updateLayerTiming}
            onToggleLayerLoop={toggleLayerLoop}
            onClipDragChange={onClipDragChange}
            frameSelection={frameSelection}
            onSelectFrames={selectFrames}
            onFrameAction={frameAction}
            onMoveKeyframe={moveKeyframe}
            onSetTweenEase={setTweenEase}
            onAddLayer={addLayer}
            onToggleLayerHidden={(id) => toggleLayerFlag(id, "hidden")}
            onToggleLayerLocked={(id) => toggleLayerFlag(id, "locked")}
            sourceDurations={sourceDurations}
          />
        </section>

        {selected?.type === "character" ? (
          <CharacterEditPanel
            character={selected}
            activePart={activeCharacterPart}
            onActivePart={handleActiveCharacterPart}
            replacementBrowserOpen={partReplacementBrowserOpen}
            onReplacementBrowserOpenChange={setPartReplacementBrowserOpen}
            referenceCharacterId={referenceCharacterId}
            onReferenceCharacterChange={setReferenceCharacterId}
            onReferenceActionChange={setReferenceActionOnSelected}
            onBack={() => { selectObject(null); setActiveCharacterPart(null); setPartReplacementBrowserOpen(false); }}
            onLibrariesHome={() => { showLibrariesHome(); selectObject(null); setActiveCharacterPart(null); setPartReplacementBrowserOpen(false); }}
            onPatch={patchSelected}
            onUploadVoice={() => voiceUploadRef.current?.click()}
            canvasZoom={canvasZoom}
            onCanvasZoomChange={(value) => setCanvasZoom(clampCanvasZoom(value))}
            onCanvasFit={resetCanvasView}
            playhead={playhead}
            duration={duration}
            currentTransform={selectedCharacterTransform || { x: selected.x, y: selected.y, scale: selected.scale || 1, rotation: selected.rotation || 0 }}
            onAddOrUpdateKeyframe={() => addOrUpdateCharacterKeyframe(selected.id, playhead)}
            onDeleteKeyframe={(keyframeId) => deleteCharacterKeyframe(selected.id, keyframeId)}
            onSeek={(seconds) => { setPlaying(false); setPlayhead(Math.max(0, Math.min(duration, seconds))); }}
            onClearKeyframes={() => clearCharacterKeyframes(selected.id)}
            onAddOrUpdatePartKeyframe={(partKey) => addOrUpdatePartKeyframe(selected.id, partKey, playhead)}
            onDeletePartKeyframe={(partKey, keyframeId) => deletePartKeyframe(selected.id, partKey, keyframeId)}
            onClearPartKeyframes={(partKey) => clearPartKeyframes(selected.id, partKey)}
            onReplacePartAsset={replaceCharacterPartAsset}
            onClearPartReplacement={clearCharacterPartReplacement}
            onApplyLibraryReplacement={applyLibraryPartReplacement}
            onSwapPartSymbol={swapCharacterPartSymbol}
            onRestorePart={(partKey) => restoreCharacterPart(selected.id, partKey)}
            onOpenRecolor={() => openRecolor("both")}
            onDelete={() => deleteLayer(selected.id)}
          />
        ) : selected?.type === "text" ? (
          <TextLayerPanel layer={selected} onPatch={patchSelected} onBack={() => selectObject(null)} />
        ) : (
          <AssetPanel
            onAddReferenceCharacter={addReferenceBrowserCharacter}
            selectedReferenceCharacterId={referenceCharacterId}
            onAddProp={addProp}
            onAddText={addText}
            onUploadBackground={uploadBackground}
            onUploadVoice={uploadVoice}
            onAIBackground={generateBackground}
            onAddMediaItem={(item) => void addMediaLibraryItem(item)}
          />
        )}
      </div>
      {aiAnimateOpen && (
        <AIAnimatePanel
          width={project.width}
          height={project.height}
          duration={duration}
          characters={draft.objects.filter((item) => item.type === "character" && item.assetKind === "animate-createjs")}
          onApply={applyAIAnimationPlan}
          onClose={() => setAIAnimateOpen(false)}
        />
      )}
    </main>
  );
}
