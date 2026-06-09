# AGENTS.md

## Stack
Vite + React 19 + TS + Express + Firebase Auth + Local Supabase + Eburon Core + Baileys WhatsApp.

## Entry Point
`index.html` → `src/main.tsx` → `src/App.tsx`.

Express backend: `server/index.ts` (runs via `tsx`).

## Commands
```bash
npm run dev               # Frontend :3000
npm run dev:api           # Backend :4200 (tsx)
npm run dev:full          # Both concurrently
npm run build             # Vite build → dist/
npm run lint              # tsc --noEmit (~7-10 pre-existing errors, do not fix)
npm run smoke:whatsapp    # Quick /api/health check
npm run docker:whatsapp:build   # Docker build WhatsApp server
npm run docker:whatsapp:up      # Docker compose up
npm run db:start          # Start local Supabase
npm run db:stop           # Stop local Supabase
npm run db:reset          # Reset local Supabase DB (applies migrations + seed)
npm run db:migrate        # Run pending migrations
npm run check:eburon-branding   # Validate no upstream provider branding
```

## Architecture

### Data Flow
- Local Supabase is single source of truth (messages, memories, WhatsApp sync, media, settings, Eburon).
- `server/db/repositories/` provides centralized DB access — services never call Supabase directly.
- Google services tools run client-side in `BeatriceAgent.tsx` via browser OAuth. WhatsApp and Belgian tools proxy through Express backend.
- Eburon Core is the only AI provider. All AI calls route through `server/eburon-provider.ts`.

### Key Quirks
- **No test framework** — manual verification only.
- **Eburon model aliases** are used throughout. Internal upstream model IDs mapped in `server/eburon-provider.ts` via `EBURON_MODEL_REGISTRY`. Never expose upstream model IDs to frontend.
- **Prohibited branding tokens** (must never appear in source/docs/config): `gemini`, `google-genai`, `google generative`, `generative-ai`. Use Eburon aliases instead. The `check:eburon-branding` script enforces this.
- **HMR** on by default; set `DISABLE_HMR=true` to prevent flicker during AI edits (controlled in `vite.config.ts`).
- **Lint** (`npm run lint`) = `tsc --noEmit`. ESLint only checks Firebase security rules, not app code.
- **Env:** `EBURON_CORE_KEY` (server-side, no prefix). `VITE_`-prefixed for public frontend values only. Injected at build time via `vite.config.ts` (`loadEnv` + `define`). See `.env.local.example` for local dev and `.env.whatsapp.example` for Docker deployments.
- **Firebase proxy** (`functions/src/index.ts`) has hardcoded backend IP `168.231.78.113:4200` — do not change.
- **Path alias:** `@/*` maps to project root (`tsconfig.json` paths + Vite resolve alias).
- **Functions:** `functions/` uses Node 20 (`package.json:engines.node`), root uses Node 22.
- **Styling:** Tailwind v4 (`@import "tailwindcss"`), full theme via CSS custom properties (`.theme-dark`/`.theme-light`), `motion/react`, `lucide-react`.
- **WhatsApp:** Baileys (`server/whatsapp.ts`). Outbound tools require `delegated_send` permission + user approval. SSE real-time stream at `GET /api/whatsapp/stream/:userId`.
- **Supabase:** Run `supabase start` for local dev. Single migration: `supabase/migrations/00001_init_beatrice_core.sql` (25 tables). Seed data in `supabase/seed.sql`.
- **Companion file:** `CLAUDE.md` exists with similar guidance — keep both in sync.
- **Deep reference:** `src/overview.md` (~764 lines) documents the full system.

### Source Map
| Component | Responsibility |
|---|---|
| `src/components/BeatriceAgent.tsx` | ~280KB monolith: agent engine, Live API session, tools, audio, UI |
| `server/index.ts` | Express API: WhatsApp, Belgian tools, sandbox (multi-agent with Hermes), Cerebras, Ollama proxy, website builder, Eburon endpoints |
| `server/eburon-provider.ts` | Eburon Core provider: model registry, whitelist, AI call routing, token generation |
| `server/whatsapp.ts` | WhatsAppManager (Baileys) |
| `server/belgian-tools.ts` | 10 Belgian admin tool endpoints |
| `server/db/` | Database layer: supabase clients + repositories (memory, messages, WhatsApp, media, settings, Eburon) |
| `server/db/repositories/` | Centralized DB access: `eburon.repo.ts`, `media.repo.ts`, `memory.repo.ts`, `messages.repo.ts`, `settings.repo.ts`, `whatsapp.repo.ts` |
| `src/lib/prompts.ts` | `VOICE_PERSONALITY_PROMPT` (do not edit lightly) |
| `functions/src/index.ts` | Firebase Cloud Function proxy to VPS backend |

