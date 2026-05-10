import { useEffect, useRef, useState } from 'react'
import { api } from './api'
import { friendlyError, ERROR_HINTS } from './errors'
import {
  ALLOWED_DURATIONS,
  DEFAULT_SETTINGS,
  loadActiveSpokespersonId,
  loadSettings,
  saveActiveSpokespersonId,
  saveSettings,
} from './settings'
// PR T — structured Runway video prompt builder.
import { simplifyFromConcept } from './promptBuilder'
// PR AA / PR AC — deterministic Commercial Script generator. The
// length cap (COMMERCIAL_SCRIPT_MAX) lives inside PromptPreview where
// the editable textarea now renders; App.jsx only orchestrates
// generation + draft persistence.
import { buildCommercialScript } from './scriptBuilder'
import CampaignForm from './components/CampaignForm.jsx'
import ConceptCards from './components/ConceptCards.jsx'
import PromptPreview from './components/PromptPreview.jsx'
import RunwayPanel from './components/RunwayPanel.jsx'
import CampaignGallery from './components/CampaignGallery.jsx'
import ModeBanner from './components/ModeBanner.jsx'
import CharacterStudio from './components/CharacterStudio.jsx'
// PR BD — UX v2 feature flag (foundation for the spokesperson-first
// redesign). The flag itself is read on every getUxMode() call; the
// footer toggle below is the only surface that mutates it. Default
// remains the legacy v1 UX so v13 demos stay unchanged.
import { getUxMode, isUxV2, setUxMode, UX_MODES } from './uxFlag.js'
// PR BE — first gated v2 surface. SpokespersonStudio replaces the
// Stage 1 CharacterStudio panel when isUxV2() is true; all other
// stages remain untouched in this slice. Subsequent PRs (BF/BG/BH+)
// expand the v2 footprint into Knowledge/Appearances/lanes.
import SpokespersonStudio from './components/SpokespersonStudio.jsx'

const POLL_INTERVAL_MS = 5000
const POLL_MAX_ATTEMPTS = 60

// PR BS — Inferred-mode → CampaignCard tab id mapping for the
// v2 Appearances click-through. The inferred-mode set
// (Cinematic / Spokesperson Ad / Dialogue Scene / Storyboard /
// Realtime / Mixed / Draft) comes from SpokespersonCard's
// `inferCampaignMode(campaign)`; CampaignCard's `activeTab`
// state knows the seven tab ids (overview / visuals /
// character / voice / dialogue / realtime / exports). Returns
// null when the mode doesn't have a clear target — caller
// leaves activeTab alone in that case.
function _tabFromInferredMode(mode) {
  switch (String(mode || '').toLowerCase()) {
    case 'spokesperson':
    case 'spokesperson ad':
      return 'character'
    case 'cinematic':
    case 'storyboard':
      return 'visuals'
    case 'dialogue':
    case 'dialogue scene':
      return 'dialogue'
    case 'realtime':
      return 'realtime'
    case 'mixed':
    case 'draft':
      return 'overview'
    default:
      return null
  }
}

// Load once at module init so the very first render already reflects the
// persisted choices — avoids a default→restored flicker that the smoke test
// would otherwise race against on reload.
const PERSISTED = loadSettings()

