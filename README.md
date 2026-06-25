# Beatrice — AI Voice Agent by Eburon AI

**Beatrice** is a real-time voice AI agent powered by the **Eburon Live API** with WhatsApp integration, multi-language support, persistent memory, unlimited document generation, Google Drive sync, sandbox sub-agent, Cerebras browser automation, and 10 specialized Belgian administrative tools. Built by [Eburon AI](https://eburon.ai).

<p align="center">
  <a href="https://whatsapp.eburon.ai">
    <img src="https://img.shields.io/badge/Live%20App-whatsapp.eburon.ai-8A2BE2?style=for-the-badge" alt="Live App">
  </a>
  <a href="https://github.com/lovegold120221-dot/voice-zero">
    <img src="https://img.shields.io/badge/GitHub-voice--zero-181717?style=for-the-badge&logo=github" alt="GitHub">
  </a>
</p>

---

## Architecture

```
Frontend (React 19 + Vite)
  ├─ Voice Pipeline (PCM16 WebSocket via AudioWorklet)
  ├─ Chat Page (Eburon PC Sandbox)
  ├─ WhatsApp Pairing / Chat List / Media Cache
  ├─ Profile / Settings / Theme (Dark + Light)
  ├─ Document Viewer (live sandbox log scenarios)
  ├─ Workspace (IndexedDB + Google Drive sync)
  └─ PWA (install prompt, versioned updates)

Backend (Express + tsx)
  ├─ Baileys WhatsApp Manager (server/whatsapp.ts)
  ├─ Belgian Admin Tools (server/belgian-tools.ts)
  ├─ Sandbox Sub-Agent Runner (OpenCode CLI, 21+ skills)
  ├─ Cerebras Browser Automation
  ├─ Ollama LLM Proxy (SSE streaming)
  ├─ Workspace API (filesystem JSON persistence)
  ├─ WhatsApp Media Cache (disk + CDN fallback)
  ├─ Audio Transcription (Eburon API)
  └─ Web Glance (DuckDuckGo)

AI Layer
  └─ Eburon Voice (Live API — text, vision, realtime voice)

Data Layer
  ├─ Supabase (PostgreSQL — memories, messages, settings, media)
  ├─ Firebase Auth (Google OAuth)
  ├─ IndexedDB (local workspace — primary store)
  ├─ Google Drive (cloud workspace sync — Beatrice_Workspace folder)
  └─ Filesystem workspace JSON (server-side backup)
```

### Stack

| Layer | Technology |
|---|---|
| **Frontend** | React 19, Vite 6, Tailwind CSS v4, motion (Framer Motion), lucide-react |
| **Backend** | Express 4, tsx runtime, Node 22+ |
| **AI Voice** | Eburon Voice (Live API) |
| **AI Text** | Eburon Core, Eburon Sandbox, Eburon Coder Pro, Eburon Worker |
| **Auth** | Firebase Auth (Google OAuth) |
| **Database** | Supabase (PostgreSQL + Storage) |
| **WhatsApp** | Baileys (`@whiskeysockets/baileys`) |
| **Browser Agent** | Browser-Use + Cerebras inference |
| **Sub-Agent** | OpenCode CLI (deepseek-v4-flash-free, 21+ skills) |
| **Hosting** | Ubuntu VPS + Docker Compose + NGINX (5 domains) |

---

## Features

- **Real-Time Voice** — Low-latency PCM16 bidirectional audio via WebSocket with AudioWorkletNode (no ScriptProcessor), VAD, interruption handling, 5 voice profiles
- **WhatsApp Integration** — Baileys-based pairing (QR/OTP), full history sync, media caching to disk, audio transcription, auto Belgian phone normalization, SSE real-time streaming. **Always resyncs history before any operation**
- **Unlimited Document Generator** — ANY document type (contracts, reports, invoices, proposals, dashboards, presentations, policies, plans, analyses, forms, certificates). No template limits. CEO/presentation-grade output always — never placeholder text
- **Google Drive Sync** — All generated outputs (documents, websites, apps) automatically uploaded to a `Beatrice_Workspace` folder on Google Drive
- **Proactive Memory** — Beatrice automatically saves user preferences, facts, deadlines, and personal info via `add_to_memory`. Memories persist across sessions and are pre-loaded at session start
- **Adjustable Context** — Conversation history slider (0–100 messages) controls how much past context Beatrice uses
- **Sandbox Sub-Agent** — Delegate complex tasks to a cascading AI pipeline (Eburon Sandbox → Multimodal Pro → Cerebras → Coder Pro → Worker)
- **Local Filesystem Access** — Beatrice can browse, read, and write files on the user's local computer via the browser File System Access API (`showDirectoryPicker`). Supports listing directories, reading text files, and writing/creating files in user-selected folders. Chrome/Edge only.
- **OpenCode CLI Agent** — Full repository access via OpenCode CLI: read/write files, run commands, build apps, deploy via Dokploy. 21+ installed skills (Flutter, video production, browser automation, YouTube, TikTok, web scraping, machine access)
- **Cerebras Browser Agent** — Automated web browsing via Browser-Use + Cerebras inference
- **10 Belgian Admin Tools** — KBO/CBE lookup, VIES VAT validation, Peppol e-invoicing, tax calendar, registration tax calc, itsme navigator, language bridge (FR/NL/EN), social security navigator, labor law simplifier, mobility planner (NMBS/SNCB)
- **Multi-Language** — 147 languages, Flemish (nl-BE) primary, voice-driven language switching
- **Live Sandbox Log Viewer** — Progressive log scenarios (terminal, sandbox, browser, document, website) shown in DocumentViewer while tools run
- **Unified Skills Catalog** — Beatrice categorizes all tools into 10 skill groups with trigger-based routing, speaks naturally before long tasks, never leaves dead silence
- **Full Dark + Light Themes** — CSS custom properties, 70+ override rules
- **Content Filtering Toggle** — Disable censorship via Profile settings
- **Progressive Web App** — Full PWA with offline support, install banner, update detection with version tracking

### Workspace System
Every output Beatrice produces is automatically saved:

| Output Type | IndexedDB | Server JSON | Google Drive |
|---|---|---|---|
| Documents (create_document) | ✅ | ✅ | ✅ (redirect HTML) |
| Websites (generate_website) | ✅ | ✅ | ✅ (redirect HTML) |
| Apps (open_terminal_skills) | ✅ | ✅ | ✅ (redirect HTML) |
| Screen captures | ✅ | ✅ | ❌ |
| Images | ✅ | ✅ | ✅ (binary) |

---

## Quick Start

### One-Paste Install (Freshly Formatted Machine)
Works on macOS, Debian, Ubuntu, and Windows. Installs Node.js 22, Python 3.11, Chromium, Git, all dependencies, and runs the app.

**macOS / Debian / Ubuntu:**
```bash
curl -fsSL https://raw.githubusercontent.com/lovegold120221-dot/voice-zero/main/bootstrap.sh | bash
```

**Windows (PowerShell as Administrator):**
```powershell
irm https://raw.githubusercontent.com/lovegold120221-dot/voice-zero/main/install.ps1 | iex
```

The app runs at `http://localhost:4200`.

### Prerequisites (Manual Install)
- Node.js 22+
- Python 3.11+ with pip and venv
- Chromium or Chrome (for Playwright/browser-use)
- Git
- An Eburon Core API key
- A Supabase project
- A Firebase project (for auth)

### Local Development
```bash
git clone https://github.com/lovegold120221-dot/voice-zero.git
cd voice-zero
npm install

cp .env.example .env
# Add your API keys: EBURON_CORE_KEY, SUPABASE_*, FIREBASE_*

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
│   ├── BeatriceAgent.tsx       # Main agent: voice, tools, session lifecycle, system prompt
│   ├── ChatPage.tsx            # Text chat with sandbox viewer
│   ├── VideoPage.tsx           # Camera + screen sharing
│   ├── ProfilePage.tsx         # Persona, language, memory, workspace settings
│   ├── AuthPage.tsx            # Login / register
│   ├── WhatsApp*.tsx           # Pairing, onboarding, settings, chat list
│   ├── PWAInstallPrompt.tsx    # PWA install banner
│   ├── PWAUpdatePrompt.tsx     # PWA update banner
│   ├── DocumentViewer.tsx      # Sandbox log viewer + artifact display
│   └── ...
├── hooks/
│   └── usePWA.ts               # PWA lifecycle hook (install/update/version)
├── lib/
│   ├── audio.ts                # AudioStreamer + AudioRecorder (AudioWorkletNode)
│   ├── supabase.ts             # Supabase client
│   ├── workspace.ts            # IndexedDB workspace + Google Drive upload
│   └── whatsappClient.ts       # WhatsApp API client
├── version.ts                  # App versioning (VERSION_KEY, APP_VERSION)
├── constants.ts                # 147-language LANGUAGES array
├── firebase.ts                 # Firebase init
└── index.css                   # Tailwind v4 + theme system

server/
├── index.ts                    # Express: all API routes (workspace, media, terminal, sandbox)
├── whatsapp.ts                 # WhatsAppManager (Baileys) with media cache
├── whatsapp-tools.ts           # Permission-gated tool dispatch
├── belgian-tools.ts            # 10 Belgian admin tools
├── file-extractor.ts           # File content extraction (documents, images, media)
├── db/
│   ├── workspace-storage.ts    # Filesystem workspace persistence
│   └── repositories/           # 6 DB repos (memories, messages, whatsapp, media, settings, eburon)
└── supabase.ts                 # Server Supabase client

functions/src/index.ts          # Firebase Cloud Function proxy to VPS (168.231.78.113:4200)
scripts/
├── cerebras_browser.py         # Browser-Use + Cerebras wrapper
└── setup-cerebras.sh           # Python dep installer

public/
├── manifest.json               # PWA manifest
├── sw.js                       # Service worker (versioned caching, update detection)
├── icon-eburon.svg             # App icon
└── *-template.html             # Legacy document templates (deprecated — sandbox generates directly)
```

---

## Skills Catalog

Beatrice organizes her capabilities into 10 skill categories, each with natural trigger phrases:

| Skill | Triggers |
|---|---|
| **Communication** | "send", "message", "WhatsApp", "chat with" |
| **Google Workspace** | "email", "calendar", "drive", "task", "YouTube" |
| **Belgian Admin** | "company", "VAT", "invoice", "tax", "itsme", "NMBS" |
| **Memory** | "remember", "save this", "do you remember" |
| **Media Understanding** | "look at this image", "read this page", "transcribe" |
| **WhatsApp Attachments** | file/image/document/voice note in WhatsApp |
| **Deep Research** | "analyze", "research", "draft a report", "investigate" |
| **App Building & Coding** | "build me an app", "create a website", "use OpenCode" |
| **Web Browsing** | "go to this website", "scrape", "fill form" |
| **Document Creation** | "create a document", "draft a letter", "make a proposal" |

OpenCode CLI agent has 21+ installed skills: ai-video-cinema, ai-video-generation, ai-video-production, browser-act, flutter-dev, himalaya, machine-access, macbook, mobile-pwa-design, google-search-serp, youtube-search, youtube-transcript, tiktok-contents, web-page-marker, open-search-code-lm, gmail-accounts, browser-act-skill-forge, dokploy-deploy, eburon-meeting-app, epi-knowledge, and appinsights-instrumentation.

---

## PWA System

Beatrice is a fully installable Progressive Web App with smart version management:

- **Install Prompt** — On first visit (or if not installed), a polished install banner appears at the bottom of the screen
- **Update Detection** — When already installed, the service worker checks its version against `APP_VERSION` (from `src/version.ts`). If a newer version exists, an "Update Available" banner prompts the user to refresh
- **Version Tracking** — After successful install, the version is stored in `localStorage` at `beatrice_app_version`. Subsequent visits compare this against the current `APP_VERSION`
- **Cache Management** — The service worker registers at `/sw.js` and caches all static assets with version-aware cache names

### Versioning
The app version is maintained in `src/version.ts`:
```ts
export const APP_VERSION = '1.0.0';  // Bump on every deploy
export const APP_BUILD = 1;           // Incremental build number
```
To push a new version to all installed users, bump `APP_VERSION` and rebuild.

---

## Deployment

### VPS (Production — Current)
```bash
npm run build                      # Pre-build frontend (required)
docker compose -f docker-compose.whatsapp.yml up -d --build
```
Docker container on port 4200 behind NGINX reverse proxy with Let's Encrypt. Production URL: `https://whatsapp.eburon.ai`.

### Docker Compose
```bash
# Build and start
docker compose -f docker-compose.whatsapp.yml up -d --build

# Stop
docker compose -f docker-compose.whatsapp.yml down
```

### Dokploy (Alternative)
See `.opencode/skills/dokploy-deploy/SKILL.md`. Deploy via:
- **Docker Compose**: Dokploy reads `docker-compose.dokploy.yml` from the repo
- **Application**: Single service using `Dockerfile`, health check `/api/health`
Note: Dokploy's Traefik needs ports 80/443 (currently used by NGINX). Not recommended unless you migrate all 5 NGINX domains into Dokploy's ingress.

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
| `EBURON_CORE_KEY` | ✅ | Eburon Live API |
| `SUPABASE_URL` | ✅ | Supabase project URL |
| `SUPABASE_PUBLISHABLE_KEY` | ✅ | Supabase anon key |
| `VITE_FIREBASE_*` | ✅ | Firebase config (API key, auth domain, project ID, etc.) |
| `GOOGLE_CLIENT_ID` | ✅ | Google OAuth |
| `GOOGLE_CLIENT_SECRET` | ✅ | Google OAuth |
| `CEREBRAS_API_KEY` | ⬜ | Browser automation (Cerebras) |
| `OLLAMA_BASE_URL` | ⬜ | Local LLM proxy endpoint |
| `OPENCODE_PATH` | ⬜ | Sandbox sub-agent CLI path |
| `WHATSAPP_*` | ⬜ | WhatsApp Cloud API (optional alternative to Baileys) |
| `WORKSPACE_DATA_DIR` | ⬜ | Workspace filesystem path (default `/data/workspace`) |
| `BEATRICE_WORKSPACE_DIR` | ⬜ | App workspace path (default `/data/beatrice-workspace`) |

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
