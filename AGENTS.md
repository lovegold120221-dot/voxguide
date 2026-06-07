# AGENTS.md

## Stack
Vite + React 19 + TS + Express + Firebase Auth + Supabase + Gemini Live API + Baileys WhatsApp.

## Entry Point
`index.html` → `src/main.tsx` → `src/App.tsx`.

Express backend: `server/index.ts` (runs via `tsx`).

## Commands
```bash
npm run dev              # Frontend :3000
npm run dev:api          # Backend :4200 (tsx)
npm run dev:full         # Both concurrently
npm run build            # Vite build → dist/
npm run lint             # tsc --noEmit (~7-10 pre-existing errors, do not fix)
npm run smoke:whatsapp   # Quick /api/health check
npm run docker:whatsapp:build  # Docker build WhatsApp server
npm run docker:whatsapp:up     # Docker compose up
```

## Architecture

### Data Flow
- Supabase is single source of truth for tool outputs (`tool_outputs` table). `DocumentViewer` fetches by ID from Supabase — never client-side generated HTML/JSON.
- Google services tools run client-side in `BeatriceAgent.tsx` via browser OAuth. WhatsApp and Belgian tools proxy through Express backend.

### Key Quirks
- **No test framework** — manual verification only.
- **Gemini model ID** obfuscated in `BeatriceAgent.tsx` via char codes. Real model: `gemini-2.5-flash-native-audio-preview-12-2025`.
- **HMR** on by default; set `DISABLE_HMR=true` to prevent flicker during AI edits.
- **Env:** `GEMINI_API_KEY` (no prefix) for Gemini. `VITE_`-prefixed for all others. Injected at build time in `vite.config.ts` via `loadEnv` + `define`.
- **Firebase proxy** (`functions/src/index.ts`) has hardcoded backend IP `168.231.78.113:4200` — do not change.
- **ESLint** only checks Firebase security rules (`@firebase/eslint-plugin-security-rules`), not app code. Type checking uses `tsc --noEmit`.
- **Path alias:** `@/*` maps to project root via tsconfig paths + Vite resolve alias.
- **Functions:** `functions/` uses Node 20 (`package.json:engines.node`), root uses Node 22.
- **Styling:** Tailwind v4 (`@import "tailwindcss"`), full theme via CSS custom properties (`.theme-dark`/`.theme-light`), `motion/react`, `lucide-react`.
- **WhatsApp:** Baileys (`server/whatsapp.ts`). Outbound tools require `delegated_send` permissions + user approval. SSE real-time stream at `GET /api/whatsapp/stream/:userId`.
- **Deep reference:** `src/overview.md` (~764 lines) documents the full system.
- **Companion file:** `CLAUDE.md` exists with similar guidance — keep both in sync.

### Source Map
| Component | Responsibility |
|---|---|
| `src/components/BeatriceAgent.tsx` | ~270KB monolith: agent engine, Live API session, tools, audio, UI |
| `server/index.ts` | Express API: WhatsApp, Belgian tools, sandbox, Cerebras, Ollama proxy, website builder |
| `server/whatsapp.ts` | WhatsAppManager (Baileys) |
| `server/belgian-tools.ts` | 10 Belgian admin tool endpoints |
| `src/lib/prompts.ts` | `VOICE_PERSONALITY_PROMPT` (do not edit lightly) |
| `functions/src/index.ts` | Firebase Cloud Function proxy to VPS backend |

### API Routes (server/index.ts)
| Route | Purpose |
|---|---|
| `POST /api/belgian/tool` | 10 Belgian admin tools (KBO, VIES, Peppol, tax, etc.) |
| `GET/POST /api/whatsapp/*` | Pairing, messages, send, stream, webhook, admin |
| `GET /api/whatsapp/stream/:userId` | SSE real-time message stream |
| `POST /api/web/glance` | DuckDuckGo web search |
| `POST /api/sandbox/run` | Sub-agent runner (OpenCode CLI or Gemini API) |
| `POST /api/cerebras/browser` | Browser-Use + Cerebras automation |
| `POST /api/ollama/generate` | Ollama LLM proxy (SSE streaming) |
| `POST /api/website/generate` | Web Architect (gemini-2.0-flash-exp) |
| `POST /api/docs/generate` | Document generation |

### Notable Files
- `supabase-migration-settings.sql` / `supabase-migration-memories.sql` — schema migrations for Supabase SQL Editor.
- `public/reference-ui.html` — design source of truth.
- `public/*-template.html` — HTML document templates for artifact generation.
- `ecosystem.config.cjs` — PM2 process config for production.
- `Dockerfile` (port 10000, puppeteer/chromium) / `docker-compose.whatsapp.yml` (port 4200) — containerized backend.
- `twa-manifest.json` — Android Trusted Web Activity config.
- `render.yaml` / `vercel.json` — alternative deployment configs.

### Deployment
```bash
# Frontend (Firebase Hosting — rewrites /api/* to Firebase function → VPS)
firebase deploy --only hosting

# Functions (Node 20, not 22)
npm --prefix functions run build && firebase deploy --only functions

# Backend VPS via PM2
npm run build
pm2 start ecosystem.config.cjs
```
- Functions runtime is Node 20 (`functions/package.json:engines.node`), not root Node 22.
- Production URL: `https://whatsapp.eburon.ai`.
- Alternatively deployable via Vercel (`vercel.json`), Render (`render.yaml` — web service runtime Node, health check `/api/health`), or **Dokploy** (`.opencode/skills/dokploy-deploy/SKILL.md` + `docker-compose.dokploy.yml`).
- In production, Express serves `dist/` static files + SPA fallback.
- **Dokploy migration planned** — VPS currently runs PM2+Traefik, will migrate to Dokploy (self-hosted PaaS). See skill file for instructions.

### CI
- `.github/workflows/android-distribution.yml` — On push to `main`: builds web, deploys to Firebase Hosting, builds Android APK via Bubblewrap, uploads to Firebase App Distribution.
