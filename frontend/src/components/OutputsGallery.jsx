/**
 * PR CN — Workspace Outputs Gallery.
 * PR CY — Render full append-only history from `campaign.outputs`
 * (newest-first list of OutputRecord). Falls back to the legacy
 * single-field URL reads (`host_video_url`, `cached_video_url`,
 * etc.) when a campaign has no `outputs` history yet — keeps
 * pre-PR-CY characters / campaigns visible without a backfill.
 *
 * Each output card carries enough context to distinguish multiple
 * renders of the same kind:
 *   - kind label + orientation pill
 *   - parent campaign label (business · product)
 *   - relative created time
 *   - script preview when present (spokesperson_ad)
 *   - "captioned of …" link when derived (spokesperson_reels)
 */

const KIND_META = {
  spokesperson_ad: {
    label: 'Spokesperson Ad',
    orientation: 'horizontal',
    description: 'Lip-synced talking-avatar render.',
  },
  spokesperson_reels: {
    label: 'Captioned Reels',
    orientation: 'vertical',
    description: '720×1280 captioned export of the Spokesperson Ad.',
  },
  cinematic_video: {
    label: 'Cinematic Video',
    orientation: 'horizontal',
    description: 'Silent image-to-video cinematic cut.',
  },
  voiced_commercial: {
    label: 'Voiced Cinematic',
    orientation: 'horizontal',
    description: 'Cinematic visual + spokesperson narration mux.',
  },
  storyboard: {
    label: 'Storyboard',
    orientation: 'horizontal',
    description: '3-shot stitched cinematic concat.',
  },
  storyboard_voiced: {
    label: 'Voiced Storyboard',
    orientation: 'horizontal',
    description: 'Storyboard + spokesperson narration mux.',
  },
  dialogue_scene: {
    label: 'Dialogue Scene',
    orientation: 'horizontal',
    description: 'Multi-character stitched skit with per-line audio.',
  },
  dialogue_scene_reels: {
    label: 'Captioned Dialogue Reels',
    orientation: 'vertical',
    description: '720×1280 captioned export of the Dialogue Scene.',
  },
}

// Legacy single-field fallback for campaigns that don't yet have an
// `outputs` history list. Drop a synthetic OutputRecord per
// populated single-field URL so the gallery still surfaces them.
const LEGACY_FIELDS = [
  { field: 'host_video_url', statusField: 'host_status', kind: 'spokesperson_ad' },
  { field: 'cached_video_url', statusField: 'cache_status', kind: 'cinematic_video' },
  { field: 'voiced_commercial_url', statusField: 'voiced_commercial_status', kind: 'voiced_commercial' },
  { field: 'storyboard_video_url', statusField: 'storyboard_status', kind: 'storyboard' },
  { field: 'storyboard_voiced_url', statusField: 'storyboard_voiced_status', kind: 'storyboard_voiced' },
  { field: 'dialogue_scene_video_url', statusField: 'dialogue_scene_status', kind: 'dialogue_scene' },
  { field: 'spokesperson_reels_url', statusField: 'spokesperson_reels_status', kind: 'spokesperson_reels' },
  { field: 'dialogue_scene_reels_url', statusField: 'dialogue_scene_reels_status', kind: 'dialogue_scene_reels' },
]

const ORIENTATION_LABEL = {
  horizontal: 'Horizontal',
  vertical: 'Vertical · Reels',
}

function formatRelTime(iso) {
  if (!iso) return ''
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return ''
  const delta = (Date.now() - t) / 1000
  if (delta < 60) return 'just now'
  if (delta < 3_600) return `${Math.floor(delta / 60)}m ago`
  if (delta < 86_400) return `${Math.floor(delta / 3_600)}h ago`
  return `${Math.floor(delta / 86_400)}d ago`
}

