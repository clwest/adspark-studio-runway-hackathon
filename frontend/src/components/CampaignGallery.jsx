import { useState } from 'react'
import { api } from '../api'

function CampaignCard({ c, onUpdated }) {
  const concept = c.selected_concept || {}
  // Preview preference: finished (with overlays) → cached → original presigned URL.
  const isFinished = Boolean(c.finished_video_url)
  const isCached = Boolean(c.cached_video_url)
  const videoSrc = c.finished_video_url || c.cached_video_url || c.video_url || null
  const hasVideo = Boolean(videoSrc)
  const cacheFailed = c.cache_status === 'failed'

  const [busy, setBusy] = useState(false)
  const [localError, setLocalError] = useState('')

  const cacheStatusLabel = isCached
    ? 'cached locally'
    : cacheFailed
    ? 'cache failed'
    : c.video_url
    ? 'external URL may expire'
    : null

  const finishUnavailable = c.finish_status === 'unavailable'
  const finishFailed = c.finish_status === 'failed'
  const canFinish = isCached && !isFinished && !busy && !finishUnavailable

  const handleFinish = async () => {
    setLocalError('')
    setBusy(true)
    try {
      const updated = await api.finishCampaign(c.id)
      onUpdated?.(updated)
    } catch (e) {
      setLocalError(String(e))
    } finally {
      setBusy(false)
    }
  }

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
        <div className="flex items-center gap-1 shrink-0">
          {isFinished && (
            <span className="text-xs rounded-full px-2 py-0.5 bg-violet-500/20 text-violet-300">
              finished ad
            </span>
          )}
          <span
            className={`text-xs rounded-full px-2 py-0.5 ${
              hasVideo
                ? 'bg-emerald-500/20 text-emerald-300'
                : 'bg-zinc-700/40 text-zinc-300'
            }`}
          >
            {hasVideo ? 'video ready' : 'no video'}
          </span>
        </div>
      </div>

      <div>
        <div className="text-sm text-zinc-200 font-medium">
          {concept.title || 'Untitled concept'}
        </div>
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
        <div className="space-y-2">
          <video
            key={videoSrc}
            src={videoSrc}
            controls
            preload="metadata"
            className="w-full rounded-lg border border-zinc-800"
          />
          <div className="flex items-center justify-between text-xs gap-2 flex-wrap">
            <a
              href={videoSrc}
              target="_blank"
              rel="noreferrer"
              className="text-spark hover:underline"
            >
              open video ↗
            </a>
            {cacheStatusLabel && (
              <span
                className={
                  isCached
                    ? 'text-emerald-300'
                    : cacheFailed
                    ? 'text-rose-300'
                    : 'text-zinc-500'
                }
                title={
                  isCached
                    ? 'Backend cached the video at backend/data/videos and serves it from /api/campaigns/{id}/video. Stable forever.'
                    : cacheFailed
                    ? `Caching failed: ${c.cache_error || 'unknown error'}. Falling back to the original Runway URL, which expires in ~days.`
                    : 'Runway artifact URLs are presigned and expire (~days). Cache skipped — fallback to the original URL.'
                }
              >
                {cacheStatusLabel}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Finish Ad pipeline UI — only meaningful once we have a cached video. */}
      {isCached && (
        <div className="border-t border-zinc-800 pt-3 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={handleFinish}
            disabled={!canFinish}
            className="rounded-lg bg-violet-500/80 hover:bg-violet-500 text-zinc-100 text-xs px-3 py-1.5 disabled:opacity-50"
            title={
              finishUnavailable
                ? 'ffmpeg not available on the backend'
                : isFinished
                ? 'Already finished — re-run by clearing finish_status on the backend'
                : 'Burn title + CTA overlays into a finished MP4 via ffmpeg (local, no provider call)'
            }
          >
            {busy
              ? 'Finishing…'
              : isFinished
              ? 'Finished ✓'
              : finishFailed
              ? 'Retry Finish Ad'
              : 'Finish Ad'}
          </button>
          {isFinished && (
            <span className="text-xs text-violet-300">
              served from /api/campaigns/{c.id.slice(0, 8)}…/finished-video
            </span>
          )}
          {finishUnavailable && (
            <span className="text-xs text-amber-300">
              ffmpeg not available on the backend — install via Homebrew (`brew install ffmpeg`) and retry
            </span>
          )}
          {finishFailed && c.finish_error && (
            <span className="text-xs text-rose-300" title={c.finish_error}>
              finish failed — see backend log
            </span>
          )}
          {localError && (
            <span className="text-xs text-rose-300">{localError}</span>
          )}
        </div>
      )}
    </li>
  )
}

export default function CampaignGallery({ campaigns, onRefresh }) {
  const [overrides, setOverrides] = useState({})
  const handleUpdated = (updated) => {
    if (!updated?.id) return
    setOverrides((m) => ({ ...m, [updated.id]: updated }))
  }
  const merged = (campaigns || []).map((c) => overrides[c.id] || c)

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
      {!merged.length ? (
        <p className="text-sm text-zinc-500">No campaigns saved yet.</p>
      ) : (
        <ul className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {merged.map((c) => (
            <CampaignCard key={c.id} c={c} onUpdated={handleUpdated} />
          ))}
        </ul>
      )}
    </div>
  )
}
