// src/lib/localFolder.ts
//
// Core feature module for the "Sync to / from my device" capability.
// Combines three things:
//
//   1. The File System Access API surface (picker, permission re-verify,
//      directory walk) — supported on Chrome / Edge desktop.
//
//   2. Knowledge-base ingestion — uploads to the existing
//      `knowledge-base` Supabase bucket + rows in `knowledge_files` via the
//      already-shipped `uploadKnowledgeFile` / `deleteKnowledgeFile` helpers
//      in `src/lib/supabaseStorage.ts`. ZERO schema changes.
//
//   3. OPFS source-code mirror — copies text files (JS / TS / HTML / MD /
//      etc.) into `sandbox-inputs/<userId>/<relPath>` so the OpenCode
//      sandbox sub-agent can `cat` / `cp` them when the user is building
//      or deploying things derived from those source files.
//
// The user's chosen directory handle is persisted (and survives reloads)
// by `src/lib/kbSyncRegistry.ts`.

import { unzipSync } from 'fflate';
import {
  uploadKnowledgeFile,
  deleteKnowledgeFile,
  listKnowledgeFiles,
} from './supabaseStorage';
import {
  loadState,
  saveState,
  removeState,
  type LocalFolderEntry,
  type UserLocalFolderState,
} from './kbSyncRegistry';
import { saveFileToOpfs } from './opfs';

// ── Capability detection ──

export type Capability = 'full' | 'partial' | 'none';

export function detectCapability(): Capability {
  if (typeof window === 'undefined') return 'none';
  // The `as any` here is purely to silence TS2774; runtime support
  // genuinely varies by browser and must be detected dynamically.
  const w = window as any;
  if (typeof w.showDirectoryPicker === 'function') return 'full';
  if (typeof w.webkitShowDirectoryPicker === 'function') return 'full';
  if (typeof navigator !== 'undefined' && typeof navigator.storage?.getDirectory === 'function') return 'partial';
  return 'none';
}

// ── Hard-coded ignore list (path-segment match) ──
//
// Captured before user-defined patterns. These exist so that picking a
// folder like `~/Documents` doesn't attempt to ingest `node_modules/`,
// `.git/`, env files, or build outputs.

const HARD_SKIP_SEGMENTS = new Set([
  '.git', '.hg', '.svn',
  'node_modules', '.venv', 'venv', '__pycache__', '.cache',
  'dist', 'build', '.next', '.nuxt', '.parcel-cache',
  '.idea', '.vscode', '.DS_Store', 'Thumbs.db',
]);

const HARD_SKIP_FILE_PATTERNS = [
  /^\.env(\..*)?$/i,
  /\.pem$/i, /\.key$/i, /\.pfx$/i, /\.p12$/i,
  /\.lock$/i,
  /^\.gitignore$/i, /^\.gitattributes$/i, /^\.dockerignore$/i,
];

// ── Classification ──

const KB_FILE_PATTERN = /\.(txt|md|csv|json|ya?ml|toml|html?|xml|pdf|docx?|pptx?|png|jpe?g|webp|gif|svg|mp3|m4a|wav|ogg|flac|mp4|mov|webm)$/i;
const SOURCE_CODE_PATTERN = /\.(js|jsx|ts|tsx|mjs|cjs|py|sh|bash|zsh|rb|go|rs|java|kt|swift|c|cpp|cc|cxx|h|hpp|css|scss|sass|less|vue|svelte|prisma|sql|dockerfile|makefile|rakefile|gradle|properties|lua|pl|tcl|hs|scala|clj|ex|exs|erl|dart|yaml|yml|toml)$/i;
const ARCHIVE_PATTERN = /\.(zip|jar)$/i;
const MAX_ZIP_BYTES = 80 * 1024 * 1024; // 80 MB hard cap

export type Classification =
  | { kind: 'kb'; reason: 'document' | 'image' | 'audio' | 'video' | 'text' }
  | { kind: 'source'; reason: 'code' }
  | { kind: 'archive'; reason: 'zip' }
  | { kind: 'skip'; reason: string };

