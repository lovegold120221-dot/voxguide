// src/lib/usePersistedUserSetting.ts
//
// useState-shaped hook that auto-persists every change. The setter:
//   1. Updates React state.
//   2. Synchronously writes the new value to localStorage (offline /
//      rapid-close survival).
//   3. Fire-and-forget debounced upsert via persistUserSettings().
//
// `skipSync: true` is honored on the setter so callers hydrating from
// Supabase (e.g. the Supabase → React restoration in BeatriceAgent at
// lines 2488-2516) don't loop a same-value write back into the queue.

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  flushUserSettingsNow,
  persistUserSettings,
  type UserSettingsRow,
} from './userSettingsSync';

// LocalStorage mirror key for each user_settings column. '__no_ls__'
// means DO NOT mirror to localStorage \u2014 used for structured data
// (permissions map, phone, domain list, avatar URL) that other layers
// of the app already persist elsewhere.
const LS_KEY: Record<keyof UserSettingsRow, string> = {
  persona_name: 'beatrice_persona_name',
  custom_prompt: 'beatrice_custom_prompt',
  selected_voice: 'beatrice_selected_voice',
  context_size: 'beatrice_context_size',
  user_title: 'beatrice_userTitle',
  language: 'beatrice_language',
  theme: 'beatrice_theme',
  ambient_enabled: 'beatrice_ambient_enabled',
  ambient_volume: 'beatrice_ambient_volume',
  censorship_enabled: 'beatrice_censorship',
  whatsapp_permissions: '__no_ls__',
  whatsapp_phone: '__no_ls__',
  knowledge_domains: '__no_ls__',
  avatar_url: '__no_ls__',
  updated_at: '__no_ls__',
};

export interface PersistedSetterOptions {
  /** When true, skip the Supabase sync. Used during hydration from server. */
  skipSync?: boolean;
}

export type PersistedSetter<T> = (
  next: T | ((prev: T) => T),
  opts?: PersistedSetterOptions,
) => void;

function readLocalRaw(key: string): string | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function usePersistedUserSetting<K extends keyof UserSettingsRow>(
  key: K,
  userId: string | null | undefined,
  initial: UserSettingsRow[K] | (() => UserSettingsRow[K]),
): [UserSettingsRow[K], PersistedSetter<UserSettingsRow[K]>] {
  const lsKey = LS_KEY[key];

  const [value, setValueInternal] = useState<UserSettingsRow[K]>(() => {
    const computed = typeof initial === 'function'
      ? (initial as () => UserSettingsRow[K])()
      : initial;
    if (lsKey === '__no_ls__') return computed;
    const raw = readLocalRaw(lsKey);
    if (raw == null) return computed;
    // Values are written as raw strings via String(). For numbers /
    // booleans / strings the round-trip is faithful. For structured
    // types we wouldn't have an lsKey entry in the first place.
    return raw as unknown as UserSettingsRow[K];
  });

  const userIdRef = useRef<string | null | undefined>(userId);
  useEffect(() => { userIdRef.current = userId; });

  const setValue = useCallback<PersistedSetter<UserSettingsRow[K]>>(
    (next, opts) => {
      setValueInternal(prev => {
        const resolved = typeof next === 'function'
          ? (next as (p: UserSettingsRow[K]) => UserSettingsRow[K])(prev)
          : next;
        if (Object.is(resolved, prev)) return prev;

        if (lsKey !== '__no_ls__') {
          try { localStorage.setItem(lsKey, String(resolved)); } catch {}
        }
        if (!opts?.skipSync) {
          persistUserSettings(userIdRef.current, {
            [key]: resolved,
          } as Partial<UserSettingsRow>);
        }
        return resolved;
      });
    },
    [key, lsKey],
  );

  // StrictMode-safe: React 18 dev double-mount runs cleanup once
  // between the two setups. flushUserSettingsNow early-returns when
  // the queue is empty, so a no-op double flush is harmless.
  useEffect(() => () => {
    void flushUserSettingsNow(userId);
  }, [userId]);

  return [value, setValue];
}
