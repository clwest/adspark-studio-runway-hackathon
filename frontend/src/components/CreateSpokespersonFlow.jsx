import { useEffect, useMemo, useRef, useState } from 'react'

import { api } from '../api'
import { friendlyError } from '../errors'
import {
  FEATURED_VOICE_PRESETS,
  VOICE_PRESET_DESCRIPTIONS,
  describeVoicePreset,
} from '../voicePresets'

const TEMPLATES = [
  {
    value: 'mascot',
    label: 'Mascot',
    summary: 'Animal / brand mascot — kinetic, expressive.',
  },
  {
    value: 'founder',
    label: 'Founder',
    summary: 'Polished spokesperson — credible, B2B.',
  },
  {
    value: 'coach',
    label: 'Coach',
    summary: 'Energetic motivator — fitness, hype.',
  },
  {
    value: 'local_guide',
    label: 'Local Guide',
    summary: 'Friendly small-business host — approachable.',
  },
]

// PR CK — Pre-defined style chips. Selected chips concatenate
// into Character.style. Operator can also type free-form into the
// fashion / wardrobe field which appends after the chips.
const STYLE_CHIPS = [
  'photorealistic',
  'stylized',
  'plush mascot',
  'editorial',
  'cinematic',
  'retro',
  'bright palette',
  'muted palette',
  'natural light',
  'studio light',
]

const SPEAKING_ENERGY_CHIPS = [
  'calm',
  'energetic',
  'playful',
  'measured',
  'fast',
  'deliberate',
]

// PR CK — All 30 voice presets in dropdown order. Featured 6 sit
// in the quick-pick row above so the popular options are one
// click away while the long tail stays in the select.
const ALL_VOICE_PRESETS = Object.keys(VOICE_PRESET_DESCRIPTIONS)

const STEPS = [
  { id: 1, title: 'Identity' },
  { id: 2, title: 'Visual Direction' },
  { id: 3, title: 'Voice' },
  { id: 4, title: 'Generate' },
]

const DEFAULT_FORM = {
  name: '',
  template: 'mascot',
  subject: '',
  personality: '',
  audience_vibe: '',
  style_chips: [],
  fashion: '',
  portrait_prompt: '',
  portrait_prompt_dirty: false,
  voice_preset: FEATURED_VOICE_PRESETS[0] || 'drew',
  speaking_energy: [],
  create_avatar: false,
  start_campaign: false,
}

/**
 * PR CK — Multi-step Create Spokesperson flow.
 *
 * Replaces PR CB's lightweight 4-field modal. Same external
 * surface (`isOpen` / `onClose` / `onCreated`); now mounts a
 * 4-step stepper inside the modal panel.
 *
 * Steps:
 *   1. Identity       — name, archetype, species/role, personality, audience vibe
 *   2. Visual         — style chips, fashion text, editable portrait prompt
 *   3. Voice          — full 30-preset selector + featured row + rich detail card + speaking energy
 *   4. Generate       — summary + Create button + optional avatar + optional starter campaign
 *
 * The form is a single state object across all steps. Back
 * navigation preserves input. Step 4 is the only step that
 * fires API calls; the PR CJ portrait-failed phase semantics
 * are preserved verbatim.
 *
 * Backend persistence:
 * - POST /api/characters with name, template, subject, style,
 *   personality, voice_preset.
 * - POST /api/characters/{id}/generate-portrait with
 *   prompt_override = the editable portrait_prompt.
 * - POST /api/characters/{id}/metadata to merge audience_vibe,
 *   visual_style_chips, speaking_energy, creation_flow into the
 *   existing Character.metadata dict (PR CK adds the route).
 * - POST /api/characters/{id}/create-avatar (optional) when
 *   the Step 4 avatar checkbox is set + portrait succeeded.
 *
 * Parent callback signature extends to:
 *   onCreated(character, { startCampaign: boolean }) => void
 * so the workspace can navigate to /spokespeople/{id} with
 * the mode modal pre-opened when the operator opted in.
 */
