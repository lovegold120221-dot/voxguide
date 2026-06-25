# Voxx-Zero (Beatrice) — Project Knowledge

Real-time voice AI agent by Eburon AI, specialized for the Belgian market. Live at `https://whatsapp.eburon.ai`. Code lives in `/opt/voxx-zero`.

## Quickstart

**One-paste installer (freshly formatted machines — preferred for end users):**

```bash
# macOS / Debian / Ubuntu
curl -fsSL https://raw.githubusercontent.com/lovegold120221-dot/turbo-dollop/main/bootstrap.sh | bash

# Windows (PowerShell as Administrator)
irm https://raw.githubusercontent.com/lovegold120221-dot/turbo-dollop/main/install.ps1 | iex
```

Local dev (Node 22+ required):

```bash
cp .env.example .env              # fill in EBURON_CORE_KEY, SUPABASE_*, VITE_FIREBASE_*, GOOGLE_CLIENT_*
npm install
npm run dev:full                   # frontend :3000 + backend :4200
# Or separately:
npm run dev                        # Vite dev server
npm run dev:api                    # Express via tsx
npm run build                      # required before Docker build
npm run lint                       # tsc --noEmit (pre-existing errors, do not fix)
```

Supabase setup (run in Supabase SQL Editor): `supabase-migration-settings.sql` then `supabase-migration-memories.sql`.

The `install.sh` script runs 14 sequenced steps: system packages → Node 22 → Docker → psql → ffmpeg → repo → npm → Python venv → Ollama → OpenCode CLI → eburonhub-skills → Supabase CLI → PM2 + sandbox dirs + .env + Vite build → verify + start (systemd service if root).

## Architecture

```
Frontend (React 19 + Vite 6)            Backend (Express 4 + tsx, Node 22+)
├─ src/components/BeatriceAgent.tsx     ├─ server/index.ts         (all routes)
├─ src/components/ChatPage.tsx          ├─ server/eburon-provider.ts (AI wrapper)
├─ src/components/ProfilePage.tsx       ├─ server/whatsapp.ts      (Baileys)
├─ src/components/DocumentViewer.tsx    ├─ server/whatsapp-tools.ts
├─ src/lib/audio.ts       (PCM16 WS)    ├─ server/belgian-tools.ts (10 admin tools)
├─ src/lib/workspace.ts   (IDB+Drive)  ├─ server/file-extractor.ts
├─ src/lib/supabase.ts                  ├─ server/db/workspace-storage.ts (FS JSON)
├─ src/lib/env.ts        (getEnv)      └─ server/db/repositories/  (Supabase access)
├─ src/lib/voiceSession.ts (sole SDK)
├─ src/constants.ts      (147 langs)
└─ src/version.ts        (PWA)
                                      Functions (Firebase, Node 20)
AI Layer                                └─ functions/src/index.ts → VPS proxy
├─ Eburon Live API (voice, @google/genai — wrapped server-side by eburon-provider.ts,
│                  client-side by src/lib/voiceSession.ts)
├─ OpenCode CLI sub-agent (served apps)
├─ Cerebras + Browser-Use (browser automation)
└─ Ollama proxy (local fallback)

Data
├─ Supabase (memories, messages, settings, websites, tool_outputs)
├─ Firebase Auth (Google OAuth)
├─ IndexedDB (local workspace)
├─ Google Drive (Beatrice_Workspace folder)
└─ Filesystem: /data/workspace (server JSON), /data/beatrice-workspace (served apps)
```

## Stack

| Layer | Tech |
|---|---|
| Frontend | React 19, Vite 6, Tailwind v4, motion, lucide-react |
| Backend | Express 4, tsx, Node 22+, multer (file uploads) |
| AI (server) | Eburon Live API via `server/eburon-provider.ts` |
| AI (client realtime) | `@google/genai` **only** via `src/lib/voiceSession.ts` |
| Auth | Firebase (Google OAuth) |
| DB | Supabase PostgreSQL + IndexedDB |
| WhatsApp | `@whiskeysockets/baileys` |
| Browser | Browser-Use + Cerebras (`gpt-oss-120b`) |
| Sub-agent | OpenCode CLI (21+ skills cloned from `eburonhub-skills`) |
| Local LLM | Ollama (Hermes 3 / qwen2.5-coder fallback) |

