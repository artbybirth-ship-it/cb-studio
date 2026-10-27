"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { formatEditedAgo, openProjectFileAsNew } from "@/lib/projectFile";
import { clearRecentProjects, recentProjectsOf } from "@/lib/openProjects";
import type { Project } from "@/types";
import { useCharacterLibrary } from "@/lib/characterLibrary";
import HeaderUserIcon from "@/components/HeaderUserIcon";

type DocumentPreset = {
  id: string;
  label: string;
  width: number;
  height: number;
};

const DOCUMENT_PRESETS: DocumentPreset[] = [
  { id: "hd", label: "HDV 1280×720", width: 1280, height: 720 },
  { id: "full-hd", label: "Full HD 1920×1080", width: 1920, height: 1080 },
  { id: "4k", label: "4K 3840×2160", width: 3840, height: 2160 },
];

const clampDocumentDimension = (value: number) => Math.max(64, Math.min(7680, Math.round(Number(value) || 64)));

export default function Dashboard() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [title, setTitle] = useState("");
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const [mode, setMode] = useState<"home" | "new" | "open">("home");
  const [showAllProjects, setShowAllProjects] = useState(false);
  const [openingFile, setOpeningFile] = useState(false);
  const [recentClears, setRecentClears] = useState(0);
  // Open Project: the 5 most recent (after any "Clear recent"), or every project newest first.
  const sortedProjects = useMemo(() => [...projects].sort((a, b) => b.updated_at.localeCompare(a.updated_at)), [projects]);
  const recentProjects = useMemo(() => recentProjectsOf(projects, 5), [projects, recentClears]);
  const shownProjects = showAllProjects ? sortedProjects : recentProjects;
  const clearRecent = () => {
    clearRecentProjects();
    setRecentClears((count) => count + 1);
    setShowAllProjects(false);
  };
  const openFromDevice = async () => {
    setError("");
    setOpeningFile(true);
    try {
      const createdId = await openProjectFileAsNew();
      if (createdId) window.location.href = `/editor/${createdId}`;
      else setOpeningFile(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not open the project file");
      setOpeningFile(false);
    }
  };
  const [tutorialNotice, setTutorialNotice] = useState<number | null>(null);
  const [documentCategory, setDocumentCategory] = useState("Character Animation");
  const [presetId, setPresetId] = useState<string | null>("full-hd");
  const [documentWidth, setDocumentWidth] = useState(1920);
  const [documentHeight, setDocumentHeight] = useState(1080);
  const [orientation, setOrientation] = useState<"horizontal" | "vertical" | null>("horizontal");
  const { characters, packages, error: libraryError } = useCharacterLibrary();

  const openNewProject = () => {
    setTitle("");
    setPresetId("full-hd");
    setOrientation("horizontal");
    setDocumentWidth(1920);
    setDocumentHeight(1080);
    setMode("new");
  };

  const chooseOrientation = (next: "horizontal" | "vertical") => {
    if (orientation === next) return;
    setOrientation(next);
    if (next === "vertical" && documentWidth > documentHeight) {
      setDocumentWidth(documentHeight);
      setDocumentHeight(documentWidth);
    } else if (next === "horizontal" && documentHeight > documentWidth) {
      setDocumentWidth(documentHeight);
      setDocumentHeight(documentWidth);
    }
    setPresetId(null);
  };


  const load = async () => {
    try { setProjects(await api.listProjects()); setError(""); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not load projects"); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (!params.has("newProject")) return;
    params.delete("newProject");
    const query = params.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`);
    openNewProject();
  }, [openNewProject]);

  const selectedPreset = useMemo(
    () => DOCUMENT_PRESETS.find((preset) => preset.id === presetId) || null,
    [presetId],
  );

  const choosePreset = (preset: DocumentPreset) => {
    setPresetId(preset.id);
    setOrientation(preset.width >= preset.height ? "horizontal" : "vertical");
    setDocumentWidth(preset.width);
    setDocumentHeight(preset.height);
  };

  const updateDimension = (axis: "width" | "height", raw: string) => {
    const next = clampDocumentDimension(Number(raw));
    setPresetId(null);
    if (axis === "width") setDocumentWidth(next);
    else setDocumentHeight(next);
  };

  const create = async (event: FormEvent) => {
    event.preventDefault();
    const value = title.trim() || "Untitled Project-01";
    setCreating(true);
    try {
      const project = await api.createProject(value, clampDocumentDimension(documentWidth), clampDocumentDimension(documentHeight));
      window.location.href = `/editor/${project.id}`;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Create failed");
      setCreating(false);
    }
  };

  return (
    <main className="cb-home-shell">
      <header className="cb-home-topbar">
        <button className="cb-global-home" onClick={() => { setMode("home"); setTutorialNotice(null); }} aria-label="Home"><img src="/opening-screen/home-button.svg" alt="Home" /></button>
        <div className="cb-opening-logo"><img src="/opening-screen/cb-studio-logo.svg" alt="Character Bazaar Studio" /></div>
        <HeaderUserIcon />
      </header>

      <div className="cb-home-grid">
        <section className="cb-home-main">
          <div className="cb-home-project-actions">
            <button onClick={openNewProject} className={mode === "new" ? "active" : ""} aria-pressed={mode === "new"}>New Project</button>
            <button onClick={() => setMode("open")} className={mode === "open" ? "active" : ""} aria-pressed={mode === "open"}>Open Project</button>
            <button onClick={() => void openFromDevice()} className={openingFile ? "active" : ""} disabled={openingFile} title="Open a .cb project file from your computer">
              {openingFile ? "Opening…" : "Open from device…"}
            </button>
          </div>

          <div className="cb-welcome-panel">
            {mode !== "open" && <>
              <div className="cb-welcome-copy"><strong>Welcome to Character Bazaar studio, <b>Rohit!</b></strong><span>Learn How to Use CB studio!</span></div>
              <div className="cb-tutorial-grid">
                {[1,2,3,4,5,6,7,8].map((item) => (
                  <button key={item} type="button" onClick={() => setTutorialNotice(item)} aria-label={`Tutorial ${String(item).padStart(2, "0")}: video coming soon`}>
                    <span>{`Tutorials 0${item}`}</span><i aria-hidden="true" />
                  </button>
                ))}
              </div>
              {tutorialNotice !== null && <div className="cb-tutorial-notice" role="status">Tutorial {String(tutorialNotice).padStart(2, "0")} video link will be added soon. <button type="button" onClick={() => setTutorialNotice(null)} aria-label="Dismiss notice">×</button></div>}
            </>}

            {mode === "open" && <div className="cb-open-projects cb-open-projects-v2">
              <div className="cb-home-open-head">
                <strong>{showAllProjects ? "All projects" : "Recent projects"}</strong>
                {!showAllProjects && recentProjects.length > 0 && (
                  <button type="button" className="cb-home-clear-recent" onClick={clearRecent} title="Hide these from Recent. Your projects are not deleted.">Clear recent</button>
                )}
              </div>
              {loading ? <p className="cb-home-open-note">Loading projects…</p>
                : sortedProjects.length === 0 ? <p className="cb-home-open-note">No projects yet.</p>
                : shownProjects.length === 0 ? <p className="cb-home-open-note">No recent projects. Your projects are still under “Show all projects”.</p>
                : (
                <div className="cb-home-recent-grid">
                  {shownProjects.map((project) => (
                    <Link key={project.id} href={`/editor/${project.id}`} className="cb-home-project-card" title={`Open ${project.title}`}>
                      <span className="cb-home-project-thumb">
                        {project.thumbnail_url ? <img src={project.thumbnail_url} alt="" draggable={false} /> : <i aria-hidden="true">{(project.title || "U").trim().charAt(0).toUpperCase()}</i>}
                      </span>
                      <span className="cb-home-project-meta"><strong>{project.title || "Untitled"}</strong><small>{formatEditedAgo(project.updated_at)}</small></span>
                    </Link>
                  ))}
                </div>
              )}
              {(showAllProjects || sortedProjects.length > recentProjects.length) && (
                <div className="cb-home-open-actions">
                  <button type="button" className="cb-home-show-all" onClick={() => setShowAllProjects((value) => !value)}>
                    {showAllProjects ? "Show recent only" : `Show all projects (${sortedProjects.length})`}
                  </button>
                </div>
              )}
            </div>}
            {error && <div className="cb-home-error">{error}</div>}
          </div>
        </section>

        <aside className="cb-home-library">
          <div className="cb-home-library-tab">Libraries</div>
          <div className="cb-home-library-grid">
            <div className="cb-opening-library-item"><span>Characters</span><div className="cb-opening-library-icon"><img src="/opening-screen/characters.png" alt="" /></div><small>{characters.length} universal</small></div>
            <div className="cb-opening-library-item"><span>Backgrounds</span><div className="cb-opening-library-icon"><img src="/opening-screen/backgrounds.png" alt="" /></div></div>
            <div className="cb-opening-library-item"><span>FX</span><div className="cb-opening-library-icon"><img src="/opening-screen/fx.png" alt="" /></div></div>
            <div className="cb-opening-library-item"><span>SFX</span><div className="cb-opening-library-icon"><img src="/opening-screen/sfx.png" alt="" /></div></div>
          </div>
          <Link href="/admin" className="cb-character-library-upload">
            <b>⚙</b>
            <span>Admin Library Management<small>{packages.length} installed pack{packages.length === 1 ? "" : "s"} · upload/remove from Admin only</small></span>
          </Link>
          {characters.length === 0 && <div className="cb-library-upload-error">No character library installed. Admin must upload a ZIP first.</div>}
          {libraryError && <div className="cb-library-upload-error">{libraryError}</div>}
        </aside>
      </div>

      {mode === "new" && (
        <div className="cb-project-backdrop" onPointerDown={(event) => { if (event.target === event.currentTarget) setMode("home"); }}>
          <form className="cb-create-modal" role="dialog" aria-modal="true" aria-labelledby="cb-create-title" onSubmit={create}>
            <div className="cb-create-drag" data-drag-handle>
              <strong id="cb-create-title">Create new project</strong>
            </div>
            <div className="cb-create-content">
              <label className="cb-create-name"><span>Project Title</span><input value={title} onChange={event => setTitle(event.target.value)} placeholder="Untitled" autoFocus /></label>
              <div className="cb-create-size-row">
                <div className="cb-create-size-label">Video Size</div>
                <div className="cb-create-size-fields">
                  <label><input aria-label="Canvas width in pixels" type="number" min="64" max="7680" value={documentWidth} onChange={event => updateDimension("width",event.target.value)} /><span>Width</span></label>
                  <label><input aria-label="Canvas height in pixels" type="number" min="64" max="7680" value={documentHeight} onChange={event => updateDimension("height",event.target.value)} /><span>Height</span></label>
                </div>
                <div className="cb-create-orientation" role="group" aria-label="Canvas orientation">
                  <button type="button" className={orientation === "horizontal" ? "selected" : ""} onClick={() => chooseOrientation("horizontal")} aria-pressed={orientation === "horizontal"}><span className="cb-orient-landscape"/>Horizontal</button>
                  <button type="button" className={orientation === "vertical" ? "selected" : ""} onClick={() => chooseOrientation("vertical")} aria-pressed={orientation === "vertical"}><span className="cb-orient-portrait"/>Vertical</button>
                </div>
              </div>
              <div className="cb-create-presets" role="group" aria-label="Video size presets">
                {DOCUMENT_PRESETS.map(preset => (
                  <button type="button" key={preset.id} onClick={() => choosePreset(preset)} className={presetId === preset.id ? "selected" : ""} aria-pressed={presetId === preset.id}>
                    <span className="cb-create-video-icon" aria-hidden="true">▷</span>
                    <span>{preset.label}</span>
                  </button>
                ))}
              </div>
              {error && <p className="cb-create-error" role="alert">{error}</p>}
              <div className="cb-create-footer">
                <button type="button" className="cancel" onClick={() => setMode("home")}>Cancel</button>
                <button type="submit" className="create" disabled={creating}>{creating ? "Creating…" : "Create"}</button>
              </div>
            </div>
          </form>
        </div>
      )}
    </main>
  );
}
