/**
 * IndexedDB-based persistence for pending file uploads across redirects/refresh.
 * Uses a tiny custom wrapper — no extra dependencies.
 */

const DB_NAME = 'iffy_pending_uploads';
const STORE_NAME = 'uploads';
const DB_VERSION = 1;

export interface PendingFileEntry {
  name: string;
  type: string;
  size: number;
  lastModified: number;
  /** base64-encoded file content */
  base64: string;
}

export interface PendingUpload {
  id: string;
  createdAt: number;
  files: PendingFileEntry[];
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

// --- Limits ---
export const MAX_PENDING_FILES = 3;
export const MAX_PENDING_FILE_SIZE = 20 * 1024 * 1024; // 20 MB

export async function createPendingUpload(files: File[]): Promise<{ id: string; count: number }> {
  if (files.length > MAX_PENDING_FILES) {
    throw new Error(`Maximum ${MAX_PENDING_FILES} files allowed`);
  }
  for (const f of files) {
    if (f.size > MAX_PENDING_FILE_SIZE) {
      throw new Error(`"${f.name}" exceeds the 20 MB limit`);
    }
  }

  const id = crypto.randomUUID();
  const entries: PendingFileEntry[] = [];

  for (const file of files) {
    const buffer = await file.arrayBuffer();
    entries.push({
      name: file.name,
      type: file.type,
      size: file.size,
      lastModified: file.lastModified,
      base64: arrayBufferToBase64(buffer),
    });
  }

  const record: PendingUpload = { id, createdAt: Date.now(), files: entries };
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(record);
    tx.oncomplete = () => resolve({ id, count: files.length });
    tx.onerror = () => reject(tx.error);
  });
}

export async function getPendingUpload(id: string): Promise<PendingUpload | null> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).get(id);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => reject(req.error);
  });
}

export async function deletePendingUpload(id: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getLatestPendingUpload(): Promise<PendingUpload | null> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).getAll();
    req.onsuccess = () => {
      const all = req.result as PendingUpload[];
      if (all.length === 0) return resolve(null);
      all.sort((a, b) => b.createdAt - a.createdAt);
      resolve(all[0]);
    };
    req.onerror = () => reject(req.error);
  });
}

/** Convert a PendingFileEntry back into a File object */
export function pendingEntryToFile(entry: PendingFileEntry): File {
  const buffer = base64ToArrayBuffer(entry.base64);
  return new File([buffer], entry.name, {
    type: entry.type,
    lastModified: entry.lastModified,
  });
}
