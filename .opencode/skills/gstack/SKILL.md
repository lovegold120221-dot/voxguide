# gstack — Specialist Sprint Workflow for OpenCode

Use this skill when the user wants the **full sprint lifecycle** when shipping a product:
Think → Plan → Build → Review → Test → Ship → Reflect.

`gstack` is an opinionated methodology that turns an AI coding assistant into a
virtual engineering team (CEO / Eng Manager / Designer / QA / Release Engineer).
It plugs natively into OpenCode via `--host opencode`. Twenty-three slash
commands, all Markdown, all free.

This skill activates the full `gstack` experience inside the local OpenCode
runner. Pair with `local_run_opencode_task` (see `.opencode/skills/site-cloning/SKILL.md`
for the executing arm). The recommended entry point for any new product is
`/office-hours` → `/autoplan` → `/ship`.

## When to use

Trigger this skill when the user message contains any of:

- "build me a …" / "ship me a …" (full product, not a one-off script)
- "review my changes", "QA this branch", "ship this PR"
- "do a security audit on this repo"
- "give me a CEO review of this design doc"
- "plan before building", "redo the architecture review"
- "open office hours", "what am I actually building"
- Any reference to `/office-hours`, `/plan-ceo-review`, `/review`, `/qa`,
  `/ship`, `/cso`, `/investigate`, `/design-shotgun`, `/design-html`, `/retro`,
  `/autoplan`, `/connect-chrome`, `/browse`, `/careful`, `/freeze`, `/guard`

Do **not** trigger for:

- One-off code snippets ("write me a function that sorts")
- Pure research questions ("how does X work")
- Code reviews that aren't part of a larger sprint

## Inputs

```jsonc
{
  "intent":     "ship a daily briefing app for my calendar",
  "command":    "/office-hours",        // the gstack slash command to lead with
  "cwd":        "/abs/path/to/repo",    // repo / project root
  "userId":     "<firebase uid>",
  "scope":      "selected_folder" | "whole_computer",
  "model":      "<local-stack-model-id, see src/lib/eburon-provider.ts for the canonical alias>",
  "permissionMode": "auto" | "ask"
}
```

