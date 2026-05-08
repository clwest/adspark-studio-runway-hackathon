# AdSpark Studio — Screen-Recording Script

This file is the operator's run-of-show for the hackathon screen
capture. It assumes a clean machine, both servers stopped, and the
repo at `feature/pr-d-demo-hardening` (or later).

## Pre-flight checklist (do this *before* recording)

| Step | Why |
|---|---|
| 1. `git status` clean on the demo branch | No uncommitted noise on screen |
| 2. ffmpeg on PATH (`ffmpeg -version` returns 7.x) | Campaign Pack builds will fail without it |
| 3. Repo-root `.env` has a valid `RUNWAY_API_KEY` for live recording | Real-mode pipeline |
| 4. `OPENAI_API_KEY` blank or absent (recommended) | Concepts stay mock + deterministic |
| 5. (Optional) Truncate gallery — `echo '[]' > backend/data/campaigns.json` | Clean start visually |
| 6. (Optional) DevTools → Application → Storage → Clear site data | Resets persisted settings to defaults |
| 7. (Optional) Pre-warm Vite — visit the page once before recording | Avoids first-load module fetch hitches |

Boot both servers:

```bash
# Terminal 1
cd backend && source .venv/bin/activate
uvicorn app.main:app --reload --port 8000

# Terminal 2
cd frontend && npm run dev
```

Confirm in `http://localhost:5173`:

- Header pill says `MOCK MODE` only if `OPENAI_API_KEY` is blank — that's
  expected; concepts mock is the demo configuration.
- Mode banner readiness chip reads **`demo ready · concepts mocked`**
  (emerald). If it reads `demo mode` (amber) you're missing the Runway
  key; flip to mock-mode fallback below or fix the `.env`.
- `Image Gen (Runway): real` and `Video Gen (Runway): real` pills are
  green.
- Optional `cap: 200,000` chip on the right (depending on Runway's
  current `/v1/organization` shape).

Stop talking to the terminals — everything else happens in the browser.

---

## Path A — 60–90 s mock-mode walkthrough (safest)

Use this if you want the cleanest, most repeatable recording with zero
real Runway risk.

Force fully-mocked mode in Terminal 1 before recording:

```bash
# Stop the running uvicorn (Ctrl+C), then:
RUNWAY_API_KEY= OPENAI_API_KEY= uvicorn app.main:app --port 8000
```

Mode banner readiness chip should read **`demo mode`** (amber).
Header reads `MOCK MODE`. Both Runway pills read `mock`.

| t (s) | Action | What the audience sees |
|---|---|---|
| 0:00 | Page load | Header, MOCK MODE chip, mode banner amber chip |
| 0:05 | Narrate the readiness chip + Image/Video Gen pills | "Everything you'll see is mocked — no API spend" |
| 0:15 | Type business `Local coffee shop`, product `Morning blend`, tone `cinematic`, audience `morning commuters` | Form fills |
| 0:30 | Click **Generate Ad Concepts** | Three concept cards, one with `recommended` |
| 0:35 | Click **Daily Ritual** | Card highlights, prompt drops into the panel |
| 0:40 | Note: Model `Gen-4 Turbo` (default), Source ratio `Landscape 1280×720`, Duration `5s` (locked) | Settings chip row reads `gen4_turbo · Landscape · 5s · reference image` |
| 0:45 | Paste a public image URL (e.g. `https://images.unsplash.com/photo-1453614512568-c4024d13c247`) | Reference image URL field populates |
| 0:50 | Click **Generate Video** | Mock task PENDING → RUNNING → SUCCEEDED in ~12 s |
| 1:05 | Click **Save campaign card** | Button reads `Saved · cached locally`; gallery card materializes |
| 1:10 | Scroll to the gallery card; narrate `cached locally` pill | Cache chip green |
| 1:15 | Click **Build Reels** | ~2 s, Reels card flips to `view ↗` + `ready` |
| 1:20 | Click **Build Square** | Pack pill `2/3` |
| 1:25 | Click **Build Landscape** | Pack pill `3/3 formats ready` |
| 1:30 | Click `view ↗` on each format in turn | Three MP4s open in new tabs at the right dimensions |

