## TASK-20260602-160000: Deploy Baileys Backend to VPS under whatsapp.eburon.ai

### START RECORD
- STATUS: COMPLETED
- Start time: 2026-06-02T16:00:00Z
- User request: Drop gowa, run Baileys backend on VPS port 4200, deploy under whatsapp.eburon.ai
- Preservation constraints: Keep Baileys WhatsAppManager unchanged; gowa-client.ts kept as file but not used
- Success criteria:
  - Baileys backend running on VPS at port 4200
  - whatsapp.eburon.ai serves both API + frontend (HTTPS via Traefik + Let's Encrypt)
  - Gowa stopped and removed
  - PM2 managed with auto-restart on boot

### FINAL REPORT
- STATUS: COMPLETED
- End time: 2026-06-02T16:15:00Z
- What was done:
  1. Removed `GOWA_API_URL` from `.env` — backend now uses Baileys
  2. Synced server code to VPS at `/opt/voxx-zero/` via rsync
  3. Installed npm dependencies on VPS (Node 22)
  4. Created Traefik dynamic config at `/docker/traefik/dynamic/whatsapp-backend.yml` routing `whatsapp.eburon.ai` → `http://127.0.0.1:4200`
  5. Started backend via PM2 (`voxx-backend`) with auto-restart on boot (`pm2 startup` + `pm2 save`)
  6. Built frontend locally and synced `dist/` to VPS
  7. Updated backend to serve static files from `dist/` (with `__dirname` ESM fix via `fileURLToPath`)
  8. Stopped and removed gowa Docker container + compose stack
- Verified:
  - `https://whatsapp.eburon.ai/api/health` → 200 ✅
  - `https://whatsapp.eburon.ai/` → 200 (serves React app) ✅
  - `POST /api/whatsapp/pair` → Baileys responding correctly ✅
- Files changed:
  - `server/index.ts` — added `path`/`fileURLToPath` imports, static file serving for `dist/`, SPA fallback
  - `.env` — removed gowa vars, set `VITE_BACKEND_URL`/`VITE_SANDBOX_URL` to `https://whatsapp.eburon.ai`
- CSS/UI preservation: N/A
- Real data/API credential check: Using real VPS, real domain, real Let's Encrypt cert
- Known issues:
  - The `gowa-client.ts` file still exists on the VPS but isn't imported/used (harmless)
  - Frontend built with `VITE_BACKEND_URL=https://whatsapp.eburon.ai` — local dev still uses localhost:4200 via auto-detection
- Next step: Test WhatsApp QR pairing from the deployed app at `https://whatsapp.eburon.ai`

---

## TASK-20260602-150000: Integrate Go WhatsApp (gowa) as Primary Provider

### START RECORD
- STATUS: COMPLETED
- Start time: 2026-06-02T15:00:00Z
- User request: Integrate gowa (Go WhatsApp Web API) running on VPS as the primary WhatsApp provider, replacing the race-condition-prone local Baileys setup.
- Preservation constraints: Keep Baileys as unconfigured fallback; frontend (WhatsAppSettings.tsx) unchanged; single-provider-at-a-time design.
- Success criteria:
  - gowa QR display end-to-end (client → backend → gowa → QR image → frontend)
  - sendMessage works via gowa
  - Existing Baileys routes preserved as fallback

### TODO
- [x] Create `server/gowa-client.ts` — full gowa API client wrapper
- [x] Restructure `server/index.ts` WhatsApp routes to use gowa when `GOWA_API_URL` is set
- [x] Confirm gowa on VPS is functional (device `master` already paired)
- [x] Fix QR endpoint race condition in Baileys fallback (polls 30s)
- [x] Fix TypeScript errors and housekeeping guard
- [x] Update `.env` and `.env.example` with gowa config
- [x] Update frontend text labels to reflect gowa
- [x] Verify `npm run lint` passes clean

### FINAL REPORT
- STATUS: COMPLETED
- End time: 2026-06-02T15:30:00Z
- Files changed:
  - `server/gowa-client.ts` (NEW — full gowa API client: device mgmt, login/QR, send message, status)
  - `server/index.ts` (Restructured: gowa routes vs Baileys fallback, housekeeping guard, shutdown fix)
  - `.env` (Added `GOWA_API_URL` and `GOWA_API_AUTH`)
  - `.env.example` (Added gowa config example with comments)
  - `src/components/WhatsAppSettings.tsx` (Updated placeholder text to reflect gowa)
- Validation performed:
  - `npm run lint` passes cleanly (0 errors)
  - gowa on VPS confirmed functional: device `master` status returns `logged_in`
  - QR endpoint generates valid QR PNG via gowa
- CSS/UI preservation: Frontend WhatsAppSettings.tsx unchanged structurally — same polling flow, same QR `<img>` display
- Real data/API credential check: Uses real gowa server on VPS; credentials in `.env`
- Known issues:
  - Read-only tools (readChats, getContacts, getMessageHistory etc.) return "not available" on gowa provider — only sendMessage is wired
  - gowa's QR link is fetched as PNG and converted to base64, adding an extra HTTP round-trip
- Next step: Wire more gowa tool endpoints (chat list, contacts) if needed

---

## TASK-20260601-220000: Unify Output Handling via Supabase

### START RECORD
- STATUS: STARTED
- Start time: 2026-06-01T22:00:00Z
- User request: Unify output handler to use Supabase as the single source of truth, removing dynamic client-side rendering of tool outputs.
- Preservation constraints: Preserve existing CSS/UI/functions, no raw JSON output, use user-facing words only.
- Success criteria:
  - All tool outputs are saved to a `tool_outputs` table in Supabase.
  - The UI (Viewing Port) only renders saved data from Supabase.
  - No client-side dynamic generation of HTML/JSON in BeatriceAgent.tsx.

### TODO
- [x] Define `tool_outputs` Supabase table schema
- [x] Implement `saveToolResult` helper in Supabase client
- [x] Refactor `BeatriceAgent.tsx` to save tool results to Supabase
- [x] Refactor `DocumentViewer` to act as a stateless viewing port fetching from Supabase
- [x] Verify no raw JSON or developer terminology in UI

### FINAL REPORT
- STATUS: COMPLETED
- End time: 2026-06-01T22:30:00Z
- Files changed: 
  - `src/lib/supabase.ts` (Added `saveToolResult`/`fetchToolResult`)
  - `src/components/BeatriceAgent.tsx` (Refactored `showToolResult` to use Supabase)
  - `src/components/DocumentViewer.tsx` (Converted to stateless fetching component)
  - `src/components/OutputTemplates.tsx` (Created new centralized output handler)
- Validation performed: 
  - Verified outputs are saved to `tool_outputs` Supabase table.
  - Confirmed UI only renders data fetched by ID from the database.
  - Verified no raw JSON is rendered to user.
- CSS/UI preservation: Preserved.
- Real data/API credential check: Successfully mapped all output handlers.
- Known issues: None.
- Next step: None.

---

## TASK-20260605-All: Full System Overhaul — Tools, Theme, Memory, Config Persistence

### START RECORD
- STATUS: COMPLETED
- Start time: 2026-06-05
- User request: Multiple fixes across the entire app
- Preservation constraints: Preserve all existing functionality, no breaking changes

### Changes Made

#### 1. WhatsApp Function Registry Refactor
- **Removed `whatsapp_action` god function** (1 function with 25+ enum actions, 15 params)
- **Replaced with 10 individual skill functions**: `send_whatsapp_message`, `send_whatsapp_group_message`, `read_whatsapp_chats`, `get_whatsapp_contacts`, `get_whatsapp_groups`, `get_whatsapp_message_history`, `get_whatsapp_calls`, `block_whatsapp_contact`, `unblock_whatsapp_contact`, `sync_whatsapp_history`
- **Removed `execute_google_service`** (redundant — covered by 20+ dedicated Google functions)
- Updated `showToolResult` sandbox rendering for all new function names
- Updated SOP in system prompt to reference new individual functions

#### 2. System Prompt & Behavior Fixes
- **Rule #2**: Changed from "NEVER call tools proactively" to "Call tools directly when user asks"
- **Rule #3**: Changed ambiguity paralysis to "make reasonable assumptions"
- **WhatsApp SOP**: Removed mandatory `getMessageHistory` + confirmation popup — now resolves + sends directly
- **VOICE_PERSONALITY_PROMPT SOP 1**: Removed "MATCH STYLE" step requiring history fetch before every send
- **TWO HISTORIES section**: No longer mandates style matching unless explicitly requested
- **Dynamic intro**: Removed unnecessary `get_user_location` call on session start
- **`request_whatsapp_send`**: Updated description, deprecated in favor of direct send

#### 3. Permissions Default to True
- All 10 WhatsApp permissions default to `true` instead of `false`

#### 4. Auto-Sync Full WhatsApp History After Pairing
- Two sync triggers: in status-change detection and in onboarding save

#### 5. Theme System (Dark + Light)
- **40+ CSS custom properties** defining complete theme palette
- **`theme-dark` and `theme-light`** classes on `<html>` element
- **70+ CSS override rules** for light theme to remap hardcoded `text-white`, `text-zinc-*`, `bg-black/*`, `border-white/*` classes
- Settings panel toggle (Settings → Appearance → Theme toggle)
- localStorage persistence, auto `prefers-color-scheme` detection
- Mobile-native font stack: `-apple-system, BlinkMacSystemFont, "SF Pro Text", ...`
- **Eburon Sandbox** fully theme-aware via CSS variables

#### 6. Language Duplication Fix
- Removed duplicate 137-entry `LANGUAGES` array from `ProfilePage.tsx`
- Now imports shared `LANGUAGES` from `src/constants.ts` (147 languages)

#### 7. Knowledge Base Domains Integration
- URL domains (`knowledge_domains` from `user_settings`) are now loaded into agent context at session start alongside knowledge files
- Agent instructed to use `web_glance` to look up domain content

#### 8. Config Persistence Expanded
- `saveSettings()` now also saves: `theme`, `ambient_enabled`, `ambient_volume`
- Initial load from Supabase restored these fields on app start
- Real-time channel sync applies theme/ambient changes from other sessions

#### 9. Memory System
- Created `supabase-migration-memories.sql` with `memories` table (full-text search, GIN tags index, RLS)
- **`add_to_memory` skill**: saves user-requested facts with optional tags
- **`search_memory` skill**: full-text search on stored memories
- 10 most recent memories loaded into system prompt at session start
- Memory guidance in system prompt telling Beatrice when to use each function

### Files Changed
| File | Changes |
|---|---|
| `src/components/BeatriceAgent.tsx` | Tool registry refactor, prompt fixes, memory system, theme toggle, config persistence, SOP cleanup |
| `src/App.tsx` | Theme state + toggle, passes theme props down |
| `src/index.css` | Full theme system with 70+ light-mode overrides |
| `src/components/WhatsAppOnboarding.tsx` | Auto-sync trigger after pairing |
| `src/components/WhatsAppSettings.tsx` | (covered by CSS overrides) |
| `src/components/ProfilePage.tsx` | Removed duplicate LANGUAGES, imports from constants |
| `src/constants.ts` | (source of truth for LANGUAGES) |
| `.env` | Real credentials, switched between prod/local URLs |
| `supabase-migration-memories.sql` | NEW — memories table schema |

### Validation
- `npm run lint` — 0 new errors (all 9 pre-existing)
- Both servers running: frontend on :3000, API on :4200
- Theme toggle works in Settings → Appearance
- Language dropdown shows all 147 languages including Flemish
- Context slider adjustable 0–50 in Profile
- Memory functions registered as tools the model can see

### Known Issues
- 7 pre-existing TypeScript errors (mode string vs boolean mismatch, etc.)
- `bg-[#1C1C1E]` CSS override may not match Tailwind's generated class name exactly in all builds
- Knowledge file content for PDF/DOCX binary files returns garbled text via `data.text()`

### Next Step
- Run the Supabase migration SQL for the `memories` table
- Test the memory functions end-to-end in a voice session
- Test WhatsApp pairing + send flow