When the user asks for a full sprint end-to-end, omit `command` and let the
agent sequence through `/office-hours → /autoplan → /plan-eng-review → build →
/review → /qa → /ship`. When the user asks for ONE step (e.g. "review my
branch"), pass that single `command`.

## Install (one-shot)

`gstack` is not vendored — it's cloned from upstream on first use. The skill
instructs OpenCode to run:

```bash
# Clone the upstream skill pack (shallow)
git clone --single-branch --depth 1 \
  https://github.com/garrytan/gstack.git \
  ~/.config/opencode/skills/gstack

# Configure it for OpenCode target
cd ~/.config/opencode/skills/gstack && ./setup --host opencode
```

`./setup` writes skill files into `~/.config/opencode/skills/gstack-*/` and
registers them so the CLI sub-agent can dispatch them like native
OpenCode-native skills (`/office-hours`, `/plan-ceo-review`, `/review`, etc.).

If `git` is missing or `~/.config/opencode/` is not writable, the install
fails fast — surface the error to the parent. Do not improvise the install
location.

### Re-install / upgrade

```bash
cd ~/.config/opencode/skills/gstack && ./setup --team && ./gstack-upgrade
```

`./gstack-upgrade` is provided by the skill pack itself; it pulls the
latest commits from upstream and refreshes the local skill files. Re-run if
upstream ships new commands the user wants.

### Team mode (optional)

For shared repos, run `./setup --team` once after `cd`. It bootstraps a
`.claude/CLAUDE.md` shim so teammates loading the project pull gstack
automatically. Skip if `cwd` is not a git repo or the user wants solo use.

## Workflow ordering

Sequential. Skipping steps loses context; the downstream skills expect the
upstream artifact (design doc, plan, branch) to exist.

| # | Slash command     | Specialist role     | Output (feeds next step) |
|---|---|---|---|
| 1 | `/office-hours`   | YC Office Hours     | design doc (`docs/plan/`) |
| 2 | `/plan-ceo-review`| CEO / Founder       | approved scope + approach |
| 3 | `/plan-eng-review`| Eng Manager         | locked architecture + test plan |
| 4 | `/plan-design-review` | Senior Designer  | design scores + AI-slop fixes |
| 5 | `/plan-devex-review`  | DX Lead          | DX plan (TTHW benchmarks) |
| 6 | (optional) `/design-shotgun` | Design Explorer | 4–6 mock variants in browser |
| 7 | (optional) `/design-html`   | Design Engineer | production HTML from chosen mock |
| 8 | `/autoplan`       | Release Manager     | ordered build tasks |
| 9 | `/build`          | (implicit)          | implementation across files |
|10 | `/review`         | Staff Engineer      | bugs fixed; completeness gaps flagged |
|11 | `/qa <url>`       | QA Lead             | real-browser walk-through + bugs |
|12 | `/ship`           | Release Engineer    | PR created + tests green |
|13 | `/retro`          | Eng retrospective   | week summary + learnings |

Sub-tracks you may invoke standalone:

| Domain        | Slash command(s) |
|---|---|
| Security audit | `/cso` (OWASP + STRIDE) |
| Root-cause debugging | `/investigate` (iron law: no fixes without investigation) |
| Live QA only | `/qa-only <url>` |
| Browser access for the agent | `/connect-chrome`, `/browse` |
| Headless browser session setup | `/setup-browser-cookies` |
| Deploy + canary helpers | `/land-and-deploy`, `/canary`, `/setup-deploy` |
| Doc authoring | `/document-release`, `/document-generate` |
| Integration scaffolding | `/codex`, `/setup-gbrain` |
| DX audit (live) | `/devex-review` |
| Freezes / guardrails | `/careful`, `/freeze`, `/guard`, `/unfreeze` |
| Meta | `/gstack-upgrade`, `/learn` |

## What the parent (BeatriceAgent) does

1. Read the user prompt; if it matches any trigger above, plan: is this a
   one-step request (single slash command) or a full sprint?
2. For **full sprints**: ECHO a confirmation card summarising the steps
   before `/office-hours` kicks off. Be explicit — this writes hundreds of
   lines and edits the working tree.
3. For **one-step requests** (e.g. `/review`, `/qa`, `/cso`): no card needed;
   just dispatch through `local_run_opencode_task`.
4. Always pass `cwd`, `userId`, `scope`, and the engineered slash command line.
5. After completion, surface the agent's summary + emit a `triggerSandboxShowcase`
   so the changes land in `DocumentViewer`.

## Worked example (full sprint, single button)

User says: *"Beatrice, I want to ship a daily briefing app for my calendar."*

1. ECHO: "I'll run a gstack sprint with 7 steps. It'll take a few minutes.
   Want me to start?" (50% confidence — full sprint)
2. After confirmation, dispatch:

```bash
cd "$cwd" && opencode run "$(cat <<'EOF'
Run gstack full-sprint on this project:

1. /office-hours — "Daily briefing app for my calendar"
2. /plan-ceo-review — feed the design doc from step 1
3. /plan-eng-review — feed the CEO-approved scope
4. /autoplan — produce ordered build tasks
5. Build all tasks in the plan (small correct diffs, no secrets in files)
6. /review — auto-fix obvious bugs, ASK on race-condition class issues
7. /qa http://localhost:3000 — open real browser, click through the briefing flow
8. /ship — open a PR, ensure tests are green

Constraints:
- Stack hints: see package.json / AGENTS.md / README.md
- Use the local stack model (see src/lib/eburon-provider.ts for canonical aliases) for build steps
- Always run `npm test` before /ship and fix any failing tests
- Never commit secrets, never push force, never delete the working tree
EOF
)"
```

3. Stream progress to `DocumentViewer` via the existing sandbox log pattern.
4. When the agent returns `summary` + `git diff --stat`, surface it to the user
   and present the running local preview URL.

## Worked example (one step: QA only)

User says: *"Beatrice, QA this staging URL: https://myapp-staging.fly.dev"*

```bash
cd "$cwd" && opencode run "/qa https://myapp-staging.fly.dev"
```

No confirmation card needed — single-step is one-tool. Return the QA findings
verbatim.

## Safety / quality gates

- **Never push force, never reset --hard, never clean -fdx.** The skill pack
  ships with its own freeze/guard rails; respect them.
- **Never commit secrets.** The redaction layer in `src/lib/commandClassifier.ts`
  applies to stdout/stderr only; the agent must NOT inline secrets in code.
- **Always run lints + tests before /review and /ship.** If tests fail, the
  skill should surface the failures instead of "shipping anyway".
- **Schema migrations live in their own files.** If the plan produces a schema
  change, demand a migration script and a rollback note.
- **Confirmations for write-spree commands.** Cheap commands (read-only,
  install, test) auto-run. Anything that touches `git`, the filesystem, or
  deploys waits for an ECHO card.

## Backend surface

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/skills/install` | POST | One-shot clone + register under `~/.config/opencode/skills/<slug>/` |
| `/api/skills/list`    | GET  | List locally installed skill packs |
| `/api/skills/caps`    | GET  | Check git, `opencode`, model state before dispatch |
| `/opencode/run`       | POST | Run an OpenCode worker task; this skill dispatches through it |

The frontend client is `src/lib/skillsInstaller.ts`. The agent tool
`local_run_opencode_task` (declared in `src/components/BeatriceAgent.tsx`
`googleTools`) is the entry point for invoking a single slash command or a
full-sprint dispatch. Local daemon: `public/beatrice-local-daemon.mjs`,
endpoint `/opencode/run`; backend: `server/index.ts`
`POST /api/terminal/open-skills` and `POST /api/sandbox/run`.

## Companion files

- `.opencode/skills/open-sites-pwa/SKILL.md` — sibling skill (URL cloning)
- `.opencode/skills/site-cloning/SKILL.md` — sibling skill (clone + rebrand)
- `.opencode/skills/dokploy-deploy/SKILL.md` — sibling skill (deploy target)
- `.opencode/skills/openmontage-video/SKILL.md` — sibling skill (video production)
- `src/lib/opencodePrompts.ts` — prompt template + `engineerOpenCodePrompt`
- `src/lib/commandClassifier.ts` — safety classifier mirrored from the daemon
- `src/lib/skillsInstaller.ts` — typed client for `/api/skills/*`
- `public/beatrice-local-daemon.mjs` — local OpenCode runner
- `knowledge.md`, `README.md`, `AGENTS.md` — end-user docs
