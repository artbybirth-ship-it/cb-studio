"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { api } from "@/lib/api";
import { SCRUB_END, SCRUB_START } from "@/lib/scrub";
import { useEscClose } from "@/lib/escClose";
import { compileAnimationPlan } from "@/lib/animationCompiler";
import { resolveCharacterTransformAtTime, sortKeyframes, upsertCharacterKeyframe } from "@/lib/keyframes";
import { composeGroupChange, groupPivotAtTime, isRestPose, movePivot, removeGroupPose, resolveGroupPose, resolveObjectTransformAtTime, sortGroupKeyframes } from "@/lib/groupMotion";
import { extractFrames, newLayerId, shiftObjectTimes } from "@/lib/layerSplit";
import { canShareLayer, groupOfRow, isGroupRow, layerKeyOf, layerMembers, orderByLayers, retagCopies, rowKeyOf, rowMembersOf, timelineRows } from "@/lib/layerRows";
import { groupForPart, isMultiPartKey, joinPartKeys, parentPartKey, partMembers, partTitle, togglePartKey } from "@/lib/partSelection";
import { exportSourceOfPlayer, symbolPlayerUrl } from "@/lib/partVariants";
import { partEditMatrix, resolvePartTransformAtTime, resolveSourceSeekMs, upsertPartKeyframe } from "@/lib/partKeyframes";
import { useCharacterLibrary } from "@/lib/characterLibrary";
import { useEditorStore } from "@/store/editor";
import { addAnchor, clearKeyframe, fileAnchors, fileOf, insertFrames, isUnchanged, grownBlanks, grownTweens, keyframeAt, removeAnchor, removeFrames, shownFrames, spanAt, type Anchor, type Tween } from "@/lib/symbolKeys";
import { addSymbolLayer, arrangeSymbolLayers, duplicateLayers, groupLayers, parentOf, ungroupLayer, isLayerEditEmpty, playerSpec, toggled, withClones } from "@/lib/symbolLayers";
import { affinePart, canTransform, flipPart, stageRectOf, isSound, localToParent, partBox, rotatePart, scalePart, skewPart, stageToLocal, type PartInfo, type Pt, type ScaleHandle, type SkewEdge } from "@/lib/partTransform";
import type { AnimationPlan, CharacterPartDescriptor, CharacterPartKey, ColorReplacement, EditorData, EditorObject, GroupKeyframe, GroupMotion, PoseForeign, Project, RenderJob, Scene, SymbolEaseEdit, SymbolKeyEdit, SymbolLayerEdit, SymbolValueEdit, SymbolValueKey } from "@/types";
import AssetPanel, { showLibrariesHome } from "./AssetPanel";
import StageCanvas, { type TransformPatch } from "./StageCanvas";
import { readOpenProjects, recentProjectsOf, removeOpenProject, upsertOpenProject, type OpenProjectTab } from "@/lib/openProjects";
import { buildProjectFile, formatEditedAgo, openProjectFileAsNew, saveProjectFile } from "@/lib/projectFile";
import SymbolTimeline, { type FlaSymbol } from "./SymbolTimeline";
import Timeline, { selectionLayerIds, type FrameAction, type FrameSelection, type LayerDropTarget } from "./Timeline";
import CharacterEditPanel from "./CharacterEditPanel";
import NativePoseDialog from "./NativePoseDialog";
import { findFlaUrl } from "@/lib/native/loadDoc";
import { playerFitOf } from "@/lib/native/character";
import FindReplaceDialog from "./FindReplaceDialog";
import { addColorRule, addCounts, applyToEditorData, charactersUsingColour, describeCounts, emptyCounts, libraryIdOf, normalizeHex, totalCount, visibleAt, type FindRequest } from "@/lib/findReplace";
import { followColour, shiftLightness, shiftLike } from "@/lib/color";
import ColourPicker from "./ColourPicker";
import PanelClose from "./PanelClose";
import AdjustColourDialog from "./AdjustColourDialog";
import { sampleStageColour } from "./CanvasEyedropper";
import { adjustHex, isIdentity, type AdjustSettings } from "@/lib/adjustColour";
import ReflectDialog from "./ReflectDialog";
import { partLabel } from "@/lib/partLabels";
import { axisInsideCharacter, reflectOrientation, reflectPoint, wrapDegrees } from "@/lib/reflect";
import AIAnimatePanel from "./AIAnimatePanel";
import HeaderUserIcon from "./HeaderUserIcon";
import Popover from "./Popover";
import { renderProjectThumbnail } from "@/lib/projectThumbnail";
import ScaleRotateDialog from "./ScaleRotateDialog";
import ToolGroup from "./ToolGroup";
import {
  AlignBottomIcon, AlignHCenterIcon, AlignIcon, AlignLeftIcon, AlignRightIcon, AlignTopIcon, AlignVCenterIcon, AdjustColourIcon, ColourIcon, DistributeHIcon, DistributeVIcon,
  EyedropperIcon, ExportIcon, FileIcon, FillStrokeIcon, FindReplaceIcon, ImportIcon, LightDarkIcon, NewFileIcon, OpenFileIcon, ReflectIcon, SaveAsIcon, SaveIcon, ScaleIcon, SelectIcon, TextIcon, TransformIcon,
} from "./toolIcons";
import TextPanel, { type TextValues } from "./TextPanel";
import TextColourPalette from "./TextColourPalette";
import { keepTextAnchor } from "@/lib/textStyle";
import { renderStage, setStageRenderer } from "@/lib/stageSnapshot";
import { BUILTIN_FAMILIES, ensureFontFace, type FontFaceInfo, type FontFamilyInfo } from "@/lib/fonts";
import { teamFamilies, uploadSystemFont, type TeamFont } from "@/lib/localFonts";
import ExportPanel, { exportExtension, exportFormatLabel, type ExportFormat, type ExportResolution } from "./ExportPanel";
import { deliverExport, pickExportTarget, type ExportTarget } from "@/lib/exportFile";
import { playChime, unlockChime } from "@/lib/chime";
import TransformPanel, { spacedShortcut, type TransformField, type TransformReading } from "./TransformPanel";
import { alignMoves, localReference, positionFor, stageBounds, toStage, type AlignAction, type LayerGeometry, type Orientation } from "@/lib/layerTransform";
import type { MediaLibraryItem } from "@/lib/mediaLibrary";

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));

// The timeline ends at the last frame of the longest timed layer (Animate): layers without
// their own clip length (text, shapes) just run to that end. 0 = nothing timed.
/** A layer's saved keyframe edit: its keyframes (null: the file's), the tweens made here and its blank keyframes; null when nothing is left to save. */
const keyEntry = (props: string[], file: Parameters<typeof fileAnchors>[0] | undefined, anchors: Anchor[] | null, tweens?: Tween[], blanks?: number[], cut?: number): SymbolKeyEdit | null => {
  const marks = { ...(tweens?.length ? { tweens } : {}), ...(blanks?.length ? { blanks } : {}), ...(cut != null ? { cut } : {}) }, marked = Boolean(tweens?.length || blanks?.length || cut != null);
  if (anchors && !(file && !marked && isUnchanged(file, anchors))) return { props, anchors, ...marks };
  return marked && file ? { props, anchors: fileAnchors(file), ...marks } : null;
};
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

// ---- ⌘G group motion (lib/groupMotion.ts). Every member carries the same groupMotion.
const groupMotionIn = (objects: EditorObject[], group: string) => objects.find((item) => item.group === group && item.groupMotion)?.groupMotion;
const writeGroupMotion = (objects: EditorObject[], group: string, motion: GroupMotion | undefined) => objects.forEach((item) => {
  if (item.group !== group) return;
  if (motion) item.groupMotion = JSON.parse(JSON.stringify(motion)); else delete item.groupMotion;
});
type PlacePatch = { x?: number; y?: number; rotation?: number; scale?: number };
/** A position / turn / size given where the object is drawn → its own (its group's motion taken off). */
const toOwnPatch = <P extends PlacePatch>(item: EditorObject, patch: P, time: number): P => {
  if (!item.group || !item.groupMotion) return patch;
  const pose = resolveGroupPose(item.groupMotion, time);
  if (isRestPose(pose)) return patch;
  const drawn = resolveObjectTransformAtTime(item, time);
  const own = removeGroupPose({ x: patch.x ?? drawn.x, y: patch.y ?? drawn.y, rotation: patch.rotation ?? drawn.rotation, scale: patch.scale ?? drawn.scale }, item.groupMotion, pose);
  return {
    ...patch,
    ...(patch.x != null || patch.y != null ? { x: own.x, y: own.y } : {}),
    ...(patch.rotation != null ? { rotation: own.rotation } : {}),
    ...(patch.scale != null ? { scale: own.scale } : {}),
  };
};
/**
 * An edit that moves, turns or sizes every object of a ⌘G group alike belongs to the group. With
 * motion it goes into the group's keyframe at the playhead (else the one before it, as with a
 * character); without, the objects change as usual and the registration point goes along.
 * Returns the ids it took care of.
 */
