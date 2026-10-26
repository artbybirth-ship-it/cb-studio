"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { MediaLibraryItem, MediaLibraryPackage, MediaLibraryType } from "@/lib/mediaLibrary";

/** Loads one Backgrounds / FX / SFX library and refreshes when the window regains focus. */
export function useMediaLibrary(type: MediaLibraryType) {
  const [items, setItems] = useState<MediaLibraryItem[]>([]);
  const [packages, setPackages] = useState<MediaLibraryPackage[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    try {
      const response = await api.listMediaLibrary(type);
      setItems(Array.isArray(response.items) ? response.items : []);
      setPackages(Array.isArray(response.packages) ? response.packages : []);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load library");
    } finally {
      setLoading(false);
    }
  }, [type]);

  useEffect(() => {
    setLoading(true);
    void refresh();
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refresh]);

  const uploadLibrary = useCallback(async (file: File) => {
    if (!file.name.toLowerCase().endsWith(".zip")) {
      const message = "Library must be uploaded as a ZIP file";
      setError(message);
      throw new Error(message);
    }
    setUploading(true);
    try {
      const result = await api.uploadMediaLibrary(type, file);
      await refresh();
      setError("");
      return result;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Library upload failed");
      throw cause;
    } finally {
      setUploading(false);
    }
  }, [refresh, type]);

  const deletePackage = useCallback(async (packageId: string) => {
    try {
      await api.deleteMediaLibraryPackage(type, packageId);
      await refresh();
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not delete library");
      throw cause;
    }
  }, [refresh, type]);

  return { items, packages, loading, uploading, error, refresh, uploadLibrary, deletePackage };
}
