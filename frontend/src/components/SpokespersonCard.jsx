import { Link } from 'react-router-dom'

const TEMPLATE_LABELS = {
  mascot: 'Mascot',
  founder: 'Founder',
  coach: 'Coach',
  local_guide: 'Local Guide',
}

/**
 * PR CM — Spokesperson library tile (simplified).
 *
 * The library tile used to be a mini-app — three tabs
 * (Identity / Knowledge / Appearances), an embedded
 * `<CharacterCard>` on Identity that exposed every voice +
 * portrait + avatar control, plus per-row mode pills and
 * gallery click-through inside Appearances. The workspace at
 * `/spokespeople/:id` now owns all of those surfaces (PR CC
 * Identity tab, PR CE Campaigns tab + lanes, PR CL hint
 * round-trip), so the homepage tile can drop back to its
 * proper job: **browse → identify → open**.
 *
 * What the tile shows now:
 * - portrait (or "Portrait pending" placeholder when blank)
 * - name (h3)
 * - archetype/persona pill
 * - subject/role one-liner (`character.subject`)
 * - voice state pill (preset / cloned / applied / drift /
 *   failed — same vocabulary PR CB introduced)
 * - campaign count chip
 * - outputs count chip (only when > 0)
 * - transcript count chip (only when > 0)
 * - primary "Open Spokesperson →" link to
 *   `/spokespeople/:id`
 *
 * What's gone (now lives in the workspace):
 * - the Identity / Knowledge / Appearances tab strip
 * - the embedded `<CharacterCard>`
 * - voice clone / apply / refresh / repair affordances
 * - portrait generation buttons
 * - per-campaign mode pills + gallery click-through
 * - the "Use as Spokesperson" toggle
 *
 * Operators who need any of those click "Open Spokesperson →"
 * to reach the dedicated workspace.
 *
 * Backend untouched. Props that PR CB passed through for the
 * embedded CharacterCard (onGeneratePortrait, onCreateAvatar,
 * onCloneVoice, onApplyVoiceToAvatar, onRefreshAvatarVoice,
 * onRefreshVoicePreview, onSetActive, busyAction, onDelete,
 * onOpenCampaign) are no longer used here. Parents that still
 * pass them won't break — extra props are silently dropped.
 */