export default function App() {
  const [health, setHealth] = useState(null)
  const [providerStatus, setProviderStatus] = useState(null)
  const [organization, setOrganization] = useState(null)
  const [form, setForm] = useState(null)
  const [conceptResp, setConceptResp] = useState(null)
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [prompt, setPrompt] = useState('')
  // PR AC — Commercial Script draft kept in App state so the script
  // editor lives in Stage 2 (before generation). Persists into the
  // campaign on first save; subsequent edits flow through the saved-
  // campaign Voice tab editor.
  const [commercialScriptDraft, setCommercialScriptDraft] = useState('')
  const [imageUrl, setImageUrl] = useState(PERSISTED.imageUrl)
  const [model, setModel] = useState(PERSISTED.model)
  const [ratio, setRatio] = useState(PERSISTED.ratio)
  const [duration, setDuration] = useState(PERSISTED.duration)
  const [textOnly, setTextOnly] = useState(PERSISTED.textOnly)
  const [generatedImage, setGeneratedImage] = useState(null) // { image_url, image_id, mock_mode, model }
  const [task, setTask] = useState(null)
  const [campaigns, setCampaigns] = useState([])
  // PR R — Character list feeds the Visual Source "Use Character" picker.
  // PR U — same list also drives the Stage-1 active spokesperson + the
  //        Stage-2 brief chip + the Stage-3 visual-source default + the
  //        save-flow attach. Single fetch, dual-purpose.
  const [characters, setCharacters] = useState([])
  // PR U follow-up: load the persisted spokesperson at module-init so
  // the very first render reflects the saved choice — same pattern
  // the prompt-panel settings use to avoid a default→restored flicker.
  const [activeCharacterId, setActiveCharacterIdState] = useState(
    loadActiveSpokespersonId(),
  )
  // Wrap the setter so any change writes through to localStorage.
  const setActiveCharacterId = (id) => {
    saveActiveSpokespersonId(id)
    setActiveCharacterIdState(id)
  }
  const [savedId, setSavedId] = useState(null)
  // PR Y — newest saved campaign id. Drives the "just saved" pill +
  // ring/glow + auto-scroll + Visuals-tab default in CampaignGallery,
  // so demos no longer target the wrong card when several saved
  // campaigns share the same business name.
  const [newestSavedId, setNewestSavedId] = useState(null)
  // PR BR — Click-through target for the v2 SpokespersonCard
  // Appearances tab. Setting this to a campaign id triggers a
  // scroll + flash highlight on the matching CampaignCard inside
  // the saved-gallery surface; the gallery clears it after the
  // animation lands. Independent of `newestSavedId` so a v2
  // jump never confuses the just-saved focus state.
  const [openCampaignId, setOpenCampaignId] = useState(null)
  // PR BS — companion target tab. When the v2 click-through
  // resolves an inferred mode (cinematic / spokesperson /
  // dialogue / storyboard / realtime / mixed / draft) we map
  // it to one of the existing CampaignCard tab ids
  // (overview / visuals / character / voice / dialogue /
  // realtime) so the saved card lands on the right surface
  // for the operator's intent. `null` = leave the card's
  // existing activeTab alone.
  const [openCampaignTab, setOpenCampaignTab] = useState(null)
  const handleV2OpenCampaign = (campaignId, inferredMode) => {
    setOpenCampaignId(campaignId)
    setOpenCampaignTab(_tabFromInferredMode(inferredMode))
  }
  const [busy, setBusy] = useState({ concepts: false, runway: false, image: false, upload: false })
  const [error, setError] = useState('')
  // PR AC follow-up — when an error appears, scroll its banner into
  // view so the user doesn't miss it after scrolling down to fill
  // the form. The banner sits at the top of the page; without this
  // effect a 422 from /api/concepts looked like "nothing happened".
  const errorBannerRef = useRef(null)
  useEffect(() => {
    if (!error || !errorBannerRef.current) return
    errorBannerRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [error])
  const pollRef = useRef({ active: false, attempts: 0 })

  useEffect(() => {
    api.health().then(setHealth).catch(() => setHealth({ status: 'down' }))
    api.providerStatus().then(setProviderStatus).catch(() => setProviderStatus(null))
    // Organization lookup is best-effort and entirely optional — never let
    // it surface as an error or block the rest of the page.
    api.organization().then(setOrganization).catch(() => setOrganization(null))
    api.listCampaigns().then((d) => setCampaigns(d.campaigns || [])).catch(() => {})
    // Character list is needed by both PR R's Visual Source picker and
    // PR U's Stage-1 active-spokesperson surface. Cached at module-init;
    // refreshCharacters() keeps it fresh after Studio events.
    api.listCharacters().then((d) => setCharacters(d.characters || [])).catch(() => {})
  }, [])

  // PR U — derived active spokesperson record. Drives the Stage 2 chip
  // + Stage 3 video-source default + save-flow attach.
  const activeCharacter = activeCharacterId
    ? (characters || []).find((c) => c.id === activeCharacterId) || null
    : null
  // If the active character is deleted (or vanishes from the library
  // refresh), drop the active id silently.
  useEffect(() => {
    if (activeCharacterId && !activeCharacter) {
      setActiveCharacterId(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCharacterId, characters])

  // Persist settings whenever the user changes any one of them. The clamp
  // inside saveSettings() guarantees we never write an invalid combination.
  useEffect(() => {
    saveSettings({ model, ratio, duration, textOnly, imageUrl })
  }, [model, ratio, duration, textOnly, imageUrl])

  const refreshCampaigns = () =>
    api.listCampaigns().then((d) => setCampaigns(d.campaigns || [])).catch(() => {})
  const refreshCharacters = () =>
    api.listCharacters().then((d) => setCharacters(d.characters || [])).catch(() => {})

  const handleConcepts = async (formValue) => {
    setError('')
    setForm(formValue)
    setBusy((b) => ({ ...b, concepts: true }))
    setConceptResp(null)
    setTask(null)
    setSavedId(null)
    setGeneratedImage(null)
    try {
      const resp = await api.generateConcepts(formValue)
      setConceptResp(resp)
      const idx = resp.recommended_index ?? 0
      setSelectedIndex(idx)
      // PR T — convert the picked concept into a structured Runway
      // prompt instead of using the dense single-shot prose the
      // backend's mock concept_service emits. The user can still
      // edit the textarea afterwards; this is just the seed.
      setPrompt(
        simplifyFromConcept({
          concept: resp.concepts?.[idx] || resp.concepts?.[0],
          form: formValue,
          ratio,
        }) || resp.runway_prompt || '',
      )
    } catch (e) {
      setError(friendlyError(e, ERROR_HINTS.concepts))
    } finally {
      setBusy((b) => ({ ...b, concepts: false }))
    }
  }

  const startPolling = (taskId) => {
    pollRef.current = { active: true, attempts: 0 }
    const tick = async () => {
      if (!pollRef.current.active) return
      pollRef.current.attempts += 1
      try {
        const t = await api.pollRunway(taskId)
        setTask(t)
        const terminal = ['SUCCEEDED', 'FAILED', 'CANCELED'].includes(t.status)
        if (terminal) {
          pollRef.current.active = false
          if (t.status !== 'SUCCEEDED') {
            setError(
              friendlyError(
                new Error(`200 OK: ${JSON.stringify({ detail: t.failure_reason || t.status })}`),
                ERROR_HINTS.video,
              ),
            )
          }
          return
        }
      } catch (e) {
        setError(friendlyError(e, ERROR_HINTS.poll))
      }
      if (pollRef.current.attempts >= POLL_MAX_ATTEMPTS) {
        pollRef.current.active = false
        setError(
          `${ERROR_HINTS.poll} — polling timed out at the 5-min cap. The task may still be running on Runway; check the Runway dashboard.`,
        )
        return
      }
      const jitter = Math.random() * 800
      setTimeout(tick, POLL_INTERVAL_MS + jitter)
    }
    tick()
  }

  const handleGenerateVideo = async () => {
    if (!prompt.trim()) return
    setError('')
    setBusy((b) => ({ ...b, runway: true }))
    setSavedId(null)
    try {
      const trimmedImage = imageUrl.trim()
      const useTextOnly = model === 'gen4.5' && textOnly
      const resp = await api.startRunway({
        prompt_text: prompt,
        prompt_image: useTextOnly ? null : trimmedImage || null,
        duration,
        ratio,
        model,
      })
      setTask({
        task_id: resp.task_id,
        status: resp.status,
        progress: 0,
        output: [],
        mock_mode: resp.mock_mode,
        endpoint: resp.endpoint,
        model: resp.model,
      })
      startPolling(resp.task_id)
    } catch (e) {
      setError(friendlyError(e, ERROR_HINTS.video))
    } finally {
      setBusy((b) => ({ ...b, runway: false }))
    }
  }

  const handleGenerateImage = async () => {
    if (!prompt.trim()) return
    setError('')
    setBusy((b) => ({ ...b, image: true }))
    try {
      const resp = await api.generateReferenceImage({
        prompt_text: prompt,
        ratio,
      })
      setGeneratedImage(resp)
      setImageUrl(resp.image_url)
    } catch (e) {
      setError(friendlyError(e, ERROR_HINTS.image))
    } finally {
      setBusy((b) => ({ ...b, image: false }))
    }
  }

  // PR R — Visual Source: upload path. Multipart upload returns the
  // same shape as generate-image so we plug it into the same state.
  const handleUploadImage = async (file) => {
    if (!file) return
    setError('')
    setBusy((b) => ({ ...b, upload: true }))
    try {
      const resp = await api.uploadImage(file)
      setGeneratedImage({ ...resp, source: 'upload' })
      setImageUrl(resp.image_url)
    } catch (e) {
      setError(friendlyError(e, ERROR_HINTS.image || 'Upload'))
    } finally {
      setBusy((b) => ({ ...b, upload: false }))
    }
  }

  const handleSaveCampaign = async () => {
    if (!conceptResp || !form || !task) return
    const concept = conceptResp.concepts[selectedIndex]
    try {
      const saved = await api.saveCampaign({
        business: form.business,
        product: form.product,
        tone: form.tone,
        audience: form.audience,
        selected_concept: concept,
        runway_prompt: prompt,
        runway_task_id: task.task_id,
        runway_model: task.model || model,
        reference_image_url: imageUrl.trim() || null,
        video_url: task.output?.[0] || null,
        social_post: {
          caption: concept.caption,
          cta: concept.cta,
          hashtags: [`#${form.business.replace(/\s+/g, '')}`, '#AdSparkStudio'],
        },
        // PR AC — persist the Stage-2 script in the same atomic save so
        // downstream Spokesperson Ad / Voiced Commercial paths speak it
        // without a follow-up POST /script call.
        commercial_script: (commercialScriptDraft || '').trim() || null,
      })
      // PR U — if the user picked an active spokesperson at Stage 1,
      // attach it to the new campaign immediately so the gallery card
      // opens with the Character tab already populated. The campaigns
      // POST doesn't accept character_id today, so we use the existing
      // attach-character route — same path the gallery card uses.
      if (activeCharacterId) {
        try {
          await api.attachCharacter(saved.id, activeCharacterId)
        } catch (attachErr) {
          // Non-fatal: campaign is saved; user can attach later from the
          // gallery card if this attach fails.
          console.warn('attach active spokesperson failed:', attachErr)
        }
      }
      setSavedId(saved.id)
      // PR Y — mark this id as the newest saved campaign so the gallery
      // can highlight, scroll-into-view, and pre-open Visuals on it.
      setNewestSavedId(saved.id)
      refreshCampaigns()
    } catch (e) {
      setError(friendlyError(e, ERROR_HINTS.save))
    }
  }

  const mockBadge = health?.any_mock
  const concepts = conceptResp?.concepts
  const isImageRequiredModel = model !== 'gen4.5'
  const requireImage = health
    ? health.runway_mock === false && (isImageRequiredModel || !textOnly)
    : false

  // Stage-progress derivation. Powers the visible "you are here"
  // indicator in the hero. Layout-only — does not gate any flow.
  // PR U — Spokesperson is now Stage 1, so the progress trail
  // matches the on-page stage order: Spokesperson → Brief → Visual → Saved.
  const briefDone = Boolean(form && conceptResp)
  const visualDone = Boolean(task && task.status === 'SUCCEEDED')
  const savedAny = (campaigns || []).length > 0
  // Spokesperson stage is "done" when an active spokesperson is set
  // OR the user has at least one character with a ready avatar (a
  // skip-but-have-characters state still reads as "started"). Skip
  // is also a valid path — the chip stays grey but doesn't gate anything.
  const characterReady = Boolean(activeCharacter) ||
    (characters || []).some((c) => ['ready', 'mock'].includes(c.runway_avatar_status || ''))
  const stages = [
    { key: 'spokesperson', label: 'Spokesperson', done: characterReady, current: !characterReady },
    { key: 'brief', label: 'Brief', done: briefDone, current: characterReady && !briefDone },
    { key: 'visual', label: 'Visual Ad', done: visualDone, current: briefDone && !visualDone },
    { key: 'saved', label: 'Saved', done: savedAny, current: visualDone && !savedAny },
  ]

  return (
    <div className="min-h-full">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
        {/* ---- Hero ---------------------------------------------------- */}
        <header className="space-y-4">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="space-y-1">
              <h1 className="text-4xl sm:text-5xl font-bold tracking-tight">
                AdSpark <span className="text-spark">Studio</span>
              </h1>
              <p className="text-sm sm:text-base text-zinc-400">
                AI Campaign + Character Studio — Runway-powered ads,
                reusable brand spokespeople, and live conversation in
                one click-driven flow.
              </p>
            </div>
            {mockBadge && (
              <div
                title={`OpenAI mock: ${health.openai_mock} · Runway mock: ${health.runway_mock}`}
                className="rounded-full bg-amber-500/20 text-amber-300 text-xs px-3 py-1 font-mono shrink-0"
              >
                MOCK MODE
              </div>
            )}
          </div>

          {/* Stage progress indicator — purely layout, no gating. */}
          <nav
            aria-label="demo path"
            className="flex items-center gap-1.5 sm:gap-3 flex-wrap"
          >
            {stages.map((s, i) => {
              const isLast = i === stages.length - 1
              return (
                <div key={s.key} className="flex items-center gap-1.5 sm:gap-2">
                  <span
                    className={`flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-mono font-semibold ring-1 ${
                      s.done
                        ? 'bg-spark/20 text-spark ring-spark/50'
                        : s.current
                        ? 'bg-zinc-800 text-zinc-200 ring-spark/40'
                        : 'bg-zinc-900 text-zinc-500 ring-zinc-700'
                    }`}
                    aria-current={s.current ? 'step' : undefined}
                  >
                    {s.done ? '✓' : i + 1}
                  </span>
                  <span
                    className={`text-xs sm:text-sm font-medium ${
                      s.done
                        ? 'text-zinc-200'
                        : s.current
                        ? 'text-zinc-100'
                        : 'text-zinc-500'
                    }`}
                  >
                    {s.label}
                  </span>
                  {!isLast && (
                    <span
                      className={`hidden sm:block h-px w-8 ${
                        s.done ? 'bg-spark/40' : 'bg-zinc-800'
                      }`}
                    />
                  )}
                </div>
              )
            })}
          </nav>
        </header>

        {error && (
          <div
            ref={errorBannerRef}
            role="alert"
            aria-live="assertive"
            className="rounded-lg border border-rose-500/40 bg-rose-500/10 text-rose-200 px-4 py-2 text-sm flex items-start justify-between gap-3"
          >
            <span>{error}</span>
            <button
              type="button"
              onClick={() => setError('')}
              className="text-xs text-rose-300/70 hover:text-rose-100"
              aria-label="dismiss error"
            >
              dismiss
            </button>
          </div>
        )}

        {/* ---- Mode / status row ------------------------------------- */}
        <ModeBanner
          health={health}
          providerStatus={providerStatus}
          organization={organization}
        />

        {/* ---- Stage 1 — Spokesperson (PR U) ------------------------- */}
        {/* PR R — anchor for "Open Character Studio →" smooth-scroll
            CTA inside the Visual Source picker's character branch. */}
        <div id="character-studio-anchor" />
        <Stage
          number={1}
          title="Spokesperson"
          meta="Choose the face of this campaign — or skip and add one later."
          accent="pink"
        >
          {/* PR BE — when the UX v2 flag is on, Stage 1 swaps in the
              SpokespersonStudio scaffold (gated v2 surface). Default
              path stays on the legacy CharacterStudio so v13 demos
              are unchanged. Both components consume the same handler
              shape so refresh wiring stays identical. */}
          {isUxV2() ? (
            <SpokespersonStudio
              onCharactersChanged={() => {
                refreshCharacters()
                refreshCampaigns()
              }}
              activeCharacterId={activeCharacterId}
              onSetActive={setActiveCharacterId}
              // PR BR — v2 Appearances click-through. Setting
              // openCampaignId triggers a scroll + flash highlight
              // on the matching CampaignCard inside the gallery
              // surface (same `campaigns` data both surfaces share).
              // PR BS — also resolves the target tab from the
              // inferred mode passed by SpokespersonCard.
              onOpenCampaign={handleV2OpenCampaign}
            />
          ) : (
            <CharacterStudio
              onCharactersChanged={() => {
                // PR U — keep both campaigns + characters fresh after Studio
                // events (create / portrait / avatar / delete / attach).
                refreshCharacters()
                refreshCampaigns()
              }}
              activeCharacterId={activeCharacterId}
              onSetActive={setActiveCharacterId}
            />
          )}
        </Stage>

        {/* ---- Stage 2 — Campaign Brief (PR U: was Stage 1) ---------- */}
        {/* PR AC' — Commercial Script editor moved into Stage 3
            PromptPreview alongside the Runway video prompt so the
            spoken + visual creative direction live together. Stage 2
            stays a simple brief form. */}
        <Stage number={2} title="Campaign Brief" meta="Who is the ad for?">
          {/* PR U — active spokesperson chip when set. */}
          {activeCharacter && (
            <div
              className="flex items-center gap-2 rounded-lg ring-1 ring-pink-400/40 bg-pink-500/5 p-2"
              aria-label="active spokesperson"
            >
              {activeCharacter.portrait_url && (
                <img
                  src={activeCharacter.portrait_url}
                  alt={activeCharacter.name}
                  className="w-10 h-10 rounded-md object-cover ring-1 ring-pink-400/40 bg-zinc-950"
                />
              )}
              <div className="min-w-0 flex-1 text-[11px]">
                <div className="text-pink-300 font-semibold truncate">
                  {activeCharacter.name}
                </div>
                <div className="text-zinc-500 font-mono text-[10px]">
                  {activeCharacter.template} · {activeCharacter.voice_preset} ·
                  avatar {activeCharacter.runway_avatar_status || 'pending'}
                </div>
                <div className="text-zinc-400">
                  This spokesperson will guide the visual prompt + auto-attach
                  to the saved campaign.
                </div>
              </div>
              <button
                type="button"
                onClick={() => setActiveCharacterId(null)}
                className="text-[10px] text-zinc-500 hover:text-pink-300 px-1.5"
                aria-label="clear active spokesperson"
                title="Clear the active spokesperson — falls back to per-campaign attach in the gallery"
              >
                clear
              </button>
            </div>
          )}
          <CampaignForm onSubmit={handleConcepts} busy={busy.concepts} />
        </Stage>

        {/* ---- Stage 3 — Generate Visual Ad (PR U: was Stage 2) ------ */}
        {(concepts || task) && (
          <Stage
            number={3}
            title="Generate Visual Ad"
            meta="Concept → prompt → silent visual cut → save"
          >
            {concepts && (
              <ConceptCards
                concepts={concepts}
                recommendedIndex={conceptResp.recommended_index}
                selectedIndex={selectedIndex}
                onSelect={(i) => {
                  setSelectedIndex(i)
                  // PR T — rebuild the structured prompt for the new
                  // concept selection. Pre-PR-T, switching concepts
                  // silently kept the previous prompt; this surfaced
                  // as a UX bug ("I picked Daily Ritual but the
                  // textarea still talks about the workshop").
                  if (form && conceptResp?.concepts?.[i]) {
                    setPrompt(
                      simplifyFromConcept({
                        concept: conceptResp.concepts[i],
                        form,
                        ratio,
                      }) || prompt,
                    )
                  }
                }}
              />
            )}

            {concepts && (
              <PromptPreview
                prompt={prompt}
                onChange={setPrompt}
                imageUrl={imageUrl}
                onImageUrlChange={(v) => {
                  setImageUrl(v)
                  // user typed a different URL — drop the cached generated-image badge
                  if (generatedImage && v !== generatedImage.image_url) {
                    setGeneratedImage(null)
                  }
                }}
                requireImage={requireImage}
                onGenerate={handleGenerateVideo}
                busy={busy.runway || (task && !['SUCCEEDED', 'FAILED', 'CANCELED'].includes(task.status))}
                disabled={busy.runway}
                // PR T — Simplify Prompt rebuilds the textarea from the
                // currently selected concept + form + ratio. Disabled
                // when there's no concept selected to derive from.
                canSimplifyPrompt={Boolean(form && conceptResp?.concepts?.[selectedIndex])}
                onSimplifyPrompt={() => {
                  if (!form || !conceptResp?.concepts?.[selectedIndex]) return
                  setPrompt(
                    simplifyFromConcept({
                      concept: conceptResp.concepts[selectedIndex],
                      form,
                      ratio,
                    }) || prompt,
                  )
                }}
                model={model}
                onModelChange={(m) => {
                  setModel(m)
                  // text-only is only valid for gen4.5 — collapse if model changes off it
                  if (m !== 'gen4.5') setTextOnly(false)
                  // clamp duration to what the new model supports (default to first
                  // allowed value if the current selection is no longer valid)
                  const allowed = ALLOWED_DURATIONS[m] || [DEFAULT_SETTINGS.duration]
                  if (!allowed.includes(duration)) setDuration(allowed[0])
                }}
                textOnly={textOnly}
                onTextOnlyChange={setTextOnly}
                onGenerateImage={handleGenerateImage}
                imageBusy={busy.image}
                imageMockMode={generatedImage?.mock_mode}
                imageSource={generatedImage?.source}
                onUploadImage={handleUploadImage}
                uploadBusy={busy.upload}
                characters={characters}
                ratio={ratio}
                onRatioChange={setRatio}
                duration={duration}
                onDurationChange={setDuration}
                // PR U — when an active spokesperson exists with a portrait,
                // pre-fill the imageUrl + adapt the Generate Video button.
                activeCharacter={activeCharacter}
                // PR AC' — Commercial Script editor lives in the
                // prompt panel now so the spoken + visual direction
                // sit together. App.jsx still owns the draft state so
                // it survives unmounting + persists into CampaignCreate
                // on first save.
                commercialScriptDraft={commercialScriptDraft}
                onCommercialScriptChange={setCommercialScriptDraft}
                onGenerateCommercialScript={() => {
                  if (!form) return
                  const synthCampaign = {
                    business: form.business,
                    product: form.product,
                    tone: form.tone,
                    audience: form.audience,
                    selected_concept:
                      conceptResp?.concepts?.[selectedIndex] || {},
                  }
                  const generated = buildCommercialScript({
                    campaign: synthCampaign,
                    character: activeCharacter,
                  })
                  if (generated) setCommercialScriptDraft(generated)
                }}
                canGenerateCommercialScript={Boolean(form)}
              />
            )}

            <RunwayPanel task={task} onSave={handleSaveCampaign} savedId={savedId} />
          </Stage>
        )}

        {/* PR R + PR U — Character Studio is now Stage 1 above. The
            old Stage 3 wrapper here is removed; the anchor div for
            "Open Character Studio →" smooth-scroll CTAs lives next to
            the new Stage 1 placement. */}


        {/* ---- Stage 4 — Saved Campaigns ----------------------------- */}
        <Stage
          number={4}
          title="Saved Campaigns"
          meta="Pack outputs · Brand Spokesperson · Voice Identity · Realtime"
        >
          <CampaignGallery
            campaigns={campaigns}
            onRefresh={refreshCampaigns}
            newestSavedId={newestSavedId}
            onClearNewest={() => setNewestSavedId(null)}
            // PR BR — v2 click-through receiver. Defaults to
            // null in v1 paths; the gallery's CampaignCard scrolls
            // + flashes when its id matches and clears via
            // onClearOpen so a re-click later re-fires the
            // animation cleanly.
            openCampaignId={openCampaignId}
            // PR BS — target tab id resolved from the inferred
            // mode. CampaignCard flips its activeTab when this
            // matches a known tab id; null leaves the existing
            // tab alone.
            openCampaignTab={openCampaignTab}
            onClearOpen={() => {
              setOpenCampaignId(null)
              setOpenCampaignTab(null)
            }}
          />
        </Stage>

        <footer className="text-xs text-zinc-600 pt-6 border-t border-zinc-900/60 flex items-center justify-between gap-2 flex-wrap">
          <span>
            AdSpark Studio · hackathon build · {new Date().getFullYear()}
          </span>
          {/* PR BD — UX v2 preview toggle. Reads the flag at render
              time so a deep-link with ?ux=v2 surfaces the "classic"
              escape hatch immediately. Reload after toggling so the
              entire app picks up the flag (future v2 components are
              gated at mount, not via hot-swappable hooks). */}
          <UxModeToggle />
        </footer>
      </div>
    </div>
  )
}

/**
 * PR BD — Tiny footer link that flips the UX v2 flag and reloads.
 * Renders one of two states depending on the resolved mode:
 *
 *   v1 (default) → "Try preview UX →"
 *   v2 active    → "Use classic UX"
 *
 * The flag itself lives in localStorage; toggling here writes the
 * new value and triggers a reload so every module re-resolves
 * `getUxMode()` from a clean slate. Future v2 components are
 * gated at mount, so a hot re-render isn't enough to swap them in.
 */
function UxModeToggle() {
  const mode = getUxMode()
  const target = mode === UX_MODES.V2 ? UX_MODES.V1 : UX_MODES.V2
  const label =
    mode === UX_MODES.V2 ? 'Use classic UX' : 'Try preview UX →'
  const handleClick = (e) => {
    e?.preventDefault?.()
    setUxMode(target)
    if (typeof window !== 'undefined') {
      // Strip ?ux=… so the next pageload's URL doesn't override the
      // flag we just persisted. Then full reload so v2-gated
      // components (PR BE+) remount with the fresh flag value.
      try {
        const url = new URL(window.location.href)
        url.searchParams.delete('ux')
        window.history.replaceState({}, '', url.toString())
      } catch {
        // Older browsers / restricted contexts — fall through to
        // a plain reload; the localStorage value still drives the
        // resolved mode.
      }
      window.location.reload()
    }
  }
  return (
    <button
      type="button"
      onClick={handleClick}
      data-testid="ux-mode-toggle"
      data-ux-mode={mode}
      className="text-[10px] text-zinc-500 hover:text-spark underline-offset-2 hover:underline"
      title={
        mode === UX_MODES.V2
          ? 'Switch back to the classic UX (PR BD).'
          : 'Preview the spokesperson-first UX (in development; PR BD foundation).'
      }
    >
      {label}
    </button>
  )
}

/**
 * Numbered stage wrapper. Lays out a section header (number + title +
 * meta) above the content slot. Keeps existing children unchanged —
 * the visual hierarchy comes entirely from this wrapper.
 *
 * Layout-only. No behaviour. Phase 1 of the UI redesign.
 */
function Stage({ number, title, meta, accent, children }) {
  const numberColor = accent === 'pink'
    ? 'bg-pink-500/15 text-pink-300 ring-pink-400/40'
    : 'bg-spark/15 text-spark ring-spark/30'
  return (
    <section className="space-y-3">
      <div className="flex items-baseline gap-3 flex-wrap">
        <span
          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-mono font-semibold ring-1 ${numberColor}`}
          aria-hidden="true"
        >
          {number}
        </span>
        <h2 className="stage-title">{title}</h2>
        {meta && <span className="stage-meta hidden sm:inline">{meta}</span>}
      </div>
      <div className="space-y-4">{children}</div>
    </section>
  )
}
