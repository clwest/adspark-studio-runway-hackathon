import { useEffect, useState } from 'react'
import { api } from '../api'
import { friendlyError } from '../errors'
import CharacterCard from './CharacterCard.jsx'

const TEMPLATES = [
  { value: 'mascot', label: 'Mascot — animal/brand mascot' },
  { value: 'founder', label: 'Founder — indie brand spokesperson' },
  { value: 'coach', label: 'Coach — fitness / motivational' },
  { value: 'local_guide', label: 'Local Guide — small-business host' },
]

const VOICE_PRESETS = [
  'vincent', 'victoria', 'clara', 'drew', 'skye', 'max',
  'morgan', 'felix', 'mia', 'marcus', 'summer', 'ruby',
  'aurora', 'jasper', 'leo', 'adrian', 'nina', 'emma',
  'blake', 'david', 'maya', 'nathan', 'sam', 'georgia',
  'petra', 'adam', 'zach', 'violet', 'roman', 'luna',
]

const DEFAULT_FORM = {
  name: '',
  template: 'mascot',
  subject: '',
  style: '',
  personality: '',
  voice_preset: 'vincent',
}

/**
 * Character Studio panel (PR K).
 *
 * Top-level surface that owns the Character library + create flow.
 * Lives above the saved-campaigns gallery on the main page.
 *
 * Design locked in docs/research/CHARACTER_STUDIO_SPIKE.md §6.
 */
