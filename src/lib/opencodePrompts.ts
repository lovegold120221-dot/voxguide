// src/lib/opencodePrompts.ts
//
// Prompt engineering layer for the opencode-run command. The agent
// composes user_request + cwd + scope + permission_mode into a single
// detailed prompt before sending to /opencode/run. The system policy is
// embedded as non-negotiable invariants; the user request is appended at
// the bottom.

export type OpenCodeScope = 'selected_folder' | 'whole_computer';
export type OpenCodePermissionMode =
  | 'ask'                    // ask before each high-risk action
  | 'auto_selected_folder'   // safe inside approved folder
  | 'whole_computer_approved';

export interface OpenCodePromptInput {
  userRequest: string;
  cwd: string;
  scope: OpenCodeScope;
  permissionMode: OpenCodePermissionMode;
  /** Optional stack hints derived from inspecting the folder. */
  stackHints?: {
    language?: string;       // ts, python, go, rust ...
    framework?: string;      // next.js, vite, fastapi ...
    packageManager?: string; // npm, pnpm, yarn, pip, cargo ...
    testCommand?: string;    // npm test, pnpm test ...
    lintCommand?: string;    // npm run lint
    buildCommand?: string;   // npm run build
  };
  /** Free-form extra context (memory, persona, recent chat, etc.). */
  extras?: string[];
}

const BASE_PROMPT = `You are OpenCode running locally on the user's machine. You are an engineer — not a chatbot. Make the smallest correct change that solves the request.

Working directory:
{{cwd}}

You MUST:
1. Inspect the repository first. Read README, AGENTS.md, package.json (or equivalent), config files, and source entry points.
2. Identify the project stack and existing commands (build / test / lint / dev). Reuse them rather than inventing new tooling.
3. Make the smallest correct change. Do not modify unrelated files. Do not refactor for aesthetics.
4. Do not delete user data. Do not touch files outside the approved scope unless explicitly instructed.
5. Run the project's existing tests / typecheck / lint / build commands if available and report the results.
6. Summarize changed files precisely: full path + a one-line diff explanation per file.
7. Stop and ASK before any of: destructive git (reset --hard, clean -fdx, push --force), database mutations, deploy / cloud / kubectl / docker system prune, reading or copying secrets, sudo, touching ~/.ssh or keychains, touching /System / /Library / /Applications, browser profile paths, or system folders.
8. Never exfiltrate credentials. Never print API keys, tokens, .env values, or keychain entries.
9. Use git diff before/after to highlight what you actually changed.
10. When blocked by permissions, explain EXACTLY which approval is needed so the user can grant it.

Approved scope:
{{scope}}

Permission mode:
{{permission_mode}}

{{stack_context}}

User request:
{{user_request}}

{{extras}}

Output format (mandatory):
- changed_files: list [{ path, one_line_summary }]
- commands_run: list [{ command, exit_code, summary }]
- verification: test/lint/build status
- next_steps: ordered list of what to do next OR what approval is needed
`;

// ───────────────────────────────────────────────────────────────────
// PRODUCTION-READINESS OVERLAY
// ───────────────────────────────────────────────────────────────────
// Appended for any "build me an X", "make me a Y", "create Z", "fix /
// make production-ready", or any task where the user expects a runnable,
// deployable artifact. Forces OpenCode to ship code that ACTUALLY works:
// installs dependencies, typechecks, runs tests, builds, and (for
// services) starts the server and verifies the health endpoint.
const PRODUCTION_READINESS_OVERLAY = `
PRODUCTION-READINESS INVARIANTS — NON-NEGOTIABLE.
You are shipping production code, not a sketch. After your edits you MUST satisfy each of the following or you DO NOT claim completion:

1. DEPENDENCIES: run the project's actual install command (npm install / pnpm install / pip install -r requirements.txt / cargo build) and confirm it exits 0. Update lockfiles. Never leave TODO comments for "install later".
2. STATIC CHECKS: run the project's lint and typecheck commands (npm run lint, tsc --noEmit, ruff check, eslint .) and report the result. Fix every error before declaring done.
3. TESTS: run the project's tests (npm test, pytest, cargo test) and report pass/fail. If the project has no tests, add at least one smoke test for the core path so the next change doesn't break it silently.
4. BUILD: run the project's build (npm run build, pnpm build, next build, vite build) and confirm it exits 0. Capture the output size / build time.
5. SERVER VALIDATION (services only): start the server in the background, curl the health endpoint (e.g. \`curl -sS http://127.0.0.1:<port>/api/health\`), and verify HTTP 200 with a non-empty JSON body. Report the actual response in your output. Tear it down after verification.
6. ZERO PLACEHOLDERS: do not ship \`TODO\`, \`FIXME\`, \`Lorem ipsum\`, fake data, hardcoded \`test@test.com\`, or empty-state stubs that look like a placeholder. Wire real (or sensibly-demo) values end-to-end.
7. ENV VARS / SECRETS: every external dependency the server needs at runtime must be documented in a README section ("Required environment variables") and loaded via \`process.env\`, \`os.environ\`, or a config module — never hardcoded.
8. ERROR PATHS: every API endpoint has explicit error handling (4xx/5xx with a JSON body) and input validation. Never silently swallow exceptions.
9. README: the project has a README section that explains: how to install, how to run dev, how to run tests, the production endpoints, and the env vars.
10. GIT DIFF: report \`git diff --stat\` after your edits so the user can see what you actually changed.

If ANY of the above fails, you stop, explain why, and propose the smallest fix. Do not mark the task complete with a known-failing invariant.
`;

