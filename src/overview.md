# Beatrice — Complete Codebase Overview

**Beatrice** is a real-time voice AI agent with WhatsApp integration, memory, Belgian administrative tools, document generation, local filesystem access, and a sub-agent sandbox runner. Built by Eburon AI.

**Tech Stack**: React 19 + Vite 6 + TypeScript 5.8 frontend, Express 4 + `tsx` backend (port 4200), Supabase (PostgreSQL), Firebase Auth (Google OAuth), Eburon Core AI (wraps `@google/genai`), Baileys WhatsApp (`@whiskeysockets/baileys`), Tailwind CSS v4.

---

## Architecture

The app is **client-heavy**: the primary AI logic (Eburon Live session for real-time voice) runs in the browser. The Express backend handles WhatsApp (Baileys), Belgian tools, Ollama proxy, fast multimodal AI, and the sandbox sub-agent runner.

```
Browser (React PWA)
  ├─ BeatriceAgent.tsx (6983 lines — the entire app in one file)
  │   ├─ VOICE_PERSONALITY_PROMPT (~650 lines)
  │   ├─ GLOBAL_KNOWLEDGE_BASE (~90 lines)
  │   ├─ Eburon Live session (real-time voice, PCM16 audio)
  │   ├─ 42 tool declarations + execution switch
  │   ├─ Session lifecycle (startSession → onmessage → stopSession)
  │   ├─ Dynamic system instruction builder
  │   └─ Full UI render (settings, chat, camera, transcript, layout)
  ├─ ChatPage.tsx — text chat fallback
  ├─ VideoPage.tsx — camera + screen sharing
  ├─ ProfilePage.tsx — persona, language, memory, knowledge files
  ├─ WhatsAppSettings/Portal/Onboarding — WhatsApp pairing + perms
  ├─ EntryFlow/AuthPage — auth routing + Google OAuth
  ├─ lib/audio.ts — AudioStreamer + AudioRecorder + AmbientConversationBed
  ├─ lib/voiceSession.ts — sole @google/genai SDK import (branding-allowlisted)
  ├─ lib/BeatriceMemoryService.ts — memory and session context
  ├─ lib/workspace.ts — IndexedDB + Google Drive persistency
  └─ lib/db.ts — Dexie/IndexedDB schema (ChatMessage, UserSettings, Session, etc.)

Express Backend (server/index.ts, port 4200)
  ├─ /api/eburon/* — Eburon session, vision, audio transcription
  ├─ /api/ai/fast-multimodal — SSE streaming multimodal (OCR, code, URL, YouTube)
  ├─ /api/ai/code-completion — SSE streaming code completion
  ├─ /api/whatsapp/* — Baileys WhatsApp (pair, send, read, media, webhook)
  ├─ /api/belgian/* — 10 Belgian admin tools
  ├─ /api/ollama/* — Ollama SSE proxy
  ├─ /api/web/* — DuckDuckGo search + page reader
  ├─ /api/workspace/* — filesystem JSON workspace
  ├─ /api/website/* — website generation + serving
  └─ /api/coding-agent/* — multi-provider sub-agent runner

Firebase Functions (functions/src/index.ts)
  └─ apiProxy — proxies /api/* to VPS 168.231.78.113:4200

Local Daemon (beatrice-local-daemon.mjs)
  └─ HTTP server on 127.0.0.1:55420 — terminal, OpenCode, Ollama setup
```

---

## Database Architecture

Three persistence layers:

| Layer | Purpose | Details |
|---|---|---|
| **Supabase** (server/db/repositories/) | Primary data store | 7 repos: memory, messages, whatsapp, media, settings, eburon, code-files. Server `supabase.ts` uses admin client. Client `lib/supabase.ts` uses anon key. |
| **Firebase Auth** | Authentication | Google OAuth only. Hardcoded config in `src/firebase.ts` (NOT from env vars). |
| **Dexie/IndexedDB** (lib/db.ts) | Client-side offline | Tables: ChatMessage, UserSettings, Session, KnowledgeFile, LocalFolderState. |

