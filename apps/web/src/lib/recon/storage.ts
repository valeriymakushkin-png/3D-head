"use client";

import type { NaturalHair } from "@/lib/hair/params";
import type { HeadRig } from "@/lib/head/rig";
import type { FaceAnalysis } from "@/lib/style/analysis";

/**
 * On-device avatar vault (IndexedDB). "Private mode" avatars never leave
 * the device: only positions (the template topology is shared), the baked
 * albedo JPEG, the rig and the analysis are stored.
 */
export interface InstantTwinRecord {
  id: string;
  createdAt: number;
  name: string;
  positions: Float32Array;
  albedo: Blob;
  thumbnail: Blob | null;
  rig: HeadRig;
  analysis: FaceAnalysis;
  natural: NaturalHair;
  skinRgb: [number, number, number];
  bakedBeard: number;
  coverage: number;
  /** Set once synced to the cloud (Supabase avatar id). */
  remoteId: string | null;
}

const DB = "twinme";
const STORE = "avatars";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise<T>((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    t.oncomplete = () => db.close();
  });
}

export const avatarVault = {
  put: (r: InstantTwinRecord) => tx("readwrite", (s) => s.put(r)).then(() => r.id),
  get: (id: string) => tx<InstantTwinRecord | undefined>("readonly", (s) => s.get(id)),
  list: async () => {
    const all = await tx<InstantTwinRecord[]>("readonly", (s) => s.getAll());
    return all.sort((a, b) => b.createdAt - a.createdAt);
  },
  delete: (id: string) => tx("readwrite", (s) => s.delete(id)).then(() => undefined),
};

const ACTIVE_KEY = "twinme.activeAvatar";
export function getActiveAvatarId(): string | null {
  try {
    return localStorage.getItem(ACTIVE_KEY);
  } catch {
    return null;
  }
}
export function setActiveAvatarId(id: string | null) {
  try {
    if (id) localStorage.setItem(ACTIVE_KEY, id);
    else localStorage.removeItem(ACTIVE_KEY);
  } catch {
    /* storage unavailable (private mode): keep in memory only */
  }
}
