# site-cloning + rebrand (OpenCode skill)

OpenCode-side skill for the "clone this website and rebrand it" workflow. Triggered
by `local_run_opencode_task` when `permissionMode === 'auto_selected_folder'`
and the user prompt mentions cloning / mirroring / rebranding / reskinning /
white-labelling / replicating a URL.

The backend calls this skill by proxying an engineered prompt to
`POST /api/open-site/rebrand` on the server (or `POST /opencode/run` on the
local daemon when one is online). The skill expects the working directory to
already contain a freshly-mirrored site from `POST /api/open-site/clone` (wget
--mirror). See `.opencode/skills/open-sites-pwa/SKILL.md` for the upstream mirror step.

---

## When to use

Activate this skill when the user message contains any of:

- "clone this site / page"
- "mirror this URL and rebrand"
- "rebuild this site but with our colors"
- "white-label this template"
- "reskin with our logo / palette"
- "give me a derivative of https://example.com using our brand"

The skill is paired with the opencode-prompts SITE_CLONING_REBRAND_OVERLAY
which is appended to `engineerOpenCodePrompt`. See `src/lib/opencodePrompts.ts`.

---

## Inputs

```
{
  "url":       "https://example.com",         // source URL to clone (clone step runs if slug absent)
  "slug":      "example-com-home",             // optional; pre-existing clone
  "cwd":       "/abs/path/to/cloned-dir",      // mirror destination on disk
  "userId":    "<firebase uid>",
  "brand": {
    "name":         "Acme Studio",
    "tagline":      "Design that ships.",
    "primaryColor": "#1f6feb",
    "accentColor":  "#ff7a59",
    "fonts":        ["Inter", "Source Serif Pro"],
    "copy":         {
      "hero.headline": "Design that ships.",
      "hero.subhead":  "From brief to build in days, not weeks."
    },
    "logoUrl":      "https://cdn.example.com/logo.svg",
    "logoText":     "ACME"      // fallback when no logoUrl
  },
  "model":     "ollama/media-pipe/eburon-sandbox-worker",
  "timeout":   1200
}
```

---

## Workflow

1. **Confirm slug exists** — if not, trigger the upstream mirror step
   (`POST /api/open-site/clone`) before invoking OpenCode.
2. **Inventory the clone** — `find . -type f \( -name '*.html' -o -name '*.css' -o -name '*.scss' -o -name '*.js' -o -name '*.svg' \)` to enumerate editable files.
3. **Detect color tokens** — grep for CSS custom properties (`--primary`,
   `--accent`, `--brand`, etc.) and any hex/rgb literals that recur. Prefer
   rewriting tokens over inline values.
4. **Rewrite metadata** — `<title>`, `<meta name="description">`, OG tags,
   favicon, language attribute.
5. **Apply palette** — if `--primary` / `--accent` tokens exist: rewrite them
   once. Otherwise, replace the dominant original primary in `*.css` /
   inline `style=""`.
6. **Apply typography** — if brand.fonts non-empty, replace existing
   `font-family` declarations with the first font, embed via existing CDN
   reference or add `<link rel="stylesheet">`.
7. **Apply logo** — if brand.logoUrl: download to `assets/brand-logo.{ext}`
   and update `<img>` tags whose `alt` matches the original brand. If only
   brand.logoText: replace logo image with a styled `<span>` sized to match.
8. **Apply copy** — replace ONLY the strings listed in `brand.copy`. Never
   rewrite the full body. Walk every HTML/JS file once.
9. **Validate** — start `python3 -m http.server 8000` (non-blocking) inside
   the cwd, then curl the top-level paths and a couple of nested pages.
   Confirm HTTP 200 and that the page now contains the new `<title>` and
   the new primary color (cheap grep on the response body).
10. **Tear down** — kill the local server. Remove temp download artifacts
    outside `assets/`.
11. **Report** — list changed files, summary of palette/copy/logo changes,
    and any pages that no longer render correctly.

---

## Safety / quality gates

- **Never delete pages, navigation, or working JS** — the rebrand must
  preserve the clone's functionality.
- **Never rebrand hardcoded absolute URLs** — keep links working unless the
  user explicitly supplied a replacement.
- **Never fetch arbitrary external resources** beyond the supplied
  `brand.logoUrl`. If `brand.logoUrl` is empty, fall back to `brand.logoText`
  and skip the network call entirely.
- **Respect `permission_mode`** — if `ask`, pause before rebrand for the
  user to confirm.
- **Reject inside scope:selected_folder runs that extend outside the
  approved dir** — the daemon already enforces this
  (`public/beatrice-local-daemon.mjs`, classifyCommand + scope gates).

---

## Backend surface

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/open-site/clone`   | POST | wget --mirror into `/beatrice-workspace/cloned-sites/<slug>/` |
| `/api/open-site/rebrand` | POST | runs OpenCode over a clone with site-cloning overlay (this skill) |
| `/api/open-site/list`    | GET  | audit existing clones |
| `/api/open-site/:slug`   | DELETE | free disk |

The frontend client is `src/lib/siteCloningClient.ts`. The agent tool
`clone_and_rebrand_site` (declared in `src/components/BeatriceAgent.tsx`
googleTools) calls this client and renders the result in the existing
`DocumentViewer` (iframe pointing at `previewUrl`).

---

## Companion files

- `.opencode/skills/open-sites-pwa/SKILL.md` — upstream mirror step
- `src/lib/opencodePrompts.ts` — overlay text + `engineerOpenCodePrompt`
- `src/lib/commandClassifier.ts` — safety classifier mirrored from the daemon
- `public/beatrice-local-daemon.mjs` — local OpenCode runner with scope-gated
  grants (this skill runs through `POST /opencode/run` when the daemon is up)
- `knowledge.md`, `README.md`, `AGENTS.md` — end-user docs
