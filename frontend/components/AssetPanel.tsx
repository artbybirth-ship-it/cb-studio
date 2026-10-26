"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useCharacterLibrary } from "@/lib/characterLibrary";
import type { Html5CharacterLibraryCharacter } from "@/lib/html5CharacterCatalog";
import type { MediaLibraryItem } from "@/lib/mediaLibrary";
import MediaLibraryBrowser from "./MediaLibraryBrowser";
import CharacterThumb from "./CharacterThumb";
import Popover from "./Popover";

type Props = {
  onAddReferenceCharacter: (referenceCharacterId: string, actionId?: string, options?: { x?: number; y?: number }) => void;
  selectedReferenceCharacterId?: string;
  onAddProp: (name?: string) => void;
  onAddText: () => void;
  onUploadBackground: (file: File) => void | Promise<void>;
  onUploadVoice: (file: File) => void | Promise<void>;
  onAIBackground: (prompt: string) => void | Promise<void>;
  /** Adds an installed Backgrounds / FX / SFX library item to the scene. */
  onAddMediaItem: (item: MediaLibraryItem) => void;
};

type LibraryTab = "characters" | "background" | "fx" | "sfx";

const matchesSearch = (query: string, ...values: string[]) =>
  !query || values.some((value) => value.toLowerCase().includes(query));

/** Characters view inside the Characters library: category grid (null), one category, or My characters. */
const MY_CHARACTERS = "__my-characters__";

// The panel unmounts while a canvas character is being edited; remember where the user was
// so "Back to Library" returns to the same library and category.
type RememberedView = { activeTab: LibraryTab | null; characterView: string | null; openCharacterId?: string | null };
const VIEW_STORAGE_KEY = "cb-library-view";
let rememberedView: RememberedView | null = null;
const readRememberedView = (): RememberedView => {
  if (rememberedView) return rememberedView;
  try {
    const parsed = JSON.parse(sessionStorage.getItem(VIEW_STORAGE_KEY) || "null");
    if (parsed && typeof parsed === "object") rememberedView = { activeTab: parsed.activeTab ?? null, characterView: parsed.characterView ?? null, openCharacterId: parsed.openCharacterId ?? null };
  } catch { /* storage unavailable */ }
  return rememberedView || { activeTab: null, characterView: null };
};
const rememberView = (view: RememberedView) => {
  rememberedView = view;
  try { sessionStorage.setItem(VIEW_STORAGE_KEY, JSON.stringify(view)); } catch { /* storage unavailable */ }
};
/** Makes the next library panel open on the Libraries home screen (used when leaving character editing). */
export const showLibrariesHome = () => rememberView({ activeTab: null, characterView: null, openCharacterId: null });
const characterCategory = (character: Html5CharacterLibraryCharacter) => character.category || "Other";

/** Fixed category cards on the Characters home; admin characters join one by category name (any case). */
const CHARACTER_CATEGORIES = [
  ["Village", "/library-categories/village.png"],
  ["Children", "/library-categories/children.png"],
  ["Animal", "/library-categories/animal.png"],
  ["Business", "/library-categories/business.png"],
  ["Horror", "/library-categories/horror.png"],
  ["Western", "/library-categories/western.png"],
] as const;
const sameCategory = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

const renderCharacterThumb = (thumbUrl: string | undefined, label: string) => <CharacterThumb thumbUrl={thumbUrl} label={label} />;

/** Cover pose for a character card, chosen automatically: Front, then any front view, then idle/standing, then the first pose. */
const coverPose = (character: Html5CharacterLibraryCharacter) => {
  const withThumb = character.actions.filter((action) => action.thumbUrl);
  const find = (test: (name: string) => boolean) => withThumb.find((action) => test(action.actionName.toLowerCase()));
  return find((name) => name === "front") || find((name) => /\bfront\b/.test(name)) || find((name) => name.includes("front"))
    || find((name) => /idle|stand/.test(name)) || withThumb[0] || character.actions[0];
};

// Tile and tool icons traced from "Library Panel.svg" so they stay sharp at any panel width.
const TILE_STROKE = { fill: "none", stroke: "#3a3a3a", strokeWidth: 4, strokeMiterlimit: 10 } as const;
const TILE_STROKE_BOLD = { ...TILE_STROKE, strokeWidth: 4.12 } as const;

