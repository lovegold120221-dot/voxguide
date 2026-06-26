# OpenMontage — Agentic Video Production for OpenCode

Use this skill when the user wants **video produced end-to-end from a
natural-language brief**: concept → script → assets → narration → music →
subtitles → render → self-review.

`OpenMontage` is an open-source agentic video production system that turns
OpenCode (or any AI coding assistant that reads files and runs code) into a
full production studio. Twelve production pipelines, 52 tools, 500+ agent
skills, free archival footage corpus from Archive.org + NASA + Wikimedia.

This skill pairs with `local_run_opencode_task`; the executing arm is OpenCode
running locally. The skill instructs the agent to:

1. Read `AGENT_GUIDE.md` and `PROJECT_CONTEXT.md` from the cloned install.
2. Query the capability envelope (`tools/tool_registry.registry.support_envelope`)
   so the agent picks a pipeline its current environment can actually run.
3. Pick a pipeline (Animated Explainer by default; Documentary for "real
   footage only" briefs).
4. Run the pipeline stages (research → script → assets → narration → render
   → self-review).
5. Return the final render path + ffprobe validation results.

## When to use

Trigger this skill when the user message contains any of:

- "make me a video about …", "produce a short film …", "create an explainer …"
- "60-second animated explainer", "30-second product teaser", "90-second
  documentary montage"
- "use the Ghibli style", "Pixar-style short", "kinetic typography", "cinematic
  trailer", "sci-fi ad", "LinkedIn ad"
- "edit this YouTube clip into something like it" (paste reference URL)
- Reference to "Veo", "Kling", "Pika", "Runway", "FLUX", "Sora", "Remotion",
  "HyperFrames", "ffmpeg" — these all suggest one of the 12 pipelines
- "use real footage only", "no narration", "stock footage collage",
  "tone poem"  → pipeline = Documentary
- "TikTok-style captions", "word-level subtitles", "cinematic vignette",
  "particle overlays" → pipeline = Animation

Do **not** trigger for:

- Image-only generation (use the standard sandbox skill instead)
- Static webpages / apps (use the open-sites-pwa / site-cloning skill)
- Sub-30-second GIFs (use the sandbox skill — no need for a full pipeline)

## Inputs

```jsonc
{
  "brief":   "60-second animated explainer about why the sky is blue",
  "style":   "Ghibli-style anime" | "Pixar-style" | "cinematic" | "documentary" | "product-ad" | "kinetic" | "custom",
  "durationSec":   30 | 45 | 60 | 75 | 90,    // target length
  "narration": "yes" | "no" | "auto",
  "music":    "yes" | "no" | "auto",
  "captions": "word-level" | "none",
  "realFootageOnly":  false,                  // true => Documentary pipeline
  "reference": null,                          // optional YouTube/Reel/TikTok URL to model
  "outDir":   "/abs/path/to/renders",
  "userId":   "<firebase uid>",
  "scope":    "selected_folder"               // renders go to $BEATRICE_WORKSPACE_DIR/$userId/renders/...
}
```

When `reference` is set, the agent first analyses the source (transcript,
pacing, scenes, keyframes, style) and produces 2–3 differentiated concepts
with cost estimates before full production.

## Install (one-shot)

OpenMontage is a Python 3.10+ project with Remotion (Node 18+) for rendering.
The skill instructs OpenCode to run:

```bash
# Clone the upstream project
git clone --depth 1 https://github.com/calesthio/OpenMontage.git ~/openmontage

# Bootstrap deps
cd ~/openmontage && make setup

# Optional: install GPU-accelerated local video generation (free, requires NVIDIA GPU)
make install-gpu   # adds wan2.1 / hunyuan / cogvideo / ltx2 / local model options
```

`make setup` does:

- `pip install -r requirements.txt`
- `cd remotion-composer && npm install` (Remotion renderer — React + TypeScript)
- `pip install piper-tts` (offline narration — free, no API key)
- `cp .env.example .env` so the user can paste their keys

Renders are written to `~/openmontage/projects/<project-name>/renders/final.mp4`
by default. The skill copies the final render into
`$BEATRICE_WORKSPACE_DIR/$userId/renders/` so `DocumentViewer` can play it
without exposing the upstream install tree.

### Fallback (manual)

`make` may be missing on minimal Windows installs. In that case:

```bash
pip install -r requirements.txt
cd remotion-composer && npm install   # or: npx --yes npm install on Windows
cd .. && pip install piper-tts
cp .env.example .env
```

### What's available out-of-the-box (zero API keys)

- **Narration**: Piper TTS (offline, free, real human-sounding)
- **Open footage corpus**: Archive.org, NASA, Wikimedia Commons
- **Extra stock**: Pexels + Unsplash + Pixabay (developer keys are FREE to get)
- **Rendering**: Remotion (React/TS) + HyperFrames (HTML/CSS/GSAP)
- **Post-production**: FFmpeg (encoding, subtitle burn-in, mixing, color grading)
- **Subtitles**: built-in word-level timing auto-generation

Zero-cost video paths: image-based (Piper + Remotion) or local character
animation (SVG rigs + HyperFrames). Real-footage video needs Archive.org +
free-key stock sources.

### Optional API keys (more keys = more tools + better quality)

| `.env` key | Adds |
|---|---|
| `FAL_KEY`            | FLUX images + Veo/Kling/Pika/Recraft |
| `PEXELS_API_KEY`     | free stock footage/images |
| `PIXABAY_API_KEY`    | free stock footage/images |
| `UNSPLASH_ACCESS_KEY`| free stock images |
| `SUNO_API_KEY`       | full songs + instrumentals + any genre |
| `ELEVENLABS_API_KEY` | premium TTS + AI music + sound effects |
| `EBURON_MULTIMODAL_KEY` | premium TTS + image generation (Eburon Live API) |
| `XAI_API_KEY`        | Grok image edits + generation + Grok video |
| `GOOGLE_API_KEY`     | Google Imagen + Google TTS (700+ voices) |
| `HEYGEN_API_KEY`     | HeyGen — VEO/Sora/Runway/Kling gateway |
| `RUNWAY_API_KEY`     | Runway Gen-4 direct |

The agent should query `registry.provider_menu()` (see `AGENT_GUIDE.md`) to
discover which keys are configured, then pick the lowest-cost provider that
still meets the brief's quality bar.

## Workflow (per brief)

Sequential. The pipeline selection happens first; do NOT improvise.

1. **Capability check.** Run `python3 -c "from tools.tool_registry import
   registry, json; registry.discover(); print(json.dumps(registry.support_envelope()))"`.
   If no provider meets the brief's quality bar, surface a friendly upgrade
   notice (no silent fallback).
2. **Reference analysis** (if `reference` is set). The agent compares the
   reference's pacing, scene plan, narration style, music hook, and visual
   treatment against the new brief — surface 2–3 differentiated concepts with
   honest cost estimates.
3. **Concept approval.** Always confirm the concept with the user before asset
   generation starts (this saves money).
4. **Pipeline selection.** Read `pipeline_defs/` to pick the right pipeline —
   Animated Explainer, Animation, Avatar Spokesperson, Cinemat, Documentary,
   HyperFrames / kinetic typography, etc.
5. **Stage director run.** Read `skills/pipelines/<pipeline>/SKILL.md` and
   follow its workflow exactly. Sub-skill stages handle research, script,
   assets, narration, music, render.
6. **Self-review.** FFprobe validation, frame sampling, audio level analysis,
   delivery promise verification, subtitle checks. The skill pack fails
   loud if any check fails — do not "ship anyway".
7. **Deliverable.** Copy the final `.mp4` into
   `$BEATRICE_WORKSPACE_DIR/$userId/renders/<project-name>.mp4`. Hand the
   URL back to the parent agent for `DocumentViewer` playback.

## Pipeline pickers

| User brief contains … | Pipeline |
|---|---|
| animated explainer, educational, tutorial, breakdown, topic → for me | Animated Explainer |
| motion graphics, kinetic typography, abstract, social reel | Animation |
| corporate comms, training, spokesperson presenter | Avatar Spokesperson |
| cinematic, trailer, sci-fi, product ad | Cinemat |
| real footage, documentary, archival, no narration, tone poem | Documentary |
| talking head, podcast clip, ad read | Talking Head / Podcast Clip |
| character animation, cartoon, Ghibli, Pixar-style, anime short | Character Animation |
| launch reel, kinetic typography, SVG rig | HyperFrames |
| product demo, motion-graphics-heavy | Hybrids (Remotion + HyperFrames) |

Locked render_runtime:
- **Remotion** is default for ANY data-driven explainer + anything using the
  existing React scene stack.
- **HyperFrames** is default for motion-graphics-heavy briefs, especially
  character animation (SVG rigs) + registry blocks (website-to-video).

The decision is logged in the manifest (`projects/<name>/manifest.json`) and
must match the rendered output. If Remotion is locked but the user clearly
asked for "kinetic typography", override the lock and surface the override
in the self-review.

## Sub-tracks (invoke standalone)

| Sub-track | Slash hint | When |
|---|---|---|
| Self-review only          | "validate this render" | when render looks off |
| Re-narrate with new voice | "re-narrate with <voice>" | when TTS voice is wrong |
| Re-caption                | "re-burn word-level captions" | when captions look off |
| Re-render at different length | "extend to N seconds" / "shorten to N" | pacing fix |
| Music swap                | "swap music for <genre>" / "no music" | music vibe fix |
| Frame still extract       | "give me 3 stills from this clip" | social thumbnail |

## Worked example (zero-keys image-based explainer)

User says: *"Beatrice, make a 60-second animated explainer about why the sky is
blue."*

1. ECHO: "I'll run the Animated Explainer pipeline (image-based; ~$0.15 cost).
   Want me to start?"
2. OpenCode dispatches (`cwd = "$outDir"`, `scope = "selected_folder"`):

```bash
cd ~/openmontage && python3 -c "
from tools.tool_registry import registry, json
registry.discover()
print(json.dumps(registry.provider_menu(), indent=2))
"

# Then drive the pipeline:
cd ~/openmontage && opencode run "
Project: 'sky-blue-60'
Pipeline: Animated Explainer (image-based, zero provider keys allowed)
Brief: 60-second explainer about why the sky is blue
Duration: 60s
Renderer: Remotion
Cost ceiling: \\$0.20
Audience: middle schoolers
Tone: curious + light

Run:
1.AGENT_GUIDE.md
2. PROJECT_CONTEXT.md
3. skills/pipelines/animated-explainer/SKILL.md
4. Produce research brief, script, scene plan, narration cues
5. Generate visuals with FLUX ON zero-keys → fallback to Pexels images
6. Narrate with Piper TTS
7. Add ambient music (auto-source; auto-detect energy offset)
8. Burn word-level captions
9. Render with Remotion
10. Run self-review (ffprobe + frame sampling + audio check + caption check)
11. Copy final mp4 to \\$BEATRICE_WORKSPACE_DIR/\\$USER/renders/sky-blue-60.mp4
"
```

3. Stream per-stage progress to `DocumentViewer`. When the agent returns the
   final URL `https://whatsapp.eburon.ai/beatrice-workspace/<userId>/renders/sky-blue-60.mp4`,
   parent renders `<video>` with preload=none so the iframe stays responsive.
4. Surface cost + duration + provider breakdown so the user sees what they paid
   for.

## Worked example (real-footage documentary, no narration)

User says: *"Make a 90-second documentary montage about what a city feels like
at 4am. Use real footage only, no narration, elegiac tone."*

Pipeline = Documentary. Renderer = any (Remotion or FFmpeg-only, both fine).
- Skips TTS stage
- Pulls from Archive.org + Pexels + Pixabay
- Orders clips by slow → faster
- Applies fade-in/fade-out, light vignette, ambient cityscape music

Result lands at `$BEATRICE_WORKSPACE_DIR/$userId/renders/city-4am-90.mp4`.

## Safety / quality gates

- **Never auto-spend.** Lifts the cost ceiling → ECHO a confirmation card.
  Estimated cost should be visible BEFORE assets generate.
- **Never skip self-review.** ffprobe validation is non-negotiable. If any
  check fails (frame-audio drift, missing captions, broken audio levels),
  the skill refuses to deliver.
- **Never fabricate providers.** If the brief asks for "Veo" but `FAL_KEY`
  isn't set, surface the missing key — don't substitute without consent.
- **Reference input is read-only analysis.** When `reference` is a YouTube
  URL, only the transcript + metadata is consumed. No content is reposted;
  only style/pacing/structure informs the new piece.
- **Render budget = user's stated ceiling.** Default ceiling: $3.00 USD. If
  the pipeline's projected cost exceeds this, ECHO first.
- **Project dir hygiene.** Each project gets its own subfolder; old renders
  are archived (not deleted) so users can rollback to a previous version.

## Backend surface

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/skills/install`     | POST | One-shot clone + setup; supports both `gstack` and `openmontage-video` |
| `/api/skills/list`        | GET  | List installed skill packs (detects both) |
| `/api/skills/caps`        | GET  | Probe git / opencode / python3 / ffmpeg / remotion / model state |
| `/api/video/render`       | POST | Queue a video production job; copies final mp4 to the workspace and returns the public URL |
| `/api/video/progress/:id` | GET  | SSE-style progress for running pipelines |
| `/api/video/list`         | GET  | List a user's renders |

The frontend client is `src/lib/skillsInstaller.ts` (install / caps) plus a
`videoRenderer.ts` for `/api/video/*`. The agent tool `local_run_opencode_task`
is the executing arm; the agent decides whether to drive a single stage or the
full pipeline.

## Companion files

- `.opencode/skills/open-sites-pwa/SKILL.md` — sibling skill (URL cloning)
- `.opencode/skills/site-cloning/SKILL.md` — sibling skill (clone + rebrand)
- `.opencode/skills/dokploy-deploy/SKILL.md` — sibling skill (deploy target)
- `.opencode/skills/gstack/SKILL.md` — sibling skill (full-sprint workflow)
- `src/lib/opencodePrompts.ts` — prompt template + `engineerOpenCodePrompt`
- `src/lib/commandClassifier.ts` — safety classifier
- `src/lib/skillsInstaller.ts` — typed client for `/api/skills/*`
- `public/beatrice-local-daemon.mjs` — local OpenCode runner (also drives video pipelines)
- `knowledge.md`, `README.md`, `AGENTS.md` — end-user docs