export default function SpokespersonCard({
  character,
  // PR CB — campaigns linked via character_id; drives the
  // campaign / output / transcript count chips.
  linkedCampaigns = [],
  // PR U — kept so the parent can highlight the active
  // spokesperson with a subtle ring even though the tile no
  // longer offers a "Use as Spokesperson" toggle.
  isActive = false,
}) {
  const c = character
  const counts = summariseCounts(linkedCampaigns)

  const personaLabel =
    TEMPLATE_LABELS[c.template] || c.template || 'Spokesperson'

  // PR CB voice-state vocabulary preserved for consistency
  // with the workspace header pill.
  const voicePill = (() => {
    if (c.custom_voice_status === 'ready') {
      const drift = c.avatar_voice_drift_status
      const patch = c.custom_voice_avatar_patch_status
      if (drift === 'match') {
        return { tone: 'emerald', label: 'voice · cloned · match' }
      }
      if (drift === 'drift') {
        return { tone: 'rose', label: 'voice · cloned · drift' }
      }
      if (patch === 'applied' || patch === 'mock_patched') {
        return { tone: 'emerald', label: 'voice · cloned · applied' }
      }
      return { tone: 'amber', label: 'voice · cloned · pending' }
    }
    if (c.custom_voice_status === 'mock') {
      return { tone: 'zinc', label: 'voice · cloned (mock)' }
    }
    if (c.custom_voice_status === 'failed') {
      return { tone: 'rose', label: 'voice · clone failed' }
    }
    return {
      tone: 'zinc',
      label: `voice · ${c.voice_preset || 'vincent'}`,
    }
  })()
  const voicePillClass = {
    emerald: 'bg-emerald-500/15 text-emerald-200 ring-1 ring-emerald-400/40',
    rose: 'bg-rose-500/15 text-rose-200 ring-1 ring-rose-400/40',
    amber: 'bg-amber-500/15 text-amber-200 ring-1 ring-amber-400/40',
    zinc: 'bg-zinc-800 text-zinc-400 ring-1 ring-zinc-700',
  }[voicePill.tone]

  return (
    <div
      data-testid="spokesperson-card"
      data-spokesperson-id={c.id}
      data-active={isActive ? 'true' : 'false'}
      className={
        'rounded-xl bg-zinc-950/40 p-3 space-y-2.5 ring-1 transition-colors ' +
        (isActive
          ? 'ring-pink-400/50 bg-pink-500/[0.04]'
          : 'ring-pink-400/15 hover:ring-pink-400/30')
      }
    >
      {c.portrait_url ? (
        <img
          src={c.portrait_url}
          alt={`${c.name || 'spokesperson'} portrait`}
          data-testid="spokesperson-tile-portrait"
          className="w-full aspect-square rounded-lg object-cover ring-1 ring-zinc-800"
        />
      ) : (
        <div
          data-testid="spokesperson-tile-portrait-placeholder"
          className="w-full aspect-square rounded-lg ring-1 ring-zinc-800 bg-zinc-900/60 flex flex-col items-center justify-center gap-1 text-center px-3"
        >
          <span aria-hidden="true" className="text-2xl text-zinc-700">
            ✦
          </span>
          <span className="text-[11px] text-zinc-400 font-mono">
            Portrait pending
          </span>
          <span className="text-[10px] text-zinc-600 leading-snug">
            Open workspace to generate.
          </span>
        </div>
      )}

      <div className="space-y-1">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <h3
            data-testid="spokesperson-tile-name"
            className="text-sm font-semibold text-zinc-100 leading-tight truncate"
            title={c.name}
          >
            {c.name || 'Untitled spokesperson'}
          </h3>
          <span
            data-testid="spokesperson-tile-persona"
            data-template={c.template || ''}
            className="text-[10px] rounded-full bg-pink-500/20 text-pink-200 ring-1 ring-pink-400/40 px-2 py-0.5 font-mono shrink-0"
            title={`template: ${c.template || 'unknown'}`}
          >
            {personaLabel}
          </span>
        </div>
        {c.subject && (
          <p
            data-testid="spokesperson-tile-subject"
            className="text-[11px] text-zinc-400 leading-snug line-clamp-2"
            title={c.subject}
          >
            {c.subject}
          </p>
        )}
      </div>

      <div
        data-testid="spokesperson-card-summary"
        data-linked-count={counts.linkedCount}
        data-output-count={counts.outputCount}
        data-transcript-count={counts.transcriptCount}
        data-voice-tone={voicePill.tone}
        className="flex flex-wrap items-center gap-1"
      >
        <span
          data-testid="spokesperson-summary-voice"
          title={`voice_preset=${c.voice_preset || 'vincent'} · custom_voice_status=${c.custom_voice_status || 'none'} · drift=${c.avatar_voice_drift_status || 'unknown'}`}
          className={`text-[9px] rounded-full px-2 py-0.5 font-mono ${voicePillClass}`}
        >
          {voicePill.label}
        </span>
        <span
          data-testid="spokesperson-summary-linked"
          title={`${counts.linkedCount} campaigns linked via character_id`}
          className="text-[9px] rounded-full bg-zinc-800/70 text-zinc-300 ring-1 ring-zinc-700 px-2 py-0.5 font-mono"
        >
          {counts.linkedCount} campaigns
        </span>
        {counts.outputCount > 0 && (
          <span
            data-testid="spokesperson-summary-outputs"
            title="Cached MP4 / MP3 outputs across all linked campaigns."
            className="text-[9px] rounded-full bg-zinc-800/70 text-zinc-300 ring-1 ring-zinc-700 px-2 py-0.5 font-mono"
          >
            {counts.outputCount} outputs
          </span>
        )}
        {counts.transcriptCount > 0 && (
          <span
            data-testid="spokesperson-summary-transcripts"
            title="Realtime transcript history entries across all linked campaigns."
            className="text-[9px] rounded-full bg-zinc-800/70 text-zinc-300 ring-1 ring-zinc-700 px-2 py-0.5 font-mono"
          >
            {counts.transcriptCount} transcripts
          </span>
        )}
      </div>

      <Link
        to={`/spokespeople/${encodeURIComponent(c.id)}`}
        data-testid="spokesperson-summary-open"
        title="Open this spokesperson's dedicated workspace."
        className="block text-center text-xs rounded-md bg-pink-500/30 hover:bg-pink-500/45 text-pink-100 ring-1 ring-pink-400/40 px-3 py-1.5 font-mono transition-colors"
      >
        Open Spokesperson →
      </Link>
    </div>
  )
}

/**
 * PR CM — single source of truth for the per-tile count
 * chips. `outputCount` mirrors the library-wide stats math
 * + PR CB's earlier `summariseKnowledge.outputCount`.
 */
function summariseCounts(linkedCampaigns) {
  const campaigns = Array.isArray(linkedCampaigns) ? linkedCampaigns : []
  const linkedCount = campaigns.length
  const outputCount = campaigns.reduce((sum, c) => {
    let n = 0
    if (c.cached_video_url) n += 1
    if (c.host_video_url) n += 1
    if (c.voiced_commercial_url) n += 1
    if (c.storyboard_video_url) n += 1
    if (c.spokesperson_reels_url) n += 1
    if (c.dialogue_scene_video_url) n += 1
    if (c.dialogue_scene_reels_url) n += 1
    return sum + n
  }, 0)
  const transcriptCount = campaigns.reduce(
    (sum, c) =>
      sum +
      (Array.isArray(c.realtime_transcript_history)
        ? c.realtime_transcript_history.length
        : 0),
    0,
  )
  return { linkedCount, outputCount, transcriptCount }
}
