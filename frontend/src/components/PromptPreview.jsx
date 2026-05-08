export default function PromptPreview({
  prompt,
  onChange,
  imageUrl,
  onImageUrlChange,
  requireImage,
  onGenerate,
  busy,
  disabled,
}) {
  const trimmedImage = (imageUrl || '').trim()
  const blockedByImage = requireImage && !trimmedImage
  const cannotGenerate = busy || disabled || !prompt.trim() || blockedByImage

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

      <div className="space-y-1 pt-1">
        <div className="flex items-center justify-between">
          <label className="text-sm text-zinc-300">
            Reference image URL{' '}
            {requireImage ? (
              <span className="text-rose-300">(required in real mode)</span>
            ) : (
              <span className="text-zinc-500">(optional in mock mode)</span>
            )}
          </label>
        </div>
        <input
          type="url"
          value={imageUrl || ''}
          onChange={(e) => onImageUrlChange(e.target.value)}
          placeholder="https://images.unsplash.com/photo-...jpg"
          className={`w-full rounded-lg bg-zinc-950 border px-3 py-2 outline-none text-sm
            ${blockedByImage ? 'border-rose-500/60 focus:border-rose-400' : 'border-zinc-800 focus:border-spark'}`}
        />
        <p className="text-xs text-zinc-500">
          Runway uses image-to-video — paste a public URL to a product photo,
          storefront photo, or campaign hero image. The prompt above describes
          the motion and feel; the image anchors the look.
        </p>
      </div>

      <button
        type="button"
        disabled={cannotGenerate}
        onClick={onGenerate}
        className="rounded-lg bg-spark text-ink font-semibold px-4 py-2 disabled:opacity-50"
      >
        {busy ? 'Submitting…' : 'Generate Video'}
      </button>
      {blockedByImage && (
        <p className="text-xs text-rose-300">
          Backend is in real Runway mode. Add a reference image URL above before generating.
        </p>
      )}
    </div>
  )
}
