# SESSION 018 — Caption Contrast Polish for Brand-Coloured Reels (PR AM)

**Date:** 2026-05-09
**Author:** Claude (Opus 4.7) for Chris (chris@donkeybetz.com)
**Branch:** `main` (PR AM patch in flight on top of `8a43af2`
`feat: export transcripts as markdown or txt`; commit + push
pending after this handoff lands)
**Builds on:** SESSION_017 (PR AL Transcript Export), SESSION_016
(PR AK Brand Colour), SESSION_015 (PR AJ Transcript Replay),
SESSION_014 (PR AI Avatar Documents), SESSION_013 (PR AH
Captioned Reels), SESSION_012 (PR AG Vertical Reels), SESSION_011
anchors at `ec446e4`.

## Goal

PR AK lets operators paint the reels letterbox bars in a brand
colour. PR AH still burns captions in white-on-black regardless
of that colour — perfect on dark navy, less great on bright
yellow. PR AM closes the loop: the caption styling now flexes
with the backdrop's WCAG luminance so captions stay readable
across the brand-colour space without introducing themes,
palettes, or a caption editor UI.

Hard scope locks (carried forward from the brief):
- No caption editor UI.
- No themes / brand kits / logos.
- No font uploads.
- No word-level caption timing.
- Backend-first; UI surface unchanged.

## Endpoint inventory

PR AM is **backend-only**. Route count stays at **64**.

The reels routes' shape is unchanged. Caption styling is decided
inside `finisher_service.build_reels_export(...)` from the
already-passed `backdrop_color`.

## What changed

### Backend

- **`backend/app/services/color_utils.py`** — new helpers (~75 LOC):
  - `hex_to_rgb(value)` — parses any AdSpark-supported hex shape
    (`#RRGGBB` / `RRGGBB` / `0xRRGGBB` / `#RGB`) into an
    `(r, g, b)` triple. Returns `None` on unparseable input.
  - `relative_luminance(rgb)` — WCAG sRGB relative luminance.
    Channels are linearised via the standard `((v + 0.055) /
    1.055) ^ 2.4` curve before the photopic-weighted sum
    (`0.2126 R + 0.7152 G + 0.0722 B`).
  - `is_light_color(value)` — `relative_luminance(...) >= 0.5`.
    Threshold constant `_LIGHT_BACKDROP_THRESHOLD = 0.5`.
  - `DARK_CAPTION_STYLE` — the PR AH baseline (`white` / `black@0.6`)
    surfaced as a constant so the indirection is loud.
  - `LIGHT_CAPTION_STYLE` — `black` / `white@0.7`, slightly more
    opaque so the box edge stays crisp against bright bars.
  - `caption_style_for_backdrop(value) -> dict` — public API the
    finisher calls; returns a copy of the relevant style dict.
- **`backend/app/services/finisher_service.py`**:
  - `build_reels_export(...)` gains an optional
    `caption_style: Optional[dict]` argument. When omitted, the
    style is derived from the passed `backdrop_color` via
    `_caption_style_for_backdrop` (a small lazy-import shim so
    finisher_service stays decoupled from color_utils at module
    import time and degrades to the dark default if the import
    ever fails).
  - The `drawtext` filter line now interpolates `font_color`,
    `box_color`, and `box_alpha` from the chosen style. Geometry
    (`fontsize`, `boxborderw`, `y`, `line_spacing`) and the
    bottom-safe placement are unchanged from PR AH.

### Frontend

- **No changes.** The existing PR AK brand-colour control (saved
  campaign card header) already drives the styling automatically
  — the operator picks a colour and the next reels build adopts
  the matching caption contrast. PR AL's transcript export is
  unaffected.
- The smoke test was not modified — its existing assertions
  still cover the captioned reels labels and the brand-colour
  control. PR AM's caption flip is verified at the pixel level
  via the targeted backend probe rather than via Playwright (the
  smoke campaign never builds reels).

### Docs

- `docs/INVENTORY.md` — service-inventory rows for `color_utils.py`
  and `finisher_service.py` updated; feature-stack row added.
- `docs/OPERATOR_USAGE_MAP.md` — Reels §11 gains a "Contrast-aware
  captions (PR AM)" subsection with the threshold table.
- `docs/WHAT_IT_IS.md` — intentionally unchanged; the visual
  output behaviour is one polish step on top of the PR AH/AK
  chain already documented there.