function renderTemplate(input: OpenCodePromptInput): string {
  const stack = input.stackHints;
  const stackContext = stack
    ? `\nDetected project stack:\n${[
        stack.language ? ` - Language: ${stack.language}` : null,
        stack.framework ? ` - Framework: ${stack.framework}` : null,
        stack.packageManager ? ` - Package manager: ${stack.packageManager}` : null,
        stack.testCommand ? ` - Test command: ${stack.testCommand}` : null,
        stack.lintCommand ? ` - Lint command: ${stack.lintCommand}` : null,
        stack.buildCommand ? ` - Build command: ${stack.buildCommand}` : null,
      ].filter(Boolean).join('\n')}\n`
    : '';

  const extras = input.extras && input.extras.length
    ? `Additional context:\n${input.extras.map(e => `- ${e}`).join('\n')}\n`
    : '';

  return BASE_PROMPT
    .replace('{{cwd}}', input.cwd)
    .replace('{{scope}}', input.scope)
    .replace('{{permission_mode}}', input.permissionMode)
    .replace('{{stack_context}}', stackContext)
    .replace('{{user_request}}', input.userRequest)
    .replace('{{extras}}', extras);
}

// ───────────────────────────────────────────────────────────────────
// FULL-STACK OVERLAY (only for webapp/app requests)
// ───────────────────────────────────────────────────────────────────
// Teaches OpenCode to ship a *functional* full-stack app (real backend +
// real DB), not a static HTML page.
const FULL_STACK_OVERLAY = `
If the user asked for a "real" / full-stack app (backend + database, not just static HTML/CSS/JS):
1. Scaffold a backend (Node/Express, Hono, Python/FastAPI, or framework implied by stack hints) that exposes at minimum: GET /api/health, plus CRUD endpoints for the domain.
2. Use SQLite (better-sqlite3 / sqlite3 / SQLAlchemy + SQLite) as a zero-config first-target; design migrations so the schema can be swapped for Postgres later.
3. Wire the frontend to the backend (fetch + same-origin during dev, or a tiny Vite proxy).
4. Provide a single command to run both (e.g. "npm run dev" concurrently, or a docker-compose snippet).
5. Document the API endpoints in a README section so the user can verify "is this thing actually working?".
6. Run the actual server, curl /api/health, and report the response. Do not ship a static HTML file and call it an app.
`;

// ───────────────────────────────────────────────────────────────────
// SITE-CLONING / REBRAND OVERLAY
// ───────────────────────────────────────────────────────────────────
// Activated when the user asks to clone a URL and rebrand it (color,
// palette, name, logo, copy). OpenCode rewrites assets in the cloned
// dir while preserving functional HTML, navigation, forms, and links.
const SITE_CLONING_REBRAND_OVERLAY = `
SITE-CLONING / REBRAND TASK — EXTRA RULES.
The working directory contains an already-cloned website (mirrored via wget --mirror --convert-links). You must rebrand assets in place while keeping the site functional.

1. SCAN: run \`find . -type f -name '*.html' -o -name '*.css' -o -name '*.scss' -o -name '*.js' -o -name '*.svg'\` (or equivalent) to inventory the cloned files. Do not touch binary assets outside that set.
2. METADATA: rewrite <title>, <meta name="description">, <meta property="og:*">, <link rel="icon">, and the <html lang> attribute to match the brand spec.
3. PALETTE: locate the dominant color tokens. If the site uses CSS custom properties (--primary, --accent, etc.) rewrite those values first. Otherwise replace hardcoded hex/rgb values that match the original brand. Replace ONE primary color across all rules, ONE accent across all rules.
4. TYPOGRAPHY: when the brand spec lists a font, swap \`font-family\` declarations. Prefer Google Fonts if the cloned site already loads them. Otherwise embed a <link rel="stylesheet"> for the requested family.
5. LOGO: when brand.logoUrl is provided, replace <img> logo tags whose alt mentions the original brand. When brand.logoText is provided, replace the logo with text styled to match the original logo's layout and dimensions.
6. COPY: replace hero headlines, taglines, and CTAs. Do not rewrite all body copy — preserve the original message. Only transform strings that match the brand spec exactly.
7. STRUCTURE: do NOT delete pages, navigation items, or working JavaScript. The site must continue to navigate, submit forms, and load assets correctly.
8. ASSETS: images stay at their original paths. If the user supplies a replacement logo URL, download it into \`assets/brand-logo.{ext}\` and update references.
9. VALIDATION: after rebrand, start a tiny local HTTP server (python3 -m http.server 8000) and curl every page under \`/\`, \`/about\`, \`/pricing\`, etc. (whatever exists). Confirm 200 responses and that <title> + primary color changed.
10. CLEANUP: remove the local server. Report changed files precisely.
`;

