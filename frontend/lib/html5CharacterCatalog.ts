import type { ColorReplacement } from "@/types";

export type Html5CharacterLibraryAction = {
  id: string;
  characterId: string;
  characterName: string;
  actionName: string;
  thumbUrl: string;
  sourceSvgName: string;
  sourceFolder: string;
  assetUrl: string;
  sourceWidth: number;
  sourceHeight: number;
  fps: number;
  durationMs: number;
  /** Its symbol's Animate timeline (layers and keyframes), when the upload included the .fla:
   *  the cb-fla-timeline index.json URL, and the symbol's published class (lib.<flaSymbol>). */
  flaTimeline?: string;
  flaSymbol?: string;
  partAssets?: Record<string, {
    assetUrl: string;
    thumbUrl: string;
    renderKind?: "image" | "source-symbol";
  }>;
};

export type Html5CharacterLibraryCharacter = {
  id: string;
  name: string;
  sourceFolder: string;
  /** "custom" = imported by an editor user via Upload custom (shown under My characters). */
  origin?: "uploaded" | "custom";
  /** Library category tile, e.g. "Village" — from the ZIP folder above the character or the manifest. */
  category?: string;
  packageId?: string;
  /** Id of the installed package as the character-library DELETE endpoint expects it (added on GET). */
  libraryPackageId?: string;
  /** My characters only: recolour rules saved on the character itself (Find and Replace, All character library). */
  colorReplacements?: ColorReplacement[];
  /** Named by the user (a duplicate made in Find and Replace): shown exactly as typed, never cleaned. */
  userNamed?: boolean;
  actions: Html5CharacterLibraryAction[];
};
