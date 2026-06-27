# AGENTS.md — Voxx-Zero (Beatrice)

## Stack

Vite 6 + React 19 + TS 5.8 + Express 4 + Firebase Auth + Supabase + Eburon Core + Baileys WhatsApp.
- **Root Node version:** 22
- **Functions Node version:** 20 (Firebase Cloud Functions)

## Entry Points

- **Frontend:** `index.html` → `src/main.tsx` → `src/App.tsx` (built via Vite, output to `dist/`)
- **Backend:** `server/index.ts` (port 4200, runs directly from source via `tsx`, no compilation step)
- **Firebase Functions:** `functions/src/index.ts` (proxies `/api/*` to the hardcoded VPS IP `168.231.78.113:4200`)
- **Electron:** `electron/main.cjs` — wraps the PWA at `https://whatsapp.eburon.ai` with IPC for terminal/workspace setup

## Commands

| Task | Command | Notes |
|---|---|---|
| Full dev | `npm run dev:full` | Frontend :3000 + Backend :4200 (via `&` shell backgrounding) |
| Frontend only | `npm run dev` | Vite dev server on :3000 |
| Backend only | `npm run dev:api` / `npm run start` | Runs `server/index.ts` via `tsx` on :4200 (no watch) |
| Build | `npm run build` | Vite build → `dist/` (required BEFORE docker build) |
| Lint | `npm run lint` | `tsc --noEmit`. ESLint only checks Firebase security rules (`.rules`), not TS code. |
| Smoke test | `npm run smoke:whatsapp` | Checks `/api/health`, `/api/eburon/provider`, `/api/workspace/list/:userId` |
| Clean | `npm run clean` | Removes `dist/` |
| Preview | `npm run preview` | Vite preview of built `dist/` |
| Electron dev | `npm run electron:dev` | Vite build + `electron .` |
| Electron build | `npm run electron:build:mac/linux/win/all` | Vite build + electron-builder |
| Docker build | `npm run docker:whatsapp:build` | Builds production slim image (requires `dist/` pre-built) |
| Docker up | `npm run docker:whatsapp:up` | Starts container on :4200 in host networking mode |
| Docker down | `npm run docker:whatsapp:down` | Stops container |
| Supabase | `npm run db:start / stop / reset / migrate` | Local Supabase via CLI |
| Supabase Studio | `npm run db:studio` | Opens Studio at `http://127.0.0.1:54323` |
| Branding check | `npm run check:eburon-branding` | Scans codebase for banned provider strings |

## Architecture & Data Flow

- **Supabase** is the primary source of truth (messages, memories, settings).
- **`server/db/repositories/`** is the only database access layer (7 repos: memory, messages, whatsapp, media, settings, eburon, code-files). Re-exported from `server/db/index.ts`.
- **`server/db/workspace-storage.ts`** is the exception: workspace outputs (documents, screenshots) stored as JSON on local filesystem under `/data/workspace` (or `WORKSPACE_DATA_DIR`), NOT in Supabase.
- **`server/eburon-provider.ts`** is the central AI provider, wrapping `@google/genai`. All AI calls route through it.
- **`server/fast-multimodal.ts`** is the second AI path — server-side multimodal skill router (OCR, code completion, URL context, YouTube analysis) streaming via SSE.
- **`server/coding-agent-runner.ts`** is a multi-provider sub-agent runner (openCode, Gemini CLI, Freebuff/Codebuff). Provider selected server-side via `CODING_AGENT_DEFAULT` env var.
- **`server/eburon.ts`** provides the `EburonWorker` class for Ollama-based local document/webpage generation (separate from the Eburon Core provider).
- **Google services** run client-side in `BeatriceAgent.tsx` via browser OAuth. WhatsApp and Belgian tools proxy through Express.
- **WhatsApp** uses `@whiskeysockets/baileys` in `server/whatsapp.ts`. Outbound tools require `delegated_send` permission + user approval. SSE stream at `GET /api/whatsapp/stream/:userId`.
- **No test framework** — manual verification only.
- **`docs/`** has Mermaid architecture diagrams (`.mmd` + rendered `.png`/`.svg`).

## Key Constraints & Obfuscation

- **Prohibited branding tokens:** The case-insensitive scan (`check:eburon-branding`) bans 40+ terms (`gemini`, `openai`, `claude`, `llama`, `deepseek`, `ollama`, `google-genai`, etc.) plus regex for versioned model names. Allowed only in `AGENTS.md`, `CLAUDE.md`, binary/artifact formats, `scripts/check-eburon-branding.mjs`, and `src/lib/voiceSession.ts` (sole SDK wrapper).
- **Model Obfuscation:** Inside codebase (e.g., `server/eburon-provider.ts`), upstream model IDs must be obfuscated using `String.fromCharCode` to pass build verification.
- **Rosetta Stone:** The gitignored **`LEGEND.md`** at the project root maps Eburon model aliases (e.g. `eburon_text`, `eburon_realtime_voice`) to their actual upstream IDs. Use it as reference.
- **HMR Control:** Disable HMR to stop browser flickering during AI edits by setting `DISABLE_HMR=true` (checked in `vite.config.ts`).
- **Path alias:** `@/*` maps to project root (`tsconfig.json`, `vite.config.ts`). Use `@/server/...` for server imports, `@/src/...` for frontend.
- **Tailwind v4:** CSS-based configuration (no `tailwind.config.js`). Imported as a Vite plugin via `@tailwindcss/vite`.
- **No `opencode.json`** — OpenCode agent config lives in `.opencode/package.json` (plugin dep only) and `.opencode/skills/`.

## Sub-Project Boundaries

- **Root Project:** Named `beatrice` in `package.json`. Houses React app + Express backend.
- **Functions:** Located in `/functions`, runs Node 20. Excluded from root `tsconfig.json`. Compile independently with `npm --prefix functions run build`.
- **Electron:** `/electron` — loads production PWA URL, IPC backend for terminal/workspace checks.
- **Android TWA:** `twa-manifest.json` + CI workflow (`.github/workflows/android-distribution.yml`) builds Bubblewrap APK.
- **OpenCode Agent:** Files in `.opencode/` are dedicated to the local agent/sub-agent runner configuration.

## Deployment Options

- **Docker (WhatsApp):** Production container on port 4200. Requires Vite output compiled (`npm run build`) beforehand as `dist/` is copied. Host networking mode.
- **Docker (Dokploy):** Uses `Dockerfile` (node:22-alpine) + `docker-compose.dokploy.yml`. Runs `tsx` directly from source. Port-mapped :4200.
- **Firebase Hosting:** SPA fallback handled via `firebase.json` rewrites. All `/api/**` calls proxy to the Cloud Function, which proxies to VPS (`168.231.78.113:4200`).
- **Firebase Hosting + Functions deploy:** `firebase deploy --only hosting` for frontend; `npm --prefix functions run build && firebase deploy --only functions` for API proxy.
- **Vercel:** `vercel.json` config (SPA rewrite, Vite build).
- **Render:** `render.yaml` (web service, health check `/api/health`).
