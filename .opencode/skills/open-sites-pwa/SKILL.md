# Open Sites PWA — wget-based PWA Cloning + Live Preview

Use this skill when the user asks Beatrice to **open**, **mirror**, **clone**, **preview**, or **render** a Progressive Web App from a public URL. The skill clones the site into the Beatrice workspace with `wget` and serves the result through the existing `/beatrice-workspace` static mount, then surfaces the offline clone through `DocumentViewer` as a live-server preview.

This is essentially "give me an offline, browseable mirror of `<url>` so I can poke at it".

## When to use

Trigger this skill when the user provides a public HTTP(S) URL and any of the following intents:

- "Open this PWA"
- "Mirror / clone this site"
- "Render this app for me"
- "Show me what this looks like"
- "Pull this site down and let me play with it"

Concrete example phrasing (any of these should match):

- *"Beatrice, open https://themes.pixelstrap.com/fuzzy/"*
- *"Clone https://example.com/app and show me"*
- *"Render this PWA: https://my-app.io"*
- *"Mirror https://docs.example.com so I can browse it offline"*

Do NOT trigger this skill for:

- Generating a brand-new web app (use the standard sandbox skill instead).
- Reading or summarising the contents of a single web page (use `/api/web/read-page`).
- Fetching JSON or API responses (use fetch directly).

## Hard requirements

Before you start, all of the following must be true. If any are not, STOP and report the issue — don't try to "fix" the missing piece yourself.

1. `wget` is installed on the host (`command -v wget` must succeed). If missing, install it via `apt-get install -y wget` or your distro's package manager.
2. `BEATRICE_WORKSPACE_DIR` is set and exists. Default: `/data/beatrice-workspace`. Use `mkdir -p` if the directory is missing.
3. `BEATRICE_PUBLIC_URL` is set. Default: `https://whatsapp.eburon.ai`. This becomes the public host of the live preview.
4. The user has explicitly provided a URL. **Never invent or guess** a URL — confirm with the user if it's missing or invalid.
5. The URL uses `http://` or `https://`. Other schemes (`file://`, `ftp://`, etc.) are rejected.

## Behaviour

### 1. Derive a safe slug

Take the URL the user provided and turn it into a filesystem-safe slug:

```bash
URL="$1"
SLUG_RAW=$(printf '%s' "$URL" \
  | sed -E 's|^https?://||; s|/+$||; s|^www\.|themes-|; s|\.|_|g; s|/|_|g')
SLUG=$(printf '%s' "$SLUG_RAW" | tr -cs 'A-Za-z0-9._-' '-' | sed 's/^-*//; s/-*$//')
[ -z "$SLUG" ] && SLUG="site-$(date +%s)"
SLUG=$(printf '%.80s' "$SLUG")
```

Examples:

| Input URL                                          | Slug                          |
| -------------------------------------------------- | ----------------------------- |
| `https://themes.pixelstrap.com/fuzzy/`             | `themes_pixelstrap_com_fuzzy` |
| `https://example.com/`                             | `example_com`                 |
| `https://app.demo.io/dashboard/?ref=email`         | `app_demo_io_dashboard_ref_e` |
| `https://www.pwa.app`                              | `themes-pwa_app`              |

The slug is the on-disk directory name **and** part of the public URL. Keep it ASCII, lowercase, ≤80 chars.

### 2. Build the canonical wget command

The user-specified flags are mandatory, but `--directory-prefix` should be **overridden** so the clone lands inside `BEATRICE_WORKSPACE_DIR/cloned-sites/<slug>/` (the static route already serves that path). Use this exact template:

```bash
TARGET="$BEATRICE_WORKSPACE_DIR/cloned-sites/$SLUG"
mkdir -p "$TARGET"
rm -rf "$TARGET"/*  # overwrite any previous clone with the same slug

wget \
  --mirror \
  --convert-links \
  --adjust-extension \
  --page-requisites \
  --no-parent \
  --execute robots=off \
  --wait=0.5 \
  --random-wait \
  --tries=3 \
  --timeout=30 \
  --connect-timeout=15 \
  --max-redirect=5 \
  --user-agent="Beatrice-OpenSitesPWA/1.0" \
  --directory-prefix="$TARGET" \
  "$URL" 2>&1 | tail -200
```

Notes on the additions vs the user's flags verbatim:

- `--execute robots=off` — many PWA sites disable mirroring in `robots.txt`. We're explicitly authorised by the user, so override.
- `--wait=0.5 --random-wait` — be polite to the upstream host. Heavy scraping on a whim is bad form.
- `--tries=3 --timeout=30 --connect-timeout=15 --max-redirect=5` — fail fast on broken servers; cap redirect chains.
- `--user-agent` — identify ourselves so the upstream operator can find us if they need to.

If `wget` exits non-zero but at least an `index.html` exists at `$TARGET/index.html`, treat the operation as **partial success** — the page rendered; some sub-resources failed. Surface the partial-success status in your response.

### 3. Verify & compute the live preview URL

After wget finishes:

```bash
if [ ! -f "$TARGET/index.html" ]; then
  echo "FAIL: no index.html produced" >&2
  exit 1
fi
SIZE=$(du -sh "$TARGET" | cut -f1)
COUNT=$(find "$TARGET" -type f | wc -l)
```

Compose the public URL:

```
PREVIEW_PATH="/beatrice-workspace/cloned-sites/<slug>/"
PREVIEW_URL="${BEATRICE_PUBLIC_URL}${PREVIEW_PATH}"
```

