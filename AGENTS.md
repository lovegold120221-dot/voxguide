# AGENTS.md — Voxx-Zero (Beatrice)

## Stack

Vite 6 + React 19 + TS 5.8 + Express 4 + Firebase Auth + Supabase + Eburon Core + Baileys WhatsApp.
- **Root Node version:** 22
- **Functions Node version:** 20 (Firebase Cloud Functions)

## Entry Points

- **Frontend:** `index.html` → `src/main.tsx` → `src/App.tsx` (built via Vite, output to `dist/`)
- **Backend:** `server/index.ts` (port 4200, runs directly from source via `tsx`, no compilation step)
- **Firebase Functions:** `functions/src/index.ts` (proxies `/api/*` to the hardcoded VPS IP `168.231.78.113:4200`)

## Commands

| Task | Command | Notes |
|---|---|---|
| Full dev | `npm run dev:full` | Frontend :3000 + Backend :4200 (Runs via `&` shell backgrounding) |
| Frontend only | `npm run dev` | Vite dev server on :3000 |
| Backend only | `npm run dev:api` | Runs `server/index.ts` via `tsx` on :4200 (not watch mode) |
| Build | `npm run build` | Vite build → `dist/` (Required BEFORE docker build) |
| Lint | `npm run lint` | `tsc --noEmit` (~7-10 pre-existing errors in external types, do not fix) |
| Smoke test | `npm run smoke:whatsapp` | Checks `/api/health`, `/api/eburon/provider`, `/api/workspace/list/:userId` |
| Docker build | `npm run docker:whatsapp:build` | Builds production slim image (requires `dist/` pre-built) |
| Docker up | `npm run docker:whatsapp:up` | Starts container on :4200 in host networking mode |
| Docker down | `npm run docker:whatsapp:down` | Stops container |
| Supabase | `npm run db:start` / `db:stop` / `db:reset` / `db:migrate` | Local Supabase via CLI |
| Branding check | `npm run check:eburon-branding` | Scans codebase for banned provider strings |

## Architecture & Data Flow

- **Supabase** is the primary source of truth (messages, memories, settings).
- **`server/db/repositories/`** is the only database access layer (6 repositories).
- **`server/db/workspace-storage.ts`** is the EXCEPTION: workspace outputs (documents, screenshots) are stored directly on the local filesystem as JSON under `/data/workspace` (or `WORKSPACE_DATA_DIR`), NOT in Supabase.
- **Eburon Core** is the sole AI provider. All AI calls route through `server/eburon-provider.ts` which wraps `@google/genai`.
- **Google services** run client-side in `BeatriceAgent.tsx` via browser OAuth. WhatsApp and Belgian tools proxy through Express.
- **WhatsApp** uses `@whiskeysockets/baileys` in `server/whatsapp.ts`. Outbound tools require `delegated_send` permission + user approval. SSE stream at `GET /api/whatsapp/stream/:userId`.
- **No test framework** — manual verification only.

## Key Constraints & Obfuscation

- **Prohibited branding tokens:** The case-insensitive scan (`check:eburon-branding`) bans `gemini`, `google-genai`, `google generative`, `generative-ai` from all tracked source/config files except `AGENTS.md`, `CLAUDE.md`, and binary/artifact formats.
- **Model Obfuscation:** Inside codebase (e.g., `server/eburon-provider.ts`), upstream model IDs must be obfuscated using `String.fromCharCode` to pass build verification.
- **Rosetta Stone:** The gitignored **`LEGEND.md`** at the project root maps Eburon model aliases (e.g. `eburon_text`, `eburon_realtime_voice`) to their actual upstream IDs. Use it as reference.
- **HMR Control:** Disable HMR to stop browser flickering during AI edits by setting `DISABLE_HMR=true` (checked in `vite.config.ts`).
- **ESLint:** Only configured to check Firebase security rules (`.rules`), not application TypeScript code.

## Sub-Project Boundaries

- **Root Project:** Named `beatrice` in `package.json`. Houses React app + Express backend.
- **Functions:** Located in `/functions`, runs Node 20. Excluded from root `tsconfig.json`. Compile independently with `npm --prefix functions run build`.
- **OpenCode Agent:** Files in `.opencode/` are dedicated to the local agent/sub-agent runner configuration.

## Local Folder Connector + Terminal + OpenCode/Ollama

The user's machine exposes a daemon on `http://127.0.0.1:55420` (Node 22+ script at `public/beatrice-local-daemon.mjs`). The browser is exempt from mixed-content blocking for localhost so the agent talks to it directly.

### Two layers of access (do not confuse them)

