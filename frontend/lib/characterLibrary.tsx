"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { cleanCharacterName, cleanLibraryNames } from "@/lib/characterNames";
import { zipPickedFolder } from "@/lib/folderZip";
import type { Html5CharacterLibraryAction, Html5CharacterLibraryCharacter } from "@/lib/html5CharacterCatalog";

type CharacterLibraryPackage = {
  id: string;
  name: string;
  url: string;
  created_at: string;
  characterCount: number;
  actionCount: number;
  scope?: "custom";
  /** A duplicate named by the user: its name is shown as typed. */
  userNamed?: boolean;
};

type CharacterLibraryContextValue = {
  characters: Html5CharacterLibraryCharacter[];
  actions: Html5CharacterLibraryAction[];
  packages: CharacterLibraryPackage[];
  loading: boolean;
  uploading: boolean;
  error: string;
  refresh: () => Promise<void>;
  uploadLibrary: (file: File) => Promise<void>;
  deletePackage: (packageId: string) => Promise<void>;
  /** Editor "Upload custom": a ZIP, or every file of a picked HTML5 export folder. */
  /** quiet: don't put a failure in the shared error banner (batch uploads report their own summary). */
  uploadCustom: (input: File | File[], options?: { quiet?: boolean }) => Promise<{ duplicate: boolean; name: string }>;
  deleteCustom: (packageId: string) => Promise<void>;
  findCharacter: (id: string) => Html5CharacterLibraryCharacter | null;
};

const CharacterLibraryContext = createContext<CharacterLibraryContextValue | null>(null);

export function CharacterLibraryProvider({ children }: { children: React.ReactNode }) {
  const [characters, setCharacters] = useState<Html5CharacterLibraryCharacter[]>([]);
  const [packages, setPackages] = useState<CharacterLibraryPackage[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    try {
      const response = await api.listCharacterLibraries();
      // Display names only ("Onethirdcopy5" → "One third 5"); ids and files are untouched.
      setCharacters(Array.isArray(response.characters) ? cleanLibraryNames(response.characters) : []);
      setPackages(Array.isArray(response.packages) ? response.packages.map((pkg) => ({ ...pkg, name: pkg.userNamed ? pkg.name : cleanCharacterName(pkg.name) })) : []);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load character library");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const onFocus = () => void refresh();
    const onVisibility = () => { if (document.visibilityState === "visible") void refresh(); };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [refresh]);

  const uploadLibrary = useCallback(async (file: File) => {
    if (!file.name.toLowerCase().endsWith(".zip")) throw new Error("Character library must be a ZIP file");
    setUploading(true);
    try {
      await api.uploadCharacterLibrary(file);
      await refresh();
      setError("");
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Character library upload failed";
      setError(message);
      throw cause;
    } finally {
      setUploading(false);
    }
  }, [refresh]);

  const deletePackage = useCallback(async (packageId: string) => {
    try {
      await api.deleteCharacterLibraryPackage(packageId);
      await refresh();
      setError("");
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Could not delete library";
      setError(message);
      throw cause;
    }
  }, [refresh]);

  const uploadCustom = useCallback(async (input: File | File[], options: { quiet?: boolean } = {}) => {
    setUploading(true);
    try {
      const file = Array.isArray(input) ? await zipPickedFolder(input) : input;
      // .fla (Adobe Animate source) is converted with Animate by the desktop app before installing.
      if (!/\.(zip|fla)$/i.test(file.name)) throw new Error("Choose an HTML5 export ZIP, its folder, or an Animate .fla file");
      const result = await api.uploadCustomCharacter(file);
      await refresh();
      setError("");
      return { duplicate: Boolean(result.duplicate), name: cleanCharacterName(result.package.name) };
    } catch (cause) {
      if (!options.quiet) setError(cause instanceof Error ? cause.message : "Custom character upload failed");
      throw cause;
    } finally {
      setUploading(false);
    }
  }, [refresh]);

  const deleteCustom = useCallback(async (packageId: string) => {
    try {
      await api.deleteCustomCharacter(packageId);
      await refresh();
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not delete custom character");
      throw cause;
    }
  }, [refresh]);

  const actions = useMemo(() => characters.flatMap((character) => character.actions), [characters]);
  const findCharacter = useCallback(
    (id: string) => characters.find((character) => character.id === id) || null,
    [characters],
  );

  const value = useMemo<CharacterLibraryContextValue>(() => ({
    characters, actions, packages, loading, uploading, error, refresh, uploadLibrary, deletePackage, uploadCustom, deleteCustom, findCharacter,
  }), [actions, characters, deleteCustom, deletePackage, error, findCharacter, loading, packages, refresh, uploadCustom, uploadLibrary, uploading]);

  return <CharacterLibraryContext.Provider value={value}>{children}</CharacterLibraryContext.Provider>;
}

export function useCharacterLibrary() {
  const value = useContext(CharacterLibraryContext);
  if (!value) throw new Error("useCharacterLibrary must be used inside CharacterLibraryProvider");
  return value;
}
