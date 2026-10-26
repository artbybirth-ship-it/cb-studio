/** Shared types and rules for the Backgrounds / FX / SFX ZIP libraries (client + server safe). */

export type MediaLibraryType = "backgrounds" | "fx" | "sfx";

export type MediaLibraryItem = {
  id: string;
  packageId: string;
  type: MediaLibraryType;
  name: string;
  category: string;
  /** Displayable image or playable audio. */
  url: string;
  /** Thumbnail image (empty for SFX). */
  previewUrl: string;
  /** Original vector file (.ai / .eps) when the item is shown through a preview image. */
  sourceUrl?: string;
  /** Extension of the original file, without the dot. */
  format: string;
  mimeType: string;
  size: number;
};

export type MediaLibraryPackage = {
  id: string;
  type: MediaLibraryType;
  name: string;
  url: string;
  created_at: string;
  itemCount: number;
  skipped: string[];
};

export type MediaLibraryResponse = { packages: MediaLibraryPackage[]; items: MediaLibraryItem[] };

export const MEDIA_LIBRARY_TYPES: MediaLibraryType[] = ["backgrounds", "fx", "sfx"];

/** Files shown/played directly in the editor. Keep in sync with backend/projects/media_library.py. */
export const MEDIA_DISPLAY_EXTENSIONS: Record<MediaLibraryType, string[]> = {
  backgrounds: [".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg"],
  fx: [".gif", ".png", ".webp", ".apng", ".svg"],
  sfx: [".mp3", ".wav", ".ogg", ".m4a", ".aac", ".flac"],
};

/** Vector originals that need a same-name preview image next to them. */
export const MEDIA_VECTOR_EXTENSIONS: Record<MediaLibraryType, string[]> = {
  backgrounds: [".ai", ".eps"],
  fx: [],
  sfx: [],
};

export const MEDIA_PREVIEW_EXTENSIONS = [".png", ".jpg", ".jpeg", ".webp", ".svg", ".gif"];

export const MEDIA_LIBRARY_COPY: Record<MediaLibraryType, { label: string; singular: string; empty: string; example: string[] }> = {
  backgrounds: {
    label: "Backgrounds",
    singular: "background",
    empty: "No background library installed. Admin must upload a Backgrounds ZIP first.",
    example: ["Village/day.jpg", "Village/night.png", "City/street.ai  +  City/street.png  (preview)"],
  },
  fx: {
    label: "FX",
    singular: "effect",
    empty: "No FX library installed. Admin must upload an FX ZIP first.",
    example: ["Magic/sparkle.gif", "Smoke/puff.webp", "Shapes/star.svg"],
  },
  sfx: {
    label: "SFX",
    singular: "sound",
    empty: "No SFX library installed. Admin must upload an SFX ZIP first.",
    example: ["Nature/birds.mp3", "Doors/knock.wav", "UI/click.ogg"],
  },
};

export const MEDIA_MIME_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".gif": "image/gif",
  ".webp": "image/webp", ".apng": "image/apng", ".svg": "image/svg+xml",
  ".mp3": "audio/mpeg", ".wav": "audio/wav", ".ogg": "audio/ogg", ".m4a": "audio/mp4",
  ".aac": "audio/aac", ".flac": "audio/flac",
  ".ai": "application/postscript", ".eps": "application/postscript",
};
