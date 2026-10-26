"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ColourSwatch } from "./ColourPicker";
import { partLabel } from "@/lib/partLabels";
import CharacterThumb from "./CharacterThumb";
import type { ChangeEvent } from "react";
import type { CharacterPartKey, EditorObject } from "@/types";
import type { CharacterTransform } from "@/lib/keyframes";
import { resolvePartTransformAtTime } from "@/lib/partKeyframes";
import { resolveReplacementCategory } from "@/lib/partReplacementLibrary";
import { useCharacterLibrary } from "@/lib/characterLibrary";
import { symbolPlayerUrl, usePartVariants } from "@/lib/partVariants";

type Props = {
  character: EditorObject;
  activePart: CharacterPartKey | null;
  onActivePart: (key: CharacterPartKey | null) => void;
  onBack: () => void;
  /** Leaves character editing and opens the Libraries home screen. */
  onLibrariesHome: () => void;
  onPatch: (patch: Partial<EditorObject>, recordHistory?: boolean) => void;
  onDelete: () => void;
  onUploadVoice: () => void;
  canvasZoom: number;
  onCanvasZoomChange: (zoom: number) => void;
  onCanvasFit: () => void;
  playhead: number;
  duration: number;
  currentTransform: CharacterTransform;
  onAddOrUpdateKeyframe: () => void;
  onDeleteKeyframe: (keyframeId: string) => void;
  onSeek: (seconds: number) => void;
  onClearKeyframes: () => void;
  onAddOrUpdatePartKeyframe: (partKey: CharacterPartKey) => void;
  onDeletePartKeyframe: (partKey: CharacterPartKey, keyframeId: string) => void;
  onClearPartKeyframes: (partKey: CharacterPartKey) => void;
  onReplacePartAsset: (partKey: CharacterPartKey, file: File) => void;
  onClearPartReplacement: (partKey: CharacterPartKey) => void;
  onApplyLibraryReplacement: (partKey: CharacterPartKey, assetUrl: string, name: string, renderKind?: "image" | "source-symbol") => void;
  /** Swaps a part for another of the same character's variants inside the rig (null = the pose's own part). */
  onSwapPartSymbol: (partKey: CharacterPartKey, symbol: string | null) => void;
  /** Brings back a body part removed with Delete in double-click mode. */
  onRestorePart: (partKey: CharacterPartKey) => void;
  /** Opens the Recolour panel (Fill/Stroke boxes in the tool palette). */
  onOpenRecolor: () => void;
  replacementBrowserOpen: boolean;
  onReplacementBrowserOpenChange: (open: boolean) => void;
  referenceCharacterId: string;
  onReferenceCharacterChange: (id: string) => void;
  onReferenceActionChange: (actionId: string) => void;
};

type ColorRegion = { key: string; label: string; defaultColor: string };
const SWATCHES = ["#AC866D","#97745E","#422715","#CCC29C","#B3A674","#A74337","#8A342A","#531511","#FFFFFF","#000000"];

const defaultPartColor = (partKey?: string | null) => {
  const key = String(partKey || "").toLowerCase();
  if (key === "torso") return "#84663E";
  if (key === "baniyan" || key.includes("vest") || key.includes("shirt")) return "#EDEDED";
  if (key === "lungi" || key.includes("dhoti") || key.includes("lowercloth")) return "#6E9F9F";
  if (key.includes("hair") || key.includes("mustache")) return "#D6D6D6";
  return "#AC866D";
};


type VisualBrowserTab = "character" | "all-characters" | "expressions" | "libraries" | "colors" | "blank" | "blank-2";

const EMPTY_PREVIEW = "data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 240 320'%3E%3Crect width='240' height='320' fill='%23252527'/%3E%3Ccircle cx='120' cy='110' r='42' fill='%23525256'/%3E%3Crect x='72' y='168' width='96' height='96' rx='34' fill='%23434347'/%3E%3Ctext x='120' y='292' text-anchor='middle' font-family='Arial' font-size='18' fill='%23b9b9bd'%3ECB%3C/text%3E%3C/svg%3E";

const hexToRgb = (hex: string) => {
  const clean = hex.replace("#", "");
  const safe = /^[0-9a-fA-F]{6}$/.test(clean) ? clean : "000000";
  return { r: parseInt(safe.slice(0, 2), 16), g: parseInt(safe.slice(2, 4), 16), b: parseInt(safe.slice(4, 6), 16) };
};
const rgbToHex = (r: number, g: number, b: number) => `#${[r,g,b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2,"0")).join("")}`.toUpperCase();

