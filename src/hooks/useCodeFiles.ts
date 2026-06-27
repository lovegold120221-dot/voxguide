// ── useCodeFiles ──
// Loads + auto-saves Monaco editor file content to Supabase (debounced).
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  listCodeFiles,
  loadCodeFile,
  saveCodeFile,
  type CodeFile,
  type CodeFileMeta,
} from '../lib/codeFilesClient';

export interface UseCodeFilesResult {
  files: CodeFileMeta[];
  loading: boolean;
  saving: boolean;
  lastSavedAt: string | null;
  loadFile: (filePath: string) => Promise<string | null>;
  saveFile: (file: { path: string; language: string; content: string; sessionId?: string; projectId?: string }) => Promise<void>;
  scheduleSave: (file: { path: string; language: string; content: string; sessionId?: string; projectId?: string }) => void;
  refresh: () => Promise<void>;
}

export function useCodeFiles(userId: string, enabled = true): UseCodeFilesResult {
  const [files, setFiles] = useState<CodeFileMeta[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestContent = useRef<Map<string, string>>(new Map());

  const refresh = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    try {
      const list = await listCodeFiles(userId);
      setFiles(list);
    } catch (e) {
      console.error('Failed to load code files:', e);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    if (enabled && userId) refresh();
  }, [enabled, userId, refresh]);

  const loadFile = useCallback(async (filePath: string): Promise<string | null> => {
    if (!userId) return null;
    try {
      const file: CodeFile | null = await loadCodeFile(userId, filePath);
      if (file?.content != null) {
        latestContent.current.set(filePath, file.content);
        return file.content;
      }
    } catch (e) {
      console.error('Failed to load code file:', e);
    }
    return null;
  }, [userId]);

  const saveFile = useCallback(async (file: { path: string; language: string; content: string; sessionId?: string; projectId?: string }) => {
    if (!userId || !file.path) return;
    setSaving(true);
    try {
      await saveCodeFile({
        user_id: userId,
        session_id: file.sessionId,
        project_id: file.projectId,
        file_path: file.path,
        language: file.language,
        content: file.content,
      });
      latestContent.current.set(file.path, file.content);
      setLastSavedAt(new Date().toISOString());
    } catch (e) {
      console.error('Failed to save code file:', e);
    } finally {
      setSaving(false);
    }
  }, [userId]);

  const scheduleSave = useCallback((file: { path: string; language: string; content: string; sessionId?: string; projectId?: string }) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      saveFile(file);
    }, 800);
  }, [saveFile]);

  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, []);

  return { files, loading, saving, lastSavedAt, loadFile, saveFile, scheduleSave, refresh };
}