### 4. Hand back to the parent agent

Return a JSON-shaped string your parent can parse:

```
OK
slug: <slug>
previewPath: /beatrice-workspace/cloned-sites/<slug>/
previewUrl:  https://<host>/beatrice-workspace/cloned-sites/<slug>/
size:        <human-readable>
fileCount:   <integer>
exitCode:    <0..255> (0 = full success, non-zero with index.html = partial)
```

If the operation failed completely (no `index.html` and non-zero exit), return:

```
FAIL
slug: <slug>
error: <short summary>
stderrTail: <last 500 chars of wget stderr>
```

### 5. What the parent does

The parent (Beatrice main agent) will:

1. Show the user a sandbox/progress log using the existing `triggerSandboxShowcase` pattern.
2. When you return success, the parent opens `DocumentViewer` with `title: '<url>'`, `url: previewUrl` — the iframe's `sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"` flags make the cloned PWA behave like a real served app.
3. If partial success, the parent warns the user that some sub-resources may be missing.

## Backend fallback (preferred when available)

The Express native `/api/open-site/clone` endpoint does the same job without spawning the OpenCode sub-agent. Use it whenever it is reachable (always on production):

```bash
curl -fsS -X POST \
  "$VITE_BACKEND_URL/api/open-site/clone" \
  -H 'Content-Type: application/json' \
  -d "{\"url\": \"$URL\"}"
```

This returns:

```jsonc
{
  "ok": true,
  "slug": "themes_pixelstrap_com_fuzzy",
  "sourceUrl": "https://themes.pixelstrap.com/fuzzy/",
  "previewPath": "/beatrice-workspace/cloned-sites/themes_pixelstrap_com_fuzzy/",
  "previewUrl": "https://whatsapp.eburon.ai/beatrice-workspace/cloned-sites/themes_pixelstrap_com_fuzzy/",
  "size": "1.2M",
  "fileCount": 47,
  "exitCode": 0,
  "partial": false,
  "durationMs": 12345
}
```

When this returns `ok: true`, **skip the manual wget above** and just report the result. When it returns `ok: false`, fall back to the manual wget pipeline for self-healing.

## Listing & cleanup

List what you've cloned (returns the slugs and sizes):

```bash
curl -fsS "$VITE_BACKEND_URL/api/open-site/list"
```

Delete a clone (free disk):

```bash
curl -fsS -X DELETE "$VITE_BACKEND_URL/api/open-site/${SLUG}"
```

## Worked example (beatrice-voix/pixelstrap)

User says: *"Beatrice, open https://themes.pixelstrap.com/fuzzy/ and show me"*

1. URL = `https://themes.pixelstrap.com/fuzzy/`, slug = `themes_pixelstrap_com_fuzzy`.
2. Backend preferred: POST `/api/open-site/clone` with the URL → expect 5–25s round-trip.
3. Backend returns `{ ok: true, previewUrl: "...", size: "1.2M", fileCount: 47, exitCode: 0 }`.
4. Parent opens DocumentViewer with `url: previewUrl` and `title: "Pixelstrap Fuzzy (themes.pixelstrap.com)"`.
5. User sees a live, browseable clone of the PWA inside the iframe. They can resize the viewport toggle (desktop / tablet / mobile) and copy the URL.

## Anti-abuse rules

- **One URL per request.** Don't chain multiple URLs into a single clone — call the skill once per URL.
- **No auth flows.** wget can't carry cookies through OAuth-style gates. If the user wants a logged-in mirror, they need a session cookie export + an explicit instruction.
- **No scraping at scale.** If the user asks to "grab the whole web" or mirror hundreds of URLs, refuse politely and suggest a dedicated crawler tool.
- **Respect upstream.** When a clone fails because the upstream enforces hot-link protections or DRM, report the issue clearly. Don't try to circumvent.

## Common failure modes

| Symptom in `wget` stderr                          | Meaning                                                 | Fix suggestion                                                                 |
| ------------------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `403 Forbidden` / `401 Unauthorized`              | The upstream blocks bots                                | Tell the user the site denies mirrors; suggest they host a public copy.        |
| `unable to resolve host`                          | DNS failure                                             | Verify the URL is correct; try with a fresh URL.                               |
| `Read error (Connection reset by peer)`           | Host is rate-limiting                                   | Re-run with a longer `--wait` (3–5 seconds).                                   |
| `Length: not supported`                           | Server returns odd encodings                            | Re-run with `--no-check-certificate` only if you're sure the site is trusted. |
| Index.html missing after `--mirror`               | Index has a non-standard name (e.g. `app.html`)         | Find the actual entry file with `find "$TARGET" -name '*.html' \| head` and report. |

In every failure case, return the slug + a short human-readable hint. The parent will translate it into a friendly message for the user.

## Reference

- Static mount serving the clones: `app.use('/beatrice-workspace', express.static(BEATRICE_WORKSPACE_DIR, { extensions: ['html'], index: 'index.html' }))` in `server/index.ts`.
- DocumentViewer: `src/components/DocumentViewer.tsx`. The `url` prop becomes the iframe's real `src`. Wix/Angular/React PWAs cloned via wget generally render fine because `--convert-links` rewrites asset paths.
- Skill loader: the OpenCode CLI sub-agent reads this SKILL.md from `.opencode/skills/open-sites-pwa/SKILL.md` and treats it as executable guidance when the parent requests this skill name.
- Endpoint contract: `server/index.ts` `POST /api/open-site/clone` is the canonical implementation; the manual wget pipeline above is the recoverable fallback.
