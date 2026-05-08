import { useState } from 'react'
import { api } from '../api'

const PACK_FORMATS = [
  { key: 'landscape', label: 'Landscape', dims: '1280×720', hint: 'YouTube / web' },
  { key: 'reels', label: 'Reels', dims: '720×1280', hint: 'TikTok / Reels / Shorts' },
  { key: 'square', label: 'Square', dims: '960×960', hint: 'Instagram feed' },
]

function finishedUrlFor(c, fmt) {
  // Prefer the per-format dict introduced in PR B; fall back to the legacy
  // single-URL field for landscape only so old saves still display correctly.
  const map = c.finished_videos || {}
  if (map[fmt]) return map[fmt]
  if (fmt === 'landscape' && c.finished_video_url) return c.finished_video_url
  return null
}

function PackEntry({ c, fmt, label, dims, hint, onClick, busyFormat }) {
  const url = finishedUrlFor(c, fmt)
  const ready = Boolean(url)
  const isBusy = busyFormat === fmt
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-2 flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-zinc-200">{label}</span>
        <span className="text-[10px] text-zinc-500 font-mono">{dims}</span>
      </div>
      <span className="text-[10px] text-zinc-500">{hint}</span>
      {ready ? (
        <div className="flex items-center justify-between gap-2">
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            className="text-xs text-spark hover:underline"
          >
            view ↗
          </a>
          <span className="text-[10px] rounded-full bg-violet-500/20 text-violet-300 px-2 py-0.5">
            ready
          </span>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => onClick(fmt)}
          disabled={isBusy || Boolean(busyFormat)}
          className="rounded-md bg-violet-500/80 hover:bg-violet-500 text-zinc-100 text-xs px-2 py-1 disabled:opacity-50"
          title={`Build ${label} (${dims}) via ffmpeg — local, no provider call`}
        >
          {isBusy ? `Building ${label}…` : `Build ${label}`}
        </button>
      )}
    </div>
  )
}

function CampaignCard({ c, onUpdated }) {
  const concept = c.selected_concept || {}
  // Preview preference: any finished format → cached → original presigned URL.
  const finishedAnyUrl =
    finishedUrlFor(c, 'landscape') ||
    finishedUrlFor(c, 'reels') ||
    finishedUrlFor(c, 'square')
  const isCached = Boolean(c.cached_video_url)
  const videoSrc = finishedAnyUrl || c.cached_video_url || c.video_url || null
  const hasVideo = Boolean(videoSrc)
  const cacheFailed = c.cache_status === 'failed'

  const [busyFormat, setBusyFormat] = useState(null) // null | "landscape" | "reels" | "square"
  const [localError, setLocalError] = useState('')

  const cacheStatusLabel = isCached
    ? 'cached locally'
    : cacheFailed
    ? 'cache failed'
    : c.video_url
    ? 'external URL may expire'
    : null

  const finishUnavailable = c.finish_status === 'unavailable'

  const handleBuild = async (fmt) => {
    setLocalError('')
    setBusyFormat(fmt)
    try {
      const updated = await api.finishCampaign(c.id, fmt)
      onUpdated?.(updated)
    } catch (e) {
      setLocalError(`${fmt}: ${e}`)
    } finally {
      setBusyFormat(null)
    }
  }

  const finishedCount = PACK_FORMATS.filter((f) => Boolean(finishedUrlFor(c, f.key))).length

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
          {finishedCount > 0 && (
            <span
              className="text-xs rounded-full px-2 py-0.5 bg-violet-500/20 text-violet-300"
              title="Finished formats in the Campaign Pack"
            >
              pack {finishedCount}/3
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

      {/* Campaign Pack — only meaningful once we have a cached video. */}
      {isCached && (
        <div className="border-t border-zinc-800 pt-3 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-zinc-300">Campaign Pack</span>
            {finishUnavailable && (
              <span className="text-[10px] text-amber-300">
                ffmpeg unavailable — install via `brew install ffmpeg`
              </span>
            )}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {PACK_FORMATS.map((f) => (
              <PackEntry
                key={f.key}
                c={c}
                fmt={f.key}
                label={f.label}
                dims={f.dims}
                hint={f.hint}
                onClick={handleBuild}
                busyFormat={busyFormat}
              />
            ))}
          </div>
          {c.finish_status === 'failed' && c.finish_error && (
            <p
              className="text-[10px] text-rose-300"
              title={c.finish_error}
            >
              last finish attempt failed — see backend log
            </p>
          )}
          {localError && (
            <p className="text-[10px] text-rose-300">{localError}</p>
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
