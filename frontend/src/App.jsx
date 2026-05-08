import { useEffect, useRef, useState } from 'react'
import { api } from './api'
import CampaignForm from './components/CampaignForm.jsx'
import ConceptCards from './components/ConceptCards.jsx'
import PromptPreview from './components/PromptPreview.jsx'
import RunwayPanel from './components/RunwayPanel.jsx'
import CampaignGallery from './components/CampaignGallery.jsx'

const POLL_INTERVAL_MS = 5000
const POLL_MAX_ATTEMPTS = 60

export default function App() {
  const [health, setHealth] = useState(null)
  const [form, setForm] = useState(null)
  const [conceptResp, setConceptResp] = useState(null)
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [prompt, setPrompt] = useState('')
  const [task, setTask] = useState(null)
  const [campaigns, setCampaigns] = useState([])
  const [savedId, setSavedId] = useState(null)
  const [busy, setBusy] = useState({ concepts: false, runway: false })
  const [error, setError] = useState('')
  const pollRef = useRef({ active: false, attempts: 0 })

  useEffect(() => {
    api.health().then(setHealth).catch(() => setHealth({ status: 'down' }))
    api.listCampaigns().then((d) => setCampaigns(d.campaigns || [])).catch(() => {})
  }, [])

  const refreshCampaigns = () =>
    api.listCampaigns().then((d) => setCampaigns(d.campaigns || [])).catch(() => {})

  const handleConcepts = async (formValue) => {
    setError('')
    setForm(formValue)
    setBusy((b) => ({ ...b, concepts: true }))
    setConceptResp(null)
    setTask(null)
    setSavedId(null)
    try {
      const resp = await api.generateConcepts(formValue)
      setConceptResp(resp)
      setSelectedIndex(resp.recommended_index ?? 0)
      setPrompt(resp.runway_prompt || '')
    } catch (e) {
      setError(String(e))
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
          return
        }
      } catch (e) {
        setError(`Polling error: ${e}`)
      }
      if (pollRef.current.attempts >= POLL_MAX_ATTEMPTS) {
        pollRef.current.active = false
        setError('Polling timed out (5 min cap). Task may still be running on Runway.')
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
      const resp = await api.startRunway({ prompt_text: prompt, duration: 5, ratio: '1280:720' })
      setTask({ task_id: resp.task_id, status: resp.status, progress: 0, output: [], mock_mode: resp.mock_mode })
      startPolling(resp.task_id)
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy((b) => ({ ...b, runway: false }))
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
      setError(String(e))
    }
  }

  const mockBadge = health?.any_mock
  const concepts = conceptResp?.concepts

  return (
    <div className="min-h-full max-w-5xl mx-auto p-6 space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">
            AdSpark <span className="text-spark">Studio</span>
          </h1>
          <p className="text-sm text-zinc-400">Cinematic ad concepts → Runway video.</p>
        </div>
        {mockBadge && (
          <div
            title={`OpenAI mock: ${health.openai_mock} · Runway mock: ${health.runway_mock}`}
            className="rounded-full bg-amber-500/20 text-amber-300 text-xs px-3 py-1 font-mono"
          >
            MOCK MODE
          </div>
        )}
      </header>

      {error && (
        <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 text-rose-200 px-4 py-2 text-sm">
          {error}
        </div>
      )}

      <CampaignForm onSubmit={handleConcepts} busy={busy.concepts} />

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
          onGenerate={handleGenerateVideo}
          busy={busy.runway || (task && !['SUCCEEDED', 'FAILED', 'CANCELED'].includes(task.status))}
          disabled={busy.runway}
        />
      )}

      <RunwayPanel task={task} onSave={handleSaveCampaign} savedId={savedId} />

      <CampaignGallery campaigns={campaigns} onRefresh={refreshCampaigns} />

      <footer className="text-xs text-zinc-600 pt-6 border-t border-zinc-900">
        AdSpark Studio · hackathon build · {new Date().getFullYear()}
      </footer>
    </div>
  )
}
