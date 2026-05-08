# AdSpark Studio

A RunwayML hackathon app. Type a business idea → get 3 cinematic ad concepts,
a recommended Runway video prompt, a generated video, and a saved campaign card
with caption + CTA + social copy.

Runs in **mock mode by default** — no API keys required to demo.

## Quick start

### Backend
```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example ../.env    # repo-root .env is the single source of secrets;
                           # leave keys blank to stay in mock mode
uvicorn app.main:app --reload --port 8000
```

Backend lives at `http://localhost:8000`. Health check: `GET /health`.
OpenAPI docs: `http://localhost:8000/docs`.

### Frontend
```bash
cd frontend
npm install
npm run dev
```

Open `http://localhost:5173`. Vite proxies `/api` and `/health` to the
backend on port 8000.

## Hackathon demo script (≈3 minutes live)

This is the path that's been smoke-tested end-to-end against real Runway.
Have a public reference image URL ready before you start.

1. **Start backend** in one terminal:
   ```bash
   cd backend && source .venv/bin/activate
   uvicorn app.main:app --reload --port 8000
   ```
   The Mode banner in the app reads `/health` to label each provider.
2. **Start frontend** in a second terminal:
   ```bash
   cd frontend && npm run dev
   ```
   Open `http://localhost:5173`. Note the Mode banner — `Concepts: mock`
   and `Runway: real` is the typical hackathon configuration.
3. **Generate concepts.** Fill the form (e.g. business `Local coffee shop`,
   product `Morning blend`, tone `cinematic`, audience `morning commuters`)
   and click **Generate Ad Concepts**. Three cards appear; one is flagged
   `recommended`. The recommended Runway prompt drops into the prompt box.
4. **Pick a different concept if you want.** Clicking another card swaps
   selection (the prompt box stays editable).
5. **Paste a public image URL** into the Reference Image URL field. A
   product photo or storefront shot works. The field is required because
   Runway is in real `image_to_video` mode.
6. **Click Generate Video.** The Runway panel appears with a status pill
   and progress bar. Polling is automatic (≥5s + jitter, capped at 5 min).
   Real Gen-4 Turbo at duration 5 typically finishes in 8–30 seconds.
7. **Preview the video.** When status hits `SUCCEEDED`, the panel renders
   an inline `<video>` element with a Download link.
8. **Save the campaign.** Click **Save campaign card**. The Saved
   campaigns gallery below picks up the new card with the inline video
   preview, the prompt (collapsed under a `prompt` disclosure), and a
   small "URL may expire" tag — Runway artifact URLs are presigned and
   expire after ~a week, so demoing the same saved card the next morning
   may show a broken video. Re-generate or cache the asset for longer
   demos.

If anything misbehaves mid-demo, stop the Generate flow and switch the
Mode banner to fully mocked: remove `RUNWAY_API_KEY` from the repo-root
`.env`, restart `uvicorn`, and the same UI works on the in-memory mock
task with the public sample MP4.

## Demo mode (no keys)

With `RUNWAY_API_KEY` and `OPENAI_API_KEY` blank/missing:

- `/api/concepts` returns deterministic mock concepts derived from your inputs.
- `/api/runway/generate` returns a `mock_<id>` task that "completes" in ~12s
  with a public sample MP4 (Big Buck Bunny).
- The UI shows a **MOCK MODE** badge in the header.

This is the intended demo path. Nothing reaches a third-party API in mock mode.

## Adding real keys

Drop them into the **repo-root** `.env` (single source of local secrets):

```env
RUNWAY_API_KEY=rwk_...           # https://dev.runwayml.com
RUNWAY_API_VERSION=2024-11-06    # required header
RUNWAY_MODEL=gen4_turbo          # or gen4.5
OPENAI_API_KEY=sk-...            # optional, only for concept generation
OPENAI_MODEL=gpt-4o-mini
```

Restart `uvicorn`. The MOCK MODE badge disappears only when both keys are set;
if only Runway is set, the badge stays (concepts are still mocked).

> **Heads-up:** real Runway calls cost credits. The app never auto-generates —
> it only hits Runway when the user clicks **Generate Video**.

### Runway is image-to-video — `prompt_image` is required in real mode

Runway's `/v1/image_to_video` endpoint needs a public image URL to drive the
motion. The app enforces this:

- **Real mode** (`RUNWAY_API_KEY` set): the backend returns
  `400 prompt_image is required for Runway image_to_video real mode` if you
  call `POST /api/runway/generate` without `prompt_image`. The UI shows the
  reference-image field as **required**.
