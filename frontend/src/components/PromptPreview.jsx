const VIDEO_MODELS = [
  { value: 'gen4_turbo', label: 'Gen-4 Turbo (image-to-video)' },
  { value: 'gen4.5', label: 'Gen-4.5 (text or image)' },
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
  // PR A additions
  model,
  onModelChange,
  textOnly,
  onTextOnlyChange,
  onGenerateImage,
  imageBusy,
  imageMockMode,
}) {
  const trimmedImage = (imageUrl || '').trim()
  const textOnlyAllowed = model === 'gen4.5'
  const effectiveTextOnly = textOnly && textOnlyAllowed
  const showImageField = !effectiveTextOnly
  const blockedByImage = requireImage && showImageField && !trimmedImage
  const cannotGenerate =
    busy || disabled || !prompt.trim() || blockedByImage

  const isLocalGenerated = trimmedImage.startsWith('/api/runway/image/')

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

      <div className="flex flex-wrap items-center gap-3 pt-1">
        <label className="text-sm text-zinc-300 flex items-center gap-2">
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

        <label
          className={`text-sm flex items-center gap-2 ${
            textOnlyAllowed ? 'text-zinc-300' : 'text-zinc-600'
          }`}
          title={
            textOnlyAllowed
              ? 'Skip the reference image and let Gen-4.5 generate purely from text'
              : 'Only available with Gen-4.5'
          }
        >
          <input
            type="checkbox"
            disabled={!textOnlyAllowed}
            checked={!!textOnly}
            onChange={(e) => onTextOnlyChange?.(e.target.checked)}
          />
          Use text-only video
        </label>
      </div>

      {showImageField && (
        <div className="space-y-2 pt-1">
          <div className="flex items-center justify-between">
            <label className="text-sm text-zinc-300">
              Reference image URL{' '}
              {requireImage ? (
                <span className="text-rose-300">(required in real mode)</span>
              ) : (
                <span className="text-zinc-500">(optional in mock mode)</span>
              )}
            </label>
            <button
              type="button"
              onClick={onGenerateImage}
              disabled={!onGenerateImage || imageBusy || !prompt.trim()}
              className="rounded-md border border-zinc-700 hover:border-spark text-xs px-2 py-1 text-zinc-200 disabled:opacity-50"
              title="Use Runway gen4_image_turbo to synthesize a reference image from the prompt above (mock-safe)"
            >
              {imageBusy ? 'Generating image…' : 'Generate Reference Image'}
            </button>
          </div>
          <input
            type="url"
            value={imageUrl || ''}
            onChange={(e) => onImageUrlChange(e.target.value)}
            placeholder="https://images.unsplash.com/photo-...jpg"
            className={`w-full rounded-lg bg-zinc-950 border px-3 py-2 outline-none text-sm
              ${blockedByImage ? 'border-rose-500/60 focus:border-rose-400' : 'border-zinc-800 focus:border-spark'}`}
          />
          {isLocalGenerated && (
            <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-2">
              <p className="text-xs text-zinc-500 mb-1">
                Generated reference image
                {imageMockMode ? ' (mock placeholder)' : ''}:
              </p>
              <img
                src={imageUrl}
                alt="Generated reference"
                className="w-full max-h-40 object-cover rounded-md border border-zinc-800"
              />
            </div>
          )}
          <p className="text-xs text-zinc-500">
            Paste a public URL (product photo, storefront, hero) — or click
            Generate Reference Image to synthesize one. The prompt above
            describes motion and feel; the image anchors the look.
          </p>
        </div>
      )}

      <button
        type="button"
        disabled={cannotGenerate}
        onClick={onGenerate}
        className="rounded-lg bg-spark text-ink font-semibold px-4 py-2 disabled:opacity-50"
      >
        {busy ? 'Submitting…' : effectiveTextOnly ? 'Generate Video (text-only)' : 'Generate Video'}
      </button>
      {blockedByImage && (
        <p className="text-xs text-rose-300">
          Backend is in real Runway mode. Add a reference image URL above —
          or generate one — before generating video.
        </p>
      )}
      {effectiveTextOnly && (
        <p className="text-xs text-zinc-500">
          Gen-4.5 text-only mode — no reference image will be sent to Runway.
        </p>
      )}
    </div>
  )
}
