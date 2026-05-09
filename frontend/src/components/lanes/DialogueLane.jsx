import { formatHistoryTimestamp } from '../../uiHelpers.js'

/**
 * PR BL — Dialogue Scene lane scaffold (gated v2).
 *
 * Mounted by SpokespersonStudio when
 * `localStorage.adspark.activeMode === "dialogue"`. Mirrors
 * PR BI / PR BK shape with three steps tailored to multi-character
 * scenes (Brief / Cast / Lines & Stitch) and three disabled
 * placeholder render buttons:
 *   - Generate Dialogue Lines  → per-line `avatar_videos` render
 *   - Stitch Dialogue Scene    → `dialogue_scene_video_url`
 *                                (PR AF ffmpeg concat with audio)
 *   - Captioned Reels          → `dialogue_scene_reels_url`
 *                                (PR AG/AH 720×1280 + per-line
 *                                 burned-in captions)
 *
 * Backend untouched. Render buttons are disabled placeholders;
 * actual generation continues to flow through the legacy
 * gallery's Dialogue tab + the existing `/dialogue/*` routes
 * until a follow-up slice wires real submit handlers.
 */
export default function DialogueLane({
  activeSpokesperson = null,
  linkedCampaigns = [],
}) {
  const campaigns = Array.isArray(linkedCampaigns) ? linkedCampaigns : []
  const sorted = [...campaigns].sort((a, b) => {
    const at = String(a.created_at || '')
    const bt = String(b.created_at || '')
    return bt.localeCompare(at)
  })
  const focused = sorted[0] || null
  const hasSpokesperson = Boolean(activeSpokesperson)
  const hasCampaign = Boolean(focused)
  const lines = Array.isArray(focused?.dialogue_lines)
    ? focused.dialogue_lines
    : []
  const lineCount = lines.length
  // Cast = unique character_id / character_name pairs across
  // dialogue lines. Falls back to the line's avatar_id when no
  // character_id is set.
  const castMap = new Map()
  for (const ln of lines) {
    const key =
      ln.character_id || ln.avatar_id || `line-${ln.id || lines.indexOf(ln)}`
    if (!castMap.has(key)) {
      castMap.set(key, ln.character_name || 'Unnamed cast member')
    }
  }
  const castMembers = Array.from(castMap.values())

  return (
    <section
      data-testid="dialogue-lane"
      data-mode="dialogue"
      className="rounded-xl ring-1 ring-sky-400/30 bg-sky-500/[0.04] p-3 space-y-3"
    >
      <header className="flex items-start justify-between gap-2 flex-wrap">
        <div className="space-y-0.5">
          <h4 className="text-sm font-semibold text-zinc-100 flex items-center gap-2">
            <span aria-hidden="true">🎭</span>
            Dialogue Scene lane
            <span
              className="text-[10px] rounded-full bg-sky-500/20 text-sky-200 ring-1 ring-sky-400/40 px-2 py-0.5 font-mono"
              title="Mounted while localStorage.adspark.activeMode === 'dialogue'"
            >
              scaffold · PR BL
            </span>
          </h4>
          <p className="text-[11px] text-zinc-400 leading-snug max-w-prose">
            Multi-character stitched skit. Plan Hook / Beat / Closer
            lines across multiple spokespeople; per-line `avatar_videos`
            render then ffmpeg-concat into one branded scene. Render
            handlers ship in a follow-up slice.
          </p>
        </div>
        {hasSpokesperson && (
          <div
            className="flex items-center gap-2 rounded-lg ring-1 ring-sky-400/30 bg-sky-500/10 px-2 py-1"
            aria-label="active spokesperson"
          >
            {activeSpokesperson.portrait_url && (
              <img
                src={activeSpokesperson.portrait_url}
                alt=""
                className="h-6 w-6 rounded-full object-cover"
              />
            )}
            <span className="text-[11px] text-sky-200 font-mono">
              {activeSpokesperson.name || 'Active spokesperson'}
            </span>
          </div>
        )}
      </header>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
        {/* Step 1 — Brief */}
        <div
          data-testid="dialogue-lane-step-brief"
          className="rounded-lg ring-1 ring-zinc-800 bg-zinc-950/50 p-2.5 space-y-1"
        >
          <div className="flex items-center justify-between gap-1">
            <span className="text-[10px] uppercase tracking-wide text-zinc-500 font-mono">
              Step 1 · Brief
            </span>
            {hasCampaign && (
              <span className="text-[9px] text-zinc-600 font-mono">
                latest
              </span>
            )}
          </div>
          {hasCampaign ? (
            <>
              <div className="text-xs text-zinc-200 font-semibold leading-snug">
                {focused.business || 'Untitled campaign'}
              </div>
              {focused.product && (
                <div className="text-[10px] text-zinc-400 leading-snug">
                  {focused.product.length > 60
                    ? focused.product.slice(0, 60) + '…'
                    : focused.product}
                </div>
              )}
              <p className="text-[10px] text-zinc-500 leading-snug pt-1">
                Brief reused from campaign form; lane builder
                follow-up slice adds inline editing.
              </p>
            </>
          ) : (
            <>
              <p className="text-[11px] text-zinc-400 leading-snug">
                No linked campaign yet.
              </p>
              <p className="text-[10px] text-zinc-500 leading-snug">
                Brief capture reuses the existing campaign form.
                Until the lane builder ships, plan dialogue from
                the classic UX Dialogue tab.
              </p>
            </>
          )}
        </div>

        {/* Step 2 — Cast */}
        <div
          data-testid="dialogue-lane-step-cast"
          className="rounded-lg ring-1 ring-zinc-800 bg-zinc-950/50 p-2.5 space-y-1"
        >
          <span className="text-[10px] uppercase tracking-wide text-zinc-500 font-mono">
            Step 2 · Cast
          </span>
          {castMembers.length > 0 ? (
            <>
              <div className="text-[11px] text-zinc-300 leading-snug">
                {castMembers.length}{' '}
                {castMembers.length === 1 ? 'speaker' : 'speakers'}
              </div>
              <ul
                className="space-y-0.5 max-h-[5rem] overflow-y-auto pr-1"
                data-testid="dialogue-lane-cast-list"
              >
                {castMembers.slice(0, 6).map((name, idx) => (
                  <li
                    key={`${name}-${idx}`}
                    className="text-[10px] text-zinc-400 font-mono truncate"
                    title={name}
                  >
                    {name}
                  </li>
                ))}
                {castMembers.length > 6 && (
                  <li className="text-[10px] text-zinc-600 font-mono">
                    +{castMembers.length - 6} more
                  </li>
                )}
              </ul>
              <p className="text-[10px] text-zinc-500 leading-snug pt-1">
                Cast inferred from `dialogue_lines[*]` on the
                focused campaign. Editing rolls into the lane
                builder follow-up.
              </p>
            </>
          ) : (
            <>
              <p className="text-[11px] text-zinc-400 leading-snug">
                {hasCampaign
                  ? 'No dialogue lines planned on this campaign yet.'
                  : 'Cast (multi-character speaker list) ships with the dialogue plan.'}
              </p>
              <p className="text-[10px] text-zinc-500 leading-snug">
                Plan a Hook / Beat / Closer in classic UX Dialogue
                tab; speakers will surface here automatically.
              </p>
            </>
          )}
        </div>

        {/* Step 3 — Lines & Stitch */}
        <div
          data-testid="dialogue-lane-step-lines"
          className="rounded-lg ring-1 ring-zinc-800 bg-zinc-950/50 p-2.5 space-y-1.5"
        >
          <div className="flex items-center justify-between gap-1">
            <span className="text-[10px] uppercase tracking-wide text-zinc-500 font-mono">
              Step 3 · Lines & Stitch
            </span>
            {lineCount > 0 && (
              <span className="text-[9px] text-zinc-600 font-mono">
                {lineCount} {lineCount === 1 ? 'line' : 'lines'}
              </span>
            )}
          </div>
          <div className="space-y-1">
            <button
              type="button"
              disabled
              data-testid="dialogue-lane-lines"
              data-render-target="dialogue-lines"
              data-has-output={
                lines.some((l) => l.video_url) ? 'true' : 'false'
              }
              title="Render wiring lands with the dialogue lane builder. Use the classic Dialogue tab to render today."
              className="w-full flex items-center justify-between gap-2 text-[11px] rounded ring-1 ring-zinc-700 bg-zinc-800/40 text-zinc-300 px-2 py-1 font-mono cursor-not-allowed disabled:opacity-80"
            >
              <span className="truncate">Generate Dialogue Lines</span>
              <span className="text-[9px] text-zinc-500">
                {lines.some((l) => l.video_url)
                  ? 'partial cache'
                  : 'placeholder'}
              </span>
            </button>
            <button
              type="button"
              disabled
              data-testid="dialogue-lane-stitch"
              data-render-target="dialogue-stitch"
              data-has-output={
                focused?.dialogue_scene_video_url ? 'true' : 'false'
              }
              title="Render wiring lands with the dialogue lane builder. Use the classic Dialogue tab to render today."
              className="w-full flex items-center justify-between gap-2 text-[11px] rounded ring-1 ring-zinc-700 bg-zinc-800/40 text-zinc-300 px-2 py-1 font-mono cursor-not-allowed disabled:opacity-80"
            >
              <span className="truncate">Stitch Dialogue Scene</span>
              <span className="text-[9px] text-zinc-500">
                {focused?.dialogue_scene_video_url
                  ? 'cached'
                  : 'placeholder'}
              </span>
            </button>
            <button
              type="button"
              disabled
              data-testid="dialogue-lane-reels"
              data-render-target="dialogue-reels"
              data-has-output={
                focused?.dialogue_scene_reels_url ? 'true' : 'false'
              }
              title="Render wiring lands with the dialogue lane builder. Use the classic Dialogue tab to render today."
              className="w-full flex items-center justify-between gap-2 text-[11px] rounded ring-1 ring-zinc-700 bg-zinc-800/40 text-zinc-300 px-2 py-1 font-mono cursor-not-allowed disabled:opacity-80"
            >
              <span className="truncate">
                Captioned Reels · 720×1280
              </span>
              <span className="text-[9px] text-zinc-500">
                {focused?.dialogue_scene_reels_url
                  ? 'cached'
                  : 'placeholder'}
              </span>
            </button>
          </div>
          {focused?.realtime_transcript_fetched_at && (
            <p className="text-[9px] text-zinc-600 leading-snug">
              last touched{' '}
              <span className="font-mono text-zinc-500">
                {formatTouchedOrDash(focused.realtime_transcript_fetched_at)}
              </span>
            </p>
          )}
          {!hasCampaign && (
            <p className="text-[10px] text-zinc-500 leading-snug">
              Create or select a campaign to render a dialogue scene.
            </p>
          )}
        </div>
      </div>

      {!hasSpokesperson && !hasCampaign && (
        <p
          data-testid="dialogue-lane-empty-hint"
          className="text-[10px] text-zinc-500 leading-snug"
        >
          Pick an active spokesperson (Use as Spokesperson on a card)
          and link them to a campaign with a planned dialogue to
          populate this lane.
        </p>
      )}
    </section>
  )
}

function formatTouchedOrDash(iso) {
  if (!iso) return '—'
  return formatHistoryTimestamp(iso) || '—'
}