- **Mock mode** (no key): `prompt_image` is optional; the in-memory mock
  task ignores it and still "succeeds" with the sample MP4.

Pick any public image URL (product photo, storefront photo, campaign hero
image). The text prompt describes the motion and feel; the image anchors
the look.

## Browser smoke test (Playwright)

A single Chromium-driven end-to-end test exercises the polished mock flow
in a real browser. It loads the app at `:5173`, asserts the ModeBanner
mounts, fills the form, walks through Generate Concepts → Generate Video
(mock task) → Save → gallery, and asserts no uncaught page errors and
no unfiltered console errors.

**Required runtime** (start these in two separate terminals before running
the test):

```bash
# 1) backend in fully mocked mode (does NOT touch the repo-root .env;
#    the empty shell vars take precedence over the .env file values)
cd backend && source .venv/bin/activate
RUNWAY_API_KEY= OPENAI_API_KEY= uvicorn app.main:app --port 8000

# 2) Vite on :5173
cd frontend && npm run dev
```

Then run the test:

```bash
cd frontend && npm run test:e2e
```

What it verifies:
- `ModeBanner` renders the per-provider mock pills and the header MOCK
  MODE chip (proves `/health` round-trip works through the Vite proxy).
- `POST /api/concepts` returns 3 concept cards and exactly one
  `recommended` pill.
- `POST /api/runway/generate` produces a `mock_*` task and the polling
  loop reaches `SUCCEEDED` inside the 25 s expect timeout.
- Saving the campaign causes the `CampaignGallery` to render a new
  card with a `video ready` pill.
- No uncaught `pageerror` events. Console errors are filtered to drop
  unrelated `<video>` network noise (`BigBuckBunny`,
  `MEDIA_ELEMENT_ERROR`, `net::ERR_*`); anything else fails the test.

The test is **single-shot, single-worker** and never calls the real
Runway or OpenAI APIs. Don't run it against a backend with real keys
in the shell environment — the assertions specifically expect mock pills.

Test artifacts (`frontend/test-results/`, `frontend/playwright-report/`,
`frontend/.playwright/`) are gitignored.

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/health` | Liveness + mock-mode flags |
| `POST` | `/api/concepts` | `{business, product, tone, audience}` → 3 concepts + recommended Runway prompt |
| `POST` | `/api/runway/generate` | `{prompt_text, prompt_image?, duration, ratio}` → `{task_id, status}`. `prompt_image` is required in real mode (backend returns 400 if missing); optional in mock mode. |
| `GET` | `/api/runway/task/{task_id}` | Poll status; clients should use ≥5s interval + jitter |
| `POST` | `/api/campaigns` | Save a campaign card to local JSON |
| `GET` | `/api/campaigns` | List saved campaigns |

## Project layout

```
backend/
  app/
    main.py            FastAPI app + CORS + routers
    config.py          pydantic-settings (env-driven mock flags)
    models.py          Pydantic schemas
    services/
      concept_service.py   OpenAI + mock fallback
      runway_client.py     Real httpx client + in-memory mock store
      storage.py           JSON-file campaign store
    routers/
      concepts.py runway.py campaigns.py
  requirements.txt
  .env.example
frontend/
  vite.config.js       /api + /health proxy → :8000
  src/
    App.jsx            Orchestrates form → concepts → prompt → runway → save
    api.js             fetch wrapper
    components/        CampaignForm, ConceptCards, PromptPreview, RunwayPanel, CampaignGallery
docs/
  WHAT_IT_IS.md
  INVENTORY.md
  handoffs/SESSION_001_BOOTSTRAP.md
00-START-NEXT-SESSION.md
```

## Known limitations

- Single-process JSON file for storage (`backend/data/campaigns.json`). Fine
  for a hackathon, not for production.
- No image upload UI yet — Runway's image-to-video path benefits from a
  reference image; the request model already accepts `prompt_image`.
- Polling state is client-side only; refreshing the page loses the task id.
- No tests; manual smoke verified via curl + browser.

## Safety / hygiene

- API keys never leave the backend; the React app talks only to FastAPI.
- CORS is locked to `http://localhost:5173` by default.
- `.env` and `backend/data/` are gitignored.
- This repo is **not connected to `unified-donkey-betz`**. That project was
  inspected read-only for prompt-shape inspiration; nothing was copied
  verbatim and no edits were made there.
