"use client";

/**
 * Last drawn picture of a character on the stage (frame 0), kept in this browser. After a reload the
 * stage shows it while the player loads its edits, so nothing blank or half-edited shows meanwhile.
 * One entry per layer; it is only used when the key (the layer's edits) still matches.
 */

type Entry = { id: string; key: string; url: string };
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

export async function readSnapshot(id: string, key: string): Promise<string | null> {
  const db = await open();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const request = db.transaction(STORE).objectStore(STORE).get(id);
      request.onsuccess = () => { const entry = request.result as Entry | undefined; db.close(); resolve(entry && entry.key === key ? entry.url : null); };
      request.onerror = () => { db.close(); resolve(null); };
    } catch { resolve(null); }
  });
}

export async function writeSnapshot(id: string, key: string, url: string): Promise<void> {
  const db = await open();
  if (!db) return;
  try {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put({ id, key, url } satisfies Entry);
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