// Part editing itself is discovered at runtime by the generic CreateJS bridge.
// Optional part assets supplied by an Admin ZIP (parts/head.png, etc. or a
// cb-library.json parts map) are exposed as replacement choices without any
// character-specific path assumptions.
const replacementPartKey = (partKey: string) => {
  const value = String(partKey || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  if (/(head|face|hair|turban|pagdi)/.test(value)) return "head";
  if (/(baniyan|vest|shirt|uppercloth|jacket|kurta|blouse)/.test(value)) return "baniyan";
  if (/(lungi|dhoti|pant|trouser|lowercloth|skirt|pyjama|pajama)/.test(value)) return "lungi";
  if (/(lefthand|leftarm|lhand|larm)/.test(value)) return "leftHand";
  if (/(righthand|rightarm|rhand|rarm)/.test(value)) return "rightHand";
  if (/(leftleg|leftfoot|lleg|lfoot)/.test(value)) return "leftLeg";
  if (/(rightleg|rightfoot|rleg|rfoot)/.test(value)) return "rightLeg";
  return "torso";
};

/** First tab label while a part is entered: every variant of that part ("All faces", …). */
const PART_FAMILY_LABELS: Record<string, string> = {
  head: "All faces", baniyan: "All upper clothes", lungi: "All lower clothes",
  leftHand: "All hands", rightHand: "All hands", leftLeg: "All legs", rightLeg: "All legs", torso: "All bodies",
};

const renderLibraryThumb = (thumbUrl: string, label: string, _assetUrl?: string) => (
  <CharacterThumb thumbUrl={thumbUrl || EMPTY_PREVIEW} label={label} />
);

export default function CharacterEditPanel({ character, activePart, onActivePart, onBack, onLibrariesHome, onPatch, onDelete, onUploadVoice, canvasZoom, onCanvasZoomChange, onCanvasFit, playhead, duration, currentTransform, onAddOrUpdateKeyframe, onDeleteKeyframe, onSeek, onClearKeyframes, onAddOrUpdatePartKeyframe, onDeletePartKeyframe, onClearPartKeyframes, onReplacePartAsset, onClearPartReplacement, onApplyLibraryReplacement, onSwapPartSymbol, onRestorePart, onOpenRecolor, replacementBrowserOpen, onReplacementBrowserOpenChange, referenceCharacterId, onReferenceCharacterChange, onReferenceActionChange }: Props) {
  const { characters: characterLibrary } = useCharacterLibrary();
  const parts = character.sourceParts || [];
  const effectivePart = activePart || null;
  const partOverrides = character.partOverrides || {};
  const colorOverrides = character.colorOverrides || {};
  const activeMeta = useMemo(() => effectivePart ? parts.find((part) => part.key === effectivePart) || null : null, [effectivePart, parts]);
  const activeOverride = effectivePart ? partOverrides[effectivePart] || {} : {};
  const activeReplacement = effectivePart ? character.partReplacements?.[effectivePart] || null : null;
  const replacementInputRef = useRef<HTMLInputElement>(null);
  const defaultSkinColor = "#B8794F";
  const colorTargets = useMemo<ColorRegion[]>(() => {
    const targets: ColorRegion[] = [];
    if (effectivePart) {
      const partLabel = activeMeta?.label || effectivePart;
      const partHint = /torso/i.test(effectivePart) ? " (Clothes / Upper Body)" : "";
      targets.push({ key: "selectedPart", label: `Selected Part · ${partLabel}${partHint}`, defaultColor: defaultPartColor(effectivePart) });
    }
    targets.push({ key: "skin", label: "Skin / Body", defaultColor: defaultSkinColor });
    return targets;
  }, [activeMeta?.label, defaultSkinColor, effectivePart]);
  const [colorRegion, setColorRegion] = useState("skin");
  useEffect(() => {
    setColorRegion((current) => {
      if (effectivePart && current !== "selectedPart") return "selectedPart";
      if (!effectivePart && current === "selectedPart") return "skin";
      return current;
    });
  }, [effectivePart]);
  const colorMeta = colorTargets.find((item) => item.key === colorRegion) || colorTargets[0];
  const storageColorKey = colorRegion === "selectedPart" && effectivePart ? `part:${effectivePart}` : colorRegion;
  const activeColor = (colorOverrides[storageColorKey] || colorMeta?.defaultColor || defaultSkinColor).toUpperCase();
  const bodyTint = (colorOverrides.skin || defaultSkinColor).toUpperCase();
  const rgb = hexToRgb(activeColor);
  const keyframes = useMemo(() => [...(character.keyframes || [])].sort((a, b) => a.time - b.time), [character.keyframes]);
  const currentFrame = Math.round(playhead * 30);
  const activePartKeyframes = useMemo(() => effectivePart ? [...(character.partKeyframes?.[effectivePart] || [])].sort((a, b) => a.time - b.time) : [], [character.partKeyframes, effectivePart]);
  const activePartTransform = effectivePart ? resolvePartTransformAtTime(character, effectivePart, playhead) : null;
  const libraryCategory = effectivePart ? resolveReplacementCategory(effectivePart) : null;
  const isHeadPart = libraryCategory === "head";
  const defaultVisualTab: VisualBrowserTab = "character";
  const [browserTab, setBrowserTab] = useState<VisualBrowserTab>(defaultVisualTab);
  const [browserSearch, setBrowserSearch] = useState("");
  const objectReferenceCharacterId = useMemo(() => {
    const raw = String(character.characterId || "");
    if (raw.startsWith("html5:")) return raw.replace(/^html5:/, "");
    return referenceCharacterId || characterLibrary[0]?.id || "";
  }, [character.characterId, characterLibrary, referenceCharacterId]);
  const [selectedLibraryCharacterId, setSelectedLibraryCharacterId] = useState(objectReferenceCharacterId);
  const [selectedLibraryActionId, setSelectedLibraryActionId] = useState<string | null>(null);
  const showVisualReferenceBrowser = Boolean(replacementBrowserOpen && effectivePart && activeMeta);
  const objectLibraryCharacter = useMemo(() => {
    return characterLibrary.find((item) => item.id === objectReferenceCharacterId) || characterLibrary[0];
  }, [characterLibrary, objectReferenceCharacterId]);
  const selectedLibraryCharacter = useMemo(() => {
    return characterLibrary.find((item) => item.id === selectedLibraryCharacterId) || objectLibraryCharacter;
  }, [characterLibrary, objectLibraryCharacter, selectedLibraryCharacterId]);

  // Selecting or entering a part always opens the first tab (poses, or the part's variants); Colors stays one tab away.
  useEffect(() => {
    setBrowserTab("character");
    setBrowserSearch("");
    setSelectedLibraryActionId(null);
  }, [effectivePart, isHeadPart, replacementBrowserOpen]);

  useEffect(() => {
    if (objectReferenceCharacterId && objectReferenceCharacterId !== selectedLibraryCharacterId) {
      setSelectedLibraryCharacterId(objectReferenceCharacterId);
    }
    setSelectedLibraryActionId(null);
    setBrowserSearch("");
    setBrowserTab("character");
  }, [character.id, isHeadPart, objectReferenceCharacterId]);

  const browserTabs = [
    { key: "character" as const, label: showVisualReferenceBrowser && effectivePart
      ? PART_FAMILY_LABELS[replacementPartKey(effectivePart)] || `All ${activeMeta?.label || "parts"}`
      : (objectLibraryCharacter?.name || character.name || "Character") },
    { key: "all-characters" as const, label: "All characters" },
    { key: "libraries" as const, label: "Libraries" },
    { key: "colors" as const, label: "Colors" },
    { key: "blank" as const, label: "Blank" },
  ];

  const poseCards = useMemo(() => (objectLibraryCharacter?.actions || []).map((action) => ({
    id: action.id,
    label: action.actionName,
    thumbUrl: action.thumbUrl,
    sourceSvgName: action.sourceSvgName,
    sourceFolder: action.sourceFolder,
    assetUrl: action.assetUrl,
    characterId: action.characterId,
    characterName: action.characterName,
  })), [objectLibraryCharacter]);

  // Similar characters: the same library category first, then the rest of the library.
  const similarCharacterCards = useMemo(() => characterLibrary
    .filter((item) => item.id !== objectLibraryCharacter?.id)
    .map((item, index) => ({ item, index, sameCategory: Boolean(item.category) && item.category === objectLibraryCharacter?.category }))
    .sort((a, b) => Number(b.sameCategory) - Number(a.sameCategory) || a.index - b.index)
    .map(({ item }) => item)
    .slice(0, 6)
    .map((item) => ({
      id: item.id,
      label: item.name,
      thumbUrl: item.actions[0]?.thumbUrl || character.previewUrl || EMPTY_PREVIEW,
      sourceFolder: item.sourceFolder,
      actionCount: item.actions.length,
    })), [character.previewUrl, characterLibrary, objectLibraryCharacter?.category, objectLibraryCharacter?.id]);

  const visiblePoseCards = useMemo(() => {
    const query = browserSearch.trim().toLowerCase();
    if (!query) return poseCards;
    return poseCards.filter((item) => `${item.label} ${item.characterName}`.toLowerCase().includes(query));
  }, [browserSearch, poseCards]);

  const visibleSimilarCharacters = useMemo(() => {
    const query = browserSearch.trim().toLowerCase();
    if (!query) return similarCharacterCards;
    return similarCharacterCards.filter((item) => `${item.label} ${item.sourceFolder}`.toLowerCase().includes(query));
  }, [browserSearch, similarCharacterCards]);

  const allCharacterActionGroups = useMemo(() => {
    const query = browserSearch.trim().toLowerCase();
    return characterLibrary.map((libraryCharacter) => {
      const filteredActions = libraryCharacter.actions.filter((action) => {
        if (!query) return true;
        return `${libraryCharacter.name} ${action.actionName} ${action.sourceFolder}`.toLowerCase().includes(query);
      }).map((action) => ({
        id: action.id,
        label: action.actionName,
        thumbUrl: action.thumbUrl,
        sourceSvgName: action.sourceSvgName,
        sourceFolder: action.sourceFolder,
        assetUrl: action.assetUrl,
        characterId: action.characterId,
        characterName: action.characterName,
      }));
      return {
        id: libraryCharacter.id,
        label: libraryCharacter.name,
        sourceFolder: libraryCharacter.sourceFolder,
        thumbUrl: libraryCharacter.actions[0]?.thumbUrl || character.previewUrl || EMPTY_PREVIEW,
        firstAssetUrl: libraryCharacter.actions[0]?.assetUrl || "",
        actions: filteredActions,
      };
    }).filter((group) => group.actions.length > 0 || (!query && group.thumbUrl));
  }, [browserSearch, character.previewUrl, characterLibrary]);


  // Variants read from the Animate exports (only while a part is entered): this character's own,
  // and the same part from the other library characters, narrowed by the search box.
  const partVariants = usePartVariants(objectLibraryCharacter, characterLibrary, effectivePart, showVisualReferenceBrowser);
  const activeSwap = effectivePart ? partOverrides[effectivePart]?.swapSymbol || "" : "";
  const ownVariants = useMemo(() => {
    const query = browserSearch.trim().toLowerCase();
    return (partVariants.own?.variants || []).filter((variant) => !query || `${variant.label} ${variant.symbol}`.toLowerCase().includes(query));
  }, [browserSearch, partVariants.own]);

  // Parts removed with Delete (hidden without a replacement over them), offered for restoring.
  // Removed parts, and removed pieces inside a part ("head/hair") with their path names.
  const removedParts = [
    ...parts.filter((part) => partOverrides[part.key]?.visible === false && !character.partReplacements?.[part.key]),
    ...Object.keys(partOverrides).filter((key) => key.includes("/") && partOverrides[key]?.visible === false).map((key) => ({ key, label: partLabel(character, key) })),
  ];

  const currentCharacterPartCards = useMemo(() => {
    if (!effectivePart) return [];
    const query = browserSearch.trim().toLowerCase();
    const key = replacementPartKey(effectivePart);
    return (objectLibraryCharacter?.actions || []).map((action) => {
      const asset = action.partAssets?.[key];
      return {
        id: `${action.id}-${effectivePart}`,
        label: action.actionName,
        thumbUrl: asset?.thumbUrl || "",
        assetUrl: asset?.assetUrl || "",
        renderKind: asset?.renderKind || "image" as const,
        actionId: action.id,
      };
    }).filter((item) => item.assetUrl && (!query || `${item.label} ${activeMeta?.label || effectivePart}`.toLowerCase().includes(query)));
  }, [activeMeta?.label, browserSearch, effectivePart, objectLibraryCharacter]);

  const similarPartCards = useMemo(() => {
    if (!effectivePart) return [];
    const query = browserSearch.trim().toLowerCase();
    const key = replacementPartKey(effectivePart);
    return characterLibrary
      .filter((libraryCharacter) => libraryCharacter.id !== objectLibraryCharacter?.id)
      .flatMap((libraryCharacter) => libraryCharacter.actions.map((action) => {
        const asset = action.partAssets?.[key];
        return {
          id: `${libraryCharacter.id}-${action.id}-${effectivePart}`,
          label: `${libraryCharacter.name} · ${action.actionName}`,
          thumbUrl: asset?.thumbUrl || "",
          assetUrl: asset?.assetUrl || "",
          renderKind: asset?.renderKind || "image" as const,
          library: libraryCharacter.name,
        };
      }))
      .filter((item) => item.assetUrl && (!query || item.label.toLowerCase().includes(query)));
  }, [browserSearch, characterLibrary, effectivePart, objectLibraryCharacter?.id]);


  // Whole character and a selected (not entered) part both show the character's poses.
  const showWholeCharacterHtml5Browser = !showVisualReferenceBrowser;
  const showAnyVisualBrowser = showVisualReferenceBrowser || showWholeCharacterHtml5Browser;
  const showReferenceStyleBrowserPanel = showAnyVisualBrowser;

  const applyFirstHeadReplacement = (partKey: CharacterPartKey, assetUrl?: string, name?: string, renderKind?: "image" | "source-symbol") => {
    if (!assetUrl) return;
    onApplyLibraryReplacement(partKey, assetUrl, name || "Library replacement", renderKind);
  };

  const renderHtml5Browser = (mode: "whole" | "part") => {
    const selectedCharacter = objectLibraryCharacter || characterLibrary[0];
    const actions = selectedCharacter?.actions || [];
    const canApplyExpression = Boolean(effectivePart);

    return (
      <section className="cb-edit-section cb-visual-browser-section cb-v79-library-browser">
        <div className="cb-visual-browser-tabs">
          {browserTabs.map((tab) => (
            <button
              key={tab.key}
              className={browserTab === tab.key ? "active" : ""}
              onClick={() => { if (tab.key === "libraries") onLibrariesHome(); else setBrowserTab(tab.key); }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="cb-visual-browser-search-row">
          <button
            className="cb-visual-browser-back"
            onClick={() => {
              if (mode === "part") {
                onReplacementBrowserOpenChange(false);
                setBrowserTab("character");
              } else if (effectivePart) {
                onActivePart(null);
              } else {
                setBrowserSearch("");
                setSelectedLibraryActionId(null);
                setSelectedLibraryCharacterId(objectReferenceCharacterId);
                setBrowserTab("character");
              }
            }}
            title={mode === "part" ? "Back to the selected part" : effectivePart ? "Back to the whole character" : "Reset browser"}
          >
            ←
          </button>
          <label className="cb-visual-browser-search">
            <span>⌕</span>
            <input
              value={browserSearch}
              onChange={(event) => setBrowserSearch(event.target.value)}
              placeholder="Search your Character"
            />
          </label>
        </div>

        {browserTab === "character" && (
          <div className="cb-visual-browser-block cb-v79-browser-content">
            {mode === "part" && effectivePart ? (
              <>
                <div className="cb-visual-source-caption">
                  {selectedCharacter?.name || character.name} · every {activeMeta?.label || effectivePart} in this character
                </div>

                <div className="cb-visual-browser-grid cb-visual-browser-grid-small">
                  {ownVariants.map((variant) => {
                    const isCurrent = activeSwap ? activeSwap === variant.symbol : variant.label === character.actionName;
                    return (
                      <button
                        key={variant.symbol}
                        className={`cb-visual-card head ${isCurrent ? "active" : ""}`}
                        // The pose's own part clears the swap; any other variant is swapped in inside the rig.
                        onClick={() => onSwapPartSymbol(effectivePart, variant.label === character.actionName ? null : variant.symbol)}
                        title={`Use the ${variant.label} ${activeMeta?.label || effectivePart}`}
                      >
                        <strong>{variant.label}</strong>
                        <span className="cb-visual-card-thumb head">{variant.thumb ? <img src={variant.thumb} alt={variant.label} /> : <i>CB</i>}</span>
                      </button>
                    );
                  })}
                  {currentCharacterPartCards.map((item) => (
                    <button
                      key={item.id}
                      className="cb-visual-card head"
                      onClick={() => effectivePart && onApplyLibraryReplacement(
                        effectivePart,
                        item.assetUrl,
                        `${selectedCharacter?.name || "Character"} ${activeMeta?.label || effectivePart} · ${item.label}`,
                        item.renderKind,
                      )}
                      title={`Replace ${activeMeta?.label || effectivePart} with ${item.label}`}
                    >
                      <strong>{item.label}</strong>
                      <span className="cb-visual-card-thumb head">{renderLibraryThumb(item.thumbUrl, item.label)}</span>
                    </button>
                  ))}
                  {ownVariants.length === 0 && currentCharacterPartCards.length === 0 && (
                    <div className="cb-visual-empty-state">{partVariants.loading ? `Finding ${activeMeta?.label || "part"} variants…` : "No same-character variants were found for this part."}</div>
                  )}
                </div>

                <div className="cb-visual-subheading">Similar replacement</div>
                <div className="cb-visual-browser-grid cb-visual-browser-grid-small">
                  {partVariants.similar.flatMap((entry) => entry.variants.map((variant) => (
                    <button
                      key={`${entry.character.id}-${variant.symbol}`}
                      className="cb-visual-card similar"
                      onClick={() => onApplyLibraryReplacement(effectivePart, symbolPlayerUrl(entry.source, variant.symbol), `${entry.character.name} · ${variant.label}`, "source-symbol")}
                      title={`Replace ${activeMeta?.label || effectivePart} with ${entry.character.name}'s ${variant.label}`}
                    >
                      <strong>{entry.character.name}</strong>
                      <span className="cb-visual-card-thumb head">{variant.thumb ? <img src={variant.thumb} alt={variant.label} /> : <i>CB</i>}</span>
                      <small>{variant.label}</small>
                    </button>
                  )))}
                  {similarPartCards.map((item) => (
                    <button
                      key={item.id}
                      className="cb-visual-card similar"
                      onClick={() => effectivePart && onApplyLibraryReplacement(effectivePart, item.assetUrl, item.label, item.renderKind)}
                    >
                      <strong>{item.label}</strong>
                      <span className="cb-visual-card-thumb head">{renderLibraryThumb(item.thumbUrl, item.label)}</span>
                      <small>{item.library}</small>
                    </button>
                  ))}
                  {partVariants.similar.length === 0 && similarPartCards.length === 0 && (
                    <div className="cb-visual-empty-state">{partVariants.loading ? "Searching the other characters…" : "No similar library items are available for this part yet."}</div>
                  )}
                </div>
              </>
            ) : (
              <>
                {removedParts.length > 0 && (
                  <div className="cb-removed-parts" aria-label="Removed parts">
                    <span>Removed parts</span>
                    {removedParts.map((part) => (
                      <button key={part.key} type="button" onClick={() => onRestorePart(part.key)} title={`Bring back ${part.label}`}>
                        {part.label} <b aria-hidden="true">⟲</b> Restore
                      </button>
                    ))}
                  </div>
                )}
                <div className="cb-visual-source-caption">
                  {selectedCharacter?.name || character.name} · {actions.length} source action{actions.length === 1 ? "" : "s"}
                </div>

                <div className="cb-visual-browser-grid cb-v79-action-grid">
                  {actions.length > 0 ? actions
                    .filter((item) => {
                      const query = browserSearch.trim().toLowerCase();
                      if (!query) return true;
                      return `${item.actionName} ${item.sourceFolder}`.toLowerCase().includes(query);
                    })
                    .map((item) => (
                      <button
                        key={item.id}
                        className={`cb-visual-card ${selectedLibraryActionId === item.id ? "active" : ""}`}
                        onClick={() => {
                          setSelectedLibraryActionId(item.id);
                          onReferenceActionChange(item.id);
                        }}
                        title={`${item.sourceFolder} / ${item.sourceSvgName}`}
                      >
                        <span className="cb-visual-card-thumb portrait">{renderLibraryThumb(item.thumbUrl, item.actionName, item.assetUrl)}</span>
                        <strong>{item.actionName}</strong>
                        <small>{item.sourceSvgName}</small>
                      </button>
                    )) : (
                      <div className="cb-visual-empty-state">No actions found for this character.</div>
                    )}
                </div>

                <div className="cb-visual-subheading">Similar Characters</div>
                <div className="cb-visual-browser-grid cb-visual-browser-grid-small">
                  {visibleSimilarCharacters.map((item) => (
                    <button
                      key={item.id}
                      className="cb-visual-card similar"
                      onClick={() => {
                        setSelectedLibraryCharacterId(item.id);
                        setSelectedLibraryActionId(null);
                        onReferenceCharacterChange(item.id);
                        setBrowserTab("all-characters");
                      }}
                    >
                      <span className="cb-visual-card-thumb portrait">{renderLibraryThumb(item.thumbUrl, item.label)}</span>
                      <strong>{item.label}</strong>
                      <small>{item.actionCount} actions</small>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {browserTab === "all-characters" && (
          <div className="cb-visual-browser-block cb-v79-browser-content">
            <div className="cb-visual-source-caption">Admin Library · {characterLibrary.length} separate character{characterLibrary.length === 1 ? "" : "s"}</div>
            <div className="cb-visual-group-stack">
              {allCharacterActionGroups.map((group) => (
                <div key={group.id} className="cb-visual-group">
                  <div className="cb-visual-group-heading">
                    <button
                      className="cb-visual-group-title"
                      onClick={() => {
                        setSelectedLibraryCharacterId(group.id);
                        setSelectedLibraryActionId(null);
                        onReferenceCharacterChange(group.id);
                        setBrowserTab("all-characters");
                      }}
                    >
                      <span className="cb-visual-group-avatar">{renderLibraryThumb(group.thumbUrl, group.label, group.firstAssetUrl)}</span>
                      <span><strong>{group.label}</strong><small>{group.sourceFolder}</small></span>
                    </button>
                  </div>
                  <div className="cb-visual-browser-grid">
                    {group.actions.map((item) => (
                      <button
                        key={item.id}
                        className={`cb-visual-card ${selectedLibraryActionId === item.id ? "active" : ""}`}
                        onClick={() => {
                          setSelectedLibraryCharacterId(group.id);
                          setSelectedLibraryActionId(item.id);
                          onReferenceCharacterChange(group.id);
                          onReferenceActionChange(item.id);
                          setBrowserTab("character");
                        }}
                      >
                        <span className="cb-visual-card-thumb portrait">{renderLibraryThumb(item.thumbUrl, item.label, item.assetUrl)}</span>
                        <strong>{item.label}</strong>
                        <small>{group.label}</small>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {browserTab === "expressions" && (
          <div className="cb-visual-browser-block">
            <div className="cb-visual-empty-state">Choose a body part on the canvas. All matching replacements now appear directly in the selected-part tab.</div>
          </div>
        )}

        {browserTab === "colors" && (
          <div className="cb-visual-browser-block cb-v79-browser-content cb-character-colors-panel">
            <div className="cb-visual-source-caption">Character colors · use the Fill/Stroke boxes at the bottom of the tool palette to recolour.</div>

            <div className="cb-color-control-card">
              <div className="cb-color-control-title"><strong>Global Filter</strong><small>Optional · affects the whole character including clothes</small></div>
              <label className="cb-range-field"><span>Hue <b>{Math.round(character.characterHue ?? 0)}°</b></span><input type="range" min="-180" max="180" step="1" value={character.characterHue ?? 0} onChange={(event) => onPatch({ characterHue: Number(event.target.value) }, false)} onPointerUp={(event) => onPatch({ characterHue: Number((event.target as HTMLInputElement).value) }, true)} /></label>
              <label className="cb-range-field"><span>Saturation <b>{Math.round(character.characterSaturation ?? 100)}%</b></span><input type="range" min="0" max="220" step="1" value={character.characterSaturation ?? 100} onChange={(event) => onPatch({ characterSaturation: Number(event.target.value) }, false)} onPointerUp={(event) => onPatch({ characterSaturation: Number((event.target as HTMLInputElement).value) }, true)} /></label>
              <label className="cb-range-field"><span>Brightness <b>{Math.round(character.characterBrightness ?? 100)}%</b></span><input type="range" min="40" max="180" step="1" value={character.characterBrightness ?? 100} onChange={(event) => onPatch({ characterBrightness: Number(event.target.value) }, false)} onPointerUp={(event) => onPatch({ characterBrightness: Number((event.target as HTMLInputElement).value) }, true)} /></label>
              <button className="cb-color-reset-button" onClick={() => onPatch({ characterHue: 0, characterSaturation: 100, characterBrightness: 100 }, true)}>Reset Global Filter</button>
            </div>

            {/* Real vector recolouring lives in the tool palette (Fill/Stroke boxes), replacing the old tint cards. */}
            <div className="cb-color-control-card">
              <div className="cb-color-control-title"><strong>Recolour character</strong><small>Change any colour of the artwork itself, with its shades, for the whole character or the selected part. Find and replace works like Adobe Animate.</small></div>
              <button className="cb-color-reset-button" onClick={onOpenRecolor}>Open Recolour (tool palette)</button>
            </div>
          </div>
        )}

        {browserTab === "blank" && (
          <div className="cb-visual-browser-block cb-v79-browser-content">
            <div className="cb-visual-empty-state">Blank tab reserved for the final library category.</div>
          </div>
        )}
      </section>
    );
  };

  const updatePart = (key: CharacterPartKey, patch: Record<string, number | boolean>, recordHistory = true) => {
    onPatch({ partOverrides: { ...partOverrides, [key]: { ...(partOverrides[key] || {}), ...patch } } }, recordHistory);
  };
  const updateColor = (value: string, recordHistory = false) => {
    if (!/^#[0-9A-Fa-f]{6}$/.test(value)) return;
    onPatch({ colorOverrides: { ...colorOverrides, [storageColorKey]: value.toUpperCase() } }, recordHistory);
  };
  const resetColor = () => {
    const next = { ...colorOverrides }; delete next[storageColorKey]; onPatch({ colorOverrides: next }, true);
  };
  const setAllAnimation = (animate: boolean, onlySelected = false) => {
    const next = { ...partOverrides };
    parts.forEach((part) => {
      next[part.key] = { ...(next[part.key] || {}), animate: onlySelected ? part.key === effectivePart : animate };
    });
    onPatch({ partOverrides: next }, true);
  };
  const resetPart = () => {
    if (!effectivePart) return;
    updatePart(effectivePart, { offsetX: 0, offsetY: 0, rotation: 0, scale: 1, flipX: false, visible: activeOverride.visible !== false, animate: activeOverride.animate !== false }, true);
  };
  const triggerReplacementUpload = () => {
    if (!effectivePart) return;
    replacementInputRef.current?.click();
  };
  const handleReplacementFile = (event: ChangeEvent<HTMLInputElement>) => {
    if (!effectivePart) return;
    const file = event.target.files?.[0];
    if (file) onReplacePartAsset(effectivePart, file);
    event.currentTarget.value = "";
  };
  const replacementPreview = (assetUrl: string, label: string, renderKind?: "image" | "source-symbol") => (
    renderKind === "source-symbol"
      ? <iframe src={assetUrl} title={label} className="cb-source-symbol-preview" tabIndex={-1} />
      : <img src={assetUrl} alt={label} />
  );

  return (
    <aside className={`cb-character-editor-panel cb-v15-character-editor ${showReferenceStyleBrowserPanel ? "cb-browser-mode" : ""}`}> 
      {!showReferenceStyleBrowserPanel && <div className="cb-character-editor-head">
        <button onClick={onBack}>←</button>
        <div><strong>Character Edit</strong><span>{character.name} · Adobe Animate source</span></div>
      </div>}

      <div className="cb-character-editor-scroll">
        <input ref={replacementInputRef} type="file" accept="image/*,.svg" hidden onChange={handleReplacementFile} />
        {showReferenceStyleBrowserPanel ? renderHtml5Browser(showVisualReferenceBrowser ? "part" : "whole") : <>
        <section className="cb-character-summary">
          <img src={character.previewUrl || EMPTY_PREVIEW} alt={character.name} />
          <div><strong>{character.name}</strong><span>{character.actionName || "Talking"}</span><small>30 FPS · {Math.round((character.actionDurationMs || 0) / 1000 * 30)} frames · {((character.actionDurationMs || 0) / 1000).toFixed(2)} sec</small></div>
        </section>

        <div className="cb-source-lock-banner">
          <b>Original HTML5 Canvas Source</b>
          <span>Body-part editing uses this character’s supplied Adobe Animate/CreateJS timeline; no replacement motion is synthesized.</span>
        </div>

        <section className="cb-edit-section cb-canvas-quality-section">
          <header><strong>Canvas Zoom / Quality</strong><button onClick={onCanvasFit}>Fit</button></header>
          <label className="cb-range-field"><span>Editor Zoom <b>{canvasZoom < 1 ? `${Math.round(canvasZoom * 100)}%` : `${canvasZoom.toFixed(canvasZoom >= 10 ? 0 : 1)}x`}</b></span><input type="range" min="0.1" max="200" step="0.1" value={canvasZoom} onChange={(event) => onCanvasZoomChange(Number(event.target.value))} /></label>
          <div className="cb-zoom-quick-actions">
            <button onClick={() => onCanvasZoomChange(Math.max(0.1, canvasZoom / 1.25))}>−</button>
            <button onClick={() => onCanvasZoomChange(1)}>1x</button>
            <button onClick={() => onCanvasZoomChange(4)}>4x</button>
            <button onClick={() => onCanvasZoomChange(10)}>10x</button>
            <button onClick={() => onCanvasZoomChange(50)}>50x</button>
            <button onClick={() => onCanvasZoomChange(100)}>100x</button>
          </div>
          <p className="cb-edit-help">Zoom is viewport-only and never compresses your imported image. Hold Space + drag on the stage to pan while zoomed.</p>
        </section>

        <section className="cb-edit-section cb-parts-section">
          <header><strong>Body Part Edit</strong><span className="cb-part-drag-status">Cmd/Ctrl + K adds a keyframe</span></header>
          <button className={`cb-whole-character-mode ${!effectivePart ? "active" : ""}`} onClick={() => onActivePart(null)}>▣ Whole Character Mode</button>
          {!effectivePart && (
            <div className="cb-direct-part-help">
              <strong>Click a body part directly on the character.</strong>
              <span>Double-click a body part to edit only that group while the full character stays fully visible. Move, scale, rotate or flip the selected group without fading the rest of the character.</span>
            </div>
          )}
          {effectivePart && activeMeta && (
            <div className="cb-selected-part-summary">
              <span className="cb-selected-part-thumb"><img src={activeMeta.thumb || character.previewUrl || EMPTY_PREVIEW} alt={activeMeta.label} /></span>
              <div><strong>{activeMeta.label}</strong><small>Part edit · full character stays visible · double-click the same part again to open the reference browser · drag / scale / rotate / flip · Arrow keys = move · Shift+Arrow = 10px · Enter = play/pause · Cmd/Ctrl + K = keyframe</small></div>
              <button onClick={() => onActivePart(null)}>×</button>
            </div>
          )}

          {effectivePart && activeMeta && (
            <div className="cb-replacement-options-visible">
              <div className="cb-replacement-options-title">
                <strong>{activeMeta.label} replacements</strong>
                <span>All same-character variants and similar matching parts are shown in the right-side part browser.</span>
              </div>
              <div className="cb-part-replacement-grid">
                <div className="cb-part-replacement-card">
                  <span>Current source part</span>
                  <div className="cb-part-replacement-preview-box"><img src={activeMeta.thumb || character.previewUrl || EMPTY_PREVIEW} alt={activeMeta.label} /></div>
                  <strong>{activeMeta.label}</strong>
                  <small>Original body part from this character.</small>
                </div>
                <div className="cb-part-replacement-card replacement-slot">
                  <span>Current replacement</span>
                  <div className="cb-part-replacement-preview-box">
                    {activeReplacement ? replacementPreview(activeReplacement.assetUrl, activeReplacement.name || `${activeMeta.label} replacement`, activeReplacement.renderKind) : <em>No replacement</em>}
                  </div>
                  <strong>{activeReplacement?.name || `Replace ${activeMeta.label}`}</strong>
                  <small>Choose a matching variant from the right-side browser, or upload your own image.</small>
                  <div className="cb-part-replacement-actions">
                    <button onClick={triggerReplacementUpload}>Upload Own</button>
                    <button disabled={!activeReplacement} onClick={() => effectivePart && onClearPartReplacement(effectivePart)}>Clear</button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {parts.length > 0 && (
            <div className="cb-all-parts-library">
              <div className="cb-all-parts-library-title"><strong>All Character Parts</strong><span>Select another part from here</span></div>
              <div className="cb-part-thumb-grid">
                {parts.map((part) => {
                  const replacementAsset = character.partReplacements?.[part.key];
                  return (
                    <div key={part.key} className={`cb-part-thumb-card ${effectivePart === part.key ? "active" : ""}`}>
                      <button className="cb-part-thumb-main" onClick={() => onActivePart(part.key)}>
                        <span className="cb-part-thumb-image">{replacementAsset ? replacementPreview(replacementAsset.assetUrl, part.label, replacementAsset.renderKind) : <img src={(part.thumb || character.previewUrl || EMPTY_PREVIEW)} alt={part.label} />}</span>
                        <span><strong>{part.label}</strong><small>{replacementAsset ? `Replacement ready · ${replacementAsset.name || "custom"}` : "Click to edit / replace"}</small></span>
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </section>


        {activeMeta && effectivePart && !showVisualReferenceBrowser && <section className="cb-edit-section cb-active-part-section">
          <header><strong>Edit: {activeMeta.label}</strong><button onClick={resetPart}>Reset Part</button></header>
          <div className="cb-part-live-state"><b>{activeOverride.animate !== false ? "Original animation ON" : "Animation frozen"}</b><span>Position edits remain independent from the source timeline.</span></div>
          <div className="cb-two-fields">
            <label>Part X<input type="number" value={Math.round(Number(activeOverride.offsetX || 0))} onChange={(e) => updatePart(effectivePart, { offsetX: Number(e.target.value) }, false)} /></label>
            <label>Part Y<input type="number" value={Math.round(Number(activeOverride.offsetY || 0))} onChange={(e) => updatePart(effectivePart, { offsetY: Number(e.target.value) }, false)} /></label>
          </div>
          <label className="cb-range-field"><span>Part Rotation <b>{Math.round(Number(activeOverride.rotation || 0))}°</b></span><input type="range" min="-180" max="180" value={Number(activeOverride.rotation || 0)} onChange={(e) => updatePart(effectivePart, { rotation: Number(e.target.value) }, false)} /></label>
          <label className="cb-range-field"><span>Group Scale / Zoom <b>{Math.round(Number(activeOverride.scale ?? 1) * 100)}%</b></span><input type="range" min="0.05" max="5" step="0.01" value={Number(activeOverride.scale ?? 1)} onChange={(e) => updatePart(effectivePart, { scale: Number(e.target.value) }, false)} /></label>
          <div className="cb-part-transform-actions">
            <button className={`cb-toggle-action ${activeOverride.flipX ? "active" : ""}`} onClick={() => updatePart(effectivePart, { flipX: !activeOverride.flipX }, true)}>⇄ Flip Selected Group</button>
            <button className={`cb-toggle-action ${activeOverride.animate !== false ? "active" : ""}`} onClick={() => updatePart(effectivePart, { animate: activeOverride.animate === false }, true)}>{activeOverride.animate !== false ? "Pause Only This Part" : "Animate Only This Part Again"}</button>
          </div>
          <div className="cb-part-keyframe-box">
            <div className="cb-part-keyframe-head"><strong>Body-Part Keyframes</strong><span>{activePartKeyframes.length} keys</span></div>
            <div className="cb-keyframe-current"><span>Resolved at playhead</span><b>X {Math.round(activePartTransform?.offsetX || 0)} · Y {Math.round(activePartTransform?.offsetY || 0)} · R {Math.round(activePartTransform?.rotation || 0)}° · S {Math.round((activePartTransform?.scale || 1) * 100)}%{activePartTransform?.flipX ? " · FLIP" : ""}</b></div>
            <div className="cb-keyframe-actions">
              <button className="primary" onClick={() => onAddOrUpdatePartKeyframe(effectivePart)}>◆ Add / Update Part Key</button>
              <button disabled={activePartKeyframes.length === 0} onClick={() => onClearPartKeyframes(effectivePart)}>Clear Part Keys</button>
            </div>
            {activePartKeyframes.length > 0 && <div className="cb-keyframe-list">
              {activePartKeyframes.map((frame) => <div key={frame.id} className="cb-keyframe-row">
                <button className="cb-keyframe-jump" onClick={() => onSeek(frame.time)}>◆ <b>{Math.round(frame.time * 30)}f</b><span>{frame.time.toFixed(2)}s</span></button>
                <small>ΔX {Math.round(frame.offsetX)} · ΔY {Math.round(frame.offsetY)} · R {Math.round(frame.rotation)}° · S {Math.round((frame.scale ?? 1) * 100)}%{frame.flipX ? " · FLIP" : ""}</small>
                <button className="danger" title="Delete body-part keyframe" onClick={() => onDeletePartKeyframe(effectivePart, frame.id)}>×</button>
              </div>)}
            </div>}
            <p className="cb-edit-help">Double-click a body part to edit that group while keeping the complete character fully visible. Use the amber corner squares to scale, ↻ corner controls to rotate, ⇄ to flip, or drag the box to move it. Arrow keys move the selected part and Shift+Arrow moves faster. Cmd/Ctrl + or - is reserved for canvas zoom. Press Enter to play/pause the animation. Hold Shift while rotating for 45° snapping. Click elsewhere on the canvas to exit part edit mode. Press Cmd/Ctrl + K to keyframe the selected group.</p>
          </div>
        </section>}

        {!showVisualReferenceBrowser && <section className="cb-edit-section cb-full-color-section">
          <header><strong>Full Color Picker</strong><button onClick={resetColor}>Reset Selected Color</button></header>
          <label className="cb-color-target-label">Change color of
            <select value={colorRegion} onChange={(e) => setColorRegion(e.target.value)}>
              {colorTargets.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
            </select>
          </label>
          <div className="cb-color-picker-layout">
            <ColourSwatch className="cb-native-color-picker" value={activeColor} onChange={(hex) => updateColor(hex, true)} label="Colour" />
            <div className="cb-color-values">
              <label>HEX<input value={activeColor} onChange={(e) => updateColor(e.target.value, false)} /></label>
              <div className="cb-rgb-fields">
                {(["r","g","b"] as const).map((channel) => <label key={channel}>{channel.toUpperCase()}<input type="number" min="0" max="255" value={rgb[channel]} onChange={(e) => updateColor(rgbToHex(channel === "r" ? Number(e.target.value) : rgb.r, channel === "g" ? Number(e.target.value) : rgb.g, channel === "b" ? Number(e.target.value) : rgb.b), false)} /></label>)}
              </div>
            </div>
          </div>
          <div className="cb-color-swatches">{SWATCHES.map((color) => <button key={color} title={color} style={{ background: color }} onClick={() => updateColor(color, true)} />)}</div>
          <p className="cb-edit-help">Tip: canvas par jis body part par click karoge, usi selected part ka color yahin se change hoga. Torso select karne par kapdon / upper-body zone ka color change hoga.</p>
        </section>}

        {!showVisualReferenceBrowser && <section className="cb-edit-section cb-keyframe-section">
          <header><strong>Position Keyframes</strong><span>{currentFrame}f · {playhead.toFixed(2)}s</span></header>
          <div className="cb-keyframe-actions">
            <button className="primary" onClick={onAddOrUpdateKeyframe}>◆ Add / Update Keyframe</button>
            <button disabled={keyframes.length === 0} onClick={onClearKeyframes}>Clear All</button>
          </div>
          <div className="cb-keyframe-current">
            <span>Current position</span><b>X {Math.round(currentTransform.x)} · Y {Math.round(currentTransform.y)}</b>
          </div>
          <p className="cb-edit-help">Add the first keyframe, move the playhead, then drag the whole character to another place. Once keyframes exist, whole-character drag automatically creates/updates the keyframe at the current frame.</p>
          {keyframes.length > 0 && <div className="cb-keyframe-list">
            {keyframes.map((frame, index) => (
              <div key={frame.id} className="cb-keyframe-row">
                <button className="cb-keyframe-jump" onClick={() => onSeek(frame.time)}>◆ <b>{Math.round(frame.time * 30)}f</b><span>{frame.time.toFixed(2)}s</span></button>
                <small>X {Math.round(frame.x)} · Y {Math.round(frame.y)}</small>
                <button className="danger" title="Delete keyframe" onClick={() => onDeleteKeyframe(frame.id)}>×</button>
              </div>
            ))}
          </div>}
          {keyframes.length === 0 && <div className="cb-keyframe-empty">No position keyframes yet.</div>}
        </section>}

        {!showVisualReferenceBrowser && <section className="cb-edit-section">
          <header><strong>Whole Character</strong><button onClick={() => onActivePart(null)}>Select Whole</button></header>
          <div className="cb-two-fields">
            <label>X<input type="number" value={Math.round(currentTransform.x)} readOnly={keyframes.length > 0} onChange={(e) => onPatch({ x: Number(e.target.value) }, false)} /></label>
            <label>Y<input type="number" value={Math.round(currentTransform.y)} readOnly={keyframes.length > 0} onChange={(e) => onPatch({ y: Number(e.target.value) }, false)} /></label>
          </div>
          <label className="cb-range-field"><span>Scale <b>{Math.round((character.scale || 1) * 100)}%{Math.abs((character.scale || 1) - 1) < 0.001 ? " · Original" : ""}</b></span><input type="range" min="0.05" max="10" step="0.01" value={character.scale || 1} onChange={(e) => onPatch({ scale: Number(e.target.value) }, false)} /></label>
          <label className="cb-range-field"><span>Rotation <b>{Math.round(character.rotation || 0)}°</b></span><input type="range" min="-180" max="180" value={character.rotation || 0} onChange={(e) => onPatch({ rotation: Number(e.target.value) }, false)} /></label>
          <button className={`cb-toggle-action ${character.flipX ? "active" : ""}`} onClick={() => onPatch({ flipX: !character.flipX }, true)}>⇄ Flip Character</button>
          <p className="cb-edit-help">Whole character: drag any ↻ corner icon to rotate freely, or hold Shift to snap every 45°. Press R to toggle the rotate tool; press Esc to return to normal selection.</p>
          {keyframes.length > 0 && <p className="cb-edit-help">X/Y are controlled by position keyframes. Drag the whole character at the current playhead to change its keyed position.</p>}
        </section>}

        {!showVisualReferenceBrowser && <section className="cb-edit-section cb-voice-section">
          <header><strong>Voice / Audio</strong></header>
          <button className="cb-upload-voice-primary" onClick={onUploadVoice}>♬ Upload Voice / Dialogue</button>
          <p className="cb-edit-help">Voice is a separate timeline audio layer. It does not replace the original Adobe Animate talking animation.</p>
        </section>}
        </>}
      </div>
      {!showReferenceStyleBrowserPanel && <div className="cb-character-editor-footer"><button className="danger" onClick={onDelete} title="Removes this character from the canvas only; the library keeps it">Remove from canvas</button><button onClick={onBack}>Back to Library</button></div>}
    </aside>
  );
}
