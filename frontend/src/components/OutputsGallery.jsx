/**
 * PR CN — Workspace Outputs Gallery.
 *
 * Replaces the `<TabComingSoon>` placeholder on the
 * `/spokespeople/:id` Outputs tab with a unified media
 * gallery surfacing every cached output URL across the
 * spokesperson's linked campaigns.
 *
 * Authoritative output URL set (cross-referenced against
 * `CampaignGallery.jsx`'s render paths + `Campaign` model):
 *
 *   1. cached_video_url        + cache_status              ← Cinematic Video
 *   2. host_video_url          + host_status               ← Spokesperson Ad
 *   3. voiced_commercial_url   + voiced_commercial_status  ← Voiced Cinematic
 *   4. storyboard_video_url    + storyboard_status         ← Storyboard
 *   5. storyboard_voiced_url   + storyboard_voiced_status  ← Voiced Storyboard
 *   6. dialogue_scene_video_url + dialogue_scene_status    ← Dialogue Scene
 *   7. spokesperson_reels_url  + spokesperson_reels_status ← Spokesperson Reels (720×1280)
 *   8. dialogue_scene_reels_url + dialogue_scene_reels_status ← Dialogue Reels (720×1280)
 *
 * No backend changes; the gallery just reads campaign rows
 * the workspace already fetches. Empty state when the
 * spokesperson has no linked campaigns OR linked campaigns
 * have no cached outputs yet.
 */

const OUTPUT_FIELDS = [
  {
    field: 'host_video_url',
    statusField: 'host_status',
    label: 'Spokesperson Ad',
    orientation: 'horizontal',
    description: 'Lip-synced talking-avatar render.',
  },
  {
    field: 'cached_video_url',
    statusField: 'cache_status',
    label: 'Cinematic Video',
    orientation: 'horizontal',
    description: 'Silent image-to-video cinematic cut.',
  },
  {
    field: 'voiced_commercial_url',
    statusField: 'voiced_commercial_status',
    label: 'Voiced Cinematic',
    orientation: 'horizontal',
    description:
      'Cinematic visual + spokesperson narration mux.',
  },
  {
    field: 'storyboard_video_url',
    statusField: 'storyboard_status',
    label: 'Storyboard',
    orientation: 'horizontal',
    description: '3-shot stitched cinematic concat.',
  },
  {
    field: 'storyboard_voiced_url',
    statusField: 'storyboard_voiced_status',
    label: 'Voiced Storyboard',
    orientation: 'horizontal',
    description: 'Storyboard + spokesperson narration mux.',
  },
  {
    field: 'dialogue_scene_video_url',
    statusField: 'dialogue_scene_status',
    label: 'Dialogue Scene',
    orientation: 'horizontal',
    description:
      'Multi-character stitched skit with per-line audio.',
  },
  {
    field: 'spokesperson_reels_url',
    statusField: 'spokesperson_reels_status',
    label: 'Captioned Reels',
    orientation: 'vertical',
    description: '720×1280 captioned export of the Spokesperson Ad.',
  },
  {
    field: 'dialogue_scene_reels_url',
    statusField: 'dialogue_scene_reels_status',
    label: 'Captioned Dialogue Reels',
    orientation: 'vertical',
    description: '720×1280 captioned export of the Dialogue Scene.',
  },
]

const STATUS_TONE = {
  ok: 'emerald',
  failed: 'rose',
  unavailable: 'amber',
  no_video: 'amber',
  no_host: 'amber',
  no_audio: 'amber',
  pending: 'amber',
  running: 'amber',
  mock: 'zinc',
}

const ORIENTATION_LABEL = {
  horizontal: 'Horizontal',
  vertical: 'Vertical · Reels',
}

/**
 * Build a flat list of output cards from a list of linked
 * campaigns. Each campaign contributes 0..N cards depending
 * on which output URLs are populated. Cards are pre-sorted
 * newest → oldest using campaign.created_at as the proxy
 * (per-output timestamps don't all exist on the model).
 */
function discoverOutputs(linkedCampaigns) {
  const campaigns = Array.isArray(linkedCampaigns) ? linkedCampaigns : []
  const cards = []
  for (const campaign of campaigns) {
    for (const def of OUTPUT_FIELDS) {
      const url = campaign[def.field]
      if (!url) continue
      const status = campaign[def.statusField] || null
      cards.push({
        key: `${campaign.id}:${def.field}`,
        campaign,
        url: String(url),
        label: def.label,
        description: def.description,
        orientation: def.orientation,
        status,
      })
    }
  }
  // Sort newest-first by the parent campaign's created_at.
  cards.sort((a, b) =>
    String(b.campaign.created_at || '').localeCompare(
      String(a.campaign.created_at || ''),
    ),
  )
  return cards
}

