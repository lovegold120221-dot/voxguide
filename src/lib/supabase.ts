import { createClient } from '@supabase/supabase-js';
import { auth } from '../firebase';

function getSupabaseUrl(): string {
  const url = import.meta.env.VITE_SUPABASE_URL;
  if (!url) throw new Error('VITE_SUPABASE_URL not configured');
  return url;
}

function getSupabaseKey(): string {
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (!key) throw new Error('VITE_SUPABASE_ANON_KEY not configured');
  return key;
}

export const supabase = createClient(getSupabaseUrl(), getSupabaseKey());

export interface DbErrorInfo {
  error: string;
  table: string | null;
  operation: string;
  authInfo: {
    userId?: string | null;
    email?: string | null;
  };
}

export function handleDbError(error: unknown, table: string | null, operation: string): never {
  const errInfo: DbErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    table,
    operation,
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
    },
  };
  console.error('Supabase Error:', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}
