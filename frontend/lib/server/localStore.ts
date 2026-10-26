import { randomUUID } from "crypto";
import { promises as fs } from "fs";
import path from "path";
import os from "os";
import type { Asset, EditorData, Project, RenderJob, Scene } from "@/types";
import type { Html5CharacterLibraryCharacter } from "@/lib/html5CharacterCatalog";
import type { MediaLibraryItem, MediaLibraryPackage, MediaLibraryType } from "@/lib/mediaLibrary";

export type LocalCharacterPackage = {
  id: string;
  name: string;
  url: string;
  created_at: string;
  characterCount: number;
  actionCount: number;
  /** "custom" packages come from the editor's Upload custom button, not the admin. */
  scope?: "custom";
  /** Shared player bridge version the package's HTML files use (absent = old inline bridge). */
  bridgeVersion?: number;
  /** characterPackageFingerprint() of the extracted export; used to skip duplicate uploads. */
  fingerprint?: string;
  /** Custom packages: recolour rules every use of the character starts with. */
  colorReplacements?: import("@/types").ColorReplacement[];
  /** A duplicate named by the user (Find and Replace): its name is shown as typed. */
  userNamed?: boolean;
  characters: Html5CharacterLibraryCharacter[];
};

export type LocalMediaPackage = MediaLibraryPackage & { packageId: string; items: MediaLibraryItem[] };

type LocalStore = {
  version: 1;
  projects: Project[];
  assets: Asset[];
  characterPackages: LocalCharacterPackage[];
  mediaPackages: LocalMediaPackage[];
  renderJobs: RenderJob[];
};

const DEFAULT_EDITOR_DATA: EditorData = {
  background: "#ffffff",
  backgroundImage: null,
  objects: [],
};

let queue: Promise<unknown> = Promise.resolve();

function now() {
  return new Date().toISOString();
}

export function localDataRoot(): string {
  const configured = process.env.CB_LOCAL_DATA_DIR?.trim();
  if (configured) return path.resolve(configured);

  // Development fallback. Packaged Electron always injects CB_LOCAL_DATA_DIR.
  const base = process.platform === "darwin"
    ? path.join(os.homedir(), "Library", "Application Support", "CharacterBazaar Studio")
    : path.join(os.homedir(), ".characterbazaar-studio");
  return path.join(base, "local-data");
}

export function localMediaRoot(): string {
  return path.join(localDataRoot(), "media");
}

function storeFile(): string {
  return path.join(localDataRoot(), "store.json");
}

async function ensureRoot() {
  await fs.mkdir(localMediaRoot(), { recursive: true });
}

function emptyStore(): LocalStore {
  return {
    version: 1,
    projects: [],
    assets: [],
    characterPackages: [],
    mediaPackages: [],
    renderJobs: [],
  };
}

async function readStoreUnlocked(): Promise<LocalStore> {
  await ensureRoot();
  try {
    const raw = await fs.readFile(storeFile(), "utf8");
    const parsed = JSON.parse(raw) as Partial<LocalStore>;
    return {
      version: 1,
      projects: Array.isArray(parsed.projects) ? parsed.projects : [],
      assets: Array.isArray(parsed.assets) ? parsed.assets : [],
      characterPackages: Array.isArray(parsed.characterPackages) ? parsed.characterPackages : [],
      mediaPackages: Array.isArray(parsed.mediaPackages) ? parsed.mediaPackages : [],
      renderJobs: Array.isArray(parsed.renderJobs) ? parsed.renderJobs : [],
    };
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return emptyStore();
    throw error;
  }
}