export default function OutputsGallery({ linkedCampaigns = [] }) {
  const cards = discoverOutputs(linkedCampaigns)
  const total = cards.length

  if (total === 0) {
    return (
      <section
        data-testid="outputs-gallery"
        data-output-count={0}
        className="rounded-2xl ring-1 ring-zinc-800 bg-zinc-950/40 p-5 space-y-2 text-center"
      >
        <header className="space-y-1">
          <h2 className="text-sm font-semibold text-zinc-100">
            Outputs
          </h2>
          <p className="text-[11px] text-zinc-400 leading-relaxed max-w-prose mx-auto">
            Cinematic visuals, spokesperson ads, dialogue scenes,
            reels, and voiced exports across every linked campaign —
            one playable gallery.
          </p>
        </header>
        <p
          data-testid="outputs-empty"
          className="text-[10px] rounded-full bg-pink-500/15 text-pink-200 ring-1 ring-pink-400/30 px-2 py-0.5 font-mono inline-block"
        >
          No outputs yet. Create a campaign or generate from the
          Campaigns tab.
        </p>
      </section>
    )
  }

  return (
    <section
      data-testid="outputs-gallery"
      data-output-count={total}
      className="space-y-3"
    >
      <header className="rounded-2xl ring-1 ring-zinc-800 bg-zinc-950/40 p-3">
        <h2 className="text-sm font-semibold text-zinc-100">Outputs</h2>
        <p className="text-[11px] text-zinc-400 leading-snug">
          {total} cached output{total === 1 ? '' : 's'} across{' '}
          {linkedCampaigns.length} linked campaign
          {linkedCampaigns.length === 1 ? '' : 's'}. Newest first.
        </p>
      </header>
      <ul className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5">
        {cards.map((card) => (
          <OutputCard key={card.key} card={card} />
        ))}
      </ul>
    </section>
  )
}

function OutputCard({ card }) {
  const tone = STATUS_TONE[String(card.status || '').toLowerCase()] || 'zinc'
  const statusClass = {
    emerald: 'bg-emerald-500/15 text-emerald-200 ring-emerald-400/40',
    rose: 'bg-rose-500/15 text-rose-200 ring-rose-400/40',
    amber: 'bg-amber-500/15 text-amber-200 ring-amber-400/40',
    zinc: 'bg-zinc-800 text-zinc-400 ring-zinc-700',
  }[tone]
  const isVertical = card.orientation === 'vertical'

  return (
    <li
      data-testid="output-card"
      data-output-field={card.key.split(':')[1]}
      data-orientation={card.orientation}
      data-status={card.status || ''}
      className="rounded-xl ring-1 ring-zinc-800 bg-zinc-950/40 p-2.5 space-y-2"
    >
      {/* Inline preview. Uses preload="metadata" + muted so the
          browser pulls only the first frame; never autoplays. */}
      <div
        className={
          'rounded-lg overflow-hidden ring-1 ring-zinc-800 bg-black ' +
          (isVertical
            ? 'aspect-[9/16] mx-auto max-w-[12rem]'
            : 'aspect-video')
        }
      >
        <video
          data-testid="output-card-video"
          src={card.url}
          controls
          muted
          playsInline
          preload="metadata"
          className="w-full h-full"
        />
      </div>

      <div className="space-y-1">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <span className="text-xs font-semibold text-zinc-100">
            {card.label}
          </span>
          <span
            className="text-[9px] rounded-full bg-zinc-800/70 text-zinc-300 ring-1 ring-zinc-700 px-2 py-0.5 font-mono shrink-0"
            title={card.orientation}
          >
            {ORIENTATION_LABEL[card.orientation] || card.orientation}
          </span>
        </div>
        <p className="text-[10px] text-zinc-400 leading-snug">
          {card.description}
        </p>
        <div className="flex items-center justify-between gap-2 flex-wrap pt-0.5">
          <span
            className="text-[10px] text-zinc-300 leading-snug truncate"
            title={`${card.campaign.business || 'campaign'}${card.campaign.product ? ' · ' + card.campaign.product : ''}`}
          >
            <span className="font-mono text-zinc-500">
              {String(card.campaign.id).slice(0, 8)}
            </span>{' '}
            {card.campaign.business || 'campaign'}
            {card.campaign.product ? ` · ${card.campaign.product}` : ''}
          </span>
          {card.status && (
            <span
              className={`text-[9px] rounded-full px-2 py-0.5 font-mono ring-1 ${statusClass} shrink-0`}
              title={`status: ${card.status}`}
            >
              {String(card.status).replace(/_/g, ' ')}
            </span>
          )}
        </div>
        <a
          href={card.url}
          target="_blank"
          rel="noreferrer"
          download
          data-testid="output-card-link"
          className="inline-block text-[10px] text-spark hover:underline font-mono"
        >
          open / download ↗
        </a>
      </div>
    </li>
  )
}
