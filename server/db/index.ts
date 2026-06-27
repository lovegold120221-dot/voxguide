// ── Database Layer ──
// Single access point for all server-side DB operations

import * as MemoryRepo from './repositories/memory.repo';
import * as MessagesRepo from './repositories/messages.repo';
import * as WhatsAppRepo from './repositories/whatsapp.repo';
import * as MediaRepo from './repositories/media.repo';
import * as SettingsRepo from './repositories/settings.repo';
import * as EburonRepo from './repositories/eburon.repo';
import * as CodeFilesRepo from './repositories/code-files.repo';

export {
  MemoryRepo,
  MessagesRepo,
  WhatsAppRepo,
  MediaRepo,
  SettingsRepo,
  EburonRepo,
  CodeFilesRepo,
};

export { supabaseClient, getSupabaseClient } from './server';
export { adminClient, getAdminClient } from './admin';
