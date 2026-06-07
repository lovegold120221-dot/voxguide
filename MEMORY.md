# Beatrice — Project Memory

> Last updated: June 5, 2026

## Infrastructure

### Deployment
| Service | URL | How |
|---|---|---|
| **Frontend** | `https://whatsapp.eburon.ai` | Express serves dist/ on port 4200 |
| **Backend** | `https://whatsapp.eburon.ai/api/*` | Express + tsx on port 4200 |
| **Reverse Proxy** | Traefik | Routes domain → localhost:4200 with Let's Encrypt |
| **PM2** | `voxx-backend` | Auto-restart via systemd pm2-root service |
| **Docker** | 4 sandbox containers | `unless-stopped` restart policy |
| **Firebase Hosting** | `https://eburon-ai-beatrice.web.app` | Static frontend only (API proxy needs billing) |
| **VPS** | `168.231.78.113` | Root access via SSH |
| **GitHub** | `github.com/lovegold120221-dot/stunning-goggles` | Main branch |

### PM2 Commands (VPS)
```bash
pm2 start server/index.ts --interpreter /opt/voxx-zero/node_modules/.bin/tsx --name voxx-backend
pm2 restart voxx-backend --update-env
pm2 delete voxx-backend
pm2 startup systemd -u root && pm2 save
```

### Environment Variables (VPS)
- Gemini API key: (set on VPS via SSH)
- Supabase: `https://tcwhnoxzqibqtpgedvbv.supabase.co`
- Supabase anon key: `sb_publishable_fIU5XfFPF_EZaLv1o4SZCA_iK0sw8KW`
- Cerebras key: (set on VPS via SSH)
- WhatsApp token: on VPS via direct SSH
- `APP_URL`, `VITE_SANDBOX_URL`, `VITE_BACKEND_URL`: **EMPTY** on VPS (auto-detect)
- Local dev: `VITE_BACKEND_URL=http://localhost:4200`

### Database
- Supabase project: `tcwhnoxzqibqtpgedvbv`
- Tables: `user_settings` (needs migration), `messages`, `memories`
- Run `supabase-migration-settings.sql` and `supabase-migration-memories.sql` in Supabase SQL Editor
- **Critical**: `user_settings` had `uid` instead of `user_id` — migration renames columns

---

## Architecture Decisions

### AI Model
- **Gemini Live API**: `gemini-2.5-flash-native-audio-preview-12-2025`
- SDK: `@google/genai` (dynamically imported)
- Fallback for document gen: `gemini-2.5-flash` (non-voice)
- SDK class name obfuscated to prevent brand exposure in bundle

### WhatsApp
- **Provider**: Baileys only (Go WhatsApp / gowa fully removed)
- **Deleted file**: `server/gowa-client.ts`
- **Sync**: `syncFullHistory` triggers on pairing, preserves existing messages
- **Real-time**: SSE endpoint `GET /api/whatsapp/stream/:userId`
- **Frontend SSE**: `EventSource` connects when `waStatus === 'paired'`
- **Contacts fix**: Backend sends `savedName`/`whatsappProfileName`, frontend previously read wrong field names

### Theme System
- CSS custom properties for all colors
- `.theme-dark` (default) and `.theme-light` classes on `<html>`
- Toggle in Settings → Appearance → Theme
- Uses `var(--bg-base)`, `var(--text-primary)`, `var(--accent)`, etc.
- 70+ CSS override rules for light mode compatibility
- **Critical CSS pattern**: `.theme-light .text-white { color: #1f1a17; }`

### Tool Registry (Skills)
Removed god function `whatsapp_action` — replaced with individual functions:
- `send_whatsapp_message`, `send_whatsapp_group_message`
- `read_whatsapp_chats`, `get_whatsapp_contacts`, `get_whatsapp_groups`
- `get_whatsapp_message_history`, `get_whatsapp_calls`
- `block_whatsapp_contact`, `unblock_whatsapp_contact`
- `sync_whatsapp_history`
- `resolve_contact`, `send_whatsapp_text`, `send_whatsapp_contact_card`