function buildCardsForCampaign(campaign) {
  const outputs = Array.isArray(campaign.outputs) ? campaign.outputs : []
  if (outputs.length > 0) {
    return outputs.map((o) => {
      const meta = KIND_META[o.kind] || {
        label: o.kind,
        orientation: 'horizontal',
        description: '',
      }
      const parent = o.parent_output_id
        ? outputs.find((p) => p.id === o.parent_output_id)
        : null
      return {
        key: `${campaign.id}:output:${o.id}`,
        campaign,
        url: o.video_url,
        kind: o.kind,
        label: meta.label,
        description: meta.description,
        orientation: meta.orientation,
        status: o.mock_mode ? 'mock' : 'ok',
        createdAt: o.created_at,
        script: o.script,
        parentLabel: parent ? `derived from ${KIND_META[parent.kind]?.label || parent.kind}` : null,
        outputId: o.id,
        // PR DC — variant linkage so the card surface groups
        // multiple takes under their producing Ad Variant.
        variantTitle: o.variant_title || null,
      }
    })
  }
  // Legacy fallback for campaigns that haven't generated anything since
  // PR CY landed. One synthetic card per populated single-field URL.
  const cards = []
  for (const def of LEGACY_FIELDS) {
    const url = campaign[def.field]
    if (!url) continue
    const meta = KIND_META[def.kind]
    if (!meta) continue
    cards.push({
      key: `${campaign.id}:legacy:${def.field}`,
      campaign,
      url: String(url),
      kind: def.kind,
      label: meta.label,
      description: meta.description,
      orientation: meta.orientation,
      status: campaign[def.statusField] || null,
      createdAt: campaign.created_at,
      script: null,
      parentLabel: null,
      outputId: null,
    })
  }
  return cards
}

function discoverOutputs(linkedCampaigns) {
  const campaigns = Array.isArray(linkedCampaigns) ? linkedCampaigns : []
  const cards = []
  for (const campaign of campaigns) {
    cards.push(...buildCardsForCampaign(campaign))
  }
  cards.sort((a, b) =>
    String(b.createdAt || '').localeCompare(String(a.createdAt || '')),
  )
  return cards
}

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
            one playable gallery. Every render is preserved as a
            new entry; re-rendering creates a new billable video,
            not an overwrite.
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
          {total} render{total === 1 ? '' : 's'} across{' '}
          {linkedCampaigns.length} linked campaign
          {linkedCampaigns.length === 1 ? '' : 's'}. Newest first. Every
          render is preserved — re-rendering creates a new billable
          video, not an overwrite.
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
  const scriptPreview = card.script
    ? card.script.length > 140
      ? card.script.slice(0, 140) + '…'
      : card.script
    : null

  return (
    <li
      data-testid="output-card"
      data-output-kind={card.kind}
      data-output-id={card.outputId || ''}
      data-orientation={card.orientation}
      data-status={card.status || ''}
      className="rounded-xl ring-1 ring-zinc-800 bg-zinc-950/40 p-2.5 space-y-2"
    >
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
        {card.variantTitle && (
          <p
            data-testid="output-card-variant"
            className="text-[10px] text-pink-300 font-mono leading-snug"
            title={`Ad Variant: ${card.variantTitle}`}
          >
            {card.variantTitle}
          </p>
        )}
        {scriptPreview && (
          <p
            data-testid="output-card-script"
            className="text-[10px] text-zinc-500 leading-snug italic line-clamp-2"
            title={card.script}
          >
            “{scriptPreview}”
          </p>
        )}
        {card.parentLabel && (
          <p className="text-[9px] text-zinc-500 font-mono">
            {card.parentLabel}
          </p>
        )}
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
        <div className="flex items-center justify-between gap-2 flex-wrap pt-0.5">
          {card.createdAt && (
            <span
              data-testid="output-card-created"
              className="text-[9px] text-zinc-600 font-mono"
              title={card.createdAt}
            >
              {formatRelTime(card.createdAt)}
            </span>
          )}
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
      </div>
    </li>
  )
}