export function classifyFile(name: string): Classification {
  if (HARD_SKIP_FILE_PATTERNS.some(re => re.test(name))) {
    return { kind: 'skip', reason: 'hardcoded-pattern' };
  }
  if (ARCHIVE_PATTERN.test(name)) {
    return { kind: 'archive', reason: 'zip' };
  }
  if (SOURCE_CODE_PATTERN.test(name)) {
    return { kind: 'source', reason: 'code' };
  }
  if (KB_FILE_PATTERN.test(name)) {
    if (/\.(png|jpe?g|webp|gif|svg)$/i.test(name)) return { kind: 'kb', reason: 'image' };
    if (/\.(mp3|m4a|wav|ogg|flac)$/i.test(name)) return { kind: 'kb', reason: 'audio' };
    if (/\.(mp4|mov|webm)$/i.test(name)) return { kind: 'kb', reason: 'video' };
    if (/\.pdf$/i.test(name)) return { kind: 'kb', reason: 'document' };
    if (/\.(docx?|pptx?)$/i.test(name)) return { kind: 'kb', reason: 'document' };
    return { kind: 'kb', reason: 'text' };
  }
  return { kind: 'skip', reason: 'unsupported-extension' };
}

// Apply user-defined ignore patterns. Patterns are simple:
//   - "node_modules" matches any path segment equal to "node_modules"
//   - "*.log" matches any file whose basename matches
//   - "/private" matches paths that start with "private"
// Anything else is treated as a substring match on the full relPath.
export function applyIgnorePatterns(relPath: string, segments: string[], patterns: string[]): boolean {
  for (const raw of patterns) {
    const p = raw.trim();
    if (!p) continue;
    if (p.startsWith('/')) {
      if (relPath.startsWith(p.slice(1))) return true;
    } else if (p.includes('*')) {
      // Wrap the regex build in try/catch — malformed user input
      // (e.g. unclosed character classes) must not crash the scan.
      try {
        const re = new RegExp('^' + p.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$', 'i');
        if (re.test(relPath)) return true;
      } catch {
        // Malformed pattern — treat as non-matching rather than aborting.
      }
    } else if (segments.includes(p)) {
      return true;
    } else if (relPath.includes(p)) {
      return true;
    }
  }
  return false;
}

// ── Picking & lifecycle ──

export async function pickFolder(userId: string): Promise<UserLocalFolderState> {
  if (typeof window.showDirectoryPicker !== 'function') {
    throw new Error('NOT_SUPPORTED');
  }
  const handle: FileSystemDirectoryHandle = await window.showDirectoryPicker({
    id: 'beatrice-local-sync',
    mode: 'readwrite',
  });
  // Some browsers require the requestPermission to be called inside the
  // gesture; the picker counts as one but we re-confirm to be safe.
  const perm = await handle.requestPermission!({ mode: 'readwrite' });
  if (perm !== 'granted') {
    throw new Error(perm === 'denied' ? 'PERMISSION_DENIED' : 'PERMISSION_PROMPT');
  }

  const state: UserLocalFolderState = {
    userId,
    handle,
    handleName: handle.name,
    pickedAt: Date.now(),
    ignorePatterns: [],
    entries: [],
    lastScannedAt: 0,
  };
  await saveState(state);
  return state;
}

export async function loadStoredState(userId: string): Promise<UserLocalFolderState | null> {
  return loadState(userId);
}

export async function reattachPermission(userId: string): Promise<'granted' | 'prompt' | 'denied' | 'lost'> {
  const st = await loadState(userId);
  if (!st) return 'lost';
  try {
    const perm = await st.handle.queryPermission?.({ mode: 'readwrite' });
    if (perm === 'granted') {
      await saveState(st);
      return 'granted';
    }
    if (perm === 'prompt') {
      // Cannot auto-grant; require gesture.
      return 'prompt';
    }
    return 'denied';
  } catch {
    return 'lost';
  }
}

export async function requestPermissionNow(userId: string): Promise<'granted' | 'denied' | 'lost'> {
  const st = await loadState(userId);
  if (!st) return 'lost';
  try {
    const perm = await st.handle.requestPermission?.({ mode: 'readwrite' });
    if (perm === 'granted') {
      await saveState(st);
      return 'granted';
    }
    return 'denied';
  } catch {
    return 'lost';
  }
}

export async function discardFolder(userId: string): Promise<void> {
  await removeState(userId);
}

export async function setIgnorePatterns(userId: string, patterns: string[]): Promise<void> {
  const st = await loadState(userId);
  if (!st) throw new Error('NO_HANDLE');
  st.ignorePatterns = patterns;
  await saveState(st);
}

// ── Walking ──

interface RawEntry {
  relPath: string;
  fileHandle: FileSystemFileHandle;
  lastModified: number;
  size: number;
}

const MAX_DEPTH = 8;
const MAX_ENTRIES = 25_000; // safety cap

export async function walkFolder(
  root: FileSystemDirectoryHandle,
  ignorePatterns: string[],
): Promise<RawEntry[]> {
  const out: RawEntry[] = [];
  const visited = new Set<string>();
  const tooBig = { stopped: false };

  async function recurse(dir: FileSystemDirectoryHandle, prefix: string, depth: number) {
    if (tooBig.stopped || depth > MAX_DEPTH) return;
    if (out.length >= MAX_ENTRIES) { tooBig.stopped = true; return; }
    try {
      const iter = dir.entries?.();
      if (!iter) return;
      for await (const [name, childHandle] of iter) {
        if (visited.has(name + ':' + prefix)) continue;
        visited.add(name + ':' + prefix);

        const relBase = prefix ? `${prefix}/${name}` : name;
        const segments = relBase.split('/');

        // HardSkip by segment
        if (HARD_SKIP_SEGMENTS.has(name)) continue;
        if (HARD_SKIP_SEGMENTS.has(name.toLowerCase())) continue;
        if (HARD_SKIP_FILE_PATTERNS.some(re => re.test(name))) continue;
        if (applyIgnorePatterns(relBase, segments, ignorePatterns)) continue;

        if (childHandle.kind === 'directory') {
          await recurse(childHandle as FileSystemDirectoryHandle, relBase, depth + 1);
          if (tooBig.stopped) return;
        }
        if (childHandle.kind === 'file') {
          if (out.length >= MAX_ENTRIES) { tooBig.stopped = true; return; }
          try {
            const fh = childHandle as FileSystemFileHandle;
            const file = await fh.getFile();
            out.push({
              relPath: relBase,
              fileHandle: fh,
              lastModified: file.lastModified || Date.now(),
              size: file.size,
            });
          } catch {
            /* skip a single file we can't access */
          }
        }
      }
    } catch (err) {
      // Permission denied on a subdirectory — skip but keep going
      console.warn('walkFolder: dir iteration failed', prefix, err);
    }
  }

  await recurse(root, '', 0);
  return out;
}

// ── ZIP handling ──

interface ZipInnerEntry {
  relPath: string;
  buf: Uint8Array;
}

export async function unzipArchive(file: File): Promise<ZipInnerEntry[]> {
  if (file.size > MAX_ZIP_BYTES) {
    throw new Error(`Archive too large (${(file.size / 1024 / 1024).toFixed(1)} MB > ${MAX_ZIP_BYTES / 1024 / 1024} MB)`);
  }
  const buf = new Uint8Array(await file.arrayBuffer());
  const entries = unzipSync(buf);
  const out: ZipInnerEntry[] = [];
  for (const [name, data] of Object.entries(entries)) {
    // Sanitize path — no "../", no leading slashes, no NUL bytes
    if (!name || name.includes('\0')) continue;
    const clean = name.replace(/^\/+/, '').replace(/\\/g, '/');
    if (clean.includes('..')) continue;
    out.push({ relPath: clean, buf: data as Uint8Array });
  }
  return out;
}

// Converts extracted contents to a `File` named by relPath so KB rows
// preserve folder structure in their `file_name` column.
export function zipPartToFile(part: ZipInnerEntry, archiveName: string): File {
  const fullName = `${archiveName}/${part.relPath}`;
  // Guess mime type from extension
  const ext = part.relPath.split('.').pop()?.toLowerCase() ?? '';
  const mime =
    ext === 'json' ? 'application/json' :
    ext === 'md' ? 'text/markdown' :
    ext === 'txt' ? 'text/plain' :
    ext === 'csv' ? 'text/csv' :
    ext === 'html' || ext === 'htm' ? 'text/html' :
    'application/octet-stream';
  return new File([part.buf], fullName, { type: mime });
}

// ── Diff a previous snapshot against a fresh walk ──

export interface DiffResult {
  created: LocalFolderEntry[];
  modified: LocalFolderEntry[];
  deleted: LocalFolderEntry[];
}

export function diffSnapshots(
  prev: LocalFolderEntry[],
  curr: RawEntry[],
): DiffResult {
  const prevByPath = new Map<string, LocalFolderEntry>();
  for (const e of prev) prevByPath.set(e.relPath, e);

  const seen = new Set<string>();
  const created: LocalFolderEntry[] = [];
  const modified: LocalFolderEntry[] = [];

  for (const cur of curr) {
    seen.add(cur.relPath);
    const prevE = prevByPath.get(cur.relPath);
    if (!prevE) {
      created.push({ relPath: cur.relPath, lastModified: cur.lastModified, size: cur.size });
    } else if (prevE.lastModified !== cur.lastModified || prevE.size !== cur.size) {
      modified.push({
        relPath: cur.relPath,
        lastModified: cur.lastModified,
        size: cur.size,
        kbRowId: prevE.kbRowId,
      });
    }
  }
  const deleted = prev
    .filter(e => e.kbRowId && !seen.has(e.relPath))
    .map(e => ({ ...e }));
  return { created, modified, deleted };
}

// ── KB ingestion (with concurrency cap) ──

async function pool<T>(n: number, items: T[], worker: (item: T) => Promise<void>): Promise<void> {
  let i = 0;
  const runners: Promise<void>[] = [];
  for (let k = 0; k < Math.min(n, items.length); k++) {
    runners.push((async () => {
      while (true) {
        const idx = i++;
        if (idx >= items.length) return;
        try { await worker(items[idx]); } catch { /* swallow per-item */ }
      }
    })());
  }
  await Promise.all(runners);
}

export interface SyncCounters {
  scanned: number;
  skipped: number;
  createdKB: number;
  replacedKB: number;
  deletedKB: number;
  mirroredOPFS: number;
  errors: string[];
}

export async function ingestCreated(
  userId: string,
  raw: RawEntry[],
): Promise<{ counters: SyncCounters }> {
  const counters: SyncCounters = {
    scanned: raw.length,
    skipped: 0,
    createdKB: 0,
    replacedKB: 0,
    deletedKB: 0,
    mirroredOPFS: 0,
    errors: [],
  };

  // Helper — split "a/b/c.js" into ["a/b", "c.js"]
  const splitDirname = (rel: string): { dir: string; base: string } => {
    const idx = rel.lastIndexOf('/');
    if (idx === -1) return { dir: '', base: rel };
    return { dir: rel.slice(0, idx), base: rel.slice(idx + 1) };
  };

  await pool(3, raw, async (rec) => {
    const cls = classifyFile(rec.relPath.split('/').pop() || rec.relPath);
    if (cls.kind === 'skip') {
      counters.skipped++;
      return;
    }

    if (cls.kind === 'archive') {
      try {
        const file = await rec.fileHandle.getFile();
        const parts = await unzipArchive(file);
        const archiveBase = rec.relPath;
        for (const part of parts) {
          const innerCls = classifyFile(part.relPath);
          if (innerCls.kind === 'skip') { counters.skipped++; continue; }
          const f = zipPartToFile(part, archiveBase);
          try {
            await uploadKnowledgeFile(userId, f);
            counters.createdKB++;
            if (innerCls.kind === 'source') {
              try {
                // OPFS does not allow `/` in file names — split into dir + base
                const { dir, base } = splitDirname(part.relPath);
                await saveFileToOpfs(
                  `sandbox-inputs/${userId}/${archiveBase}${dir ? '/' + dir : ''}`,
                  base,
                  part.buf,
                );
                counters.mirroredOPFS++;
              } catch { /* OPFS failure is non-fatal */ }
            }
          } catch (e: any) {
            counters.errors.push(`${archiveBase}/${part.relPath}: ${e?.message || 'upload failed'}`);
          }
        }
      } catch (e: any) {
        counters.errors.push(`${rec.relPath}: ${e?.message || 'zip failed'}`);
      }
      return;
    }

    // kb or source — ingest into KB
    try {
      const file = await rec.fileHandle.getFile();
      const renamed = renameFileWithPath(file, rec.relPath);
      await uploadKnowledgeFile(userId, renamed);
      counters.createdKB++;

      if (cls.kind === 'source') {
        try {
          // OPFS does not allow `/` in file names — split into dir + base
          const { dir, base } = splitDirname(rec.relPath);
          await saveFileToOpfs(
            `sandbox-inputs/${userId}${dir ? '/' + dir : ''}`,
            base,
            await file.arrayBuffer(),
          );
          counters.mirroredOPFS++;
        } catch { /* OPFS failure non-fatal */ }
      }
    } catch (e: any) {
      counters.errors.push(`${rec.relPath}: ${e?.message || 'upload failed'}`);
    }
  });
  return { counters };
}

export async function replaceModified(
  userId: string,
  raw: RawEntry[],
): Promise<{ counters: SyncCounters }> {
  const counters: SyncCounters = {
    scanned: raw.length,
    skipped: 0,
    createdKB: 0,
    replacedKB: 0,
    deletedKB: 0,
    mirroredOPFS: 0,
    errors: [],
  };

  await pool(3, raw, async (rec) => {
    // Re-upload after delete — fewer round-trips than updating storage in place.
    const prev = await loadState(userId);
    if (!prev) return;
    const prevE = prev.entries.find(e => e.relPath === rec.relPath);
    if (prevE?.kbRowId) {
      try { await deleteKnowledgeFile(userId, prevE.kbRowId); counters.deletedKB++; }
      catch (e: any) { counters.errors.push(`${rec.relPath}: delete failed: ${e?.message || ''}`); }
    }
    try {
      const file = await rec.fileHandle.getFile();
      const renamed = renameFileWithPath(file, rec.relPath);
      await uploadKnowledgeFile(userId, renamed);
      counters.createdKB++;
      counters.replacedKB++;
      const cls = classifyFile(rec.relPath.split('/').pop() || '');
      if (cls.kind === 'source') {
        try {
          await saveFileToOpfs(`sandbox-inputs/${userId}`, rec.relPath, await file.arrayBuffer());
          counters.mirroredOPFS++;
        } catch { /* non-fatal */ }
      }
    } catch (e: any) {
      counters.errors.push(`${rec.relPath}: replace failed: ${e?.message || ''}`);
    }
  });
  return { counters };
}

export async function deleteMissing(
  userId: string,
  prevEntries: LocalFolderEntry[],
): Promise<{ counters: SyncCounters }> {
  const counters: SyncCounters = {
    scanned: prevEntries.length,
    skipped: 0,
    createdKB: 0,
    replacedKB: 0,
    deletedKB: 0,
    mirroredOPFS: 0,
    errors: [],
  };
  for (const e of prevEntries) {
    if (!e.kbRowId) continue;
    try { await deleteKnowledgeFile(userId, e.kbRowId); counters.deletedKB++; }
    catch (err: any) {
      counters.errors.push(`${e.relPath}: delete failed: ${err?.message || ''}`);
    }
  }
  return { counters };
}

function renameFileWithPath(file: File, relPath: string): File {
  if (file.name === relPath) return file;
  try {
    return new File([file], relPath, { type: file.type, lastModified: file.lastModified });
  } catch {
    return file;
  }
}

// ── Top-level scan-and-sync: returns a fresh state snapshot ──

export async function scanAndSync(userId: string): Promise<{
  state: UserLocalFolderState;
  counters: SyncCounters;
}> {
  const emptyCounters: SyncCounters = {
    scanned: 0, skipped: 0, createdKB: 0, replacedKB: 0, deletedKB: 0, mirroredOPFS: 0, errors: [],
  };

  const prev = await loadState(userId);
  if (!prev) return { state: null as unknown as UserLocalFolderState, counters: emptyCounters };

  // Re-verify permission before iterating; if it slipped we surface 'lost'
  let perm: 'granted' | 'prompt' | 'denied' = 'granted';
  try {
    perm = (await prev.handle.queryPermission?.({ mode: 'readwrite' }) ?? 'granted') as 'granted' | 'prompt' | 'denied';
  } catch {
    perm = 'denied';
  }
  if (perm !== 'granted') {
    // Don't destroy the handle — leave it so the panel can prompt the
    // user to reconnect; just skip the scan this cycle.
    return { state: prev, counters: emptyCounters };
  }

  let raw: RawEntry[];
  try {
    raw = await walkFolder(prev.handle, prev.ignorePatterns);
  } catch (e: any) {
    return {
      state: prev,
      counters: { ...emptyCounters, errors: [`walk: ${e?.message || 'failed'}`] },
    };
  }

  const diff = diffSnapshots(prev.entries, raw);

  const ingestResult = await ingestCreated(userId, diff.created.map(c => raw.find(r => r.relPath === c.relPath)).filter(Boolean) as RawEntry[]);
  const replaceResult = await replaceModified(userId, diff.modified.map(c => raw.find(r => r.relPath === c.relPath)).filter(Boolean) as RawEntry[]);
  const deleteResult = await deleteMissing(userId, diff.deleted);

  // Recompute entries with kbRowId by joining against current KB list.
  // Heuristic: match by file_name, file_size, uploaded_at-most-recent.
  const list = await listKnowledgeFiles(userId);
  const newEntries: LocalFolderEntry[] = [];
  for (const cur of raw) {
    const cls = classifyFile(cur.relPath.split('/').pop() || '');
    if (cls.kind === 'skip') continue;
    if (cls.kind === 'archive') continue; // zip itself is not a KB row
    const candidate = list.find(f => f.name === cur.relPath && Math.abs(f.size - cur.size) < 64);
    newEntries.push({
      relPath: cur.relPath,
      lastModified: cur.lastModified,
      size: cur.size,
      kbRowId: candidate?.id,
    });
  }
  const next: UserLocalFolderState = {
    ...prev,
    entries: newEntries,
    lastScannedAt: Date.now(),
  };
  await saveState(next);

  const counters: SyncCounters = {
    scanned: ingestResult.counters.scanned || raw.length,
    skipped: ingestResult.counters.skipped,
    createdKB: ingestResult.counters.createdKB + replaceResult.counters.createdKB,
    replacedKB: replaceResult.counters.replacedKB,
    deletedKB: deleteResult.counters.deletedKB,
    mirroredOPFS: ingestResult.counters.mirroredOPFS + replaceResult.counters.mirroredOPFS,
    errors: [
      ...ingestResult.counters.errors,
      ...replaceResult.counters.errors,
      ...deleteResult.counters.errors,
    ],
  };
  return { state: next, counters };
}
