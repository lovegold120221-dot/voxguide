-- ── Fix user_settings table schema ──
-- Run this in Supabase SQL Editor for project: tcwhnoxzqibqtpgedvbv

-- Rename columns safely (only if old name exists and new name doesn't)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='user_settings' AND column_name='uid')
  AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='user_settings' AND column_name='user_id') THEN
    ALTER TABLE user_settings RENAME COLUMN uid TO user_id;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='user_settings' AND column_name='voice')
  AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='user_settings' AND column_name='selected_voice') THEN
    ALTER TABLE user_settings RENAME COLUMN voice TO selected_voice;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='user_settings' AND column_name='system_prompt')
  AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='user_settings' AND column_name='custom_prompt') THEN
    ALTER TABLE user_settings RENAME COLUMN system_prompt TO custom_prompt;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='user_settings' AND column_name='user_call_name')
  AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='user_settings' AND column_name='user_title') THEN
    ALTER TABLE user_settings RENAME COLUMN user_call_name TO user_title;
  END IF;
END $$;

-- Add missing columns (idempotent)
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS context_size INTEGER DEFAULT 500;
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS theme TEXT DEFAULT 'dark';
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS ambient_enabled BOOLEAN DEFAULT true;
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS ambient_volume INTEGER DEFAULT 12;
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS censorship_enabled BOOLEAN DEFAULT true;
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS avatar_url TEXT;

-- Ensure user_id is the primary key (no-op if already set)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conrelid = 'user_settings'::regclass AND contype = 'p'
  ) THEN
    ALTER TABLE user_settings ADD PRIMARY KEY (user_id);
  END IF;
END $$;
