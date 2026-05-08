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
            <li
              key={c.id}
              className="rounded-xl border border-zinc-800 p-3 bg-zinc-950/40"
            >
              <div className="flex items-center justify-between mb-1">
                <span className="font-medium text-zinc-100">{c.business}</span>
                <span className="text-xs text-zinc-500">
                  {new Date(c.created_at).toLocaleString()}
                </span>
              </div>
              <p className="text-sm text-zinc-300 mb-1">
                {c.selected_concept?.title}
              </p>
              <p className="text-xs text-zinc-500 line-clamp-2">
                {c.selected_concept?.caption}
              </p>
              {c.video_url && (
                <a
                  className="text-xs text-spark hover:underline"
                  href={c.video_url}
                  target="_blank"
                  rel="noreferrer"
                >
                  view video ↗
                </a>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
