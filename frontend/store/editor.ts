import { create } from "zustand";
import type { Project, Scene } from "@/types";
type EditorStore = {
  project: Project | null; scene: Scene | null; selectedObjectId: string | null; isPlaying: boolean;
  /** Every selected object (Shift+click / marquee). selectedObjectId is set only when exactly one is selected. */
  selectedObjectIds: string[];
  setProject: (project: Project) => void; setScene: (scene: Scene) => void;
  selectObject: (id: string | null) => void; setSelection: (ids: string[]) => void; setPlaying: (value: boolean) => void;
  /** Store a freshly saved copy of a scene (autosave) without touching the selection. */
  refreshScene: (scene: Scene) => void;
};
export const useEditorStore = create<EditorStore>((set) => ({
  project: null, scene: null, selectedObjectId: null, selectedObjectIds: [], isPlaying: false,
  setProject: (project) => set({ project }), setScene: (scene) => set({ scene, selectedObjectId: null, selectedObjectIds: [] }),
  selectObject: (selectedObjectId) => set({ selectedObjectId, selectedObjectIds: selectedObjectId ? [selectedObjectId] : [] }),
  setSelection: (ids) => {
    const unique = Array.from(new Set(ids));
    set({ selectedObjectIds: unique, selectedObjectId: unique.length === 1 ? unique[0] : null });
  },
  setPlaying: (isPlaying) => set({ isPlaying }),
  refreshScene: (saved) => set((state) => ({
    scene: state.scene?.id === saved.id ? saved : state.scene,
    project: state.project ? { ...state.project, scenes: state.project.scenes.map((item) => (item.id === saved.id ? saved : item)) } : state.project,
  })),
}));
