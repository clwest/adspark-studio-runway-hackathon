import { useEffect, useRef, useState } from 'react'

import { api } from '../api'
import { friendlyError } from '../errors'
import {
  FEATURED_VOICE_PRESETS,
  describeVoicePreset,
} from '../voicePresets'

const TEMPLATES = [
  { value: 'mascot', label: 'Mascot — animal/brand mascot' },
  { value: 'founder', label: 'Founder — indie brand spokesperson' },
  { value: 'coach', label: 'Coach — fitness / motivational' },
  { value: 'local_guide', label: 'Local Guide — small-business host' },
]

const FEATURED_PRESETS_FIRST = (() => {
  const seen = new Set()
  const ordered = []
  for (const v of FEATURED_VOICE_PRESETS) {
    if (!seen.has(v)) {
      ordered.push(v)
      seen.add(v)
    }
  }
  // PR CB — keep the popular six on top; the legacy CharacterStudio
  // form still exposes the full 30-voice list for power users via
  // /legacy. The library-level modal stays scoped to featured
  // presets to keep the surface tight.
  return ordered
})()

const DEFAULT_FORM = {
  name: '',
  template: 'mascot',
  subject: '',
  voice_preset: FEATURED_PRESETS_FIRST[0] || 'vincent',
}

/**
 * PR CB — Create Spokesperson modal.
 *
 * Library-level "+ Create Spokesperson" CTA opens this modal.
 * Mirrors the legacy CharacterStudio create form's API contract
 * exactly (`api.createCharacter` body shape) but with
 * spokesperson-vocabulary copy and a tighter scope (4 fields
 * vs the legacy 6) so the homepage stays focused. After a
 * successful create, the portrait is auto-generated via
 * `api.generateCharacterPortrait` so the new tile renders
 * immediately with a face — same behaviour the legacy form has.
 *
 * Backend untouched. Reuses the existing
 *   POST /api/characters
 *   POST /api/characters/{id}/generate-portrait
 * routes verbatim.
 *
 * Props:
 *   isOpen      bool             modal visibility
 *   onClose     () => void       cancel / dismiss handler
 *   onCreated   (character) =>   fires after both POSTs land
 *                  Promise<void> (success path)
 */
