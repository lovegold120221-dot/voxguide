# Voxx-Zero — Belgian AI Voice Agent

**Beatrice** is a real-time voice AI agent powered by the **Gemini Live API** with WhatsApp integration, multi-language support, persistent memory, a Cerebras-powered browser automation agent, and 10 specialized Belgian administrative tools. Built by [Eburon AI](https://eburon.ai).

---

## Architecture

```
Frontend (React 19 + Vite)
  ├─ Voice Pipeline (PCM16 WebSocket)
  ├─ Chat Page (Eburon PC Sandbox)
  ├─ WhatsApp Pairing / Chat List
  ├─ Profile / Settings / Theme (Dark + Light)
  └─ Document Viewer (Supabase-backed)

Backend (Express + tsx)
  ├─ Baileys WhatsApp Manager (server/whatsapp.ts)
  ├─ Belgian Admin Tools (server/belgian-tools.ts)
  ├─ Sandbox Sub-Agent Runner
  ├─ Cerebras Browser Automation
  ├─ Ollama LLM Proxy (SSE streaming)
  └─ Web Glance (DuckDuckGo)

AI Layer
  └─ Gemini 2.5 Flash Native Audio (Live API)

Data Layer
  ├─ Supabase (PostgreSQL tool_outputs + memories)
  ├─ Firebase Auth (Google OAuth)
  └─ IndexedDB (local workspace)
```

### Stack

| Layer | Technology |
|---|---|
| **Frontend** | React 19, Vite 6, Tailwind CSS v4, motion (Framer Motion) |
| **Backend** | Express 4, tsx runtime, Node 22+ |
| **AI Voice** | Gemini 2.5 Flash Native Audio |
| **Auth** | Firebase Auth (Google OAuth) |
| **Database** | Supabase (PostgreSQL + Storage) |
| **WhatsApp** | Baileys (`@whiskeysockets/baileys`) |
| **Hosting** | Ubuntu VPS + PM2 + Traefik (or Dokploy alternative) |

---

## Features

- **Real-Time Voice** — Low-latency PCM16 bidirectional audio via WebSocket, VAD, interruption handling, 5 voice profiles
- **WhatsApp Integration** — Baileys-based pairing (QR/OTP), full history sync, SSE real-time streaming, send/receive messages, manage contacts & groups, auto Belgian phone normalization
- **Memory System** — `add_to_memory` / `search_memory` via Supabase, 10 most recent memories pre-loaded at session start
- **Sandbox Sub-Agent** — Delegate complex tasks to a secondary AI (Gemini API or OpenCode CLI)
- **Cerebras Browser Agent** — Automated web browsing via Browser-Use + Cerebras inference
- **10 Belgian Admin Tools** — KBO/CBE lookup, VIES VAT validation, Peppol e-invoicing, tax calendar, registration tax calc, itsme navigator, language bridge (FR/NL/EN), social security navigator, labor law simplifier, mobility planner (NMBS/SNCB)
- **Multi-Language** — 147 languages, Flemish (nl-BE) primary, voice-driven language switching
- **Full Dark + Light Themes** — CSS custom properties, 70+ override rules
- **Content Filtering Toggle** — Disable censorship via Profile settings

---

## Quick Start

### Prerequisites
- Node.js 22+
- A Gemini API key ([Google AI Studio](https://aistudio.google.com))
- A Supabase project
- A Firebase project (for auth)

### Local Development
```bash
git clone https://github.com/lovegold120221-dot/xero.git
cd xero
npm install

cp .env.example .env
# Add your API keys: GEMINI_API_KEY, SUPABASE_*, FIREBASE_*

npm run dev:full     # Frontend :3000 + Backend :4200
# Or separately:
npm run dev          # Frontend only
npm run dev:api      # Backend only
```

### Database Setup
Run in Supabase SQL Editor:
1. `supabase-migration-settings.sql` — fixes `user_settings` schema
2. `supabase-migration-memories.sql` — creates `memories` table

---

## Project Structure

```
src/
├── components/
│   ├── BeatriceAgent.tsx    # Main agent: voice, tools, session lifecycle
│   ├── ChatPage.tsx         # Text chat with sandbox viewer
│   ├── VideoPage.tsx        # Camera + screen sharing
│   ├── ProfilePage.tsx      # Persona, language, memory settings
│   ├── AuthPage.tsx         # Login / register
│   ├── WhatsApp*.tsx        # Pairing, onboarding, settings, chat list
│   └── DocumentViewer.tsx   # Supabase-backed output viewer
├── lib/
│   ├── audio.ts             # AudioStreamer + AudioRecorder
│   ├── supabase.ts          # Supabase client
│   └── whatsappClient.ts    # WhatsApp API client
├── constants.ts             # 147-language LANGUAGES array
├── firebase.ts              # Firebase init
└── index.css                # Tailwind v4 + theme system

server/
├── index.ts                 # Express: all API routes
├── whatsapp.ts              # WhatsAppManager (Baileys)
├── whatsapp-tools.ts        # Permission-gated tool dispatch
├── belgian-tools.ts         # 10 Belgian admin tools
└── supabase.ts              # Server Supabase client

functions/src/index.ts       # Firebase Cloud Function proxy to VPS
scripts/
├── cerebras_browser.py      # Browser-Use + Cerebras wrapper
└── setup-cerebras.sh        # Python dep installer
```

---

## Deployment

### VPS (Production — Current)
```bash
npm run build
pm2 start server/index.ts --interpreter node_modules/.bin/tsx --name voxx-backend
```
Port 4200 behind Traefik reverse proxy with Let's Encrypt. Production URL: `https://whatsapp.eburon.ai`.

### Dokploy (Planned Migration)
See `.opencode/skills/dokploy-deploy/SKILL.md` for full instructions. Deploy via:
- **Docker Compose**: Dokploy reads `docker-compose.dokploy.yml` from the repo
- **Application**: Single service using `Dockerfile`, health check `/api/health`

### Firebase Hosting (Static Frontend)
```bash
firebase deploy --only hosting
```
API routes are proxied through the Firebase function (`functions/src/index.ts`) to the VPS backend at `168.231.78.113:4200`.

### Functions (Node 20)
```bash
npm --prefix functions run build && firebase deploy --only functions
```

### Alternative Platforms
- **Vercel** — `vercel.json` (SPA rewrite, Vite build)
- **Render** — `render.yaml` (web service, health check `/api/health`)

---

## Environment Variables

| Variable | Required | Purpose |
|---|---|---|
| `GEMINI_API_KEY` | ✅ | Gemini Live API |
| `SUPABASE_URL` | ✅ | Supabase project URL |
| `SUPABASE_PUBLISHABLE_KEY` | ✅ | Supabase anon key |
| `VITE_FIREBASE_*` | ✅ | Firebase config (API key, auth domain, project ID, etc.) |
| `GOOGLE_CLIENT_ID` | ✅ | Google OAuth |
| `GOOGLE_CLIENT_SECRET` | ✅ | Google OAuth |
| `CEREBRAS_API_KEY` | ⬜ | Browser automation (Cerebras) |
| `OLLAMA_BASE_URL` | ⬜ | Local LLM proxy endpoint |
| `OPENCODE_PATH` | ⬜ | Sandbox sub-agent CLI path |
| `WHATSAPP_*` | ⬜ | WhatsApp Cloud API (optional alternative to Baileys) |

See `.env.example` for a complete template.

---

## CI / CD

`.github/workflows/android-distribution.yml` — On push to `main`:
1. Builds web app
2. Deploys to Firebase Hosting
3. Builds Android APK via Bubblewrap (Trusted Web Activity)
4. Uploads to Firebase App Distribution

---

## License

Private Project — Eburon AI / Beatrice

Built by [Eburon AI](https://eburon.ai) — founded by Jo Lernout.
