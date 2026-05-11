import { useMemo, useState } from 'react'

import ConversationsHistory from './ConversationsHistory.jsx'
import OutputsGallery from './OutputsGallery.jsx'

/**
 * PR DK — Videos tab wrapper.
 *
 * Adds a sub-tab toggle between **Videos** (generated media —
 * spokesperson ads, dialogue scenes, reels, cinematic outputs) and
 * **Conversations** (realtime transcripts persisted on the campaign
 * via PR AJ).
 *
 * The Videos sub-tab mounts the existing {@link OutputsGallery}
 * unchanged. The Conversations sub-tab mounts the new
 * {@link ConversationsHistory} which reads
 * `campaign.realtime_transcript_*` fields and renders one card per
 * campaign with a saved transcript.
 *
 * Tab state is local React state — defaults to Videos so the first
 * paint matches the pre-PR-DK behaviour. Sub-tab choice does not
 * persist across reloads on purpose (cheap to re-click; avoids
 * stale state hiding new media after a heavy session).
 */
export default function VideosTab({
  linkedCampaigns = [],
  character = null,
}) {
  const [activeSubTab, setActiveSubTab] = useState('videos')

  // Counts surface inside each pill so the operator sees scope
  // before clicking. Output count walks every campaign's
  // `outputs[]` + legacy single-field fallback (matches what
  // OutputsGallery itself sees). Conversation count filters to
  // campaigns that actually have persisted turns.
  const counts = useMemo(() => {
    let outputCount = 0
    let convoCount = 0
    for (const c of linkedCampaigns) {
      if (Array.isArray(c.outputs) && c.outputs.length > 0) {
        outputCount += c.outputs.length
      } else {
        // Legacy fallback — count any populated single-field URL.
        for (const field of [
          'host_video_url',
          'cached_video_url',
          'voiced_commercial_url',
          'storyboard_video_url',
          'storyboard_voiced_url',
          'dialogue_scene_video_url',
          'spokesperson_reels_url',
          'dialogue_scene_reels_url',
        ]) {
          if (c[field]) outputCount += 1
        }
      }
      if (
        Array.isArray(c.realtime_transcript_turns) &&
        c.realtime_transcript_turns.length > 0 &&
        c.realtime_transcript_status !== 'no_session'
      ) {
        convoCount += 1
      }
    }
    return { videos: outputCount, conversations: convoCount }
  }, [linkedCampaigns])

  return (
    <div data-testid="videos-tab" className="space-y-3">
      <div
        role="tablist"
        aria-label="Videos and Conversations"
        data-testid="videos-tab-subtabs"
        className="flex items-center gap-1.5 flex-wrap"
      >
        <SubTabPill
          label="Videos"
          count={counts.videos}
          active={activeSubTab === 'videos'}
          onClick={() => setActiveSubTab('videos')}
          testid="videos-tab-subtab-videos"
        />
        <SubTabPill
          label="Conversations"
          count={counts.conversations}
          active={activeSubTab === 'conversations'}
          onClick={() => setActiveSubTab('conversations')}
          testid="videos-tab-subtab-conversations"
        />
      </div>
      {activeSubTab === 'videos' && (
        <OutputsGallery linkedCampaigns={linkedCampaigns} />
      )}
      {activeSubTab === 'conversations' && (
        <ConversationsHistory
          linkedCampaigns={linkedCampaigns}
          character={character}
        />
      )}
    </div>
  )
}


function SubTabPill({ label, count, active, onClick, testid }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      data-testid={testid}
      data-active={active ? 'true' : 'false'}
      onClick={onClick}
      className={
        'text-[11px] rounded-full px-3 py-1 font-mono transition-colors ring-1 ' +
        (active
          ? 'ring-pink-400 bg-pink-500/20 text-pink-100'
          : 'ring-zinc-700 bg-zinc-900/60 hover:ring-pink-400/40 hover:text-zinc-100 text-zinc-300')
      }
    >
      {label}
      <span
        className={
          'ml-1.5 text-[9px] ' + (active ? 'text-pink-200' : 'text-zinc-500')
        }
      >
        {count}
      </span>
    </button>
  )
}