Also removed `execute_google_service` (redundant with dedicated Google functions).
Removed `web_glance` (replaced by Gemini built-in googleSearch grounding).
Removed auto-shutdown (90s silence timeout) — user must tap Stop.

### Memory System
- `add_to_memory` — saves facts to Supabase `memories` table
- `search_memory` — full-text search on stored memories
- 10 most recent memories loaded into system prompt at session start

### Sandbox Sub-Agent
- `run_sandbox_task` — delegates complex tasks to Gemini API via backend
- `cerebras_browser_task` — Browser-Use + Cerebras for web browsing
- Backend endpoints: `POST /api/sandbox/run`, `POST /api/cerebras/browser`
- Python wrapper: `scripts/cerebras_browser.py` (uses .venv/bin/python3)

### Document Viewer (Eburon PC)
- **Fixed**: Removed duplicate Eburon PC shell (was nested inside iframe)
- `wrapInSandbox` generates theme-aware HTML with CSS variables
- DocumentViewer is now a minimal full-screen iframe viewer

---

## Key Bug Fixes

1. **Empty `properties: {}` in function declarations** — Gemini Live API rejects these. Fixed by adding placeholder params.
2. **`String.fromCharCode` on import path** — Broke Vite resolution, reverted to plain string `'@google/genai'`.
3. **`@vite-ignore` on dynamic import** — Prevented Vite from resolving package path, browser got bare specifier error.
4. **`contextSize` in useEffect deps** — Slider movement triggered full settings reload, overwriting user's change before save.
5. **`forceResync` cleared `recentMessages`** — `messaging-history.set` doesn't always refire, so messages were lost. Fixed by preserving messages.
6. **Contacts showing "Unknown Contact"** — Frontend read `c.name` but backend sent `c.savedName`. Fixed to read correct field names.
7. **`whatsapp_paired` overriding backend status** — Supabase setting overwrote real Baileys status. Removed the override; backend is authoritative source.
8. **ChatPage invisible in light mode** — Hardcoded `text-zinc-300`, `bg-zinc-900` etc. Changed to CSS variables.
9. **DocumentViewer dark bg in light mode** — Rewrote with theme variables.

---

## File Modification Log

| File | Key Changes |
|---|---|
| `src/components/BeatriceAgent.tsx` | Tool registry refactor, prompt fixes, memory system, SSE, theme, config persistence, censors… |
| `server/whatsapp.ts` | EventEmitter for SSE, pushName capture, forceResync fix, contact name improvement |
| `server/index.ts` | Removed gowa routes, added SSE endpoint, sandbox runner, Cerebras endpoint |
| `server/supabase.ts` | Simplified env var reading |
| `server/gowa-client.ts` | **DELETED** |
| `src/components/ChatPage.tsx` | Theme CSS variables, removed prose-invert |
| `src/components/VideoPage.tsx` | Theme CSS variables, video-viewport-dark class |
| `src/components/ProfilePage.tsx` | Removed motion.div slide-up, censorship toggle, imports LANGUAGES from constants |
| `src/components/DocumentViewer.tsx` | Rewrote as minimal full-screen iframe viewer |
| `src/components/WhatsAppOnboarding.tsx` | Mobile responsive, auto-sync trigger, overflow fix |
| `src/components/WhatsAppSettings.tsx` | Theme variables, consistent list styling |
| `src/index.css` | Full theme system with 70+ CSS overrides |
| `src/App.tsx` | Theme state, localStorage persistence |
| `src/constants.ts` | Shared LANGUAGES array (147 entries) |
| `scripts/cerebras_browser.py` | Cerebras + Browser-Use Python wrapper |
| `scripts/setup-cerebras.sh` | Python dependency installer |
| `supabase-migration-memories.sql` | Memories table schema |
| `supabase-migration-settings.sql` | User settings column fixes |
| `.env.example` | Updated with Cerebras, removed gowa |