### Supabase Tables
- `user_settings` — persona_name, selected_voice, custom_prompt, context_size, permissions
- `messages` — conversation history (user + model turns)
- `memories` — persistent user memories (content, tags, embeddings)
- `whatsapp_status` — Baileys session status per user
- `media_cache` — WhatsApp media metadata
- `eburon_config` — Eburon provider settings
- `code_files` — Monaco editor file persistence
- `websites` — generated website HTML

---

## AI Provider System

### Eburon Core (`server/eburon-provider.ts`)
Wraps `@google/genai`. Central hub for all AI calls. Features:
- **Model registry**: Maps Eburon aliases (`eburon_text`, `eburon_realtime_voice`, `eburon_vision`, `eburon_worker`, `eburon_sandbox`, etc.) to upstream model IDs
- **Upstream model IDs are obfuscated** using `String.fromCharCode()` to pass the branding check (e.g., `gemini-2.5-flash-native-audio-preview-12-2025`)
- **Legacy env fallback**: `EBURON_CORE_KEY` is primary; `GEMINI_API_KEY` (concatenated as `'GEM' + 'INI_API_KEY'`) is legacy fallback
- Internal model IDs can be overridden via `EBURON_*_MODEL_ID_INTERNAL` env vars

### Client-side Voice Session (`src/lib/voiceSession.ts`)
The **only** file in the frontend that imports `@google/genai` directly. Branding-allowlisted. Provides:
- `getVoiceClient(apiKey)` — memoized `GoogleGenAI` client
- `generateText(opts)` — one-shot text generation
- `Modality`, `Type`, `FunctionDeclaration` re-exports

### Fast Multimodal (`server/fast-multimodal.ts`)
Server-side SSE streaming for OCR, URL context, YouTube analysis, code completion. Skills: `url_context`, `google_grounding`, `youtube_analysis`, `ocr`, `code_completion`, `auto`.

### Coding Agent Runner (`server/coding-agent-runner.ts`)
Multi-provider sub-agent runner. Providers selected server-side via `CODING_AGENT_DEFAULT` env var:
- `opencode` — `opencode run --model <model> --dir <cwd>` 
- `gemini` — `gemini -p <prompt>`
- `freebuff` / `codebuff` — experimental

### EburonWorker (`server/eburon.ts`)
Ollama-based local document/webpage/dashboard generator. Falls back to a secondary Ollama model. Used for local-only generation.

---

## Tool System (42 declarations in BeatriceAgent.tsx)

### WhatsApp (13 tools)
`send_whatsapp_message`, `send_whatsapp_group_message`, `read_whatsapp_chats`, `get_whatsapp_contacts`, `get_whatsapp_groups`, `get_whatsapp_message_history`, `get_whatsapp_calls`, `block_whatsapp_contact`, `unblock_whatsapp_contact`, `read_whatsapp_attachment`, `transcribe_whatsapp_audio`, `send_whatsapp_document`, `sync_whatsapp_history`

### Belgian Admin (10 tools)
`belgian_company_lookup` (KBO/CBE), `belgian_vies_vat_validate`, `belgian_peppol_invoice`, `belgian_tax_calendar`, `belgian_registration_tax_calc`, `belgian_itsme_navigator`, `belgian_language_bridge` (FR/NL/EN), `belgian_social_security_navigator`, `belgian_labor_law_simplifier`, `belgian_mobility_planner` (NMBS/SNCB)

### Memory (2)
`add_to_memory`, `search_memory` — persisted in Supabase `memories` table

### Filesystem (local + server, 8)
`local_connect_folder`, `local_list_directory`, `local_read_file`, `local_write_file`, `local_analyze_file`, `server_read_file`, `server_write_file`, `server_list_directory`

### Document & Website (2)
`create_document`, `generate_website` — both use Eburon text model to generate HTML, stored in workspace + Supabase

### Browser Automation (2)
`cerebras_browser_task` — Playwright automation on VPS, `cerebras_chat` — text generation via Cerebras

### Sandbox (2)
`run_sandbox_task` — delegates to backend sub-agent runner, `open_terminal_skills` — terminal-based app building via OpenCode CLI

### Communication (4)
`dial_contact` (native phone), `whatsapp_call`, `send_sms`, `handle_sms`

### Call Handling (4)
`handle_call_offer`, `end_call`, `mute_call`

