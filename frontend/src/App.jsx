import { useEffect, useRef, useState } from 'react'
import { api } from './api'
import { friendlyError, ERROR_HINTS } from './errors'
import {
  ALLOWED_DURATIONS,
  DEFAULT_SETTINGS,
  loadSettings,
  saveSettings,
} from './settings'
import CampaignForm from './components/CampaignForm.jsx'
import ConceptCards from './components/ConceptCards.jsx'
import PromptPreview from './components/PromptPreview.jsx'
import RunwayPanel from './components/RunwayPanel.jsx'
import CampaignGallery from './components/CampaignGallery.jsx'
import ModeBanner from './components/ModeBanner.jsx'
import CharacterStudio from './components/CharacterStudio.jsx'

const POLL_INTERVAL_MS = 5000
const POLL_MAX_ATTEMPTS = 60

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
  const [imageUrl, setImageUrl] = useState(PERSISTED.imageUrl)
  const [model, setModel] = useState(PERSISTED.model)
  const [ratio, setRatio] = useState(PERSISTED.ratio)
  const [duration, setDuration] = useState(PERSISTED.duration)
  const [textOnly, setTextOnly] = useState(PERSISTED.textOnly)
  const [generatedImage, setGeneratedImage] = useState(null) // { image_url, image_id, mock_mode, model }
  const [task, setTask] = useState(null)
  const [campaigns, setCampaigns] = useState([])
  const [savedId, setSavedId] = useState(null)
  const [busy, setBusy] = useState({ concepts: false, runway: false, image: false })
  const [error, setError] = useState('')
  const pollRef = useRef({ active: false, attempts: 0 })

  useEffect(() => {
    api.health().then(setHealth).catch(() => setHealth({ status: 'down' }))
    api.providerStatus().then(setProviderStatus).catch(() => setProviderStatus(null))
    // Organization lookup is best-effort and entirely optional — never let
    // it surface as an error or block the rest of the page.
    api.organization().then(setOrganization).catch(() => setOrganization(null))
    api.listCampaigns().then((d) => setCampaigns(d.campaigns || [])).catch(() => {})
  }, [])

  // Persist settings whenever the user changes any one of them. The clamp
  // inside saveSettings() guarantees we never write an invalid combination.
  useEffect(() => {
    saveSettings({ model, ratio, duration, textOnly, imageUrl })
  }, [model, ratio, duration, textOnly, imageUrl])

  const refreshCampaigns = () =>
    api.listCampaigns().then((d) => setCampaigns(d.campaigns || [])).catch(() => {})

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
      setSelectedIndex(resp.recommended_index ?? 0)
      setPrompt(resp.runway_prompt || '')
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
      })
      setSavedId(saved.id)
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
  const briefDone = Boolean(form && conceptResp)
  const visualDone = Boolean(task && task.status === 'SUCCEEDED')
  const savedAny = (campaigns || []).length > 0
  // Character stage is "done" once at least one character avatar is
  // ready. We don't track characters in App state today, so we infer
  // from any campaign having a character_id attached. Conservative:
  // treats Character Studio as in-progress until a campaign uses it.
  const characterDone = (campaigns || []).some((c) => Boolean(c.character_id))
  const stages = [
    { key: 'brief', label: 'Brief', done: briefDone, current: !briefDone },
    { key: 'visual', label: 'Visual Ad', done: visualDone, current: briefDone && !visualDone },
    { key: 'character', label: 'Character', done: characterDone, current: visualDone && !characterDone },
    { key: 'saved', label: 'Saved', done: savedAny, current: characterDone && !savedAny },
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
          <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 text-rose-200 px-4 py-2 text-sm flex items-start justify-between gap-3">
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

        {/* ---- Stage 1 — Campaign Brief ------------------------------ */}
        <Stage number={1} title="Campaign Brief" meta="Who is the ad for?">
          <CampaignForm onSubmit={handleConcepts} busy={busy.concepts} />
        </Stage>

        {/* ---- Stage 2 — Generate Visual Ad -------------------------- */}
        {(concepts || task) && (
          <Stage
            number={2}
            title="Generate Visual Ad"
            meta="Concept → prompt → silent visual cut → save"
          >
            {concepts && (
              <ConceptCards
                concepts={concepts}
                recommendedIndex={conceptResp.recommended_index}
                selectedIndex={selectedIndex}
                onSelect={setSelectedIndex}
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
                ratio={ratio}
                onRatioChange={setRatio}
                duration={duration}
                onDurationChange={setDuration}
              />
            )}

            <RunwayPanel task={task} onSave={handleSaveCampaign} savedId={savedId} />
          </Stage>
        )}

        {/* ---- Stage 3 — Character Studio ---------------------------- */}
        <Stage
          number={3}
          title="Character Studio"
          meta="Reusable brand mascot / founder / coach / local guide — bound to a Runway Avatar"
          accent="pink"
        >
          <CharacterStudio onCharactersChanged={refreshCampaigns} />
        </Stage>

        {/* ---- Stage 4 — Saved Campaigns ----------------------------- */}
        <Stage
          number={4}
          title="Saved Campaigns"
          meta="Pack outputs · Brand Spokesperson · Voice Identity · Realtime"
        >
          <CampaignGallery campaigns={campaigns} onRefresh={refreshCampaigns} />
        </Stage>

        <footer className="text-xs text-zinc-600 pt-6 border-t border-zinc-900/60">
          AdSpark Studio · hackathon build · {new Date().getFullYear()}
        </footer>
      </div>
    </div>
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