- `00-START-NEXT-SESSION.md` — Distribution-layer section,
  next-phases checklist all ✅, headline build sizes / route count.
- `docs/handoffs/SESSION_018_CAPTION_CONTRAST_POLISH.md` — this
  file.

## Helper logic added

```
hex_to_rgb("#ffeb3b")        ─→ (255, 235, 59)
relative_luminance((r,g,b))  ─→ 0.810   (0..1, WCAG sRGB)
is_light_color("#ffeb3b")    ─→ True    (>= 0.5)
caption_style_for_backdrop("#ffeb3b")
  ─→ {font_color: "black", box_color: "white",
       box_alpha: 0.7, is_light_backdrop: True}
caption_style_for_backdrop(None | "" | "garbage" | "#0b1220" | "#ff7a00")
  ─→ {font_color: "white", box_color: "black",
       box_alpha: 0.6, is_light_backdrop: False}
```

The threshold (0.5) splits the brand-colour space cleanly along
the human-perceptual line where white-on-dark stops reading well
and the eye prefers black-on-light. Lower thresholds (e.g. 0.4)
would push reds/blues into the light bucket; higher thresholds
(e.g. 0.6) would leave near-white backdrops on the dark style.
0.5 is the standard textbook value and matches the verification
samples cleanly (yellow / sky / white → light; navy / orange /
black / unset → dark).

## How caption contrast is determined

```
incoming reels build call (PR AG/AH/AK)
   build_reels_export(source, target, captions=…,
                      backdrop_color="0xffeb3b", caption_style=None)
       │
       ▼ caption_style is None?
       │
       ▼ _caption_style_for_backdrop("0xffeb3b")
       │   color_utils.caption_style_for_backdrop("0xffeb3b")
       │     hex_to_rgb → (255, 235, 59)
       │     relative_luminance → 0.810
       │     is_light_color → True
       │     → LIGHT_CAPTION_STYLE
       │
       ▼ drawtext filter line uses
       │   fontcolor=black:
       │   boxcolor=white@0.70:
       │   (everything else identical to PR AH)
       │
       ▼ output: 720×1280 h264 + AAC, captions still bottom-safe,
                 source duration preserved, only the styling flexes.
```

## Helper-level coverage

The probe exercised every branch matrix entry the brief named
plus a few realistic brand colours:

```
                   colour        Y      light?  font/box
   dark default       None       —      False   white/black@0.6
        invalid  not-color       —      False   white/black@0.6
          black    #000000   0.000      False   white/black@0.6
      dark navy    #0b1220   0.006      False   white/black@0.6
 orange (PR AK)    #ff7a00   0.352      False   white/black@0.6
          white    #ffffff   1.000      True    black/white@0.7
   light yellow    #ffeb3b   0.810      True    black/white@0.7
       sky blue    #7ed4ff   0.587      True    black/white@0.7
```

All paths returned the expected style.

## Mock behaviour

Mock + real mode behave identically for caption-style derivation
— there's no Runway dependency. The reels build itself runs
through the same lavfi-mock-to-real ffmpeg pipeline that PR AG
established. Frame extraction in mock mode is the
authoritative visual check.

| Probe | Result |
|---|---|
| Mock-mode build with `brand_color = null` | dark default style; caption box averages `#02060b` (near-black) ✅ |
| Mock-mode build with `#0b1220` | same as default — luminance 0.006 stays under threshold ✅ |
| Mock-mode build with `#ff7a00` | dark style — luminance 0.352 stays under threshold ✅ |
| Mock-mode build with `#ffeb3b` | light style — caption box averages `#fdf9c4` (white box averaged with caption text band against the bright background) ✅ |

## Verification (this session)

Servers were killed and restarted in mock mode before each
verification block per the brief.