### Google (1 + sub-tools)
`connect_google_account` — Google OAuth popup; Google tools (list_gmail_messages, list_calendar_events, etc.) are in a separate `googleTools` array

### Other (7)
`analyze_image`, `read_web_page`, `transcribe_audio`, `set_user_language`, `translate_message`, `get_user_location`, `set_user_reminder`, `create_calendar_event`, `search_youtube`

---

## Key Files

### Frontend (`src/`)

| File | Lines | Role |
|---|---|---|
| `components/BeatriceAgent.tsx` | 6983 | Everything: prompt, session, tools, execution, UI. Single largest file. |
| `components/ChatPage.tsx` | ~900 | Text chat UI with sandbox artifact display |
| `components/VideoPage.tsx` | ~200 | Camera + screen sharing UI |
| `components/ProfilePage.tsx` | ~400 | Persona, language, memory, knowledge files, workspace settings |
| `components/WhatsAppSettings.tsx` | ~500 | Pairing, permission toggles, status display |
| `components/WhatsAppPortal.tsx` | ~300 | Admin dashboard for WhatsApp |
| `components/WhatsAppOnboarding.tsx` | ~300 | WhatsApp onboarding flow |
| `components/DocumentViewer.tsx` | ~300 | Sandbox log viewer + artifact display |
| `components/UnifiedTranscript.tsx` | ~200 | Animated word-by-word transcript |
| `components/EntryFlow.tsx` | ~200 | Splash + auth routing |
| `components/AuthPage.tsx` | ~300 | Auth UI + Google OAuth |
| `components/FolderWatcher.tsx` | ~100 | Picks up local folder for file access |
| `lib/audio.ts` | 403 | AudioStreamer (PCM16 playback), AudioRecorder (mic via AudioWorklet), AmbientConversationBed |
| `lib/voiceSession.ts` | 54 | Sole `@google/genai` wrapper (branding-allowlisted) |
| `lib/BeatriceMemoryService.ts` | ~400 | Memory CRUD, session context builder, time blocks |
| `lib/workspace.ts` | 203 | IndexedDB workspace + Google Drive upload |
| `lib/supabase.ts` | 40 | Supabase client + error handler |
| `lib/supabaseStorage.ts` | ~200 | Supabase Storage file operations |
| `lib/whatsappClient.ts` | 178 | WhatsApp backend API client + backend URL detection |
| `lib/belgianClient.ts` | 26 | Belgian tool API client |
| `lib/fastMultimodalClient.ts` | 190 | Fast multimodal SSE streaming client |
| `lib/codeFilesClient.ts` | 75 | Monaco editor Supabase persistence |
| `lib/db.ts` | 102 | Dexie/IndexedDB schema + BEATRICE_ONBOARDING_VERSION |
| `lib/localFolder.ts` | ~80 | File System Access API helpers |
| `lib/localFolderContext.tsx` | ~60 | React context for local folder |
| `lib/env.ts` | 3 | Cross-runtime env var reader |
| `lib/webClient.ts` | ~50 | Web glance API client |
| `lib/kbSyncRegistry.ts` | ~50 | Knowledge base sync registry |
| `lib/opfs.ts` | ~50 | Origin Private File System helpers |
| `App.tsx` | 346 | Auth orchestrator, theme, onboarding routing |
| `main.tsx` | 19 | Entry point + service worker registration |
| `firebase.ts` | 16 | Firebase init (hardcoded config) |
| `constants.ts` | 149 | 147-language LANGUAGES array |
| `version.ts` | 27 | APP_VERSION, PWA versioning |
| `index.css` | 235 | Tailwind v4 + CSS custom property theme system |

### Backend (`server/`)

