import type { AnimationPlanResponse, Asset, ColorReplacement, EditorData, EditorObject, Project, RenderJob, Scene } from "@/types";
import type { Html5CharacterLibraryCharacter } from "@/lib/html5CharacterCatalog";
import type { MediaLibraryItem, MediaLibraryPackage, MediaLibraryResponse, MediaLibraryType } from "@/lib/mediaLibrary";

// Same-origin URLs are intentional. The browser always talks to the Next.js host
// (localhost or LAN IP), and Next rewrites these requests to Docker services.

export type CharacterLibraryPackageResponse = {
  id: string;
  name: string;
  url: string;
  created_at: string;
  characterCount: number;
  actionCount: number;
  scope?: "custom";
  userNamed?: boolean;
};

export type CharacterLibraryResponse = {
  packages: CharacterLibraryPackageResponse[];
  characters: Html5CharacterLibraryCharacter[];
};

const API = process.env.NEXT_PUBLIC_API_URL || "/api";
const AI = process.env.NEXT_PUBLIC_AI_URL || "/ai-api";

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers || {});
  if (!(init?.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(url, { ...init, headers, cache: "no-store" });
  const contentType = response.headers.get("content-type") || "";

  if (!response.ok) {
    let detail = `Request failed (${response.status} ${response.statusText})`;
    try {
      if (contentType.includes("application/json")) {
        const payload = await response.json();
        detail = payload?.detail || payload?.error || payload?.message || detail;
      } else {
        const text = (await response.text()).trim();
        // Never dump a full Next/Django HTML error page into the dashboard.
        if (text && !text.startsWith("<!DOCTYPE") && !text.startsWith("<html")) {
          detail = text.slice(0, 400);
        }
      }
    } catch {
      // Keep the concise status message.
    }
    throw new Error(detail);
  }

  if (response.status === 204) return undefined as T;
  return response.json();
}

export const api = {
  listProjects: () => request<Project[]>(`${API}/projects`),
  getProject: (id: string) => request<Project>(`${API}/projects/${id}`),
  createProject: (title: string, width = 1280, height = 720) => request<Project>(`${API}/projects`, { method: "POST", body: JSON.stringify({ title, width, height }) }),
  addScene: (projectId: string) => request<Scene>(`${API}/projects/${projectId}/add_scene`, { method: "POST" }),
  deleteScene: (sceneId: string) => request<void>(`${API}/scenes/${sceneId}`, { method: "DELETE" }),
  uploadProjectThumbnail: (projectId: string, image: Blob) => {
    const form = new FormData();
    form.append("file", image, "thumbnail.jpg");
    return request<Project>(`${API}/projects/${projectId}/thumbnail`, { method: "POST", body: form });
  },
  updateScene: (sceneId: string, body: Partial<{ name: string; duration_seconds: number; editor_data: EditorData }>) =>
    request<Scene>(`${API}/scenes/${sceneId}`, { method: "PATCH", body: JSON.stringify(body) }),
  /** format: mp4 / gif / jpeg / png; a JPEG / PNG is the frame at `time` (seconds) of `scene`. */
  startRender: (projectId: string, options: { format?: string; resolution?: string; time?: number; scene?: string } = {}) =>
    request<RenderJob>(`${API}/projects/${projectId}/render`, { method: "POST", body: JSON.stringify(options) }),
  getRender: (jobId: string) => request<RenderJob>(`${API}/renders/${jobId}`),
  uploadAsset: (projectId: string, kind: "background" | "audio", file: File) => {
    const form = new FormData();
    form.append("project", projectId);
    form.append("kind", kind);
    form.append("file", file);
    return request<Asset>(`${API}/assets/upload`, { method: "POST", body: form });
  },
  /** A font from this computer (Text panel), with its family and style for the team's font list. */
  uploadFont: (projectId: string, file: File, meta: Record<string, string>) => {
    const form = new FormData();
    form.append("project", projectId);
    form.append("kind", "font");
    form.append("file", file);
    for (const [key, value] of Object.entries(meta)) form.append(key, value);
    return request<Asset>(`${API}/assets/upload`, { method: "POST", body: form });
  },
  listFonts: () => request<import("@/lib/localFonts").TeamFont[]>(`${API}/assets/fonts`),
  listCharacterLibraries: () => request<CharacterLibraryResponse>(`${API}/assets/character-library`),
  uploadCharacterLibrary: (file: File) => {
    const form = new FormData();
    form.append("file", file);
    return request<{ package: CharacterLibraryPackageResponse; characters: Html5CharacterLibraryCharacter[] }>(`${API}/assets/character-library`, { method: "POST", body: form });
  },

  /** Editor "Upload custom": no admin login; the package is tagged scope=custom. */
  uploadCustomCharacter: (file: File) => {
    const form = new FormData();
    form.append("scope", "custom");
    form.append("file", file);
    // duplicate:true = this exact export was already uploaded; the saved copy is returned.
    return request<{ package: CharacterLibraryPackageResponse; characters: Html5CharacterLibraryCharacter[]; duplicate?: boolean }>(`${API}/assets/character-library`, { method: "POST", body: form });
  },

  deleteCharacterLibraryPackage: (packageId: string) =>
    request<void>(`${API}/assets/character-library?packageId=${encodeURIComponent(packageId)}`, { method: "DELETE" }),
  /** Saves recolour rules on a My characters package (every future use gets them). */
  setCustomCharacterColors: (packageId: string, colorReplacements: ColorReplacement[]) =>
    request<{ packageId: string; colorReplacements: ColorReplacement[] }>(`${API}/assets/character-library?scope=custom`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ packageId, colorReplacements }) }),
  /** Full copy of a My characters package under a new name (the original stays as it is). */
  duplicateCustomCharacter: (packageId: string, name: string, characterId?: string) =>
    request<{ package: { id: string; name: string }; characters: Html5CharacterLibraryCharacter[] }>(`${API}/assets/character-library?scope=custom`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ duplicateOf: packageId, name, characterId }) }),
  deleteCustomCharacter: (packageId: string) =>
    request<void>(`${API}/assets/character-library?scope=custom&packageId=${encodeURIComponent(packageId)}`, { method: "DELETE" }),
  listMediaLibrary: (type: MediaLibraryType) =>
    request<MediaLibraryResponse>(`${API}/assets/media-library?type=${encodeURIComponent(type)}`),
  uploadMediaLibrary: (type: MediaLibraryType, file: File) => {
    const form = new FormData();
    form.append("type", type);
    form.append("file", file);
    return request<{ package: MediaLibraryPackage; items: MediaLibraryItem[]; skipped: string[] }>(`${API}/assets/media-library`, { method: "POST", body: form });
  },
  deleteMediaLibraryPackage: (type: MediaLibraryType, packageId: string) =>
    request<void>(`${API}/assets/media-library?type=${encodeURIComponent(type)}&packageId=${encodeURIComponent(packageId)}`, { method: "DELETE" }),
  getAdminSession: () => request<{ authenticated: boolean }>(`${API}/admin/session`),
  adminLogin: (loginId: string, password: string) =>
    request<{ authenticated: boolean }>(`${API}/admin/session`, { method: "POST", body: JSON.stringify({ loginId, password }) }),
  adminLogout: () => request<void>(`${API}/admin/session`, { method: "DELETE" }),

  planAnimation: (prompt: string, width: number, height: number, duration: number, characters: EditorObject[]) =>
    request<AnimationPlanResponse>(`${AI}/v1/animation/plan`, {
      method: "POST",
      body: JSON.stringify({
        prompt,
        scene: { width, height, duration },
        characters: characters.map((character) => ({
          id: character.id,
          name: character.name,
          x: character.x,
          y: character.y,
          parts: (character.sourceParts || []).map((part) => part.key),
          actions: character.assetKind === "animate-createjs" ? ["talk"] : [],
        })),
      }),
    }),
  generateBackground: (prompt: string, width: number, height: number) =>
    request<{ image_url: string; provider: string; prompt: string }>(`${AI}/v1/generate/background`, {
      method: "POST",
      body: JSON.stringify({ prompt, width, height }),
    }),
};
