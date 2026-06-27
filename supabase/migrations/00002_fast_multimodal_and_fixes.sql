-- ── Migration 00002: Fast multimodal skills + context_size fix + code_files ──
-- Idempotent. Safe to re-run.

-- 1. Conversation Context default: 20 -> 500
--    The DB column default of 20 was overriding the intended frontend default
--    of 500 whenever a user_settings row existed without an explicit value.
ALTER TABLE IF EXISTS user_settings ALTER COLUMN context_size SET DEFAULT 500;
ALTER TABLE IF EXISTS user_profiles ALTER COLUMN context_size SET DEFAULT 500;

-- Backfill rows stuck at the legacy default of 20 (or NULL) up to 500.
UPDATE user_settings SET context_size = 500 WHERE context_size IS NULL OR context_size = 20;
UPDATE user_profiles SET context_size = 500 WHERE context_size IS NULL OR context_size = 20;

-- 2. code_files table — Monaco editor Supabase persistence
--    Mirrors the user_settings/messages pattern (user_id TEXT, RLS disabled)
--    because Beatrice authenticates via Firebase, not Supabase Auth.
CREATE TABLE IF NOT EXISTS code_files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  session_id TEXT,
  project_id TEXT,
  file_path TEXT NOT NULL,
  language TEXT DEFAULT 'plaintext',
  content TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_code_files_user_path ON code_files(user_id, file_path);
CREATE INDEX IF NOT EXISTS idx_code_files_user ON code_files(user_id);
CREATE INDEX IF NOT EXISTS idx_code_files_updated ON code_files(user_id, updated_at DESC);

-- RLS disabled: backend uses the service-role adminClient; frontend uses the
-- anon client (consistent with user_settings and messages).
ALTER TABLE code_files DISABLE ROW LEVEL SECURITY;

-- Enable realtime for code_files so editor changes sync across devices.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'code_files'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE code_files;
  END IF;
END $$;