1. **Browser File System Access API** — `window.showDirectoryPicker({ mode: 'readwrite' })` returns a `FileSystemDirectoryHandle`. Used for KB sync (`src/lib/localFolder.ts` + `src/components/FolderWatcher.tsx` + `src/lib/localFolderContext.tsx` + `src/components/LocalFolderPanel.tsx`). The handle does **NOT** expose the absolute macOS path.
2. **Local daemon** — closes the gap. It opens a NATIVE folder picker per OS, persists the absolute path, validates it, executes commands, and delegates to OpenCode/Ollama.

### Daemon endpoints (`public/beatrice-local-daemon.mjs`, v3+)

| Method | Path | Purpose |
|---|---|---|
| GET  | `/health` | liveness + platform |
| GET  | `/platform` | OS / home / tmpdir |
| POST | `/run` | scope-gated terminal; classifier pre-flight; returns `level` + `needsConfirmation` when gated |
| POST | `/select-folder` | native picker (AppleScript on mac, zenity/kdialog on linux, PowerShell FolderBrowserDialog on windows); returns `{ name, absolutePath, isDirectory, permissionScope }` |
| POST | `/validate-path` | accepts `{ path }`, returns `{ exists, isDirectory, absolutePath, size }` |
| GET  | `/tools/status` | full env: node / opencode / ollama / homebrew / git / pnpm / npm / curl / python3 / ollamaModels / primaryModel |
| POST | `/tools/install-opencode` | installs + configures OpenCode (primary = Ollama model, fallbacks = Zen free chain) |
| POST | `/tools/install-ollama` | installs + starts Ollama |
| POST | `/tools/pull-ollama-model` | pulls a model (`{ model }`) |
| POST | `/opencode/run` | delegated `opencode run "<engineered-prompt>"` (scope-gated + tool-availability pre-check) |
| GET  | `/permissions?userId=...` | read grant |
| POST | `/permissions/grant` | upsert grant; `approvedByUser` and `approvedAt` are always set by the daemon |
| POST | `/permissions/revoke` | revoke `selected_folder` / `whole_computer` / `all` |

Grants are stored at `~/.beatrice/permissions.json` keyed by userId.

### Permission model

```
type LocalPermissionGrant = {
  selectedFolderPath?: string | null;
  selectedFolderPath, selectedFolderTerminal, wholeComputerTerminal: boolean;
  approvedAt, expiresAt?: string;
  approvedByUser: true;
};
```

Levels: `none` < `selected_folder_readwrite` < `selected_folder_terminal` < `whole_computer_terminal`. Inside the approved folder, Beatrice can list/read/write/create/run npm/pnpm/git/test/build/etc. Through whole-computer approval, she can run commands anywhere — BUT the safety classifier still gates high-risk patterns.

### Safety classifier

Implemented side-by-side in:

- frontend: `src/lib/commandClassifier.ts` — for UX hints / pre-flight UI gates
- daemon: `public/beatrice-local-daemon.mjs` (`classifyCommand`) — the authoritative runtime gate

Four levels:

- `safe_readonly`      — `pwd ls tree cat head tail rg fd grep git status git log git diff git show node --version npm test pnpm test yarn test` — auto-run.
- `safe_project_write` — write inside approved scope — auto-run.
- `needs_confirmation` — the agent must ECHO a confirmation card to the user; on confirm, re-POST with `confirm: true`.
- `blocked`           — always refused (rm -rf /, fork bomb, chmod 777 /, mkfs, dd if=, etc.)

Named-needs-confirmation patterns include: `rm` (non-root), `sudo`, `chmod/chown -R`, `git push --force`, `git reset --hard`, `git clean -fdx`, `diskutil`, `docker system prune`, `terraform apply|destroy`, `kubectl delete`, `DROP DATABASE|TABLE`, `DELETE FROM` w/o WHERE, `curl | bash|sh|zsh`, `vercel --prod`, `railway up`, `fly deploy`, `gcloud run deploy`, AWS destructive. Plus paths: `~/.ssh`, keychains, `/Applications|/System|/Library`.

### OpenCode-as-webapp-arm (CRITICAL — ship full-stack apps, not static HTML)

When the user says "build me an app", "make a website with backend", "create a todo app with a database", etc., Beatrice must delegate to OpenCode as the executing arm. Static HTML/CSS/JS is **not acceptable** for app requests. The engineered prompt (`src/lib/opencodePrompts.ts`) asks OpenCode to:

- Inspect the repo, read README/AGENTS.md/package.json + entry points
- Scaffold a backend (Express | Hono | FastAPI | framework from stack hints) with at minimum `GET /api/health` plus CRUD endpoints
- Wire SQLite (better-sqlite3 / SQLAlchemy + SQLite) as a zero-config first target; design migrations so the schema can swap to Postgres later
- Wire the frontend to the backend with a Vite proxy or same-origin fetch
- Provide a single-command `npm run dev` (or compose) to run both
- Run the server, curl `/api/health`, and report the result so the user can verify "is this thing actually working?"

