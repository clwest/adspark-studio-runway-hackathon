import { useEffect, useState } from 'react'
import { api } from '../api'
import { friendlyError } from '../errors'
import {
  PORTRAIT_PROMPT_HELPER,
  buildCharacterPortraitPrompt,
} from '../characterPromptBuilder'
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
  // PR V — editable portrait prompt. Auto-derives from the other
  // fields until the user manually edits the textarea, then we lock
  // and stop overwriting (tracked via portrait_prompt_dirty).
  portrait_prompt: '',
  portrait_prompt_dirty: false,
}

/**
 * Character Studio panel (PR K).
 *
 * Top-level surface that owns the Character library + create flow.
 * Lives above the saved-campaigns gallery on the main page.
 *
 * Design locked in docs/research/CHARACTER_STUDIO_SPIKE.md §6.
 */
export default function CharacterStudio({
  onCharactersChanged,
  // PR U — Spokesperson-first flow: parent owns the active-character
  // state. Tile gets an "active" pill + a "Use as Spokesperson" button.
  activeCharacterId = null,
  onSetActive,
}) {
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

  // PR V — single field-update helper that also rebuilds the portrait
  // prompt while it's still in default mode. Once the user types in
  // the portrait textarea (which sets portrait_prompt_dirty=true), the
  // auto-rebuild stops and the user's text is preserved.
  const updateField = (field, value) =>
    setForm((f) => {
      const next = { ...f, [field]: value }
      const drives = ['template', 'subject', 'style', 'personality', 'name']
      if (drives.includes(field) && !f.portrait_prompt_dirty) {
        next.portrait_prompt = buildCharacterPortraitPrompt({
          template: next.template,
          subject: next.subject,
          style: next.style,
          personality: next.personality,
          name: next.name,
        })
      }
      return next
    })

  // Seed the portrait prompt the first time the form opens. Lives in
  // a useEffect so the form-shown ↔ form-hidden cycle re-seeds when
  // we go from "no input fields" to "ready to type".
  useEffect(() => {
    if (showCreate && !form.portrait_prompt && !form.portrait_prompt_dirty) {
      setForm((f) => ({
        ...f,
        portrait_prompt: buildCharacterPortraitPrompt({
          template: f.template,
          subject: f.subject,
          style: f.style,
          personality: f.personality,
          name: f.name,
        }),
      }))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showCreate])

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
      // PR V — pass the (possibly user-edited) portrait prompt through
      // to the generate-portrait route as `prompt_override`. Backend
      // build_prompt() short-circuits to the override when present,
      // so this string ends up posted to Runway gen4_image_turbo
      // verbatim. Falls through to backend's default templated build
      // when the textarea is empty.
      const overridePrompt = (form.portrait_prompt || '').trim()
      // Auto-trigger the portrait so the user sees something immediately.
      setBusy(created.id, 'portrait')
      let next = created
      try {
        next = await api.generateCharacterPortrait(
          created.id,
          overridePrompt ? { prompt_override: overridePrompt } : {},
        )
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
                onChange={(e) => updateField('name', e.target.value)}
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
                onChange={(e) => updateField('template', e.target.value)}
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
                onChange={(e) => updateField('subject', e.target.value)}
                placeholder="a friendly raccoon barista mascot"
                className="rounded-md bg-zinc-950 border border-zinc-800 px-2 py-1 text-sm focus:border-pink-400 outline-none"
              />
            </label>

            <label className="text-xs text-zinc-300 flex flex-col gap-1">
              <span>Style (optional)</span>
              <input
                type="text"
                value={form.style}
                onChange={(e) => updateField('style', e.target.value)}
                placeholder="photorealistic stylised plush texture"
                className="rounded-md bg-zinc-950 border border-zinc-800 px-2 py-1 text-sm focus:border-pink-400 outline-none"
              />
            </label>

            <label className="text-xs text-zinc-300 flex flex-col gap-1">
              <span>Voice preset</span>
              <select
                value={form.voice_preset}
                onChange={(e) => updateField('voice_preset', e.target.value)}
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
                onChange={(e) => updateField('personality', e.target.value)}
                placeholder="Warm, neighborly, playful — knows the regulars by name"
                className="rounded-md bg-zinc-950 border border-zinc-800 px-2 py-1 text-sm focus:border-pink-400 outline-none"
                maxLength={600}
              />
            </label>
          </div>

          {/* PR V — Editable Portrait Prompt textarea. Auto-derives
              from the fields above until the user types here, then
              the user's text is preserved + sent verbatim to Runway
              gen4_image_turbo as `prompt_override`. */}
          <div className="space-y-1.5 pt-1">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <label
                className="text-xs text-zinc-300 font-semibold"
                htmlFor="portrait-prompt"
              >
                Portrait Prompt
                <span className="ml-1.5 text-[10px] text-zinc-500 font-normal">
                  (sent to Runway text_to_image)
                </span>
              </label>
              {form.portrait_prompt_dirty && (
                <button
                  type="button"
                  onClick={() =>
                    setForm((f) => ({
                      ...f,
                      portrait_prompt: buildCharacterPortraitPrompt({
                        template: f.template,
                        subject: f.subject,
                        style: f.style,
                        personality: f.personality,
                        name: f.name,
                      }),
                      portrait_prompt_dirty: false,
                    }))
                  }
                  className="text-[10px] text-zinc-500 hover:text-pink-300"
                  title="Discard your edits and regenerate the prompt from the fields above"
                >
                  reset to default
                </button>
              )}
            </div>
            <textarea
              id="portrait-prompt"
              rows={5}
              value={form.portrait_prompt}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  portrait_prompt: e.target.value,
                  portrait_prompt_dirty: true,
                }))
              }
              maxLength={1000}
              placeholder="A front-facing head-and-shoulders portrait of [subject]. [style]. Centered face, eyes visible, mouth visible, no sunglasses, no props blocking the face. high detail, mascot portrait, avatar-ready."
              className="w-full rounded-md bg-zinc-950 ring-1 ring-zinc-800 px-2 py-1.5 text-xs leading-relaxed focus:ring-pink-400 outline-none font-mono"
              aria-describedby="portrait-prompt-helper"
            />
            <p
              id="portrait-prompt-helper"
              className="text-[10px] text-zinc-500 leading-relaxed"
            >
              {PORTRAIT_PROMPT_HELPER}
            </p>
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
              Auto-runs portrait generation with the prompt above. Click
              "Create Runway Avatar" afterwards to bind to Runway.
            </span>
          </div>
        </form>
      )}

      {loading ? (
        <CharactersLoadingSkeleton />
      ) : characters.length === 0 && !showCreate ? (
        <div className="flex flex-col items-center text-center gap-3 py-8 px-4 rounded-xl ring-1 ring-pink-400/20 bg-pink-500/5">
          <svg
            viewBox="0 0 64 64"
            aria-hidden="true"
            className="w-12 h-12 text-pink-300/70"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="32" cy="22" r="9" />
            <path d="M14 52c2-9 9-14 18-14s16 5 18 14" />
            <path d="M40 14l3-3M24 14l-3-3M32 11V7" />
          </svg>
          <div className="space-y-1">
            <div className="text-sm font-semibold text-zinc-200">
              No reusable characters yet
            </div>
            <p className="text-[11px] text-zinc-500 max-w-sm leading-relaxed">
              Create a mascot, founder, coach, or local guide. Runway
              generates the portrait via{' '}
              <span className="text-zinc-300 font-mono">gen4_image_turbo</span>{' '}
              and binds it to a reusable Avatar in about a minute.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowCreate(true)}
            className="text-[11px] rounded-md bg-pink-500/80 hover:bg-pink-500 text-zinc-100 px-3 py-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pink-400"
          >
            + Create your first character
          </button>
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
              // PR U — Spokesperson-first flow: pass active state +
              // toggle handler so the tile lights up + the action row
              // shows "Use as Spokesperson" / "Active" affordances.
              isActive={c.id === activeCharacterId}
              onSetActive={
                onSetActive
                  ? (next) => onSetActive(next ? c.id : null)
                  : undefined
              }
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

/**
 * PR Q (Phase 3) — pulsing tile placeholders rendered while we
 * fetch the character library on first mount. Three placeholders
 * is enough to fill the visible width on most viewports without
 * over-promising; once data arrives the real CharacterCards swap in.
 */
function CharactersLoadingSkeleton() {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2.5">
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="rounded-lg p-2 space-y-1.5 ring-1 ring-zinc-800 bg-zinc-950/50"
          aria-hidden="true"
        >
          <div className="aspect-square w-full rounded bg-zinc-800/60 animate-pulse" />
          <div className="h-2.5 w-3/4 rounded bg-zinc-800/60 animate-pulse" />
          <div className="h-2 w-1/2 rounded bg-zinc-800/40 animate-pulse" />
        </div>
      ))}
    </div>
  )
}
