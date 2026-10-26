import { api } from "@/lib/api";
import type { EditorData, Project, Scene } from "@/types";

// ".cb" project files: the project's scenes, layers and settings as JSON. Characters and media
// are referenced by their library/media URLs, so a .cb opens on an install that still has them.

export const CB_FILE_FORMAT = "cb-studio-project";
export const CB_FILE_VERSION = 1;

export type CbProjectFile = {
  format: typeof CB_FILE_FORMAT;
  version: number;
  savedAt: string;
  project: { title: string; width: number; height: number };
  scenes: Array<{ name: string; order: number; duration_seconds: number; editor_data: EditorData }>;
};

const CB_TYPES = [{ description: "CB Studio project", accept: { "application/x-cb-studio": [".cb"] } }];

type WritableHandle = { name: string; createWritable: () => Promise<{ write: (data: string) => Promise<void>; close: () => Promise<void> }> };
type ReadableHandle = { name: string; getFile: () => Promise<File> };
type PickerWindow = Window & {
  showSaveFilePicker?: (options: unknown) => Promise<WritableHandle>;
  showOpenFilePicker?: (options: unknown) => Promise<Array<ReadableHandle & WritableHandle>>;
};

// The file each project was last saved to / opened from in this session: Save writes it
// again without asking (like Animate); Save As picks a new one.
const fileHandles = new Map<string, WritableHandle>();
export const rememberProjectFile = (projectId: string, handle: WritableHandle) => fileHandles.set(projectId, handle);

export const buildProjectFile = (project: Project, scenes: Scene[]): CbProjectFile => ({
  format: CB_FILE_FORMAT,
  version: CB_FILE_VERSION,
  savedAt: new Date().toISOString(),
  project: { title: project.title, width: project.width, height: project.height },
  scenes: [...scenes].sort((a, b) => a.order - b.order).map((scene) => ({
    name: scene.name, order: scene.order, duration_seconds: scene.duration_seconds, editor_data: scene.editor_data,
  })),
});

export const parseProjectFile = (text: string): CbProjectFile => {
  let data: Partial<CbProjectFile>;
  try { data = JSON.parse(text); } catch { throw new Error("This is not a CB Studio project file."); }
  if (data?.format !== CB_FILE_FORMAT || !data.project || !Array.isArray(data.scenes) || data.scenes.length === 0) {
    throw new Error("This is not a CB Studio project file.");
  }
  if (Number(data.version) > CB_FILE_VERSION) throw new Error("This project was saved by a newer CB Studio. Please update the app.");
  return data as CbProjectFile;
};

const fileNameFor = (title: string) => `${(title || "Untitled Project").replace(/[\\/:*?"<>|]+/g, " ").trim() || "Untitled Project"}.cb`;

/**
 * Write the project to a .cb file. Chrome, Edge and the desktop app show the system "Save as"
 * window (first time, or with saveAs); other browsers download the file instead.
 */
export async function saveProjectFile(projectId: string, file: CbProjectFile, saveAs = false): Promise<{ status: "saved" | "downloaded" | "cancelled"; name: string }> {
  const text = JSON.stringify(file, null, 2);
  const picker = (window as PickerWindow).showSaveFilePicker;
  if (picker) {
    let handle = saveAs ? undefined : fileHandles.get(projectId);
    if (!handle) {
      try {
        handle = await picker({ suggestedName: fileNameFor(file.project.title), types: CB_TYPES });
      } catch (cause) {
        if (cause instanceof DOMException && cause.name === "AbortError") return { status: "cancelled", name: "" };
        throw cause;
      }
    }
    const writable = await handle.createWritable();
    await writable.write(text);
    await writable.close();
    fileHandles.set(projectId, handle);
    return { status: "saved", name: handle.name };
  }
  const url = URL.createObjectURL(new Blob([text], { type: "application/x-cb-studio" }));
  const link = Object.assign(document.createElement("a"), { href: url, download: fileNameFor(file.project.title) });
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
  return { status: "downloaded", name: link.download };
}

/** Let the user pick a .cb file. Returns null when they cancel. */
export async function pickProjectFile(): Promise<{ file: CbProjectFile; handle?: WritableHandle } | null> {
  const picker = (window as PickerWindow).showOpenFilePicker;
  if (picker) {
    let handles: Array<ReadableHandle & WritableHandle>;
    try {
      handles = await picker({ types: CB_TYPES, multiple: false });
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === "AbortError") return null;
      throw cause;
    }
    const picked = handles[0];
    return picked ? { file: parseProjectFile(await (await picked.getFile()).text()), handle: picked } : null;
  }
  const chosen = await new Promise<File | null>((resolve) => {
    const input = Object.assign(document.createElement("input"), { type: "file", accept: ".cb" });
    input.addEventListener("change", () => resolve(input.files?.[0] || null), { once: true });
    input.addEventListener("cancel", () => resolve(null), { once: true });
    input.click();
  });
  return chosen ? { file: parseProjectFile(await chosen.text()) } : null;
}

/**
 * Pick a .cb file and turn it into a new project (all scenes). Returns the new project id, or
 * null when the user cancels. beforeCreate runs after the pick (e.g. flush the editor autosave).
 */
export async function openProjectFileAsNew(beforeCreate?: () => Promise<void>): Promise<string | null> {
  const picked = await pickProjectFile();
  if (!picked) return null;
  await beforeCreate?.();
  const { file } = picked;
  const created = await api.createProject(file.project.title || "Untitled Project", file.project.width, file.project.height);
  const scenes = [...file.scenes].sort((a, b) => a.order - b.order);
  for (let index = 0; index < scenes.length; index += 1) {
    const target = index === 0 && created.scenes[0] ? created.scenes[0] : await api.addScene(created.id);
    await api.updateScene(target.id, { name: scenes[index].name, duration_seconds: scenes[index].duration_seconds, editor_data: scenes[index].editor_data });
  }
  if (picked.handle) rememberProjectFile(created.id, picked.handle);
  return created.id;
}

/** "Edited 2 h ago" style label for project lists. */
export const formatEditedAgo = (iso: string) => {
  const seconds = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (!Number.isFinite(seconds)) return "";
  if (seconds < 60) return "Edited just now";
  if (seconds < 3600) return `Edited ${Math.round(seconds / 60)} min ago`;
  if (seconds < 86400) return `Edited ${Math.round(seconds / 3600)} h ago`;
  const days = Math.round(seconds / 86400);
  return days === 1 ? "Edited yesterday" : days < 30 ? `Edited ${days} days ago` : `Edited ${new Date(iso).toLocaleDateString()}`;
};