## Conventions & Constraints

- **Branding**: "Eburon" is a rebrand of an upstream provider. Never reference upstream names in tracked files. Run `npm run check:eburon-branding`. The scanner now bans `gemini`, `gemma`, `palm`, `bard`, `vertex ai`, `openai`, `chatgpt`, `dall-e`, `claude`, `anthropic`, `llama`, `mistral`, `mixtral`, `deepseek`, `qwen`, `cohere`, `groq`, `huggingface`, `langchain`, `llamaindex`, `ollama`, regex patterns like `gpt-4`, `claude-3`, `llama3.1`, etc. **Exception: `src/lib/voiceSession.ts` is the SOLE client-side file allowed to import the realtime SDK**; everything else must go through its public surface (`getVoiceClient`, `generateText`, `LiveServerMessage`, `Modality`, `Type`, `FunctionDeclaration`).
- **Model obfuscation**: In `server/eburon-provider.ts`, upstream model IDs are wrapped in `String.fromCharCode` to pass build verification. Aliases (`eburon_text`, `eburon_realtime_voice`, `eburon_sandbox_worker`, etc.) are public; the mapping table is in gitignored `LEGEND.md`. `vite.config.ts` also accepts the upstream API key name as a fallback so legacy `VITE_*` env vars keep working through `define:` → `process.env.*`.
- **HMR**: Off by default to stop browser flicker during agent edits. Set `DISABLE_HMR=true` in env to confirm (read in `vite.config.ts`).
- **`getEnv` helper**: Always use `src/lib/env.ts` for env reads on the frontend — handles both `import.meta.env` and SSR `process.env`.
- **Tool functions**: Each WhatsApp action is its own function (`send_whatsapp_message`, `get_whatsapp_contacts`, etc.) — never a single god function. Outbound sends require `delegated_send` permission.
- **Workspace outputs**: Stored on filesystem under `/data/workspace` (or `WORKSPACE_DATA_DIR`), NOT in Supabase. Exception to repository pattern. Generated apps also land at `/data/beatrice-workspace/sandbox/artifact_<taskId>.html` and are served statically at `/beatrice-workspace/sandbox/...` (returning absolute URLs back to the client for iframe preview).
- **AI calls**: All server-side calls route through `server/eburon-provider.ts`; client-side realtime only through `src/lib/voiceSession.ts`. Never import the upstream SDK elsewhere.
- **Theme**: Both `theme-dark` (default) and `theme-light`. Use CSS vars from `src/index.css` (`var(--bg-base)`, `var(--text-primary)`, `var(--accent)`, etc.). 70+ override rules in light mode.
- **Mobile browser**: Includes an in-progress Flutter app at `flutter/`.
- **Agent skill directory**: `.agents/types/` provides TypeScript helpers for defining Codebuff agents; `.agents/skills/` stores skill markdown files that the agents can read at session start.
- **Filesystem tools**: `local_*` (browser `showDirectoryPicker`, Chrome/Edge only) + `server_*` (`POST /api/filesystem/*` against `WORKSPACE_DATA_DIR` via `safeResolve` path validation; `multer` multipart upload capped at 50 MB). Both expose `read|write|list` over text/image/audio; images/audio return a dataUrl. `local_analyze_file` is a one-step alternative to chaining `local_read_file` → `analyze_image`/`transcribe_audio`.
- **OpenCode Zen swap chain** (`/api/terminal/open-skills` → `runOpenTerminalWithFallback`): tries each entry in `OPENCODE_ZEN_FREE_MODELS` (env-overridable comma-separated `opencode/<model>` ids; defaults include `zenn-ai-large-free`, `deepseek-v4-flash-free`, `big-pickle`, `north-mini-code-free`, `mimo-v2.5-free`, `nemotron-3-ultra-free`). A failure with a quota/rate-limit signature (`429`/`402`/`out[-_ ]?of[-_ ]?tokens`/`RESOURCE_EXHAUSTED`/etc. in stderr/stdout) swaps to the next free model; a real task error breaks out and the local Ollama fallback (`OPEN_TERMINAL_FALLBACK_MODEL`) takes over as last resort. Errors annotate which models were tried for diagnostics.
- **Open Sites PWA skill** (`.opencode/skills/open-sites-pwa/SKILL.md` + `POST /api/open-site/clone`): mirrors a user-supplied PWA URL into `$BEATRICE_WORKSPACE_DIR/cloned-sites/<slug>/` with `wget --mirror --convert-links --adjust-extension --page-requisites --no-parent --directory-prefix=<target>`. Backend adds polite defaults (`--execute robots=off`, `--wait=0.5`, `--random-wait`, `--tries=3`, `--timeout=30`, `--connect-timeout=15`, `--max-redirect=5`, `--user-agent=Beatrice-OpenSitesPWA/1.0`); the slug is `[a-zA-Z0-9._-]{1,80}` derived from `hostname + path + query` (leading `www.` stripped). Returns `{ previewPath: /beatrice-workspace/cloned-sites/<slug>/, previewUrl: <BEATRICE_PUBLIC_URL>/..., size, fileCount, exitCode, partial, durationMs }`. Sister endpoints: `GET /api/open-site/list` (audit existing clones), `DELETE /api/open-site/:slug` (free disk). The existing DocumentViewer (`src/components/DocumentViewer.tsx`) renders the result by setting `iframe src={previewUrl}` — no UI changes required.