`engineerOpenCodePrompt(input)` composes the base prompt + the full-stack overlay when the user prompt mentions full-stack/app/server/backend/database/db/api/express/fastapi/django/etc.

### Related frontend wiring

- `src/lib/localTerminal.ts` — typed client (health, selectFolder, validatePath, runCommandInFolder, runOpenCodeTask, getToolsStatus, install/Pull, fetchGrant, grantPermission, revokePermission). Mirrors the daemon endpoints 1:1.
- `src/lib/opencodePrompts.ts` — prompt template + `engineerOpenCodePrompt` + `detectStack` (lightweight `package.json` snoop).
- `src/lib/commandClassifier.ts` — client mirror of the daemon's classifier, plus `redactSecrets` for stdout/stderr before display.
- `src/lib/localFolder.ts` (`setAbsolutePath`, `setTerminalGrant`) — IndexedDB persistence of the absolute path and grants via `kbSyncRegistry`.
- `src/lib/localFolderContext.tsx` — extended with `permissions`, `setAbsolutePath`, `grantTerminalScope`, `recallPermissions`.
- `src/components/LocalFolderPanel.tsx` — UI extension (see "UI section below").

### Skill packs (.opencode/skills/)

Beatrice ships two new external skill packs. Each is a single SKILL.md that
documents the workflow + an installer route the agent can dispatch from.

| Slug | Source | SKILL.md | Installer |
|---|---|---|---|
| `gstack`            | https://github.com/garrytan/gstack.git       | `.opencode/skills/gstack/SKILL.md`            | `POST /api/skills/install { slug: 'gstack' }` |
| `openmontage-video` | https://github.com/calesthio/OpenMontage.git | `.opencode/skills/openmontage-video/SKILL.md` | `POST /api/skills/install { slug: 'openmontage-video' }` |

Routes: `GET /api/skills/caps` (probe git/opencode/python3/ffmpeg/node),
`GET /api/skills/list` (audit the install root), `POST /api/skills/install`
(refresh-style clone, depth=1, tag=main). Slug allowlist is hardcoded in
`server/index.ts`; arbitrary URLs are rejected. The frontend client is
`src/lib/skillsInstaller.ts`.

`gstack` adds a 23-command specialist sprint workflow (Think → Plan → Build →
Review → Test → Ship → Reflect). Pair with `local_run_opencode_task` (the
`gstack` skill describes which slash command to lead with: `/office-hours`
for new products, `/review` for branch QA, `/qa <url>` for live browser QA,
`/cso` for security audit, `/investigate` for root-cause debugging, etc.).
OpenCode-native install via `git clone … ~/.config/opencode/skills/gstack &&
./setup --host opencode`.

`openmontage-video` adds an agentic video production pipeline (12 pipelines,
Remotion/HyperFrames rendering, free stock-footage corpus from Archive.org +
NASA + Wikimedia). Pair with `local_run_opencode_task`; the skill instructs
the agent to query the upstream capability envelope before asset generation
begins (cost ceiling defaults to $3.00 USD per brief).

### Suggested agent tools (declare in `googleTools` FunctionDeclaration array)

| Name | When to call |
|---|---|
| `local_connect_folder_with_terminal` | After user picks a folder; bridge to daemon to capture the absolute path (Option A: native picker via `/select-folder`; Option B: paste+`/validate-path`). |
| `local_run_terminal_in_connected_folder` | Run `{ command, cwd=connectedFolder, timeout, reason, scope:'selected_folder' }` after the daemon returns `ok: true`. Pre-flight with `classifyCommand`; re-send with `confirm:true` after ECHO gating. |
| `local_run_terminal_anywhere` | Same surface, `scope:'whole_computer'`. Requires `whole_computer_terminal` grant. |
| `local_run_opencode_task` | Delegate engineering to OpenCode. Inputs: `task`, `cwd`, `model`, `scope`, `permissionMode`. Use `engineerOpenCodePrompt` first. |
| `local_check_dev_tools` | GET `/tools/status`. Reply with a clean red/amber/green panel so the user can see Node / OpenCode / Ollama / model state at a glance. |
| `local_request_whole_computer_access` | "May I run commands anywhere on your machine?" — pair ECHO with a clear scope toggle. |
| `local_revoke_whole_computer_access` | POST `/permissions/revoke` with `scope: 'whole_computer'`. |


## Deployment Options

- **Docker (WhatsApp):** Production container on port 4200. Requires Vite output compiled (`npm run build`) beforehand as `dist/` is copied.
- **Dokploy:** Uses `docker-compose.dokploy.yml` on port 4200. Runs `tsx` directly from source (does not require pre-build).
- **Firebase Hosting:** SPA fallback is handled via `firebase.json` rewrites. All `/api/**` calls proxy to the Cloud Function, which in turn proxies to the VPS (`168.231.78.113:4200`).
