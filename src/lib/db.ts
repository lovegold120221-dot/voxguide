import Dexie, { Table } from 'dexie';

export interface ChatMessage {
  id?: number;
  userId: string;
  sessionId?: string;
  role: 'user' | 'model';
  text: string;
  timestamp: string;
  attachmentUrl?: string;
  attachmentName?: string;
}

export interface UserSettings {
  userId: string;
  googleToken?: string;
  googleRefreshToken?: string;
  avatarUrl?: string;
  whatsappPaired?: boolean;
  whatsappPhone?: string | null;
  whatsappPermissions?: any;
  knowledgeDomains?: string[];
  updatedAt?: string;
}

export interface Session {
  id: string;
  userId: string;
  lastActive: string;
}

export interface KnowledgeFile {
  id: string;
  userId: string;
  name: string;
  type: string;
  size: number;
  uploadedAt: string;
  opfsPath: string;
}

export interface LocalFolderState {
  userId: string;         // primary key — one per user
  folderName: string;      // display name of the connected folder
  folderHandle: FileSystemDirectoryHandle | null; // persisted handle
  daemonConnected: boolean;
  connectedAt: string;     // ISO timestamp
}

export class BeatriceDatabase extends Dexie {
  messages!: Table<ChatMessage, number>;
  settings!: Table<UserSettings, string>;
  sessions!: Table<Session, string>;
  knowledgeFiles!: Table<KnowledgeFile, string>;
  localFolderState!: Table<LocalFolderState, string>;

  constructor() {
    super('BeatriceDB');
    this.version(2).stores({
      messages: '++id, userId, sessionId, role, timestamp',
      settings: 'userId',
      sessions: 'id, userId, lastActive',
      knowledgeFiles: 'id, userId, name, uploadedAt',
      localFolderState: 'userId',
    });
  }
}

export const db = new BeatriceDatabase();

// ── Local folder state helpers ──

export async function saveLocalFolderState(state: Omit<LocalFolderState, 'connectedAt'> & { connectedAt?: string }) {
  await db.localFolderState.put({
    ...state,
    connectedAt: state.connectedAt || new Date().toISOString(),
  });
}

export async function getLocalFolderState(userId: string): Promise<LocalFolderState | undefined> {
  const state = await db.localFolderState.get(userId);
  if (!state || !state.folderHandle) return undefined;

  // Verify the handle is still valid by requesting permission
  try {
    const perm = await state.folderHandle.queryPermission({ mode: 'readwrite' });
    if (perm !== 'granted') {
      const req = await state.folderHandle.requestPermission({ mode: 'readwrite' });
      if (req !== 'granted') return undefined;
    }
    return state;
  } catch {
    return undefined;
  }
}

export async function clearLocalFolderState(userId: string) {
  await db.localFolderState.delete(userId);
}

/** Onboarding version — bump to force existing users through new steps */
export const BEATRICE_ONBOARDING_VERSION = 2;
