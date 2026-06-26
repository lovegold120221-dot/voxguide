// src/lib/localFolderContext.tsx
//
// React-side state machine for the local folder mirror. The Provider is
// mounted once (in App.tsx) and exposes:
//
//   - capability        \u2014 feature-detect (full | partial | none)
//   - status            \u2014 idle | unsupported | scanning | denied | lost | watching | error
//   - handle            \u2014 current { name, pickedAt, ignorePatterns }
//   - lastScannedAt     \u2014 ms epoch, for "scanned Xs ago" UI
//   - pendingCount      \u2014 queue size when bulk-ingest gate is open
//   - counters          \u2014 last scan counters (created/replaced/deleted KB rows)
//   - errors            \u2014 list of last-batch error strings
//
// Plus actions: pick, reattach, discard, scanNow, setIgnorePatterns.
//
// All filesystem access happens in `localFolder.ts`. This module just
// owns the React wiring.

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
} from 'react';
import {
  detectCapability,
  loadStoredState,
  pickFolder as libPickFolder,
  discardFolder as libDiscardFolder,
  reattachPermission,
  requestPermissionNow as libRequestPermission,
  setIgnorePatterns as libSetIgnorePatterns,
  scanAndSync as libScanAndSync,
  setAbsolutePath as libSetAbsolutePath,
  setTerminalGrant as libSetTerminalGrant,
} from './localFolder';
import type { SyncCounters } from './localFolder';
import type { UserLocalFolderState } from './kbSyncRegistry';
import type { Capability } from './localFolder';

export type FolderStatus =
  | 'unsupported'
  | 'idle'
  | 'lost'
  | 'denied'
  | 'scanning'
  | 'watching'
  | 'error';

export interface FolderHandleView {
  name: string;
  pickedAt: number;
  ignorePatterns: string[];
  /** Absolute path returned by the daemon's native folder picker (may be null if user only used the browser picker) */
  absolutePath?: string;
  /** Did the user grant terminal access inside this folder? */
  terminalGranted?: boolean;
  /** Did the user grant whole-computer terminal access? */
  wholeComputerGranted?: boolean;
}

export type LocalScope = 'selected_folder' | 'whole_computer';

export interface LocalPermissionSnapshot {
  selectedFolderPath?: string | null;
  selectedFolderTerminal: boolean;
  wholeComputerTerminal: boolean;
  lastGrantAt?: number;
}

interface LocalFolderContextValue {
  capability: Capability;
  status: FolderStatus;
  errorMessage: string | null;
  handle: FolderHandleView | null;
  lastScannedAt: number | null;
  pendingCount: number;
  counters: SyncCounters;
  errors: string[];
  permissions: LocalPermissionSnapshot;

  pick: () => Promise<void>;
  reattach: () => Promise<void>;
  discard: () => Promise<void>;
  scanNow: () => Promise<void>;
  setIgnorePatterns: (patterns: string[]) => Promise<void>;

  // ── NEW ── terminal + permission actions
  setAbsolutePath: (absolutePath: string) => Promise<void>;
  grantTerminalScope: (scope: LocalScope, granted: boolean) => Promise<void>;
  recallPermissions: () => void;
}

interface InternalState {
  capability: Capability;
  status: FolderStatus;
  errorMessage: string | null;
  handle: FolderHandleView | null;
  lastScannedAt: number | null;
  pendingCount: number;
  counters: SyncCounters;
  errors: string[];
  userId: string | null;
  permissions: LocalPermissionSnapshot;
}

type Action =
  | { type: 'init'; capability: Capability; userId: string }
  | { type: 'set-state'; state: UserLocalFolderState | null; status: FolderStatus }
  | { type: 'set-status'; status: FolderStatus; error?: string | null }
  | { type: 'scan-start' }
  | { type: 'scan-finish'; counters: SyncCounters; lastScannedAt: number }
  | { type: 'set-pending'; count: number }
  | { type: 'handle-update'; handle: { name: string; pickedAt: number; ignorePatterns: string[] } | null }
  | { type: 'reset-user'; capability: Capability; userId: string }
  | { type: 'no-user' };

const EMPTY_COUNTERS: Readonly<SyncCounters> = Object.freeze({
  scanned: 0,
  skipped: 0,
  createdKB: 0,
  replacedKB: 0,
  deletedKB: 0,
  mirroredOPFS: 0,
  errors: [],
});