const LibraryTileIcon = ({ kind }: { kind: LibraryTab }) => {
  if (kind === "characters") return (
    <svg viewBox="85.63 172.5 163.24 163.24" aria-hidden="true">
      <rect x="85.63" y="172.5" width="163.24" height="163.24" rx="12.69" fill="#b5b4b4" />
      <circle cx="141.55" cy="243.7" r="22.2" {...TILE_STROKE} />
      <path d="M132.26,265.9h17.76c9.14,0,16.55,7.41,16.55,16.55v24.86h-58.79l6.16-24.86c3.17-11.58,9.17-16.55,18.31-16.55Z" {...TILE_STROKE} />
      <circle cx="190.29" cy="223.69" r="22.89" {...TILE_STROKE_BOLD} />
      <path d="M199.22,307.31h23.17l-4.52-43.67c-2.76-12.32-9.4-17.07-18.83-17.07h-26.01s-7.29-2.04-12.81,9.14" {...TILE_STROKE_BOLD} />
      <circle cx="184.27" cy="264.61" r="14.95" {...TILE_STROKE} />
      <path d="M179.86,279.56h8.27c7.18,0,14.1,2.99,17.39,12.99l2.64,14.89h-41.29v-14.89c0-7.18,5.82-12.99,12.99-12.99Z" {...TILE_STROKE} />
      <path d="M154.26,266.45s-2.36,13.35-13.79,13.11c-11.43-.24-11.930-13.66-11.93-13.66" {...TILE_STROKE} />
      <path d="M192.28,279.13c-1.98,4.29-3.97,8.58-5.95,12.87,0,0-8.09-12.45-7.33-11.71" {...TILE_STROKE} />
    </svg>
  );
  if (kind === "background") return (
    <svg viewBox="347.92 172.5 163.24 163.24" aria-hidden="true">
      <rect x="347.92" y="172.5" width="163.24" height="163.24" rx="12.69" fill="#b5b4b4" />
      <path d="M469.26,266.09c-6.54,2.62-13.590,4.010-20.64,4.05,4.92-5.96,8.88-12.71,11.68-19.92-1.56.56-3.26.7-4.89.42,4.42-6.2,7.66-13.24,9.49-20.63-2.09.39-4.26.38-6.35,0,6.59-10.01,10.08-18.23,13.07-26.36,1.59,4.65,4.94,16.28,12.73,26.36-2.09.39-4.26.39-6.35,0,1.84,7.39,5.08,14.43,9.49,20.63-1.63.28-3.33.14-4.89-.42,2.8,7.21,6.75,13.96,11.68,19.92-7.05-.04-14.09-1.42-20.64-4.05l2.19,25.64h-9.26l2.68-25.64Z" {...TILE_STROKE_BOLD} />
      <path d="M461.57,249.01c.93,1.32,2.5,2.18,4.11,2.25,1.62.07,3.25-.63,4.3-1.86,1.47,1.5,3.72,2.09,5.8,1.79s3.99-1.39,5.52-2.83" {...TILE_STROKE_BOLD} />
      <path d="M476.43,228.22c-2.56,2.73-7.34,2.93-10.12.43" {...TILE_STROKE_BOLD} />
      <path d="M368.67,306.15c21.33-.47,42.61-2.95,63.48-7.39,11.66-2.48,23.28-5.59,35.2-6.12,11.91-.53,24.41,1.8,33.81,9.14" {...TILE_STROKE_BOLD} />
      <path d="M448.62,295.17c-40.26-5.72-43.15-29.95-79.42-25.84" {...TILE_STROKE_BOLD} />
      <circle cx="417.39" cy="241.75" r="17.51" {...TILE_STROKE_BOLD} />
      <path d="M369.2,192.72v122.8h131.95" {...TILE_STROKE_BOLD} />
    </svg>
  );
  if (kind === "fx") return (
    <svg viewBox="85.63 401.42 163.24 163.24" aria-hidden="true">
      <rect x="85.63" y="401.42" width="163.24" height="163.24" rx="12.69" fill="#b5b4b4" />
      <path d="M171.4,453.9C169.6,479 158,490.9 131.8,492.7C158,494.6 169.6,506.5 171.4,531.9C173.2,506.5 184.8,494.6 210.9,492.7C184.8,490.9 173.2,479 171.4,453.9Z" {...TILE_STROKE} />
      <path d="M165.39,461.97c-19.6,0-26.14-6.53-26.14-26.14,0,19.6-6.53,26.14-26.14,26.14,19.6,0,26.14,6.53,26.14,26.14,0-19.6,6.53-26.14,26.14-26.14Z" {...TILE_STROKE} />
      <path d="M113.12,509.39c3.17,6.65,21.55,5.28,36.19,2.44-23.57,7.91-42.02,9.22-45.39,2.14-3.37-7.08,9.29-20.57,30.3-33.87-11.44,9.57-24.26,22.64-21.09,29.3Z" fill="#3a3a3a" />
      <path d="M230.9,453.55c3.37,7.09-9.28,20.59-30.29,33.88,11.44-9.57,25.22-22.39,22.05-29.04-3.17-6.65-22.51-5.54-37.14-2.71,23.57-7.91,42.01-9.21,45.38-2.13Z" fill="#3a3a3a" />
    </svg>
  );
  return (
    <svg viewBox="347.92 401.42 163.24 163.24" aria-hidden="true">
      <rect x="347.92" y="401.42" width="163.24" height="163.24" rx="12.69" fill="#b5b4b4" />
      <path d="M421.06,508.75l-23.49-13.46v-20.49l23.49-13.46c3.82-1.08,7.62,1.79,7.62,5.76v35.88c0,3.97-3.8,6.84-7.62,5.76Z" {...TILE_STROKE_BOLD} />
      <path d="M386.66,474.81h10.91v20.16h-10.91c-1,0-1.8-.81-1.8-1.8v-16.56c0-1,.81-1.8,1.8-1.8Z" {...TILE_STROKE_BOLD} />
      <path d="M456.05,509.92c6.35-6.36,10.27-15.15,10.27-24.83s-3.93-18.48-10.27-24.85" {...TILE_STROKE_BOLD} />
      <path d="M469.1,522.97c9.8-9.73,15.86-23.22,15.86-38.12s-5.96-28.18-15.620-37.9" {...TILE_STROKE_BOLD} />
      <path d="M442.76,496.65c3.05-3,4.94-7.18,4.94-11.8s-1.78-8.58-4.71-11.56" {...TILE_STROKE_BOLD} />
      <path d="M456.05,445.17c-12.02,0-16.02-4.01-16.02-16.02,0,12.02-4.01,16.02-16.02,16.02,12.02,0,16.02,4.01,16.02,16.02,0-12.02,4.01-16.02,16.02-16.02Z" fill="#3a3a3a" />
      <path d="M456.05,520.91c-12.02,0-16.02-4.01-16.02-16.02,0,12.02-4.01,16.02-16.02,16.02,12.02,0,16.02,4.01,16.02,16.02,0-12.02,4.01-16.02,16.02-16.02Z" fill="#3a3a3a" />
    </svg>
  );
};

