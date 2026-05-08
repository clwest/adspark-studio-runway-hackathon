function CampaignCard({ c }) {
  const concept = c.selected_concept || {}
  const hasVideo = Boolean(c.video_url)
  return (
    <li className="rounded-xl border border-zinc-800 p-4 bg-zinc-950/40 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-medium text-zinc-100 truncate">{c.business}</div>
          <div className="text-xs text-zinc-500">
            {new Date(c.created_at).toLocaleString()}
            {c.runway_task_id && (
              <>
                {' · '}
                <span className="font-mono" title="Runway task id">
                  {String(c.runway_task_id).slice(0, 12)}…
                </span>
              </>
            )}
          </div>
        </div>
        <span
          className={`text-xs rounded-full px-2 py-0.5 shrink-0 ${
            hasVideo
              ? 'bg-emerald-500/20 text-emerald-300'
              : 'bg-zinc-700/40 text-zinc-300'
          }`}
        >
          {hasVideo ? 'video ready' : 'no video'}
        </span>
      </div>

      <div>
        <div className="text-sm text-zinc-200 font-medium">{concept.title || 'Untitled concept'}</div>
        {concept.caption && (
          <div className="text-xs text-zinc-400 mt-0.5">{concept.caption}</div>
        )}
      </div>

      {c.runway_prompt && (
        <details className="text-xs text-zinc-500">
          <summary className="cursor-pointer hover:text-zinc-300">prompt</summary>
          <p className="mt-1 text-zinc-400 whitespace-pre-wrap leading-relaxed">
            {c.runway_prompt}
          </p>
        </details>
      )}

      {hasVideo && (
        <div className="space-y-1">
          <video
            src={c.video_url}
            controls
            preload="metadata"
            className="w-full rounded-lg border border-zinc-800"
          />
          <div className="flex items-center justify-between text-xs">
            <a
              href={c.video_url}
              target="_blank"
              rel="noreferrer"
              className="text-spark hover:underline"
            >
              open video ↗
            </a>
            <span className="text-zinc-500" title="Runway artifact URLs are presigned and expire (~days). Cache locally for long-lived demos.">
              URL may expire
            </span>
          </div>
        </div>
      )}
    </li>
  )
}

export default function CampaignGallery({ campaigns, onRefresh }) {
  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold">Saved campaigns</h3>
        <button
          type="button"
          onClick={onRefresh}
          className="text-xs text-zinc-400 hover:text-zinc-200"
        >
          refresh
        </button>
      </div>
      {!campaigns?.length ? (
        <p className="text-sm text-zinc-500">No campaigns saved yet.</p>
      ) : (
        <ul className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {campaigns.map((c) => (
            <CampaignCard key={c.id} c={c} />
          ))}
        </ul>
      )}
    </div>
  )
}
