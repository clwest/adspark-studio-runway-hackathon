import { useEffect, useRef, useState } from 'react'
// PR T — quality hint copy.  Lives here in addition to promptBuilder.js
// so the smoke can match either source; the strings are identical.
import { PROMPT_QUALITY_HINT } from '../promptBuilder'

// Mirror of backend GENERATION_POLICY (services/runway_client.py). Keep in
// sync with the backend table — the backend is the source of truth, but the
// UI uses this map to gate inputs before the user clicks Generate Video.
const GENERATION_POLICY = {
  gen4_turbo: { durations: [5] },
  'gen4.5': { durations: [5, 8, 10] },
}

const VIDEO_MODELS = [
  { value: 'gen4_turbo', label: 'Gen-4 Turbo (image-to-video)' },
  { value: 'gen4.5', label: 'Gen-4.5 (text or image)' },
]

const RATIOS = [
  { value: '1280:720', label: 'Landscape · YouTube · 1280×720' },
  { value: '720:1280', label: 'Reels / TikTok · 720×1280' },
  { value: '960:960', label: 'Square · Instagram · 960×960' },
]

// PR R — Visual Source flow. Four explicit options the user can pick
// before clicking Generate Video. Each option drives different state
// transitions (model, textOnly, imageUrl) to remove the "where is the
// image coming from?" ambiguity that PromptPreview used to hide.
const VISUAL_SOURCES = [
  { key: 'generate',  label: 'Generate image',  hint: 'Runway gen4_image_turbo from your prompt' },
  { key: 'upload',    label: 'Upload image',    hint: 'PNG / JPG / WebP, ≤10 MB' },
  { key: 'character', label: 'Use Character',   hint: 'Reuse a Character Studio portrait' },
  { key: 'text-only', label: 'Text-only video', hint: 'Gen-4.5 — no image needed' },
]