const ToolFrame = ({ children }: { children: ReactNode }) => (
  <svg viewBox="0 0 60 41" aria-hidden="true">
    <rect x="0.75" y="0.75" width="58.5" height="39.5" rx="9.9" fill="none" stroke="currentColor" strokeWidth="1.2" />
    {children}
  </svg>
);
const ImageGenIcon = () => <ToolFrame><path d="M59.24,28.36l-11.06-12.72c-1.63-1.87-4.57-1.73-6.02.28l-9.94,13.82-7.7-7.17c-2.09-1.94-5.39-1.7-7.17.52l-13.33,16.62M32.22,29.73l10.84,10.78" fill="none" stroke="currentColor" strokeWidth="1.2" /></ToolFrame>;
const VideoGenIcon = () => <ToolFrame><path d="M26.6,14.5v13.77c0,1.29,1.57,1.94,2.48,1.03l6.88-6.88c.57-.57.57-1.49,0-2.05l-6.88-6.88c-.92-.92-2.48-.27-2.48,1.03Z" fill="none" stroke="currentColor" strokeWidth="1.2" /></ToolFrame>;
const VoiceGenIcon = () => <ToolFrame><g fill="currentColor" transform="translate(0.6 0.3)"><path d="M29.4,26.4c-4.47,0-8.11-3.64-8.11-8.11h1.2c0,3.81,3.1,6.91,6.91,6.91s6.91-3.1,6.91-6.91h1.2c0,4.47-3.64,8.11-8.11,8.11Z"/><path d="M29.4,22.6c-2.16,0-3.91-1.75-3.91-3.91v-4.64c0-2.16,1.75-3.91,3.91-3.91s3.91,1.75,3.91,3.91v4.64c0,2.16-1.75,3.91-3.91,3.91ZM29.4,11.35c-1.49,0-2.71,1.21-2.71,2.71v4.64c0,1.49,1.21,2.71,2.71,2.71s2.71-1.21,2.71-2.71v-4.64c0-1.49-1.21-2.71-2.71-2.71Z"/><rect x="26.1" y="29.9" width="6.62" height="1.2"/><rect x="28.8" y="25.8" width="1.2" height="4.73"/></g></ToolFrame>;
const PaperclipIcon = () => <svg viewBox="0 0 14 16" aria-hidden="true"><path d="M2.3,6.7l1.54,3.09c1.08,2.15,3.7,3.03,5.85,1.95h0c2.15-1.08,3.03-3.7,1.95-5.85l-1.54-3.09-.55-1.1C8.78.16,6.9-.47,5.35.3h0C3.81,1.07,3.18,2.95,3.95,4.5l.99,1.98.67,1.34c.47.94,1.47,1.38,2.25.99h0c.77-.39,1.02-1.46.55-2.39l-1.48-2.97" fill="none" stroke="currentColor" strokeWidth="1"/></svg>;
const LibraryStackIcon = () => <svg viewBox="0 0 22 14" aria-hidden="true"><g fill="none" stroke="currentColor" strokeWidth=".9"><rect x="1" y="1" width="11.5" height="4.9" rx="1.9"/><rect x="1" y="7.2" width="11.5" height="4.9" rx="1.9"/><rect x="14.2" y="1.4" width="4.9" height="10.9" rx="1.9" transform="rotate(-8.25 16.6 6.8)"/></g></svg>;