async function writeStoreUnlocked(store: LocalStore): Promise<void> {
  await ensureRoot();
  const target = storeFile();
  const temp = `${target}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temp, JSON.stringify(store, null, 2), "utf8");
  await fs.rename(temp, target);
}

export async function readStore(): Promise<LocalStore> {
  await queue.catch(() => undefined);
  return readStoreUnlocked();
}

export async function updateStore<T>(mutator: (store: LocalStore) => T | Promise<T>): Promise<T> {
  let resolveResult!: (value: T) => void;
  let rejectResult!: (reason?: unknown) => void;
  const result = new Promise<T>((resolve, reject) => {
    resolveResult = resolve;
    rejectResult = reject;
  });

  queue = queue.then(async () => {
    try {
      const store = await readStoreUnlocked();
      const value = await mutator(store);
      await writeStoreUnlocked(store);
      resolveResult(value);
    } catch (error) {
      rejectResult(error);
      throw error;
    }
  });
  queue = queue.catch(() => undefined);
  return result;
}

export async function listProjects(): Promise<Project[]> {
  const store = await readStore();
  return [...store.projects].sort((a, b) => b.updated_at.localeCompare(a.updated_at));
}

export async function getProject(id: string): Promise<Project | null> {
  const store = await readStore();
  return store.projects.find((project) => project.id === id) || null;
}

export async function createProject(title: string, width: number, height: number): Promise<Project> {
  return updateStore((store) => {
    const created = now();
    const projectId = randomUUID();
    const scene: Scene = {
      id: randomUUID(),
      project: projectId,
      name: "Scene 1",
      order: 0,
      duration_seconds: 5,
      editor_data: structuredClone(DEFAULT_EDITOR_DATA),
      created_at: created,
      updated_at: created,
    };
    const project: Project = {
      id: projectId,
      title: title.slice(0, 200),
      width,
      height,
      status: "draft",
      thumbnail_url: "",
      scenes: [scene],
      created_at: created,
      updated_at: created,
    };
    store.projects.unshift(project);
    return project;
  });
}

export async function setProjectThumbnail(projectId: string, thumbnailUrl: string): Promise<Project | null> {
  return updateStore((store) => {
    const project = store.projects.find((item) => item.id === projectId);
    if (!project) return null;
    project.thumbnail_url = thumbnailUrl;
    project.updated_at = now();
    return project;
  });
}

export async function addScene(projectId: string): Promise<Scene | null> {
  return updateStore((store) => {
    const project = store.projects.find((item) => item.id === projectId);
    if (!project) return null;
    const created = now();
    const nextOrder = project.scenes.reduce((max, scene) => Math.max(max, scene.order), -1) + 1;
    const scene: Scene = {
      id: randomUUID(),
      project: projectId,
      name: `Scene ${nextOrder + 1}`,
      order: nextOrder,
      duration_seconds: 5,
      editor_data: structuredClone(DEFAULT_EDITOR_DATA),
      created_at: created,
      updated_at: created,
    };
    project.scenes.push(scene);
    project.updated_at = created;
    return scene;
  });
}

/** Delete a scene; a project always keeps at least one. */
export async function deleteScene(sceneId: string): Promise<"deleted" | "not-found" | "last-scene"> {
  return updateStore((store) => {
    for (const project of store.projects) {
      const index = project.scenes.findIndex((item) => item.id === sceneId);
      if (index < 0) continue;
      if (project.scenes.length <= 1) return "last-scene";
      project.scenes.splice(index, 1);
      project.updated_at = now();
      return "deleted";
    }
    return "not-found";
  });
}

export async function updateScene(
  sceneId: string,
  patch: Partial<Pick<Scene, "name" | "duration_seconds" | "editor_data">>,
): Promise<Scene | null> {
  return updateStore((store) => {
    for (const project of store.projects) {
      const scene = project.scenes.find((item) => item.id === sceneId);
      if (!scene) continue;
      if (typeof patch.name === "string") scene.name = patch.name.slice(0, 200);
      if (typeof patch.duration_seconds === "number" && Number.isFinite(patch.duration_seconds)) {
        scene.duration_seconds = Math.max(0.1, patch.duration_seconds);
      }
      if (patch.editor_data && typeof patch.editor_data === "object") {
        scene.editor_data = patch.editor_data;
      }
      const updated = now();
      scene.updated_at = updated;
      project.updated_at = updated;
      return scene;
    }
    return null;
  });
}

export async function addAsset(asset: Asset): Promise<Asset> {
  return updateStore((store) => {
    store.assets.push(asset);
    return asset;
  });
}

export async function saveMediaFile(relativePath: string, content: Uint8Array): Promise<string> {
  const normalized = relativePath.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!normalized || normalized.split("/").some((part) => part === ".." || part === "")) {
    throw new Error("Invalid media path");
  }
  const root = path.resolve(localMediaRoot());
  const target = path.resolve(root, normalized);
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) throw new Error("Unsafe media path");
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, content);
  return `/media/${normalized.split(path.sep).join("/")}`;
}

export async function registerCharacterPackage(pkg: LocalCharacterPackage): Promise<void> {
  await updateStore((store) => {
    store.characterPackages = store.characterPackages.filter((item) => item.id !== pkg.id);
    store.characterPackages.push(pkg);
  });
}

/** Patch a package in place, keeping its position (category order follows install order). */
export async function updateCharacterPackage(packageId: string, patch: Partial<LocalCharacterPackage>): Promise<void> {
  await updateStore((store) => {
    store.characterPackages = store.characterPackages.map((item) => item.id === packageId ? { ...item, ...patch } : item);
  });
}

export async function listCharacterPackages(): Promise<LocalCharacterPackage[]> {
  const store = await readStore();
  return store.characterPackages;
}

export async function registerMediaPackage(pkg: LocalMediaPackage): Promise<void> {
  await updateStore((store) => {
    store.mediaPackages = store.mediaPackages.filter((item) => item.id !== pkg.id);
    store.mediaPackages.push(pkg);
  });
}

export async function listMediaPackages(type: MediaLibraryType): Promise<LocalMediaPackage[]> {
  const store = await readStore();
  return store.mediaPackages.filter((pkg) => pkg.type === type);
}

export async function removeMediaPackage(type: MediaLibraryType, packageId: string): Promise<LocalMediaPackage | null> {
  return updateStore((store) => {
    const found = store.mediaPackages.find((item) => item.id === packageId && item.type === type) || null;
    if (found) store.mediaPackages = store.mediaPackages.filter((item) => item !== found);
    return found;
  });
}

export async function removeCharacterPackage(packageId: string): Promise<boolean> {
  return updateStore((store) => {
    const before = store.characterPackages.length;
    store.characterPackages = store.characterPackages.filter((item) => item.id !== packageId);
    return store.characterPackages.length !== before;
  });
}

export async function createRenderJob(projectId: string): Promise<RenderJob | null> {
  return updateStore((store) => {
    const project = store.projects.find((item) => item.id === projectId);
    if (!project) return null;
    const job: RenderJob = {
      id: randomUUID(),
      project: projectId,
      status: "failed",
      progress: 0,
      output_url: "",
      error: "MP4 rendering requires the optional Django render service. Editing, saving, uploads and character libraries work locally in the desktop app.",
    };
    store.renderJobs.unshift(job);
    return job;
  });
}

export async function getRenderJob(id: string): Promise<RenderJob | null> {
  const store = await readStore();
  return store.renderJobs.find((job) => job.id === id) || null;
}