export default function PromptPreview({
  prompt,
  onChange,
  imageUrl,
  onImageUrlChange,
  requireImage,
  onGenerate,
  busy,
  disabled,
  // PR A
  model,
  onModelChange,
  textOnly,
  onTextOnlyChange,
  onGenerateImage,
  imageBusy,
  imageMockMode,
  // PR C
  ratio,
  onRatioChange,
  duration,
  onDurationChange,
  // PR R — Visual Source flow
  imageSource,        // "upload" | undefined — set when an upload landed
  onUploadImage,
  uploadBusy,
  characters = [],
  // PR T — Simplify Prompt: parent rebuilds the textarea using
  // simplifyFromConcept({selectedConcept, form, ratio}).
  onSimplifyPrompt,
  canSimplifyPrompt = false,
  // PR U — Spokesperson-first flow. When set with a portrait, the
  // imageUrl auto-fills with /api/characters/<id>/portrait and the
  // Generate Video button label adapts.
  activeCharacter,
}) {
  const trimmedImage = (imageUrl || '').trim()
  const textOnlyAllowed = model === 'gen4.5'
  const effectiveTextOnly = textOnly && textOnlyAllowed

  // PR R — visual-source state. Initial value derived from current
  // imageUrl + textOnly so a reload lands on whatever the user last
  // had picked.
  const initialSource = effectiveTextOnly
    ? 'text-only'
    : trimmedImage.startsWith('/api/characters/') && trimmedImage.endsWith('/portrait')
    ? 'character'
    : imageSource === 'upload'
    ? 'upload'
    : trimmedImage.startsWith('/api/runway/image/')
    ? 'generate'
    : trimmedImage
    ? 'upload'  // any external/typed URL — surfaced under upload affordance
    : 'generate'
  const [visualSource, setVisualSource] = useState(initialSource)

  const showImageField = !effectiveTextOnly
  const blockedByImage = requireImage && showImageField && !trimmedImage
  const cannotGenerate =
    busy || disabled || !prompt.trim() || blockedByImage

  const isLocalGenerated = trimmedImage.startsWith('/api/runway/image/')
  // PR R — any character portrait URL (used by the Visual Source
  // selector to render the "character portrait selected" hint).
  const isCharacterPortrait =
    trimmedImage.startsWith('/api/characters/') && trimmedImage.endsWith('/portrait')
  // PR U — narrower: is the imageUrl specifically the *active* spokesperson?
  // Used by the adaptive Generate Video button label below.
  const characterPortraitUrl = activeCharacter?.portrait_url || ''
  const isActiveCharacterPortrait =
    Boolean(characterPortraitUrl) && trimmedImage === characterPortraitUrl

  // PR U — auto-fill the imageUrl from the active spokesperson's
  // portrait whenever (a) an active spokesperson with a portrait
  // exists AND (b) the user hasn't already typed/uploaded their own
  // image. Tracked in a ref so we only auto-fill once per character
  // change. Coordinates with PR R's Visual Source selector by also
  // flipping the active source to "character" when auto-fill fires.
  const autoFilledRef = useRef(null)
  useEffect(() => {
    if (!characterPortraitUrl) return
    if (autoFilledRef.current === characterPortraitUrl) return
    const userOwned =
      trimmedImage &&
      !trimmedImage.startsWith('/api/characters/') &&
      !trimmedImage.startsWith('/api/runway/image/')
    if (userOwned) return
    onImageUrlChange?.(characterPortraitUrl)
    autoFilledRef.current = characterPortraitUrl
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [characterPortraitUrl])

  // Adaptive Generate Video button label based on the active source.
  // Used to live inside the generateButton JSX; pulled out so PR R's
  // structured panel can also reference it cleanly.
  const generateButtonLabel = busy
    ? 'Submitting…'
    : isActiveCharacterPortrait && activeCharacter?.name
    ? `Generate Video with ${activeCharacter.name}`
    : effectiveTextOnly
    ? 'Generate Text-Only Video'
    : (visualSource === 'upload' && trimmedImage)
    ? 'Generate Video from Image'
    : visualSource === 'character'
    ? 'Generate Video from Character'
    : 'Generate Video'

  const allowedDurations = GENERATION_POLICY[model]?.durations || [5]
  const durationLocked = allowedDurations.length === 1
  const ratioLabel =
    RATIOS.find((r) => r.value === ratio)?.label.split(' · ')[0] || ratio

  // Characters with a generated portrait + (ideally) a ready avatar are
  // candidates for the "Use Character" path. We accept "ready" + "mock"
  // since the visual is the portrait, not the avatar binding.
  const charactersWithPortrait = (characters || []).filter((c) => c?.portrait_url)

  const fileInputRef = useRef(null)
  const [localCharacterId, setLocalCharacterId] = useState(() => {
    if (!isCharacterPortrait) return null
    const m = trimmedImage.match(/\/api\/characters\/([^/]+)\/portrait/)
    return m ? m[1] : null
  })

  // Coordinate visual-source selection with downstream state.
  const handleSourceChange = (next) => {
    setVisualSource(next)
    if (next === 'text-only') {
      // Force gen4.5 + textOnly on. Image URL stays cached but the
      // generate path skips it.
      if (!textOnlyAllowed) onModelChange?.('gen4.5')
      onTextOnlyChange?.(true)
      return
    }
    // Any non-text-only path needs textOnly off.
    if (textOnly) onTextOnlyChange?.(false)
    if (next === 'character') {
      // PR W — selection priority: previously-picked tile > active
      // spokesperson (PR U) > clear. Pre-PR-W this branch always
      // cleared imageUrl when localCharacterId was null, even when an
      // active spokesperson existed — forcing the user to manually
      // re-pick the tile after the radio flip.
      if (localCharacterId) {
        onImageUrlChange?.(`/api/characters/${localCharacterId}/portrait`)
      } else if (activeCharacter?.id && activeCharacter?.portrait_url) {
        setLocalCharacterId(activeCharacter.id)
        onImageUrlChange?.(activeCharacter.portrait_url)
      } else {
        onImageUrlChange?.('')
      }
      return
    }
    if (next === 'upload') {
      // Don't clobber an existing uploaded URL.
      if (!trimmedImage || isLocalGenerated || isCharacterPortrait) {
        onImageUrlChange?.('')
      }
      return
    }
    if (next === 'generate') {
      if (!trimmedImage || isCharacterPortrait || imageSource === 'upload') {
        onImageUrlChange?.('')
      }
    }
  }

  const handlePickCharacter = (id) => {
    setLocalCharacterId(id)
    if (!id) {
      onImageUrlChange?.('')
      return
    }
    // PR W — force textOnly off whenever a character is picked so
    // /api/runway/generate gets a real prompt_image instead of falling
    // through to text_to_video. handleSourceChange already does this
    // when the radio flips to 'character', but a direct tile click
    // (without changing the radio) needs the same guarantee.
    if (textOnly) onTextOnlyChange?.(false)
    onImageUrlChange?.(`/api/characters/${id}/portrait`)
  }

  // PR W — when "Use Character" is selected with no specific tile
  // picked but an active spokesperson exists, default to the active
  // spokesperson. Closes the user-perceived bug where switching to
  // the character source after PR U auto-fill cleared the imageUrl
  // and required a manual tile re-click.
  useEffect(() => {
    if (visualSource !== 'character') return
    if (localCharacterId) return
    const active = activeCharacter
    if (active?.id && active?.portrait_url && charactersWithPortrait.some((c) => c.id === active.id)) {
      setLocalCharacterId(active.id)
      onImageUrlChange?.(active.portrait_url)
      if (textOnly) onTextOnlyChange?.(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visualSource, activeCharacter])

  // When the chooser is on the character path but the picked character
  // disappears from the library (e.g. deletion via Studio), gracefully
  // reset.
  useEffect(() => {
    if (visualSource !== 'character') return
    if (!localCharacterId) return
    const exists = charactersWithPortrait.some((c) => c.id === localCharacterId)
    if (!exists) {
      setLocalCharacterId(null)
      onImageUrlChange?.('')
    }
  }, [visualSource, localCharacterId, charactersWithPortrait, onImageUrlChange])

  // generateButtonLabel is computed earlier (line ~131) — handles
  // PR R's source-based labels AND PR U's spokesperson-aware label.

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">Runway video prompt</h3>
        <span className="text-xs text-zinc-500">edit before generating</span>
      </div>
      <textarea
        rows={4}
        value={prompt}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg bg-zinc-950 border border-zinc-800 px-3 py-2 outline-none focus:border-spark text-sm"
      />
      {/* PR T — Prompt Quality hint + Simplify-Prompt CTA. The hint
          stays visible whenever the prompt panel is mounted; the
          Simplify button is only useful when the user has a concept
          to derive structure from. */}
      <div className="flex items-center justify-between gap-2 flex-wrap text-[11px]">
        <div className="flex items-center gap-1.5 text-zinc-500">
          <span
            className="rounded-full bg-spark/15 text-spark px-2 py-0.5 font-mono ring-1 ring-spark/30"
            title="The structured Runway video prompt builder produced this text. Edit freely below."
          >
            structured prompt
          </span>
          <span className="leading-relaxed">{PROMPT_QUALITY_HINT}</span>
        </div>
        {onSimplifyPrompt && (
          <button
            type="button"
            onClick={onSimplifyPrompt}
            disabled={!canSimplifyPrompt}
            className="rounded-md ring-1 ring-zinc-700 hover:ring-spark text-[11px] px-2 py-1 text-zinc-200 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-spark"
            title="Re-derive a clean structured prompt from the selected concept and current campaign brief. Replaces whatever's in the textarea."
          >
            Simplify prompt
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
        <label className="text-sm text-zinc-300 flex flex-col gap-1">
          <span>Model</span>
          <select
            value={model}
            onChange={(e) => onModelChange?.(e.target.value)}
            className="rounded-md bg-zinc-950 border border-zinc-800 px-2 py-1 text-sm focus:border-spark outline-none"
          >
            {VIDEO_MODELS.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </label>

        <label className="text-sm text-zinc-300 flex flex-col gap-1">
          <span>Source ratio</span>
          <select
            value={ratio}
            onChange={(e) => onRatioChange?.(e.target.value)}
            className="rounded-md bg-zinc-950 border border-zinc-800 px-2 py-1 text-sm focus:border-spark outline-none"
            aria-label="source ratio"
          >
            {RATIOS.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        </label>

        <label className="text-sm text-zinc-300 flex flex-col gap-1">
          <span>
            Duration
            {durationLocked && (
              <span className="text-zinc-500"> · locked at {allowedDurations[0]}s for this model</span>
            )}
          </span>
          <select
            value={duration}
            disabled={durationLocked}
            onChange={(e) => onDurationChange?.(parseInt(e.target.value, 10))}
            className="rounded-md bg-zinc-950 border border-zinc-800 px-2 py-1 text-sm focus:border-spark outline-none disabled:opacity-60"
            aria-label="duration"
          >
            {allowedDurations.map((d) => (
              <option key={d} value={d}>
                {d} seconds
              </option>
            ))}
          </select>
        </label>

        {/* PR R — text-only is now driven by the Visual Source
            selector below, which sets model + textOnly together so
            users can't pick incompatible combinations. We keep the
            label here as an accessibility marker so the smoke can
            still find it ("Use text-only video"). */}
        <label
          className={`text-sm flex items-end gap-2 pb-1 ${
            textOnlyAllowed ? 'text-zinc-300' : 'text-zinc-600'
          }`}
          title="Pick the Text-only Visual Source below — this label is informational"
        >
          <input
            type="checkbox"
            disabled={!textOnlyAllowed}
            checked={!!textOnly}
            onChange={(e) => onTextOnlyChange?.(e.target.checked)}
            aria-label="Use text-only video"
          />
          Use text-only video
        </label>
      </div>

      <p className="text-[11px] text-zinc-500 leading-relaxed">
        Match the source ratio to your target Campaign Pack format to reduce
        cropping in the finished output. Reels and Square sources crop less
        when the source already shares their aspect.
      </p>

      {/* PR R — Visual Source selector. Four explicit options so the
          user always knows where the video's input image is coming
          from. Replaces the lone "Reference image URL" field that used
          to assume the user already had a URL on hand. */}
      <div
        role="radiogroup"
        aria-label="visual source"
        className="space-y-2 pt-1"
      >
        <div className="flex items-center justify-between flex-wrap gap-2">
          <span className="text-sm text-zinc-300 font-semibold">
            Visual Source
          </span>
          <span className="text-[10px] text-zinc-500">
            Where does the video's input image come from?
          </span>
        </div>
        {/* PR U — when the active spokesperson auto-filled the image,
            surface a clear "Using <name>" banner above the radio
            tiles. Lets users immediately see the spokesperson choice
            from Stage 1 carried into Stage 3 without hunting through
            the picker grid. */}
        {isActiveCharacterPortrait && activeCharacter && (
          <div
            className="flex items-center gap-2 rounded-md ring-1 ring-spark/40 bg-spark/5 px-2 py-1.5"
            aria-label="active spokesperson driving video"
          >
            {activeCharacter.portrait_url && (
              <img
                src={activeCharacter.portrait_url}
                alt={activeCharacter.name}
                className="w-7 h-7 rounded object-cover ring-1 ring-spark/40 bg-zinc-950"
              />
            )}
            <div className="text-[11px] flex-1 min-w-0">
              <span className="text-spark font-semibold">
                Using {activeCharacter.name}
              </span>
              <span className="text-zinc-500">
                {' '}as the visual source from Stage 1. Switch sources
                below to override.
              </span>
            </div>
          </div>
        )}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
          {VISUAL_SOURCES.map((s) => {
            const active = visualSource === s.key
            return (
              <button
                key={s.key}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => handleSourceChange(s.key)}
                className={`text-left rounded-md px-2 py-1.5 text-xs ring-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-spark ${
                  active
                    ? 'bg-spark/15 text-spark ring-spark/50 font-semibold'
                    : 'bg-zinc-950/40 text-zinc-300 ring-zinc-800 hover:ring-spark/30 hover:text-zinc-100'
                }`}
              >
                <div>{s.label}</div>
                <div
                  className={`text-[10px] mt-0.5 ${
                    active ? 'text-spark/80' : 'text-zinc-500'
                  }`}
                >
                  {s.hint}
                </div>
              </button>
            )
          })}
        </div>

        {/* Per-source body. Only the selected one renders so the panel
            doesn't sprawl. Each branch keeps the existing imageUrl
            state so the generate-video pipeline doesn't change. */}

        {visualSource === 'generate' && (
          <div className="space-y-2 rounded-lg ring-1 ring-zinc-800/60 bg-zinc-950/40 p-3">
            <p className="text-[11px] text-zinc-500 leading-relaxed">
              Runway <span className="font-mono text-zinc-300">gen4_image_turbo</span>{' '}
              synthesises a reference image from the prompt above.
              Mock-safe — produces a stdlib PNG when no Runway key is set.
            </p>
            <button
              type="button"
              onClick={onGenerateImage}
              disabled={!onGenerateImage || imageBusy || !prompt.trim()}
              className="rounded-md bg-spark/80 hover:bg-spark text-ink text-xs font-semibold px-3 py-1.5 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-spark"
            >
              {imageBusy ? 'Generating image…' : 'Generate Reference Image'}
            </button>
            {isLocalGenerated && (
              <div className="rounded-lg ring-1 ring-zinc-800 bg-zinc-950/60 p-2">
                <p className="text-xs text-zinc-500 mb-1">
                  Generated reference image
                  {imageMockMode ? ' (mock placeholder)' : ''} —
                  <span className="text-emerald-300"> selected as Visual Source</span>:
                </p>
                <img
                  src={imageUrl}
                  alt="Generated reference"
                  className="w-full max-h-40 object-cover rounded-md ring-1 ring-zinc-800"
                />
              </div>
            )}
          </div>
        )}

        {visualSource === 'upload' && (
          <div className="space-y-2 rounded-lg ring-1 ring-zinc-800/60 bg-zinc-950/40 p-3">
            <p className="text-[11px] text-zinc-500 leading-relaxed">
              Upload your own PNG / JPG / WebP (≤10 MB). The file caches
              under <span className="font-mono text-zinc-300">backend/data/images/</span>{' '}
              and feeds straight into Generate Video.
            </p>
            <div className="flex items-center gap-2 flex-wrap">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) onUploadImage?.(f)
                  // Reset so re-selecting the same file fires onChange.
                  e.target.value = ''
                }}
                className="text-[11px] text-zinc-300 file:mr-2 file:rounded file:border-0 file:bg-spark/80 file:text-ink file:text-xs file:font-semibold file:px-2 file:py-1 file:cursor-pointer"
                aria-label="upload image file"
              />
              {uploadBusy && (
                <span className="text-[11px] text-zinc-500">uploading…</span>
              )}
            </div>
            <div className="space-y-1">
              <label className="text-[10px] text-zinc-500 block">
                or paste an image URL
              </label>
              <input
                type="url"
                value={imageUrl || ''}
                onChange={(e) => onImageUrlChange(e.target.value)}
                placeholder="https://images.unsplash.com/photo-...jpg"
                className={`w-full rounded-lg bg-zinc-950 ring-1 px-3 py-2 outline-none text-sm focus-visible:ring-2 ${
                  blockedByImage
                    ? 'ring-rose-500/60 focus:ring-rose-400'
                    : 'ring-zinc-800 focus:ring-spark'
                }`}
              />
            </div>
            {(isLocalGenerated || imageSource === 'upload') && trimmedImage && (
              <div className="rounded-lg ring-1 ring-zinc-800 bg-zinc-950/60 p-2">
                <p className="text-xs text-emerald-300 mb-1">
                  Uploaded image — selected as Visual Source:
                </p>
                <img
                  src={imageUrl}
                  alt="Uploaded reference"
                  className="w-full max-h-40 object-cover rounded-md ring-1 ring-zinc-800"
                />
              </div>
            )}
          </div>
        )}

        {visualSource === 'character' && (
          <div className="space-y-2 rounded-lg ring-1 ring-pink-400/30 bg-pink-500/5 p-3">
            {charactersWithPortrait.length === 0 ? (
              <div className="space-y-1.5 text-center py-2">
                <p className="text-[11px] text-zinc-300">
                  No characters with a portrait yet.
                </p>
                <p className="text-[10px] text-zinc-500">
                  Create a Character first (mascot / founder / coach /
                  local guide) — Runway generates the portrait automatically.
                </p>
                <a
                  href="#character-studio"
                  onClick={(e) => {
                    e.preventDefault()
                    document
                      .getElementById('character-studio-anchor')
                      ?.scrollIntoView({ behavior: 'smooth' })
                  }}
                  className="inline-block rounded-md bg-pink-500/80 hover:bg-pink-500 text-zinc-100 text-[11px] px-3 py-1.5 mt-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pink-400"
                >
                  Open Character Studio →
                </a>
              </div>
            ) : (
              <>
                <p className="text-[11px] text-zinc-400 leading-relaxed">
                  Pick a character — its portrait drives the video.
                  Runway will animate the character itself instead of
                  the campaign hero shot.
                </p>
                <div className="grid grid-cols-3 sm:grid-cols-4 gap-1.5">
                  {charactersWithPortrait.map((ch) => {
                    const picked = localCharacterId === ch.id
                    return (
                      <button
                        key={ch.id}
                        type="button"
                        onClick={() => handlePickCharacter(picked ? null : ch.id)}
                        aria-pressed={picked}
                        title={`${ch.name} (${ch.template})`}
                        className={`rounded-md p-1 ring-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pink-400 ${
                          picked
                            ? 'ring-2 ring-pink-400 bg-pink-500/10'
                            : 'ring-zinc-800 bg-zinc-950/40 hover:ring-pink-400/40'
                        }`}
                      >
                        <img
                          src={ch.portrait_url}
                          alt={ch.name}
                          className="w-full aspect-square object-cover rounded"
                        />
                        <div className="text-[9px] text-zinc-300 mt-1 truncate">
                          {ch.name}
                        </div>
                      </button>
                    )
                  })}
                </div>
                {isCharacterPortrait && (
                  <p className="text-[11px] text-emerald-300">
                    Character portrait selected as Visual Source.
                  </p>
                )}
              </>
            )}
          </div>
        )}

        {visualSource === 'text-only' && (
          <div className="space-y-1.5 rounded-lg ring-1 ring-zinc-800/60 bg-zinc-950/40 p-3">
            <p className="text-[11px] text-zinc-300 leading-relaxed">
              <span className="font-mono text-zinc-100">Gen-4.5 text-only</span>{' '}
              — no image required. Runway generates the video from your
              prompt directly.
            </p>
            <p className="text-[10px] text-zinc-500 leading-relaxed">
              Slightly slower than image-to-video and credits cost a touch
              more, but lets you skip the Visual Source step entirely
              when the prompt alone tells the story.
            </p>
          </div>
        )}
      </div>

      {/* Active settings summary — small chip row above the Generate button. */}
      <div
        className="flex flex-wrap items-center gap-1.5 pt-1"
        aria-label="active generation settings"
      >
        <span className="text-[10px] text-zinc-500 mr-1">settings:</span>
        <span className="text-[10px] rounded-full bg-zinc-800 text-zinc-200 px-2 py-0.5 font-mono">
          {model}
        </span>
        <span className="text-[10px] rounded-full bg-zinc-800 text-zinc-200 px-2 py-0.5 font-mono">
          {ratioLabel}
        </span>
        <span className="text-[10px] rounded-full bg-zinc-800 text-zinc-200 px-2 py-0.5 font-mono">
          {duration}s
        </span>
        <span className="text-[10px] rounded-full bg-zinc-800 text-zinc-200 px-2 py-0.5">
          {effectiveTextOnly ? 'text-only' : 'reference image'}
        </span>
      </div>

      <button
        type="button"
        disabled={cannotGenerate}
        onClick={onGenerate}
        className="rounded-lg bg-spark text-ink font-semibold px-4 py-2 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-spark"
      >
        {generateButtonLabel}
      </button>
      <p className="text-[11px] text-zinc-500 leading-relaxed">
        Runway visual video is silent.{' '}
        <span className="text-zinc-300">
          After saving, generate an Avatar Host Clip and build
          Commercial with Voice
        </span>{' '}
        on the campaign card to ship a voiced final ad. Audio Pack is
        the optional brand-voice identity track.
      </p>
      {blockedByImage && (
        <p className="text-xs text-rose-300">
          Real Runway mode needs a Visual Source — pick Generate / Upload /
          Character above, or switch to Text-only.
        </p>
      )}
    </div>
  )
}
