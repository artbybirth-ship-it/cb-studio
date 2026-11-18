"use client";

/**
 * The native pose editor in place in the scene editor (Phase 6, single timeline): a double-click on a character whose Animate file (.fla)
 * is available opens its pose here, the drawing over the canvas area and the toolbar and timeline in the timeline row. It loads the .fla,
 * converts older edits the first time (when every one of them converts), and saves every change on the placed character as it is made
 * (object.nativePose), so there is no Done: Undo takes changes back. Characters without a .fla keep the older pose timeline.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import NativePoseEditor, { type NativeColourFrame } from "./NativePoseEditor";
import { loadNativeDoc, type NativeLoaded } from "../lib/native/loadDoc";
import { registerLibrary } from "../lib/native/library";
import { editsOf, type NativeEdits } from "../lib/native/store";
import { convertLegacy, symbolOfClass, type LegacyFields } from "../lib/native/legacy";
import { buildClones, pastedClassMap } from "../lib/native/legacyClones";
import type { ColourRule } from "../lib/native/colour";

export default function NativePoseInPlace({ flaUrl, item, poseName, js, initial, legacy, colours, uploadPicture, hosts, crumbs, onStepOut, onSave, colourPick, onColourFrame, onScope, pointTool, onPointTool, onNotice, history, zoom, onZoom, onFitScale, viewReset, zoomTool, playToggle }: {
  flaUrl: string; item: string; poseName: string;
  /** The pose's class in the player (what old edits and colour rules call it). */
  js: string;
  /** The edits saved on the character before this visit. */
  initial?: NativeEdits | null;
  /** What older versions saved inside this character: converted the first time the pose opens here (when it has no native edits). */
  legacy?: LegacyFields;
  /** The character's colour rules: the pose is drawn in the character's colours. */
  colours?: ColourRule[];
  uploadPicture?: (file: File) => Promise<string>;
  /** Where the stage and the timeline go. */
  hosts: { stage: HTMLElement; timeline: HTMLElement };
  crumbs: string[];
  onStepOut: () => void;
  /** Every change, as the edits now are (null: nothing edited any more). */
  onSave: (edits: NativeEdits | null) => void;
  colourPick?: ((clientX: number, clientY: number, keys: { altKey: boolean; shiftKey: boolean }) => void) | null;
  onColourFrame?: (frame: NativeColourFrame | null) => void;
  /** The colour scope of the parts picked in the editor (null: the whole character). */
  onScope?: (scope: string | null) => void;
  /** Point editing follows the scene's Direct select tool, and tells it when it is turned on or off here. */
  pointTool?: boolean;
  onPointTool?: (on: boolean) => void;
  /** Messages for the scene's notice (the timeline panel has no line of its own). */
  onNotice?: (text: string) => void;
  /** The scene's one Undo / Redo (each change here is one step of it); `turn` changes after each, and the editor takes the edits again. */
  history: { turn: number; undo: () => void; redo: () => void };
  /** The scene editor's view of the pose (⌘+ / ⌘− / ⌘0 / ⌘1, the zoom box, the Zoom tool): see NativePoseEditor. */
  zoom?: number;
  onZoom?: (zoom: number) => void;
  onFitScale?: (scale: number) => void;
  viewReset?: number;
  zoomTool?: boolean;
  /** Enter / Return in the scene editor: plays or pauses the pose. */
  playToggle?: number;
}) {
  const [loaded, setLoaded] = useState<NativeLoaded | null>(null);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState(0);
  const [converted, setConverted] = useState("");
  const [seed, setSeed] = useState<NativeEdits | null>(null);
  const coloursRef = useRef(colours);
  coloursRef.current = colours;
  // What the edits were when the pose opened: the editor starts from them (later saves come back as `initial` and must not reset it).
  const opening = useRef(initial ?? null);

  useEffect(() => {
    let alive = true;
    const start = opening.current;
    loadNativeDoc(flaUrl, (f) => alive && setProgress(f)).then(async (result) => {
      if (!alive) return;
      if (!result.doc.symbols.has(item)) { setError(`This pose ("${item}") is not in the character's Animate file.`); return; }
      if (!start && legacy) {
        // Pictures, library symbols and parts of other characters the old editor placed as layers are built first (they load files).
        const prepared: Record<string, Awaited<ReturnType<typeof buildClones>>> = {};
        for (const [cls, edit] of Object.entries(legacy.layers || {})) {
          if (!edit.clones?.some((c) => c.symbol || c.image)) continue;
          // The symbol this class names: the pose itself, or one nested in it (its clones are built in that symbol's own space).
          const at = cls === js ? item : symbolOfClass(result.doc.symbols.keys(), cls, { [js]: item });
          if (at) prepared[cls] = await buildClones(result, edit, item, result.doc.symbols.get(at)?.timeline.length || 1, at);
        }
        if (!alive) return;
        // Edits made inside a part pasted from another character name its copy in this library ("<tag>~<class>").
        const classes = [...new Set([...Object.keys(legacy.keys || {}), ...Object.keys(legacy.eases || {}), ...Object.keys(legacy.values || {}), ...Object.keys(legacy.layers || {})])];
        const pasted = await pastedClassMap(result, legacy.layers || {}, classes.filter((c) => c.includes("~")));
        if (!alive) return;
        const made = convertLegacy(result.doc.symbols, legacy, { [js]: item, ...pasted }, prepared);
        // The native drawing replaces the player for the whole character, so it is only taken over when every old edit converted.
        if (Object.keys(made.symbols).length && !made.left.length) {
          setSeed(editsOf(result.doc, new Map(Object.entries(made.symbols))));
          setConverted(`Older edits on this character were converted (${made.converted.join(", ")}); they are kept once you change something.`);
        } else if (made.left.length) setConverted(`Older edits were not converted, so this character keeps using them as they are: ${made.left.join("; ")}.`);
      }
      registerLibrary(result, start?.library).then(() => {
        if (!alive) return;
        result.renderer.classes.set(item, js);
        result.renderer.setColourRules(coloursRef.current);
        setLoaded(result);
      }, (e) => alive && setError(e instanceof Error ? e.message : String(e)));
    }).catch((e) => alive && setError(e instanceof Error ? e.message : String(e)));
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flaUrl, item]);

  // The character's colours, live (Light/Dark, Fill/Stroke, Find and Replace made while inside the pose).
  const coloursKey = JSON.stringify(colours || []);
  // Before the editor's own redraw (a layout effect runs before every passive one), so it draws with the new colours.
  useLayoutEffect(() => { loaded?.renderer.setColourRules(colours); }, [loaded, coloursKey]); // eslint-disable-line react-hooks/exhaustive-deps
  // The shared drawing goes back to the file's own colours when the pose is left.
  useEffect(() => () => { loaded?.renderer.setColourRules(undefined); loaded?.renderer.classes.clear(); }, [loaded]);

  const onChange = useCallback((edits: NativeEdits) => { onSave(Object.keys(edits.symbols).length ? { ...edits, pose: item } : null); }, [onSave, item]);

  if (error || !loaded) {
    return createPortal(
      <div data-testid="native-loading" style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", background: "rgba(30,30,30,.55)", color: "#eee", font: "13px system-ui" }}>
        <div style={{ textAlign: "center", display: "grid", gap: 8 }}>
          <span>{error || `Opening the pose… ${Math.round(progress * 100)}%`}</span>
          {error && <button type="button" onClick={onStepOut}>Back to the scene</button>}
        </div>
      </div>, hosts.stage);
  }
  return (
    <NativePoseEditor flaUrl={flaUrl} doc={loaded.doc} renderer={loaded.renderer} poses={[{ item, name: poseName }]} initialEdits={opening.current ?? seed} onChange={onChange}
      uploadPicture={uploadPicture} embedded={hosts} crumbs={crumbs} onStepOut={onStepOut} colourPick={colourPick} onColourFrame={onColourFrame} onScope={onScope} pointTool={pointTool} onPointTool={onPointTool} onNotice={onNotice} redrawKey={coloursKey} note={converted}
      zoom={zoom} onZoom={onZoom} onFitScale={onFitScale} viewReset={viewReset} zoomTool={zoomTool} playToggle={playToggle}
      sceneHistory={{ turn: history.turn, edits: initial ?? seed, undo: history.undo, redo: history.redo }} />
  );
}