Total runtime: ~90 s with comfortable narration. Zero credits spent.

---

## Path B — live Runway hero recording (~3:30 minutes)

Use this if you want a hero "real Runway" recording with the genuinely
generated reference image and clip.

Backend stays in real mode (default `.env`). Mode banner readiness chip
must read **`demo ready · concepts mocked`** (emerald).

| t | Action | Notes |
|---|---|---|
| 0:00 | Page load | Confirm `demo ready · concepts mocked` chip + cap chip |
| 0:10 | Form: `Donkey Betz Coffee` / `Reels-ready cold brew` / `warm cinematic` / `morning commuters` | The hero scenario from PR D verification |
| 0:25 | **Generate Ad Concepts** → pick `Daily Ritual` | Mock concept; deterministic prompt |
| 0:35 | Settings — Model `Gen-4.5`, Source ratio `Reels / TikTok 720:1280`, Duration `5s` | Settings chip row updates |
| 0:45 | Click **Generate Reference Image** | Image generation usually finishes in 25–45 s |
| ~1:25 | Image renders inline + Reference Image URL fills with `/api/runway/image/<id>` | The image is also kept locally — gitignored |
| ~1:30 | Click **Generate Video** | Status pill PENDING → RUNNING |
| ~1:35–4:00 | Watch progress bar, narrate Runway is rendering | Gen-4.5 5 s typically: 2–3 min |
| ~4:00 | `SUCCEEDED` → inline `<video>` plays | Click play to confirm motion |
| ~4:05 | Click **Save campaign card** | Cache pill flips to `cached locally` |
| ~4:10 | Click **Build Reels** | ~1 s — no crop because source is 9:16 already |
| ~4:12 | Click **Build Landscape** | ~1–3 s — center-crop from 9:16 |
| ~4:15 | Click **Build Square** | ~1–3 s — center-crop from 9:16 |
| ~4:20 | Click `view ↗` on each format | Three MP4s open at 1280×720 / 720×1280 / 960×960 |

If the Runway video step takes too long mid-recording, stop the
recording, switch to **Path C — fallback** below, and start over.

---

## Path C — mock-mode fallback (if Runway is slow or down)

If anything in Path B stalls past ~3 min, abort and fall back without
losing the visual story:

1. Stop recording.
2. In Terminal 1, Ctrl+C the running uvicorn.
3. Re-launch in mock mode:
   ```bash
   RUNWAY_API_KEY= OPENAI_API_KEY= uvicorn app.main:app --port 8000
   ```
4. Reload the page. Mode banner readiness chip flips to `demo mode`.
5. Run **Path A** above. The same UI, same campaign pack, deterministic
   timings.

The recording will read as "we're showing the mock-mode demo path so
the recording stays predictable." Judges will already know mock mode
exists from the Mode banner.

---

## Click cheat sheet (no narration)

For a no-talk silent demo, here's the bare click order:

```
1. Type form fields                  (4 fields)
2. Generate Ad Concepts              (1 click)
3. Click "Daily Ritual" card         (1 click)
4. Pick model + ratio + duration     (3 selects)
5. Generate Reference Image          (1 click)            [live mode only]
6. Generate Video                    (1 click)
7. Wait for SUCCEEDED
8. Save campaign card                (1 click)
9. Build Reels                       (1 click)
10. Build Landscape                  (1 click)
11. Build Square                     (1 click)
12. View each format                 (3 clicks)
```

12 deliberate clicks total. Live-mode adds ~3 minutes of waiting; mock
mode adds ~12 s.

---

## Post-recording

- `git status` should still be clean — recordings live outside the
  repo.
- `backend/data/` will contain the new image PNG, cached MP4, and three
  finished MP4s from the recording. They're gitignored.
- If you re-record, optionally truncate `backend/data/campaigns.json`
  (`echo '[]' > backend/data/campaigns.json`) so the gallery starts
  fresh.

## Anti-patterns (don't do these on camera)

- **Don't show the `.env` file.** It contains the live API key.
- **Don't open DevTools network tab** unless you're explicitly demoing
  the API surface — judges may notice the key in `Authorization`
  headers (it's stripped from the frontend, but the backend logs the
  outbound URL).
