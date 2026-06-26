// src/lib/kbSyncRegistry.ts
//
// Persistent IndexedDB state for the "Sync to / from my device" feature.
// A single object store keyed by userId keeps the directory handle, the
// caller-supplied display name, the ignore patterns, the previously-seen
// file snapshot, and the local-path → knowledge-files row id mapping in
// one atomic record so a partial write never leaves us with a handle
// pointing at orphan snapshot rows.
//
// This is intentionally tiny and React-free — it is consumed by the watcher
// component and by read-side panels.

const DB_NAME = 'beatrice_local_sync';
const STORE_NAME = 'user_state';
const DB_VERSION = 1;

// ── Types ──

export interface LocalFolderEntry {
  /** Path relative to the picked folder, e.g. "reports/q2.pdf" */
  relPath: string;
  /** lastModified in ms from the underlying File object */
  lastModified: number;
  /** size in bytes */
  size: number;
  /** Supabase knowledge-files row id, set after a successful ingestion */
  kbRowId?: string;
  /** Origin tag — was this ingested directly or from inside a ZIP? */
  origin?: 'file' | 'archive';
  /** If from an archive, the source zip relPath */
  archiveSource?: string;
}

export interface UserLocalFolderState {
  userId: string;
  /** The directory handle, structured-clonable straight into IDB */
  handle: FileSystemDirectoryHandle;
  /** Display name — what the user picked (e.g. "Documents/Beatrice") */
  handleName: string;
  /** ms epoch the user picked this folder */
  pickedAt: number;
  /** Glob-ish ignore patterns the user has added (matched against relPath) */
  ignorePatterns: string[];
  /** Last-seen snapshot of every accepted entry in the folder */
  entries: LocalFolderEntry[];
  /** ms epoch — when was the snapshot last filled in */
  lastScannedAt: number;
  /** Absolute path returned by the daemon's native picker (e.g. "/Users/x/Projects/foo"). */
  absolutePath?: string;
  /** Whether the user granted terminal access inside the selected folder. */
  terminalGranted?: boolean;
  /** Whether the user granted whole-computer terminal access. */
  wholeComputerGranted?: boolean;
  /** ms epoch — when the user last toggled any grant (for UI badges). */
  lastGrantAt?: number;
}

// ── DB open ──

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'userId' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function loadState(userId: string): Promise<UserLocalFolderState | null> {
  try {
    const db = await openDB();
    return await new Promise<UserLocalFolderState | null>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(userId);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

export async function saveState(state: UserLocalFolderState): Promise<void> {
  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.put(state);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function removeState(userId: string): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.delete(userId);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch {
    /* swallow — used during error cleanup paths */
  }
}
