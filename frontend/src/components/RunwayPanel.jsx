function statusCopy(task) {
  switch (task.status) {
    case 'PENDING':
      return 'Queueing the task with Runway…'
    case 'RUNNING':
      return task.endpoint === 'text_to_video'
        ? 'Runway is rendering the text-to-video clip…'
        : 'Runway is rendering the image-to-video clip…'
    case 'SUCCEEDED':
      return 'Clip ready. Save it to keep a permanent local copy.'
    case 'FAILED':
      return task.failure_reason || 'Runway returned a failure for this task.'
    case 'CANCELED':
      return 'Task was canceled.'
    default:
      return ''
  }
}

export default function RunwayPanel({ task, onSave, savedId }) {
  if (!task) return null
  const pct = Math.round((task.progress ?? 0) * 100)
  const done = task.status === 'SUCCEEDED'
  const failed = task.status === 'FAILED' || task.status === 'CANCELED'
  const videoUrl = task.output?.[0]
  const copy = statusCopy(task)

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">Runway task</h3>
        <span className="text-xs text-zinc-500 font-mono">{task.task_id}</span>
      </div>
      <div className="flex items-center gap-3">
        <span
          className={`text-xs rounded-full px-2 py-0.5 ${
            done
              ? 'bg-emerald-500/20 text-emerald-300'
              : failed
              ? 'bg-rose-500/20 text-rose-300'
              : 'bg-amber-500/20 text-amber-300'
          }`}
        >
          {task.status}
        </span>
        <div className="flex-1 h-2 rounded-full bg-zinc-800 overflow-hidden">
          <div className="h-full bg-spark transition-all" style={{ width: `${pct}%` }} />
        </div>
        <span className="text-xs text-zinc-400 w-10 text-right">{pct}%</span>
      </div>

      {copy && (
        <p className={`text-xs ${failed ? 'text-rose-300' : 'text-zinc-400'}`}>
          {copy}
        </p>
      )}

      {done && videoUrl && (
        <div className="space-y-2">
          <video
            src={videoUrl}
            controls
            className="w-full rounded-lg border border-zinc-800"
          />
          <div className="flex items-center gap-3 text-sm">
            <a
              href={videoUrl}
              target="_blank"
              rel="noreferrer"
              className="text-spark hover:underline"
            >
              Download video ↗
            </a>
            <button
              type="button"
              onClick={onSave}
              disabled={!!savedId}
              className="rounded-lg bg-zinc-800 hover:bg-zinc-700 px-3 py-1 text-sm disabled:opacity-50"
            >
              {savedId ? 'Saved · cached locally' : 'Save campaign card'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