### API Routes (server/index.ts)
| Route | Purpose |
|---|---|
| `POST /api/belgian/tool` | 10 Belgian admin tools (KBO, VIES, Peppol, tax, etc.) |
| `GET/POST /api/whatsapp/*` | Pairing, messages, send, stream, webhook, admin |
| `GET /api/whatsapp/stream/:userId` | SSE real-time message stream |
| `POST /api/web/glance` | DuckDuckGo web search |
| `POST /api/sandbox/run` | Sub-agent runner (Eburon Sandbox → Eburon Multimodal Pro → Cerebras → Eburon Worker fallback chain). `task_type=hermes` routes directly to Eburon Multimodal Pro via Ollama. |
| `POST /api/cerebras/browser` | Browser-Use + Cerebras automation |
| `POST /api/ollama/generate` | Ollama LLM proxy (SSE streaming) |
| `POST /api/website/generate` | Web Architect (Eburon Worker) |
| `POST /api/docs/generate` | Document generation (Eburon Worker) |
| `POST /api/eburon/live-session` | Eburon voice session token |
| `GET /api/eburon/provider` | Eburon provider status |

### Notable Files
- `supabase/migrations/00001_init_beatrice_core.sql` — full schema (25 tables).
- `supabase/seed.sql` — local-only seed data.
- `.env.local.example` — local development env template.
- `.env.whatsapp.example` — Docker deployment env template.
- `public/*-template.html` — HTML templates for document/artifact generation (invoice, NDA, certificate, etc.).
- `ecosystem.config.cjs` — PM2 process config (voxx-backend + voix-backend + api-eburon).
- `ecosystem.config.selfhosted.cjs` — PM2 config for single-instance self-hosted deployment on port 4200.
- `scripts/check-eburon-branding.mjs` — branding compliance check (scans for prohibited tokens).
- `Dockerfile` (port 10000, puppeteer/chromium) / `Dockerfile.whatsapp` (port 4200, slim, no Chromium).
- `docker-compose.whatsapp.yml` (uses `Dockerfile.whatsapp`, host networking) / `docker-compose.dokploy.yml` (uses `Dockerfile`, port 4200).
- `render.yaml` / `vercel.json` — alternative deployment configs.
- `twa-manifest.json` — Android Trusted Web Activity config.

### Deployment
```bash
# Frontend (Firebase Hosting — rewrites /api/* to Firebase function → VPS)
firebase deploy --only hosting

# Functions (Node 20, not 22)
npm --prefix functions run build && firebase deploy --only functions

# Backend (Docker Compose — production)
npm run docker:whatsapp:build   # Build image
npm run docker:whatsapp:up      # Start container on port 4200

# Or rebuild/restart after code changes:
docker compose -f docker-compose.whatsapp.yml up -d --build
```
- Production URL: `https://whatsapp.eburon.ai`.
- In production, Express serves `dist/` static files + SPA fallback. Vite dev server runs alongside for frontend development.
- **Reverse proxy:** NGINX on ports 80/443 with Let's Encrypt proxies `whatsapp.eburon.ai` → `127.0.0.1:4200` (Docker container). Also proxies `api.eburon.ai`, `opencode.eburon.ai`, `fast.eburon.ai`, `fragments.eburon.ai`.
- **Dokploy:** See `.opencode/skills/dokploy-deploy/SKILL.md`. Uses `docker-compose.dokploy.yml` (`Dockerfile` with Chromium/puppeteer).

### CI
- `.github/workflows/android-distribution.yml` — On push to `main`: builds web, deploys to Firebase Hosting, builds Android APK via Bubblewrap, uploads to Firebase App Distribution.
