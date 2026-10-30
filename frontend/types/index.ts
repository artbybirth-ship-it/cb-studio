/** "empty" = a timeline layer with only a blank keyframe (nothing placed yet; never rendered). */
export type EditorObjectType = "character" | "text" | "background" | "audio" | "prop" | "empty";
export type EditorAssetKind = "placeholder" | "animate-createjs" | "image" | "audio";

/** Character-part keys come from each source character manifest. */
export type CharacterPartKey = string;

/**
 * One recolour rule on a character's vector artwork. Colours are matched on the ORIGINAL artwork, so
 * rules never chain; for a colour the last matching rule wins, and part rules beat whole-character ones.
 * "shades" moves the whole colour family (its lighter/darker shades keep their offset).
 */
export type ColorReplacement = {
  id: string;
  from: string;
  to: string;
  target: "fill" | "stroke" | "both";
  /** "*" = whole character, otherwise a part key (e.g. "head", "lungi"). */
  scope: string;
  match: "exact" | "shades";
};

export type CharacterPartOverride = {
  visible?: boolean;
  /** Extra edit transform layered on top of the original source timeline. */
  offsetX?: number;
  offsetY?: number;
  rotation?: number;
  /** Extra uniform scale applied to the selected body-part group. 1 = original size. */
  scale?: number;
  /** Horizontal mirror applied only to this body-part group. */
  flipX?: boolean;
  /** Skew of this body-part group in degrees (applied after scale, before rotation), about its registration point. */
  skewX?: number;
  skewY?: number;
  /** Width / height stretch on top of `scale`, along the part's own axes (the part box's side handles). 1 = none. */
  stretchX?: number;
  stretchY?: number;
  /** Whether this source part follows its original Animate timeline. False freezes only this part. */
  animate?: boolean;
  /** Same-character variant drawn in place of this part, by library symbol name (e.g. "Headcopy5"). */
  swapSymbol?: string;
  /** Registration point as a fraction of the part's box (0..1, may lie outside); default 0.5 / 1 = bottom-centre. */
  pivotX?: number;
  pivotY?: number;
};

export type CharacterPartKeyframe = {
  id: string;
  /** Seconds from the start of the scene. */
  time: number;
  offsetX: number;
  offsetY: number;
  rotation: number;
  scale?: number;
  flipX?: boolean;
  /** Skew in degrees, relative to the part's base edit like the other keyframe values. */
  skewX?: number;
  skewY?: number;
  /** Width / height stretch, relative to the part's base edit like `scale`. */
  stretchX?: number;
  stretchY?: number;
  easing?: "linear" | "easeIn" | "easeOut" | "easeInOut";
  generatedBy?: "ai" | "manual";
};

export type CharacterPartDescriptor = {
  key: CharacterPartKey;
  label: string;
  thumb: string;
};

export type CharacterColorOverrides = Record<string, string>;

export type CharacterPartReplacement = {
  assetUrl: string;
  name?: string;
  renderKind?: "image" | "source-symbol";
};

export type CharacterKeyframe = {
  id: string;
  /** Seconds from the start of the scene. */
  time: number;
  x: number;
  y: number;
  scale?: number;
  rotation?: number;
  generatedBy?: "ai" | "manual";
  /** Animate tween from this keyframe to the next: an ease object = tween (ease in 0..100 slows
   *  the start, ease out 0..100 slows the end); false = no tween, the position holds until the
   *  next keyframe. Unset (older projects, AI motion) behaves as a tween without easing. */
  tween?: { easeIn: number; easeOut: number } | false;
};

export type AnimationClip = {
  id: string;
  type: "gesture" | "move" | "talk";
  label: string;
  preset?: string;
  start: number;
  duration: number;
  generatedBy?: "ai" | "manual";
  targetCharacterId?: string | null;
};

export type SourceAnimationClip = {
  id: string;
  mode: "talk";
  start: number;
  duration: number;
};

export type ManualMotionRange = {
  id: string;
  start: number;
  end: number;
};

export type AnimationPlanAction = {
  type: "gesture" | "move" | "talk";
  characterId: string;
  preset?: string | null;
  targetCharacterId?: string | null;
  start: number;
  duration: number;
};

export type AnimationPlan = {
  duration: number;
  actions: AnimationPlanAction[];
  unsupported: string[];
};

export type AnimationPlanResponse = {
  provider: string;
  prompt: string;
  plan: AnimationPlan;
};