## Notable Gotchas

- `npm run lint` shows ~7-10 pre-existing TypeScript errors in external types — ignore, do not attempt to fix them.
- ESLint is configured ONLY for Firebase security rules, not application TS.
- Root `package.json` name is `react-example` (legacy); do not rename carelessly.
- `functions/` is excluded from root `tsconfig.json`; builds independently with `npm --prefix functions run build`.
- `tsconfig.json` has `allowImportingTsExtensions: true` and `noEmit: true` — Vite handles compilation.
- Production server uses `tsx` runtime (no compile step); VPS runs via PM2 (`voxx-backend`).
- Docker `whatsapp` compose requires `npm run build` first (copies `dist/` into image).
- Sandbox sub-agent artifacts land at `/beatrice-workspace/sandbox/artifact_<taskId>.html` and are served statically.
- `VITE_BACKEND_URL` empty in production (auto-detect via same-origin); `http://localhost:4200` in dev.
- Belgian tools are routed via `POST /api/belgian/tool { tool, params }` — 10 fixed tool names.
- WhatsApp SSE stream at `GET /api/whatsapp/stream/:userId`; backend is authoritative source for connection status (Supabase mirror is not).
- Sandbox runner fallback chain: `eburon_sandbox` → `eburon-multimodal-pro` → `cerebras-gpt-oss-120b` → `eburon-coder-pro` → `eburon_worker`.
- No test framework — manual verification only.

## Key File Map