const initial: InternalState = {
  capability: 'none',
  status: 'idle',
  errorMessage: null,
  handle: null,
  lastScannedAt: null,
  pendingCount: 0,
  counters: { ...EMPTY_COUNTERS },
  errors: [],
  userId: null,
  permissions: { selectedFolderTerminal: false, wholeComputerTerminal: false },
};

function reducer(state: InternalState, action: Action): InternalState {
  switch (action.type) {
    case 'init':
      return {
        ...state,
        capability: action.capability,
        userId: action.userId,
        status: 'idle',
      };
    case 'reset-user':
      // Wipe every byte of per-user state before loading a different
      // user's handle. Without this, user A's folder name and counters
      // would briefly render in user B's profile.
      return {
        ...initial,
        capability: action.capability,
        userId: action.userId,
        status: 'idle',
      };
    case 'no-user':
      return { ...initial, capability: state.capability };
    case 'set-state': {
      const handleInfo: FolderHandleView | null = action.state
        ? {
            name: action.state.handleName,
            pickedAt: action.state.pickedAt,
            ignorePatterns: action.state.ignorePatterns,
            absolutePath: action.state.absolutePath,
            terminalGranted: action.state.terminalGranted,
            wholeComputerGranted: action.state.wholeComputerGranted,
          }
        : null;
      const nextPermissions: LocalPermissionSnapshot = action.state
        ? {
            selectedFolderPath: action.state.absolutePath ?? null,
            selectedFolderTerminal: !!action.state.terminalGranted,
            wholeComputerTerminal: !!action.state.wholeComputerGranted,
            lastGrantAt: action.state.lastGrantAt,
          }
        : { selectedFolderPath: null, selectedFolderTerminal: false, wholeComputerTerminal: false };
      return {
        ...state,
        handle: handleInfo,
        status: action.status,
        lastScannedAt: action.state?.lastScannedAt || state.lastScannedAt,
        permissions: nextPermissions,
      };
    }
    case 'set-status':
      return { ...state, status: action.status, errorMessage: action.error ?? state.errorMessage };
    case 'scan-start':
      return { ...state, status: 'scanning', errorMessage: null };
    case 'scan-finish':
      return {
        ...state,
        status: action.counters.errors.length ? 'error' : 'watching',
        counters: action.counters,
        errors: action.counters.errors,
        lastScannedAt: action.lastScannedAt,
        pendingCount: 0,
      };
    case 'set-pending':
      return { ...state, pendingCount: action.count };
    case 'handle-update':
      return { ...state, handle: action.handle };
    default:
      return state;
  }
}

const Ctx = createContext<LocalFolderContextValue | null>(null);