- **Don't show the terminal output past the boot lines.** Backend logs
  include task IDs which look noisy and aren't part of the story.
- **Don't run the Playwright smoke during a demo session** — it'll
  pollute the gallery with `Local coffee shop` test entries.
- **Don't push generated media** — `git status` is the truth-source.
- **Don't explain WebRTC or Runway realtime sessions.** AdSpark uses
  the *async* `avatar_videos` endpoint by design — it's the reliable
  primitive that fits the existing campaign flow. Bringing up
  realtime / WebRTC mid-demo invites questions about a feature we
  intentionally didn't build.
- **Don't claim Avatar Host Clip "talks back" to the user.** It's a
  scripted spokesperson clip, not a chat session. Pitch it as a
  reusable presenter, not a Q&A bot.

---

## Path D — Live Avatar Host Demo (~3 min, real credits)

Use this when you want to highlight the Runway Avatar capability.
Builds on a saved campaign — either one you already have in the gallery
or one created via Path B beforehand.

Backend stays in real mode. Mode banner readiness chip should read
**`demo ready · concepts mocked`** (emerald). The campaign's
*Brand Spokesperson · Runway Avatar* subsection is visible on every
saved card.

| t | Action | What the audience sees |
|---|---|---|
| 0:00 | Scroll to a saved campaign in the gallery | Concept title, cached video, Campaign Pack pills |
| 0:05 | Narrate: "AdSpark turns this campaign image into a reusable AI brand spokesperson via Runway's Avatars endpoint." | Mode banner + saved card |
| 0:15 | Click **Create Brand Spokesperson** | Button shows `Creating Brand Spokesperson…`; ~30–45 s wait |
| 0:50 | (likely path) status flips to **failed** with "Runway rejected the reference image — typically because it does not contain a recognisable face." | Honest fallback messaging on screen |
| 0:55 | Narrate: "The campaign hero shot doesn't have a face, so we'll use our brand stock portrait instead." | Stay calm — this is the demo story |
| 1:00 | Click **Retry with stock portrait** | ~30–45 s wait |
| 1:35 | Avatar processed → status `ready`, thumbnail + avatar id appear next to the source label `stock portrait` | Visible Runway Avatar identity |
| 1:40 | Narrate: "Now we have a reusable brand spokesperson tied to this campaign." | |
| 1:50 | Click **Present Campaign** | `Recording Host Clip…`; ~10 s wait |
| 2:05 | Inline `<video>` plays the spokesperson speaking the scripted pitch | "Meet [Business]. [Hook]. [Caption]. [CTA]." |
| 2:30 | Optional: open `/api/campaigns/{id}/host-video` in a new tab | Direct video URL streams the same MP4 |

**Total credit spend: 1 avatar create (succeeded) + 1 avatar_video.**
~10–15 credits all-in — well under 0.05% of the 50k pool.

If you happen to be on a campaign whose reference image already has a
face (e.g., the same campaign image generated earlier was a portrait
shot), Phase 1 will go straight to `ready` without the failure step.
Either path tells the story.

### Fallback if Phase 2 stalls

If `Present Campaign` is taking longer than 60 s mid-demo:
- Cancel the recording, switch the backend to mock mode (Path C
  technique), reload, and run Path D from the same campaign — Phase 2
  in mock returns a placeholder MP4 in <2 s and the same UI works.
- The phase split means the avatar stays cached on the campaign record
  even after switching modes — the UI just labels new mock clips with
  a `mock placeholder` tag.

### What Path D demonstrates

- Runway is the *only* third-party Adspark uses, end-to-end:
  reference image (`gen4_image_turbo`) → ad video (`gen4.5` or
  `gen4_turbo`) → Brand Spokesperson Avatar (`/v1/avatars`) →
  Avatar Host Clip (`/v1/avatar_videos`).
- The avatar is **persistent** on the campaign record — judges can see
  the avatar id, voice preset, and image-source label staying put
  across multiple host-clip generations.
- The host clip is **cached locally** the same way the cached ad
  video is — saved campaigns survive Runway's presigned URL expiry.
- The mock fallback **mirrors both phases** so the same UX is
  demoable without any spend.