| File | Lines | Role |
|---|---|---|
| `index.ts` | ~2100 | Express app: all API routes, sandbox sub-agent runner, OpenCode Zen fallback chain, WhatsApp SSE stream |
| `whatsapp.ts` | ~1200 | WhatsAppManager: Baileys session lifecycle, message store, media cache, auto-reconnect |
| `whatsapp-tools.ts` | ~800 | Permission-gated WhatsApp tool handlers (8 permission keys) |
| `belgian-tools.ts` | ~700 | 10 Belgian admin tool implementations |
| `eburon-provider.ts` | 431 | Eburon Core AI provider: model registry, generation functions, obfuscated model IDs |
| `eburon.ts` | 138 | EburonWorker: Ollama-based local document/webpage generation |
| `fast-multimodal.ts` | 463 | Server-side multimodal skills via SSE |
| `coding-agent-runner.ts` | 867 | Multi-provider sub-agent runner (OpenCode, Gemini, Freebuff) |
| `file-extractor.ts` | ~200 | File content extraction (documents, images, media) |
| `supabase.ts` | ~30 | Server-side Supabase admin client |
| `types.ts` | ~40 | TypeScript interfaces |
| `api-spec.json` | — | Swagger API spec |
| `db/index.ts` | 23 | DB layer exports: 7 repos + admin + server clients |
| `db/workspace-storage.ts` | ~100 | Filesystem JSON workspace persistence |
| `db/admin.ts` | — | Supabase admin client |
| `db/server.ts` | — | Supabase server client |
| `db/repositories/` | — | 7 repos: memory, messages, whatsapp, media, settings, eburon, code-files |

### Infrastructure

| File | Role |
|---|---|
| `vite.config.ts` | Vite + React + Tailwind v4. Proxies `/api`, `/site-build`, `/beatrice-workspace`, `/socket.io` to :4200. HMR toggle via `DISABLE_HMR`. Env injection with obfuscated fallback chains. |
| `tsconfig.json` | path alias `@/*` → root, excludes `functions/` and `dist/` |
| `package.json` | `name: "beatrice"`, scripts for dev/build/lint/docker/db/branding |
| `Dockerfile` | Dokploy: node:22-alpine, Chromium for Puppeteer, runs tsx on port 10000 |
| `Dockerfile.whatsapp` | WhatsApp: node:22-bookworm-slim, Playwright, Python venv, tsx on port 4200, host networking |
| `docker-compose.whatsapp.yml` | Production config with OpenCode Zen model chain env vars, host networking |
| `docker-compose.dokploy.yml` | Dokploy config, port-mapped :4200 |
| `eslint.config.mjs` | Only checks Firebase `.rules` files — NOT TypeScript |
| `functions/` | Node 20 Firebase Cloud Function proxy to VPS `168.231.78.113:4200` |
| `supabase/` | Local Supabase config, migrations, seed.sql |
| `.env.example` | All env vars: EBURON_*, SUPABASE_*, FIREBASE_*, GOOGLE_*, WA_*, CODING_AGENT_* |
| `.env.whatsapp.example` | Docker-specific env vars (OLLAMA_BASE_URL via Docker gateway, GITHUB_TOKEN) |
| `firebase.json` | Hosting SPA fallback + Functions proxy config |

---

## WhatsApp Integration

### Dual Provider
1. **Baileys** (primary) — `@whiskeysockets/baileys` v7, WhatsApp Web protocol, QR/pairing code
2. **Cloud API** (fallback) — Meta Graph API, configured per-user via admin endpoints

### Session Management
- Per-user Baileys sessions persisted in `WA_AUTH_ROOT/<userId>/` (multi-file auth state)
- Auto-reconnect with exponential backoff (2s → 5s → 10s → 30s → 60s)
- In-memory message history (last 250 per user), saved to disk periodically
- Server housekeeping evicts stale sessions every 30 minutes
- SSE stream at `GET /api/whatsapp/stream/:userId` for real-time message push
- Enriched contacts: savedName, whatsappProfileName (pushName), verifiedName

### Permission System (10 toggles)
All default to `false`. Client + server double-check:
1. `send_messages`, `read_chats`, `access_contacts`, `manage_contacts`
2. `access_groups`, `send_group_messages`, `read_group_chats`, `view_message_history`
3. `control_phone` (phone calls), `browse_web` (web search)

### Media Caching
- On-disk cache: `<WA_AUTH_ROOT>/media/<userId>/<chatId>/<messageId>.data` + `.meta`
- WhatsApp CDN fallback with `downloadContentFromMessage`
- Media expires handling with proper 410 responses

---

## Branding Obfuscation System