export function LocalFolderProvider({
  userId,
  children,
}: {
  userId: string | null;
  children: React.ReactNode;
}) {
  const [state, dispatch] = useReducer(reducer, initial);

  // Initial capability detection + state restoration on user change.
  useEffect(() => {
    if (!userId) {
      dispatch({ type: 'no-user' });
      return;
    }
    const cap = detectCapability();
    // Synchronously wipe stale state from any previous user before we
    // look up this user's stored handle. Without this, user A's folder
    // name and counters would briefly render in user B's profile.
    dispatch({ type: 'reset-user', capability: cap, userId });
    (async () => {
      const stored = await loadStoredState(userId);
      if (!stored) {
        dispatch({ type: 'set-state', state: null, status: cap === 'none' ? 'unsupported' : 'idle' });
        return;
      }
      const perm = await reattachPermission(userId);
      if (perm === 'lost') {
        await libDiscardFolder(userId);
        dispatch({ type: 'set-state', state: null, status: 'lost' });
        return;
      }
      const status: FolderStatus =
        perm === 'granted' ? 'watching' :
        perm === 'prompt'  ? 'idle' :
        'denied';
      dispatch({ type: 'set-state', state: stored, status });
    })();
  }, [userId]);

  // \u2500\u2500 Actions \u2500\u2500

  const pick = useCallback(async () => {
    if (!userId) return;
    try {
      const newState = await libPickFolder(userId);
      dispatch({ type: 'set-state', state: newState, status: 'watching' });
    } catch (e: any) {
      const msg = e?.message || 'pick_failed';
      const status: FolderStatus =
        msg === 'NOT_SUPPORTED' ? 'unsupported'
        : msg === 'PERMISSION_DENIED' ? 'denied'
        : 'error';
      dispatch({ type: 'set-status', status, error: msg });
    }
  }, [userId]);

  const reattach = useCallback(async () => {
    if (!userId) return;
    const perm = await libRequestPermission(userId);
    if (perm === 'granted') {
      const stored = await loadStoredState(userId);
      dispatch({ type: 'set-state', state: stored, status: 'watching' });
    } else if (perm === 'denied') {
      dispatch({ type: 'set-status', status: 'denied' });
    } else {
      await libDiscardFolder(userId);
      dispatch({ type: 'set-state', state: null, status: 'lost' });
    }
  }, [userId]);

  const discard = useCallback(async () => {
    if (!userId) return;
    await libDiscardFolder(userId);
    dispatch({ type: 'set-state', state: null, status: 'idle' });
  }, [userId]);

  const scanNow = useCallback(async () => {
    if (!userId) return;
    dispatch({ type: 'scan-start' });
    try {
      const { counters } = await libScanAndSync(userId);
      dispatch({ type: 'scan-finish', counters, lastScannedAt: Date.now() });
      const updated = await loadStoredState(userId);
      if (updated) dispatch({ type: 'set-state', state: updated, status: counters.errors.length ? 'error' : 'watching' });
    } catch (e: any) {
      dispatch({ type: 'set-status', status: 'error', error: e?.message || 'scan failed' });
    }
  }, [userId]);

  const setIgnorePatterns = useCallback(async (patterns: string[]) => {
    if (!userId) return;
    await libSetIgnorePatterns(userId, patterns);
    const updated = await loadStoredState(userId);
    if (updated) dispatch({ type: 'set-state', state: updated, status: 'watching' });
  }, [userId]);

  const setAbsolutePath = useCallback(async (absolutePath: string) => {
    if (!userId) return;
    await libSetAbsolutePath(userId, absolutePath);
    const updated = await loadStoredState(userId);
    if (updated) dispatch({ type: 'set-state', state: updated, status: state.status });
  }, [userId, state.status]);

  const grantTerminalScope = useCallback(async (scope: LocalScope, granted: boolean) => {
    if (!userId) return;
    await libSetTerminalGrant(userId, scope === 'whole_computer'
      ? { wholeComputer: granted }
      : { folderTerminal: granted },
    );
    const updated = await loadStoredState(userId);
    if (updated) dispatch({ type: 'set-state', state: updated, status: state.status });
  }, [userId, state.status]);

  // Re-load the stored permissions without performing any side-effect.
  const recallPermissions = useCallback(() => {
    if (!userId) return;
    (async () => {
      const updated = await loadStoredState(userId);
      if (updated) dispatch({ type: 'set-state', state: updated, status: state.status });
    })();
  }, [userId, state.status]);

  const value: LocalFolderContextValue = useMemo(() => ({
    capability: state.capability,
    status: state.status,
    errorMessage: state.errorMessage,
    handle: state.handle,
    lastScannedAt: state.lastScannedAt,
    pendingCount: state.pendingCount,
    counters: state.counters,
    errors: state.errors,
    permissions: state.permissions,
    pick,
    reattach,
    discard,
    scanNow,
    setIgnorePatterns,
    setAbsolutePath,
    grantTerminalScope,
    recallPermissions,
  }), [state, pick, reattach, discard, scanNow, setIgnorePatterns, setAbsolutePath, grantTerminalScope, recallPermissions]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useLocalFolder(): LocalFolderContextValue {
  const ctx = useContext(Ctx);
  if (!ctx) {
    // Graceful fallback so a panel rendered outside the provider doesn't crash.
    return {
      capability: 'none',
      status: 'unsupported',
      errorMessage: null,
      handle: null,
      lastScannedAt: null,
      pendingCount: 0,
      counters: { ...EMPTY_COUNTERS },
      errors: [],
      permissions: { selectedFolderTerminal: false, wholeComputerTerminal: false },
      pick: async () => {},
      reattach: async () => {},
      discard: async () => {},
      scanNow: async () => {},
      setIgnorePatterns: async () => {},
      setAbsolutePath: async () => {},
      grantTerminalScope: async () => {},
      recallPermissions: () => {},
    };
  }
  return ctx;
}

// All consumers go through `useLocalFolder()`. The reducer and the
// Provider are the only public surface \u2014 anything that needs the raw
// record should call `loadStoredState(userId)` directly.