export default function CreateSpokespersonFlow({
  isOpen,
  onClose,
  onCreated,
}) {
  const [step, setStep] = useState(1)
  const [form, setForm] = useState(DEFAULT_FORM)
  const [busy, setBusy] = useState(false)
  // Phases: idle | creating | metadata | portrait | portrait-failed
  //       | avatar | done | failed
  const [phase, setPhase] = useState('idle')
  const [error, setError] = useState('')
  // Pin the partially-created character so PR CJ retry / skip
  // can target it without re-running create. Cleared on each
  // fresh modal open.
  const [createdCharacter, setCreatedCharacter] = useState(null)
  const nameInputRef = useRef(null)

  useEffect(() => {
    if (!isOpen) return
    setStep(1)
    // PR CK — eagerly set the derived portrait prompt at open
    // time so the Step 2 textarea is populated on first render
    // (the auto-derive useEffect below re-runs on field changes
    // but doesn't fire synchronously in time for the very first
    // smoke read of the textarea value).
    setForm({
      ...DEFAULT_FORM,
      portrait_prompt: derivePortraitPrompt(DEFAULT_FORM),
    })
    setBusy(false)
    setPhase('idle')
    setError('')
    setCreatedCharacter(null)
    const t = window.setTimeout(() => {
      nameInputRef.current?.focus?.()
    }, 30)
    return () => window.clearTimeout(t)
  }, [isOpen])

  // PR CK — auto-derive the portrait prompt from Step 1 + Step 2
  // inputs unless the user has hand-edited it (portrait_prompt_dirty).
  // Re-derives whenever the underlying source fields change.
  useEffect(() => {
    if (form.portrait_prompt_dirty) return
    setForm((f) => ({
      ...f,
      portrait_prompt: derivePortraitPrompt(f),
    }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    form.template,
    form.subject,
    form.style_chips.join('|'),
    form.fashion,
  ])

  if (!isOpen) return null

  const updateField = (field, value) => {
    setForm((f) => ({ ...f, [field]: value }))
  }

  const toggleChip = (key, chip) => {
    setForm((f) => {
      const list = Array.isArray(f[key]) ? f[key] : []
      const next = list.includes(chip)
        ? list.filter((c) => c !== chip)
        : [...list, chip]
      return { ...f, [key]: next }
    })
  }

  const handlePromptEdit = (value) => {
    setForm((f) => ({
      ...f,
      portrait_prompt: value,
      portrait_prompt_dirty: true,
    }))
  }

  const resetPortraitPrompt = () => {
    setForm((f) => ({
      ...f,
      portrait_prompt: derivePortraitPrompt(f),
      portrait_prompt_dirty: false,
    }))
  }

  // ---- step navigation -------------------------------------------
  const canAdvance = () => {
    if (step === 1) {
      return Boolean(form.name.trim()) && Boolean(form.template)
    }
    return true
  }
  const goNext = () => {
    if (!canAdvance() || busy) return
    if (step < STEPS.length) setStep(step + 1)
  }
  const goBack = () => {
    if (step > 1 && !busy) setStep(step - 1)
  }

  // ---- final submit (Step 4) ------------------------------------
  const buildStyleString = () => {
    const chips = (form.style_chips || []).join(', ')
    const fashion = (form.fashion || '').trim()
    return [chips, fashion].filter(Boolean).join('; ')
  }

  const buildPersonalityString = () => {
    const base = (form.personality || '').trim()
    const energy = (form.speaking_energy || []).join(', ')
    if (!energy) return base
    const suffix = `Speaks: ${energy}.`
    return base ? `${base}\n\n${suffix}` : suffix
  }

  const buildMetadataPatch = () => {
    const patch = {
      creation_flow: 'v2-stepper',
    }
    const vibe = (form.audience_vibe || '').trim()
    if (vibe) patch.audience_vibe = vibe
    if (form.style_chips?.length) {
      patch.visual_style_chips = form.style_chips.slice()
    }
    if (form.speaking_energy?.length) {
      patch.speaking_energy = form.speaking_energy.slice()
    }
    return patch
  }

  // PR CJ — retry the portrait task on the partially-created
  // character. No new createCharacter call.
  const tryGeneratePortrait = async (characterId) => {
    setError('')
    setBusy(true)
    setPhase('portrait')
    const promptOverride = form.portrait_prompt?.trim() || null
    try {
      const next = await api.generateCharacterPortrait(characterId, {
        prompt_override: promptOverride || undefined,
      })
      let final = next
      if (form.create_avatar) {
        try {
          setPhase('avatar')
          final = await api.createCharacterAvatar(characterId, {})
        } catch (avatarErr) {
          // Avatar bind is opt-in; failure is recoverable. Surface
          // inline + still hand the portrait-enriched record up.
          setError(
            friendlyError(
              avatarErr,
              'Portrait succeeded; Runway avatar bind failed (you can retry from the workspace).',
            ),
          )
        }
      }
      setPhase('done')
      await onCreated?.(final, { startCampaign: form.start_campaign })
    } catch (portraitErr) {
      setError(friendlyError(portraitErr, 'Portrait generation failed'))
      setPhase('portrait-failed')
    } finally {
      setBusy(false)
    }
  }

  const handleGenerate = async () => {
    if (busy) return
    setBusy(true)
    setError('')
    setCreatedCharacter(null)
    try {
      setPhase('creating')
      const created = await api.createCharacter({
        name: form.name.trim(),
        template: form.template,
        subject: form.subject.trim() || null,
        style: buildStyleString() || null,
        personality: buildPersonalityString() || null,
        voice_preset: form.voice_preset,
      })
      setCreatedCharacter(created)
      // Persist metadata via the new PR CK route. Best-effort:
      // a metadata-write failure must NOT block portrait gen.
      try {
        setPhase('metadata')
        await api.patchCharacterMetadata(created.id, buildMetadataPatch())
      } catch (metaErr) {
        // Don't fail the whole flow over metadata; just log.
        // The character is still created and usable.
        // eslint-disable-next-line no-console
        console.warn('metadata patch failed', metaErr)
      }
      // Now fire the portrait task (with optional avatar follow-up).
      await tryGeneratePortrait(created.id)
    } catch (err) {
      setError(friendlyError(err, 'Create spokesperson failed'))
      setPhase('failed')
      setBusy(false)
    }
  }

  // PR CJ — Retry the portrait task on the partially-created
  // character. Reused from PR CJ.
  const handleRetryPortrait = async () => {
    if (!createdCharacter || busy) return
    await tryGeneratePortrait(createdCharacter.id)
  }

  const handleSkipPortrait = async () => {
    if (!createdCharacter) return
    await onCreated?.(createdCharacter, {
      startCampaign: form.start_campaign,
    })
  }

  const handleBackdropClick = () => {
    if (busy) return
    if (phase === 'portrait-failed') {
      handleSkipPortrait()
      return
    }
    onClose?.()
  }

  // Final-step status copy.
  const phaseStatus =
    busy && phase === 'creating'
      ? 'creating spokesperson…'
      : busy && phase === 'metadata'
      ? 'saving creative direction…'
      : busy && phase === 'portrait'
      ? 'rendering portrait via Runway image…'
      : busy && phase === 'avatar'
      ? 'binding Runway avatar…'
      : phase === 'done'
      ? 'done — saving to library…'
      : ''

  const presetDesc = describeVoicePreset(form.voice_preset)

  return (
    <div
      data-testid="create-spokesperson-flow"
      role="dialog"
      aria-modal="true"
      aria-labelledby="create-spokesperson-flow-heading"
      className="fixed inset-0 z-40 flex items-center justify-center px-4"
    >
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={handleBackdropClick}
        aria-hidden="true"
      />
      <div
        className="relative w-full max-w-lg rounded-xl ring-1 ring-pink-400/30 bg-studio-900 shadow-panel p-4 space-y-3 max-h-[85vh] overflow-y-auto"
      >
        <header className="space-y-1">
          <h2
            id="create-spokesperson-flow-heading"
            className="text-base font-semibold text-zinc-100 flex items-center gap-2"
          >
            <span aria-hidden="true">✨</span>
            Create Spokesperson
          </h2>
          <ProgressDots step={step} total={STEPS.length} />
          <p
            data-testid="create-spokesperson-step-title"
            className="text-[11px] text-zinc-400 leading-snug"
          >
            Step {step} of {STEPS.length} · {STEPS[step - 1].title}
          </p>
        </header>

        {step === 1 && (
          <Step1Identity
            form={form}
            updateField={updateField}
            nameInputRef={nameInputRef}
          />
        )}
        {step === 2 && (
          <Step2Visual
            form={form}
            updateField={updateField}
            toggleChip={toggleChip}
            handlePromptEdit={handlePromptEdit}
            resetPortraitPrompt={resetPortraitPrompt}
          />
        )}
        {step === 3 && (
          <Step3Voice
            form={form}
            updateField={updateField}
            toggleChip={toggleChip}
            presetDesc={presetDesc}
          />
        )}
        {step === 4 && (
          <Step4Generate
            form={form}
            updateField={updateField}
            phase={phase}
            phaseStatus={phaseStatus}
            createdCharacter={createdCharacter}
          />
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

        {phaseStatus && (
          <p
            data-testid="create-spokesperson-status"
            className="text-[10px] text-zinc-400 leading-snug"
          >
            {phaseStatus}
          </p>
        )}

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
          <footer className="flex items-center justify-between gap-2 pt-1">
            <button
              type="button"
              onClick={step === 1 ? onClose : goBack}
              disabled={busy}
              data-testid={
                step === 1
                  ? 'create-spokesperson-cancel'
                  : 'create-spokesperson-back'
              }
              className="text-xs rounded-md ring-1 ring-zinc-700 bg-zinc-800/60 hover:bg-zinc-700 text-zinc-300 px-3 py-1.5 transition-colors disabled:opacity-60"
            >
              {step === 1 ? 'Cancel' : '← Back'}
            </button>
            {step < STEPS.length ? (
              <button
                type="button"
                onClick={goNext}
                disabled={busy || !canAdvance()}
                data-testid="create-spokesperson-next"
                className="text-xs rounded-md bg-pink-500/80 hover:bg-pink-500 text-zinc-100 px-3 py-1.5 font-semibold transition-colors disabled:opacity-60"
              >
                Next →
              </button>
            ) : (
              <button
                type="button"
                onClick={handleGenerate}
                disabled={busy || !form.name.trim()}
                data-testid="create-spokesperson-submit"
                className="text-xs rounded-md bg-pink-500/80 hover:bg-pink-500 text-zinc-100 px-3 py-1.5 font-semibold transition-colors disabled:opacity-60"
              >
                {busy ? 'Working…' : 'Create Spokesperson'}
              </button>
            )}
          </footer>
        )}
      </div>
    </div>
  )
}

function ProgressDots({ step, total }) {
  return (
    <div
      data-testid="create-spokesperson-progress"
      data-step={step}
      data-total={total}
      className="flex items-center gap-1 pt-0.5"
    >
      {Array.from({ length: total }).map((_, i) => (
        <span
          key={i}
          className={
            'h-1.5 w-6 rounded-full transition-colors ' +
            (i < step
              ? 'bg-pink-500/80'
              : i === step - 1
              ? 'bg-pink-400/40'
              : 'bg-zinc-700')
          }
        />
      ))}
    </div>
  )
}

function Step1Identity({ form, updateField, nameInputRef }) {
  return (
    <section
      data-testid="create-spokesperson-step-1"
      className="space-y-2"
    >
      <p className="text-[11px] text-zinc-400 leading-snug">
        Spokespeople carry voice, portrait, and persona across every
        campaign you make. Define who they are first.
      </p>
      <label className="text-xs text-zinc-300 flex flex-col gap-1">
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
        />
      </label>

      <div className="space-y-1">
        <span className="text-xs text-zinc-300">Archetype</span>
        <div
          className="grid grid-cols-2 gap-1.5"
          data-testid="create-spokesperson-template"
        >
          {TEMPLATES.map((t) => {
            const active = form.template === t.value
            return (
              <button
                key={t.value}
                type="button"
                data-testid={`create-spokesperson-template-${t.value}`}
                data-active={active ? 'true' : 'false'}
                onClick={() => updateField('template', t.value)}
                className={
                  'text-left rounded-lg ring-1 px-2 py-1.5 transition-colors ' +
                  (active
                    ? 'ring-pink-400/50 bg-pink-500/15 text-pink-100'
                    : 'ring-zinc-800 bg-zinc-950/40 text-zinc-300 hover:ring-pink-400/30')
                }
              >
                <div className="text-xs font-semibold">{t.label}</div>
                <div className="text-[10px] text-zinc-500 leading-snug">
                  {t.summary}
                </div>
              </button>
            )
          })}
        </div>
      </div>

      <label className="text-xs text-zinc-300 flex flex-col gap-1">
        <span>Species or role</span>
        <textarea
          value={form.subject}
          onChange={(e) => updateField('subject', e.target.value)}
          placeholder="a friendly raccoon barista mascot · a 40-something fintech founder"
          data-testid="create-spokesperson-subject"
          rows={2}
          maxLength={300}
          className="rounded-md bg-zinc-950 border border-zinc-800 px-2 py-1 text-xs focus:border-pink-400 outline-none resize-none"
        />
      </label>

      <label className="text-xs text-zinc-300 flex flex-col gap-1">
        <span>Personality</span>
        <textarea
          value={form.personality}
          onChange={(e) => updateField('personality', e.target.value)}
          placeholder="How do they talk and act? What's their tone? Confident, calm, playful…?"
          data-testid="create-spokesperson-personality"
          rows={3}
          maxLength={500}
          className="rounded-md bg-zinc-950 border border-zinc-800 px-2 py-1 text-xs focus:border-pink-400 outline-none resize-none"
        />
      </label>

      <label className="text-xs text-zinc-300 flex flex-col gap-1">
        <span>
          Audience vibe{' '}
          <span className="text-zinc-500">(optional)</span>
        </span>
        <textarea
          value={form.audience_vibe}
          onChange={(e) => updateField('audience_vibe', e.target.value)}
          placeholder="Who are they speaking to? Founders, contractors, creators…"
          data-testid="create-spokesperson-audience-vibe"
          rows={2}
          maxLength={200}
          className="rounded-md bg-zinc-950 border border-zinc-800 px-2 py-1 text-xs focus:border-pink-400 outline-none resize-none"
        />
      </label>
    </section>
  )
}

function Step2Visual({
  form,
  updateField,
  toggleChip,
  handlePromptEdit,
  resetPortraitPrompt,
}) {
  return (
    <section
      data-testid="create-spokesperson-step-2"
      className="space-y-2"
    >
      <p className="text-[11px] text-zinc-400 leading-snug">
        How should the portrait read? Pick style chips and write a
        wardrobe note. The full portrait prompt below auto-derives —
        edit it directly to take control.
      </p>

      <div className="space-y-1">
        <span className="text-xs text-zinc-300">Style</span>
        <div
          data-testid="create-spokesperson-style-chips"
          className="flex flex-wrap gap-1"
        >
          {STYLE_CHIPS.map((chip) => {
            const active = form.style_chips.includes(chip)
            return (
              <button
                key={chip}
                type="button"
                onClick={() => toggleChip('style_chips', chip)}
                data-testid={`create-spokesperson-style-chip-${chip.replace(/\s+/g, '-')}`}
                data-active={active ? 'true' : 'false'}
                className={
                  'text-[10px] rounded-full px-2 py-0.5 font-mono transition-colors ' +
                  (active
                    ? 'bg-pink-500/30 text-pink-100 ring-1 ring-pink-400/50'
                    : 'bg-zinc-800/60 text-zinc-400 ring-1 ring-zinc-700 hover:text-zinc-200')
                }
              >
                {chip}
              </button>
            )
          })}
        </div>
      </div>

      <label className="text-xs text-zinc-300 flex flex-col gap-1">
        <span>
          Fashion / wardrobe{' '}
          <span className="text-zinc-500">(optional)</span>
        </span>
        <input
          type="text"
          value={form.fashion}
          onChange={(e) => updateField('fashion', e.target.value)}
          placeholder="casual flannel-or-polo · blazer-or-suit · streetwear"
          data-testid="create-spokesperson-fashion"
          maxLength={120}
          className="rounded-md bg-zinc-950 border border-zinc-800 px-2 py-1 text-xs focus:border-pink-400 outline-none"
        />
      </label>

      <label className="text-xs text-zinc-300 flex flex-col gap-1">
        <span className="flex items-center justify-between gap-2">
          <span>Portrait prompt</span>
          {form.portrait_prompt_dirty && (
            <button
              type="button"
              onClick={resetPortraitPrompt}
              data-testid="create-spokesperson-reset-prompt"
              className="text-[10px] text-zinc-500 hover:text-pink-300 underline-offset-2 hover:underline"
            >
              Reset to auto
            </button>
          )}
        </span>
        <textarea
          value={form.portrait_prompt}
          onChange={(e) => handlePromptEdit(e.target.value)}
          placeholder="Auto-fills from your earlier choices. Edit to take control."
          data-testid="create-spokesperson-portrait-prompt"
          data-dirty={form.portrait_prompt_dirty ? 'true' : 'false'}
          rows={5}
          maxLength={1000}
          className="rounded-md bg-zinc-950 border border-zinc-800 px-2 py-1 text-xs focus:border-pink-400 outline-none resize-y font-mono leading-snug"
        />
        <p className="text-[10px] text-zinc-500 leading-snug">
          This prompt goes straight to Runway image. Auto-derives from
          archetype + species + style until you edit; reset above
          reverts.
        </p>
      </label>
    </section>
  )
}

function Step3Voice({ form, updateField, toggleChip, presetDesc }) {
  return (
    <section
      data-testid="create-spokesperson-step-3"
      className="space-y-2"
    >
      <p className="text-[11px] text-zinc-400 leading-snug">
        Pick how this spokesperson sounds. The voice character below
        describes the personality of each preset.
      </p>

      <div className="space-y-1">
        <span className="text-xs text-zinc-300">Featured voices</span>
        <div
          data-testid="create-spokesperson-voice-featured"
          className="flex flex-wrap gap-1"
        >
          {FEATURED_VOICE_PRESETS.map((id) => {
            const active = form.voice_preset === id
            const desc = describeVoicePreset(id)
            return (
              <button
                key={id}
                type="button"
                onClick={() => updateField('voice_preset', id)}
                data-testid={`create-spokesperson-voice-featured-${id}`}
                data-active={active ? 'true' : 'false'}
                className={
                  'text-[10px] rounded-full px-2 py-0.5 font-mono transition-colors ' +
                  (active
                    ? 'bg-pink-500/30 text-pink-100 ring-1 ring-pink-400/50'
                    : 'bg-zinc-800/60 text-zinc-400 ring-1 ring-zinc-700 hover:text-zinc-200')
                }
                title={desc?.summary || id}
              >
                {desc?.label || id}
              </button>
            )
          })}
        </div>
      </div>

      <label className="text-xs text-zinc-300 flex flex-col gap-1">
        <span>All voice presets</span>
        <select
          value={form.voice_preset}
          onChange={(e) => updateField('voice_preset', e.target.value)}
          data-testid="create-spokesperson-voice"
          className="rounded-md bg-zinc-950 border border-zinc-800 px-2 py-1 text-sm focus:border-pink-400 outline-none"
        >
          {ALL_VOICE_PRESETS.map((id) => {
            const desc = describeVoicePreset(id)
            return (
              <option key={id} value={id}>
                {desc?.label || id}
                {desc?.summary ? ` — ${desc.summary}` : ''}
              </option>
            )
          })}
        </select>
      </label>

      {presetDesc && (
        <div
          data-testid="create-spokesperson-voice-detail"
          data-preset={form.voice_preset}
          className="rounded-md ring-1 ring-pink-400/20 bg-pink-500/5 p-2 text-[11px] space-y-0.5"
        >
          <div className="text-pink-200">
            <span className="font-semibold">{presetDesc.label}</span>
            {presetDesc.summary && (
              <span className="text-pink-300/80"> — {presetDesc.summary}</span>
            )}
          </div>
          {presetDesc.detail && (
            <div className="text-zinc-300 leading-snug">
              {presetDesc.detail}
            </div>
          )}
          {presetDesc.gender && (
            <div className="text-pink-300/70 font-mono">
              gender · {presetDesc.gender}
            </div>
          )}
        </div>
      )}

      <div className="space-y-1">
        <span className="text-xs text-zinc-300">
          Speaking energy{' '}
          <span className="text-zinc-500">(optional)</span>
        </span>
        <div
          data-testid="create-spokesperson-energy-chips"
          className="flex flex-wrap gap-1"
        >
          {SPEAKING_ENERGY_CHIPS.map((chip) => {
            const active = form.speaking_energy.includes(chip)
            return (
              <button
                key={chip}
                type="button"
                onClick={() => toggleChip('speaking_energy', chip)}
                data-testid={`create-spokesperson-energy-chip-${chip}`}
                data-active={active ? 'true' : 'false'}
                className={
                  'text-[10px] rounded-full px-2 py-0.5 font-mono transition-colors ' +
                  (active
                    ? 'bg-pink-500/30 text-pink-100 ring-1 ring-pink-400/50'
                    : 'bg-zinc-800/60 text-zinc-400 ring-1 ring-zinc-700 hover:text-zinc-200')
                }
              >
                {chip}
              </button>
            )
          })}
        </div>
        <p className="text-[10px] text-zinc-500 leading-snug">
          Selected energies append to the spokesperson's personality
          so downstream avatar binds match the tone.
        </p>
      </div>
    </section>
  )
}

function Step4Generate({
  form,
  updateField,
  phase,
  phaseStatus,
  createdCharacter,
}) {
  return (
    <section
      data-testid="create-spokesperson-step-4"
      className="space-y-2"
    >
      <p className="text-[11px] text-zinc-400 leading-snug">
        Review what you've built. Click Create Spokesperson to save +
        render the portrait.
      </p>

      <div
        data-testid="create-spokesperson-summary"
        className="rounded-md ring-1 ring-zinc-800 bg-zinc-950/40 p-2.5 space-y-1.5 text-[11px]"
      >
        <SummaryRow label="Name" value={form.name || '—'} />
        <SummaryRow label="Archetype" value={form.template} />
        {form.subject && (
          <SummaryRow
            label="Species or role"
            value={form.subject}
            multiline
          />
        )}
        {form.personality && (
          <SummaryRow
            label="Personality"
            value={form.personality}
            multiline
          />
        )}
        {form.audience_vibe && (
          <SummaryRow
            label="Audience"
            value={form.audience_vibe}
            multiline
          />
        )}
        {form.style_chips?.length > 0 && (
          <SummaryRow
            label="Style"
            value={form.style_chips.join(', ')}
          />
        )}
        {form.fashion && (
          <SummaryRow label="Wardrobe" value={form.fashion} />
        )}
        <SummaryRow
          label="Voice"
          value={describeVoicePreset(form.voice_preset)?.label || form.voice_preset}
        />
        {form.speaking_energy?.length > 0 && (
          <SummaryRow
            label="Energy"
            value={form.speaking_energy.join(', ')}
          />
        )}
      </div>

      {/* Optional checkboxes — opt-in side effects. */}
      <div className="space-y-1.5">
        <label
          className="flex items-start gap-2 text-[11px] text-zinc-300 cursor-pointer"
          title="After portrait succeeds, also bind a Runway avatar so the spokesperson is ready for spokesperson ads."
        >
          <input
            type="checkbox"
            checked={form.create_avatar}
            onChange={(e) =>
              updateField('create_avatar', e.target.checked)
            }
            data-testid="create-spokesperson-avatar-toggle"
            className="mt-0.5 h-3.5 w-3.5 rounded border-zinc-700 bg-zinc-950 text-pink-500 focus:ring-pink-400"
          />
          <span className="leading-snug">
            <span className="font-semibold text-zinc-200">
              Bind a Runway avatar
            </span>{' '}
            after portrait succeeds. Burns one extra Runway call;
            required before this spokesperson can star in
            avatar_videos campaigns.
          </span>
        </label>

        <label
          className="flex items-start gap-2 text-[11px] text-zinc-300 cursor-pointer"
          title="After saving, jump into the new workspace and pre-open the campaign mode picker."
        >
          <input
            type="checkbox"
            checked={form.start_campaign}
            onChange={(e) =>
              updateField('start_campaign', e.target.checked)
            }
            data-testid="create-spokesperson-campaign-toggle"
            className="mt-0.5 h-3.5 w-3.5 rounded border-zinc-700 bg-zinc-950 text-pink-500 focus:ring-pink-400"
          />
          <span className="leading-snug">
            <span className="font-semibold text-zinc-200">
              Start a campaign
            </span>{' '}
            for them after saving. Opens their workspace with the
            campaign mode picker pre-loaded.
          </span>
        </label>
      </div>

      {phase === 'done' && createdCharacter && (
        <p className="text-[10px] text-emerald-300 leading-snug">
          Saved as{' '}
          <span className="font-mono text-emerald-200">
            {createdCharacter.name}
          </span>
          .
        </p>
      )}
    </section>
  )
}

function SummaryRow({ label, value, multiline = false }) {
  return (
    <div className={multiline ? 'space-y-0.5' : 'flex items-center gap-2'}>
      <span className="text-zinc-500 font-mono text-[10px]">{label}</span>
      <span
        className={
          (multiline
            ? 'text-zinc-200 leading-snug'
            : 'text-zinc-200 truncate') + ' text-[11px]'
        }
      >
        {value}
      </span>
    </div>
  )
}

// PR CK — Build the auto-derived portrait prompt. Mirrors the
// backend's PORTRAIT_TEMPLATES shape (mascot / founder / coach /
// local_guide) so the on-screen preview matches what the gen
// route will use when prompt_override isn't sent.
function derivePortraitPrompt(form) {
  const subject =
    (form.subject || '').trim() ||
    'a friendly brand spokesperson'
  const styleParts = []
  if (form.style_chips?.length) styleParts.push(form.style_chips.join(', '))
  if (form.fashion?.trim()) styleParts.push(form.fashion.trim())
  const style = styleParts.join('; ') || 'modern, warm, on-brand'
  switch (form.template) {
    case 'founder':
      return (
        `Friendly studio portrait of ${subject}. ${style}. ` +
        `Head-and-shoulders, front-facing. Direct eye contact. ` +
        `Soft natural smile. Clean off-white background. Warm soft ` +
        `lighting. Photorealistic. Modern founder aesthetic. No ` +
        `props or sunglasses.`
      )
    case 'coach':
      return (
        `Energetic studio portrait of ${subject}. ${style}. ` +
        `Head-and-shoulders. Confident posture, bright expression, ` +
        `open mouth mid-speech. Solid muted-blue background. Crisp ` +
        `directional lighting. Athletic-coach aesthetic. No props ` +
        `or sunglasses.`
      )
    case 'local_guide':
      return (
        `Approachable studio portrait of ${subject}. ${style}. ` +
        `Head-and-shoulders, front-facing. Genuine warm smile. ` +
        `Soft daylight. Neutral wall background. Friendly local-` +
        `business spokesperson aesthetic. No props or sunglasses.`
      )
    case 'mascot':
    default:
      return (
        `Studio portrait of ${subject}. ${style}. ` +
        `Front-facing, head-and-shoulders crop. Expressive eyes, ` +
        `soft warm smile. Simple solid mid-grey background. Soft ` +
        `three-point studio lighting. Centered composition. No ` +
        `props or sunglasses.`
      )
  }
}
