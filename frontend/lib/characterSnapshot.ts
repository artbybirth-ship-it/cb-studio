"use client";

/**
 * Last drawn picture of a character on the stage (frame 0), kept in this browser. After a reload the
 * stage shows it while the player loads its edits, so nothing blank or half-edited shows meanwhile.
 * One entry per layer; it is only used when the key (the layer's edits) still matches.
 */

/** The part of the character's box the picture covers (0..1), when the player drew only the visible region. */
export type SnapshotView = { x: number; y: number; width: number; height: number };
type Entry = { id: string; key: string; url: string; view?: SnapshotView | null };
const DB = "cb-character-snapshots";
const STORE = "snapshots";

const open = () => new Promise<IDBDatabase | null>((resolve) => {
  try {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: "id" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
  } catch { resolve(null); }
});

/**
 * Every saved picture is read into memory as soon as this file loads (before the stage renders),
 * so the first frame that has the character can already carry its picture.
 */
let cache: Map<string, Entry> | null = null;
if (typeof indexedDB !== "undefined") {
  void open().then((db) => {
    if (!db) { cache = new Map(); return; }
    try {
      const request = db.transaction(STORE).objectStore(STORE).getAll();
      request.onsuccess = () => { const map = new Map<string, Entry>(); for (const entry of request.result as Entry[]) map.set(entry.id, entry); cache = map; db.close(); };
      request.onerror = () => { cache = new Map(); db.close(); };
    } catch { cache = new Map(); }
  });
}

/** The saved picture at once when the memory copy is ready; undefined when it is not ready yet. */
export function peekSnapshot(id: string, key: string): { url: string; view: SnapshotView | null } | null | undefined {
  if (!cache) return undefined;
  const entry = cache.get(id);
  return entry && entry.key === key ? { url: entry.url, view: entry.view || null } : null;
}

export async function readSnapshot(id: string, key: string): Promise<{ url: string; view: SnapshotView | null } | null> {
  const db = await open();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const request = db.transaction(STORE).objectStore(STORE).get(id);
      request.onsuccess = () => { const entry = request.result as Entry | undefined; db.close(); resolve(entry && entry.key === key ? { url: entry.url, view: entry.view || null } : null); };
      request.onerror = () => { db.close(); resolve(null); };
    } catch { resolve(null); }
  });
}

export async function writeSnapshot(id: string, key: string, url: string, view?: SnapshotView | null): Promise<void> {
  const db = await open();
  if (!db) return;
  try {
    const tx = db.transaction(STORE, "readwrite");
    const entry = { id, key, url, view: view || null } satisfies Entry;
    cache?.set(id, entry);
    tx.objectStore(STORE).put(entry);
    tx.oncomplete = () => db.close();
    tx.onerror = () => db.close();
  } catch { db.close(); }
}

/** Short stable hash of whatever decides how a character looks at frame 0. */
export const snapshotKey = (parts: unknown) => {
  const text = JSON.stringify(parts);
  let hash = 5381;
  for (let index = 0; index < text.length; index++) hash = ((hash << 5) + hash + text.charCodeAt(index)) | 0;
  return `${text.length}:${hash >>> 0}`;
};