export default function CreateSpokespersonModal({
  isOpen,
  onClose,
  onCreated,
}) {
  const [form, setForm] = useState(DEFAULT_FORM)
  const [busy, setBusy] = useState(false)
  const [phase, setPhase] = useState('idle')
  const [error, setError] = useState('')
  // PR CJ — when the create succeeds but portrait generation
  // fails (Runway upstream `portrait task FAILED`, transient
  // 502s, etc.), keep a handle on the partially-created
  // character so Retry / Continue can target it without
  // re-creating. Cleared on each fresh modal open.
  const [createdCharacter, setCreatedCharacter] = useState(null)
  const nameInputRef = useRef(null)

  useEffect(() => {
    if (!isOpen) return
    setForm(DEFAULT_FORM)
    setBusy(false)
    setPhase('idle')
    setError('')
    setCreatedCharacter(null)
    const t = window.setTimeout(() => {
      nameInputRef.current?.focus?.()
    }, 30)
    return () => window.clearTimeout(t)
  }, [isOpen])

  if (!isOpen) return null

  const updateField = (field, value) => {
    setForm((f) => ({ ...f, [field]: value }))
  }

  // PR CJ — separated so Retry can re-fire generation against
  // the already-created character without re-running the
  // create call (the backend record already exists; we just
  // need to retry the portrait task).
  const tryGeneratePortrait = async (characterId) => {
    setError('')
    setBusy(true)
    setPhase('portrait')
    try {
      const next = await api.generateCharacterPortrait(characterId, {})
      setPhase('done')
      // Successful retry — bubble the portrait-enriched record
      // up + close the modal.
      await onCreated?.(next)
    } catch (portraitErr) {
      // Stay in the modal so the user sees the error + has a
      // working Retry / Continue path. The created character
      // is still safe in the backend; we don't roll it back.
      setError(friendlyError(portraitErr, 'Portrait generation failed'))
      setPhase('portrait-failed')
    } finally {
      setBusy(false)
    }
  }

  const handleSubmit = async (e) => {
    e?.preventDefault?.()
    if (!form.name.trim() || busy) return
    setBusy(true)
    setError('')
    setCreatedCharacter(null)
    try {
      setPhase('creating')
      const created = await api.createCharacter({
        name: form.name.trim(),
        template: form.template,
        subject: form.subject.trim() || null,
        voice_preset: form.voice_preset,
      })
      // PR CJ — pin the created character so Retry / Continue
      // (in the portrait-failed branch) can target the same
      // record without round-tripping through `create` again.
      setCreatedCharacter(created)
      try {
        setPhase('portrait')
        const next = await api.generateCharacterPortrait(created.id, {})
        setPhase('done')
        await onCreated?.(next)
      } catch (portraitErr) {
        // PR CJ — STOP HERE. The previous behaviour silently
        // bubbled `created` (no portrait) up + closed the modal
        // via the parent's onClose, throwing away the error.
        // The user saw "tile appeared without portrait" with
        // no explanation. Now the modal stays open in the
        // `portrait-failed` phase so they can read the error,
        // retry, or continue without a portrait.
        setError(friendlyError(portraitErr, 'Portrait generation failed'))
        setPhase('portrait-failed')
      }
    } catch (err) {
      setError(friendlyError(err, 'Create spokesperson failed'))
      setPhase('failed')
    } finally {
      setBusy(false)
    }
  }

  // PR CJ — Retry the portrait task on the partially-created
  // character. No new `createCharacter` call is fired.
  const handleRetryPortrait = async () => {
    if (!createdCharacter || busy) return
    await tryGeneratePortrait(createdCharacter.id)
  }

  // PR CJ — Skip the portrait task and finalize the create.
  // The character ends up in the library without a portrait;
  // operator can click `Generate Portrait` from the tile or
  // workspace Identity tab to retry later.
  const handleSkipPortrait = async () => {
    if (!createdCharacter) return
    await onCreated?.(createdCharacter)
  }

  const presetDesc = describeVoicePreset(form.voice_preset)

  return (
    <div
      data-testid="create-spokesperson-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="create-spokesperson-modal-heading"
      className="fixed inset-0 z-40 flex items-center justify-center px-4"
    >
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={
          busy
            ? undefined
            : phase === 'portrait-failed'
            ? handleSkipPortrait
            : onClose
        }
        aria-hidden="true"
      />
      <form
        onSubmit={handleSubmit}
        className="relative w-full max-w-md rounded-xl ring-1 ring-pink-400/30 bg-studio-900 shadow-panel p-4 space-y-3"
      >
        <header className="space-y-1">
          <h2
            id="create-spokesperson-modal-heading"
            className="text-base font-semibold text-zinc-100 flex items-center gap-2"
          >
            <span aria-hidden="true">✨</span>
            Create Spokesperson
          </h2>
          <p className="text-[11px] text-zinc-400 leading-snug">
            Persistent AI spokespeople carry voice + portrait + persona
            across every campaign you run. Pick a template + voice
            now; everything else can be edited later.
          </p>
        </header>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <label className="text-xs text-zinc-300 flex flex-col gap-1 sm:col-span-2">
            <span>
              Name <span className="text-rose-300">*</span>
            </span>
            <input
              ref={nameInputRef}
              type="text"
              value={form.name}
              onChange={(e) => updateField('name', e.target.value)}
              placeholder="Brewster · The Founder · Coach Mia"
              data-testid="create-spokesperson-name"
              className="rounded-md bg-zinc-950 border border-zinc-800 px-2 py-1 text-sm focus:border-pink-400 outline-none"
              required
              maxLength={80}
              disabled={busy}
            />
          </label>

          <label className="text-xs text-zinc-300 flex flex-col gap-1">
            <span>Template</span>
            <select
              value={form.template}
              onChange={(e) => updateField('template', e.target.value)}
              data-testid="create-spokesperson-template"
              className="rounded-md bg-zinc-950 border border-zinc-800 px-2 py-1 text-sm focus:border-pink-400 outline-none"
              disabled={busy}
            >
              {TEMPLATES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>

          <label className="text-xs text-zinc-300 flex flex-col gap-1">
            <span>Voice preset</span>
            <select
              value={form.voice_preset}
              onChange={(e) => updateField('voice_preset', e.target.value)}
              data-testid="create-spokesperson-voice"
              className="rounded-md bg-zinc-950 border border-zinc-800 px-2 py-1 text-sm focus:border-pink-400 outline-none"
              disabled={busy}
            >
              {FEATURED_PRESETS_FIRST.map((v) => {
                const desc = describeVoicePreset(v)
                return (
                  <option key={v} value={v}>
                    {desc?.label || v}
                    {desc?.summary ? ` — ${desc.summary}` : ''}
                  </option>
                )
              })}
            </select>
          </label>

          <label className="text-xs text-zinc-300 flex flex-col gap-1 sm:col-span-2">
            <span>Subject (optional)</span>
            <input
              type="text"
              value={form.subject}
              onChange={(e) => updateField('subject', e.target.value)}
              placeholder="a friendly raccoon barista mascot"
              data-testid="create-spokesperson-subject"
              className="rounded-md bg-zinc-950 border border-zinc-800 px-2 py-1 text-sm focus:border-pink-400 outline-none"
              disabled={busy}
            />
          </label>
        </div>

        {presetDesc && (
          <div className="rounded-md ring-1 ring-pink-400/20 bg-pink-500/5 p-2 text-[11px] space-y-0.5">
            <div className="text-pink-200">
              <span className="font-semibold">{presetDesc.label}</span>
              {presetDesc.summary && (
                <span className="text-pink-300/80">
                  {' '}
                  — {presetDesc.summary}
                </span>
              )}
            </div>
            {presetDesc.gender && (
              <div className="text-pink-300/70 font-mono">
                gender · {presetDesc.gender}
              </div>
            )}
          </div>
        )}

        {error && (
          <p
            data-testid="create-spokesperson-error"
            className="text-[10px] text-rose-300 leading-snug"
            title={error}
          >
            {error}
          </p>
        )}

        {busy && (
          <p
            data-testid="create-spokesperson-status"
            className="text-[10px] text-zinc-400 leading-snug"
          >
            {phase === 'creating'
              ? 'creating spokesperson…'
              : phase === 'portrait'
              ? 'auto-generating portrait via Runway image…'
              : 'working…'}
          </p>
        )}

        {/* PR CJ — Portrait-failed footer. The character was
            created in the backend (line 99 above); we just
            couldn't get Runway to render the face. Operator
            can retry the portrait task in place, OR continue
            without a portrait (tile appears in library; the
            tile's existing Generate Portrait button + the
            workspace Identity tab both retry later without
            re-creating the record). */}
        {phase === 'portrait-failed' ? (
          <footer
            data-testid="create-spokesperson-portrait-failed"
            className="flex flex-col gap-2 pt-1"
          >
            <p className="text-[11px] text-rose-300 leading-snug">
              <span className="font-semibold">
                Portrait didn't render.
              </span>{' '}
              Your spokesperson{' '}
              <span className="font-mono text-rose-200">
                {createdCharacter?.name}
              </span>{' '}
              was saved — Runway just couldn't render the face this
              time. Retry in place, or save without a portrait
              (you can render it later from the spokesperson's
              Identity tab).
            </p>
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={handleSkipPortrait}
                disabled={busy}
                data-testid="create-spokesperson-skip-portrait"
                className="text-xs rounded-md ring-1 ring-zinc-700 bg-zinc-800/60 hover:bg-zinc-700 text-zinc-300 px-3 py-1.5 transition-colors disabled:opacity-60"
              >
                Save without portrait
              </button>
              <button
                type="button"
                onClick={handleRetryPortrait}
                disabled={busy}
                data-testid="create-spokesperson-retry-portrait"
                className="text-xs rounded-md bg-pink-500/80 hover:bg-pink-500 text-zinc-100 px-3 py-1.5 font-semibold transition-colors disabled:opacity-60"
              >
                {busy ? 'Retrying…' : 'Retry portrait'}
              </button>
            </div>
          </footer>
        ) : (
          <footer className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              data-testid="create-spokesperson-cancel"
              className="text-xs rounded-md ring-1 ring-zinc-700 bg-zinc-800/60 hover:bg-zinc-700 text-zinc-300 px-3 py-1.5 transition-colors disabled:opacity-60"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy || !form.name.trim()}
              data-testid="create-spokesperson-submit"
              className="text-xs rounded-md bg-pink-500/80 hover:bg-pink-500 text-zinc-100 px-3 py-1.5 font-semibold transition-colors disabled:opacity-60"
            >
              {busy ? 'Creating…' : 'Create Spokesperson'}
            </button>
          </footer>
        )}
      </form>
    </div>
  )
}