export type EditorObject = {
  id: string;
  type: EditorObjectType;
  name: string;
  x: number;
  y: number;
  scale?: number;
  rotation?: number;
  /** Registration (transformation) point, normalized to the selection box: 0..1 is inside,
   *  values outside are allowed (Animate lets it sit off the object). Defaults to the centre. */
  pivotX?: number;
  pivotY?: number;
  /** Animate's symbol looping for animated layers: "loop" repeats the source animation for the
   *  whole clip; "once" (the default when unset) plays it once and holds the last frame. */
  loopMode?: "loop" | "once";
  /** Timeline eye toggle: hidden in the editor (still exported, like Animate's default). */
  hidden?: boolean;
  /** Timeline lock: can't be selected or moved on the canvas. */
  locked?: boolean;
  /** Skew in degrees (Animate: drag a bounding-box edge). X slants sideways, Y up and down. */
  skewX?: number;
  skewY?: number;
  /** Non-uniform stretch in the object's own axes, on top of the uniform `scale`. Default 1. */
  stretchX?: number;
  stretchY?: number;
  /** Outline thickness factor on top of the character's size (Transform panel with "Scale Strokes
   *  & Effects" off keeps the outlines as thick as before scaling). Default 1. */
  strokeScale?: number;
  flipX?: boolean;
  text?: string;
  fillColor?: string;
  /** Text layers: font name from lib/fonts (default Arial) and size in stage px (default 52). */
  fontFamily?: string;
  fontSize?: number;
  /** Text panel (Illustrator): weight 100–900 (older text layers: 800), italic, an uploaded font file
   *  for a font from someone's computer, paragraph alignment (older layers: centre), leading in px
   *  (none = Auto, 120%), tracking in 1/1000 em, and the old drop shadow (older layers keep it). */
  fontWeight?: number;
  fontStyle?: "normal" | "italic";
  fontUrl?: string;
  textAlign?: "left" | "center" | "right";
  lineHeight?: number;
  letterSpacing?: number;
  textShadow?: boolean;
  /** Fill/Stroke (Include Stroke / Include Shadow): an outline of textStrokeWidth px (default 2)
   *  outside the letters, and a soft shadow, in these colours. */
  textStrokeColor?: string;
  textStrokeWidth?: number;
  textShadowColor?: string;
  assetKind?: EditorAssetKind;
  assetUrl?: string;
  /** Static library thumbnail for source actions. */
  previewUrl?: string;
  actionName?: string;
  characterId?: string;
  sourceFormat?: "vector-createjs" | "sprite-createjs";
  sourceWidth?: number;
  sourceHeight?: number;
  actionDurationMs?: number;
  startTime?: number;
  opacity?: number;
  volume?: number;
  mimeType?: string;
  prompt?: string;
  /** Legacy whole-character visual controls retained for old characters. */
  characterHue?: number;
  characterSaturation?: number;
  characterBrightness?: number;
  /** Whole-character position keyframes. Source body animation continues independently. */
  keyframes?: CharacterKeyframe[];
  /** Static per-source-part offsets, layered below animated part keyframes. */
  partOverrides?: Record<CharacterPartKey, CharacterPartOverride>;
  /** Prompt/manual body-part animation keyframes layered over the source Animate timeline. */
  partKeyframes?: Record<CharacterPartKey, CharacterPartKeyframe[]>;
  /** Visual/action metadata used by the timeline and AI planner. */
  animationClips?: AnimationClip[];
  /** When present, the source talking timeline only advances inside these windows. */
  sourceAnimationClips?: SourceAnimationClip[];
  /** Explicit motion range created only by the Create Motion command. */
  manualMotionRange?: ManualMotionRange | null;
  /** Source-aware colour edits. Keys are character-defined regions such as skin, shirt, hair, selectedPart. */
  colorOverrides?: CharacterColorOverrides;
  /** Vector recolour rules (Recolour panel: palette + find & replace), applied in order by the player. */
  colorReplacements?: ColorReplacement[];
  /** Runtime-detected source body parts for Archive/CreateJS actions. */
  sourceParts?: CharacterPartDescriptor[];
  /** User-supplied image replacements for selected body parts. */
  partReplacements?: Record<CharacterPartKey, CharacterPartReplacement>;
  /** True when parts were discovered automatically from the original Animate display tree. */
  autoDetectedParts?: boolean;
};

export type EditorData = {
  background: string;
  /** Legacy pre-layer background support. New backgrounds are stored in objects as type=background. */
  backgroundImage?: string | null;
  objects: EditorObject[];
};

export type Scene = {
  id: string;
  project: string;
  name: string;
  order: number;
  duration_seconds: number;
  editor_data: EditorData;
  created_at: string;
  updated_at: string;
};

export type Project = {
  id: string;
  title: string;
  width: number;
  height: number;
  status: "draft" | "rendering" | "complete";
  thumbnail_url: string;
  scenes: Scene[];
  created_at: string;
  updated_at: string;
};

export type RenderJob = {
  id: string;
  project: string;
  status: "queued" | "running" | "complete" | "failed";
  progress: number;
  output_url: string;
  error: string;
};

export type Asset = {
  id: string;
  project: string | null;
  kind: "character" | "background" | "prop" | "audio" | "font";
  name: string;
  url: string;
  metadata: Record<string, unknown>;
  created_at: string;
};