const LIBRARY_TILES = [
  ["characters", "Characters"],
  ["background", "Backgrounds"],
  ["fx", "FX"],
  ["sfx", "SFX"],
] as const;

// Tab strip shown above the panel once a library is open (the home screen shows "Libraries").
const LIBRARY_TABS = [
  ["characters", "Characters"],
  ["background", "Background"],
  ["fx", "FX"],
  ["sfx", "SFX"],
] as const;

const SEARCH_PLACEHOLDERS: Record<LibraryTab, string> = {
  characters: "Search your Character",
  background: "Search your BG",
  fx: "Search your FX",
  sfx: "Search your SFX",
};

export default function AssetPanel({ onAddReferenceCharacter, selectedReferenceCharacterId, onAddProp, onAddText, onUploadBackground, onUploadVoice, onAIBackground, onAddMediaItem }: Props) {
  const [activeTab, setActiveTab] = useState<LibraryTab | null>(() => readRememberedView().activeTab);
  const [prompt, setPrompt] = useState("");
  const [working, setWorking] = useState(false);
  const [search, setSearch] = useState("");
  const imageInput = useRef<HTMLInputElement>(null);
  const audioInput = useRef<HTMLInputElement>(null);
  const zipInput = useRef<HTMLInputElement>(null);
  const flaInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement | null>(null);
  const { characters, packages, loading: libraryLoading, uploading, error: libraryError, uploadCustom, deleteCustom } = useCharacterLibrary();
  const [characterView, setCharacterView] = useState<string | null>(() => readRememberedView().characterView);
  // Inside My characters: the character whose poses are open (null = the character list).
  const [openCharacterId, setOpenCharacterId] = useState<string | null>(() => readRememberedView().openCharacterId ?? null);
  const [uploadNotice, setUploadNotice] = useState("");
  const [uploadMenuOpen, setUploadMenuOpen] = useState(false);
  const uploadMenuRef = useRef<HTMLDivElement>(null);
  const searchQuery = search.trim().toLowerCase();
  // No AI mode is highlighted until the user picks one (hover still shows the box).
  const [aiMode, setAiMode] = useState<"image" | "voice" | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => { rememberView({ activeTab, characterView, openCharacterId }); }, [activeTab, characterView, openCharacterId]);
  useEffect(() => {
    if (!uploadNotice) return;
    const timer = window.setTimeout(() => setUploadNotice(""), 8000);
    return () => window.clearTimeout(timer);
  }, [uploadNotice]);

  const openLibrary = (tab: LibraryTab | null) => { setSearch(""); setCharacterView(null); setOpenCharacterId(null); setActiveTab(tab); };
  const showMyCharacters = () => { setSearch(""); setOpenCharacterId(null); setCharacterView(MY_CHARACTERS); };
  // Back steps out one level: a character's poses → My characters → category grid → Libraries home.
  const goBack = () => {
    if (activeTab === "characters" && characterView === MY_CHARACTERS && openCharacterId) { setSearch(""); setOpenCharacterId(null); return; }
    if (activeTab === "characters" && characterView) { setSearch(""); setCharacterView(null); return; }
    openLibrary(null);
  };

  // Several ZIPs picked at once: upload one after another, then report one summary.
  const [batchProgress, setBatchProgress] = useState<{ done: number; total: number } | null>(null);
  // An Animate .fla is converted with Adobe Animate (desktop app) — that takes a while, so say so.
  const [convertingFla, setConvertingFla] = useState(false);
  const [dropActive, setDropActive] = useState(false);
  const importableFiles = (list: FileList | null | undefined) => Array.from(list || []).filter((file) => /\.(zip|fla)$/i.test(file.name));
  const importCustomZips = async (files: File[]) => {
    const hasFla = files.some((file) => /\.fla(\.zip)?$/i.test(file.name));
    setConvertingFla(hasFla);
    if (hasFla) setUploadNotice("Converting with Adobe Animate… this can take a few minutes. Animate may open in the background.");
    try { await importCustomFiles(files); } finally { setConvertingFla(false); }
  };
  const importCustomFiles = async (files: File[]) => {
    if (files.length === 1) { await importCustom(files[0]); return; }
    const saved: string[] = [];
    const already: string[] = [];
    const failed: string[] = [];
    for (let index = 0; index < files.length; index += 1) {
      setBatchProgress({ done: index + 1, total: files.length });
      try {
        const result = await uploadCustom(files[index], { quiet: true });
        (result.duplicate ? already : saved).push(result.name);
      } catch (cause) {
        failed.push(`${files[index].name}: ${cause instanceof Error ? cause.message : "upload failed"}`);
      }
    }
    setBatchProgress(null);
    const parts = [
      saved.length ? `${saved.length} saved to My characters` : "",
      already.length ? `${already.length} already there (${already.join(", ")})` : "",
      failed.length ? `${failed.length} failed — ${failed.join("; ")}` : "",
    ].filter(Boolean);
    setUploadNotice(parts.join(" · "));
    showMyCharacters();
  };

  const importCustom = async (input: File | File[]) => {
    try {
      const result = await uploadCustom(input);
      setUploadNotice(result.duplicate
        ? `"${result.name}" is already in My characters — it was saved the first time, no need to upload it again.`
        : `"${result.name}" saved to My characters.`);
      showMyCharacters();
    } catch {
      // The library context surfaces the error message in the panel.
    }
  };

  const removeCustom = async (packageId: string, name: string) => {
    if (!window.confirm(`Delete "${name}" from your library? Characters already placed on a canvas will stop working.`)) return;
    try { await deleteCustom(packageId); } catch { /* shown via library error */ }
  };

  const generateImage = async () => {
    const value = prompt.trim();
    if (!value || working) return;
    setWorking(true);
    try { await onAIBackground(value); } finally { setWorking(false); }
  };

  // My characters lists every installed character: admin libraries and custom imports alike.
  const openCharacter = characterView === MY_CHARACTERS && openCharacterId
    ? characters.find((character) => character.id === openCharacterId) || null
    : null;

  // Characters in the open view, narrowed by search. With no view open, search covers every character.
  const viewCharacters = useMemo(() => {
    const scoped = characterView === MY_CHARACTERS ? (openCharacter ? [openCharacter] : characters)
      : characterView ? characters.filter((character) => character.origin !== "custom" && sameCategory(characterCategory(character), characterView))
      : characters;
    // A character/category match keeps every pose; otherwise only the poses whose name matches.
    return scoped.flatMap((character) => {
      if (matchesSearch(searchQuery, character.name, character.sourceFolder, characterCategory(character))) return [character];
      const actions = character.actions.filter((action) => matchesSearch(searchQuery, action.actionName));
      return actions.length ? [{ ...character, actions }] : [];
    });
  }, [characterView, characters, openCharacter, searchQuery]);

  const toCards = (groups: Html5CharacterLibraryCharacter[]) => groups.flatMap((group) => group.actions.map((action) => ({
    id: action.id, characterId: group.id, name: action.actionName || group.name,
    characterName: group.name, thumbUrl: action.thumbUrl, actionId: action.id,
  })));

  const drawCards = (items: ReturnType<typeof toCards>) => items.map((card) => (
    <button key={card.id} className={`cb-visual-card ${selectedReferenceCharacterId === card.characterId ? "active" : ""}`}
      draggable onDragStart={(event) => {
        event.dataTransfer.effectAllowed = "copy";
        event.dataTransfer.setData("application/x-cb-reference-character", JSON.stringify({ characterId: card.characterId, actionId: card.actionId }));
      }}
      onClick={() => onAddReferenceCharacter(card.characterId, card.actionId)}
      title={`Click or drag ${card.name} (${card.characterName}) to the canvas`}>
      <strong className="cb-pose-label">{card.name}</strong>
      <span className="cb-visual-card-thumb portrait">{renderCharacterThumb(card.thumbUrl, card.name)}</span>
    </button>
  ));

  // One card per character; opening it shows all of its poses.
  const drawCharacterCards = (items: Html5CharacterLibraryCharacter[]) => items.map((character) => (
    <button key={character.id} type="button" className="cb-visual-card cb-character-card" onClick={() => { setSearch(""); setOpenCharacterId(character.id); }}
      title={`${character.name} — ${character.actions.length} pose${character.actions.length === 1 ? "" : "s"}`}>
      <strong className="cb-pose-label">{character.name}</strong>
      <span className="cb-visual-card-thumb portrait">{renderCharacterThumb(coverPose(character)?.thumbUrl, character.name)}</span>
    </button>
  ));
  const packageIdOf = (character: Html5CharacterLibraryCharacter) => character.libraryPackageId || character.packageId || character.id;

  return (
    <aside className={`cb-library-panel cb-reference-library-panel cb-library-v2 ${activeTab ? "" : "is-home"} ${dropActive ? "is-drop-target" : ""}`}
      // Drop HTML5 export ZIPs or Animate .fla files anywhere on the library to add them to My characters.
      onDragOver={(event) => { if (Array.from(event.dataTransfer.types).includes("Files")) { event.preventDefault(); event.dataTransfer.dropEffect = "copy"; setDropActive(true); } }}
      onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropActive(false); }}
      onDrop={(event) => {
        if (!Array.from(event.dataTransfer.types).includes("Files")) return;
        event.preventDefault();
        setDropActive(false);
        const files = importableFiles(event.dataTransfer.files);
        if (!files.length) { setUploadNotice("Drop an HTML5 export ZIP or an Animate .fla file."); return; }
        if (uploading || batchProgress) return;
        // Show My characters, where the upload button reports progress and the result appears.
        setActiveTab("characters");
        showMyCharacters();
        void importCustomZips(files);
      }}>
      <input ref={imageInput} type="file" accept="image/*" hidden onChange={(event) => {
        const file = event.target.files?.[0]; if (file) void onUploadBackground(file); event.currentTarget.value = "";
      }} />
      <input ref={audioInput} type="file" accept="audio/*,.m4a" hidden onChange={(event) => {
        const file = event.target.files?.[0]; if (file) void onUploadVoice(file); event.currentTarget.value = "";
      }} />
      <input ref={flaInput} type="file" accept=".fla,.zip" multiple hidden onChange={(event) => {
        const files = Array.from(event.target.files || []); if (files.length) void importCustomZips(files); event.currentTarget.value = "";
      }} />
      <input ref={zipInput} type="file" accept=".zip,application/zip" multiple hidden onChange={(event) => {
        const files = Array.from(event.target.files || []); if (files.length) void importCustomZips(files); event.currentTarget.value = "";
      }} />
      {/* webkitdirectory is not in React's typings, so it is set on the element directly. */}
      <input ref={(element) => { folderInput.current = element; element?.setAttribute("webkitdirectory", ""); }} type="file" multiple hidden onChange={(event) => {
        const files = Array.from(event.target.files || []); if (files.length) void importCustom(files); event.currentTarget.value = "";
      }} />

      <div className="cb-library-tabbar">
        {activeTab ? <div className="cb-library-tabs" role="tablist" aria-label="Libraries">
          {LIBRARY_TABS.map(([tab, label]) => (
            <button key={tab} type="button" role="tab" aria-selected={activeTab === tab} className={activeTab === tab ? "active" : ""}
              onClick={() => { if (activeTab !== tab) openLibrary(tab); }} title={label}>
              {label}
            </button>
          ))}
        </div> : <strong>Libraries</strong>}
      </div>

      <div className="cb-library-scroll">
        {/* Search + back only appear inside a library; the home screen shows just the four tiles. */}
        {activeTab && <div className="cb-visual-browser-search-row cb-library-category-search">
          <button className="cb-visual-browser-back" type="button" onClick={goBack} aria-label={activeTab === "characters" && openCharacter ? "Back to My characters" : activeTab === "characters" && characterView ? "Back to character categories" : "Back to libraries"}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 12H5m0 0 6-6m-6 6 6 6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </button>
          <label className="cb-visual-browser-search">
            <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.8" cy="10.8" r="6.2" fill="none" stroke="currentColor" strokeWidth="2.5"/><path d="m15.4 15.4 4.2 4.2" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/></svg>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={SEARCH_PLACEHOLDERS[activeTab]}
              aria-label={SEARCH_PLACEHOLDERS[activeTab]}
            />
          </label>
        </div>}

        {!activeTab && <div className="cb-library-home">
          <div className="cb-library-home-grid">
            {LIBRARY_TILES.map(([tab, label]) => (
              <button key={tab} className="cb-library-home-card" type="button" onClick={() => openLibrary(tab)}>
                <span>{label}</span>
                <LibraryTileIcon kind={tab} />
              </button>
            ))}
          </div>
        </div>}

        {activeTab === "characters" && <div className="cb-visual-browser-section cb-asset-reference-browser cb-character-library">
          {/* Libraries jumps straight to the Libraries home; Upload custom only lives inside My characters. */}
          <div className={`cb-character-tools ${characterView === MY_CHARACTERS ? "has-upload" : ""}`}>
            <button type="button" className="cb-character-tool" onClick={() => openLibrary(null)} title="Go to the Libraries home">
              <span>Libraries</span>
            </button>
            {characterView === MY_CHARACTERS && <div className="cb-character-upload" ref={uploadMenuRef}>
              <button type="button" className="cb-character-tool" disabled={uploading || Boolean(batchProgress)} aria-haspopup="menu" aria-expanded={uploadMenuOpen} onClick={() => setUploadMenuOpen((open) => !open)}
                title="Import an Adobe Animate HTML5 export from this device">
                <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.5v13M1.5 8h13" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
                <span>{convertingFla && (uploading || batchProgress) ? "Converting…" : batchProgress ? `Uploading ${batchProgress.done} of ${batchProgress.total}…` : uploading ? "Uploading…" : "Upload custom"}</span>
              </button>
              <Popover open={uploadMenuOpen} anchorRef={uploadMenuRef} onClose={() => setUploadMenuOpen(false)} matchAnchorWidth
                className="cb-character-upload-menu" aria-label="Upload custom character">
                <button type="button" role="menuitem" onClick={() => { setUploadMenuOpen(false); zipInput.current?.click(); }}><b>HTML5 export ZIPs</b><small>one or more .zip from Adobe Animate</small></button>
                <button type="button" role="menuitem" onClick={() => { setUploadMenuOpen(false); folderInput.current?.click(); }}><b>HTML5 export folder</b><small>.html + .js + images</small></button>
                <button type="button" role="menuitem" onClick={() => { setUploadMenuOpen(false); flaInput.current?.click(); }}><b>Animate file (.fla)</b><small>converted with Adobe Animate on this Mac</small></button>
              </Popover>
            </div>}
            <button type="button" className={`cb-character-tool ${characterView === MY_CHARACTERS ? "active" : ""}`} aria-pressed={characterView === MY_CHARACTERS}
              onClick={() => { if (characterView === MY_CHARACTERS && !openCharacterId) { setSearch(""); setCharacterView(null); } else showMyCharacters(); }}>
              <span>My characters</span>
            </button>
          </div>

          {libraryError && <div className="cb-library-upload-error in-panel">{libraryError}</div>}
          {uploadNotice && <p className="cb-library-home-notice cb-upload-notice" role="status">{uploadNotice}</p>}

          {libraryLoading ? <div className="cb-visual-empty-state">Loading character library…</div>
            : !characterView && !searchQuery ? (
              <div className="cb-character-category-grid">
                {CHARACTER_CATEGORIES.map(([name, imageUrl]) => (
                  <button key={name} type="button" className="cb-character-category-card" onClick={() => setCharacterView(name)} title={name}>
                    <span>{name}</span>
                    <span className="cb-character-category-thumb">{renderCharacterThumb(imageUrl, name)}</span>
                  </button>
                ))}
              </div>
            )
            : characterView === MY_CHARACTERS && !searchQuery ? (
              openCharacter ? (
                <section className="cb-similar-characters cb-my-character-package">
                  <h3><span>{openCharacter.name}</span>{openCharacter.origin === "custom" && (
                    <button type="button" onClick={() => void removeCustom(packageIdOf(openCharacter), packages.find((pkg) => pkg.id === packageIdOf(openCharacter))?.name || openCharacter.name)}
                      aria-label={`Delete ${openCharacter.name} from library`} title="Delete this upload from your library">Delete from library</button>
                  )}</h3>
                  <div className="cb-visual-browser-grid cb-first-screen-character-grid">{drawCards(toCards([openCharacter]))}</div>
                </section>
              ) : (
                <section className="cb-similar-characters cb-pose-browser">
                  <h3><span>My characters</span></h3>
                  <div className="cb-visual-browser-grid cb-first-screen-character-grid">{drawCharacterCards(characters)}</div>
                </section>
              )
            )
            : <section className="cb-similar-characters cb-pose-browser">
              <h3><span>{searchQuery ? `Results for "${search.trim()}"` : characterView === MY_CHARACTERS ? (openCharacter?.name || "My characters") : characterView}</span></h3>
              {viewCharacters.length === 0
                ? (searchQuery || characterView === MY_CHARACTERS
                  ? <div className="cb-visual-empty-state">No matching characters.</div>
                  : <p className="cb-library-home-notice">No character library installed yet. The admin can upload one, or open My characters to upload your own HTML5 export.</p>)
                : <div className="cb-visual-browser-grid cb-first-screen-character-grid">{drawCards(toCards(viewCharacters))}</div>}
            </section>}
        </div>}

        {activeTab === "background" && <MediaLibraryBrowser type="backgrounds" search={search} onAdd={onAddMediaItem} tools={<>
          <button type="button" onClick={() => imageInput.current?.click()}><b>＋</b>Upload</button>
          <button type="button" onClick={() => { setAiMode("image"); document.getElementById("cb-ai-prompt")?.focus(); }}><b>AI</b>AI Background</button>
          <button type="button" onClick={() => onAddProp("Static Prop")}><b>◇</b>Simple Prop</button>
          <button type="button" onClick={onAddText}><b>T</b>Text Layer</button>
        </>} />}

        {activeTab === "fx" && <MediaLibraryBrowser type="fx" search={search} onAdd={onAddMediaItem} />}

        {activeTab === "sfx" && <MediaLibraryBrowser type="sfx" search={search} onAdd={onAddMediaItem} tools={
          <button type="button" onClick={() => audioInput.current?.click()}><b>♬</b>Upload Voice / Dialogue</button>
        } />}
      </div>

      <div className="cb-ai-tools">
        <div className="cb-ai-prompt-wrap" ref={menuRef}>
          <Popover open={menuOpen} anchorRef={menuRef} onClose={() => setMenuOpen(false)} placement="top" align="stretch"
            className="cb-ai-menu" aria-label="Add to prompt">
            <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); imageInput.current?.click(); }}><PaperclipIcon /><b>Add photos &amp; Files</b><small>Upload from system</small></button>
            <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); openLibrary("background"); }}><LibraryStackIcon /><b>Add from library</b><small>Browse and search</small></button>
            <span className="cb-ai-more-options">More options</span>
          </Popover>
          <div className="cb-ai-prompt-bar">
            <button type="button" className="cb-ai-plus" aria-label="Add photos, files or library items" aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => setMenuOpen((open) => !open)}>
              <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.5v13M1.5 8h13" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
            </button>
            <input
              id="cb-ai-prompt"
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") { event.preventDefault(); void generateImage(); }
              }}
              placeholder={working ? "Generating…" : "Write your prompt here!"}
              disabled={working}
              aria-label="Describe the image to generate, then press Enter"
            />
          </div>
        </div>

        <div className="cb-ai-mode-row">
          <button type="button" className={aiMode === "image" ? "active" : ""} aria-pressed={aiMode === "image"} onClick={() => { setAiMode("image"); document.getElementById("cb-ai-prompt")?.focus(); }}><ImageGenIcon /><span>Ai Image Gen</span></button>
          <button type="button" disabled title="Coming soon — character motion comes from the uploaded Adobe Animate source files"><VideoGenIcon /><span>AI Video Gen</span></button>
          <button type="button" className={aiMode === "voice" ? "active" : ""} aria-pressed={aiMode === "voice"} onClick={() => { setAiMode("voice"); audioInput.current?.click(); }} title="Upload a voice / dialogue file"><VoiceGenIcon /><span>AI Voice Gen</span></button>
        </div>
      </div>
    </aside>
  );
}
