-- Run this in the Supabase SQL Editor (https://supabase.com/dashboard/project/inypxifrayeafrlhkulz/sql)

-- 1. Create tables (idempotent)
CREATE TABLE IF NOT EXISTS messages (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id TEXT NOT NULL,
  session_id TEXT NOT NULL DEFAULT 'default',
  role TEXT NOT NULL CHECK (role IN ('user', 'model')),
  text TEXT NOT NULL CHECK (char_length(text) <= 5000),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_messages_user_id ON messages(user_id);
CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(user_id, session_id);

CREATE TABLE IF NOT EXISTS user_settings (
  user_id TEXT PRIMARY KEY,
  persona_name TEXT DEFAULT 'Beatrice',
  custom_prompt TEXT DEFAULT '',
  selected_voice TEXT DEFAULT 'Aoede',
  context_size INT DEFAULT 500,
  user_title TEXT DEFAULT 'Boss',
  language TEXT DEFAULT 'en',
  avatar_url TEXT,
  knowledge_domains TEXT[] DEFAULT '{}',
  whatsapp_permissions JSONB DEFAULT '{"send_messages":true,"read_chats":true,"access_contacts":true,"manage_contacts":true,"access_groups":true,"send_group_messages":true,"read_group_chats":true,"manage_media":true,"view_message_history":true}'::jsonb,
  whatsapp_paired BOOLEAN DEFAULT false,
  whatsapp_phone TEXT,
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS knowledge_files (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file_type TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  storage_path TEXT NOT NULL,
  uploaded_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS contacts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  owner_user_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  aliases TEXT[] DEFAULT '{}',
  phone_e164 TEXT NOT NULL,
  wa_id TEXT,
  source TEXT, -- manual, crm, google_contacts, imported, webhook
  company TEXT,
  role TEXT,
  last_confirmed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_contacts_owner_name ON contacts (owner_user_id, lower(display_name));
CREATE INDEX IF NOT EXISTS idx_contacts_owner_phone ON contacts (owner_user_id, phone_e164);

CREATE INDEX IF NOT EXISTS idx_knowledge_files_user_id ON knowledge_files(user_id);

-- 2. DISABLE ROW LEVEL SECURITY on all tables
-- The app uses Firebase Auth, not Supabase Auth, so RLS blocks all writes.
ALTER TABLE messages DISABLE ROW LEVEL SECURITY;
ALTER TABLE user_settings DISABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_files DISABLE ROW LEVEL SECURITY;
ALTER TABLE contacts DISABLE ROW LEVEL SECURITY;

-- Add new columns to existing user_settings table (idempotent)
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS user_title TEXT DEFAULT 'Boss';
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS language TEXT DEFAULT 'en';
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS knowledge_domains TEXT[] DEFAULT '{}';
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS whatsapp_permissions JSONB DEFAULT '{"send_messages":true,"read_chats":true,"access_contacts":true,"manage_contacts":true,"access_groups":true,"send_group_messages":true,"read_group_chats":true,"manage_media":true,"view_message_history":true}'::jsonb;
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS whatsapp_paired BOOLEAN DEFAULT false;
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS whatsapp_phone TEXT;

-- Add attachment columns to messages table (idempotent)
ALTER TABLE messages ADD COLUMN IF NOT EXISTS attachment_url TEXT;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS attachment_name TEXT;


-- 3. Enable Realtime for tables
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'messages'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE messages;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'user_settings'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE user_settings;
  END IF;
END $$;

-- 4. Create storage buckets (if not exist)
INSERT INTO storage.buckets (id, name, public)
VALUES ('avatars', 'avatars', true),
       ('knowledge-base', 'knowledge-base', true),
       ('chat-attachments', 'chat-attachments', true)
ON CONFLICT (id) DO NOTHING;


-- 5. Storage policies
DROP POLICY IF EXISTS "Public Read avatars" ON storage.objects;
CREATE POLICY "Public Read avatars" ON storage.objects
  FOR SELECT USING (bucket_id = 'avatars');

DROP POLICY IF EXISTS "Public Read knowledge-base" ON storage.objects;
CREATE POLICY "Public Read knowledge-base" ON storage.objects
  FOR SELECT USING (bucket_id = 'knowledge-base');

DROP POLICY IF EXISTS "Upload avatars" ON storage.objects;
CREATE POLICY "Upload avatars" ON storage.objects
  FOR INSERT WITH CHECK (bucket_id = 'avatars');

DROP POLICY IF EXISTS "Upload knowledge-base" ON storage.objects;
DROP POLICY IF EXISTS "Upload knowledge-base" ON storage.objects;
CREATE POLICY "Upload knowledge-base" ON storage.objects
  FOR INSERT WITH CHECK (bucket_id = 'knowledge-base');

DROP POLICY IF EXISTS "Upload chat-attachments" ON storage.objects;
CREATE POLICY "Upload chat-attachments" ON storage.objects
  FOR INSERT WITH CHECK (bucket_id = 'chat-attachments');

DROP POLICY IF EXISTS "Public Read chat-attachments" ON storage.objects;
CREATE POLICY "Public Read chat-attachments" ON storage.objects
  FOR SELECT USING (bucket_id = 'chat-attachments');

DROP POLICY IF EXISTS "Delete own knowledge-base files" ON storage.objects;
CREATE POLICY "Delete own knowledge-base files" ON storage.objects
  FOR DELETE USING (bucket_id = 'knowledge-base');

DROP POLICY IF EXISTS "Update own avatar" ON storage.objects;
CREATE POLICY "Update own avatar" ON storage.objects
  FOR UPDATE USING (bucket_id = 'avatars');