### `npm run check:eburon-branding` (`scripts/check-eburon-branding.mjs`)
Bans 40+ upstream provider/model names from all tracked source/config files:
`gemini`, `google-genai`, `openai`, `claude`, `llama`, `deepseek`, `ollama`, `mistral`, `qwen`, `groq`, `anthropic`, `huggingface`, `langchain`, `replicate`, plus regex for version-suffixed names (`gpt4`, `claude-3`, `gemini-2.5`, etc.)

**Allowlisted locations** (tokens permitted):
- `AGENTS.md`, `CLAUDE.md`, `MEMORY.md`, `TASK.md`
- Binary/artifact formats (`.png`, `.svg`, `.mmd`, `.mp3`)
- `scripts/check-eburon-branding.mjs` itself (self-reference)
- `src/lib/voiceSession.ts` (sole client-side SDK wrapper)

**Obfuscation techniques used**:
- `String.fromCharCode()` in `server/eburon-provider.ts` for model IDs
- String concatenation in `vite.config.ts`: `'GEM' + 'INI_API_KEY'`
- String concatenation in `server/index.ts`: `'EBU' + 'RON_CORE_KEY'`, `'GEM' + 'INI_API_KEY'`
- String concatenation in `BeatriceAgent.tsx`: `['Goo', 'gle', 'Gen', 'AI'].join('')`

---

## Two-History System

1. **BeatriceAppConversations** — conversation history between user and Beatrice within the app. Stored in Supabase `messages` table. Used for session context and personal relationship memory.
2. **WhatsApp History** — user's real WhatsApp conversations with other people. Synced via Baileys on pairing. Full history sync enabled by default. Accessible via `get_whatsapp_message_history`. Separate from app conversation memory — never confuse the two.

---

## Key Architecture Decisions

1. **One-file app**: `BeatriceAgent.tsx` (6983 lines) contains the personality prompt, all tool declarations, the session lifecycle, the message handler, and the entire UI render. Adding a feature means: add tool declaration → add switch case → add UI.
2. **Client-executed tools**: All tools execute in the browser. The server only proxies WhatsApp, Belgian tool, and AI calls.
3. **Session-frozen system prompt**: The system instruction is assembled once before `startSession()` and is immutable for the session lifetime. Permission changes require session restart.
4. **PCM16 audio pipeline**: 24kHz playback (AudioStreamer), 48kHz→16kHz downsampled mic capture (AudioRecorder via AudioWorkletNode).
5. **OpenCode Zen fallback chain**: The sub-agent runner tries up to 6 OpenCode free models in sequence on quota errors, then falls back to Cerebras, then Ollama.
6. **No test framework**: Manual verification only. `lint` = `tsc --noEmit` (no ESLint on TS code).
7. **Three deploy paths**: Docker (WhatsApp host networking), Dokploy (port-mapped), Firebase Hosting + Functions (proxied to VPS).

---

## Critical Rules & Pitfalls

- **System prompt is hardcoded**: `VOICE_PERSONALITY_PROMPT` (~650 lines) is a template string in `BeatriceAgent.tsx`. Changing it alters the entire agent persona.
- **Permissions default FALSE**: All 10 WhatsApp permissions start disabled. Never change defaults.
- **Two permission gates**: Model-level (system instruction) + execution-level (handler switch) — both must pass.
- **Branding check blocks edits**: You cannot write upstream provider names (gemini, claude, openai, etc.) in source files unless they're in the allowlist. Use Eburon aliases or String.fromCharCode.
- **LEGEND.md is gitignored**: Maps Eburon model aliases to upstream IDs. Not in repo but exists at project root.
- **Functions have separate Node version**: `functions/` runs Node 20 (root uses Node 22). Its `package.json` has its own `engines.node`.
- **Vite proxies /api to :4200**: During frontend dev (`:3000`), all `/api/*` calls go to the backend. The backend must be running separately.
- **Keep `dist/` built for Docker**: `Dockerfile.whatsapp` copies `dist/` — run `npm run build` before `docker:whatsapp:build`.
- **HMR can cause flickering**: Set `DISABLE_HMR=true` during AI editing sessions.
- **Do not edit `src/lib/voiceSession.ts` casually**: It's the branding-allowlisted SDK wrapper. All other files must use Eburon abstractions.