export default function CharacterStudio({ onCharactersChanged }) {
  const [characters, setCharacters] = useState([])
  const [loading, setLoading] = useState(true)
  const [errMsg, setErrMsg] = useState('')
  const [form, setForm] = useState({ ...DEFAULT_FORM })
  const [creating, setCreating] = useState(false)
  const [busyByChar, setBusyByChar] = useState({}) // { charId: 'portrait'|'avatar'|'delete' }
  const [showCreate, setShowCreate] = useState(false)

  const refresh = async () => {
    try {
      const resp = await api.listCharacters()
      setCharacters(resp.characters || [])
      setErrMsg('')
    } catch (e) {
      setErrMsg(friendlyError(e, 'Couldn’t load characters'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const setBusy = (id, action) =>
    setBusyByChar((m) => ({ ...m, [id]: action }))
  const clearBusy = (id) =>
    setBusyByChar((m) => {
      const { [id]: _, ...rest } = m
      return rest
    })

  const handleCreate = async (e) => {
    e?.preventDefault?.()
    if (!form.name.trim()) return
    setCreating(true)
    setErrMsg('')
    try {
      const created = await api.createCharacter({
        name: form.name.trim(),
        template: form.template,
        subject: form.subject.trim() || null,
        style: form.style.trim() || null,
        personality: form.personality.trim() || null,
        voice_preset: form.voice_preset,
      })
      // Auto-trigger the portrait so the user sees something immediately.
      setBusy(created.id, 'portrait')
      let next = created
      try {
        next = await api.generateCharacterPortrait(created.id, {})
      } catch (e2) {
        setErrMsg(friendlyError(e2, 'Portrait generation failed'))
      } finally {
        clearBusy(created.id)
      }
      setCharacters((cs) => [next, ...cs])
      setForm({ ...DEFAULT_FORM })
      setShowCreate(false)
      onCharactersChanged?.()
    } catch (e) {
      setErrMsg(friendlyError(e, 'Couldn’t create character'))
    } finally {
      setCreating(false)
    }
  }

  const handleGeneratePortrait = async (c) => {
    setBusy(c.id, 'portrait')
    try {
      const updated = await api.generateCharacterPortrait(c.id, {})
      setCharacters((cs) => cs.map((x) => (x.id === c.id ? updated : x)))
      onCharactersChanged?.()
    } catch (e) {
      setErrMsg(friendlyError(e, `Portrait failed for ${c.name}`))
    } finally {
      clearBusy(c.id)
    }
  }

  const handleCreateAvatar = async (c) => {
    setBusy(c.id, 'avatar')
    try {
      const updated = await api.createCharacterAvatar(c.id, {})
      setCharacters((cs) => cs.map((x) => (x.id === c.id ? updated : x)))
      onCharactersChanged?.()
    } catch (e) {
      setErrMsg(friendlyError(e, `Avatar create failed for ${c.name}`))
    } finally {
      clearBusy(c.id)
    }
  }

  const handleDelete = async (c) => {
    if (!confirm(`Delete character "${c.name}"? This is local only — the Runway avatar is not removed.`)) return
    setBusy(c.id, 'delete')
    try {
      await api.deleteCharacter(c.id)
      setCharacters((cs) => cs.filter((x) => x.id !== c.id))
      onCharactersChanged?.()
    } catch (e) {
      setErrMsg(friendlyError(e, `Delete failed for ${c.name}`))
    } finally {
      clearBusy(c.id)
    }
  }

  return (
    <div className="rounded-2xl ring-1 ring-pink-400/15 bg-studio-900/60 p-5 space-y-3 shadow-panel">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h3 className="font-semibold flex items-center gap-2">
            Character Studio
            <span
              className="text-[10px] rounded-full bg-pink-500/20 text-pink-300 px-2 py-0.5 font-mono"
              title="Reusable AI brand characters built from gen4_image_turbo + /v1/avatars"
            >
              Runway-powered
            </span>
          </h3>
          <p className="text-xs text-zinc-400">
            Generate a brand character once, reuse it across campaigns,
            host clips, and live conversations.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowCreate((s) => !s)}
          className="rounded-md bg-pink-500/80 hover:bg-pink-500 text-zinc-100 text-xs px-3 py-1.5 transition-colors"
        >
          {showCreate ? 'Cancel' : '+ Create Character'}
        </button>
      </div>

      {showCreate && (
        <form
          onSubmit={handleCreate}
          className="rounded-lg ring-1 ring-zinc-800 bg-zinc-950/60 p-3 space-y-2"
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <label className="text-xs text-zinc-300 flex flex-col gap-1">
              <span>Name <span className="text-rose-300">*</span></span>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Donk · The Founder · Brewster the Bear"
                className="rounded-md bg-zinc-950 border border-zinc-800 px-2 py-1 text-sm focus:border-pink-400 outline-none"
                required
                maxLength={80}
              />
            </label>

            <label className="text-xs text-zinc-300 flex flex-col gap-1">
              <span>Template</span>
              <select
                value={form.template}
                onChange={(e) => setForm({ ...form, template: e.target.value })}
                className="rounded-md bg-zinc-950 border border-zinc-800 px-2 py-1 text-sm focus:border-pink-400 outline-none"
              >
                {TEMPLATES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="text-xs text-zinc-300 flex flex-col gap-1">
              <span>Subject (optional)</span>
              <input
                type="text"
                value={form.subject}
                onChange={(e) => setForm({ ...form, subject: e.target.value })}
                placeholder="a friendly raccoon barista mascot"
                className="rounded-md bg-zinc-950 border border-zinc-800 px-2 py-1 text-sm focus:border-pink-400 outline-none"
              />
            </label>

            <label className="text-xs text-zinc-300 flex flex-col gap-1">
              <span>Style (optional)</span>
              <input
                type="text"
                value={form.style}
                onChange={(e) => setForm({ ...form, style: e.target.value })}
                placeholder="photorealistic stylised plush texture"
                className="rounded-md bg-zinc-950 border border-zinc-800 px-2 py-1 text-sm focus:border-pink-400 outline-none"
              />
            </label>

            <label className="text-xs text-zinc-300 flex flex-col gap-1">
              <span>Voice preset</span>
              <select
                value={form.voice_preset}
                onChange={(e) => setForm({ ...form, voice_preset: e.target.value })}
                className="rounded-md bg-zinc-950 border border-zinc-800 px-2 py-1 text-sm focus:border-pink-400 outline-none"
              >
                {VOICE_PRESETS.map((v) => (
                  <option key={v} value={v}>{v}</option>
                ))}
              </select>
            </label>

            <label className="text-xs text-zinc-300 flex flex-col gap-1 sm:col-span-2">
              <span>Personality (optional)</span>
              <input
                type="text"
                value={form.personality}
                onChange={(e) => setForm({ ...form, personality: e.target.value })}
                placeholder="Warm, neighborly, playful — knows the regulars by name"
                className="rounded-md bg-zinc-950 border border-zinc-800 px-2 py-1 text-sm focus:border-pink-400 outline-none"
                maxLength={600}
              />
            </label>
          </div>
          <div className="flex items-center gap-2 pt-1">
            <button
              type="submit"
              disabled={creating || !form.name.trim()}
              className="rounded-md bg-pink-500/80 hover:bg-pink-500 text-zinc-100 text-xs px-3 py-1.5 disabled:opacity-50"
            >
              {creating ? 'Creating + Generating Portrait…' : 'Create + Generate Portrait'}
            </button>
            <span className="text-[10px] text-zinc-500">
              Auto-runs portrait generation. Click "Create Runway Avatar"
              afterwards to bind to Runway.
            </span>
          </div>
        </form>
      )}

      {loading ? (
        <p className="text-xs text-zinc-500 italic">Loading characters…</p>
      ) : characters.length === 0 ? (
        <div className="rounded-lg ring-1 ring-pink-400/20 bg-pink-500/5 px-3 py-4 text-center">
          <p className="text-xs text-zinc-300">
            No characters yet.
          </p>
          <p className="text-[11px] text-zinc-500 mt-0.5">
            Click <span className="text-pink-300 font-semibold">+ Create Character</span>{' '}
            to build a reusable brand identity in ~1 minute.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2.5">
          {characters.map((c) => (
            <CharacterCard
              key={c.id}
              character={c}
              busyAction={busyByChar[c.id] || null}
              onGeneratePortrait={handleGeneratePortrait}
              onCreateAvatar={handleCreateAvatar}
              onDelete={handleDelete}
            />
          ))}
        </div>
      )}

      {errMsg && (
        <p className="text-[10px] text-rose-300" title={errMsg}>{errMsg}</p>
      )}
    </div>
  )
}