| Check | Result |
|---|---|
| Local servers killed pre-test | `pgrep -lf 'uvicorn\|vite'` → `(none)` ✅ |
| Mock backend health | `{"status":"ok",…,"any_mock":true}` ✅ |
| Vite dev server | HTTP 200 ✅ |
| Helper-level probe | 8/8 light/dark branch cases match expected style ✅ |
| `python -c "from app.main import app; print(len(app.routes))"` | **64** (unchanged) |
| `vite build` | green |
| Playwright mock smoke | `1 passed (22.7 s)` |
| ffprobe `dark-default.mp4` | `h264 720x1280 + aac · 5.000000 s` ✅ |
| ffprobe `light-yellow.mp4` | `h264 720x1280 + aac · 5.000000 s` ✅ |
| Caption-box pixel sample (dark-default, y=1080) | `#02060b` (near-black box) ✅ |
| Caption-box pixel sample (light-yellow, y=1080) | `#fdf9c4` (white box averaged with text) ✅ |
| Visual frame inspection | dark backdrop → white text on black box; yellow backdrop → black text on white box; talking-head + bottom-safe placement intact in both ✅ |
| Hygiene scan | empty ✅ |
| Drift guard | `✅ context-kit anchors look recent.` |

## Visual verification notes

- **`brand_color = null` (default `#0b1220`)** — PR AH baseline:
  white text on near-black caption box. No regression.
- **`brand_color = "#ff7a00"` (PR AK orange)** — luminance 0.352
  is below the 0.5 threshold, so the dark style still applies.
  This intentionally keeps PR AK's reference output visually
  unchanged (the orange bars still pair with the original
  white-on-black caption box).
- **`brand_color = "#ffeb3b"` (yellow)** — luminance 0.810 trips
  the light-backdrop branch. Caption now renders as black text
  on a white@0.7 box; the talking-head visual above and the
  bottom-safe placement are untouched.
- The auto-derivation uses the *backdrop* colour, not any source
  visual sampling, so the choice is consistent across frames.

## Server restart confirmation

```
pkill -f "uvicorn app.main:app"   # killed
pkill -f "vite"                   # killed
RUNWAY_API_KEY= OPENAI_API_KEY= IMAGE_GEN_PROVIDER=mock \
  uvicorn app.main:app --port 8000  # fresh
npm run dev                        # fresh
sleep 5 && curl /health -> 200; vite -> 200
```

After every backend code change in PR AM (helpers, finisher), the
backend was killed and restarted before re-running the probe and
the smoke. Each verification ran against fresh code.

## Limitations / follow-ups

- **Single threshold.** A 0.5 luminance cut-off works for the
  full sRGB ramp but skips any "near-threshold" smoothing —
  e.g. a 0.49 backdrop renders dark style, a 0.51 backdrop
  renders light style. Acceptable: the human eye also flips
  contrast preference around the same band.
- **No actual contrast-ratio enforcement.** PR AM uses
  luminance-only branching, not WCAG AA / AAA contrast-ratio
  math. The black@0.7 vs white@0.6 boxes already provide ample
  contrast in practice, but a future polish could compute the
  actual contrast ratio between caption text and source frame
  and tune `box_alpha` accordingly.
- **Outline / drop-shadow not added.** drawtext supports `bordw`
  for an outline; PR AM stays inside box-only styling for
  simplicity. Adding outlines would help captions read on busy
  source visuals (Cinematic Reels with non-uniform backgrounds)
  but isn't needed today since the reels output uses lavfi /
  avatar-talking-head visuals.
- **No per-character / per-campaign style override surface.**
  The internal `caption_style` dict is a hatch for tests +
  future routes, but no API surface exposes it. Tier-3 polish
  if a brand needs a specific caption colour distinct from the
  backdrop.
- **No re-render on brand-colour change.** Same UX consistency
  point as PR AH / PR AK: cached reels MP4s aren't auto-rebuilt
  when the brand colour flips. Operator clicks **Rebuild
  Captioned Reels** to apply.

## Recommended next slice

The Tier-1 (Reels / Captions / RAG / Transcript) + AK polish +
AL portability + AM contrast slices are all ✅. Next-tier
candidates:

1. **Custom voice cloning** (`POST /v1/voices` `from.type=audio`)
   — meaningful when a brand has a 30-second founder voice
   sample. Real-mode-only feature; mock would skip cleanly.
2. **Word-level caption timing** — once real Runway transcripts
   carry per-turn `timestamp` fields, those timings could feed
   back into PR AH's caption schedule for tighter sync.
3. **Per-campaign transcript history** — today PR AJ caches one
   transcript per campaign (the most recent fetch). A small
   archive list (or explicit `keep` flag) would let operators
   maintain multiple session replays per campaign.
4. **Caption outline / drop-shadow** — small `borderw` /
   `shadowx`/`shadowy` addition to PR AH's drawtext for readability
   on busy source visuals. ~10 LOC.

Each is a 1–2 hour slice. None blocking.
