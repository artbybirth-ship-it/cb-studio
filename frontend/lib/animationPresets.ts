import type { CharacterPartKey } from "@/types";

type Sample = { t: number; offsetX?: number; offsetY?: number; rotation?: number };
export type GesturePreset = { label: string; parts: Record<CharacterPartKey, Sample[]> };

export const GESTURE_PRESETS: Record<string, GesturePreset> = {
  wave_right: {
    label: "Wave Right Hand",
    parts: {
      rightUpperArm: [{ t: 0, rotation: 0 }, { t: 0.16, rotation: -26 }, { t: 0.86, rotation: -26 }, { t: 1, rotation: 0 }],
      rightForearm: [{ t: 0, rotation: 0 }, { t: 0.16, rotation: -38 }, { t: 0.34, rotation: 20 }, { t: 0.52, rotation: -28 }, { t: 0.7, rotation: 20 }, { t: 0.86, rotation: -18 }, { t: 1, rotation: 0 }],
      rightHand: [{ t: 0, rotation: 0 }, { t: 0.28, rotation: 14 }, { t: 0.48, rotation: -12 }, { t: 0.68, rotation: 14 }, { t: 1, rotation: 0 }],
    },
  },
  wave_left: {
    label: "Wave Left Hand",
    parts: {
      leftUpperArm: [{ t: 0, rotation: 0 }, { t: 0.16, rotation: 26 }, { t: 0.86, rotation: 26 }, { t: 1, rotation: 0 }],
      leftForearm: [{ t: 0, rotation: 0 }, { t: 0.16, rotation: 38 }, { t: 0.34, rotation: -20 }, { t: 0.52, rotation: 28 }, { t: 0.7, rotation: -20 }, { t: 0.86, rotation: 18 }, { t: 1, rotation: 0 }],
      leftHand: [{ t: 0, rotation: 0 }, { t: 0.28, rotation: -14 }, { t: 0.48, rotation: 12 }, { t: 0.68, rotation: -14 }, { t: 1, rotation: 0 }],
    },
  },
  raise_right_hand: {
    label: "Raise Right Hand",
    parts: {
      rightUpperArm: [{ t: 0, rotation: 0 }, { t: 0.45, rotation: -42 }, { t: 0.8, rotation: -42 }, { t: 1, rotation: 0 }],
      rightForearm: [{ t: 0, rotation: 0 }, { t: 0.45, rotation: -28 }, { t: 0.8, rotation: -28 }, { t: 1, rotation: 0 }],
    },
  },
  raise_left_hand: {
    label: "Raise Left Hand",
    parts: {
      leftUpperArm: [{ t: 0, rotation: 0 }, { t: 0.45, rotation: 42 }, { t: 0.8, rotation: 42 }, { t: 1, rotation: 0 }],
      leftForearm: [{ t: 0, rotation: 0 }, { t: 0.45, rotation: 28 }, { t: 0.8, rotation: 28 }, { t: 1, rotation: 0 }],
    },
  },
  point_right: {
    label: "Point Right",
    parts: {
      rightUpperArm: [{ t: 0, rotation: 0 }, { t: 0.32, rotation: -25 }, { t: 0.82, rotation: -25 }, { t: 1, rotation: 0 }],
      rightForearm: [{ t: 0, rotation: 0 }, { t: 0.32, rotation: 55 }, { t: 0.82, rotation: 55 }, { t: 1, rotation: 0 }],
    },
  },
  point_left: {
    label: "Point Left",
    parts: {
      leftUpperArm: [{ t: 0, rotation: 0 }, { t: 0.32, rotation: 25 }, { t: 0.82, rotation: 25 }, { t: 1, rotation: 0 }],
      leftForearm: [{ t: 0, rotation: 0 }, { t: 0.32, rotation: -55 }, { t: 0.82, rotation: -55 }, { t: 1, rotation: 0 }],
    },
  },
  nod: {
    label: "Nod Head",
    parts: { head: [{ t: 0, rotation: 0 }, { t: 0.25, rotation: 8, offsetY: 4 }, { t: 0.5, rotation: -3, offsetY: 0 }, { t: 0.75, rotation: 8, offsetY: 4 }, { t: 1, rotation: 0, offsetY: 0 }] },
  },
  shake_head: {
    label: "Shake Head",
    parts: { head: [{ t: 0, rotation: 0 }, { t: 0.2, rotation: -8 }, { t: 0.4, rotation: 8 }, { t: 0.6, rotation: -8 }, { t: 0.8, rotation: 8 }, { t: 1, rotation: 0 }] },
  },
  lean_forward: {
    label: "Lean Forward",
    parts: {
      torso: [{ t: 0, rotation: 0 }, { t: 0.35, rotation: 7, offsetY: 3 }, { t: 0.75, rotation: 7, offsetY: 3 }, { t: 1, rotation: 0, offsetY: 0 }],
      head: [{ t: 0, rotation: 0 }, { t: 0.35, rotation: -4 }, { t: 0.75, rotation: -4 }, { t: 1, rotation: 0 }],
    },
  },
};

export const MOVEMENT_PRESETS = ["move_left", "move_right", "move_to_character", "enter_left", "enter_right", "exit_left", "exit_right"] as const;
export const ALL_ANIMATION_PRESETS = [...Object.keys(GESTURE_PRESETS), ...MOVEMENT_PRESETS, "talk"];