export type OverlayKind = 'production_ready' | 'full_stack' | 'site_cloning_rebrand';

/**
 * Engineer the prompt that goes to `opencode run`. Wraps the base template
 * with overlays chosen by `overlays` (default = all of them; callers can
 * opt out of specific overlays by passing an explicit subset or empty array).
 */
export function engineerOpenCodePrompt(input: OpenCodePromptInput, overlays: OverlayKind[] = ['production_ready']): string {
  let base = renderTemplate(input);

  // Production readiness always wins — even for small "fix this typo" tasks
  // we don't want a half-finished change.
  if (overlays.includes('production_ready')) {
    base += '\n' + PRODUCTION_READINESS_OVERLAY;
  }

  // Full-stack overlay only when the user mentions app/server/DB/backend etc.
  if (overlays.includes('full_stack')) {
    const wantsFullStack =
      /\b(app|webapp|web app|full[\s-]?stack|backend|api|server|database|db|sql|postgres|mysql|sqlite|express|fastapi|hono|flask|django|next\.?js|remix|sveltekit)\b/i.test(input.userRequest);
    if (wantsFullStack) {
      base += '\n' + FULL_STACK_OVERLAY;
    }
  }

  // Site-cloning / rebrand overlay — active when the user prompt
  // references cloning, mirroring, rebranding, OR when stackHints indicate
  // a URL clone environment (the cloned dir has many HTML files).
  if (overlays.includes('site_cloning_rebrand')) {
    const wantsClone = /\b(clone|mirror|rebrand|re-skin|reskin|white[\s-]?label|rebrand|rebuild this site|replicate|rebrand)\b/i.test(input.userRequest);
    if (wantsClone) {
      base += '\n' + SITE_CLONING_REBRAND_OVERLAY;
    }
  }

  return base;
}

/**
 * Stack detector — lightweight regex sniff over the cwd to populate
 * OpenCodePromptInput.stackHints. Intentionally conservative: only
 * populates fields where confidence is high.
 */
export async function detectStack(cwd: string, fs: {
  exists: (p: string) => Promise<boolean>;
  read: (p: string) => Promise<string | null>;
}): Promise<OpenCodePromptInput['stackHints']> {
  const hints: OpenCodePromptInput['stackHints'] = {};
  const pkg = await fs.read(`${cwd}/package.json`).catch(() => null);
  if (pkg) {
    try {
      const json = JSON.parse(pkg);
      const allDeps = { ...(json.dependencies || {}), ...(json.devDependencies || {}) };
      if (Object.keys(allDeps).length) {
        hints.packageManager = 'npm';
        if (Object.keys(json.devDependencies || {}).includes('next')) hints.framework = 'next.js';
        else if (allDeps['@sveltejs/kit']) hints.framework = 'sveltekit';
        else if (allDeps['vite']) hints.framework = 'vite';
        else if (allDeps['express']) hints.framework = 'express';
        else if (allDeps['hono']) hints.framework = 'hono';
        if (json.scripts) {
          if (json.scripts.test) hints.testCommand = 'npm test';
          if (json.scripts.lint) hints.lintCommand = 'npm run lint';
          if (json.scripts.build) hints.buildCommand = 'npm run build';
        }
      }
    } catch { /* malformed package.json — leave hints empty */ }
  }
  if (await fs.exists(`${cwd}/pnpm-lock.yaml`) && !hints.packageManager) {
    hints.packageManager = 'pnpm';
  }
  return hints;
}