const applyWholeGroupEdits = (data: EditorData, entries: Array<{ id: string; patch: TransformPatch }>, time: number, enteredGroup: string | null) => {
  const handled = new Set<string>();
  const byId = new Map(entries.map((entry) => [entry.id, entry.patch]));
  const groups = new Set(entries.map((entry) => data.objects.find((item) => item.id === entry.id)?.group).filter((group): group is string => Boolean(group)));
  for (const group of groups) {
    if (group === enteredGroup) continue;
    const members = data.objects.filter((item) => item.group === group && !item.locked);
    if (!members.length || !members.every((item) => byId.has(item.id))) continue;
    const patch = byId.get(members[0].id)!;
    if (patch.skewX != null || patch.skewY != null || patch.stretchX != null || patch.stretchY != null || patch.pivotX != null || patch.pivotY != null) continue;
    const motion = groupMotionIn(data.objects, group);
    if (!motion) continue;
    const drawn = resolveObjectTransformAtTime(members[0], time);
    const after = { x: patch.x ?? drawn.x, y: patch.y ?? drawn.y };
    // The turn the short way round (rotations come wrapped to ±180°), so tweens don't spin backwards.
    const dRotation = patch.rotation != null ? ((((patch.rotation - drawn.rotation) % 360) + 540) % 360) - 180 : 0;
    const dScale = patch.scale != null ? patch.scale / Math.max(0.0001, drawn.scale) : 1;
    const pose = resolveGroupPose(motion, time);
    const next = composeGroupChange(motion, pose, dRotation, dScale, drawn, after);
    const frames = sortGroupKeyframes(motion.keyframes || []);
    if (!frames.length) {
      if (motion.pivotX != null && motion.pivotY != null) writeGroupMotion(data.objects, group, { ...motion, pivotX: motion.pivotX + next.x, pivotY: motion.pivotY + next.y });
      continue;
    }
    const frame = Math.round(time * TIMELINE_FPS);
    const target = frames.find((key) => Math.round(key.time * TIMELINE_FPS) === frame) || [...frames].reverse().find((key) => key.time <= time + 1e-6) || frames[0];
    const keyframes = frames.map((key) => (key.id !== target.id ? key : {
      ...key, x: key.x + next.x - pose.x, y: key.y + next.y - pose.y, rotation: key.rotation + next.rotation - pose.rotation, scale: Math.max(0.02, key.scale * (next.scale / pose.scale)),
    }));
    writeGroupMotion(data.objects, group, { ...motion, keyframes });
    members.forEach((item) => handled.add(item.id));
  }
  return handled;
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
type LayerClipboard = {
  objects: EditorObject[];
  centre: { x: number; y: number };
  /** Copied body parts (⌘C with parts selected): the part layer in `objects`, and which parts of
   *  which character, so ⌘V onto a selected part of another character can replace that part. */
  parts?: { keys: CharacterPartKey[]; assetUrl?: string; characterName: string; symbol?: string };
};
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

const CHARACTER_LAYER_NOTICE = "A character's layer holds just its character — drop these frames on an empty layer or between layers.";
const GROUP_DROP_NOTICE = "A group's layers stay in the group — drop it between layers, or double-click it to work inside.";
/** Text, images and shapes can share a layer; characters, backgrounds and sound each have their own. */
const sharesLayers = (item: EditorObject) => item.type === "text" || item.type === "prop";
/**
 * Where a new object goes (Animate: into the selected layer). It fills a selected empty layer's
 * blank keyframe; text, images and shapes join a selected layer of text / images / shapes, on its
 * frames; anything else, or onto a character's layer (it holds just its character), is a new layer.
 */
const placeInLayer = (data: EditorData, object: EditorObject, targetId: string | null | undefined) => {
  const target = targetId ? data.objects.find((item) => item.id === targetId) : undefined;
  if (target?.type === "empty") { data.objects.splice(data.objects.indexOf(target), 1, object); return; }
  if (!target || !joinLayer(data, [object], layerKeyOf(target))) data.objects.push(object);
};
/** Puts objects on a layer of text / images / shapes, sharing its frames, just above its top object.
 *  False (nothing changed) when they or the layer can't share. */
const joinLayer = (data: EditorData, objects: EditorObject[], key: string) => {
  const members = layerMembers(data.objects, key);
  if (!members.length || !objects.every(sharesLayers) || !members.every(sharesLayers) || members.some((item) => item.locked)) return false;
  const starts = members.map((item) => Math.max(0, Number(item.startTime || 0)));
  const start = Math.min(...starts);
  const openEnded = members.some((item) => !item.actionDurationMs);
  const end = Math.max(...members.map((item, index) => starts[index] + Number(item.actionDurationMs || 0) / 1000));
  const name = members[members.length - 1].layerName;
  for (const item of [...members, ...objects]) {
    item.layer = key;
    if (name) item.layerName = name; else delete item.layerName;
  }
  const top = members[members.length - 1];
  for (const item of objects) {
    item.startTime = start;
    if (openEnded) delete item.actionDurationMs; else item.actionDurationMs = (end - start) * 1000;
    // A layer inside a ⌘G group: the new objects are in the group too.
    if (top.group) { item.group = top.group; if (top.groupName) item.groupName = top.groupName; }
  }
  data.objects.splice(data.objects.indexOf(members[members.length - 1]) + 1, 0, ...objects);
  return true;
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

/** Index above the background pictures at the bottom of the stack (they would hide anything below). */
const backgroundFloor = (objects: EditorObject[]) => {
  let index = 0;
  while (index < objects.length && objects[index].type === "background") index += 1;
  return index;
};
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
  // Inside a character (Illustrator's isolation mode): true from the first double-click into it
  // until stepping all the way out, even with no part selected. enteredGroupId: a ⌘G group that was
  // double-clicked, so its members are picked one by one.
  const [characterIsolated, setCharacterIsolated] = useState(false);
  const [enteredGroupId, setEnteredGroupId] = useState<string | null>(null);
  const enteredGroupRef = useRef(enteredGroupId);
  enteredGroupRef.current = enteredGroupId;
  const isolatedObjectRef = useRef<EditorObject | null>(null);
  isolatedObjectRef.current = draft?.objects.find((item) => item.id === selectedObjectId) || null;
  // A ⌘G group of objects on the canvas that was double-clicked: its objects are picked one by one
  // (the rest of the scene fades) until Esc or a double-click on empty canvas.
  const [enteredObjectGroup, setEnteredObjectGroup] = useState<string | null>(null);
  const enteredObjectGroupRef = useRef(enteredObjectGroup);
  enteredObjectGroupRef.current = enteredObjectGroup;
  const [referenceCharacterId, setReferenceCharacterId] = useState("");
  const [aiAnimateOpen, setAIAnimateOpen] = useState(false);
  // "select" = Animate Selection tool (V), "transform" = Free Transform tool (Q).
  // Fill / Stroke boxes (Illustrator): click = active box, double-click = Colour Picker. For a
  // character they hold an ORIGINAL colour of its artwork (picked with the eyedropper, else its
  // most-used fill / outline colour) and show what that colour currently looks like.
  const [activeBox, setActiveBox] = useState<"fill" | "stroke">("fill");
  const [boxPicks, setBoxPicks] = useState<{ objectId: string; scope: string; fill?: string; stroke?: string } | null>(null);
  const [boxPalette, setBoxPalette] = useState<{ key: string; entries: { color: string; current: string; fills: number; strokes: number }[] } | null>(null);
  const [boxPicking, setBoxPicking] = useState(false);
  const [boxPicker, setBoxPicker] = useState<"fill" | "stroke" | null>(null);
  const frameAccessRef = useRef<((objectId: string) => HTMLIFrameElement | undefined) | null>(null);
  const viewCenterRef = useRef<(() => { x: number; y: number }) | null>(null);
  const layerGeometryRef = useRef<((objectId: string) => LayerGeometry | null) | null>(null);
  // Tool rail groups (Illustrator): the Edit group's current tool, the Transform and Align panels.
  const [lastEditTool, setLastEditTool] = useState<"select" | "scale" | "reflect">("select");
  const [transformOpen, setTransformOpen] = useState(false);
  const [transformReference, setTransformReference] = useState({ rx: 0.5, ry: 0.5 });
  const [transformLinked, setTransformLinked] = useState(true);
  const [transformScaleStrokes, setTransformScaleStrokes] = useState(true);
  const [alignToStage, setAlignToStage] = useState(false);
  const transformToggleRef = useRef<() => void>(() => undefined);
  // The desktop app may use ⌘T; Chrome always keeps it for "new tab", so the browser uses ⌥⌘T.
  const [transformShortcut, setTransformShortcut] = useState("⌥⌘T");
  useEffect(() => { if (/Electron/i.test(navigator.userAgent)) setTransformShortcut("⌘T"); }, []);
  // Light/Dark tool (Colour palette, ⌘L): a click makes the colour under the pointer lighter or darker
  // (the Dark / Light buttons), Alt/Option reverses, Shift = fine step.
  const [toneReverse, setToneReverse] = useState(false);
  const [toneDirection, setToneDirection] = useState<"light" | "dark">("light");
  const [toneStroke, setToneStroke] = useState(true);
  const [toneShadow, setToneShadow] = useState(false);
  const [toneBarPosition] = useState({ left: 70, top: 300 });
  const toneDarkNow = (toneDirection === "dark") !== toneReverse;
  // Fill/Stroke (<) for text, and Adjust colour (⌘J): what it was opened on, kept to preview and cancel.
  const [textFillStrokeOpen, setTextFillStrokeOpen] = useState(false);
  // Fill/Stroke on a character: Include Stroke / Include Shadow, remembered while the editor is open.
  const [boxEffects, setBoxEffects] = useState({ stroke: true, shadow: false });
  const [adjust, setAdjust] = useState<{ ids: string[]; label: string; hasShadow: boolean; base: Record<string, Partial<EditorObject>>; palettes: Record<string, { scope: string; entries: { color: string; current: string; fills: number; strokes: number }[] }> } | null>(null);
  // Panel borders (Animate): drag the canvas/timeline border and the right panel's left edge.
  // null = the stylesheet's default size; a custom size is remembered per browser.
  const [timelineHeight, setTimelineHeight] = useState<number | null>(null);
  const [sidePanelWidth, setSidePanelWidth] = useState<number | null>(null);
  const editorGridRef = useRef<HTMLDivElement>(null);
  const workspaceRef = useRef<HTMLElement>(null);
  useEffect(() => {
    try {
      const height = Number(window.localStorage.getItem("cb-timeline-height"));
      const width = Number(window.localStorage.getItem("cb-side-panel-width"));
      if (height > 0) setTimelineHeight(height);
      if (width > 0) setSidePanelWidth(width);
    } catch { /* storage unavailable */ }
  }, []);
  // "y" = canvas/timeline border, "x" = right panel border. The canvas keeps 300px height and
  // 400px width. Pointer capture keeps the drag alive over the character frames on the canvas.
  const beginBorderDrag = (event: ReactPointerEvent<HTMLDivElement>, axis: "x" | "y") => {
    const container = axis === "y" ? workspaceRef.current : editorGridRef.current;
    if (event.button !== 0 || !container) return;
    event.preventDefault();
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);
    const style = getComputedStyle(container);
    const tracks = (axis === "y" ? style.gridTemplateRows : style.gridTemplateColumns).split(" ").map(parseFloat);
    const startSize = tracks[2] || 0;
    const start = axis === "y" ? event.clientY : event.clientX;
    const max = axis === "y"
      ? container.clientHeight - tracks[0] - 300
      : container.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight) - tracks[0] - 2 * parseFloat(style.columnGap || "0") - 400;
    const min = axis === "y" ? 120 : 280;
    let size = startSize;
    const move = (moveEvent: PointerEvent) => {
      const delta = start - (axis === "y" ? moveEvent.clientY : moveEvent.clientX);
      size = Math.round(Math.max(min, Math.min(Math.max(min, max), startSize + delta)));
      (axis === "y" ? setTimelineHeight : setSidePanelWidth)(size);
    };
    const up = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      handle.removeEventListener("pointercancel", up);
      if (size !== startSize) {
        try { window.localStorage.setItem(axis === "y" ? "cb-timeline-height" : "cb-side-panel-width", String(size)); } catch { /* not persisted */ }
      }
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
    handle.addEventListener("pointercancel", up);
  };
  // Double-click a border: back to the default size.
  const resetBorder = (axis: "x" | "y") => {
    (axis === "y" ? setTimelineHeight : setSidePanelWidth)(null);
    try { window.localStorage.removeItem(axis === "y" ? "cb-timeline-height" : "cb-side-panel-width"); } catch { /* storage unavailable */ }
  };
  // Find and Replace dialog (Shift+Cmd/Ctrl+F or A→B in the tool palette).
  const [findReplaceOpen, setFindReplaceOpen] = useState(false);
  const [frPicking, setFrPicking] = useState<"find" | "replace" | null>(null);
  const [frPicked, setFrPicked] = useState<{ target: "find" | "replace"; color: string; nonce: number } | null>(null);
  // Picking a colour on the canvas: Esc cancels the pick before it closes the panel that asked for it.
  useEscClose(Boolean(frPicking), () => setFrPicking(null));
  useEscClose(boxPicking, () => { setBoxPicking(false); setActiveTool("select"); });
  const [activeTool, setActiveTool] = useState<"select" | "transform" | "scale" | "reflect" | "zoom" | "import" | "text" | "eyedropper" | "bone" | "tone" | null>("select");
  const activeToolRef = useRef(activeTool);
  activeToolRef.current = activeTool;
  const audioPlayersRef = useRef<Map<string, HTMLAudioElement>>(new Map());
  const voiceUploadRef = useRef<HTMLInputElement>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [renderFormat, setRenderFormat] = useState<ExportFormat>("mp4");
  // Where the running export is saved (chosen in the Save window before it started).
  const exportTargetRef = useRef<ExportTarget | null>(null);
  const finishedRenderRef = useRef<string | null>(null); // a finished export is handled once
  const importInputRef = useRef<HTMLInputElement>(null);
  const playClockRef = useRef(performance.now());
  const historyPastRef = useRef<EditorData[]>([]);
  const historyFutureRef = useRef<EditorData[]>([]);
  const canvasHoverRef = useRef(false);
  const zoomToolbarRef = useRef<HTMLDivElement>(null);
  const zoomValueRef = useRef<HTMLButtonElement>(null);
  // One dark box on the rail at a time, only once a tool is used: the last tool clicked keeps it
  // until another is clicked; tool shortcuts (V / Q / S / O, Cmd+F) move it too. None when the
  // editor opens, and automatic tool changes (back to Select after a pick or Esc) don't move it.
  const [railHighlight, setRailHighlight] = useState<"edit" | "file" | "text" | "colour" | "align" | null>(null);

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

  // The scene's last frame (frames 0 … length × 30 − 1): playback stops on it, not on the blank
  // frame after it.
  const lastFrameTime = Math.max(0, Math.round(duration * TIMELINE_FPS) - 1) / TIMELINE_FPS;
  const atLastFrame = playhead >= lastFrameTime - 1e-6;
  useEffect(() => {
    if (!isPlaying) return;
    // Position keyframes are evaluated at ~30 FPS so whole-character motion stays
    // visually synchronized with the original 30 FPS CreateJS source animation.
    playClockRef.current = performance.now();
    const timer = window.setInterval(() => {
      const now = performance.now();
      const delta = Math.max(0, (now - playClockRef.current) / 1000);
      playClockRef.current = now;
      setPlayhead((current) => Math.min(lastFrameTime, current + delta));
    }, 33);
    return () => window.clearInterval(timer);
  }, [isPlaying, lastFrameTime]);

  // Scene length follows the content: it grows and shrinks with the clips, but waits until a
  // clip drag ends so the ruler never rescales under the mouse.
  const clipDraggingRef = useRef(false);
  // A whole clip drag is one undo step: only its first change is recorded in the history.
  const dragHistoryRef = useRef(false);
  const [clipDragEndTick, setClipDragEndTick] = useState(0);
  // A merged layer row being dragged in time: where its objects started when the drag began.
  const rowDragBaseRef = useRef<{ key: string; rowStart: number; starts: Record<string, number> } | null>(null);
  const onClipDragChange = useCallback((active: boolean) => {
    clipDraggingRef.current = active;
    dragHistoryRef.current = false;
    rowDragBaseRef.current = null;
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
    if (isPlaying && atLastFrame) setPlaying(false);
  }, [isPlaying, atLastFrame, setPlaying]);
  useEffect(() => {
    // The former scene "Loop playback" toggle no longer exists; drop its stored setting.
    try { window.localStorage.removeItem("cb-loop-playback"); } catch { /* storage unavailable */ }
  }, []);

  useEffect(() => {
    if (!render || !["queued", "running"].includes(render.status)) return;
    const timer = window.setInterval(async () => {
      const latest = await api.getRender(render.id);
      setRender(latest);
      if ((latest.status === "complete" || latest.status === "failed") && finishedRenderRef.current === latest.id) return;
      if (latest.status === "complete" || latest.status === "failed") finishedRenderRef.current = latest.id;
      if (latest.status === "complete") {
        window.clearInterval(timer);
        const target = exportTargetRef.current;
        exportTargetRef.current = null;
        if (target && latest.output_url) {
          try {
            const result = await deliverExport(target, latest.output_url);
            showNotice(result.status === "saved" ? `Finished: saved to ${result.name}` : `Finished: ${result.name} is in your Downloads folder`);
          } catch {
            // The chosen folder could not be written (moved, no permission): the Downloads folder instead.
            const result = await deliverExport({ name: target.name }, latest.output_url);
            showNotice(`Finished: couldn't save to the chosen folder, so ${result.name} is in your Downloads folder`);
          }
        } else if (latest.output_url) {
          const result = await deliverExport({ name: `${(project?.title || "Untitled Project").trim()}.${exportExtension(renderFormat)}` }, latest.output_url);
          showNotice(`Finished: ${result.name} is in your Downloads folder`);
        }
        playChime("done");
      } else if (latest.status === "failed") {
        window.clearInterval(timer);
        exportTargetRef.current = null;
        playChime("error");
        showNotice(`Export failed: ${latest.error || "Unknown export error"}`, "error");
      }
    }, 1500);
    return () => window.clearInterval(timer);
  }, [render, renderFormat]);

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
  // A part in a ⌘G group selects the whole group (until the group is entered).
  const handleActiveCharacterPart = useCallback((partKey: CharacterPartKey | null) => {
    const { part, entered } = partLevelRef.current;
    const group = partKey ? groupForPart(isolatedObjectRef.current, partKey, enteredGroupRef.current) : null;
    const key = group ? group.members.join("|") : partKey || null;
    setActiveCharacterPart(key);
    setPartReplacementBrowserOpen(Boolean(key) && key === part && entered && !group);
    if (key) setCharacterIsolated(true);
  }, []);

  // Canvas double-click: selects a part, or enters it when it was already the selected part
  // before the gesture began. The canvas re-selects the character first, which clears the part,
  // so the part is always set again here.
  // A double-click on a member of the selected group goes inside the group (Illustrator); on a
  // grouped part otherwise it selects the group.
  const handleCharacterPartDoubleClick = useCallback((partKey: CharacterPartKey, alreadySelected: boolean) => {
    setCharacterIsolated(true);
    const group = groupForPart(isolatedObjectRef.current, partKey, enteredGroupRef.current);
    if (group) {
      const groupKey = group.members.join("|");
      if (partLevelRef.current.part === groupKey) { setEnteredGroupId(group.id); setActiveCharacterPart(partKey); }
      else setActiveCharacterPart(groupKey);
      setPartReplacementBrowserOpen(false);
      return;
    }
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

  // A drag on a number box (lib/scrub) changes the draft many times; only its first change is
  // recorded, so one Cmd+Z undoes the whole drag.
  const scrubHistoryRef = useRef<"idle" | "armed" | "recorded">("idle");
  useEffect(() => {
    const start = () => { scrubHistoryRef.current = "armed"; };
    const end = () => { scrubHistoryRef.current = "idle"; };
    window.addEventListener(SCRUB_START, start);
    window.addEventListener(SCRUB_END, end);
    return () => { window.removeEventListener(SCRUB_START, start); window.removeEventListener(SCRUB_END, end); };
  }, []);
  const mutate = useCallback((fn: (data: EditorData) => void) => {
    setDirty(true);
    // React may run an updater twice (development); the history is changed on the first run only.
    let recorded = false;
    setDraft((current) => {
      if (!current) return current;
      if (!recorded) {
        recorded = true;
        if (scrubHistoryRef.current !== "recorded") {
          historyPastRef.current.push(clone(current));
          if (historyPastRef.current.length > 60) historyPastRef.current.shift();
          if (scrubHistoryRef.current === "armed") scrubHistoryRef.current = "recorded";
        }
        historyFutureRef.current = [];
      }
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
  // The colour tools' target: the selected layer; inside a pose with a part picked, the character that holds the pose.
  const [poseOwnerId, setPoseOwnerId] = useState<string | null>(null);
  const colourItem = useMemo(() => selected || (poseOwnerId ? draft?.objects.find((item) => item.id === poseOwnerId) || null : null), [draft, poseOwnerId, selected]);
  const mutateColour = useCallback((fn: (item: EditorObject) => void) => {
    const id = colourItem?.id;
    if (!id) return;
    mutate((data) => {
      const item = data.objects.find((object) => object.id === id);
      if (item) fn(item);
    });
  }, [colourItem?.id, mutate]);

  // Shift+Cmd/Ctrl+F opens Find and Replace (Cmd+F is Paste in Front); Esc cancels its canvas eyedropper.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (frPicking && event.key === "Escape") { event.preventDefault(); event.stopImmediatePropagation(); setFrPicking(null); return; }
      if ((event.metaKey || event.ctrlKey) && !event.altKey && event.shiftKey && event.key.toLowerCase() === "f") {
        const element = event.target as HTMLElement | null;
        if (element && (element.isContentEditable || /^(input|textarea|select)$/i.test(element.tagName))) return;
        event.preventDefault();
        setFindReplaceOpen(true);
        setRailHighlight("colour");
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

  // Alt/Option reverses the Light/Dark tool (cursor and magnifier show − instead of +, or back).
  useEffect(() => {
    if (activeTool !== "tone") { setToneReverse(false); return; }
    const sync = (event: KeyboardEvent | PointerEvent) => setToneReverse(event.altKey);
    window.addEventListener("keydown", sync);
    window.addEventListener("keyup", sync);
    window.addEventListener("pointermove", sync);
    return () => {
      window.removeEventListener("keydown", sync);
      window.removeEventListener("keyup", sync);
      window.removeEventListener("pointermove", sync);
    };
  }, [activeTool]);

  /** The text layer under a point on the stage (topmost), if any. */
  const textLayerAt = (clientX: number, clientY: number) => {
    for (const element of document.elementsFromPoint(clientX, clientY)) {
      const id = (element as HTMLElement).closest?.<HTMLElement>(".cb-stage-text[data-editor-object-id]")?.dataset.editorObjectId;
      const layer = id ? draftRef.current?.objects.find((item) => item.id === id) : undefined;
      if (layer?.type === "text" && !layer.locked && !layer.hidden) return layer;
    }
    return null;
  };

  // ---- Light/Dark tool. A click makes the colour clicked lighter or darker (hue and saturation stay);
  // with Include Stroke its outlines, and with Include Shadow its shadows, change with it in the same
  // ratio. On text: its colour, outline and shadow colours. On the selected character: the ORIGINAL
  // colour under the pointer (as the eyedropper finds it) gets a recolour rule; Include Stroke adds the
  // outline colours of the shapes filled with it, Include Shadow the darker colours of its shading
  // family (cbColorRelatives). Repeated clicks keep adjusting the same rules; a colour back at its
  // original loses its rule.
  const adjustTone = (clientX: number, clientY: number, reverse: boolean, fine: boolean) => {
    const darker = (toneDirection === "dark") !== reverse;
    const delta = (darker ? -1 : 1) * (fine ? 0.03 : 0.08);
    const text = textLayerAt(clientX, clientY);
    if (text) {
      mutate((data) => {
        const item = data.objects.find((object) => object.id === text.id);
        if (!item) return;
        const before = normalizeHex(item.fillColor) || "#000000";
        const after = shiftLightness(before, delta);
        item.fillColor = after;
        if (toneStroke && item.textStrokeColor) item.textStrokeColor = shiftLike(normalizeHex(item.textStrokeColor) || "#000000", before, after);
        if (toneShadow && item.textShadowColor) item.textShadowColor = shiftLike(normalizeHex(item.textShadowColor) || "#000000", before, after);
      });
      return;
    }
    if (colourItem?.type !== "character") { showNotice("Select a character first, then click its colours, or click a text layer."); return; }
    const scope = activeCharacterPart || poseColourScope || "*";
    const scopeArg = scope === "*" ? "" : scope;
    const frame = frameAccessRef.current?.(colourItem.id);
    const rect = frame?.getBoundingClientRect();
    if (!frame || !rect || rect.width <= 0 || rect.height <= 0) return;
    type PlayerColours = Window & {
      cbColorAt?: (x: number, y: number, scope: string) => { picked: string; original: string } | null;
      cbColorPalette?: (scope: string) => { color: string; current: string }[];
      cbColorRelatives?: (hex: string, scope: string) => { strokes: string[]; shadows: string[] };
    };
    let original = "";
    let palette: { color: string; current: string }[] = [];
    let relatives = { strokes: [] as string[], shadows: [] as string[] };
    try {
      const player = frame.contentWindow as PlayerColours | null;
      original = normalizeHex(player?.cbColorAt?.((clientX - rect.left) / rect.width, (clientY - rect.top) / rect.height, scopeArg)?.original) || "";
      if (original) {
        palette = player?.cbColorPalette?.(scopeArg) || [];
        if (toneStroke || toneShadow) relatives = player?.cbColorRelatives?.(original, scopeArg) || relatives;
      }
    } catch { original = ""; }
    if (!original) { showNotice("No character colour there. Click on the character's artwork."); return; }
    const rules = colourItem.colorReplacements || [];
    const isTone = (rule: ColorReplacement) => rule.id.startsWith("tone-") && rule.scope === scope;
    // What a colour shows now: its own Light/Dark rule, else what the player draws.
    const currentOf = (from: string, target?: ColorReplacement["target"]) =>
      [...rules].reverse().find((rule) => isTone(rule) && rule.from === from && (!target || rule.target === target))?.to
      || normalizeHex(palette.find((entry) => entry.color === from)?.current) || from;
    const target: ColorReplacement["target"] = toneStroke ? "both" : "fill";
    const before = currentOf(original);
    const after = shiftLightness(before, delta);
    const changes: { from: string; to: string; target: ColorReplacement["target"] }[] = [{ from: original, to: after, target }];
    // Outlines and shadows follow the clicked colour's whole change from its original, so clicking
    // back to the original puts them back exactly.
    if (toneStroke) for (const stroke of relatives.strokes) changes.push({ from: stroke, to: shiftLike(stroke, original, after), target: "stroke" });
    if (toneShadow) for (const shadow of relatives.shadows) changes.push({ from: shadow, to: shiftLike(shadow, original, after), target });
    mutateColour((item) => {
      let list = item.colorReplacements || [];
      changes.forEach((change, index) => {
        // The colour clicked keeps one rule, whatever it covered before; the others one per target.
        list = list.filter((rule) => !(isTone(rule) && rule.from === change.from && (rule.target === change.target || change.from === original)));
        if (change.to !== change.from) list = [...list, { id: `tone-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 6)}`, from: change.from, to: change.to, target: change.target, scope, match: "exact" }];
      });
      item.colorReplacements = list;
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

  // Stage presses while picking: the dialogs' eyedroppers first, otherwise the Light/Dark tool or the
  // Colour Dropper.
  const handleStageColorPress = (clientX: number, clientY: number, modifiers: { altKey: boolean; shiftKey: boolean }) => {
    if (frPicking) { pickDialogColour(clientX, clientY); return; }
    if (boxPicking) { pickBoxColour(clientX, clientY); return; }
    if (activeTool === "tone") adjustTone(clientX, clientY, modifiers.altKey, modifiers.shiftKey);
    else if (activeTool === "eyedropper") void dropColour(clientX, clientY);
  };
  // Light/Dark and the Colour Dropper work on any click on the stage.
  const stageColourTool = activeTool === "tone" || activeTool === "eyedropper";

  // ---- Fill / Stroke boxes (Illustrator). What they hold depends on the selection:
  // text → its colour (no stroke); prop → its fill; nothing (or an empty layer) → the scene
  // background; character → an original colour of its artwork, in the part being edited if any.
  // Inside a pose, the colour tools work on the picked part ("@<pose class>/<object>"; set below once the pose view is known).
  const [poseColourScope, setPoseColourScope] = useState<string | null>(null);
  const boxScope = activeCharacterPart || poseColourScope || "*";
  const characterRulesKey = colourItem?.type === "character" ? JSON.stringify(colourItem.colorReplacements || []) : "";
  useEffect(() => {
    if (colourItem?.type !== "character") { setBoxPalette(null); return; }
    const objectId = colourItem.id, scope = boxScope;
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
  }, [colourItem?.id, colourItem?.type, boxScope, characterRulesKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setBoxPicking(false); }, [colourItem?.id]);

  type BoxState = { kind: "character" | "text" | "prop" | "background" | "none"; fill: string | null; stroke: string | null; fillOriginal?: string; strokeOriginal?: string };
  const boxState: BoxState = (() => {
    if (!colourItem || colourItem.type === "empty") return { kind: "background", fill: normalizeHex(draft?.background) || "#ffffff", stroke: null };
    if (colourItem.type === "text") return { kind: "text", fill: normalizeHex(colourItem.fillColor) || "#ffffff", stroke: null };
    if (colourItem.type === "prop") return { kind: "prop", fill: normalizeHex(colourItem.fillColor) || "#17343a", stroke: null };
    if (colourItem.type !== "character") return { kind: "none", fill: null, stroke: null };
    const entries = boxPalette?.key === `${colourItem.id}|${boxScope}` ? boxPalette.entries : [];
    const picks = boxPicks?.objectId === colourItem.id && boxPicks.scope === boxScope ? boxPicks : null;
    // What an original colour shows now: the last exact rule for it wins, as in the player.
    const currentOf = (original: string, box: "fill" | "stroke") => {
      const rule = [...(colourItem.colorReplacements || [])].reverse().find((item) => item.match !== "shades" && item.from === original
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
  /** A colour from the Fill / Stroke box. On a character, Include Stroke / Include Shadow (Fill/Stroke
   *  window) make the outlines and the darker shades that go with the colour (cbColorRelatives, as
   *  Light/Dark finds them) follow the change, each keeping its difference from the colour. */
  const applyBoxColour = (box: "fill" | "stroke", hex: string, effects?: { stroke: boolean; shadow: boolean }) => {
    if (boxState.kind === "background") mutate((data) => { data.background = hex; });
    else if ((boxState.kind === "text" || boxState.kind === "prop") && box === "fill") mutateSelected((item) => { item.fillColor = hex; });
    else if (boxState.kind === "character" && colourItem?.type === "character") {
      const original = box === "fill" ? boxState.fillOriginal : boxState.strokeOriginal;
      if (!original) return;
      let relatives = { strokes: [] as string[], shadows: [] as string[] };
      if (effects?.stroke || effects?.shadow) {
        try {
          const player = frameAccessRef.current?.(colourItem.id)?.contentWindow as (Window & { cbColorRelatives?: (hex: string, scope: string) => { strokes: string[]; shadows: string[] } }) | null | undefined;
          relatives = player?.cbColorRelatives?.(original, boxScope === "*" ? "" : boxScope) || relatives;
        } catch { /* player not reachable: the colour alone */ }
      }
      mutateColour((item) => {
        let rules = withBoxRule(item.colorReplacements || [], original, box, hex);
        if (effects?.stroke) for (const stroke of relatives.strokes) rules = withBoxRule(rules, stroke, "stroke", followColour(stroke, original, hex));
        if (effects?.shadow) for (const shadow of relatives.shadows) rules = withBoxRule(rules, shadow, box, followColour(shadow, original, hex));
        item.colorReplacements = rules;
      });
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
    if (colourItem?.type !== "character") return;
    const frame = frameAccessRef.current?.(colourItem.id);
    const rect = frame?.getBoundingClientRect();
    if (!frame || !rect || rect.width <= 0 || rect.height <= 0) return;
    try {
      const colorAt = (frame.contentWindow as (Window & { cbColorAt?: (x: number, y: number, scope: string) => { picked: string; original: string } | null }) | null)?.cbColorAt;
      const result = typeof colorAt === "function" ? colorAt((clientX - rect.left) / rect.width, (clientY - rect.top) / rect.height, boxScope === "*" ? "" : boxScope) : null;
      const original = normalizeHex(result?.original);
      if (!original) { showNotice("No character colour there. Click on the character's artwork."); return; }
      const objectId = colourItem.id;
      setBoxPicks((previous) => ({ ...(previous?.objectId === objectId && previous.scope === boxScope ? previous : {}), objectId, scope: boxScope, [activeBox]: original }));
    } catch { /* player not reachable */ }
  };

  // ---- Colour Dropper (i), Illustrator's Eyedropper: a click on the stage copies onto the selection.
  // Text selected + a click on another text layer → its colour, outline, shadow and type style. A
  // character selected + a click on its own artwork → that colour goes into the Fill / Stroke box (what
  // Fill/Stroke then changes); elsewhere → the box's colour becomes the colour clicked. Text and
  // pictures take the colour clicked; with nothing selected it becomes the stage background.
  const TEXT_STYLE_KEYS = ["fillColor", "textStrokeColor", "textStrokeWidth", "textShadowColor", "textShadow", "fontFamily", "fontSize", "fontWeight", "fontStyle", "fontUrl", "lineHeight", "letterSpacing", "textAlign"] as const;
  const dropColour = async (clientX: number, clientY: number) => {
    // The colour clicked, read from the scene drawn at the playhead (only when it is needed).
    const sample = async () => normalizeHex((await sampleStageColour(clientX, clientY)) || "");
    const objects = draftRef.current?.objects || [];
    const targets = selectedIdsRef.current.map((id) => objects.find((item) => item.id === id)).filter((item): item is EditorObject => Boolean(item) && !item!.locked);
    const source = textLayerAt(clientX, clientY);
    const texts = targets.filter((item) => item.type === "text" && item.id !== source?.id);
    if (source && texts.length) {
      mutate((data) => {
        for (const item of data.objects) {
          if (!texts.some((text) => text.id === item.id)) continue;
          for (const key of TEXT_STYLE_KEYS) {
            if (source[key] === undefined) delete item[key];
            else (item as Record<string, unknown>)[key] = source[key];
          }
        }
      });
      showNotice(`Copied the colour and type style of “${(source.text || source.name || "text").slice(0, 24)}”.`);
      return;
    }
    if (targets.length === 1 && targets[0].type === "character") {
      const character = targets[0];
      const frame = frameAccessRef.current?.(character.id);
      const rect = frame?.getBoundingClientRect();
      if (frame && rect && clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom) {
        try {
          const colorAt = (frame.contentWindow as (Window & { cbColorAt?: (x: number, y: number, scope: string) => { picked: string; original: string } | null }) | null)?.cbColorAt;
          const original = normalizeHex(typeof colorAt === "function" ? colorAt((clientX - rect.left) / rect.width, (clientY - rect.top) / rect.height, boxScope === "*" ? "" : boxScope)?.original : "");
          if (original) {
            setBoxPicks((previous) => ({ ...(previous?.objectId === character.id && previous.scope === boxScope ? previous : {}), objectId: character.id, scope: boxScope, [activeBox]: original }));
            showNotice(`${activeBox === "fill" ? "Fill" : "Stroke"} box: ${original}. Fill/Stroke (<) changes it.`);
            return;
          }
        } catch { /* player not reachable: use the colour clicked */ }
      }
      const hex = boxState[activeBox] ? await sample() : null;
      if (hex) applyBoxColour(activeBox, hex);
      else showNotice("Click one of the character's colours to choose it.");
      return;
    }
    const hex = await sample();
    if (!hex) return;
    const fillable = targets.filter((item) => item.type === "text" || item.type === "prop");
    if (fillable.length) {
      mutate((data) => { for (const item of data.objects) if (fillable.some((target) => target.id === item.id)) item.fillColor = hex; });
      return;
    }
    if (!targets.length) mutate((data) => { data.background = hex; });
  };

  // ---- Fill/Stroke (<): text → its colour with Include Stroke / Shadow; a character → the colour in its
  // Fill / Stroke box; a picture → its fill; nothing selected → the stage background.
  const openFillStroke = () => {
    if (editingTextRef.current || selected?.type === "text") { setTextFillStrokeOpen(true); return; }
    if (boxState.kind === "none") { showNotice("Fill/Stroke works on text, characters, pictures and the stage background."); return; }
    const box = boxState[activeBox] ? activeBox : "fill";
    if (!boxState[box]) { showNotice("Choose one of the character's colours first: Colour Dropper (i), then click it."); return; }
    setActiveBox(box);
    setBoxPicker(box);
  };

  // ---- Adjust colour (⌘J). Opening keeps each layer's colours as they are (`base`) and, for a
  // character, its palette (every original colour and what it shows now). Preview writes the result
  // over the base without an undo step; Create writes it once (one undo step); Cancel puts it back.
  type AdjustState = NonNullable<typeof adjust>;
  const openAdjust = () => {
    const objects = draftRef.current?.objects || [];
    const ids = selectedIdsRef.current.length ? selectedIdsRef.current : poseOwnerId ? [poseOwnerId] : [];
    const items = ids.map((id) => objects.find((item) => item.id === id))
      .filter((item): item is EditorObject => Boolean(item) && !item!.locked && (item!.type === "character" || item!.type === "text"));
    if (!items.length) { showNotice("Select a character or a text layer to adjust its colours."); return; }
    const scope = items.length === 1 ? activeCharacterPart || poseColourScope || "*" : "*";
    const base: AdjustState["base"] = {};
    const palettes: AdjustState["palettes"] = {};
    for (const item of items) {
      base[item.id] = { colorReplacements: item.colorReplacements?.map((rule) => ({ ...rule })), fillColor: item.fillColor, textStrokeColor: item.textStrokeColor, textShadowColor: item.textShadowColor };
      if (item.type !== "character") continue;
      try {
        const list = (frameAccessRef.current?.(item.id)?.contentWindow as (Window & { cbColorPalette?: (scope: string) => AdjustState["palettes"][string]["entries"] }) | null | undefined)?.cbColorPalette?.(scope === "*" ? "" : scope);
        if (Array.isArray(list) && list.length) palettes[item.id] = { scope, entries: list.map((entry) => ({ ...entry })) };
      } catch { /* player not reachable */ }
    }
    if (items.every((item) => item.type === "character" && !palettes[item.id])) { showNotice("The character is still loading. Try again in a moment."); return; }
    const label = items.length > 1 ? `${items.length} layers` : scope.startsWith("@") ? `${items[0].name} · ${scope.includes("+") ? `${scope.split("+").length} parts` : symbolLevelNow?.data.layers.find((layer) => (layer.props || []).includes(scope.split("/").pop() || ""))?.name || "part"}` : scope !== "*" ? `${items[0].name} · ${partLabel(items[0], scope)}` : items[0].type === "text" ? (items[0].text || items[0].name || "Text").slice(0, 32) : items[0].name;
    setAdjust({ ids: items.map((item) => item.id), label, hasShadow: items.some((item) => item.type === "text"), base, palettes });
  };
  const adjustPatches = (state: AdjustState, settings: AdjustSettings) => {
    const patches: Record<string, Partial<EditorObject>> = {};
    if (isIdentity(settings)) return patches;
    for (const id of state.ids) {
      const base = state.base[id];
      const palette = state.palettes[id];
      if (palette) {
        const target: ColorReplacement["target"] | null = settings.fill && settings.stroke ? "both" : settings.fill ? "fill" : settings.stroke ? "stroke" : null;
        if (!target) continue;
        let rules = [...(base.colorReplacements || [])];
        palette.entries.forEach((entry, index) => {
          if (target === "fill" ? !entry.fills : target === "stroke" ? !entry.strokes : !entry.fills && !entry.strokes) return;
          const current = normalizeHex(entry.current) || entry.color;
          const to = adjustHex(current, settings);
          if (to === current) return;
          rules = rules.filter((rule) => !(rule.from === entry.color && rule.scope === palette.scope && rule.target === target && rule.match === "exact"));
          rules.push({ id: `adjust-${Date.now()}-${index}`, from: entry.color, to, target, scope: palette.scope, match: "exact" });
        });
        patches[id] = { colorReplacements: rules };
        continue;
      }
      const patch: Partial<EditorObject> = {};
      if (settings.fill) patch.fillColor = adjustHex(normalizeHex(base.fillColor) || "#ffffff", settings);
      if (settings.stroke && base.textStrokeColor) patch.textStrokeColor = adjustHex(normalizeHex(base.textStrokeColor) || "#000000", settings);
      if (settings.shadow && base.textShadowColor) patch.textShadowColor = adjustHex(normalizeHex(base.textShadowColor) || "#000000", settings);
      patches[id] = patch;
    }
    return patches;
  };
  /** The layers as they were when Adjust colour opened, with `patches` on top; no undo step. */
  const showAdjusted = (state: AdjustState, patches: Record<string, Partial<EditorObject>>) => {
    setDraft((current) => (current ? { ...current, objects: current.objects.map((item) => (state.base[item.id] ? { ...item, ...state.base[item.id], ...patches[item.id] } : item)) } : current));
  };
  const previewAdjust = (settings: AdjustSettings | null) => { if (adjust) showAdjusted(adjust, settings ? adjustPatches(adjust, settings) : {}); };
  const cancelAdjust = () => { if (adjust) showAdjusted(adjust, {}); setAdjust(null); };
  const createAdjust = (settings: AdjustSettings) => {
    if (!adjust) return;
    const patches = adjustPatches(adjust, settings);
    showAdjusted(adjust, {});
    if (Object.keys(patches).length) mutate((data) => { for (const item of data.objects) if (patches[item.id]) Object.assign(item, patches[item.id]); });
    setAdjust(null);
  };

  // The Colour palette's keys (Light/Dark ⌘L, Fill/Stroke <, Adjust colour ⌘J, Colour Dropper i).
  const colourActionsRef = useRef({ lightDark: () => undefined as void, fillStroke: () => undefined as void, adjust: () => undefined as void, dropper: () => undefined as void });
  colourActionsRef.current = {
    lightDark: () => { setActiveTool((tool) => (tool === "tone" ? "select" : "tone")); setRailHighlight("colour"); },
    fillStroke: openFillStroke,
    adjust: openAdjust,
    dropper: () => { setActiveTool("eyedropper"); setRailHighlight("colour"); },
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
    // Another object (or none) leaves the character it was inside.
    if (id !== useEditorStore.getState().selectedObjectId) { setCharacterIsolated(false); setEnteredGroupId(null); }
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
    setCharacterIsolated(false);
    setEnteredGroupId(null);
  }, [selectEditorObject, setSelection]);

  // ---- Inside a character, Illustrator style. The level you are in (the container): the character
  // itself (""), an entered part ("head"), or the part a selected piece sits in. A click on empty
  // canvas deselects but stays in that level; a double-click there, Esc or ⇦ go out one level.
  const containerOfPart = (part: string | null, entered: boolean) => {
    if (!part) return "";
    if (entered) return part;
    const parents = Array.from(new Set(partMembers(part).map(parentPartKey)));
    return parents.length === 1 ? parents[0] : "";
  };
  const isolationEmptyClick = useCallback(() => {
    const { part, entered } = partLevelRef.current;
    if (!part || entered) return;
    if (enteredGroupRef.current) { setActiveCharacterPart(null); setPartReplacementBrowserOpen(false); return; }
    const container = containerOfPart(part, false);
    setActiveCharacterPart(container || null);
    setPartReplacementBrowserOpen(Boolean(container));
  }, []);
  const stepOutPartIsolation = useCallback(() => {
    const { part, entered } = partLevelRef.current;
    if (enteredGroupRef.current) {
      const group = (isolatedObjectRef.current?.partGroups || []).find((item) => item.id === enteredGroupRef.current);
      setEnteredGroupId(null);
      setActiveCharacterPart(group ? group.members.join("|") : null);
      setPartReplacementBrowserOpen(false);
      return;
    }
    if (part && entered) { setPartReplacementBrowserOpen(false); return; }
    if (part) {
      const container = containerOfPart(part, false);
      if (container) { setActiveCharacterPart(container); setPartReplacementBrowserOpen(false); return; }
      setActiveCharacterPart(null);
    }
    setPartReplacementBrowserOpen(false);
    setCharacterIsolated(false);
  }, []);
  /** The isolation bar: back to the character (""), or into a part on the path. */
  const goToPartLevel = useCallback((level: string) => {
    setEnteredGroupId(null);
    setActiveCharacterPart(level || null);
    setPartReplacementBrowserOpen(Boolean(level));
    setCharacterIsolated(true);
  }, []);
  /** Shift+click: adds the part (or its whole group) to the selection, or takes it out. */
  const togglePartSelection = useCallback((partKey: CharacterPartKey) => {
    const group = groupForPart(isolatedObjectRef.current, partKey, enteredGroupRef.current);
    const { part, entered } = partLevelRef.current;
    setActiveCharacterPart(togglePartKey(entered ? null : part, group ? group.members.join("|") : partKey));
    setPartReplacementBrowserOpen(false);
    setCharacterIsolated(true);
  }, []);
  /** Drag-select inside a character: every part the box touched (Shift adds to the selection). */
  const selectPartsInBox = useCallback((keys: CharacterPartKey[], additive: boolean) => {
    const object = isolatedObjectRef.current;
    const picked = keys.flatMap((key) => groupForPart(object, key, enteredGroupRef.current)?.members || [key]);
    const { part, entered } = partLevelRef.current;
    const next = joinPartKeys([...(additive && !entered ? partMembers(part) : []), ...picked]);
    if (!next && !additive) { isolationEmptyClick(); return; }
    if (next) { setActiveCharacterPart(next); setPartReplacementBrowserOpen(false); }
  }, [isolationEmptyClick]);

  // ---- Animate frame timeline: frame selection, keyframe/frame commands, empty layers.
  const [frameSelection, setFrameSelection] = useState<FrameSelection>(null);
  const frameSelectionRef = useRef<FrameSelection>(null);
  frameSelectionRef.current = frameSelection;
  // Frames selected because something was picked on the canvas (not on the timeline): Delete then
  // removes the object, and F5 / F6 / F7 work at the playhead, as in Animate.
  const frameSelectionFromCanvasRef = useRef(false);
  const playheadRef = useRef(playhead);
  playheadRef.current = playhead;

  const selectFrames = useCallback((selection: FrameSelection) => {
    frameSelectionFromCanvasRef.current = false;
    setFrameSelection(selection);
    if (!selection) return;
    setPlaying(false);
    // The selected layers are selected on the canvas too (every object of a layer that holds several).
    const ids = Array.from(new Set(selectionLayerIds(selection).flatMap((key) => {
      const members = rowMembersOf(draft?.objects || [], key).map((item) => item.id);
      return members.length ? members : [key];
    })));
    if (ids.length > 1) {
      const current = selectedIdsRef.current;
      if (current.length !== ids.length || ids.some((id) => !current.includes(id))) changeSelection(ids);
    } else if (selectedObjectId !== ids[0]) selectEditorObject(ids[0]);
    // The playhead follows the selection but never goes past the last frame.
    setPlayhead(Math.min(duration, selection.from / TIMELINE_FPS));
  }, [changeSelection, draft, duration, selectEditorObject, selectedObjectId, setPlaying]);
  // Picking something on the canvas ends the frame selection (Delete then removes objects again).
  // Animate: whatever is picked on the canvas (an object, a character, a part in it) selects all
  // frames of its layer on the timeline; the playhead stays where it is.
  const layerFramesSelection = useCallback((ids: string[]): FrameSelection => {
    const fps = TIMELINE_FPS;
    const lastSceneFrame = Math.max(0, Math.ceil(duration * fps - 1e-6) - 1);
    const picked = new Set(ids);
    const objects = draft?.objects || [];
    const rows = [...objects].reverse().filter((item) => picked.has(item.id));
    if (!rows.length) return null;
    // Rows: a layer, or a whole ⌘G group (its one row) unless the group is entered.
    const keyOf = (item: EditorObject) => rowKeyOf(item, enteredObjectGroupRef.current);
    const keys = Array.from(new Set(rows.map(keyOf)));
    const members = objects.filter((item) => keys.includes(keyOf(item)) && item.type !== "empty");
    if (!members.length) return { layerId: keys[0], ...(keys.length > 1 ? { layerIds: keys } : {}), from: 0, to: lastSceneFrame };
    const spans = members.map((item) => {
      const start = Math.max(0, Number(item.startTime || 0));
      const startFrame = Math.round(start * fps);
      return { from: startFrame, to: item.actionDurationMs ? Math.max(startFrame, Math.round((start + item.actionDurationMs / 1000) * fps) - 1) : Math.max(startFrame, lastSceneFrame) };
    });
    return { layerId: keys[0], ...(keys.length > 1 ? { layerIds: keys } : {}), from: Math.min(...spans.map((span) => span.from)), to: Math.max(...spans.map((span) => span.to)) };
  }, [draft, duration]);
  /** A pick on the canvas takes whole ⌘G groups (not the group that was entered); picking
   *  something outside the entered group leaves it. */
  const withObjectGroups = useCallback((ids: string[]) => {
    const objects = draftRef.current?.objects || [];
    const groupOf = (id: string) => objects.find((item) => item.id === id)?.group;
    let entered = enteredObjectGroupRef.current;
    if (entered && ids.some((id) => groupOf(id) !== entered)) { entered = null; enteredObjectGroupRef.current = null; setEnteredObjectGroup(null); }
    const groups = new Set(ids.map(groupOf).filter((group): group is string => Boolean(group) && group !== entered));
    const members = objects.filter((item) => item.group && groups.has(item.group) && !item.locked).map((item) => item.id);
    return Array.from(new Set([...ids, ...members]));
  }, []);
  const selectFromCanvas = useCallback((id: string | null) => {
    const ids = id ? withObjectGroups([id]) : [];
    if (ids.length > 1) changeSelection(ids);
    else selectEditorObject(id);
    const selection = ids.length ? layerFramesSelection(ids) : null;
    frameSelectionFromCanvasRef.current = Boolean(selection);
    setFrameSelection(selection);
  }, [changeSelection, layerFramesSelection, selectEditorObject, withObjectGroups]);
  const changeSelectionFromCanvas = useCallback((picked: string[]) => {
    const ids = withObjectGroups(picked);
    changeSelection(ids);
    const selection = ids.length ? layerFramesSelection(ids) : null;
    frameSelectionFromCanvasRef.current = Boolean(selection);
    setFrameSelection(selection);
  }, [changeSelection, layerFramesSelection, withObjectGroups]);
  /** Double-click on a group: go inside it, with the clicked object picked. */
  const enterObjectGroup = useCallback((group: string, id: string) => {
    enteredObjectGroupRef.current = group;
    setEnteredObjectGroup(group);
    selectFromCanvas(id);
  }, [selectFromCanvas]);
  /** Esc / double-click on empty canvas inside a group: out of it, with the whole group picked. */
  const stepOutObjectGroup = useCallback(() => {
    const group = enteredObjectGroupRef.current;
    enteredObjectGroupRef.current = null;
    setEnteredObjectGroup(null);
    const members = (draftRef.current?.objects || []).filter((item) => group && item.group === group && !item.locked).map((item) => item.id);
    if (members.length) changeSelectionFromCanvas(members);
  }, [changeSelectionFromCanvas]);
  /** A group's registration point dragged on the canvas (where it is drawn now). With motion, the
   *  keyframes are adjusted so the group stays where it is (lib/groupMotion.ts movePivot). */
  const setGroupPivot = useCallback((group: string, x: number, y: number) => {
    mutate((data) => {
      const motion = groupMotionIn(data.objects, group) || {};
      if (motion.pivotX == null || motion.pivotY == null || !(motion.keyframes || []).length) { writeGroupMotion(data.objects, group, { ...motion, pivotX: x, pivotY: y }); return; }
      const own = removeGroupPose({ x, y, rotation: 0, scale: 1 }, motion, resolveGroupPose(motion, playhead));
      writeGroupMotion(data.objects, group, movePivot(motion, own.x, own.y));
    });
  }, [mutate, playhead]);
  /** The group row on the timeline (its ⤵ button, or a double-click on its frames): go inside it. */
  const enterGroupRow = useCallback((key: string) => {
    if (!isGroupRow(key)) return;
    enteredObjectGroupRef.current = groupOfRow(key);
    setEnteredObjectGroup(groupOfRow(key));
    selectEditorObject(null);
    frameSelectionFromCanvasRef.current = false;
    setFrameSelection(null);
  }, [selectEditorObject]);
  // The entered group ends when its objects are gone or something outside it gets selected.
  useEffect(() => {
    if (!enteredObjectGroup) return;
    const objects = draft?.objects || [];
    if (!objects.some((item) => item.group === enteredObjectGroup)
      || selectedObjectIds.some((id) => objects.find((item) => item.id === id)?.group !== enteredObjectGroup)) setEnteredObjectGroup(null);
  }, [draft, enteredObjectGroup, selectedObjectIds]);

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
  // Keys for the part picked inside a pose (set where the pose's editing code lives, further down).
  const symbolNudgeRef = useRef<((dx: number, dy: number) => boolean) | null>(null);
  const symbolDeleteRef = useRef<(() => boolean) | null>(null);
  const symbolDuplicateRef = useRef<(() => boolean) | null>(null);
  const symbolPoseKeyRef = useRef<((event: KeyboardEvent) => boolean) | null>(null);
  const symbolContextClipRef = useRef<((action: string) => void) | null>(null);
  const symbolFlipRef = useRef<((axis: "h" | "v") => boolean) | null>(null);
  const symbolGroupRef = useRef<((ungroup: boolean) => boolean) | null>(null);
  const symbolPivotResetRef = useRef<(() => boolean) | null>(null);
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

  // Undo and redo take their step on the first run of the updater and give the same result if React runs it again (development).
  const undo = useCallback(() => {
    let step: EditorData | null | undefined;
    setDraft((current) => {
      if (!current) return current;
      if (step === undefined) {
        if (historyPastRef.current.length === 0) step = null;
        else {
          step = historyPastRef.current.pop()!;
          historyFutureRef.current.push(clone(current));
          setDirty(true);
        }
      }
      return step ?? current;
    });
  }, []);

  const redo = useCallback(() => {
    let step: EditorData | null | undefined;
    setDraft((current) => {
      if (!current) return current;
      if (step === undefined) {
        if (historyFutureRef.current.length === 0) step = null;
        else {
          step = historyFutureRef.current.pop()!;
          historyPastRef.current.push(clone(current));
          setDirty(true);
        }
      }
      return step ?? current;
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
        const selection = frameSelectionFromCanvasRef.current ? null : frameSelectionRef.current;
        // Nothing picked on the timeline: every selected object (all of a group) at the playhead.
        const objects = draftRef.current?.objects || [];
        const layerIds = selection ? selectionLayerIds(selection) : Array.from(new Set(selectedIdsRef.current.map((id) => {
          const item = objects.find((object) => object.id === id);
          return item ? rowKeyOf(item, enteredObjectGroupRef.current) : id;
        })));
        if (!layerIds.length) { showNotice("Select a layer or a frame on the timeline first"); return; }
        const frame = selection ? selection.from : Math.floor(playheadRef.current * TIMELINE_FPS + 1e-6);
        frameActionRef.current(action, layerIds, frame, selection ? selection.to : frame);
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
        setRailHighlight("edit");
        return;
      }
      if (plainKey && event.key.toLowerCase() === "q") {
        // Free Transform is part of the Selection tool now; Q keeps working as a shortcut to it.
        event.preventDefault();
        setActiveTool("select");
        setRailHighlight("edit");
        return;
      }
      if (plainKey && !event.shiftKey && event.key.toLowerCase() === "t") {
        // Text tool (Illustrator T); then Return opens the Text panel.
        event.preventDefault();
        setActiveTool("text");
        setRailHighlight("text");
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
        setRailHighlight("edit");
        return;
      }
      if (plainKey && !event.shiftKey && event.key.toLowerCase() === "s") {
        // Illustrator's Scale tool (Cmd+S stays Save: plainKey excludes modifiers).
        event.preventDefault();
        setActiveTool("scale");
        setRailHighlight("edit");
        return;
      }
      // Colour palette: Colour Dropper (i) and Fill/Stroke (<).
      if (plainKey && !event.shiftKey && event.key.toLowerCase() === "i") {
        event.preventDefault();
        colourActionsRef.current.dropper();
        return;
      }
      if (plainKey && event.key === "<") {
        event.preventDefault();
        colourActionsRef.current.fillStroke();
        return;
      }
      if (event.key === "Escape" && !activeCharacterPart) setActiveTool((tool) => (tool === "scale" || tool === "tone" || tool === "eyedropper" || tool === "reflect" || tool === "zoom" || tool === "text" ? "select" : tool));

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
      // File menu: ⌘R / ⌘I import to stage, ⇧⌘O external library, ⌘E export, ⌘N new file (⌥⌘N in the
      // browser: Chrome keeps ⌘N for a new window). ⌘R is taken from the browser's reload here.
      if (commandOrControl && !event.altKey && !event.shiftKey && event.code === "KeyR") {
        event.preventDefault();
        fileActionsRef.current.importFile();
        return;
      }
      if (commandOrControl && !event.altKey && event.shiftKey && event.code === "KeyO") {
        event.preventDefault();
        fileActionsRef.current.externalLibrary();
        return;
      }
      if (commandOrControl && !event.altKey && !event.shiftKey && event.code === "KeyI") {
        event.preventDefault();
        fileActionsRef.current.importFile();
        return;
      }
      if (commandOrControl && !event.altKey && !event.shiftKey && event.code === "KeyE") {
        event.preventDefault();
        fileActionsRef.current.exportVideo();
        return;
      }
      if (commandOrControl && !event.shiftKey && event.code === "KeyN" && (event.altKey || /Electron/i.test(navigator.userAgent))) {
        event.preventDefault();
        fileActionsRef.current.newFile();
        return;
      }
      // Transform panel: ⌥⌘T (Chrome keeps ⌘T for a new tab); the desktop app also takes ⌘T.
      if (commandOrControl && event.code === "KeyT" && !event.shiftKey && (event.altKey || /Electron/i.test(navigator.userAgent))) {
        event.preventDefault();
        transformToggleRef.current();
        return;
      }
      if (commandOrControl && event.shiftKey && !event.altKey && (event.code === "KeyL" || event.code === "KeyC" || event.code === "KeyR")
        && (!isEditableTarget(event.target) || (event.target as HTMLElement).closest?.(".cb-stage-text-editing"))) {
        if (textAlignRef.current(event.code === "KeyL" ? "left" : event.code === "KeyC" ? "center" : "right")) { event.preventDefault(); event.stopImmediatePropagation(); return; }
      }
      // Colour palette: Light/Dark (⌘L) and Adjust colour (⌘J).
      if (commandOrControl && !event.altKey && !event.shiftKey && (event.code === "KeyL" || event.code === "KeyJ") && !isEditableTarget(event.target)
        && !document.querySelector('[role="dialog"][aria-modal="true"]')) {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (event.code === "KeyL") colourActionsRef.current.lightDark();
        else colourActionsRef.current.adjust();
        return;
      }
      if (!commandOrControl || isEditableTarget(event.target)) return;

      if (symbolPoseKeyRef.current?.(event)) { event.preventDefault(); event.stopImmediatePropagation(); return; }
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
      // Arrange: Cmd+Shift+Up / Down = front / back, Cmd+Up / Down = one step.
      if (!event.altKey && (event.key === "ArrowUp" || event.key === "ArrowDown") && selectedIdsRef.current.length > 0) {
        event.preventDefault();
        event.stopImmediatePropagation();
        const up = event.key === "ArrowUp";
        clipboardActionsRef.current.arrange(event.shiftKey ? (up ? "front" : "back") : (up ? "forward" : "backward"));
        return;
      }
      // Paste in Front (Cmd+F) / in Back (Cmd+B), in place.
      if (!event.altKey && !event.shiftKey && (event.code === "KeyF" || event.code === "KeyB") && !document.querySelector('[role="dialog"][aria-modal="true"]')) {
        event.preventDefault();
        event.stopImmediatePropagation();
        clipboardActionsRef.current.paste(true, event.code === "KeyF" ? "front" : "back");
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

  // ---- Text tool (Illustrator point type, horizontal) and the Text panel. Click the stage with the
  // Text tool (T) to type new text there, or click / double-click text to type into it; Esc ends.
  // While typing, the first change is the undo step and a colour palette sits beside the text.
  const [editingText, setEditingText] = useState<{ id: string; clientX?: number; clientY?: number; nonce: number } | null>(null);
  const editingTextRef = useRef(editingText);
  editingTextRef.current = editingText;
  const [textPanelOpen, setTextPanelOpen] = useState(false);
  const textRailRef = useRef<HTMLButtonElement>(null);
  const textSizeRef = useRef<((id: string) => { width: number; height: number } | null) | null>(null);
  // The Text panel's settings for the next text typed (Illustrator keeps the last ones used).
  const [textDefaults, setTextDefaults] = useState<TextValues & { fillColor?: string }>({
    fontFamily: "Arial", fontWeight: 400, fontStyle: "normal", fontSize: 52, textAlign: "left", letterSpacing: 0, fillColor: "#000000",
  });
  const [teamFonts, setTeamFonts] = useState<TeamFont[]>([]);
  useEffect(() => { void api.listFonts().then(setTeamFonts).catch(() => setTeamFonts([])); }, []);
  const installedFamilies = useMemo(() => [
    ...BUILTIN_FAMILIES,
    ...teamFamilies(teamFonts).filter((family) => !BUILTIN_FAMILIES.some((builtin) => builtin.name === family.name)),
  ], [teamFonts]);
  // Uploaded fonts (from someone's computer) used by this scene's text.
  useEffect(() => {
    for (const object of draft?.objects || []) {
      if (object.type === "text" && object.fontUrl && object.fontFamily) ensureFontFace(object.fontFamily, object.fontWeight ?? 400, object.fontStyle === "italic", object.fontUrl);
    }
  }, [draft]);
  const selectedText = selected?.type === "text" && selectedObjectIds.length <= 1 ? selected : null;
  const editingLayer = editingText ? draft?.objects.find((item) => item.id === editingText.id) || null : null;
  const textTarget = editingLayer || selectedText;

  // Point text keeps its anchor (left / middle / right of the first line) still while it is typed
  // into or restyled, including when a font arrives later (lib/textStyle keepTextAnchor).
  const anchorTrackRef = useRef<{ id: string; width: number; height: number; align: "left" | "center" | "right" } | null>(null);
  const [fontsLoadedTick, setFontsLoadedTick] = useState(0);
  useEffect(() => {
    const loaded = () => setFontsLoadedTick((tick) => tick + 1);
    document.fonts?.addEventListener?.("loadingdone", loaded);
    return () => document.fonts?.removeEventListener?.("loadingdone", loaded);
  }, []);
  useLayoutEffect(() => {
    const object = textTarget?.type === "text" ? draft?.objects.find((item) => item.id === textTarget.id) : null;
    if (!object) { anchorTrackRef.current = null; return; }
    const size = textSizeRef.current?.(object.id);
    if (!size) return;
    const align = object.textAlign || "center";
    const track = anchorTrackRef.current;
    anchorTrackRef.current = { id: object.id, ...size, align };
    if (!track || track.id !== object.id || (track.width === size.width && track.height === size.height && track.align === align)) return;
    const next = keepTextAnchor(object, track, size, track.align, align);
    if (Math.abs(next.x - object.x) < 0.01 && Math.abs(next.y - object.y) < 0.01) return;
    setDirty(true);
    setDraft((current) => (current ? { ...current, objects: current.objects.map((item) => (item.id === object.id ? { ...item, x: next.x, y: next.y } : item)) } : current));
  }, [draft, textTarget?.id, fontsLoadedTick]);

  // The canvas eyedropper (every colour picker) draws the scene at the playhead through this.
  const playheadNowRef = useRef(playhead);
  playheadNowRef.current = playhead;
  useEffect(() => {
    setStageRenderer(async (scale) => {
      const data = draftRef.current;
      const current = useEditorStore.getState().project;
      if (!data || !current) return null;
      return renderStage(data, current.width, current.height, {
        width: current.width * scale, seconds: playheadNowRef.current, characterCap: 4096,
        elementFor: (id) => document.querySelector<HTMLElement>(`.cb-stage-world [data-editor-object-id="${CSS.escape(id)}"]`),
      });
    });
    return () => setStageRenderer(null);
  }, []);

  /** Ends typing; empty text is removed. Esc also goes back to the Selection tool (Illustrator). */
  const endTextEdit = (toSelection: boolean) => {
    const current = editingTextRef.current;
    if (!current) return;
    editingTextRef.current = null;
    setEditingText(null);
    scrubHistoryRef.current = "idle";
    const object = draftRef.current?.objects.find((item) => item.id === current.id);
    if (object && !(object.text || "").trim()) {
      setDraft((data) => (data ? { ...data, objects: data.objects.filter((item) => item.id !== current.id) } : data));
      selectObject(null);
    }
    if (toSelection) { setActiveTool("select"); setRailHighlight("edit"); }
  };
  const startTextEdit = (id: string, clientX?: number, clientY?: number) => {
    if (editingTextRef.current && editingTextRef.current.id !== id) endTextEdit(false);
    selectObject(id);
    setActiveCharacterPart(null);
    scrubHistoryRef.current = "armed"; // the first change while typing is one undo step
    setEditingText({ id, clientX, clientY, nonce: Date.now() });
  };
  const createTextAt = (x: number, y: number) => {
    if (!project) return;
    endTextEdit(false);
    const defaults = textDefaults;
    const object: EditorObject = {
      id: `text-${Date.now()}`, type: "text", name: "Text", text: "", x, y, scale: 1, rotation: 0, opacity: 1, startTime: 0,
      fillColor: defaults.fillColor || "#000000", fontFamily: defaults.fontFamily, fontWeight: defaults.fontWeight, fontStyle: defaults.fontStyle,
      fontUrl: defaults.fontUrl, fontSize: defaults.fontSize, lineHeight: defaults.lineHeight, letterSpacing: defaults.letterSpacing,
      textAlign: defaults.textAlign || "left", textShadow: false,
    };
    mutate((data) => placeInLayer(data, object, selectedIdsRef.current[0]));
    selectObject(object.id);
    scrubHistoryRef.current = "recorded"; // adding the text was the undo step
    setEditingText({ id: object.id, nonce: Date.now() });
  };
  const addText = () => { if (project) createTextAt(project.width / 2, project.height / 2); };
  const typeText = (id: string, text: string) => {
    mutate((data) => { const item = data.objects.find((object) => object.id === id); if (item) item.text = text; });
  };
  /** Text panel / palette change: the text being typed or the selected text layer, and the defaults. */
  const applyTextPatch = (patch: Partial<EditorObject>) => {
    setTextDefaults((current) => ({ ...current, ...patch }));
    const id = editingTextRef.current?.id || (selected?.type === "text" ? selected.id : null);
    if (!id) return;
    mutate((data) => { const item = data.objects.find((object) => object.id === id); if (item) Object.assign(item, patch); });
  };
  const pickFontFace = async (family: FontFamilyInfo, face: FontFaceInfo) => {
    let fontUrl = face.url;
    if (family.source === "system" && face.postscriptName && project) {
      try {
        showNotice(`Adding ${family.name} to the project…`);
        fontUrl = await uploadSystemFont(project.id, face.postscriptName, teamFonts);
        void api.listFonts().then(setTeamFonts).catch(() => undefined);
      } catch (error) { showNotice(error instanceof Error ? error.message : "The font could not be added", "error"); return; }
    }
    if (fontUrl) ensureFontFace(family.name, face.weight, face.italic, fontUrl);
    applyTextPatch({ fontFamily: family.name, fontWeight: face.weight, fontStyle: face.italic ? "italic" : "normal", fontUrl });
  };
  const textAlignRef = useRef<(align: "left" | "center" | "right") => boolean>(() => false);
  textAlignRef.current = (align) => {
    if (!editingTextRef.current && selected?.type !== "text" && !textPanelOpen) return false;
    applyTextPatch({ textAlign: align });
    return true;
  };
  useEscClose(Boolean(editingText), () => endTextEdit(true));
  // A press outside the text (and outside the Text panel, palette and colour picker) ends typing.
  useEffect(() => {
    if (!editingText) return;
    const press = (event: PointerEvent) => {
      if ((event.target as HTMLElement | null)?.closest?.(".cb-stage-text-editing, [data-text-ui], .cb-cp-backdrop")) return;
      endTextEdit(false);
    };
    document.addEventListener("pointerdown", press, true);
    return () => document.removeEventListener("pointerdown", press, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingText]);

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

  /** Moves given where the objects are drawn: a whole ⌘G group's move goes into its motion; any
   *  other object is moved itself (a keyframed character at its keyframe). */
  const moveInto = (data: EditorData, moves: Array<{ id: string; x: number; y: number }>) => {
    const handled = applyWholeGroupEdits(data, moves.map(({ id, x, y }) => ({ id, patch: { x, y } })), playhead, enteredObjectGroupRef.current);
    const byId = new Map(moves.map((entry) => [entry.id, entry]));
    for (const item of data.objects) {
      const target = byId.get(item.id);
      if (!target || handled.has(item.id)) continue;
      const own = toOwnPatch(item, { x: target.x, y: target.y }, playhead);
      if (item.type === "character" && (item.keyframes || []).length > 0) moveKeyframedPosition(item, playhead, own.x!, own.y!);
      else { item.x = own.x!; item.y = own.y!; }
    }
  };
  const moveObject = useCallback((id: string, x: number, y: number) => {
    mutate((data) => moveInto(data, [{ id, x, y }]));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mutate, playhead]);

  /** Option/Alt + drag (Illustrator): a copy stays where the layers were, directly below them; the
   *  dragged layers move and stay selected on top. One edit, so one undo step. */
  const duplicateMovedObjects = useCallback((moves: Array<{ id: string; x: number; y: number }>) => {
    const byId = new Map(moves.map((entry) => [entry.id, entry]));
    const stamp = Date.now();
    mutate((data) => {
      const copies: EditorObject[] = [];
      data.objects = data.objects.flatMap((item, index) => {
        if (!byId.has(item.id)) return [item];
        const copy = clone(item);
        copy.id = `${String(item.id).split("-copy-")[0]}-copy-${stamp}${index}`;
        copies.push(copy);
        return [copy, item];
      });
      // The copies get groups of their own first, so a moved group's motion is not theirs.
      retagCopies(copies, stamp);
      moveInto(data, moves);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mutate, playhead]);

  /** Multi-selection drag: every moved layer is committed in one edit (one undo step). */
  const moveObjects = useCallback((moves: Array<{ id: string; x: number; y: number }>) => {
    mutate((data) => moveInto(data, moves));
  // eslint-disable-next-line react-hooks/exhaustive-deps
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
    // Where the objects are drawn now; several turn and scale about one point: a whole ⌘G group's
    // registration point, else the selection's centre. The commit sorts out group motion.
    const states = (draft?.objects || [])
      .filter((item) => ids.has(item.id) && item.type !== "background" && item.type !== "audio")
      .map((item) => ({ item, current: resolveObjectTransformAtTime(item, playhead) }));
    if (!states.length) return;
    const xs = states.map((state) => state.current.x);
    const ys = states.map((state) => state.current.y);
    const group = states[0].item.group;
    const wholeGroup = group && group !== enteredObjectGroup && (draft?.objects || []).filter((item) => item.group === group && !item.locked).every((item) => ids.has(item.id));
    const pivot = (wholeGroup && groupPivotAtTime(states[0].item.groupMotion, playhead))
      || { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 };
    transformObjectsRef.current(states.map(({ item, current }) => {
      let x = current.x;
      let y = current.y;
      if (states.length > 1) {
        // Positions scale and turn (clockwise, like Animate) around that point.
        const dx = (current.x - pivot.x) * factor;
        const dy = (current.y - pivot.y) * factor;
        x = pivot.x + dx * cos - dy * sin;
        y = pivot.y + dx * sin + dy * cos;
      }
      return { id: item.id, patch: { x, y, scale: Math.min(20, Math.max(0.02, Number(current.scale || 1) * factor)), rotation: wrapDegrees(Number(current.rotation || 0) + rotateDegrees) } };
    }));
    // transformCharacterPart is declared below; it only depends on mutate and playhead (listed here).
  }, [activeCharacterPart, draft, enteredObjectGroup, mutate, playhead, selectedObjectIds]); // eslint-disable-line react-hooks/exhaustive-deps

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
  // Body parts selected inside a character: they are copied as a part layer (a copy of the
  // character that draws only those parts, with their animation and edits).
  const selectedPartsForClipboard = () => {
    const object = draft?.objects.find((item) => item.id === selectedObjectId);
    if (!object || object.type !== "character" || !activeCharacterPart || partReplacementBrowserOpen) return null;
    return { object, keys: partMembers(activeCharacterPart) };
  };
  const copyParts = (): boolean => {
    const picked = selectedPartsForClipboard();
    if (!picked) return false;
    const { object, keys } = picked;
    const layer: EditorObject = { ...clone(object), name: `${object.name} · ${keys.length === 1 ? partTitle(keys[0]) : `${keys.length} parts`}`, onlyParts: keys };
    const point = resolveCharacterTransformAtTime(object, playhead);
    // One part: remember its library symbol, so it can replace a part of another character.
    let symbol = "";
    if (keys.length === 1) {
      try { symbol = (frameAccessRef.current?.(object.id)?.contentWindow as (Window & { cbPartSymbolName?: (key: string) => string }) | null | undefined)?.cbPartSymbolName?.(keys[0]) || ""; } catch { symbol = ""; }
    }
    writeLayerClipboard({ objects: [layer], centre: { x: point.x, y: point.y }, parts: { keys, assetUrl: object.assetUrl, characterName: object.name, symbol } });
    showNotice(`Copied ${keys.length === 1 ? partTitle(keys[0]) : `${keys.length} parts`} — ⌘V pastes them as a layer, or onto a selected part of a character to replace it.`);
    return true;
  };
  const copyLayers = (): boolean => {
    if (!draft) return false;
    if (activeCharacterPart && !partReplacementBrowserOpen) return copyParts();
    if (activeCharacterPart || characterIsolated) { showNotice("Select the parts to copy (click, Shift+click or drag a box), or press Esc to copy the whole character."); return false; }
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
    const picked = activeCharacterPart && !partReplacementBrowserOpen ? selectedPartsForClipboard() : null;
    if (picked) {
      // Cut parts: copied, then hidden in the character (like Delete).
      if (!copyParts()) return;
      mutate((data) => {
        const item = data.objects.find((entry) => entry.id === picked.object.id);
        if (!item) return;
        item.partOverrides = { ...(item.partOverrides || {}) };
        for (const key of picked.keys) item.partOverrides[key] = { ...(item.partOverrides[key] || {}), visible: false };
      });
      setActiveCharacterPart(null);
      setPartReplacementBrowserOpen(false);
      return;
    }
    if (!copyLayers()) return;
    const ids = new Set(selectedObjectIds);
    mutate((data) => { data.objects = data.objects.filter((item) => !ids.has(item.id)); });
    selectObject(null);
  };
  /** Paste: in the middle of the view, or in place. Front / back (Illustrator): in place, directly
   *  above / below the selected layers (nothing selected: on top / just above the background). */
  const pasteLayers = (inPlace: boolean, where: "top" | "front" | "back" = "top") => {
    const clip = readLayerClipboard();
    if (!clip || !draft) { showNotice("Nothing to paste. Select layers and press Cmd/Ctrl+C first."); return; }
    // A copied body part pasted onto one selected part of a character replaces that part with it
    // (it keeps playing its own animation); anywhere else it is pasted as a part layer.
    const targetCharacter = draft.objects.find((item) => item.id === selectedObjectId);
    if (clip.parts && targetCharacter?.type === "character" && activeCharacterPart && !partReplacementBrowserOpen && !isMultiPartKey(activeCharacterPart)) {
      const parts = clip.parts;
      if (!parts.symbol || !parts.assetUrl) { showNotice("Copy a single part to replace a part with it (several parts paste as a layer — press Esc first)."); return; }
      const targetPart = activeCharacterPart;
      void exportSourceOfPlayer(parts.assetUrl).then((source) => {
        if (!source) { showNotice("Couldn't find the copied part's character file.", "error"); return; }
        applyLibraryPartReplacement(targetPart, symbolPlayerUrl(source, parts.symbol!), `${parts.characterName} · ${partTitle(parts.keys[0])}`, "source-symbol");
        showNotice(`Replaced ${partTitle(targetPart)} with ${parts.characterName}'s ${partTitle(parts.keys[0])}.`);
      });
      return;
    }
    const target = inPlace || where !== "top" ? clip.centre : (viewCenterRef.current?.() || clip.centre);
    const dx = target.x - clip.centre.x, dy = target.y - clip.centre.y;
    const stamp = Date.now();
    const pasted = retagCopies(clip.objects.map((item, index) => {
      const copy = clone(item);
      copy.id = `${String(item.id).split("-copy-")[0]}-copy-${stamp}${index}`;
      if (dx || dy) {
        // Paste in Center moves the copy and its whole motion path with it.
        copy.x = Number(copy.x || 0) + dx;
        copy.y = Number(copy.y || 0) + dy;
        copy.keyframes = (copy.keyframes || []).map((frame) => ({ ...frame, x: Number(frame.x || 0) + dx, y: Number(frame.y || 0) + dy }));
      }
      return copy;
    }), stamp);
    const selectedIds = new Set(selectedIdsRef.current);
    mutate((data) => {
      // Plain paste with one layer selected (Animate): text, images and shapes go onto that layer.
      const target = where === "top" && selectedIds.size === 1 ? data.objects.find((item) => selectedIds.has(item.id)) : undefined;
      const sharing = pasted.filter(sharesLayers);
      if (target && target.type !== "empty" && sharing.length && joinLayer(data, sharing, layerKeyOf(target))) {
        data.objects.push(...pasted.filter((item) => !sharing.includes(item)));
        return;
      }
      const indexes = data.objects.map((item, index) => (selectedIds.has(item.id) ? index : -1)).filter((index) => index >= 0);
      const at = where === "front" ? (indexes.length ? Math.max(...indexes) + 1 : data.objects.length)
        : where === "back" ? (indexes.length ? Math.min(...indexes) : backgroundFloor(data.objects))
          : data.objects.length; // new layers on top, in the copied order
      data.objects.splice(at, 0, ...pasted);
    });
    setActiveCharacterPart(null);
    setPartReplacementBrowserOpen(false);
    changeSelection(pasted.map((item) => item.id));
    // The timeline highlights the pasted objects' layers (not the frames picked before).
    frameSelectionFromCanvasRef.current = false;
    setFrameSelection(null);
  };
  // ---- Distribute to Layers (Animate ⇧⌘D): each body part of the character (or each selected part)
  // on its own layer, stacked back to front as drawn, so the character looks the same. "animated":
  // part layers (a copy of the character drawing only that part); "still": a vector picture of the
  // part as it is now (SVG). Distributing every part replaces the character's layer.
  const distributeParts = async (mode: "animated" | "still") => {
    const object = draft?.objects.find((item) => item.id === selectedObjectId);
    if (!object || object.type !== "character") { showNotice("Select a character, or some of its parts, to distribute them to layers."); return; }
    const selection = activeCharacterPart && !partReplacementBrowserOpen ? partMembers(activeCharacterPart) : [];
    const all = selection.length === 0;
    type StackPart = { key: string; label: string };
    const player = frameAccessRef.current?.(object.id)?.contentWindow as (Window & { cbPartsByStack?: (keys?: string[]) => StackPart[] }) | null | undefined;
    let parts: StackPart[] = [];
    try { parts = player?.cbPartsByStack?.(all ? undefined : selection) || []; } catch { parts = []; }
    if (!parts.length) { showNotice("No body parts were found in this character to distribute."); return; }
    if (mode === "animated" && parts.length > 8
      && !window.confirm(`Distribute ${parts.length} parts to layers?\n\nEach part layer plays its own copy of ${object.name}'s animation, so this many layers can make the editor slower. (Distribute as Still makes light vector pictures instead.)`)) return;
    const stamp = Date.now();
    const layers: EditorObject[] = mode === "still"
      ? await stillPartLayers(object, parts, stamp)
      : parts.map((part, index) => ({ ...clone(object), id: `${object.id}-part-${stamp}${index}`, name: `${object.name} · ${partTitle(part.key, part.label)}`, onlyParts: [part.key], partGroups: undefined, layer: undefined, layerName: undefined }));
    if (!layers.length) return;
    mutate((data) => {
      const at = data.objects.findIndex((item) => item.id === object.id);
      if (at < 0) return;
      if (all) { data.objects.splice(at, 1, ...layers); return; }
      const item = data.objects[at];
      item.partOverrides = { ...(item.partOverrides || {}) };
      for (const part of parts) item.partOverrides[part.key] = { ...(item.partOverrides[part.key] || {}), visible: false };
      data.objects.splice(at + 1, 0, ...layers);
    });
    setActiveCharacterPart(null);
    setPartReplacementBrowserOpen(false);
    setCharacterIsolated(false);
    setEnteredGroupId(null);
    changeSelection(layers.map((layer) => layer.id));
    showNotice(`Distributed ${layers.length} part${layers.length === 1 ? "" : "s"} to ${mode === "still" ? "vector picture " : ""}layers.`);
  };
  /** Distribute as Still: each part as a vector picture layer (SVG from the player, cbPartsToSvg),
   *  placed exactly where the part is drawn now — same size, turn, stretch and flip as the character. */
  async function stillPartLayers(object: EditorObject, parts: Array<{ key: string; label: string }>, stamp: number): Promise<EditorObject[]> {
    if (!project) return [];
    type Svg = { svg: string; x: number; y: number; width: number; height: number; playerWidth: number; playerHeight: number; skipped: Record<string, number> } | { error: string } | null;
    const player = frameAccessRef.current?.(object.id)?.contentWindow as (Window & { cbPartsToSvg?: (keys: string[]) => Svg }) | null | undefined;
    if (!player?.cbPartsToSvg) { showNotice("This character's player isn't ready — try again in a moment.", "error"); return []; }
    const t = resolveCharacterTransformAtTime(object, playhead);
    const stretchX = Number(object.stretchX ?? 1);
    const stretchY = Number(object.stretchY ?? 1);
    const flip = object.flipX ? -1 : 1;
    const angle = (Number(t.rotation || 0) * Math.PI) / 180;
    const layers: EditorObject[] = [];
    const skipped: Record<string, number> = {};
    for (const [index, part] of parts.entries()) {
      showNotice(`Making vector pictures… ${index + 1} / ${parts.length}`);
      const result = player.cbPartsToSvg([part.key]);
      if (!result || "error" in result) continue;
      for (const [what, count] of Object.entries(result.skipped || {})) skipped[what] = (skipped[what] || 0) + count;
      const name = `${object.name} · ${partTitle(part.key, part.label)}`;
      let url = "";
      try {
        const file = new File([result.svg], `${name.replace(/[^\w.-]+/g, "-")}.svg`, { type: "image/svg+xml" });
        url = (await api.uploadAsset(project.id, "background", file)).url;
      } catch { continue; }
      // Player px → stage px, as the character is drawn (its box is the player, centred on x, y).
      const kx = ((object.sourceWidth || result.playerWidth) * t.scale * stretchX) / result.playerWidth;
      const ky = ((object.sourceHeight || result.playerHeight) * t.scale * stretchY) / result.playerHeight;
      const lx = (result.x + result.width / 2 - result.playerWidth / 2) * kx * flip;
      const ly = (result.y + result.height / 2 - result.playerHeight / 2) * ky;
      layers.push({
        id: `${object.id}-still-${stamp}${index}`, type: "prop", name, assetKind: "image", assetUrl: url, mimeType: "image/svg+xml",
        sourceWidth: result.width, sourceHeight: result.height,
        x: t.x + lx * Math.cos(angle) - ly * Math.sin(angle), y: t.y + lx * Math.sin(angle) + ly * Math.cos(angle),
        scale: t.scale * ((object.sourceWidth || result.playerWidth) / result.playerWidth), stretchX, stretchY,
        rotation: t.rotation || 0, flipX: Boolean(object.flipX), skewX: object.skewX, skewY: object.skewY, opacity: object.opacity ?? 1,
        startTime: object.startTime, actionDurationMs: object.actionDurationMs,
      });
    }
    const notes = Object.entries(skipped).map(([what, count]) => `${count} ${what}${count > 1 ? "s" : ""}`);
    if (notes.length) window.setTimeout(() => showNotice(`Vector pictures made; not converted: ${notes.join(", ")}.`), 4200);
    if (!layers.length) showNotice("Couldn't make vector pictures of these parts.", "error");
    return layers;
  }
  // ---- Merge Layers (⇧⌘M): the selected layers become one layer holding all their objects, kept
  // together in the stacking order at the top layer's place. Distribute to Layers splits it again.
  const mergeLayers = (keysIn?: string[]) => {
    if (!draft) return;
    const keys = Array.from(new Set(keysIn?.length ? keysIn : [
      ...selectedObjectIds.map((id) => draft.objects.find((item) => item.id === id)).filter((item): item is EditorObject => Boolean(item)).map((item) => rowKeyOf(item, enteredObjectGroup)),
      ...(frameSelection ? selectionLayerIds(frameSelection) : []),
    ]));
    if (keys.some(isGroupRow)) { showNotice("A group can't be merged — double-click it to go inside and merge its layers there."); return; }
    if (keys.length < 2) { showNotice("Select two or more layers to merge (Shift+click them on the canvas, or drag across their frames)."); return; }
    if (!canShareLayer(draft.objects.filter((item) => keys.includes(layerKeyOf(item))))) {
      showNotice("A character's layer holds just its character — merge layers of text, images and shapes, or body-part layers of one character.");
      return;
    }
    const tops = keys.map((key) => ({ key, at: draft.objects.reduce((top, item, index) => (layerKeyOf(item) === key ? index : top), -1) })).filter((entry) => entry.at >= 0).sort((a, b) => b.at - a.at);
    const topKey = tops[0]?.key;
    if (!topKey) return;
    const topMembers = draft.objects.filter((item) => layerKeyOf(item) === topKey);
    // The merged layer keeps the top layer's own name (an unnamed one shows its objects' names).
    const name = topMembers[topMembers.length - 1]?.layerName;
    const memberIds: string[] = [];
    mutate((data) => {
      const inMerge = (item: EditorObject) => keys.includes(layerKeyOf(item)) && item.type !== "empty";
      const merged = data.objects.filter(inMerge);
      const topIndex = data.objects.reduce((top, item, index) => (inMerge(item) ? index : top), -1);
      const below = data.objects.slice(0, topIndex + 1).filter((item) => !inMerge(item) && !(keys.includes(layerKeyOf(item)) && item.type === "empty"));
      const above = data.objects.slice(topIndex + 1);
      merged.forEach((item) => { item.layer = topKey; if (name) item.layerName = name; else delete item.layerName; memberIds.push(item.id); });
      data.objects = [...below, ...merged, ...above];
    });
    window.setTimeout(() => changeSelection(memberIds), 0);
    showNotice(name ? `Merged ${keys.length} layers into “${name}”.` : `Merged ${keys.length} layers into one — double-click its name to rename it.`);
  };
  const splitLayers = (keys: string[]) => {
    const split = new Set(keys);
    // Each object's layer is named after the object again.
    mutate((data) => data.objects.forEach((item) => { if (split.has(layerKeyOf(item))) { delete item.layer; delete item.layerName; } }));
    showNotice("Each object is on a layer of its own again.");
  };
  const layerCommandsRef = useRef({ mergeLayers, splitLayers });
  layerCommandsRef.current = { mergeLayers, splitLayers };
  const distributeRef = useRef(distributeParts);
  distributeRef.current = distributeParts;
  useEffect(() => {
    const onDistributeKey = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || !event.shiftKey || event.altKey || (event.code !== "KeyD" && event.code !== "KeyM")) return;
      const target = event.target as HTMLElement | null;
      if (target && (["input", "textarea", "select"].includes((target.tagName || "").toLowerCase()) || target.isContentEditable)) return;
      event.preventDefault();
      event.stopPropagation();
      if (event.code === "KeyM") { layerCommandsRef.current.mergeLayers(); return; }
      // Several objects selected: each to a layer of its own; one character: its body parts.
      const ids = useEditorStore.getState().selectedObjectIds;
      if (ids.length > 1) {
        const objects = draftRef.current?.objects || [];
        layerCommandsRef.current.splitLayers(Array.from(new Set(ids.map((id) => objects.find((item) => item.id === id)).filter((item): item is EditorObject => Boolean(item)).map(layerKeyOf))));
        return;
      }
      void distributeRef.current("animated");
    };
    window.addEventListener("keydown", onDistributeKey, { capture: true });
    return () => window.removeEventListener("keydown", onDistributeKey, { capture: true });
  }, []);

  // Arrange (Illustrator): front / back of everything, or one step past the next layer. "Back" stays
  // above the background pictures at the bottom, which would otherwise hide the layers.
  const arrangeLayers = (mode: "front" | "back" | "forward" | "backward") => {
    const ids = new Set(selectedIdsRef.current);
    if (ids.size === 0) return;
    mutate((data) => {
      const objects = data.objects;
      if (mode === "front" || mode === "back") {
        const moving = objects.filter((item) => ids.has(item.id));
        const rest = objects.filter((item) => !ids.has(item.id));
        const at = mode === "front" ? rest.length : backgroundFloor(rest);
        data.objects = [...rest.slice(0, at), ...moving, ...rest.slice(at)];
        return;
      }
      if (mode === "forward") {
        for (let index = objects.length - 2; index >= 0; index -= 1) {
          if (ids.has(objects[index].id) && !ids.has(objects[index + 1].id)) [objects[index], objects[index + 1]] = [objects[index + 1], objects[index]];
        }
        return;
      }
      const floor = backgroundFloor(objects.filter((item) => !ids.has(item.id)));
      for (let index = 1; index < objects.length; index += 1) {
        if (ids.has(objects[index].id) && !ids.has(objects[index - 1].id) && index - 1 >= floor) [objects[index], objects[index - 1]] = [objects[index - 1], objects[index]];
      }
    });
  };
  const clipboardActionsRef = useRef({ copy: copyLayers, cut: cutLayers, paste: pasteLayers, arrange: arrangeLayers });
  clipboardActionsRef.current = { copy: copyLayers, cut: cutLayers, paste: pasteLayers, arrange: arrangeLayers };

  /** Several objects transformed together (the group box of a multi-selection): one undo step. */
  /** Values come from the canvas (where objects are drawn): a whole ⌘G group's move, turn or size
   *  goes into its motion; other objects get them as their own (their group's motion taken off). */
  const transformObjects = useCallback((entries: Array<{ id: string; patch: TransformPatch }>) => {
    mutate((data) => {
      const handled = applyWholeGroupEdits(data, entries, playhead, enteredObjectGroupRef.current);
      entries.forEach(({ id, patch: drawnPatch }) => {
      const item = data.objects.find((object) => object.id === id);
      if (!item || handled.has(id)) return;
      const patch = toOwnPatch(item, drawnPatch, playhead);
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
    });
  }, [mutate, playhead]);
  const transformObjectsRef = useRef(transformObjects);
  transformObjectsRef.current = transformObjects;
  const transformObject = useCallback((id: string, patch: TransformPatch) => transformObjects([{ id, patch }]), [transformObjects]);

  // ---- Transform panel and Align (Illustrator). A layer's numbers describe its artwork box (what
  // the selection hugs): X / Y are its registration point on the stage, W / H its size; size,
  // rotation and skew keep that point in place. A selected part shows its own move, size (% of the
  // part), rotation and skew, and turns around its own registration point.
  useEffect(() => { if (activeTool === "select" || activeTool === "scale" || activeTool === "reflect") setLastEditTool(activeTool); }, [activeTool]);
  const layerState = (item: EditorObject) => {
    const position = item.type === "character" ? resolveCharacterTransformAtTime(item, playhead) : { x: Number(item.x || 0), y: Number(item.y || 0) };
    const orientation: Orientation = { rotation: Number(item.rotation || 0), skewX: Number(item.skewX || 0), skewY: Number(item.skewY || 0), flipX: Boolean(item.flipX) };
    return { position: { x: position.x, y: position.y }, orientation, box: layerGeometryRef.current?.(item.id) || null };
  };
  const transformTarget = () => {
    if (!draft || selectedObjectIds.length !== 1) return null;
    const item = draft.objects.find((object) => object.id === selectedObjectIds[0]);
    if (!item || item.type === "background" || item.type === "audio" || item.type === "empty") return null;
    if (item.type === "character" && activeCharacterPart) {
      const part = resolvePartTransformAtTime(item, activeCharacterPart, playhead);
      return { kind: "part" as const, item, part, partKey: activeCharacterPart };
    }
    const state = layerState(item);
    return state.box ? { kind: "layer" as const, item, ...state, box: state.box } : null;
  };
  const transformReadRef = useRef<() => TransformReading | null>(() => null);
  transformReadRef.current = () => {
    if (symbolView && multiProps.length > 1) {
      // Several parts: the box that holds them (its reference point, its size); Rotate turns them all by the number typed.
      const infos = groupInfosRef.current;
      if (!infos.length) return null;
      const rect = stageRectOf(infos), at = { x: rect.left + transformReference.rx * (rect.right - rect.left), y: rect.top + transformReference.ry * (rect.bottom - rect.top) };
      return { mode: "layer", targetLabel: `${symbolObjectNow?.name || "Character"} › ${multiProps.length} parts`, scaleStrokesAvailable: false,
        values: { x: at.x, y: at.y, w: rect.right - rect.left, h: rect.bottom - rect.top, rotation: 0, skew: 0 } };
    }
    if (symbolView && pickedProp) {
      // Inside a pose: the picked part's own numbers (position in the pose, size in %, turn and skew in degrees).
      const info = partInfoRef.current, level = symbolLevelNow;
      if (!info || !canTransform(info) || info.prop !== pickedProp) return null;
      const layer = level?.data.layers.find((item) => (item.props || []).includes(pickedProp));
      return {
        mode: "part", targetLabel: `${symbolObjectNow?.name || "Character"} › ${layer?.name || pickedProp}`, scaleStrokesAvailable: false,
        values: { x: info.x, y: info.y, w: info.sx * 100, h: info.sy * 100, rotation: info.sky, skew: info.skx - info.sky },
      };
    }
    const target = transformTarget();
    if (!target) return null;
    if (target.kind === "part") {
      const { part } = target;
      const scale = Math.max(0.02, Number(part.scale ?? 1));
      return {
        mode: "part", targetLabel: partLabel(target.item, target.partKey), scaleStrokesAvailable: false,
        values: { x: part.offsetX, y: part.offsetY, w: scale * Number(part.stretchX ?? 1) * 100, h: scale * Number(part.stretchY ?? 1) * 100, rotation: part.rotation, skew: Number(part.skewX || 0) },
      };
    }
    const reference = toStage(target.position, target.orientation, localReference(target.box, transformReference.rx, transformReference.ry));
    return {
      mode: "layer", targetLabel: target.item.name || "Layer", scaleStrokesAvailable: target.item.type === "character",
      values: { x: reference.x, y: reference.y, w: target.box.width, h: target.box.height, rotation: target.orientation.rotation, skew: target.orientation.skewX },
    };
  };
  const readTransform = useCallback(() => transformReadRef.current(), []);
  const transformChangeRef = useRef<(field: TransformField, value: number) => void>(() => undefined);
  transformChangeRef.current = (field, value) => {
    if (symbolView && multiProps.length > 1) {
      const infos = groupInfosRef.current, plans = groupPlans(infos.map((info) => info.prop));
      if (!infos.length || !plans || !Number.isFinite(value)) return;
      const rect = stageRectOf(infos), width = rect.right - rect.left, height = rect.bottom - rect.top;
      const anchor: Pt = [rect.left + transformReference.rx * width, rect.top + transformReference.ry * height];
      let L: [number, number, number, number] = [1, 0, 0, 1], shift: Pt = [0, 0];
      if (field === "x") shift = [value - anchor[0], 0];
      else if (field === "y") shift = [0, value - anchor[1]];
      else if (field === "w" || field === "h") {
        const now = field === "w" ? width : height;
        if (!(value > 0) || !(now > 0)) return;
        const f = value / now;
        L = transformLinked ? [f, 0, 0, f] : field === "w" ? [f, 0, 0, 1] : [1, 0, 0, f];
      } else if (field === "rotation") { const turn = (value * Math.PI) / 180; L = [Math.cos(turn), Math.sin(turn), -Math.sin(turn), Math.cos(turn)]; }
      else return;
      const change = groupChange(infos, L, anchor, shift), editor = groupEditor(plans);
      editor.apply(change.patches);
      editor.end();
      setGroupInfos(change.shown);
      return;
    }
    if (symbolView && pickedProp) {
      const info = partInfoRef.current;
      if (!info || !canTransform(info) || !Number.isFinite(value)) return;
      const plan = planPartEdit(pickedProp);
      if (!plan) return;
      const r = (v: number, digits = 2) => Math.round(v * 10 ** digits) / 10 ** digits;
      let patch: Partial<Record<SymbolValueKey, number>>, next: Partial<PartInfo>;
      if (field === "x") { patch = { x: r(value) }; next = { x: value }; }
      else if (field === "y") { patch = { y: r(value) }; next = { y: value }; }
      else if (field === "w" || field === "h") {
        const now = field === "w" ? info.sx : info.sy;
        if (!value || !now) return;
        const factor = value / 100 / now;
        const sx = transformLinked || field === "w" ? info.sx * factor : info.sx, sy = transformLinked || field === "h" ? info.sy * factor : info.sy;
        patch = { scaleX: r(sx, 4), scaleY: r(sy, 4) }; next = { sx, sy };
      } else if (field === "rotation") {
        const turn = value - info.sky;
        patch = { skewX: r(info.skx + turn), skewY: r(value) }; next = { skx: info.skx + turn, sky: value };
      } else { patch = { skewX: r(info.sky + value) }; next = { skx: info.sky + value }; }
      const edit = partEditor(plan);
      edit.apply(patch);
      edit.end();
      partInfoRef.current = { ...info, ...next };
      setPartInfo(partInfoRef.current);
      return;
    }
    const target = transformTarget();
    if (!target || !Number.isFinite(value)) return;
    const limit = (v: number, low: number, high: number) => Math.min(high, Math.max(low, v));
    if (target.kind === "part") {
      const { part } = target;
      const scale = Math.max(0.02, Number(part.scale ?? 1)), stretchX = Number(part.stretchX ?? 1), stretchY = Number(part.stretchY ?? 1);
      let patch: PartPatch;
      if (field === "x") patch = { offsetX: value };
      else if (field === "y") patch = { offsetY: value };
      else if (field === "w" || field === "h") {
        const current = (field === "w" ? scale * stretchX : scale * stretchY) * 100;
        if (!(value > 0) || !(current > 0)) return;
        const factor = value / current;
        patch = transformLinked ? { scale: limit(scale * factor, 0.02, 20) }
          : field === "w" ? { stretchX: limit(stretchX * factor, 0.02, 50) } : { stretchY: limit(stretchY * factor, 0.02, 50) };
      } else if (field === "rotation") patch = { rotation: wrapDegrees(value) };
      else patch = { skewX: limit(value, -80, 80) };
      transformCharacterPart(target.item.id, target.partKey, patch);
      return;
    }
    const { item, position, orientation, box } = target;
    const local = localReference(box, transformReference.rx, transformReference.ry);
    const anchor = toStage(position, orientation, local);
    const patch: { x?: number; y?: number; scale?: number; stretchX?: number; stretchY?: number; rotation?: number; skewX?: number; strokeScale?: number } = {};
    if (field === "x") { patch.x = position.x + value - anchor.x; patch.y = position.y; }
    else if (field === "y") { patch.x = position.x; patch.y = position.y + value - anchor.y; }
    else if (field === "w" || field === "h") {
      const current = field === "w" ? box.width : box.height;
      if (!(value > 0) || !(current > 0)) return;
      const factor = value / current;
      let fx = 1, fy = 1;
      if (transformLinked) {
        const scale = Math.max(0.02, Number(item.scale || 1)), next = limit(scale * factor, 0.02, 20);
        fx = fy = next / scale; patch.scale = next;
      } else if (field === "w") {
        const stretch = Number(item.stretchX ?? 1), next = limit(stretch * factor, 0.02, 50);
        fx = next / stretch; patch.stretchX = next;
      } else {
        const stretch = Number(item.stretchY ?? 1), next = limit(stretch * factor, 0.02, 50);
        fy = next / stretch; patch.stretchY = next;
      }
      Object.assign(patch, positionFor(anchor, orientation, { x: local.x * fx, y: local.y * fy }));
      // Scale Strokes & Effects off: the outlines keep the thickness they had.
      if (item.type === "character" && !transformScaleStrokes) patch.strokeScale = limit(Number(item.strokeScale ?? 1) / Math.sqrt(fx * fy), 0.02, 50);
    } else {
      const next = field === "rotation" ? { ...orientation, rotation: wrapDegrees(value) } : { ...orientation, skewX: limit(value, -80, 80) };
      Object.assign(patch, positionFor(anchor, next, local));
      if (field === "rotation") patch.rotation = next.rotation; else patch.skewX = next.skewX;
    }
    mutate((data) => {
      const layer = data.objects.find((object) => object.id === item.id);
      if (!layer) return;
      if (patch.x != null && patch.y != null) {
        if (layer.type === "character" && (layer.keyframes || []).length > 0) moveKeyframedPosition(layer, playhead, patch.x, patch.y);
        else { layer.x = patch.x; layer.y = patch.y; }
      }
      if (patch.scale != null) layer.scale = patch.scale;
      if (patch.stretchX != null) layer.stretchX = patch.stretchX;
      if (patch.stretchY != null) layer.stretchY = patch.stretchY;
      if (patch.rotation != null) layer.rotation = patch.rotation;
      if (patch.skewX != null) layer.skewX = patch.skewX;
      if (patch.strokeScale != null) layer.strokeScale = patch.strokeScale;
    });
  };
  const changeTransform = useCallback((field: TransformField, value: number) => transformChangeRef.current(field, value), []);
  transformToggleRef.current = () => setTransformOpen((open) => !open);

  const runAlign = (action: AlignAction) => {
    if (!draft) return;
    if (symbolView && multiProps.length > 1) {
      // Several parts: each lines up with the pose's stage (or, with Align to Stage off, with the box that holds them), Distribute spaces them.
      const infos = groupInfosRef.current, plans = groupPlans(infos.map((info) => info.prop));
      if (!infos.length || !plans) { showNotice("These parts can't be moved here."); return; }
      const W = infos[0].W, H = infos[0].H;
      const entries = infos.map((info, index) => { const box = stageRectOf([info]); return { id: String(index), bounds: box }; });
      if ((action === "hdistribute" || action === "vdistribute") && entries.length < 3) { showNotice("Distribute needs three or more parts."); return; }
      const reference = alignToStage ? { left: 0, top: 0, right: W, bottom: H } : stageRectOf(infos);
      const moves = alignMoves(entries, action, reference);
      const shifts = infos.map((_, index) => moves.find((move) => move.id === String(index)) || { dx: 0, dy: 0 });
      if (shifts.every((move) => Math.abs(move.dx) < 1e-6 && Math.abs(move.dy) < 1e-6)) return;
      const round = (value: number, digits = 2) => Math.round(value * 10 ** digits) / 10 ** digits;
      const results = infos.map((info, index) => affinePart(info, [1, 0, 0, 1], [0, 0], [shifts[index].dx, shifts[index].dy]));
      const editor = groupEditor(plans);
      editor.apply(results.map((r) => ({ scaleX: round(r.scaleX, 4), scaleY: round(r.scaleY, 4), skewX: round(r.skewX), skewY: round(r.skewY), x: round(r.x), y: round(r.y) })));
      editor.end();
      return;
    }
    if (symbolView && pickedProp) {
      // Inside a pose: the picked part lines up with the pose's own stage (Animate's "Align to Stage").
      const info = partInfoRef.current;
      if (!info || !canTransform(info)) { showNotice("Pick a part first to align it."); return; }
      if (action === "hdistribute" || action === "vdistribute") { showNotice("Distribute needs three or more parts."); return; }
      const xs = partBox(info).corners.map((corner) => corner[0] * info.W), ys = partBox(info).corners.map((corner) => corner[1] * info.H);
      const left = Math.min(...xs), right = Math.max(...xs), top = Math.min(...ys), bottom = Math.max(...ys);
      const dx = action === "left" ? -left : action === "right" ? info.W - right : action === "hcenter" ? info.W / 2 - (left + right) / 2 : 0;
      const dy = action === "top" ? -top : action === "bottom" ? info.H - bottom : action === "vcenter" ? info.H / 2 - (top + bottom) / 2 : 0;
      if (Math.abs(dx) > 1e-6 || Math.abs(dy) > 1e-6) symbolNudgeRef.current?.(dx, dy);
      return;
    }
    if (activeCharacterPart) { showNotice("Align works on whole layers. Press Esc to leave the part first."); return; }
    const ids = new Set(selectedObjectIds);
    const entries = draft.objects
      .filter((item) => ids.has(item.id) && item.type !== "background" && item.type !== "audio" && item.type !== "empty" && !item.locked)
      .map((item) => { const state = layerState(item); return state.box ? { id: item.id, position: state.position, bounds: stageBounds(state.position, state.orientation, state.box) } : null; })
      .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));
    if (!entries.length) { showNotice("Select the layers to align first."); return; }
    if ((action === "hdistribute" || action === "vdistribute") && entries.length < 3) { showNotice("Distribute needs three or more layers."); return; }
    // One layer, or "Align to stage": the stage; otherwise the selection's own bounds.
    const reference = alignToStage || entries.length === 1
      ? { left: 0, top: 0, right: project?.width || 1920, bottom: project?.height || 1080 }
      : { left: Math.min(...entries.map((e) => e.bounds.left)), top: Math.min(...entries.map((e) => e.bounds.top)), right: Math.max(...entries.map((e) => e.bounds.right)), bottom: Math.max(...entries.map((e) => e.bounds.bottom)) };
    const byId = new Map(entries.map((entry) => [entry.id, entry]));
    const moves = alignMoves(entries, action, reference)
      .filter((move) => Math.abs(move.dx) > 1e-6 || Math.abs(move.dy) > 1e-6)
      .map((move) => { const entry = byId.get(move.id)!; return { id: move.id, x: entry.position.x + move.dx, y: entry.position.y + move.dy }; });
    if (moves.length) moveObjects(moves);
  };

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

  // Layers dragged by their name: the timeline lists them top to bottom, the scene stores them bottom up.
  const reorderLayers = useCallback((keysTopToBottom: string[]) => {
    mutate((data) => { data.objects = orderByLayers(data.objects, [...keysTopToBottom].reverse()); });
  }, [mutate]);

  // Frames dragged up or down onto another layer (Animate). The frames replace an empty layer,
  // join a layer that holds something (Merge Layers; never a character's layer, and a character's
  // frames join nothing), or become a new layer between two layers.
  // Part of a layer splits it: the dragged frames become their own piece, and what stays behind
  // keeps its place as up to two pieces (before and after the gap). A whole layer leaves an
  // empty layer behind, as in Animate. Sound always moves whole.
  const moveFramesToLayer = useCallback((sourceId: string, from: number, to: number, shift: number, target: LayerDropTarget) => {
    const fps = TIMELINE_FPS;
    if (!draft) return;
    // A layer with several objects moves as a whole: all of them, onto (into) the other layer.
    if (target.kind === "layer" && isGroupRow(target.id)) { showNotice(GROUP_DROP_NOTICE); return; }
    const sourceMembers = rowMembersOf(draft.objects, sourceId);
    if (sourceMembers.length > 1 || (sourceMembers[0] && sourceMembers[0].id !== sourceId)) { moveWholeLayer(sourceId, shift, target); return; }
    const source = draft.objects.find((item) => item.id === sourceId);
    if (!source || source.type === "empty") return;
    // Dropped onto a layer that holds something: the frames join that layer (several objects per layer).
    let joinKey: string | null = null;
    if (target.kind === "layer") {
      const destination = layerMembers(draft.objects, target.id);
      if (!destination.length || target.id === sourceId) return;
      if (destination.some((item) => item.locked)) { showNotice("That layer is locked."); return; }
      if (!(destination.length === 1 && destination[0].type === "empty")) {
        if (!canShareLayer([source, ...destination])) { showNotice(CHARACTER_LAYER_NOTICE); return; }
        joinKey = target.id;
      }
    }
    const lastSceneFrame = Math.max(0, Math.ceil(duration * fps - 1e-6) - 1);
    const start = Math.max(0, Number(source.startTime || 0));
    const startFrame = Math.round(start * fps);
    const endFrame = source.actionDurationMs ? Math.max(startFrame, Math.round((start + source.actionDurationMs / 1000) * fps) - 1) : Math.max(startFrame, lastSceneFrame);
    const a = Math.max(from, startFrame);
    const b = Math.min(to, endFrame);
    if (a > b) { showNotice("Those frames are empty."); return; }
    const whole = source.type === "audio" || (a === startFrame && b === endFrame);
    const first = whole ? startFrame : a;
    const moveBy = Math.max(-first, shift);
    const movedId = whole ? sourceId : newLayerId();
    mutate((data) => {
      const index = data.objects.findIndex((item) => item.id === sourceId);
      if (index < 0) return;
      const item = data.objects[index];
      let moved: EditorObject;
      // A merged layer's name stays with the layer: frames that leave it go without it (joining a merged layer, they take its name).
      if (whole) {
        moved = item;
        shiftObjectTimes(moved, moveBy / fps);
        data.objects.splice(index, 1, { id: newLayerId(), type: "empty", name: "Empty layer", x: item.x, y: item.y, startTime: 0, ...(item.layerName ? { layerName: item.layerName } : {}) });
        delete moved.layerName;
      } else {
        moved = extractFrames(item, a, b, moveBy, fps, movedId);
        delete moved.layerName;
        const before = a > startFrame ? extractFrames(item, startFrame, a - 1, 0, fps, item.id) : null;
        const after = b < endFrame ? extractFrames(item, b + 1, endFrame, 0, fps, before ? newLayerId() : item.id) : null;
        if (after && before) delete after.layerName;
        // What stays keeps the layer's place: the earlier piece on top, the later one just below.
        data.objects.splice(index, 1, ...[after, before].filter((piece): piece is EditorObject => Boolean(piece)));
      }
      if (joinKey) {
        // Join the layer: tagged with it, just above its top object.
        const members = data.objects.filter((object) => layerKeyOf(object) === joinKey);
        const name = members[members.length - 1]?.layerName;
        [...members, moved].forEach((object) => { object.layer = joinKey!; if (name) object.layerName = name; else delete object.layerName; });
        const top = data.objects.lastIndexOf(members[members.length - 1]);
        data.objects.splice(top + 1, 0, moved);
      } else if (target.kind === "layer") {
        const destination = data.objects.findIndex((object) => object.id === target.id);
        if (destination >= 0) data.objects.splice(destination, 1, moved);
        else data.objects.splice(index, 0, moved);
      } else if (target.belowId == null) data.objects.unshift(moved);
      else {
        // Just above the row below the gap (its top object: a merged layer or a group has several).
        const below = rowMembersOf(data.objects, target.belowId).pop();
        data.objects.splice(below ? data.objects.indexOf(below) + 1 : index, 0, moved);
      }
    });
    const movedFrom = first + moveBy;
    const movedTo = (whole ? endFrame : b) + moveBy;
    setDuration((current) => Math.max(current, (movedTo + 1) / fps));
    selectFrames({ layerId: joinKey || movedId, from: movedFrom, to: movedTo });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, duration, mutate, selectFrames, showNotice]);
  /** A layer of several objects (or a group) dragged up / down: every object moves (in time too);
   *  onto another layer they join it, between layers they stay a layer of their own. An empty layer
   *  stays behind (not for a group). */
  const moveWholeLayer = (key: string, shift: number, target: LayerDropTarget) => {
    const fps = TIMELINE_FPS;
    const members = rowMembersOf(draft?.objects || [], key);
    if (!members.length) return;
    if (target.kind === "layer" && target.id === key) return;
    if (target.kind === "layer") {
      const destination = layerMembers(draft?.objects || [], target.id);
      const intoEmpty = destination.length === 1 && destination[0].type === "empty";
      // A group moves only as a whole, between layers (its objects keep their own layers).
      if (isGroupRow(key) && !intoEmpty) { showNotice(GROUP_DROP_NOTICE); return; }
      if (!intoEmpty && !canShareLayer([...destination, ...members])) { showNotice(CHARACTER_LAYER_NOTICE); return; }
    }
    const firstFrame = Math.min(...members.map((item) => Math.round(Math.max(0, Number(item.startTime || 0)) * fps)));
    const moveBy = Math.max(-firstFrame, shift) / fps;
    const ids = new Set(members.map((item) => item.id));
    mutate((data) => {
      const index = data.objects.findIndex((item) => ids.has(item.id));
      const moving = data.objects.filter((item) => ids.has(item.id));
      data.objects = data.objects.filter((item) => !ids.has(item.id));
      // The layer's name stays with the empty layer left behind; joining a merged layer, the objects take its name.
      // A group just moves: no layer is left behind and its own layers keep their names.
      const group = isGroupRow(key);
      const leftName = moving[moving.length - 1].layerName;
      if (!group) data.objects.splice(Math.max(0, index), 0, { id: newLayerId(), type: "empty", name: "Empty layer", x: moving[0].x, y: moving[0].y, startTime: 0, ...(leftName ? { layerName: leftName } : {}) });
      moving.forEach((item) => { shiftObjectTimes(item, moveBy); if (!group) delete item.layerName; });
      if (target.kind === "layer") {
        const destination = data.objects.filter((item) => layerKeyOf(item) === target.id);
        const name = destination[destination.length - 1]?.layerName;
        if (destination.length === 1 && destination[0].type === "empty") {
          data.objects.splice(data.objects.indexOf(destination[0]), 1, ...moving);
          return;
        }
        [...destination, ...moving].forEach((item) => { item.layer = target.id; if (name) item.layerName = name; else delete item.layerName; });
        data.objects.splice(data.objects.indexOf(destination[destination.length - 1]) + 1, 0, ...moving);
      } else if (target.belowId == null) data.objects.unshift(...moving);
      else {
        const below = rowMembersOf(data.objects, target.belowId).pop();
        data.objects.splice(below ? data.objects.indexOf(below) + 1 : Math.max(0, index), 0, ...moving);
      }
    });
    changeSelection(members.map((item) => item.id));
  };

  // ---- Step inside a character (Animate's edit in place; view only). A character uploaded with
  // its .fla has its symbols' own timelines (cb-fla-timeline, lib/server/flaTimeline.ts): ⌥ Option
  // + double-click, or right-click › Edit Symbol, shows the pose's layers and keyframes in place of
  // the scene's timeline, with the rest of the scene dimmed. Double-clicking a keyframe's symbol (or
  // a part on the stage) steps further in; Esc, the breadcrumb or a double-click elsewhere step out.
  // Every level but the last stays on the frame it was entered at (cb-animate-bridge SYMBOL_VIEW).
  type SymbolLevel = { js: string; data: FlaSymbol; frame: number; props?: string[]; fileData?: FlaSymbol; clonesKey?: string };
  const [symbolView, setSymbolView] = useState<{ objectId: string; base: string; levels: SymbolLevel[]; hidden: Set<number>; playing: boolean } | null>(null);
  const symbolCacheRef = useRef(new Map<string, Promise<FlaSymbol>>());
  const loadSymbol = useCallback((base: string, js: string) => {
    const key = `${base}${js}`;
    let pending = symbolCacheRef.current.get(key);
    if (!pending) {
      pending = fetch(`${base}${encodeURIComponent(js)}.json`).then((response) => (response.ok ? response.json() as Promise<FlaSymbol> : Promise.reject(new Error(`HTTP ${response.status}`))));
      pending.catch(() => symbolCacheRef.current.delete(key));
      symbolCacheRef.current.set(key, pending);
    }
    return pending;
  }, []);
  const enterSymbol = useCallback(async (objectId: string) => {
    const object = draft?.objects.find((item) => item.id === objectId);
    if (!object || object.type !== "character") return;
    const action = characterLibraryActions.find((item) => item.assetUrl === object.assetUrl);
    if (!action?.flaTimeline || !action.flaSymbol) {
      showNotice("Stepping inside needs the character's Animate file — upload the character with its .fla next to the .html and .js.");
      return;
    }
    const base = action.flaTimeline.replace(/index\.json$/, "");
    try {
      const data = await loadSymbol(base, action.flaSymbol);
      // It opens on the frame the character shows now.
      const shown = Math.round((resolveSourceSeekMs(object, playhead) / 1000) * data.fps);
      const frame = object.loopMode === "loop" ? shown % Math.max(1, data.frames) : Math.min(data.frames - 1, shown);
      setPlaying(false);
      setFrameSelection(null);
      setActiveCharacterPart(null);
      selectObject(null);
      setSymbolView({ objectId, base, levels: [{ js: action.flaSymbol, data, frame: Math.max(0, frame) }], hidden: new Set(), playing: false });
    } catch {
      showNotice("Couldn't load this character's Animate timeline.", "error");
    }
  }, [characterLibraryActions, draft, loadSymbol, playhead, selectObject, setPlaying, showNotice]);
  const stepIntoSymbol = useCallback(async (layerIndex: number, frame: number, js: string) => {
    const view = symbolView;
    const current = view?.levels[view.levels.length - 1];
    const layer = current?.data.layers[layerIndex];
    if (!view || !current || !layer) return;
    const props = Object.entries(layer.classes || {}).filter(([, name]) => name === js).map(([prop]) => prop);
    if (!props.length) { showNotice("This symbol can't be opened from here."); return; }
    try {
      const data = await loadSymbol(view.base, js);
      setSymbolView((state) => state && state.objectId === view.objectId ? {
        ...state, playing: false, hidden: new Set(),
        levels: [...state.levels.slice(0, -1), { ...current, frame }, { js, data, frame: 0, props }],
      } : state);
    } catch {
      showNotice("Couldn't load that symbol's timeline.", "error");
    }
  }, [loadSymbol, showNotice, symbolView]);
  // Native pose editor (beta): the stepped-into pose opened straight from the character's .fla; its edits live on the placed character (nativePose).
  const [nativeEdit, setNativeEdit] = useState<{ objectId: string; flaUrl: string; item: string; js: string; title: string } | null>(null);
  const openNativeEditor = useCallback(async () => {
    const view = symbolView;
    const level = view?.levels[view.levels.length - 1];
    const object = view ? draft?.objects.find((item) => item.id === view.objectId) : null;
    const action = object?.type === "character" ? characterLibraryActions.find((item) => item.assetUrl === object.assetUrl) : null;
    if (!view || !level || !object || !action) return;
    try {
      const index = await (await fetch(`${view.base}index.json`)).json() as { document?: string; symbols?: Record<string, { name: string }> };
      const item = index.symbols?.[level.js]?.name;
      const flaUrl = item && index.document ? await findFlaUrl(view.base, index.document, action.sourceFolder) : null;
      if (!item || !flaUrl) { showNotice("The native editor needs the character's Animate file (.fla) uploaded with it.", "error"); return; }
      setNativeEdit({ objectId: view.objectId, flaUrl, item, js: level.js, title: `${object.name || "Character"} · ${level.data.name.split("/").pop() || level.data.name}` });
    } catch {
      showNotice("Couldn't open the native editor for this character.", "error");
    }
  }, [characterLibraryActions, draft, showNotice, symbolView]);
  const stepOutOfSymbol = useCallback(() => {
    setSymbolView((state) => (!state || state.levels.length <= 1 ? null : { ...state, playing: false, hidden: new Set(), levels: state.levels.slice(0, -1) }));
  }, []);
  useEscClose(Boolean(symbolView), stepOutOfSymbol);
  // A part double-clicked on the stage: step into its symbol; a drawn shape has none.
  const symbolDoubleClick = useCallback((prop: string | null) => {
    const current = symbolView?.levels[symbolView.levels.length - 1];
    if (!current) return;
    if (!prop) { stepOutOfSymbol(); return; }
    const layerIndex = current.data.layers.findIndex((layer) => layer.props?.includes(prop));
    const js = layerIndex >= 0 ? current.data.layers[layerIndex].classes?.[prop] : undefined;
    if (js) void stepIntoSymbol(layerIndex, current.frame, js);
    else showNotice("That's drawn artwork, not a symbol — there is nothing inside it to open.");
  }, [showNotice, stepIntoSymbol, stepOutOfSymbol, symbolView]);
  // Leaving the scene, or removing the character, ends it.
  useEffect(() => {
    if (symbolView && !draft?.objects.some((item) => item.id === symbolView.objectId)) setSymbolView(null);
  }, [draft?.objects, symbolView]);
  useEffect(() => { setSymbolView(null); }, [scene?.id]);
  // Play runs just the open symbol, looping, at its own frame rate.
  const symbolViewRef = useRef(symbolView);
  symbolViewRef.current = symbolView;
  const symbolPlaying = Boolean(symbolView?.playing);
  useEffect(() => {
    if (!symbolPlaying) return;
    const start = performance.now();
    const level = symbolView!.levels[symbolView!.levels.length - 1];
    const from = level.frame;
    let raf = 0;
    const tick = (now: number) => {
      const frame = (from + Math.floor(((now - start) / 1000) * level.data.fps)) % Math.max(1, level.data.frames);
      setSymbolView((state) => {
        if (!state?.playing) return state;
        const last = state.levels[state.levels.length - 1];
        return last.frame === frame ? state : { ...state, levels: [...state.levels.slice(0, -1), { ...last, frame }] };
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbolPlaying, symbolView?.levels.length]);
  const seekSymbol = useCallback((frame: number) => {
    setSymbolView((state) => {
      if (!state) return state;
      const last = state.levels[state.levels.length - 1];
      const next = Math.max(0, Math.min(last.data.frames - 1, frame));
      return { ...state, playing: false, levels: [...state.levels.slice(0, -1), { ...last, frame: next }] };
    });
  }, []);
  // A tween ease edited inside the character: saved on this placed character, for every copy of the symbol in it.
  const setSymbolEase = useCallback((layerIndex: number, keyframe: { i: number; d: number }, value: number | null) => {
    if (!symbolView) return;
    const level = symbolView.levels[symbolView.levels.length - 1];
    const props = level.data.layers[layerIndex]?.props || [];
    mutate((data) => {
      const item = data.objects.find((object) => object.id === symbolView.objectId);
      if (!item) return;
      const symbols = { ...(item.symbolEases || {}) }, entries = { ...(symbols[level.js] || {}) }, key = `${layerIndex}:${keyframe.i}`;
      if (value == null) delete entries[key];
      else entries[key] = { props, frame: keyframe.i, frames: keyframe.d, value };
      if (Object.keys(entries).length) symbols[level.js] = entries; else delete symbols[level.js];
      item.symbolEases = symbols;
    });
  }, [mutate, symbolView]);
  // Keyframes moved or added inside the character: the layer's keyframes as [file frame, frame now], saved on this placed character.
  // While a batch runs, the writers below add their change to it, and the batch makes them as one change (one undo step).
  const symbolBatch = useRef<Array<(data: EditorData) => void> | null>(null);
  const setSymbolKeys = useCallback((layerIndex: number, anchors: Array<[number, number]> | null) => {
    if (!symbolView) return;
    const level = symbolView.levels[symbolView.levels.length - 1];
    const props = level.data.layers[layerIndex]?.props || [];
    const write = (data: EditorData) => {
      const item = data.objects.find((object) => object.id === symbolView.objectId);
      if (!item) return;
      const symbols = { ...(item.symbolKeys || {}) }, layers = { ...(symbols[level.js] || {}) };
      // Tweens and blank keyframes made here belong to the layer's keyframes: a keyframe added inside one splits it, and going back to the file's keyframes keeps the ones that still start at a keyframe.
      const old = layers[String(layerIndex)], file = level.data.layers[layerIndex], starts = file ? fileAnchors(file) : [];
      const before = old?.anchors || starts;
      const tweens = anchors ? grownTweens(before, anchors, old?.tweens) : old?.tweens?.filter((tween) => starts.some((anchor) => anchor[0] === tween[0]));
      const blanks = anchors ? grownBlanks(before, anchors, old?.blanks) : old?.blanks?.filter((frame) => starts.some((anchor) => anchor[0] === frame));
      const entry = keyEntry(props, file, anchors, tweens, blanks, old?.cut);
      if (entry) layers[String(layerIndex)] = entry; else delete layers[String(layerIndex)];
      if (Object.keys(layers).length) symbols[level.js] = layers; else delete symbols[level.js];
      item.symbolKeys = symbols;
    };
    if (symbolBatch.current) symbolBatch.current.push(write); else mutate(write);
  }, [mutate, symbolView]);
  // Classic tweens made here (Create Classic Tween, on a span that holds still in the file): stored with the layer's keyframes.
  const setSymbolTweens = useCallback((layerIndex: number, change: (now: Tween[]) => Tween[]) => {
    if (!symbolView) return;
    const level = symbolView.levels[symbolView.levels.length - 1];
    const props = level.data.layers[layerIndex]?.props || [], file = level.data.layers[layerIndex];
    if (!file) return;
    const write = (data: EditorData) => {
      const item = data.objects.find((object) => object.id === symbolView.objectId);
      if (!item) return;
      const symbols = { ...(item.symbolKeys || {}) }, layers = { ...(symbols[level.js] || {}) };
      const old = layers[String(layerIndex)], tweens = change(old?.tweens || []);
      const entry = keyEntry(props, file, old?.anchors || fileAnchors(file), tweens, old?.blanks, old?.cut);
      if (entry) layers[String(layerIndex)] = entry; else delete layers[String(layerIndex)];
      if (Object.keys(layers).length) symbols[level.js] = layers; else delete symbols[level.js];
      item.symbolKeys = symbols;
    };
    if (symbolBatch.current) symbolBatch.current.push(write); else mutate(write);
  }, [mutate, symbolView]);
  // Blank keyframes (F7): the file frames of the keyframes that show nothing until the next one. A blank keyframe starts no tween.
  const setSymbolBlanks = useCallback((layerIndex: number, change: (now: number[]) => number[]) => {
    if (!symbolView) return;
    const level = symbolView.levels[symbolView.levels.length - 1];
    const props = level.data.layers[layerIndex]?.props || [], file = level.data.layers[layerIndex];
    if (!file) return;
    const write = (data: EditorData) => {
      const item = data.objects.find((object) => object.id === symbolView.objectId);
      if (!item) return;
      const symbols = { ...(item.symbolKeys || {}) }, layers = { ...(symbols[level.js] || {}) };
      const old = layers[String(layerIndex)], blanks = change(old?.blanks || []);
      const entry = keyEntry(props, file, old?.anchors || fileAnchors(file), old?.tweens?.filter((tween) => !blanks.includes(tween[0])), blanks, old?.cut);
      if (entry) layers[String(layerIndex)] = entry; else delete layers[String(layerIndex)];
      if (Object.keys(layers).length) symbols[level.js] = layers; else delete symbols[level.js];
      item.symbolKeys = symbols;
    };
    if (symbolBatch.current) symbolBatch.current.push(write); else mutate(write);
  }, [mutate, symbolView]);
  // Where a layer ends (frames removed from its end): null puts the end back at the pose's last frame.
  const setSymbolCut = useCallback((layerIndex: number, cut: number | null) => {
    if (!symbolView) return;
    const level = symbolView.levels[symbolView.levels.length - 1];
    const props = level.data.layers[layerIndex]?.props || [], file = level.data.layers[layerIndex];
    if (!file) return;
    const write = (data: EditorData) => {
      const item = data.objects.find((object) => object.id === symbolView.objectId);
      if (!item) return;
      const symbols = { ...(item.symbolKeys || {}) }, layers = { ...(symbols[level.js] || {}) };
      const old = layers[String(layerIndex)];
      const entry = keyEntry(props, file, old?.anchors || fileAnchors(file), old?.tweens, old?.blanks, cut ?? undefined);
      if (entry) layers[String(layerIndex)] = entry; else delete layers[String(layerIndex)];
      if (Object.keys(layers).length) symbols[level.js] = layers; else delete symbols[level.js];
      item.symbolKeys = symbols;
    };
    if (symbolBatch.current) symbolBatch.current.push(write); else mutate(write);
  }, [mutate, symbolView]);
  const setMadeTweenEase = useCallback((layerIndex: number, fileFrame: number, value: number) => {
    setSymbolTweens(layerIndex, (now) => now.map((tween) => (tween[0] === fileFrame ? ([fileFrame, value] as Tween) : tween)));
  }, [setSymbolTweens]);
  // A drag on the Ease box of a made tween shows on the stage as it moves and is one undo step.
  const previewTweenEase = useCallback((layerIndex: number, fileFrame: number, value: number | null) => {
    if (value == null) { window.setTimeout(() => { scrubHistoryRef.current = "idle"; }, 0); return; }
    if (scrubHistoryRef.current === "idle") scrubHistoryRef.current = "armed";
    setMadeTweenEase(layerIndex, fileFrame, value);
  }, [setMadeTweenEase]);
  const previewSymbolKeys = useCallback((layerIndex: number, anchors: Array<[number, number]> | null) => {
    if (!anchors) { window.setTimeout(() => { scrubHistoryRef.current = "idle"; }, 0); return; }
    if (scrubHistoryRef.current === "idle") scrubHistoryRef.current = "armed";
    setSymbolKeys(layerIndex, anchors);
  }, [setSymbolKeys]);
  // Which layers of the open symbol the player can move keyframes on (it knows how the pose was built).
  const [keysEditable, setKeysEditable] = useState<{ js: string; editable: Record<number, boolean>; moves: Record<number, boolean>; drawn: Record<number, boolean> } | null>(null);
  const keysLevelJs = symbolView ? symbolView.levels[symbolView.levels.length - 1].js : null;
  const keysLayers = symbolView ? symbolView.levels[symbolView.levels.length - 1].data.layers : null;
  const keysObjectId = symbolView?.objectId;
  useEffect(() => {
    if (!keysObjectId || !keysLevelJs || !keysLayers) { setKeysEditable(null); return; }
    const frame = frameAccessRef.current?.(keysObjectId);
    const post = () => frame?.contentWindow?.postMessage({
      source: "characterbazaarstudio-editor", type: "SYMBOL_KEYS_QUERY", js: keysLevelJs, token: keysLevelJs,
      layers: keysLayers.map((layer, index) => ({ index, props: layer.props || [], frames: layer.frames.map((item) => item.i) })).filter((layer) => layer.props.length),
    }, "*");
    const onMessage = (event: MessageEvent) => {
      const d = event.data;
      if (d?.source === "characterbazaarstudio-animate" && d.type === "SYMBOL_CLONES_CHANGED") { window.setTimeout(post, 0); return; }
      if (d?.source !== "characterbazaarstudio-animate" || d.type !== "SYMBOL_KEYS_EDITABLE" || d.js !== keysLevelJs) return;
      setKeysEditable({ js: keysLevelJs, editable: Object.fromEntries(Object.entries(d.editable || {}).map(([key, value]) => [Number(key), Boolean(value)])), moves: Object.fromEntries(Object.entries(d.moves || {}).map(([key, value]) => [Number(key), Boolean(value)])), drawn: Object.fromEntries(Object.entries(d.drawn || {}).map(([key, value]) => [Number(key), Boolean(value)])) });
    };
    window.addEventListener("message", onMessage);
    post();
    const retry = window.setTimeout(post, 600);
    return () => { window.removeEventListener("message", onMessage); window.clearTimeout(retry); };
  }, [keysObjectId, keysLevelJs, keysLayers]);
  // Values edited on one keyframe inside the character (X, Y, scale, rotation, opacity): saved on this placed character.
  const setSymbolValue = useCallback((layerIndex: number, frame: number, patch: Partial<Record<SymbolValueKey, number>> | null, part?: string) => {
    if (!symbolView) return;
    const level = symbolView.levels[symbolView.levels.length - 1];
    const layerProps = level.data.layers[layerIndex]?.props || [];
    // A layer that shows several drawn parts is edited one part at a time.
    const single = part && layerProps.length > 1 ? part : null;
    const props = single ? [single] : layerProps;
    const write = (data: EditorData) => {
      const item = data.objects.find((object) => object.id === symbolView.objectId);
      if (!item) return;
      const symbols = { ...(item.symbolValues || {}) }, entries = { ...(symbols[level.js] || {}) }, key = single ? `${layerIndex}:${frame}:${single}` : `${layerIndex}:${frame}`;
      if (patch) entries[key] = { props, frame, v: { ...(entries[key]?.v || {}), ...patch } }; else delete entries[key];
      if (Object.keys(entries).length) symbols[level.js] = entries; else delete symbols[level.js];
      item.symbolValues = symbols;
    };
    if (symbolBatch.current) symbolBatch.current.push(write); else mutate(write);
  }, [mutate, symbolView]);
  // Layers arranged inside the character (order, hide, lock, rename, delete, folders): one change, one undo step.
  const setLayerEdit = useCallback((change: (edit: SymbolLayerEdit) => SymbolLayerEdit | null, also?: (item: EditorObject) => void) => {
    if (!symbolView) return;
    const level = symbolView.levels[symbolView.levels.length - 1];
    mutate((data) => {
      const item = data.objects.find((object) => object.id === symbolView.objectId);
      if (!item) return;
      const symbols = { ...(item.symbolLayers || {}) }, next = change({ ...(symbols[level.js] || {}) });
      if (!next || isLayerEditEmpty(next)) delete symbols[level.js]; else symbols[level.js] = { ...next, spec: playerSpec(withClones(level.fileData || level.data, next.clones).layers, next) };
      item.symbolLayers = symbols;
      also?.(item);
    });
  }, [mutate, symbolView]);
  // Parts on the stage inside the character: press and drag to move, click to pick (then rotate / scale with handles). All of it edits
  // the keyframe at the playhead: on a keyframe that keyframe, between keyframes of a tween one is added there first (holding the
  // motion), as in Animate. One drag is one undo step.
  type PartHandle = { move: (dx: number, dy: number, shift: boolean) => void; end: () => void; click?: () => void };
  const [pickedPart, setPickedPartRaw] = useState<{ objectId: string; prop: string } | null>(null);
  // Several parts picked (Shift+click, a box dragged on the stage, Shift / ⌘ on layer rows): kept apart from the single pick, which every
  // single-part tool (handles, Transform panel, colours) still works on.
  const [multiParts, setMultiParts] = useState<{ objectId: string; props: string[] } | null>(null);
  const setPickedPart = useCallback((value: { objectId: string; prop: string } | null) => { setMultiParts(null); setPickedPartRaw(value); }, []);
  const [partInfo, setPartInfo] = useState<PartInfo | null>(null);
  const symbolLevelNow = symbolView ? symbolView.levels[symbolView.levels.length - 1] : null;
  const symbolObjectNow = symbolView ? draft?.objects.find((item) => item.id === symbolView.objectId) : undefined;
  /** Asks the player about a part (its transform and box); null when it has none to give. */
  const askPart = useCallback((prop: string) => new Promise<PartInfo | null>((resolve) => {
    const frame = symbolView && frameAccessRef.current?.(symbolView.objectId);
    if (!frame?.contentWindow) { resolve(null); return; }
    const token = `part${Date.now()}${Math.random()}`;
    const done = (value: PartInfo | null) => { window.removeEventListener("message", onMessage); window.clearTimeout(timer); resolve(value); };
    const onMessage = (event: MessageEvent) => {
      const d = event.data;
      if (d?.source === "characterbazaarstudio-animate" && d.type === "SYMBOL_PART_INFO" && d.token === token) done(d.info || null);
    };
    const timer = window.setTimeout(() => done(null), 1500);
    window.addEventListener("message", onMessage);
    frame.contentWindow.postMessage({ source: "characterbazaarstudio-editor", type: "SYMBOL_PART_QUERY", prop, token }, "*");
  }), [symbolView]);
  /** Where an edit of this part at the playhead lands: its layer, the keyframe (a new one when between a tween's keyframes). */
  const planPartEdit = useCallback((prop: string, quiet = false) => {
    const level = symbolLevelNow, object = symbolObjectNow;
    if (!level) return null;
    const layers = level.data.layers, at = level.frame;
    const anchorsOf = (index: number): Array<[number, number]> => object?.symbolKeys?.[level.js]?.[String(index)]?.anchors || fileAnchors(layers[index]);
    let layer = -1, item: ReturnType<typeof shownFrames>[number] | undefined;
    for (let index = 0; index < layers.length && layer < 0; index += 1) {
      if (layers[index].type === "folder" || !(layers[index].props || []).includes(prop)) continue;
      const found = shownFrames(layers[index], anchorsOf(index), object?.symbolKeys?.[level.js]?.[String(index)]).find((entry) => at >= entry.i && at < entry.i + entry.d && !entry.blank);
      if (found) { layer = index; item = found; }
    }
    if (layer < 0 || !item) return null;
    if (symbolObjectNow?.symbolLayers?.[level.js]?.locked?.includes(layer)) {
      if (!quiet) showNotice("This layer is locked.");
      return null;
    }
    if (item.tween === "shape") {
      if (!quiet) showNotice("This part is in a shape tween: it can be looked at here, not moved yet.");
      return null;
    }
    if (!(keysEditable?.js === level.js && keysEditable.editable[layer] && keysEditable.moves[layer])) {
      if (!quiet) showNotice("This part has no position keyframes to edit here.");
      return null;
    }
    const anchors = anchorsOf(layer);
    const inTween = item.i !== at && (item.tween === "classic" || item.tween === "motion");
    const grown = inTween ? addAnchor(anchors, at) : null;
    return { layer, prop, grown, target: inTween && grown ? fileOf(anchors, at) : anchors[item.anchor][0] };
  }, [keysEditable, showNotice, symbolLevelNow, symbolObjectNow]);
  /** The edit the pointer makes: the first change adds the keyframe, every change sets values (one undo step). */
  const partDragging = useRef(false), partAskSeq = useRef(0), partAnswered = useRef(0);
  const [partRefresh, setPartRefresh] = useState(0);
  const shownProp = useRef<string | null>(null);
  const partEditor = useCallback((plan: { layer: number; prop: string; grown: Array<[number, number]> | null; target: number }) => {
    let started = false;
    return {
      apply: (patch: Partial<Record<SymbolValueKey, number>>) => {
        partDragging.current = true;
        if (!started) {
          started = true;
          scrubHistoryRef.current = "armed";
          if (plan.grown) setSymbolKeys(plan.layer, plan.grown);
        }
        setSymbolValue(plan.layer, plan.target, patch, plan.prop);
      },
      end: () => { window.setTimeout(() => { scrubHistoryRef.current = "idle"; partDragging.current = false; setPartRefresh((n) => n + 1); }, 0); },
    };
  }, [setSymbolKeys, setSymbolValue]);
  // The picked part's box, read again after every change the stage makes.
  const pickedProp = pickedPart && symbolView?.objectId === pickedPart.objectId ? pickedPart.prop : null;
  const multiProps = useMemo(() => (multiParts && symbolView?.objectId === multiParts.objectId ? multiParts.props : []), [multiParts, symbolView?.objectId]);
  const selectedProps = useMemo(() => (multiProps.length ? multiProps : pickedProp ? [pickedProp] : []), [multiProps, pickedProp]);
  const selectedPropsRef = useRef(selectedProps);
  selectedPropsRef.current = selectedProps;
  const setPartSelection = useCallback((props: string[]) => {
    const objectId = symbolView?.objectId;
    const list = [...new Set(props)];
    if (!objectId || !list.length) { setMultiParts(null); setPickedPartRaw(null); }
    else if (list.length === 1) { setMultiParts(null); setPickedPartRaw({ objectId, prop: list[0] }); }
    else { setPickedPartRaw(null); setMultiParts({ objectId, props: list }); }
  }, [symbolView?.objectId]);
  const toggleOnePart = useCallback((prop: string) => {
    const now = selectedPropsRef.current;
    setPartSelection(now.includes(prop) ? now.filter((item) => item !== prop) : [...now, prop]);
  }, [setPartSelection]);
  const poseScopeNow = selectedProps.length && symbolLevelNow ? `@${symbolLevelNow.js}/${selectedProps.join("+")}` : null;
  const poseOwnerNow = selectedProps.length && symbolView ? symbolView.objectId : null;
  useEffect(() => { setPoseColourScope(poseScopeNow); setPoseOwnerId(poseOwnerNow); }, [poseScopeNow, poseOwnerNow]);
  const partVersion = JSON.stringify([symbolLevelNow?.frame, symbolLevelNow?.js, symbolObjectNow?.symbolValues, symbolObjectNow?.symbolKeys, symbolObjectNow?.symbolEases]);
  useEffect(() => {
    if (!pickedProp) { setPartInfo(null); shownProp.current = null; return; }
    // While a handle or the part is being dragged the box follows at once; replies are applied in the order asked
    // (an older reply never lands over a newer one), and a late reply for a part that is no longer picked is dropped.
    let live = true;
    const timer = window.setTimeout(() => {
      const ask = ++partAskSeq.current;
      const read = (tries: number) => void askPart(pickedProp).then((info) => {
        if (partDragging.current || !live) return;
        if (ask < partAnswered.current) return;
        // A reading made while the player redraws (after an undo) can be broken: ask again a moment later.
        if (info && !isSound(info) && tries < 4) { window.setTimeout(() => { if (live) read(tries + 1); }, 80); return; }
        partAnswered.current = ask;
        shownProp.current = info && canTransform(info) ? pickedProp : null;
        setPartInfo(info && canTransform(info) ? info : null);
      });
      read(0);
    // A part just picked is read at once; only the re-reads after a change to a box already on screen wait a moment.
    }, shownProp.current === pickedProp ? 160 : 0);
    return () => { live = false; window.clearTimeout(timer); };
  }, [askPart, partVersion, partRefresh, pickedProp]);
  useEffect(() => { if (!symbolView) setPickedPart(null); }, [symbolView, setPickedPart]);
  useEffect(() => { setPickedPart(null); }, [symbolLevelNow?.js, setPickedPart]);
  // Several parts picked: each one's reading, kept like the single part's, and the box that holds them all.
  const [groupInfos, setGroupInfos] = useState<PartInfo[]>([]);
  const groupInfosRef = useRef<PartInfo[]>([]);
  groupInfosRef.current = groupInfos;
  const multiKey = multiProps.join("|");
  useEffect(() => {
    if (!multiProps.length) { setGroupInfos([]); return; }
    let live = true;
    const timer = window.setTimeout(() => {
      const read = (tries: number) => void Promise.all(multiProps.map((prop) => askPart(prop))).then((all) => {
        if (partDragging.current || !live) return;
        const good = all.filter((info): info is PartInfo => Boolean(info) && isSound(info as PartInfo) && canTransform(info as PartInfo));
        if (!good.length && tries < 4) { window.setTimeout(() => { if (live) read(tries + 1); }, 80); return; }
        setGroupInfos(good);
      });
      read(0);
    }, 0);
    return () => { live = false; window.clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [askPart, partVersion, partRefresh, multiKey]);
  /** One change for several parts: every part's values are written in one go, and a drag is one undo step. */
  const groupEditor = useCallback((plans: Array<{ layer: number; prop: string; grown: Array<[number, number]> | null; target: number }>) => {
    let started = false;
    return {
      apply: (patches: Array<Partial<Record<SymbolValueKey, number>>>) => {
        partDragging.current = true;
        const writes: Array<(data: EditorData) => void> = [];
        if (!started) scrubHistoryRef.current = "armed";
        symbolBatch.current = writes;
        try {
          plans.forEach((plan, index) => {
            if (!started && plan.grown) setSymbolKeys(plan.layer, plan.grown);
            setSymbolValue(plan.layer, plan.target, patches[index], plan.prop);
          });
        } finally { symbolBatch.current = null; }
        started = true;
        if (writes.length) mutate((data) => { writes.forEach((write) => write(data)); });
      },
      end: () => { window.setTimeout(() => { scrubHistoryRef.current = "idle"; partDragging.current = false; setPartRefresh((n) => n + 1); }, 0); },
    };
  }, [mutate, setSymbolKeys, setSymbolValue]);
  /** What the group's parts take for a stage change (a matrix about a point, then a move), as values to write and as readings to show. */
  const groupChange = (infos: PartInfo[], L: [number, number, number, number], origin: Pt, shift: Pt = [0, 0]) => {
    const round = (value: number, digits = 2) => Math.round(value * 10 ** digits) / 10 ** digits;
    const results = infos.map((info) => affinePart(info, L, origin, shift));
    return {
      patches: results.map((r) => ({ scaleX: round(r.scaleX, 4), scaleY: round(r.scaleY, 4), skewX: round(r.skewX), skewY: round(r.skewY), x: round(r.x), y: round(r.y) })),
      shown: infos.map((info, index) => ({ ...info, sx: results[index].scaleX, sy: results[index].scaleY, skx: results[index].skewX, sky: results[index].skewY, x: results[index].x, y: results[index].y })),
    };
  };
  const groupPlans = (props: string[]) => {
    const plans = props.map((prop) => planPartEdit(prop, true));
    return plans.every(Boolean) ? (plans as NonNullable<(typeof plans)[number]>[]) : null;
  };
  const partEditable = Boolean(pickedProp && partInfo && planPartEdit(pickedProp, true));
  const groupBox = useMemo(() => {
    if (multiProps.length < 2 || !groupInfos.length) return null;
    const rect = stageRectOf(groupInfos), W = groupInfos[0].W, H = groupInfos[0].H;
    return { corners: [[rect.left / W, rect.top / H], [rect.right / W, rect.top / H], [rect.right / W, rect.bottom / H], [rect.left / W, rect.bottom / H]] as Array<[number, number]>, pivot: null, editable: Boolean(groupPlans(groupInfos.map((info) => info.prop))), multi: true };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupInfos, multiProps]);
  const symbolBox = useMemo(() => (partInfo ? { ...partBox(partInfo), editable: partEditable } : groupBox), [partInfo, partEditable, groupBox]);
  const beginSymbolDrag = useCallback((normalizedX: number, normalizedY: number, shift = false, context = false) => new Promise<PartHandle | null>((resolve) => {
    const view = symbolView, frame = view && frameAccessRef.current?.(view.objectId);
    if (!view || !frame?.contentWindow) { resolve(null); return; }
    const token = `drag${Date.now()}${Math.random()}`;
    let finished = false;
    const finish = (value: PartHandle | null) => {
      if (finished) return;
      finished = true;
      window.removeEventListener("message", onMessage);
      window.clearTimeout(timer);
      resolve(value);
    };
    // Several parts picked and one of them pressed: they all move together.
    const groupMove = async (hit: string): Promise<PartHandle | null> => {
      const read = await Promise.all(multiProps.map((prop) => askPart(prop)));
      const infos = read.filter((info): info is PartInfo => Boolean(info) && canTransform(info as PartInfo));
      const plans = groupPlans(infos.map((info) => info.prop));
      const click = () => setPickedPart({ objectId: view.objectId, prop: hit });
      if (!infos.length || !plans) return { move: () => undefined, end: () => undefined, click };
      const editor = groupEditor(plans), W = infos[0].W, H = infos[0].H;
      return {
        move: (dx, dy, constrain) => {
          let sx = dx * W, sy = dy * H;
          if (constrain) { if (Math.abs(sx) >= Math.abs(sy)) sy = 0; else sx = 0; }
          const change = groupChange(infos, [1, 0, 0, 1], [0, 0], [sx, sy]);
          editor.apply(change.patches);
          setGroupInfos(change.shown);
        },
        end: editor.end,
        click,
      };
    };
    const prepare = (info: { prop: string; ax: number; ay: number; bx: number; by: number; x: number; y: number; W: number; H: number } | null, part: PartInfo | null = null) => {
      if (!info) return null;
      // Shift adds the part to the picked ones or takes it out; a drag with Shift does nothing.
      if (shift && !context) return { move: () => undefined, end: () => undefined, click: () => toggleOnePart(info.prop) };
      if (multiProps.length > 1 && multiProps.includes(info.prop)) return context ? { move: () => undefined, end: () => undefined } : groupMove(info.prop);
      const quietPlan = planPartEdit(info.prop, true);
      let noticed = false;
      const edit = partEditor(quietPlan || { layer: -1, prop: info.prop, grown: null, target: 0 });
      return {
        move: (dx: number, dy: number, constrain: boolean) => {
          if (!quietPlan) { if (!noticed) { noticed = true; planPartEdit(info.prop); } return; }
          let stageX = dx * info.W, stageY = dy * info.H;
          if (constrain) { if (Math.abs(stageX) >= Math.abs(stageY)) stageY = 0; else stageX = 0; }
          const det = info.ax * info.by - info.bx * info.ay;
          if (!det) return;
          const round = (value: number) => Math.round(value * 100) / 100;
          edit.apply({ x: round(info.x + (stageX * info.by - info.bx * stageY) / det), y: round(info.y + (info.ax * stageY - stageX * info.ay) / det) });
        },
        end: edit.end,
        click: () => {
          // The box that came with the press is shown with the pick, in the same render; the re-read follows a moment later.
          if (part && canTransform(part) && isSound(part)) { shownProp.current = info.prop; setPartInfo(part); }
          setPickedPart({ objectId: view.objectId, prop: info.prop });
        },
      };
    };
    const onMessage = (event: MessageEvent) => {
      const d = event.data;
      if (d?.source !== "characterbazaarstudio-animate" || d.type !== "SYMBOL_DRAG_INFO" || d.token !== token) return;
      void Promise.resolve(prepare(d.info || null, d.part || null)).then(finish);
    };
    const timer = window.setTimeout(() => finish(null), 1500);
    window.addEventListener("message", onMessage);
    frame.contentWindow.postMessage({ source: "characterbazaarstudio-editor", type: "SYMBOL_DRAG_BEGIN", normalizedX, normalizedY, token }, "*");
  }), [askPart, groupEditor, multiProps, partEditor, planPartEdit, setPickedPart, symbolView, toggleOnePart]);
  // A box dragged on empty stage: the parts it touches become the picked ones (Shift adds to what is picked).
  const selectPoseParts = useCallback((rect: { x0: number; y0: number; x1: number; y1: number }, additive: boolean) => {
    const view = symbolView, frame = view && frameAccessRef.current?.(view.objectId);
    if (!view || !frame?.contentWindow) return;
    const token = `rect${Date.now()}${Math.random()}`;
    const level = symbolLevelNow;
    const done = (props: string[]) => {
      window.removeEventListener("message", onMessage);
      window.clearTimeout(timer);
      const known = new Set((level?.data.layers || []).flatMap((layer) => layer.props || []));
      const hit = props.filter((prop) => known.has(prop));
      setPartSelection(additive ? [...selectedPropsRef.current, ...hit] : hit);
    };
    const onMessage = (event: MessageEvent) => {
      const d = event.data;
      if (d?.source === "characterbazaarstudio-animate" && d.type === "SYMBOL_PARTS_RECT" && d.token === token) done(Array.isArray(d.props) ? d.props : []);
    };
    const timer = window.setTimeout(() => { window.removeEventListener("message", onMessage); }, 1500);
    window.addEventListener("message", onMessage);
    frame.contentWindow.postMessage({ source: "characterbazaarstudio-editor", type: "SYMBOL_PARTS_IN_RECT", token, ...rect }, "*");
  }, [setPartSelection, symbolLevelNow, symbolView]);
  // A handle of the picked part: turn it around its pivot or scale it from the opposite side.
  const beginSymbolHandle = useCallback(async (handle: string, nx: number, ny: number): Promise<PartHandle | null> => {
    if (multiProps.length > 1) {
      // Several parts: turn or scale them all about the box that holds them, as one.
      const read = await Promise.all(multiProps.map((prop) => askPart(prop)));
      const infos = read.filter((info): info is PartInfo => Boolean(info) && canTransform(info as PartInfo));
      const plans = groupPlans(infos.map((info) => info.prop));
      if (!infos.length || !plans || handle === "pivot" || handle.startsWith("skew-")) return null;
      const editor = groupEditor(plans), W = infos[0].W, H = infos[0].H, rect = stageRectOf(infos), start: Pt = [nx * W, ny * H];
      const centre: Pt = [(rect.left + rect.right) / 2, (rect.top + rect.bottom) / 2];
      return {
        move: (dx, dy, shift) => {
          const now: Pt = [(nx + dx) * W, (ny + dy) * H];
          let L: [number, number, number, number], origin: Pt;
          if (handle === "rotate") {
            let turn = Math.atan2(now[1] - centre[1], now[0] - centre[0]) - Math.atan2(start[1] - centre[1], start[0] - centre[0]);
            if (shift) turn = Math.round(turn / (Math.PI / 12)) * (Math.PI / 12);
            L = [Math.cos(turn), Math.sin(turn), -Math.sin(turn), Math.cos(turn)]; origin = centre;
          } else {
            const moveX = handle.includes("e") || handle.includes("w"), moveY = handle.includes("n") || handle.includes("s");
            const anchor: Pt = [handle.includes("e") ? rect.left : handle.includes("w") ? rect.right : centre[0], handle.includes("s") ? rect.top : handle.includes("n") ? rect.bottom : centre[1]];
            const ratio = (from: number, to: number, at: number) => (Math.abs(from - at) < 1e-6 ? 1 : (to - at) / (from - at));
            const clamp = (f: number) => (Math.abs(f) < 0.01 ? (f < 0 ? -0.01 : 0.01) : f);
            let fx = moveX ? clamp(ratio(start[0], now[0], anchor[0])) : 1, fy = moveY ? clamp(ratio(start[1], now[1], anchor[1])) : 1;
            if (shift && moveX && moveY) { const f = Math.abs(fx) >= Math.abs(fy) ? fx : fy; fx = f; fy = f; }
            L = [fx, 0, 0, fy]; origin = anchor;
          }
          const change = groupChange(infos, L, origin);
          editor.apply(change.patches);
          setGroupInfos(change.shown);
        },
        end: editor.end,
      };
    }
    if (!pickedProp) return null;
    const info = await askPart(pickedProp);
    if (!info || !canTransform(info)) return null;
    const plan = planPartEdit(pickedProp);
    if (!plan) return null;
    const edit = partEditor(plan), start: Pt = [nx * info.W, ny * info.H];
    // The box moves with the pointer at once; the player's own reading confirms it a moment later.
    const follow = (patch: Partial<PartInfo>) => setPartInfo({ ...info, ...patch });
    const round = (value: number, digits = 2) => Math.round(value * 10 ** digits) / 10 ** digits;
    return {
      move: (dx: number, dy: number, shift: boolean) => {
        const now: Pt = [(nx + dx) * info.W, (ny + dy) * info.H];
        if (handle === "pivot") {
          // The registration point moves, the artwork stays: the pivot's new place is a point of the part (local), and the part's position
          // is where that point is now.
          const at = stageToLocal(info, now), place = localToParent(info, at);
          edit.apply({ regX: round(at[0]), regY: round(at[1]), x: round(place[0]), y: round(place[1]) });
          follow({ regX: at[0], regY: at[1], x: place[0], y: place[1] });
        } else if (handle === "rotate") {
          const turned = rotatePart(info, start, now, shift);
          edit.apply({ scaleX: round(turned.scaleX, 4), scaleY: round(turned.scaleY, 4), skewX: round(turned.skewX), skewY: round(turned.skewY) });
          follow({ sx: turned.scaleX, sy: turned.scaleY, skx: turned.skewX, sky: turned.skewY });
        } else if (handle.startsWith("skew-")) {
          const skewed = skewPart(info, handle as SkewEdge, start, now);
          edit.apply({ scaleX: round(skewed.scaleX, 4), scaleY: round(skewed.scaleY, 4), skewX: round(skewed.skewX), skewY: round(skewed.skewY), x: round(skewed.x), y: round(skewed.y) });
          follow({ sx: skewed.scaleX, sy: skewed.scaleY, skx: skewed.skewX, sky: skewed.skewY, x: skewed.x, y: skewed.y });
        } else {
          const scaled = scalePart(info, handle as ScaleHandle, start, now, shift);
          edit.apply({ scaleX: round(scaled.scaleX, 4), scaleY: round(scaled.scaleY, 4), x: round(scaled.x), y: round(scaled.y) });
          follow({ sx: scaled.scaleX, sy: scaled.scaleY, x: scaled.x, y: scaled.y });
        }
      },
      end: edit.end,
    };
  }, [askPart, groupEditor, multiProps, partEditor, pickedProp, planPartEdit]);
  // Layers made by Duplicate Layer join the level's layer list (after the file's), so the timeline and every edit see them like any other.
  const clonesKey = symbolView ? JSON.stringify(symbolView.levels.map((level) => symbolObjectNow?.symbolLayers?.[level.js]?.clones || [])) : "";
  useEffect(() => {
    setSymbolView((state) => {
      if (!state) return state;
      const object = draft?.objects.find((item) => item.id === state.objectId);
      let changed = false;
      const levels = state.levels.map((level) => {
        const clones = object?.symbolLayers?.[level.js]?.clones, key = JSON.stringify(clones || []);
        if ((level.clonesKey ?? "[]") === key) return level;
        changed = true;
        const file = level.fileData || level.data;
        return { ...level, fileData: file, data: withClones(file, clones), clonesKey: key };
      });
      return changed ? { ...state, levels } : state;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clonesKey]);
  /** Duplicate Layer: a copy of each of these layers just above it, with its own keyframes (layers drawn frame by frame can't be copied yet). */
  const duplicateSymbolLayers = useCallback((ids: number[]) => {
    const level = symbolLevelNow;
    if (!level) return;
    const layers = level.data.layers, ready = keysEditable?.js === level.js ? keysEditable : null;
    const copyable = ids.filter((id) => layers[id]?.type === "normal" && layers[id]?.props?.length);
    if (!copyable.length) { showNotice("Pick a layer that holds an object to duplicate it."); return; }
    const usable = copyable.filter((id) => !ready?.drawn[id]);
    if (!usable.length) { showNotice("This layer is drawn frame by frame: it can't be duplicated yet."); return; }
    if (usable.length < copyable.length) showNotice("Layers drawn frame by frame were left out: they can't be duplicated yet.");
    let pairs: Array<{ from: number; to: number; prop: string }> = [];
    setLayerEdit((current) => { const made = duplicateLayers(layers, current, usable, 0); pairs = made.pairs; return made.edit; },
      (item) => pairs.forEach((pair) => writeSnapshot(item, level.js, snapshotLayer(item, level.js, pair.from, layers[pair.from].props![0]), pair.to, pair.prop)));
  }, [keysEditable, setLayerEdit, showNotice, symbolLevelNow]);
  /** The pose's library symbols (asked of the player). */
  const listPoseLibrary = useCallback(() => new Promise<string[]>((resolve) => {
    const frame = symbolView && frameAccessRef.current?.(symbolView.objectId);
    if (!frame?.contentWindow) { resolve([]); return; }
    const token = `lib${Date.now()}${Math.random()}`;
    const done = (names: string[]) => { window.removeEventListener("message", onMessage); window.clearTimeout(timer); resolve(names); };
    const onMessage = (event: MessageEvent) => {
      const d = event.data;
      if (d?.source === "characterbazaarstudio-animate" && d.type === "SYMBOL_LIBRARY" && d.token === token) done(Array.isArray(d.names) ? d.names : []);
    };
    const timer = window.setTimeout(() => done([]), 1500);
    window.addEventListener("message", onMessage);
    frame.contentWindow.postMessage({ source: "characterbazaarstudio-editor", type: "SYMBOL_LIBRARY_QUERY", token }, "*");
  }), [symbolView]);
  /** New layer from the library: one instance of the symbol in the middle of the pose, above the layer picked. */
  const addLibrarySymbol = useCallback((name: string, above: number | null) => {
    const level = symbolLevelNow;
    if (!level) return;
    setLayerEdit((current) => addSymbolLayer(level.data.layers, current, name, above));
  }, [setLayerEdit, symbolLevelNow]);
  /** New layer from a library picture (Backgrounds / FX): the picture's URL and size are saved, the player loads it. */
  const addLibraryPicture = useCallback(async (item: MediaLibraryItem, above: number | null) => {
    const level = symbolLevelNow;
    if (!level) return;
    const size = await readUrlImageDimensions(item.url);
    const image = { url: item.url, w: size.width || 300, h: size.height || 300, name: item.name };
    setLayerEdit((current) => addSymbolLayer(level.data.layers, current, image, above));
  }, [setLayerEdit, symbolLevelNow]);
  /** New layer from a picture file from the computer: it is stored with the project, like Import to Stage. */
  const uploadPosePicture = useCallback(async (file: File, above: number | null) => {
    const level = symbolLevelNow;
    if (!level || !project) return;
    if (!file.type.startsWith("image/")) { showNotice("Pick a picture file.", "error"); return; }
    try {
      const size = await readImageDimensions(file);
      const asset = await api.uploadAsset(project.id, "background", file);
      const image = { url: asset.url, w: size.width || 300, h: size.height || 300, name: file.name };
      setLayerEdit((current) => addSymbolLayer(level.data.layers, current, image, above));
    } catch (error) { showNotice(error instanceof Error ? error.message : "Upload failed", "error"); }
  }, [project, setLayerEdit, showNotice, symbolLevelNow]);
  /** The layers of the picked part(s), as indexes. */
  const pickedLayerIds = () => {
    const level = symbolLevelNow;
    if (!level) return [] as number[];
    const ids = selectedPropsRef.current.map((prop) => level.data.layers.findIndex((layer) => (layer.props || []).includes(prop))).filter((index) => index >= 0);
    return [...new Set(ids)];
  };
  symbolDuplicateRef.current = () => {
    if (!symbolView || !symbolLevelNow) return false;
    const ids = pickedLayerIds();
    if (!ids.length) return false;
    duplicateSymbolLayers(ids);
    return true;
  };
  // Arrow keys nudge the picked part (as a drag would) and Delete removes its layer from the pose.
  const partInfoRef = useRef(partInfo);
  partInfoRef.current = partInfo;
  symbolNudgeRef.current = (dx, dy) => {
    if (multiProps.length > 1) {
      const infos = groupInfosRef.current, plans = groupPlans(infos.map((info) => info.prop));
      if (!infos.length) return true;
      if (!plans) { showNotice("Some of these parts can't be moved here."); return true; }
      const change = groupChange(infos, [1, 0, 0, 1], [0, 0], [dx, dy]), editor = groupEditor(plans);
      editor.apply(change.patches);
      editor.end();
      setGroupInfos(change.shown);
      return true;
    }
    const info = partInfoRef.current;
    if (!pickedProp || !info || !canTransform(info)) return false;
    const plan = planPartEdit(pickedProp);
    if (!plan) return true;
    const det = info.ax * info.by - info.bx * info.ay;
    if (!det) return true;
    const round = (value: number) => Math.round(value * 100) / 100;
    const x = round(info.x + (dx * info.by - info.bx * dy) / det), y = round(info.y + (info.ax * dy - dx * info.ay) / det);
    const edit = partEditor(plan);
    edit.apply({ x, y });
    edit.end();
    partInfoRef.current = { ...info, x, y };
    setPartInfo(partInfoRef.current);
    return true;
  };
  // Flip (H left–right, Shift+H top–bottom) turns the picked part over about the middle of its box, as it looks on the stage.
  symbolFlipRef.current = (axis) => {
    if (multiProps.length > 1) {
      const infos = groupInfosRef.current, plans = groupPlans(infos.map((info) => info.prop));
      if (!infos.length || !plans) return true;
      const rect = stageRectOf(infos), change = groupChange(infos, axis === "h" ? [-1, 0, 0, 1] : [1, 0, 0, -1], [(rect.left + rect.right) / 2, (rect.top + rect.bottom) / 2]);
      const editor = groupEditor(plans);
      editor.apply(change.patches);
      editor.end();
      setGroupInfos(change.shown);
      return true;
    }
    const info = partInfoRef.current;
    if (!pickedProp || !info || !canTransform(info)) return false;
    const plan = planPartEdit(pickedProp);
    if (!plan) return true;
    const flipped = flipPart(info, axis), round = (value: number, digits = 2) => Math.round(value * 10 ** digits) / 10 ** digits;
    const edit = partEditor(plan);
    edit.apply({ scaleX: round(flipped.scaleX, 4), scaleY: round(flipped.scaleY, 4), skewX: round(flipped.skewX), skewY: round(flipped.skewY), x: round(flipped.x), y: round(flipped.y) });
    edit.end();
    partInfoRef.current = { ...info, sx: flipped.scaleX, sy: flipped.scaleY, skx: flipped.skewX, sky: flipped.skewY, x: flipped.x, y: flipped.y };
    setPartInfo(partInfoRef.current);
    return true;
  };
  // The registration point goes back to the middle of the part's box (the artwork stays).
  symbolPivotResetRef.current = () => {
    const info = partInfoRef.current;
    if (!pickedProp || !info || !canTransform(info)) return false;
    const plan = planPartEdit(pickedProp);
    if (!plan) return true;
    const at: Pt = [info.bounds.x + info.bounds.width / 2, info.bounds.y + info.bounds.height / 2], place = localToParent(info, at);
    const round = (value: number) => Math.round(value * 100) / 100;
    const edit = partEditor(plan);
    edit.apply({ regX: round(at[0]), regY: round(at[1]), x: round(place[0]), y: round(place[1]) });
    edit.end();
    partInfoRef.current = { ...info, regX: at[0], regY: at[1], x: place[0], y: place[1] };
    setPartInfo(partInfoRef.current);
    return true;
  };
  // Cmd+G puts the picked part's layer in a new folder; Cmd+Shift+G takes it out of its folder (the folder goes).
  symbolGroupRef.current = (ungroup) => {
    const level = symbolLevelNow;
    if (!symbolView || !level) return false;
    const layers = level.data.layers, ids = pickedLayerIds();
    if (!ids.length) return false;
    const current = symbolObjectNow?.symbolLayers?.[level.js];
    if (ungroup) {
      const folders = [...new Set(ids.map((id) => parentOf(layers, current, id)).filter((folder): folder is number => folder != null))];
      if (!folders.length) { showNotice("This layer is not in a folder."); return true; }
      setLayerEdit((edit) => folders.reduce((next, folder) => ungroupLayer(layers, next, folder), edit));
      return true;
    }
    if (ids.some((id) => current?.locked?.includes(id))) { showNotice("A locked layer can't be put in a folder."); return true; }
    let done = false;
    setLayerEdit((edit) => { const next = groupLayers(layers, edit, ids); done = Boolean(next); return next || edit; });
    if (!done) showNotice("This layer can't be put in a folder.");
    return true;
  };
  symbolDeleteRef.current = () => {
    const level = symbolLevelNow;
    if (!symbolView || !level || frameSelectionRef.current) return false;
    const ids = pickedLayerIds();
    if (!ids.length) return false;
    const locked = symbolObjectNow?.symbolLayers?.[level.js]?.locked || [];
    if (ids.every((id) => locked.includes(id))) { showNotice(ids.length > 1 ? "These layers are locked." : "This layer is locked."); return true; }
    const free = ids.filter((id) => !locked.includes(id));
    setLayerEdit((current) => ({ ...current, deleted: [...new Set([...(current.deleted || []), ...free])] }));
    setPickedPart(null);
    return true;
  };
  // ---- Copy / Cut / Paste (and in Front / in Back), Arrange: a part's layer is copied with the edits made on it (keyframes moved,
  // values typed or dragged, eases), so a paste looks like the part does now. Paste works inside the same pose.
  type LayerSnap = { values: Array<[number, SymbolValueEdit]>; keys: SymbolKeyEdit | null; eases: Array<[number, SymbolEaseEdit]> };
  type PartPicture = { url: string; w: number; h: number } | null;
  type PartSource = { symbol: string; foreign: PoseForeign } | null;
  const poseClipboard = useRef<{ js: string; items: Array<{ from: number; name: string; snap: LayerSnap; picture: Promise<PartPicture>; source: Promise<PartSource> }> } | null>(null);
  /** The part's own symbol and the export file it comes from: pasted into another character it stays vector. */
  const capturePartSource = (prop: string) => new Promise<PartSource>((resolve) => {
    const view = symbolView, frame = view && frameAccessRef.current?.(view.objectId);
    if (!view || !frame?.contentWindow) { resolve(null); return; }
    const token = `src${Date.now()}${Math.random()}`;
    const done = (value: PartSource) => { window.removeEventListener("message", onMessage); window.clearTimeout(timer); resolve(value); };
    const onMessage = (event: MessageEvent) => {
      const d = event.data;
      if (d?.source === "characterbazaarstudio-animate" && d.type === "SYMBOL_PART_SOURCE" && d.token === token) done(d.symbol && d.lib ? { symbol: d.symbol, foreign: { lib: d.lib, scale: d.scale || 1, frame: d.frame || 0, mode: d.mode, loop: d.loop } } : null);
    };
    const timer = window.setTimeout(() => done(null), 3000);
    window.addEventListener("message", onMessage);
    frame.contentWindow.postMessage({ source: "characterbazaarstudio-editor", type: "SYMBOL_PART_SOURCE_QUERY", prop, token }, "*");
  });
  /** A picture of a part as it looks now, taken from the open pose; it lets the part be pasted into a different character. */
  const capturePartPicture = (prop: string) => new Promise<PartPicture>((resolve) => {
    const view = symbolView, frame = view && frameAccessRef.current?.(view.objectId);
    if (!view || !frame?.contentWindow) { resolve(null); return; }
    const token = `pic${Date.now()}${Math.random()}`;
    const done = (value: PartPicture) => { window.removeEventListener("message", onMessage); window.clearTimeout(timer); resolve(value); };
    const onMessage = (event: MessageEvent) => {
      const d = event.data;
      if (d?.source === "characterbazaarstudio-animate" && d.type === "SYMBOL_PART_PICTURE" && d.token === token) done(d.url ? { url: d.url, w: d.w, h: d.h } : null);
    };
    const timer = window.setTimeout(() => done(null), 4000);
    window.addEventListener("message", onMessage);
    frame.contentWindow.postMessage({ source: "characterbazaarstudio-editor", type: "SYMBOL_PART_PICTURE_QUERY", prop, token }, "*");
  });
  const snapshotLayer = (item: EditorObject, js: string, index: number, prop: string): LayerSnap => {
    const pick = <T extends { props: string[]; frame: number }>(map: Record<string, T> | undefined) => Object.entries(map || {}).filter(([key]) => {
      const [layer, , part] = key.split(":");
      return Number(layer) === index && (!part || part === prop);
    }).map(([, value]): [number, T] => [value.frame, JSON.parse(JSON.stringify(value)) as T]);
    const keys = item.symbolKeys?.[js]?.[String(index)];
    return { values: pick(item.symbolValues?.[js]), keys: keys ? JSON.parse(JSON.stringify(keys)) : null, eases: pick(item.symbolEases?.[js]) };
  };
  const writeSnapshot = (item: EditorObject, js: string, snap: LayerSnap, index: number, prop: string) => {
    if (snap.values.length) {
      const all = { ...(item.symbolValues || {}) }, entries = { ...(all[js] || {}) };
      snap.values.forEach(([frame, value]) => { entries[`${index}:${frame}`] = { ...value, props: [prop] }; });
      all[js] = entries; item.symbolValues = all;
    }
    if (snap.eases.length) {
      const all = { ...(item.symbolEases || {}) }, entries = { ...(all[js] || {}) };
      snap.eases.forEach(([frame, value]) => { entries[`${index}:${frame}`] = { ...value, props: [prop] }; });
      all[js] = entries; item.symbolEases = all;
    }
    if (snap.keys) {
      const all = { ...(item.symbolKeys || {}) }, entries = { ...(all[js] || {}) };
      entries[String(index)] = { ...snap.keys, props: [prop] };
      all[js] = entries; item.symbolKeys = all;
    }
  };
  const copyPoseLayers = (quiet = false) => {
    const level = symbolLevelNow, object = symbolObjectNow;
    if (!level || !object) return false;
    const ids = pickedLayerIds().filter((id) => level.data.layers[id]?.type === "normal" && level.data.layers[id]?.props?.length);
    if (!ids.length) { if (!quiet) showNotice("Pick a part first to copy it."); return false; }
    poseClipboard.current = { js: level.js, items: ids.map((from) => ({ from, name: level.data.layers[from].name, snap: snapshotLayer(object, level.js, from, level.data.layers[from].props![0]), picture: capturePartPicture(level.data.layers[from].props![0]), source: capturePartSource(level.data.layers[from].props![0]) })) };
    if (!quiet) showNotice(ids.length > 1 ? `Copied ${ids.length} parts` : `Copied ${level.data.layers[ids[0]].name}`);
    return true;
  };
  /** Pasting into a different character: the part arrives as its own vector symbol (loaded from the file it came from), or as a
   *  picture of it when it has no symbol of its own. It keeps the size it had on the stage. */
  const pastePoseAsPictures = async (clip: NonNullable<typeof poseClipboard.current>) => {
    const level = symbolLevelNow;
    if (!level || !project) return;
    showNotice("Pasting…");
    try {
      const made: Array<{ symbol: string; name: string; foreign: PoseForeign } | { url: string; w: number; h: number; name: string; keep: boolean }> = [];
      let pictures = 0;
      for (const item of clip.items) {
        const source = await item.source;
        if (source) { made.push({ symbol: source.symbol, name: item.name || source.symbol, foreign: source.foreign }); continue; }
        const shot = await item.picture;
        if (!shot) continue;
        const blob = await (await fetch(shot.url)).blob();
        const asset = await api.uploadAsset(project.id, "background", new File([blob], `${item.name || "part"}.png`, { type: "image/png" }));
        made.push({ url: asset.url, w: shot.w, h: shot.h, name: item.name || "Part", keep: true });
        pictures += 1;
      }
      if (!made.length) { showNotice("This part could not be copied."); return; }
      setLayerEdit((current) => made.reduce((edit, layer) => addSymbolLayer(level.data.layers, edit, layer, null), current));
      showNotice(pictures ? `Pasted (${pictures} as a picture: it has no symbol of its own)` : made.length > 1 ? `Pasted ${made.length} parts` : "Pasted as a vector part");
    } catch (error) { showNotice(error instanceof Error ? error.message : "Paste failed", "error"); }
  };
  const pastePoseLayers = (place: "above" | "front" | "back") => {
    const level = symbolLevelNow, clip = poseClipboard.current;
    if (!level || !symbolView) return false;
    if (!clip) { showNotice("Nothing copied yet. Pick a part and press ⌘C."); return true; }
    if (clip.js !== level.js) { void pastePoseAsPictures(clip); return true; }
    const layers = level.data.layers;
    let pairs: Array<{ from: number; to: number; prop: string }> = [];
    const sources = clip.items.map((item) => item.from).filter((from) => layers[from]);
    if (!sources.length) return true;
    setLayerEdit((current) => { const made = duplicateLayers(layers, current, sources, 0, place); pairs = made.pairs; return made.edit; },
      (item) => { pairs.forEach((pair) => { const snap = clip.items.find((entry) => entry.from === pair.from)?.snap; if (snap) writeSnapshot(item, level.js, snap, pair.to, pair.prop); }); });
    window.setTimeout(() => { if (pairs.length) setPartSelection(pairs.map((pair) => pair.prop)); }, 0);
    return true;
  };
  const cutPoseLayers = () => { if (copyPoseLayers(true)) symbolDeleteRef.current?.(); else showNotice("Pick a part first to cut it."); return true; };
  const arrangePoseLayers = (how: "forward" | "backward" | "front" | "back") => {
    const level = symbolLevelNow;
    if (!level) return false;
    const ids = pickedLayerIds();
    if (!ids.length) return false;
    if (ids.some((id) => symbolObjectNow?.symbolLayers?.[level.js]?.locked?.includes(id))) { showNotice("This layer is locked."); return true; }
    setLayerEdit((current) => arrangeSymbolLayers(level.data.layers, current, ids, how) || current);
    return true;
  };
  // Duplicate Layer keeps what was edited on the layer too.
  symbolPoseKeyRef.current = (event) => {
    if (!symbolView || (event.metaKey === false && event.ctrlKey === false) || event.altKey) return false;
    if (event.code === "KeyC" && !event.shiftKey) return pickedLayerIds().length ? copyPoseLayers() : false;
    if (event.code === "KeyX" && !event.shiftKey) return pickedLayerIds().length ? cutPoseLayers() : false;
    if (event.code === "KeyV") return pastePoseLayers("above");
    if ((event.code === "KeyF" || event.code === "KeyB") && !event.shiftKey) return pastePoseLayers(event.code === "KeyF" ? "front" : "back");
    if (event.key === "ArrowUp" || event.key === "ArrowDown") return arrangePoseLayers(event.shiftKey ? (event.key === "ArrowUp" ? "front" : "back") : (event.key === "ArrowUp" ? "forward" : "backward"));
    return false;
  };
  symbolContextClipRef.current = (action) => {
    if (action === "copy") copyPoseLayers();
    else if (action === "cut") cutPoseLayers();
    else if (action === "paste") pastePoseLayers("above");
    else if (action === "pasteFront") pastePoseLayers("front");
    else if (action === "pasteBack") pastePoseLayers("back");
    else arrangePoseLayers(action === "toFront" ? "front" : action === "toBack" ? "back" : action === "forward" ? "forward" : "backward");
  };
  // ---- Frame operations, as in Animate: insert / remove frames, insert / clear keyframes, copy / cut / paste frames.
  // The pose's timeline keeps its length, so frames slide inside it. One operation is one undo step.
  type FrameOp = "insert-frame" | "remove-frames" | "insert-keyframe" | "clear-keyframe" | "blank-keyframe" | "create-tween" | "remove-tween" | "copy" | "cut" | "paste";
  type FrameSel = { layers: number[]; from: number; to: number };
  const frameClipboard = useRef<{ layerBase: number; items: Array<{ layer: number; offset: number; values: Record<string, number> }> } | null>(null);
  const [clipboardFilled, setClipboardFilled] = useState(false);
  /** A keyframe's values as the file has them (the player reads them off its tween). */
  const readKeyValues = useCallback((layerIndex: number, fileFrame: number) => new Promise<Record<string, number> | null>((resolve) => {
    const view = symbolView, frame = view && frameAccessRef.current?.(view.objectId);
    if (!view || !frame?.contentWindow) { resolve(null); return; }
    const level = view.levels[view.levels.length - 1], token = `read${Date.now()}${Math.random()}`;
    const done = (value: Record<string, number> | null) => { window.removeEventListener("message", onMessage); window.clearTimeout(timer); resolve(value); };
    const onMessage = (event: MessageEvent) => {
      const d = event.data;
      if (d?.source === "characterbazaarstudio-animate" && d.type === "SYMBOL_KEY_VALUES" && d.token === token) done(d.values || null);
    };
    const timer = window.setTimeout(() => done(null), 1500);
    window.addEventListener("message", onMessage);
    frame.contentWindow.postMessage({ source: "characterbazaarstudio-editor", type: "SYMBOL_VALUES_QUERY", js: level.js, layer: layerIndex, frame: fileFrame, props: level.data.layers[layerIndex]?.props || [], token }, "*");
  }), [symbolView]);
  const runFrameOp = useCallback(async (op: FrameOp, sel: FrameSel) => {
    const level = symbolLevelNow, object = symbolObjectNow;
    if (!level || !object) return;
    const layers = level.data.layers, ready = keysEditable?.js === level.js ? keysEditable : null;
    const anchorsOf = (index: number): Anchor[] => object.symbolKeys?.[level.js]?.[String(index)]?.anchors || fileAnchors(layers[index]);
    const lockedIds = object.symbolLayers?.[level.js]?.locked || [];
    const rows = sel.layers.filter((index) => layers[index] && layers[index].type !== "folder" && !lockedIds.includes(index));
    const doable = rows.filter((index) => ready?.editable[index]);
    const count = sel.to - sel.from + 1;
    const commit = (index: number, next: Anchor[]) => setSymbolKeys(index, isUnchanged(layers[index], next) ? null : next);
    const batch = (work: () => void) => {
      const writes: Array<(data: EditorData) => void> = [];
      symbolBatch.current = writes;
      try { work(); } finally { symbolBatch.current = null; }
      if (writes.length) mutate((data) => { writes.forEach((write) => write(data)); });
    };
    const edited = (index: number, fileFrame: number, base: Record<string, number> | null) => (base ? { ...base, ...(object.symbolValues?.[level.js]?.[`${index}:${fileFrame}`]?.v || {}) } as Record<string, number> : null);
    const movers = doable.filter((index) => ready?.moves[index] && !ready.drawn[index]);
    // A layer made from the library or a pasted part is one object held for the whole pose: Remove Frames shortens how long it shows
    // (the frames after it are blank), Insert Frame lengthens it again, as the span of a single keyframe does in Animate.
    const cloneList = object.symbolLayers?.[level.js]?.clones || [], fileCount = layers.length - cloneList.length, totalFrames = Math.max(1, level.data.frames);
    const heldAt = (index: number) => (index >= fileCount ? cloneList[index - fileCount] : undefined);
    // Once keyframes have been added to such a layer, it is moved like any keyframed layer (its keyframes slide) instead.
    const held = (op === "insert-frame" || op === "remove-frames") ? rows.filter((index) => { const c = heldAt(index); return Boolean(c && (c.symbol || c.image) && !object.symbolKeys?.[level.js]?.[String(index)]); }) : [];
    if (held.length) {
      setLayerEdit((current) => ({ ...current, clones: (current.clones || []).map((clone, at) => {
        const index = fileCount + at;
        if (!held.includes(index)) return clone;
        const now = clone.end ?? totalFrames;
        const next = op === "remove-frames" ? now - Math.max(0, Math.min(sel.to, now - 1) - Math.max(sel.from, 1) + 1) : Math.min(totalFrames, now + count);
        const { end: _end, ...rest } = clone;
        return next >= totalFrames ? rest : { ...rest, end: Math.max(1, next) };
      }) }));
    }
    // A keyframed layer like that, with frames removed from its end on: it shows for fewer frames (its blank keyframe moves up to where the
    // removal starts, and the keyframes after that go), as an unkeyframed one does.
    const tail = op === "remove-frames" && sel.from >= 1 ? rows.filter((index) => {
      const c = heldAt(index);
      return Boolean(c && (c.symbol || c.image) && object.symbolKeys?.[level.js]?.[String(index)] && (c.end ?? totalFrames) >= totalFrames && sel.to >= totalFrames - 1);
    }) : [];
    if (tail.length) {
      const cut = sel.from;
      setLayerEdit((current) => ({ ...current, clones: (current.clones || []).map((clone, at) => (tail.includes(fileCount + at) ? { ...clone, end: cut } : clone)) }), (item) => {
        const all = { ...(item.symbolKeys || {}) }, entries = { ...(all[level.js] || {}) };
        tail.forEach((index) => {
          const kept = anchorsOf(index).filter((anchor) => anchor[0] < cut && anchor[1] < cut);
          entries[String(index)] = { props: layers[index].props || [], anchors: [...kept, [cut, cut], [totalFrames, totalFrames]], ...(entries[String(index)]?.tweens ? { tweens: entries[String(index)].tweens } : {}) };
        });
        all[level.js] = entries; item.symbolKeys = all;
      });
    }
    // Any other layer that moves a part, with frames removed from its end on: it ends there (as in Animate the layer simply has fewer
    // frames): nothing shows from the first removed frame, and no frames are drawn after it. Insert Frame after that end brings it back.
    const keyOf = (index: number) => object.symbolKeys?.[level.js]?.[String(index)];
    const cutRows = op === "remove-frames" && sel.from >= 1 ? doable.filter((index) => !held.includes(index) && !tail.includes(index) && movers.includes(index) && sel.to >= totalFrames - 1 && sel.from < (keyOf(index)?.cut ?? totalFrames)) : [];
    const lengthenRows = op === "insert-frame" ? doable.filter((index) => !held.includes(index) && keyOf(index)?.cut != null && sel.from >= (keyOf(index)?.cut as number)) : [];
    if (cutRows.length || lengthenRows.length) {
      batch(() => {
        cutRows.forEach((index) => {
          let anchors = anchorsOf(index), k = keyframeAt(anchors, sel.from);
          if (k < 0) { const grown = addAnchor(anchors, sel.from); if (!grown) return; anchors = grown; k = keyframeAt(grown, sel.from); commit(index, grown); }
          if (k < 0) return;
          const fileFrame = anchors[k][0];
          setSymbolBlanks(index, (now) => (now.includes(fileFrame) ? now : [...now, fileFrame]));
          setSymbolCut(index, sel.from);
        });
        lengthenRows.forEach((index) => {
          const anchors = anchorsOf(index), cut = keyOf(index)?.cut as number, k = anchors.findIndex((anchor) => anchor[1] === cut && keyOf(index)?.blanks?.includes(anchor[0]));
          const to = sel.to + 1;
          if (k < 0) { setSymbolCut(index, to >= totalFrames ? null : to); return; }
          if (to >= totalFrames) {
            // The layer runs to the pose's end again: the keyframe that marked its end goes.
            const file = anchors[k][0];
            commit(index, removeAnchor(anchors, k));
            setSymbolBlanks(index, (now) => now.filter((frame) => frame !== file));
            setSymbolCut(index, null);
          } else {
            commit(index, anchors.map((anchor, at) => (at === k ? ([anchor[0], to] as Anchor) : anchor)));
            setSymbolCut(index, to);
          }
        });
      });
    }
    const doableRest = doable.filter((index) => !held.includes(index) && !tail.includes(index) && !cutRows.includes(index) && !lengthenRows.includes(index));
    if ((held.length || tail.length || cutRows.length || lengthenRows.length) && !doableRest.length) return;
    // A blank layer (new empty layer, sound layer) has no keyframes to move: inserting or removing frames there changes nothing, as in
    // Animate, so it is not an error; frames of the other layers in the selection still move.
    const blankOnly = sel.layers.length > 0 && sel.layers.every((index) => !layers[index] || (layers[index].type !== "folder" && !layers[index].props?.length));
    if (!doable.length && blankOnly && (op === "insert-frame" || op === "remove-frames" || op === "insert-keyframe" || op === "clear-keyframe")) return;
    if (op !== "paste" && !doable.length) { showNotice("The keyframes of these layers can't be edited here."); return; }
    const noRoom = () => showNotice("There is no room: a pose's timeline can't be made longer, so frames can only slide into free frames after them.");

    if (op === "blank-keyframe") {
      // As Animate's F7: a blank keyframe at the first frame of the selection (a keyframe made there if none is): the layer shows nothing
      // from it until its next keyframe, or to the end of the layer. Only layers that move a part can be blanked here.
      const blankable = doable.filter((index) => ready?.moves[index] && !ready.drawn[index]);
      if (!blankable.length) { showNotice("A blank keyframe can go on layers with a moving part: layers drawn frame by frame can't take one here."); return; }
      let made = 0;
      batch(() => blankable.forEach((index) => {
        let anchors = anchorsOf(index);
        if (sel.from >= anchors[anchors.length - 1][1]) return;
        let k = keyframeAt(anchors, sel.from);
        if (k < 0) {
          const grown = addAnchor(anchors, sel.from);
          if (!grown) return;
          anchors = grown; k = keyframeAt(grown, sel.from);
          commit(index, grown);
        }
        if (k < 0) return;
        const fileFrame = anchors[k][0];
        made += 1;
        setSymbolBlanks(index, (now) => (now.includes(fileFrame) ? now : [...now, fileFrame]));
      }));
      if (!made) showNotice("There is no frame to put a blank keyframe on there.");
      return;
    }
    if (op === "create-tween" || op === "remove-tween") {
      // As Animate's Create Classic Tween: each span the selection touches (a keyframe and the frames after it, up to the next keyframe)
      // moves from its keyframe's values to the next keyframe's. Only moving parts tween; the next keyframe holds where it ends.
      const tweenable = doable.filter((index) => ready?.moves[index] && !ready.drawn[index]);
      if (!tweenable.length) { showNotice(op === "create-tween" ? "These layers have no moving part to tween." : "Nothing to remove: these layers have no tween made here."); return; }
      let changed = 0, noEnd = 0;
      batch(() => tweenable.forEach((index) => {
        const anchors = anchorsOf(index), made = object.symbolKeys?.[level.js]?.[String(index)];
        const starts = new Set<number>();
        for (let frame = sel.from; frame <= sel.to; frame += 1) { const k = spanAt(anchors, frame); if (k >= 0) starts.add(k); }
        const shown = shownFrames(layers[index], anchors, made);
        const picked = [...starts].map((k) => shown.find((item) => item.anchor === k)).filter((item): item is NonNullable<typeof item> => Boolean(item && !item.blank));
        if (op === "create-tween") {
          const fresh: Tween[] = [];
          picked.forEach((item) => {
            if (item.tween) return; // already a tween (the file's own, or one made here)
            let next = item.anchor + 1;
            while (next < anchors.length - 1 && anchors[next][1] <= anchors[item.anchor][1]) next += 1;
            if (next >= anchors.length - 1) { noEnd += 1; return; }
            fresh.push([anchors[item.anchor][0], 0]);
          });
          if (fresh.length) { changed += fresh.length; setSymbolTweens(index, (now) => [...now, ...fresh]); }
        } else {
          const gone = new Set(picked.filter((item) => item.made).map((item) => anchors[item.anchor][0]));
          if (gone.size) { changed += gone.size; setSymbolTweens(index, (now) => now.filter((tween) => !gone.has(tween[0]))); }
        }
      }));
      if (!changed) showNotice(op === "create-tween" ? (noEnd ? "Add a keyframe where the tween should end first (F6), then create the tween." : "Pick frames on a keyframe's span that holds still.") : "No tween made here in these frames: a tween that came with the file can be re-eased, not removed.");
      return;
    }
    if (op === "insert-frame" || op === "remove-frames") {
      let skipped = 0;
      batch(() => doableRest.forEach((index) => {
        const next = op === "insert-frame" ? insertFrames(anchorsOf(index), sel.from, count) : removeFrames(anchorsOf(index), sel.from, sel.to);
        if (next) {
          commit(index, next);
          // A layer that ends early keeps its end with the keyframe that marks it, when frames before it come or go.
          const cutNow = keyOf(index)?.cut, mark = cutNow != null ? anchorsOf(index).find((anchor) => anchor[1] === cutNow && keyOf(index)?.blanks?.includes(anchor[0])) : undefined;
          const moved = mark ? next.find((anchor) => anchor[0] === mark[0]) : undefined;
          if (moved && moved[1] !== cutNow) setSymbolCut(index, moved[1]);
        } else skipped += 1;
      }));
      if (skipped) { if (op === "insert-frame") noRoom(); else showNotice("The first frame of a layer can't be removed."); }
      return;
    }
    if (op === "insert-keyframe") {
      // As in Animate, the new keyframe holds what is on stage at that frame. Inside a tween the player cuts the step there; in a hold
      // (a pasted part, a picture, a still stretch of a layer) the new keyframe takes the values of the keyframe before it, edits included.
      const plans: Array<{ layer: number; anchors: Anchor[]; fills: Array<{ fileFrame: number; values: Record<string, number> }> }> = [];
      for (const index of doable) {
        let next = anchorsOf(index);
        const fills: Array<{ fileFrame: number; values: Record<string, number> }> = [];
        for (let frame = sel.from; frame <= sel.to; frame += 1) {
          if (keyframeAt(next, frame) >= 0) continue;
          const k = spanAt(next, frame);
          const span = k >= 0 ? shownFrames(layers[index], next, object.symbolKeys?.[level.js]?.[String(index)]).find((item) => item.anchor === k) : undefined;
          const grown = addAnchor(next, frame);
          if (grown && movers.includes(index) && span && span.tween !== "classic" && span.tween !== "motion") {
            const values = edited(index, next[k][0], await readKeyValues(index, next[k][0]));
            const at = keyframeAt(grown, frame);
            if (values && at >= 0) fills.push({ fileFrame: grown[at][0], values });
          }
          next = grown || next;
        }
        plans.push({ layer: index, anchors: next, fills });
      }
      batch(() => plans.forEach((plan) => { commit(plan.layer, plan.anchors); plan.fills.forEach((fill) => setSymbolValue(plan.layer, fill.fileFrame, fill.values as Partial<Record<SymbolValueKey, number>>)); }));
      return;
    }
    if (op === "clear-keyframe" || op === "cut" || op === "copy") {
      // What the keyframes in the selection hold (position, rotation, scale, opacity), for copy and for clearing a tween's end.
      const grabbed: Array<{ layer: number; offset: number; values: Record<string, number> }> = [];
      if (op !== "clear-keyframe") {
        for (const index of movers) {
          const anchors = anchorsOf(index);
          const found: number[] = [];
          for (let k = 0; k < anchors.length - 1; k += 1) if (anchors[k + 1][1] > anchors[k][1] && anchors[k][1] >= sel.from && anchors[k][1] <= sel.to) found.push(k);
          if (!found.length) { const k = spanAt(anchors, sel.from); if (k >= 0) found.push(k); }
          for (const k of found) {
            const values = edited(index, anchors[k][0], await readKeyValues(index, anchors[k][0]));
            if (values) grabbed.push({ layer: index, offset: Math.max(0, anchors[k][1] - sel.from), values });
          }
        }
        if (!grabbed.length) { showNotice("Only moving parts can be copied: drawn artwork has no position keyframes to copy."); return; }
        frameClipboard.current = { layerBase: Math.min(...grabbed.map((item) => item.layer)), items: grabbed };
        setClipboardFilled(true);
        if (op === "copy") return;
      }
      // Clear: each keyframe in the frames stops being one; the span before it takes over. A moving part's tween before it is
      // pointed at the keyframe after it (or holds, when none follows).
      const fills: Array<{ layer: number; fileFrame: number; values: Record<string, number> }> = [];
      const plans: Array<{ layer: number; anchors: Anchor[] }> = [];
      for (const index of doable) {
        let anchors = anchorsOf(index);
        for (let frame = sel.from; frame <= sel.to; frame += 1) {
          const k = keyframeAt(anchors, frame);
          // A blank keyframe at the very start can't be cleared into the span before it: it stops being blank, and the layer shows again.
          if (k === 0 && object.symbolKeys?.[level.js]?.[String(index)]?.blanks?.includes(anchors[0][0])) { const first = anchors[0][0]; setSymbolBlanks(index, (now) => now.filter((item) => item !== first)); continue; }
          if (k <= 0) continue;
          if (movers.includes(index)) {
            const before = shownFrames(layers[index], anchors, object.symbolKeys?.[level.js]?.[String(index)]).filter((item) => item.anchor < k).pop();
            if (before && (before.tween === "classic" || before.tween === "motion")) {
              let after = k + 1;
              while (after < anchors.length - 1 && anchors[after][1] <= anchors[k][1]) after += 1;
              const from = after < anchors.length - 1 ? after : before.anchor;
              const values = edited(index, anchors[from][0], await readKeyValues(index, anchors[from][0]));
              if (values) fills.push({ layer: index, fileFrame: anchors[k][0], values });
            }
          }
          anchors = clearKeyframe(anchors, k) || anchors;
        }
        plans.push({ layer: index, anchors });
      }
      batch(() => { fills.forEach((fill) => setSymbolValue(fill.layer, fill.fileFrame, fill.values as Partial<Record<SymbolValueKey, number>>)); plans.forEach((plan) => commit(plan.layer, plan.anchors)); });
      return;
    }
    if (op === "paste") {
      const clip = frameClipboard.current;
      if (!clip) { showNotice("Nothing to paste: copy frames first."); return; }
      const base = sel.layers.find((index) => layers[index]) ?? 0, endOf = (index: number) => anchorsOf(index)[anchorsOf(index).length - 1][1];
      const working = new Map<number, Anchor[]>(), sets: Array<{ layer: number; fileFrame: number; values: Record<string, number> }> = [];
      let skipped = 0;
      for (const item of clip.items) {
        const index = base + (item.layer - clip.layerBase), at = sel.from + item.offset;
        if (!layers[index] || layers[index].type === "folder" || !ready?.editable[index] || !ready.moves[index] || ready.drawn[index] || at >= endOf(index)) { skipped += 1; continue; }
        let anchors = working.get(index) || anchorsOf(index);
        let k = keyframeAt(anchors, at);
        if (k < 0) { anchors = addAnchor(anchors, at) || anchors; k = keyframeAt(anchors, at); }
        if (k < 0) { skipped += 1; continue; }
        working.set(index, anchors);
        sets.push({ layer: index, fileFrame: anchors[k][0], values: item.values });
      }
      if (!sets.length) { showNotice("These frames can't take the pasted keyframes (drawn artwork, or past the end of the pose)."); return; }
      batch(() => { working.forEach((anchors, index) => commit(index, anchors)); sets.forEach((set) => setSymbolValue(set.layer, set.fileFrame, set.values as Partial<Record<SymbolValueKey, number>>)); });
      if (skipped) showNotice(`${skipped} keyframe${skipped > 1 ? "s" : ""} could not be pasted (drawn artwork, or past the end).`);
    }
  }, [keysEditable, readKeyValues, setSymbolBlanks, setSymbolCut, setSymbolKeys, setSymbolTweens, setSymbolValue, showNotice, symbolLevelNow, symbolObjectNow]);
  // ⌥-drag of a keyframe in the timeline: a copy of its values (position, scale, rotation, opacity) dropped on a frame of a layer.
  // An empty frame gets a keyframe (inside a tween it splits it); a keyframe there takes the values. One undo step.
  const copyKeyframe = useCallback(async (fromLayer: number, fromFile: number, toLayer: number, at: number) => {
    const level = symbolLevelNow, object = symbolObjectNow;
    if (!level || !object) return;
    const layers = level.data.layers, ready = keysEditable?.js === level.js ? keysEditable : null, locked = object.symbolLayers?.[level.js]?.locked || [];
    const movable = (index: number) => Boolean(layers[index] && layers[index].type !== "folder" && !locked.includes(index) && ready?.editable[index] && ready.moves[index] && !ready.drawn[index]);
    if (!movable(fromLayer)) { showNotice("Only the keyframes of moving parts can be copied: drawn artwork has no position keyframes."); return; }
    if (!movable(toLayer)) { showNotice("That layer can't take a keyframe (a folder, a locked layer, or drawn artwork)."); return; }
    const anchorsOf = (index: number): Anchor[] => object.symbolKeys?.[level.js]?.[String(index)]?.anchors || fileAnchors(layers[index]);
    let anchors = anchorsOf(toLayer);
    if (at >= anchors[anchors.length - 1][1]) { showNotice("A keyframe can't go past the end of the layer."); return; }
    const base = await readKeyValues(fromLayer, fromFile);
    if (!base) { showNotice("Couldn't read that keyframe's values."); return; }
    const values = { ...base, ...(object.symbolValues?.[level.js]?.[`${fromLayer}:${fromFile}`]?.v || {}) } as Partial<Record<SymbolValueKey, number>>;
    let k = keyframeAt(anchors, at);
    if (k < 0) { anchors = addAnchor(anchors, at) || anchors; k = keyframeAt(anchors, at); }
    if (k < 0) { showNotice("There is no room for a keyframe there."); return; }
    const next = anchors, fileFrame = anchors[k][0];
    const writes: Array<(data: EditorData) => void> = [];
    symbolBatch.current = writes;
    try { setSymbolKeys(toLayer, isUnchanged(layers[toLayer], next) ? null : next); setSymbolValue(toLayer, fileFrame, values); } finally { symbolBatch.current = null; }
    mutate((data) => { writes.forEach((write) => write(data)); });
  }, [keysEditable, mutate, readKeyValues, setSymbolKeys, setSymbolValue, showNotice, symbolLevelNow, symbolObjectNow]);
  // The picked keyframe's values as the file has them: the player reads them off its tween.
  const [keyValues, setKeyValues] = useState<{ layer: number; frame: number; values: Record<string, number> | null } | null>(null);
  const keyValuesAsk = useRef<{ layer: number; frame: number } | null>(null);
  const askKeyValues = useCallback((layerIndex: number, frame: number | null) => {
    if (frame == null || !symbolView) { keyValuesAsk.current = null; setKeyValues(null); return; }
    const level = symbolView.levels[symbolView.levels.length - 1];
    keyValuesAsk.current = { layer: layerIndex, frame };
    frameAccessRef.current?.(symbolView.objectId)?.contentWindow?.postMessage({
      source: "characterbazaarstudio-editor", type: "SYMBOL_VALUES_QUERY", js: level.js, layer: layerIndex, frame,
      props: level.data.layers[layerIndex]?.props || [], token: `${level.js}:${layerIndex}:${frame}`,
    }, "*");
  }, [symbolView]);
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const d = event.data, ask = keyValuesAsk.current;
      if (d?.source !== "characterbazaarstudio-animate" || d.type !== "SYMBOL_KEY_VALUES" || !ask || d.layer !== ask.layer || d.frame !== ask.frame) return;
      setKeyValues({ layer: ask.layer, frame: ask.frame, values: d.values || null });
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);
  useEffect(() => { if (!symbolView) { keyValuesAsk.current = null; setKeyValues(null); } }, [symbolView]);
  // A drag on the Ease box shows on the stage as it moves and is one undo step.
  const previewSymbolEase = useCallback((layerIndex: number, keyframe: { i: number; d: number }, value: number | null) => {
    if (value == null) { window.setTimeout(() => { scrubHistoryRef.current = "idle"; }, 0); return; }
    if (scrubHistoryRef.current === "idle") scrubHistoryRef.current = "armed";
    setSymbolEase(layerIndex, keyframe, value);
  }, [setSymbolEase]);
  // What the player gets: each level's frame (and how to reach it), and the hidden layers' objects
  // (a closed eye on a folder hides everything in it).
  const stageSymbolView = useMemo(() => {
    if (!symbolView) return null;
    // Hidden layers are saved with the character now (symbolLayers); the view itself hides nothing.
    return { objectId: symbolView.objectId, levels: symbolView.levels.map((level) => ({ props: level.props, frame: level.frame })), hidden: [] as string[] };
  }, [symbolView]);

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
      const frames = frameSelectionFromCanvasRef.current ? null : frameSelectionRef.current;
      if (frames) {
        // Frames are selected on the timeline: Delete clears the keyframe there (Animate).
        event.preventDefault();
        event.stopImmediatePropagation();
        frameActionRef.current("clear-keyframe", selectionLayerIds(frames), frames.from, frames.to);
        return;
      }
      if (symbolDeleteRef.current?.()) { event.preventDefault(); event.stopImmediatePropagation(); return; }
      if (selectedObjectIds.length === 0) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      // A body part is open (double-click mode): remove only that part, not the character.
      if (activeCharacterPart && selectedObjectIds.length === 1) {
        for (const member of partMembers(activeCharacterPart)) removeCharacterPart(selectedObjectIds[0], member);
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

  // Several selected parts: the change is relative (arrow keys move each part by the same amount);
  // the canvas sends per-part edits for turns and scales (transformCharacterParts).
  const transformCharacterPart = useCallback((id: string, partKey: CharacterPartKey, patch: PartPatch) => {
    mutate((data) => {
      const item = data.objects.find((object) => object.id === id);
      if (!item || item.type !== "character") return;
      if (!isMultiPartKey(partKey)) { writePartTransform(item, partKey, patch, playhead); return; }
      for (const member of partMembers(partKey)) {
        const current = resolvePartTransformAtTime(item, member, playhead);
        writePartTransform(item, member, {
          offsetX: current.offsetX + Number(patch.offsetX || 0),
          offsetY: current.offsetY + Number(patch.offsetY || 0),
          ...(patch.rotation != null ? { rotation: current.rotation + patch.rotation } : {}),
          ...(patch.scale != null ? { scale: current.scale * patch.scale } : {}),
        }, playhead);
      }
    });
  }, [mutate, playhead]);
  // ⌘G groups the selected parts of the character (saved with it in this scene); ⌘⇧G ungroups the
  // selected (or entered) group. A click on any member then selects the whole group.
  // Outside a character the same keys group (ungroup) the selected objects on the canvas.
  useEffect(() => {
    const groupObjects = (event: KeyboardEvent) => {
      if (!draft) return;
      event.preventDefault();
      event.stopPropagation();
      const picked = draft.objects.filter((item) => selectedObjectIds.includes(item.id) && item.type !== "background" && item.type !== "audio" && item.type !== "empty");
      if (event.shiftKey) {
        const groups = new Set(picked.map((item) => item.group).filter(Boolean));
        if (!groups.size) { showNotice("Select a group to ungroup it (⇧⌘G)."); return; }
        // The group's motion goes with it: each object stays where it was drawn now.
        mutate((data) => {
          for (const item of data.objects) {
            if (!item.group || !groups.has(item.group)) continue;
            if (item.groupMotion) {
              const drawn = resolveObjectTransformAtTime(item, playhead);
              const own = resolveObjectTransformAtTime({ ...item, groupMotion: undefined }, playhead);
              if (drawn.x !== own.x || drawn.y !== own.y) {
                if (item.type === "character" && (item.keyframes || []).length > 0) item.keyframes = (item.keyframes || []).map((key) => ({ ...key, x: key.x + drawn.x - own.x, y: key.y + drawn.y - own.y }));
                else { item.x = drawn.x; item.y = drawn.y; }
              }
              item.rotation = drawn.rotation;
              item.scale = drawn.scale;
            }
            delete item.group; delete item.groupName; delete item.groupMotion;
          }
        });
        setEnteredObjectGroup(null);
        showNotice(groups.size === 1 ? "Ungrouped." : `Ungrouped ${groups.size} groups.`);
        return;
      }
      if (picked.length < 2) { showNotice("Select two or more objects to group them — Shift+click or drag a box around them."); return; }
      // One level of groups: grouping objects that are in a group takes them into the new one.
      const id = `group-${Date.now().toString(36)}`;
      const ids = new Set(picked.map((item) => item.id));
      // Its name on the timeline: "Sardar parts" for parts of one character ("Sardar · Head", …), else "Group 2".
      const owners = Array.from(new Set(picked.map((item) => (item.name.includes(" · ") ? item.name.split(" · ")[0] : ""))));
      const groupName = owners.length === 1 && owners[0] ? `${owners[0]} parts` : `Group ${new Set(draft.objects.map((item) => item.group).filter(Boolean)).size + 1}`;
      mutate((data) => {
        for (const item of data.objects) if (ids.has(item.id)) { item.group = id; item.groupName = groupName; delete item.groupMotion; }
        const left = new Map<string, number>();
        data.objects.forEach((item) => { if (item.group) left.set(item.group, (left.get(item.group) || 0) + 1); });
        for (const item of data.objects) if (item.group && (left.get(item.group) || 0) < 2) { delete item.group; delete item.groupName; delete item.groupMotion; }
      });
      setEnteredObjectGroup(null);
      showNotice(`Grouped ${picked.length} objects as “${groupName}” — one row on the timeline; double-click the group (or its ⤵ on the timeline) to go inside.`);
    };
    const onGroupKey = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "g" || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target && (["input", "textarea", "select"].includes((target.tagName || "").toLowerCase()) || target.isContentEditable)) return;
      const object = draft?.objects.find((item) => item.id === selectedObjectId);
      if (!object || object.type !== "character" || !(activeCharacterPart || characterIsolated)) { groupObjects(event); return; }
      event.preventDefault();
      event.stopPropagation();
      const members = partReplacementBrowserOpen ? [] : partMembers(activeCharacterPart);
      const groups = object.partGroups || [];
      if (event.shiftKey) {
        const selectedGroup = groups.find((group) => group.id === enteredGroupId)
          || groups.find((group) => group.members.length === members.length && group.members.every((member) => members.includes(member)));
        if (!selectedGroup) { showNotice("Select a group to ungroup it (⌘⇧G)."); return; }
        mutate((data) => {
          const item = data.objects.find((entry) => entry.id === object.id);
          if (item) item.partGroups = (item.partGroups || []).filter((group) => group.id !== selectedGroup.id);
        });
        setEnteredGroupId(null);
        setActiveCharacterPart(joinPartKeys(selectedGroup.members));
        setPartReplacementBrowserOpen(false);
        return;
      }
      if (members.length < 2) { showNotice("Select two or more parts to group them — Shift+click or drag a box around them."); return; }
      // A part can be in one group: grouping parts that are already grouped regroups them.
      const id = `group-${Date.now().toString(36)}`;
      const used = new Set(groups.map((group) => group.name));
      let number = groups.length + 1;
      while (used.has(`Group ${number}`)) number += 1;
      mutate((data) => {
        const item = data.objects.find((entry) => entry.id === object.id);
        if (!item) return;
        const rest = (item.partGroups || []).map((group) => ({ ...group, members: group.members.filter((member) => !members.includes(member)) })).filter((group) => group.members.length > 1);
        item.partGroups = [...rest, { id, name: `Group ${number}`, members }];
      });
      setEnteredGroupId(null);
      showNotice(`Grouped ${members.length} parts as “Group ${number}” — a click on any of them selects the group; double-click to go inside it.`);
    };
    window.addEventListener("keydown", onGroupKey, { capture: true });
    return () => window.removeEventListener("keydown", onGroupKey, { capture: true });
  }, [activeCharacterPart, characterIsolated, draft, enteredGroupId, mutate, partReplacementBrowserOpen, playhead, selectedObjectId, selectedObjectIds, showNotice]);
  /** One undo step for edits to several parts at once (a multi-part move, turn or scale). */
  const transformCharacterParts = useCallback((id: string, patches: Record<CharacterPartKey, PartPatch>) => {
    mutate((data) => {
      const item = data.objects.find((object) => object.id === id);
      if (item && item.type === "character") for (const [member, patch] of Object.entries(patches)) writePartTransform(item, member, patch, playhead);
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
      return tag === "input" || tag === "textarea" || tag === "select" || node.isContentEditable;
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (scaleRotateOpenRef.current || isTypingTarget(event.target)) return;

      // Esc steps out one level (Illustrator's isolation mode): an entered group or part, the part a
      // selected piece sits in, then the character itself.
      if (event.key === "Escape" && (activeCharacterPart || characterIsolated)) {
        event.preventDefault();
        stepOutPartIsolation();
        return;
      }
      if (event.key === "Escape" && enteredObjectGroupRef.current) {
        event.preventDefault();
        stepOutObjectGroup();
        return;
      }

      if (event.key === "Enter" && activeToolRef.current === "reflect") {
        // Reflect tool + Enter = the Reflect dialog (Illustrator); otherwise Enter plays (Animate).
        event.preventDefault();
        openReflectRef.current();
        return;
      }
      if (event.key === "Enter" && activeToolRef.current === "text" && !editingTextRef.current) {
        event.preventDefault();
        setTextPanelOpen((open) => !open);
        return;
      }
      if (event.key === "Enter" && symbolViewRef.current) {
        // Inside a pose Return plays and pauses the pose's own timeline (as its play button does).
        event.preventDefault();
        setSymbolView((state) => (state ? { ...state, playing: !state.playing } : state));
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        setFrameSelection(null); // playback moves the playhead: the frame selection ends
        if (!isPlaying && atLastFrame) setPlayhead(0);
        setPlaying(!isPlaying);
        return;
      }

      const arrows: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
      if ((event.metaKey || event.ctrlKey) && !event.altKey && event.code === "KeyG" && symbolGroupRef.current?.(event.shiftKey)) { event.preventDefault(); return; }
      if (!event.metaKey && !event.ctrlKey && !event.altKey && event.code === "KeyH" && !/^(input|textarea|select)$/i.test((event.target as HTMLElement | null)?.tagName || "") && symbolFlipRef.current?.(event.shiftKey ? "v" : "h")) { event.preventDefault(); return; }
      if ((event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === "d" && symbolDuplicateRef.current?.()) { event.preventDefault(); return; }
      if (arrows[event.key] && !event.metaKey && !event.ctrlKey && !event.altKey && !/^(input|textarea|select)$/i.test((event.target as HTMLElement | null)?.tagName || "")) {
        // Inside a pose, the arrows nudge the picked part: 1 px, Shift = 10 px.
        const step = event.shiftKey ? 10 : 1, [dx, dy] = arrows[event.key];
        if (symbolNudgeRef.current?.(dx * step, dy * step)) { event.preventDefault(); return; }
      }
      if (!activeCharacterPart && selectedObjectIds.length > 0 && arrows[event.key] && !event.metaKey && !event.ctrlKey && !event.altKey) {
        // Animate-style nudge of the whole selection: 1 px, Shift = 10 px.
        event.preventDefault();
        const step = event.shiftKey ? 10 : 1;
        const [dx, dy] = arrows[event.key];
        // Through the same commit as a drag: a whole ⌘G group's nudge goes into its motion.
        moveObjects((draft?.objects || []).filter((item) => selectedObjectIds.includes(item.id)).map((item) => {
          const drawn = resolveObjectTransformAtTime(item, playhead);
          return { id: item.id, x: drawn.x + dx * step, y: drawn.y + dy * step };
        }));
        return;
      }

      if (!selectedObjectId || !activeCharacterPart) return;
      const selectedCharacter = draft?.objects.find((item) => item.id === selectedObjectId && item.type === "character");
      if (!selectedCharacter || selectedCharacter.type !== "character") return;

      // Cmd/Ctrl +/- is handled by the canvas-zoom shortcut above.
      if ((event.metaKey || event.ctrlKey) && (event.key === "+" || event.key === "=" || event.key === "-" || event.code === "NumpadAdd" || event.code === "NumpadSubtract")) return;

      // Cmd/Ctrl + arrows arrange the layers (above); only plain / Shift arrows move the part.
      if (event.metaKey || event.ctrlKey) return;
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
  }, [activeCharacterPart, characterIsolated, draft, duration, isPlaying, moveCharacterPart, moveObjects, mutate, partReplacementBrowserOpen, playhead, selectedObjectId, selectedObjectIds, setPlaying, stepOutObjectGroup, stepOutPartIsolation, transformCharacterPart]);

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
      if (activeCharacterPart) for (const member of partMembers(activeCharacterPart)) addOrUpdatePartKeyframe(character.id, member, playhead);
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
  const startRender = async (format: ExportFormat = "mp4", resolution: ExportResolution = "fullhd") => {
    try {
      await saveCurrentScene();
      setRenderFormat(format);
      showNotice(`${exportFormatLabel(format)} export queued…`);
      setRender(await api.startRender(projectId, { format, resolution, time: playhead, scene: scene?.id }));
    } catch (error) { showNotice(error instanceof Error ? error.message : "Export failed to start", "error"); }
  };
  // Export: first the Save window (file name and folder), then the export; cancelling the window
  // cancels the export. The click also unlocks the "Finished" chime.
  const beginExport = async (format: ExportFormat, resolution: ExportResolution) => {
    unlockChime();
    let target: ExportTarget | null;
    try {
      target = await pickExportTarget(`${(project?.title || "Untitled Project").trim()}.${exportExtension(format)}`, exportExtension(format));
    } catch (error) { showNotice(error instanceof Error ? error.message : "Could not choose where to save", "error"); return; }
    if (!target) return;
    exportTargetRef.current = target;
    setExportOpen(false);
    void startRender(format, resolution);
  };
  // File › Export (⌘E): the Export panel picks MP4, GIF, JPEG or PNG.
  const exportVideo = () => {
    if (render?.status === "queued" || render?.status === "running") { showNotice("An export is already running"); return; }
    setExportOpen(true);
  };
  const newFile = () => { void flushAutosave().then(() => router.push("/dashboard?newProject=1")); };
  // File › Import › Import to Stage (Animate): a picture becomes a picture layer you can select,
  // move and transform (like FX), at its own size and shrunk to fit the stage; a sound becomes a
  // voice / sound layer. Pictures are stored with the project's backgrounds (the upload kinds).
  const importToStage = async (file: File) => {
    if (!project) return;
    if (file.type.startsWith("audio/")) { void uploadVoice(file); return; }
    if (!file.type.startsWith("image/")) { showNotice("Import to Stage takes a picture or a sound file", "error"); return; }
    try {
      const dimensions = await readImageDimensions(file);
      const asset = await api.uploadAsset(project.id, "background", file);
      const width = dimensions.width || 300;
      const height = dimensions.height || 300;
      const layer: EditorObject = {
        id: `image-${Date.now()}`, type: "prop", name: file.name,
        x: project.width / 2, y: project.height / 2, scale: Math.min(1, project.width / width, project.height / height), rotation: 0, opacity: 1,
        assetKind: "image", assetUrl: asset.url, sourceWidth: width, sourceHeight: height,
        startTime: Math.max(0, playhead), mimeType: String(asset.metadata?.mimeType || file.type),
      };
      mutate((data) => placeInLayer(data, layer, selectedIdsRef.current[0]));
      selectObject(layer.id);
    } catch (error) { showNotice(error instanceof Error ? error.message : "Import failed", "error"); }
  };
  const comingSoon = (name: string) => showNotice(`${name} is coming soon`);

  const fileActions = { save, open: openProjectFile, importFile: () => importInputRef.current?.click(), externalLibrary: () => comingSoon("Open External Library"), exportVideo, newFile };
  const fileActionsRef = useRef(fileActions);
  fileActionsRef.current = fileActions;

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

  // ---- Timeline rows are layers, or a whole ⌘G group (lib/layerRows.ts). A row of several objects acts on all of them.
  const rowMembers = (key: string) => rowMembersOf(draft?.objects || [], key);
  const onRow = (key: string) => { const ids = new Set(rowMembers(key).map((item) => item.id)); return (item: EditorObject) => ids.has(item.id); };
  const isCombinedRow = (key: string) => { const members = rowMembers(key); return members.length > 1 || (members[0] && members[0].id !== key); };
  // A click on a layer's name selects the layer and all its frames (Animate), like a pick on the canvas.
  /** Shift / ⌘-click on layer names: those layers, every object on them, and all their frames. */
  const selectRows = (keys: string[]) => {
    const ids = Array.from(new Set(keys.flatMap((key) => { const members = rowMembers(key).map((item) => item.id); return members.length ? members : [key]; })));
    if (ids.length > 1) changeSelection(ids); else selectEditorObject(ids[0] ?? null);
    const selection = layerFramesSelection(ids);
    frameSelectionFromCanvasRef.current = Boolean(selection);
    setFrameSelection(selection);
  };
  const selectRow = (key: string) => {
    const ids = rowMembers(key).map((item) => item.id);
    if (ids.length > 1) changeSelection(ids); else selectEditorObject(ids[0] ?? key);
    const selection = layerFramesSelection(ids.length ? ids : [key]);
    frameSelectionFromCanvasRef.current = Boolean(selection);
    setFrameSelection(selection);
  };
  const deleteRow = (key: string) => {
    if (!isCombinedRow(key)) { deleteLayer(key); return; }
    const ids = new Set(rowMembers(key).map((item) => item.id));
    mutate((data) => { data.objects = data.objects.filter((item) => !ids.has(item.id)); });
    if (selectedObjectIds.some((id) => ids.has(id))) { selectObject(null); setActiveCharacterPart(null); setPartReplacementBrowserOpen(false); }
  };
  const toggleRowFlag = (key: string, flag: "hidden" | "locked") => {
    const next = !rowMembers(key).every((item) => item[flag]);
    const member = onRow(key);
    mutate((data) => data.objects.forEach((item) => { if (member(item)) item[flag] = next; }));
  };
  // ⌥-click an eye: only this layer shows; again (when it already is the only one): every layer shows.
  const soloRow = (key: string) => {
    const objects = draft?.objects || [];
    const member = onRow(key);
    const alone = objects.every((item) => member(item) ? !item.hidden : item.hidden);
    mutate((data) => data.objects.forEach((item) => { item.hidden = alone ? false : !member(item); }));
  };
  // Renaming on the timeline: a group's name, a merged layer's own name ("" = its objects' names
  // again), or the name of a layer's one object (an older layer name on it goes).
  const renameRow = (key: string, name: string) => {
    const member = onRow(key);
    const field = isGroupRow(key) ? "groupName" : "layerName";
    mutate((data) => data.objects.forEach((item) => {
      if (!member(item)) return;
      if (name) item[field] = name; else delete item[field];
    }));
  };
  const renameRowObject = (key: string, name: string) => {
    if (!name || isCombinedRow(key)) return;
    mutate((data) => { const item = data.objects.find((object) => object.id === key); if (item) { item.name = name; delete item.layerName; } });
  };
  const toggleRowLoop = (key: string) => {
    const characters = rowMembers(key).filter((item) => item.type === "character");
    const next = characters.some((item) => item.loopMode === "loop") ? "once" : "loop";
    const member = onRow(key);
    mutate((data) => data.objects.forEach((item) => { if (member(item) && item.type === "character") item.loopMode = next; }));
  };
  // Moving the row moves every object; trimming its start or end trims (or extends) the objects at that edge.
  const updateRowTiming = (key: string, patch: { startTime?: number; actionDurationMs?: number }) => {
    if (!isCombinedRow(key)) { updateLayerTiming(key, patch); return; }
    const members = rowMembers(key);
    const spans = members.map((item) => { const start = Math.max(0, Number(item.startTime || 0)); return { item, start, end: item.actionDurationMs ? start + item.actionDurationMs / 1000 : duration }; });
    const oldStart = Math.min(...spans.map((span) => span.start));
    const oldEnd = Math.max(...spans.map((span) => span.end));
    const frame = 1 / TIMELINE_FPS;
    if (typeof patch.startTime === "number" && typeof patch.actionDurationMs !== "number") {
      // Measured from where the drag began, so every update of one drag lands in the same place.
      if (rowDragBaseRef.current?.key !== key) rowDragBaseRef.current = { key, rowStart: oldStart, starts: Object.fromEntries(spans.map((span) => [span.item.id, span.start])) };
      const base = rowDragBaseRef.current;
      const delta = patch.startTime - base.rowStart;
      spans.forEach((span) => updateLayerTiming(span.item.id, { startTime: Math.max(0, (base.starts[span.item.id] ?? span.start) + delta) }));
      return;
    }
    if (typeof patch.startTime === "number") {
      const newStart = Math.max(0, patch.startTime);
      spans.forEach((span) => {
        if (span.start > oldStart + 1e-6 && span.start >= newStart) return;
        if (span.end - newStart >= frame) updateLayerTiming(span.item.id, { startTime: newStart, actionDurationMs: (span.end - newStart) * 1000 });
      });
      return;
    }
    if (typeof patch.actionDurationMs === "number") {
      const newEnd = oldStart + patch.actionDurationMs / 1000;
      spans.forEach((span) => {
        if (span.end < oldEnd - 1e-6 && span.end <= newEnd) return;
        if (newEnd - span.start >= frame) updateLayerTiming(span.item.id, { actionDurationMs: (newEnd - span.start) * 1000 });
      });
    }
  };
  // ---- A ⌘G group's own motion on its row: K / F6, Clear Keyframe, Create / Remove Tween,
  // dragging its keyframes and their ease (lib/groupMotion.ts).
  /** The middle of a group's objects as they stand without group motion: its first registration point. */
  const groupRestCentre = (objects: EditorObject[], group: string) => {
    let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
    for (const item of objects.filter((object) => object.group === group && object.type !== "empty")) {
      const own = resolveObjectTransformAtTime({ ...item, groupMotion: undefined }, playhead);
      const box = layerGeometryRef.current?.(item.id);
      const corners = box ? [[box.left, box.top], [box.left + box.width, box.top], [box.left, box.top + box.height], [box.left + box.width, box.top + box.height]] : [[0, 0]];
      const r = (own.rotation * Math.PI) / 180;
      for (const [cx, cy] of corners) {
        const x = own.x + cx * Math.cos(r) - cy * Math.sin(r);
        const y = own.y + cx * Math.sin(r) + cy * Math.cos(r);
        left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x); bottom = Math.max(bottom, y);
      }
    }
    return Number.isFinite(left) ? { x: (left + right) / 2, y: (top + bottom) / 2 } : { x: 0, y: 0 };
  };
  const groupFrameAction = (group: string, action: FrameAction, from: number, to: number) => {
    const objects = draft?.objects || [];
    const members = objects.filter((item) => item.group === group);
    if (!members.length) return;
    const fps = TIMELINE_FPS;
    const frameOf = (time: number) => Math.round(time * fps);
    const motion: GroupMotion = JSON.parse(JSON.stringify(groupMotionIn(objects, group) || {}));
    if (motion.pivotX == null || motion.pivotY == null) { const centre = groupRestCentre(objects, group); motion.pivotX = centre.x; motion.pivotY = centre.y; }
    let keys = sortGroupKeyframes(motion.keyframes || []);
    const time = from / fps;
    if (action === "keyframe") {
      if (keys.some((key) => frameOf(key.time) === from)) return;
      const keyAt = (at: number, tween: GroupKeyframe["tween"]): GroupKeyframe => ({ id: `gk-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, time: at, ...resolveGroupPose(motion, at), tween });
      // The first keyframe also fixes the group's first frame, so the frames before it stay put.
      const startFrame = Math.min(...members.map((item) => Math.round(Math.max(0, Number(item.startTime || 0)) * fps)));
      if (!keys.length && from !== startFrame) keys.push(keyAt(startFrame / fps, false));
      const previous = [...keys].reverse().find((key) => key.time < time - 1e-6);
      const next = keys.find((key) => key.time > time + 1e-6);
      keys.push(keyAt(time, previous && next && previous.tween !== false ? (previous.tween ? { ...previous.tween } : { easeIn: 0, easeOut: 0 }) : false));
    } else if (action === "clear-keyframe") {
      keys = keys.filter((key) => frameOf(key.time) < from || frameOf(key.time) > to);
    } else {
      const left = [...keys].reverse().find((key) => frameOf(key.time) <= from);
      const right = keys.find((key) => frameOf(key.time) > from);
      if (!left || !right) { showNotice(action === "tween" ? "A tween needs a keyframe before and after — press K at two frames first." : "There's no tween here."); return; }
      keys = keys.map((key) => (key.id !== left.id ? key : { ...key, tween: action === "tween" ? (key.tween || { easeIn: 0, easeOut: 0 }) : false }));
    }
    motion.keyframes = sortGroupKeyframes(keys);
    if (!motion.keyframes.length) delete motion.keyframes;
    mutate((data) => writeGroupMotion(data.objects, group, motion));
  };
  const editGroupKeyframes = (group: string, edit: (keys: GroupKeyframe[]) => GroupKeyframe[]) => {
    const motion = groupMotionIn(draft?.objects || [], group);
    if (!motion?.keyframes?.length) return;
    mutate((data) => writeGroupMotion(data.objects, group, { ...motion, keyframes: sortGroupKeyframes(edit(motion.keyframes || [])) }));
  };
  const moveRowKeyframe = (key: string, fromFrame: number, toFrame: number) => {
    if (isGroupRow(key)) {
      const frameOf = (time: number) => Math.round(time * TIMELINE_FPS);
      editGroupKeyframes(groupOfRow(key), (keys) => keys.filter((item) => frameOf(item.time) !== toFrame).map((item) => (frameOf(item.time) === fromFrame ? { ...item, time: toFrame / TIMELINE_FPS } : item)));
      return;
    }
    if (!isCombinedRow(key)) { moveKeyframe(key, fromFrame, toFrame); return; }
    rowMembers(key).filter((item) => (item.keyframes || []).some((frame) => Math.round(frame.time * TIMELINE_FPS) === fromFrame)).forEach((item) => moveKeyframe(item.id, fromFrame, toFrame));
  };
  const setRowTweenEase = (key: string, keyframeId: string, easeIn: number, easeOut: number) => {
    if (isGroupRow(key)) { editGroupKeyframes(groupOfRow(key), (keys) => keys.map((item) => (item.id === keyframeId ? { ...item, tween: { easeIn, easeOut } } : item))); return; }
    const owner = rowMembers(key).find((item) => (item.keyframes || []).some((frame) => frame.id === keyframeId));
    setTweenEase(owner?.id || key, keyframeId, easeIn, easeOut);
  };
  const rowFrameAction = (action: FrameAction, keys: string | string[], from: number, to: number) => {
    const list = Array.isArray(keys) ? keys : [keys];
    // A group's row: its keyframes and tweens are the group's own motion.
    const motionAction = action === "keyframe" || action === "clear-keyframe" || action === "tween" || action === "remove-tween";
    if (motionAction) list.filter(isGroupRow).forEach((key) => groupFrameAction(groupOfRow(key), action, from, to));
    const rest = motionAction ? list.filter((key) => !isGroupRow(key)) : list;
    if (!rest.length) return;
    const ids = rest.flatMap((key) => { const members = rowMembers(key).map((item) => item.id); return members.length ? members : [key]; });
    frameAction(action, ids, from, to);
  };
  // Keys (K, F5–F7) and Delete name timeline rows too: a merged layer's row is all its objects.
  frameActionRef.current = rowFrameAction;
  // Inside a ⌘G group the timeline lists only the group's layers; inside a character (double-click),
  // only the layer that holds it.
  const rows = draft ? timelineRows(draft.objects, enteredObjectGroup) : [];
  const insideCharacterKey = selected?.type === "character" && (characterIsolated || activeCharacterPart) ? rowKeyOf(selected, enteredObjectGroup) : null;
  const rowSourceDurations: Record<string, number> = { ...sourceDurations };
  for (const row of rows) if (!(row.id in rowSourceDurations)) { const first = rowMembers(row.id).find((item) => sourceDurations[item.id]); if (first) rowSourceDurations[row.id] = sourceDurations[first.id]; }
  const rowMemberCounts: Record<string, number> = Object.fromEntries(rows.map((row) => [row.id, rowMembers(row.id).length]));

  if (busy || !project || !scene || !draft) {
    return <div className="cb-loading"><div className="cb-logo-mark">CB</div><strong>Loading CB Studio</strong><span>{loadError}</span></div>;
  }

  return (
    <main className="cb-editor-shell">
      <input ref={importInputRef} type="file" accept="image/*,audio/*" hidden onChange={(event) => {
        const file = event.currentTarget.files?.[0];
        if (file) void importToStage(file);
        event.currentTarget.value = "";
      }} />
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
      {textPanelOpen && (
        <TextPanel values={textTarget || textDefaults} installed={installedFamilies} textToolActive={activeTool === "text"} anchorRef={textRailRef}
          onTextTool={() => { setActiveTool("text"); setRailHighlight("text"); }} onChange={applyTextPatch}
          onPickFace={(family, face) => void pickFontFace(family, face)} onClose={() => setTextPanelOpen(false)} />
      )}
      {editingLayer && (
        <TextColourPalette colour={editingLayer.fillColor || "#ffffff"} onPick={(hex) => applyTextPatch({ fillColor: hex })}
          effects={{ stroke: Boolean(editingLayer.textStrokeColor), shadow: Boolean(editingLayer.textShadowColor) }}
          // Fill/Stroke › Create: the text colour, plus an outline / a shadow in it when ticked (unticked removes them).
          onFillStroke={(hex, effects) => applyTextPatch({
            fillColor: hex,
            textStrokeColor: effects.stroke ? hex : undefined,
            textShadowColor: effects.shadow ? hex : undefined,
            ...(effects.shadow ? {} : { textShadow: false }),
          })} />
      )}
      {exportOpen && <ExportPanel portrait={Boolean(project && project.height > project.width)} onClose={() => setExportOpen(false)} onExport={(format, resolution) => void beginExport(format, resolution)} />}
      {transformOpen && (
        <TransformPanel read={readTransform} onChange={changeTransform} onClose={() => setTransformOpen(false)} shortcut={transformShortcut}
          reference={transformReference} onReference={(rx, ry) => setTransformReference({ rx, ry })}
          linked={transformLinked} onLinked={setTransformLinked} scaleStrokes={transformScaleStrokes} onScaleStrokes={setTransformScaleStrokes} />
      )}
      {scaleRotateOpen && <ScaleRotateDialog onApply={applyScaleRotate} onClose={() => setScaleRotateOpen(false)}
        target={selectedObjectIds.length === 1 && selected?.type === "character" && activeCharacterPart ? partLabel(selected, activeCharacterPart) : undefined} />}

      <div className="cb-editor-grid" ref={editorGridRef} style={{
        ...(timelineHeight ? { ["--cb-timeline-height" as string]: `max(120px, min(${timelineHeight}px, calc(100dvh - 396px)))` } : {}),
        ...(sidePanelWidth ? { ["--cb-side-panel-width" as string]: `min(${sidePanelWidth}px, 50vw)` } : {}),
      }}>
        <aside className="cb-tool-rail">
          {/* Tool groups (Illustrator): a corner mark means more inside — hold, or click the mark. */}
          <ToolGroup label="Edit" panelTitle="Edit"
            icon={lastEditTool === "scale" ? <ScaleIcon /> : lastEditTool === "reflect" ? <ReflectIcon /> : <SelectIcon />}
            active={railHighlight === "edit"} onPress={() => setRailHighlight("edit")}
            title={lastEditTool === "scale" ? "Scale tool (S)" : lastEditTool === "reflect" ? "Reflect tool (O), then Enter for the Reflect dialog" : "Selection tool (V): click to select (Shift+click adds), drag to move; handles scale, rotate, stretch and skew"}
            onPrimary={() => setActiveTool(lastEditTool)}
            items={[
              // One dark box: Transform while its panel is open, else the current tool.
              { id: "select", label: "Select", shortcut: "V", icon: <SelectIcon />, active: !transformOpen && activeTool === "select", onSelect: () => setActiveTool("select") },
              { id: "scale", label: "Scale", shortcut: "S", icon: <ScaleIcon />, active: !transformOpen && activeTool === "scale", onSelect: () => setActiveTool("scale") },
              { id: "reflect", label: "Reflect", shortcut: "O", icon: <ReflectIcon />, active: !transformOpen && activeTool === "reflect", onSelect: () => setActiveTool("reflect") },
              { id: "transform", label: "Transform", shortcut: spacedShortcut(transformShortcut), icon: <TransformIcon />, active: transformOpen, title: "Open or close the Transform panel", onSelect: () => setTransformOpen((open) => !open) },
            ]} />
          <ToolGroup label="File" panelTitle="File" icon={<FileIcon />} buttonRef={openButtonRef} active={railHighlight === "file"} onPress={() => setRailHighlight("file")} title="New, open, save or export the project"
            items={[
              { id: "save", label: "Save", shortcut: "⌘ S", icon: <SaveIcon />, title: "Save to a .cb file on this device", onSelect: () => void save() },
              { id: "import", label: "Import", shortcut: "⌘ I", icon: <ImportIcon />, title: "Import to the stage or the library",
                submenu: [
                  { id: "stage", label: "Import to Stage…", shortcut: "⌘R", title: "A picture (a layer you can select and transform) or a sound", onSelect: () => importInputRef.current?.click() },
                  { id: "library", label: "Import to Library…", disabled: true, note: "Coming soon", onSelect: () => comingSoon("Import to Library") },
                  { id: "external", label: "Open External Library…", shortcut: "⇧⌘O", disabled: true, note: "Coming soon", onSelect: () => comingSoon("Open External Library") },
                  { id: "video", label: "Import Video…", disabled: true, note: "Coming soon", onSelect: () => comingSoon("Import Video") },
                ] },
              { id: "export", label: render?.status === "running" ? `Exporting ${render.progress}%` : render?.status === "queued" ? "Queued…" : "Export", shortcut: render?.status === "running" || render?.status === "queued" ? undefined : "⌘ E", icon: <ExportIcon />, disabled: render?.status === "queued" || render?.status === "running", title: "Export as MP4, GIF, JPEG or PNG", onSelect: exportVideo },
              { id: "save-as", label: "Save As", shortcut: "⌘ ⇧ S", icon: <SaveAsIcon />, title: "Save to a new .cb file", onSelect: () => void save(true) },
              { id: "open", label: "Open file", shortcut: "⌘ O", icon: <OpenFileIcon />, title: "Recent projects, or open a .cb file from this device", onSelect: () => { if (!openPanel) toggleOpenPanel(); } },
              { id: "new", label: "New file", shortcut: transformShortcut === "⌘T" ? "⌘ N" : "⌥ ⌘ N", icon: <NewFileIcon />, title: "Start a new project", onSelect: newFile },
            ]} />
          <ToolGroup label="Text" icon={<TextIcon />} active={railHighlight === "text"} onPress={() => setRailHighlight("text")} buttonRef={textRailRef}
            title="Text tool (T): click the canvas to type; double-click, hold, or T then Return, for the Text panel"
            onPrimary={() => setActiveTool("text")} onOpenPanel={() => setTextPanelOpen((open) => !open)} panelOpen={textPanelOpen} />
          <ToolGroup label="Colour" panelTitle="Colour" panelClassName="cb-colour-flyout" icon={<ColourIcon />} active={railHighlight === "colour"} onPress={() => setRailHighlight("colour")} title="Colour: light/dark, fill and stroke, find and replace, adjust colour and the colour dropper"
            items={[
              { id: "light-dark", label: "Light/Dark", shortcut: "⌘ L", icon: <LightDarkIcon />, active: activeTool === "tone", title: "Light/Dark: click colours on the selected character, or a text layer, to make them lighter or darker (Option reverses)", onSelect: () => { setActiveTool("tone"); setRailHighlight("colour"); } },
              { id: "fill-stroke", label: "Fill/Stroke", shortcut: "<", icon: <FillStrokeIcon />, title: "Fill/Stroke: choose a colour for the selection (text: with an outline or a shadow)", onSelect: openFillStroke },
              { id: "find-replace", label: "Find/Replace", shortcut: "⇧⌘F", icon: <FindReplaceIcon />, active: findReplaceOpen, title: "Find and Replace: colour, text or font", onSelect: () => setFindReplaceOpen(true) },
              { id: "adjust", label: "Adjust colour", shortcut: "⌘ J", icon: <AdjustColourIcon />, active: Boolean(adjust), title: "Adjust colour balance of the selected character or text", onSelect: openAdjust },
              { id: "dropper", label: "Colour Dropper", shortcut: "i", icon: <EyedropperIcon />, active: activeTool === "eyedropper", title: "Colour Dropper: click the canvas to copy a colour (or a text layer's style) onto the selection", onSelect: () => { setActiveTool("eyedropper"); setRailHighlight("colour"); } },            ]} />
          <ToolGroup label="Align" panelTitle="Align" panelClassName="cb-align-flyout" icon={<AlignIcon />} active={railHighlight === "align"} onPress={() => setRailHighlight("align")} title="Align and distribute the selected layers"
            items={[
              { id: "left", label: "Left", icon: <AlignLeftIcon />, keepOpen: true, onSelect: () => runAlign("left") },
              { id: "hcenter", label: "Centre", icon: <AlignHCenterIcon />, keepOpen: true, onSelect: () => runAlign("hcenter") },
              { id: "right", label: "Right", icon: <AlignRightIcon />, keepOpen: true, onSelect: () => runAlign("right") },
              { id: "top", label: "Top", icon: <AlignTopIcon />, keepOpen: true, onSelect: () => runAlign("top") },
              { id: "vcenter", label: "Middle", icon: <AlignVCenterIcon />, keepOpen: true, onSelect: () => runAlign("vcenter") },
              { id: "bottom", label: "Bottom", icon: <AlignBottomIcon />, keepOpen: true, onSelect: () => runAlign("bottom") },
              { id: "hdistribute", label: "Distribute ↔", icon: <DistributeHIcon />, keepOpen: true, title: "Space the centres evenly from left to right (3 or more layers)", onSelect: () => runAlign("hdistribute") },
              { id: "vdistribute", label: "Distribute ↕", icon: <DistributeVIcon />, keepOpen: true, title: "Space the centres evenly from top to bottom (3 or more layers)", onSelect: () => runAlign("vdistribute") },
            ]}>
            <label className="cb-align-to-stage" title="Off: two or more layers align to each other (one layer always aligns to the stage)">
              <input type="checkbox" checked={alignToStage} onChange={(event) => setAlignToStage(event.target.checked)} /> Align to stage
            </label>
          </ToolGroup>
        </aside>
        {activeTool === "tone" && (
          <div className="cb-light-dark" style={{ left: toneBarPosition.left, top: toneBarPosition.top }} role="dialog" aria-label="Light/Dark">
            <header><PanelClose onClose={() => setActiveTool("select")} label="Close Light/Dark" />Light/Dark</header>
            <div className="cb-light-dark-body">
              <div className="cb-light-dark-toggle" role="radiogroup" aria-label="Direction">
                <button type="button" role="radio" className={toneDarkNow ? "active" : ""} aria-checked={toneDirection === "dark"} onClick={() => setToneDirection("dark")}>Dark</button>
                <button type="button" role="radio" className={!toneDarkNow ? "active" : ""} aria-checked={toneDirection === "light"} onClick={() => setToneDirection("light")}>Light</button>
              </div>
              <div className="cb-light-dark-checks">
                <label><input type="checkbox" checked={toneStroke} onChange={(event) => setToneStroke(event.target.checked)} /> Include Stroke</label>
                <label title="Text shadows"><input type="checkbox" checked={toneShadow} onChange={(event) => setToneShadow(event.target.checked)} /> Include Shadow</label>
              </div>
              <p>Select a character first, then click its colours{selected?.type === "character" && activeCharacterPart ? " (selected part only)" : ""}, or click a text layer. Include Stroke: its outlines change too; Include Shadow: its shadows change too, in the same ratio. Press Option for reverse, Shift for a small step.</p>
            </div>
          </div>
        )}
        {textFillStrokeOpen && textTarget && (
          <ColourPicker initial={normalizeHex(textTarget.fillColor) || "#ffffff"}
            effects={{ stroke: Boolean(textTarget.textStrokeColor), shadow: Boolean(textTarget.textShadowColor) }}
            onOk={(hex, effects) => {
              setTextFillStrokeOpen(false);
              applyTextPatch({ fillColor: hex, textStrokeColor: effects?.stroke ? hex : undefined, textShadowColor: effects?.shadow ? hex : undefined, ...(effects?.shadow ? {} : { textShadow: false }) });
            }}
            onCancel={() => setTextFillStrokeOpen(false)} />
        )}
        {adjust && (
          <AdjustColourDialog hasShadow={adjust.hasShadow} targetLabel={adjust.label} onPreview={previewAdjust} onCreate={createAdjust} onCancel={cancelAdjust} />
        )}
        {boxPicker && (boxPicker === "fill" ? boxState.fill : boxState.stroke) && (
          <ColourPicker
            initial={(boxPicker === "fill" ? boxState.fill : boxState.stroke) || "#000000"}
            effects={boxState.kind === "character" ? boxEffects : undefined}
            effectsNote={boxState.kind === "background" ? "The stage background has no outline or shadow" : "A picture has no outline or shadow"}
            onOk={(hex, chosen) => { if (chosen) setBoxEffects(chosen); applyBoxColour(boxPicker, hex, chosen); setBoxPicker(null); }}
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

        <section className="cb-workspace" ref={workspaceRef}>
          <div className="cb-panel-border-y" role="separator" aria-orientation="horizontal" aria-label="Resize the timeline"
            title="Drag to resize the timeline · double-click for the default size"
            onPointerDown={(event) => beginBorderDrag(event, "y")} onDoubleClick={() => resetBorder("y")} />
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
            {/* New / Open / Save / Export live in the tool rail's File group; only the export status stays here. */}
            <div className="cb-editor-project-actions">
              <Popover open={openPanel} anchorRef={openButtonRef} onClose={() => setOpenPanel(false)} placement="right" offset={10} className="cb-open-panel" aria-label="Open project">
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
              {/* Export progress (mockup): the finished file goes straight to the chosen folder, so no Download link. */}
              {(render?.status === "queued" || render?.status === "running") && (
                <span className="cb-export-progress" role="progressbar" aria-label={`Creating ${exportExtension(renderFormat)}`}
                  aria-valuemin={0} aria-valuemax={100} aria-valuenow={render.status === "queued" ? 0 : render.progress}>
                  {render.status === "queued" ? "Waiting…" : `Creating ${exportExtension(renderFormat)}`}
                  <i><b style={{ width: `${render.status === "queued" ? 0 : render.progress}%` }} /></i>
                  <em>{render.status === "queued" ? "" : `${render.progress}%`}</em>
                </span>
              )}
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
            {selected?.type === "character" && (characterIsolated || activeCharacterPart) && !symbolView && (() => {
              // Illustrator's isolation bar: where you are inside the character; a name goes back to it.
              const container = partReplacementBrowserOpen ? activeCharacterPart || "" : (() => {
                const parents = Array.from(new Set(partMembers(activeCharacterPart).map(parentPartKey)));
                return parents.length === 1 ? parents[0] : "";
              })();
              const segments = container ? container.split("/") : [];
              const title = (segment: string) => segment.replace(/^shape(_\d+)?.*$/i, "Shape").replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (letter) => letter.toUpperCase());
              const group = enteredGroupId ? (selected.partGroups || []).find((item) => item.id === enteredGroupId) : null;
              return (
                <nav className="cb-isolation-bar" aria-label="Inside the character">
                  <button type="button" className="cb-isolation-back" onClick={stepOutPartIsolation} title="Back one level (Esc, or double-click empty canvas)" aria-label="Back one level">
                    <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M7 3 2 8l5 5M2.5 8H14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
                  </button>
                  <svg className="cb-isolation-icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 5.5 8 3l5.5 2.5L8 8zM2.5 8.5 8 11l5.5-2.5M2.5 11.5 8 14l5.5-2.5" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" /></svg>
                  <button type="button" className={!segments.length && !group ? "current" : ""} onClick={() => goToPartLevel("")}>{selected.name}</button>
                  {segments.map((segment, index) => {
                    const level = segments.slice(0, index + 1).join("/");
                    return (
                      <span key={level}>
                        <i aria-hidden="true">›</i>
                        <button type="button" className={index === segments.length - 1 && !group ? "current" : ""} onClick={() => goToPartLevel(level)}>{title(segment)}</button>
                      </span>
                    );
                  })}
                  {group && <span><i aria-hidden="true">›</i><button type="button" className="current">{group.name}</button></span>}
                </nav>
              );
            })()}
            {enteredObjectGroup && !(selected?.type === "character" && (characterIsolated || activeCharacterPart)) && !symbolView && (
              <nav className="cb-isolation-bar" aria-label="Inside the group">
                <button type="button" className="cb-isolation-back" onClick={stepOutObjectGroup} title="Out of the group (Esc, or double-click empty canvas)" aria-label="Out of the group">
                  <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M7 3 2 8l5 5M2.5 8H14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
                </button>
                <svg className="cb-isolation-icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 5.5 8 3l5.5 2.5L8 8zM2.5 8.5 8 11l5.5-2.5M2.5 11.5 8 14l5.5-2.5" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" /></svg>
                <button type="button" onClick={stepOutObjectGroup}>{scene.name || "Scene"}</button>
                <span><i aria-hidden="true">›</i><button type="button" className="current">{draft.objects.find((item) => item.group === enteredObjectGroup)?.groupName || "Group"}</button></span>
              </nav>
            )}
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
              toolMode={activeTool === "scale" ? "scale" : activeTool === "zoom" ? "zoom" : activeTool === "text" ? "text" : "transform"}
              editingText={editingText}
              onCreateText={createTextAt}
              onEditText={startTextEdit}
              onTextInput={typeText}
              onTextEditEnd={() => endTextEdit(true)}
              textSizeRef={textSizeRef}
              transparencyGrid={transparencyGrid}
              clipToStage={clipToStage}
              isPlaying={isPlaying}
              playhead={playhead}
              onSelect={selectFromCanvas}
              onMove={moveObject}
              onMoveMany={moveObjects}
              onDuplicateMoved={duplicateMovedObjects}
              onTransform={transformObject}
              onTransformMany={transformObjects}
              enteredObjectGroup={enteredObjectGroup}
              onEnterObjectGroup={enterObjectGroup}
              onObjectGroupStepOut={stepOutObjectGroup}
              onSetGroupPivot={setGroupPivot}
              activeCharacterPart={selected?.type === "character" ? activeCharacterPart : null}
              onMoveCharacterPart={moveCharacterPart}
              onTransformCharacterPart={transformCharacterPart}
              onSetCharacterPartPivot={setCharacterPartPivot}
              onActiveCharacterPart={handleActiveCharacterPart}
              onCharacterPartDoubleClick={handleCharacterPartDoubleClick}
              characterPartEntered={selected?.type === "character" && Boolean(activeCharacterPart) && partReplacementBrowserOpen}
              frameAccessRef={frameAccessRef}
              viewCenterRef={viewCenterRef}
              layerGeometryRef={layerGeometryRef}
              blockDoubleClick={stageColourTool || boxPicking || Boolean(frPicking)}
              symbolView={stageSymbolView}
              characterIsolated={characterIsolated && selected?.type === "character"}
              onTogglePartSelection={togglePartSelection}
              onPartsInBox={selectPartsInBox}
              onIsolationEmptyClick={isolationEmptyClick}
              onIsolationStepOut={stepOutPartIsolation}
              onTransformCharacterParts={transformCharacterParts}
              onSymbolDoubleClick={symbolDoubleClick}
              onSymbolDragStart={beginSymbolDrag}
              onSymbolHandleStart={beginSymbolHandle}
              onSymbolBoxSelect={selectPoseParts}
              onSymbolDeselect={() => setPickedPart(null)}
              onSymbolContext={(action) => {
                if (["cut", "copy", "paste", "pasteFront", "pasteBack", "forward", "backward", "toFront", "toBack"].includes(action)) { symbolContextClipRef.current?.(action); return; }
                const level = symbolLevelNow, ids = pickedLayerIds(), index = ids.length ? ids[0] : -1;
                if (index < 0) return;
                if (action === "delete") { symbolDeleteRef.current?.(); return; }
                if (action === "flipH" || action === "flipV") { symbolFlipRef.current?.(action === "flipH" ? "h" : "v"); return; }
                if (action === "group" || action === "ungroup") { symbolGroupRef.current?.(action === "ungroup"); return; }
                if (action === "pivot") { symbolPivotResetRef.current?.(); return; }
                if (action === "duplicate") { duplicateSymbolLayers(ids); return; }
                void level;
                setLayerEdit((current) => (action === "hide" ? { ...current, hidden: toggled(current.hidden, ids) } : { ...current, locked: toggled(current.locked, ids) }));
              }}
              symbolBox={symbolBox}
              onSymbolPivotReset={() => void symbolPivotResetRef.current?.()}
              onEnterSymbol={(id) => void enterSymbol(id)}
              canEnterSymbol={(id) => {
                const object = draft?.objects.find((item) => item.id === id);
                const action = object?.type === "character" ? characterLibraryActions.find((item) => item.assetUrl === object.assetUrl) : null;
                return Boolean(action?.flaTimeline && action.flaSymbol);
              }}
              onDistributeParts={(mode) => void distributeRef.current(mode)}
              colorPickActive={stageColourTool || Boolean(frPicking) || boxPicking}
              colorPickCursor={frPicking || boxPicking || activeTool === "eyedropper" ? "pick" : toneDarkNow ? "darken" : "lighten"}
              onColorPick={handleStageColorPress}
              onCharacterPartsReady={setCharacterPartsReady}
              zoom={canvasZoom}
              onZoomChange={(value) => setCanvasZoom(clampCanvasZoom(value))}
              onFitScaleChange={setCanvasFitScale}
              viewResetRevision={canvasViewResetRevision}
            />
          </div>

          {symbolView ? (() => {
            const object = draft.objects.find((item) => item.id === symbolView.objectId);
            const current = symbolView.levels[symbolView.levels.length - 1];
            const crumbs = [scene.name || "Scene", object?.name || "Character", object?.actionName || current.data.name,
              ...symbolView.levels.slice(1).map((level) => level.data.name.split("/").pop() || level.data.name)];
            return (
              <>
              <SymbolTimeline
                key={symbolView.levels.length}
                crumbs={crumbs}
                symbol={current.data}
                frame={current.frame}
                playing={symbolView.playing}
                layerEdit={object?.symbolLayers?.[current.js]}
                onLayerEdit={setLayerEdit}
                onDuplicateLayers={duplicateSymbolLayers}
                onListLibrary={listPoseLibrary}
                onAddSymbol={addLibrarySymbol}
                onAddPicture={(item, above) => void addLibraryPicture(item, above)}
                onUploadPicture={(file, above) => void uploadPosePicture(file, above)}
                onNotice={showNotice}
                eases={object?.symbolEases?.[current.js]}
                keys={object?.symbolKeys?.[current.js]}
                editable={keysEditable?.js === current.js ? keysEditable.editable : undefined}
                values={object?.symbolValues?.[current.js]}
                keyValues={keyValues}
                pickedProp={pickedProp}
                pickedProps={selectedProps}
                onPickLayers={(ids) => {
                  const level = symbolView ? symbolView.levels[symbolView.levels.length - 1] : null;
                  setPartSelection(ids.map((index) => level?.data.layers[index]?.props?.[0]).filter((prop): prop is string => Boolean(prop)));
                }}
                onFrameOp={runFrameOp}
                canPaste={clipboardFilled}
                onSelectLayer={(index) => {
                  const level = symbolView ? symbolView.levels[symbolView.levels.length - 1] : null;
                  const prop = index != null ? level?.data.layers[index]?.props?.[0] : null;
                  setPickedPart(prop && symbolView ? { objectId: symbolView.objectId, prop } : null);
                }}
                onSelectKey={askKeyValues}
                onSetValue={setSymbolValue}
                onSetKeys={setSymbolKeys}
                onPreviewKeys={previewSymbolKeys}
                onSeek={seekSymbol}
                onSetEase={setSymbolEase}
                onPreviewEase={previewSymbolEase}
                onSetTweenEase={setMadeTweenEase}
                onCopyKey={(fromLayer, fromFile, toLayer, at) => void copyKeyframe(fromLayer, fromFile, toLayer, at)}
                onPreviewTweenEase={previewTweenEase}
                onPlay={() => setSymbolView((state) => (state ? { ...state, playing: !state.playing } : state))}
                // Scene and the character's name step all the way out; a symbol steps back to it.
                onCrumb={(index) => setSymbolView((state) => (!state || index < 2 ? null : { ...state, playing: false, hidden: new Set(), levels: state.levels.slice(0, index - 1) }))}
                onStepInto={(layerIndex, frame, js) => void stepIntoSymbol(layerIndex, frame, js)}
                onNative={() => void openNativeEditor()}
              />
              {nativeEdit && nativeEdit.objectId === symbolView.objectId && (
                <NativePoseDialog
                  flaUrl={nativeEdit.flaUrl} item={nativeEdit.item} title={nativeEdit.title}
                  initial={object?.nativePose?.[nativeEdit.js]}
                  onCancel={() => setNativeEdit(null)}
                  onDone={(edits) => {
                    const target = nativeEdit;
                    setNativeEdit(null);
                    const fit = playerFitOf(frameAccessRef.current?.(target.objectId));
                    mutate((data) => {
                      const placed = data.objects.find((item) => item.id === target.objectId);
                      if (!placed) return;
                      const all = { ...(placed.nativePose || {}) };
                      if (edits) all[target.js] = edits; else delete all[target.js];
                      if (Object.keys(all).length) placed.nativePose = all; else delete placed.nativePose;
                      if (!placed.nativePose) delete placed.nativePoseFit; else if (fit) placed.nativePoseFit = fit;
                    });
                    showNotice(edits ? "Native edits saved on this character. The scene preview does not show them yet." : "No native edits on this pose.");
                  }}
                />
              )}
              </>
            );
          })() : (
          <Timeline
            scenes={project.scenes}
            activeId={scene.id}
            layers={insideCharacterKey ? rows.filter((row) => row.id === insideCharacterKey) : rows}
            selectedObjectId={selected ? rowKeyOf(selected, enteredObjectGroup) : null}
            onEnterGroup={enterGroupRow}
            onSelectLayers={selectRows}
            isPlaying={isPlaying}
            playhead={playhead}
            activeDuration={duration}
            onSelect={changeScene}
            onSelectLayer={selectRow}
            onAdd={addScene}
            onSeek={(seconds) => setPlayhead(Math.max(0, Math.min(duration, seconds)))}
            onPlay={() => { if (!isPlaying && atLastFrame) setPlayhead(0); setPlaying(!isPlaying); }}
            onAddKeyframe={(id, time) => addOrUpdateCharacterKeyframe(id, time)}
            onImportAudio={() => voiceUploadRef.current?.click()}
            onCreateMotion={(id) => createMotion(id)}
            onReorderLayers={reorderLayers}
            onMoveFramesToLayer={moveFramesToLayer}
            onDeleteLayer={deleteRow}
            onUpdateLayerTiming={updateRowTiming}
            onToggleLayerLoop={toggleRowLoop}
            onClipDragChange={onClipDragChange}
            frameSelection={frameSelection}
            onSelectFrames={selectFrames}
            onFrameAction={rowFrameAction}
            onMoveKeyframe={moveRowKeyframe}
            onSetTweenEase={setRowTweenEase}
            onAddLayer={addLayer}
            onToggleLayerHidden={(id) => toggleRowFlag(id, "hidden")}
            onSoloLayer={soloRow}
            onRenameLayer={renameRow}
            onRenameObject={renameRowObject}
            onToggleLayerLocked={(id) => toggleRowFlag(id, "locked")}
            onMergeLayers={(keys) => mergeLayers(keys)}
            onSplitLayers={splitLayers}
            layerMemberCounts={rowMemberCounts}
            sourceDurations={rowSourceDurations}
          />
          )}
        </section>
        <div className="cb-panel-border-x" role="separator" aria-orientation="vertical" aria-label="Resize the side panel"
          title="Drag to resize the panel · double-click for the default size"
          onPointerDown={(event) => beginBorderDrag(event, "x")} onDoubleClick={() => resetBorder("x")} />

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
            onDelete={() => deleteLayer(selected.id)}
          />
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
