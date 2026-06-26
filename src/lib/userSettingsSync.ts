// src/lib/userSettingsSync.ts
//
// Single in-memory coalescing queue + timer for `user_settings` upserts.
// Every persistUserSettings() merges the partial into the queue and
// (re)starts a 600 ms debounce timer. When it elapses, the queue drains
// into one Supabase upsert with `onConflict: 'user_id'`. Manual save
// and unmount flush (`flushUserSettingsNow`) bypass the timer.
//
// All caller paths are fire-and-forget: Supabase errors are caught and
// logged but never thrown. localStorage is the offline fallback \u2014
// usePersistedUserSetting writes to localStorage synchronously on every
// change \u2014 so a debounced write that the timer can't deliver still
// survives a hard close. The next mount raises the localStorage value
// back into the React state and any subsequent edit re-runs the cloud
// side of the round-trip.

import { supabase } from './supabase';

export type WhatsAppPermissions = Record<string, boolean>;

export interface UserSettingsRow {
  persona_name?: string;
  custom_prompt?: string;
  selected_voice?: string;
  context_size?: number;
  user_title?: string;
  language?: string;
  theme?: 'dark' | 'light';
  ambient_enabled?: boolean;
  ambient_volume?: number;
  censorship_enabled?: boolean;
  whatsapp_permissions?: WhatsAppPermissions;
  whatsapp_phone?: string | null;
  knowledge_domains?: string[];
  avatar_url?: string | null;
  updated_at?: string;
}

const DEBOUNCE_MS = 600;

let _pending: Partial<UserSettingsRow> = {};
let _timer: ReturnType<typeof setTimeout> | null = null;
let _activeUserId: string | null = null;

export function persistUserSettings(
  userId: string | null | undefined,
  partial: Partial<UserSettingsRow>,
): void {
  if (!userId) return;
  _activeUserId = userId;
  for (const k of Object.keys(partial) as Array<keyof UserSettingsRow>) {
    _pending[k] = partial[k];
  }
  if (_timer != null) clearTimeout(_timer);
  _timer = setTimeout(() => {
    void _drain();
  }, DEBOUNCE_MS);
}

// Flush pending settings synchronously when the tab is going away.
// React component unmount is NOT guaranteed on tab close, but `pagehide`
// and `visibilitychange` (hidden) fire reliably. Without this, a user
// who types into customPrompt and immediately closes the tab loses
// cross-device sync — localStorage has the value, Supabase doesn't,
// until the next mount edits the same field.
if (typeof window !== 'undefined') {
  const flushNow = () => { void flushUserSettingsNow(_activeUserId); };
  window.addEventListener('pagehide', flushNow);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushNow();
  });
}

export async function flushUserSettingsNow(
  userId: string | null | undefined,
): Promise<void> {
  if (!userId) return;
  _activeUserId = userId;
  if (_timer != null) {
    clearTimeout(_timer);
    _timer = null;
  }
  await _drain();
}

async function _drain(): Promise<void> {
  _timer = null;
  if (!_activeUserId) return;
  if (Object.keys(_pending).length === 0) return;
  const payload: Partial<UserSettingsRow> & { user_id: string; updated_at: string } = {
    user_id: _activeUserId,
    updated_at: new Date().toISOString(),
    ..._pending,
  };
  _pending = {};
  try {
    const { error } = await supabase
      .from('user_settings')
      .upsert(payload, { onConflict: 'user_id' });
    if (error) {
      console.warn('[userSettingsSync] upsert failed:', error.message);
    }
  } catch (e: any) {
    // Don't re-merge on transient errors: React state + localStorage
    // still hold the user's intended value. The next keystroke fires a
    // new flush, which retries the cloud side of the round-trip.
    console.warn('[userSettingsSync] upsert threw:', e?.message || e);
  }
}
