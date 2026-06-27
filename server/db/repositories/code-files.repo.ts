// ── Code Files Repository ──
// Persists Monaco editor file contents to Supabase.
import { adminClient } from '../admin';

export interface CodeFileRecord {
  id?: string;
  user_id: string;
  session_id?: string;
  project_id?: string;
  file_path: string;
  language: string;
  content: string;
  created_at?: string;
  updated_at?: string;
}

export async function listCodeFiles(userId: string, sessionId?: string) {
  let query = adminClient
    .from('code_files')
    .select('id, file_path, language, project_id, session_id, updated_at, created_at')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false });

  if (sessionId) {
    query = query.eq('session_id', sessionId);
  }

  const { data, error } = await query;
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: data || [] };
}

export async function getCodeFile(userId: string, filePath: string) {
  const { data, error } = await adminClient
    .from('code_files')
    .select('id, file_path, language, content, project_id, session_id, updated_at')
    .eq('user_id', userId)
    .eq('file_path', filePath)
    .maybeSingle();

  if (error) return { ok: false, error: error.message };
  return { ok: true, data: data || null };
}

export async function upsertCodeFile(record: CodeFileRecord) {
  const { data, error } = await adminClient
    .from('code_files')
    .upsert(
      {
        user_id: record.user_id,
        session_id: record.session_id,
        project_id: record.project_id,
        file_path: record.file_path,
        language: record.language,
        content: record.content,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,file_path' },
    )
    .select('id')
    .single();

  if (error) return { ok: false, error: error.message };
  return { ok: true, id: data.id };
}

export async function deleteCodeFile(userId: string, filePath: string) {
  const { error } = await adminClient
    .from('code_files')
    .delete()
    .eq('user_id', userId)
    .eq('file_path', filePath);

  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
