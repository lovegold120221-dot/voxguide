// ── Code Files client (Monaco editor Supabase persistence) ──
// Direct Supabase access (consistent with user_settings / messages).
import { supabase } from './supabase';

export interface CodeFile {
  id?: string;
  user_id: string;
  session_id?: string;
  project_id?: string;
  file_path: string;
  language: string;
  content: string;
  updated_at?: string;
  created_at?: string;
}

export interface CodeFileMeta {
  id: string;
  file_path: string;
  language: string;
  project_id?: string;
  session_id?: string;
  updated_at?: string;
  created_at?: string;
}

export async function listCodeFiles(userId: string, sessionId?: string): Promise<CodeFileMeta[]> {
  let query = supabase
    .from('code_files')
    .select('id, file_path, language, project_id, session_id, updated_at, created_at')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false });
  if (sessionId) query = query.eq('session_id', sessionId);
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

export async function loadCodeFile(userId: string, filePath: string): Promise<CodeFile | null> {
  const { data, error } = await supabase
    .from('code_files')
    .select('id, file_path, language, content, project_id, session_id, updated_at')
    .eq('user_id', userId)
    .eq('file_path', filePath)
    .maybeSingle();
  if (error) throw error;
  return (data as CodeFile) || null;
}

export async function saveCodeFile(file: CodeFile): Promise<void> {
  const { error } = await supabase
    .from('code_files')
    .upsert(
      {
        user_id: file.user_id,
        session_id: file.session_id,
        project_id: file.project_id,
        file_path: file.file_path,
        language: file.language,
        content: file.content,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,file_path' },
    );
  if (error) throw error;
}

export async function deleteCodeFile(userId: string, filePath: string): Promise<void> {
  const { error } = await supabase
    .from('code_files')
    .delete()
    .eq('user_id', userId)
    .eq('file_path', filePath);
  if (error) throw error;
}