| File | Purpose |
|---|---|
| `src/components/BeatriceAgent.tsx` | Main voice/session orchestrator, system prompt, tool registry, memory |
| `src/components/ChatPage.tsx` | Text chat surface, sandbox viewer |
| `src/components/ProfilePage.tsx` | Persona, language, memory, workspace UI |
| `src/components/DocumentViewer.tsx` | Full-screen sandbox/preview viewer (theme-aware, supports external URLs) |
| `src/components/AdminPortal.tsx` | Admin / debug surface |
| `src/components/VideoPage.tsx` | Camera + screen-share surface (audio+video) |
| `src/lib/audio.ts` | PCM16 AudioWorkletNode streamer + recorder |
| `src/lib/workspace.ts` | IndexedDB workspace + Google Drive upload |
| `src/lib/supabase.ts` | Supabase client + `saveToolResult` |
| `src/lib/supabaseStorage.ts` | Knowledge file list + content fetching |
| `src/lib/env.ts` | `getEnv` helper (single source for env reads) |
| `src/lib/voiceSession.ts` | **Sole** client-side realtime SDK wrapper (allowlisted by branding check) |
| `src/lib/belgianClient.ts` | Frontend client for Belgian admin tools |
| `src/lib/whatsappClient.ts` | Frontend WhatsApp API client |
| `src/lib/webClient.ts` | Web glance / search helper client |
| `src/lib/opfs.ts` | OPFS storage utilities |
| `src/lib/db.ts` | IndexedDB low-level helpers |
| `src/lib/localFolder.ts` | Browser File System Access API wrapper (`showDirectoryPicker`, list/read/write) |
| `src/constants.ts` | Shared `LANGUAGES` array (147 entries) |
| `src/version.ts` | `APP_VERSION`, `APP_BUILD` for PWA updates |
| `vite.config.ts` | Reads env (incl. legacy fallback for upstream SDK key name), exposes via `process.env.*` `define:` |
| `server/index.ts` | Express entry, all routes, static serving, SPA fallback (includes `POST /api/filesystem/{read,write,list,upload}` VPS filesystem CRUD) |
| `server/eburon-provider.ts` | **Sole** AI call wrapper (5 models, live-session token, image gen) |
| `server/whatsapp.ts` | Baileys `WhatsAppManager` (sessions, QR, SSE, media cache) |
| `server/whatsapp-tools.ts` | `handleSendMessage`, `handleWhatsAppAction` (permission-gated) |
| `server/belgian-tools.ts` | 10 admin tool implementations |
| `server/file-extractor.ts` | Extract content from PDFs/PPTX/DOCX/images |
| `server/db/workspace-storage.ts` | Filesystem workspace persistence (JSON) |
| `server/db/repositories/` | 6 typed DB access modules (memories, messages, WA, media, settings, eburon) |
| `scripts/cerebras_browser.py` | Python wrapper calling Browser-Use + Cerebras |
| `scripts/setup-cerebras.sh` | Python venv + browser-use installer |
| `scripts/check-eburon-branding.mjs` | Branding scan (tokens + regex) |
| `scripts/smoke-whatsapp-server.mjs` | Smoke test for `/api/health`, `/api/eburon/provider`, `/api/workspace/list` |
| `bootstrap.sh` | Universal one-paste bootstrap (detects OS, downloads `install.sh`) |
| `install.sh` | 14-step macOS/Debian/Ubuntu installer |
| `install.ps1` | Windows PowerShell installer |
| `.opencode/` | OpenCode CLI sub-agent config + 21+ skills |
| `functions/src/index.ts` | Firebase Cloud Function proxying `/api/*` → VPS `168.231.78.113:4200` |
| `docs/*.mmd` | Architecture / auth / tool-call flow diagrams |
| `.agents/types/` | Codebuff agent TypeScript type definitions |

## Environment Variables

Required: `EBURON_CORE_KEY`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` (or `VITE_SUPABASE_ANON_KEY`), `VITE_FIREBASE_*`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`.
Optional: `CEREBRAS_API_KEY`, `OLLAMA_BASE_URL`, `OPENCODE_PATH`, `WORKSPACE_DATA_DIR`, `BEATRICE_WORKSPACE_DIR`, `BEATRICE_PUBLIC_URL`, `VITE_BACKEND_URL`, `VITE_SANDBOX_URL`, `WHATSAPP_CLOUD_PHONE_NUMBER_ID`, `WHATSAPP_CLOUD_ACCESS_TOKEN`, `WHATSAPP_CLOUD_BUSINESS_ACCOUNT_ID`, `WHATSAPP_CLOUD_WEBHOOK_VERIFY_TOKEN`, `PORT` (default 4200), `DISABLE_HMR` (default `true`).

The legacy upstream SDK key name is also accepted by `vite.config.ts` as a fallback. Full template: `.env.example`.

## Deployment

- **VPS production**: PM2 (`voxx-backend`) + Docker compose (`docker-compose.whatsapp.yml`), behind NGINX/Traefik + Let's Encrypt on `whatsapp.eburon.ai`.
- **Self-host installer**: `bootstrap.sh` / `install.sh` / `install.ps1` produce a systemd service + `/data/{baileys,wa-media,workspace,beatrice-workspace}` dirs.
- **Dokploy alt**: `docker-compose.dokploy.yml` (runs from source, no pre-build).
- **Firebase Hosting**: Static only; `/api/*` rewrites to Cloud Function → VPS.
- **Vercel/Render**: SPA shell only (`vercel.json`, `render.yaml`).
- **APK**: Bubblewrap TWA via `.github/workflows/android-distribution.yml`.

## Useful Commands

```bash
npm run smoke:whatsapp              # hits /api/health, /api/eburon/provider, /api/workspace/list
npm run db:start / db:stop         # local Supabase
npm run check:eburon-branding      # branding CI check (tokens + regex)
npm --prefix functions run build   # build Firebase function
git status --short                 # see changed files (server/db/, server/index.ts, src/components/* are common-edit areas)
```
