// src/types/fsa.d.ts
//
// Local ambient declarations for the File System Access API surface. The
// upstream `.d.ts` ships most of these in newer TS lib, but our tsconfig
// (with `allowImportingTsExtensions`) doesn't always pull them in.
//
// Important: every property declared here MUST be NON-OPTIONAL unless the
// W3C spec explicitly marks it optional. Otherwise existing callers like
// `src/lib/opfs.ts` see these as possibly-undefined and the compiler
// reports "cannot invoke possibly undefined" errors.

interface Window {
  /** Chrome / Edge desktop. Returns a directory handle the user picked. */
  showDirectoryPicker: (options?: { id?: string; mode?: 'read' | 'readwrite' }) => Promise<FileSystemDirectoryHandle>;
  /** Safari TP and older WebKit builds (still optional — not all WebKit builds ship this). */
  webkitShowDirectoryPicker?: (options?: any) => Promise<FileSystemDirectoryHandle>;
}

interface FileSystemDirectoryHandle {
  /** Non-UI permission check. */
  queryPermission: (options?: { mode?: 'read' | 'readwrite' }) => Promise<PermissionState>;
  /** Requires user gesture. */
  requestPermission: (options?: { mode?: 'read' | 'readwrite' }) => Promise<PermissionState>;
  /** Async iteration over immediate children. */
  values: () => AsyncIterableIterator<[string, FileSystemHandle]>;
  entries: () => AsyncIterableIterator<[string, FileSystemHandle]>;
  getDirectoryHandle: (name: string, options?: { create?: boolean }) => Promise<FileSystemDirectoryHandle>;
  getFileHandle: (name: string, options?: { create?: boolean }) => Promise<FileSystemFileHandle>;
  removeEntry: (name: string, options?: { recursive?: boolean }) => Promise<void>;
  resolve?: (child: FileSystemHandle) => Promise<string[] | null>;
  isSameEntry?: (other: FileSystemHandle) => Promise<boolean>;
  /** Standard on every handle. */
  kind: 'directory';
  name: string;
}

interface FileSystemFileHandle {
  getFile: () => Promise<File>;
  createWritable: (options?: { keepExistingData?: boolean }) => Promise<FileSystemWritableFileStream>;
  kind: 'file';
  name: string;
}

interface FileSystemWritableFileStream extends WritableStream {
  seek?: (position: number) => Promise<void>;
  truncate?: (size: number) => Promise<void>;
}
