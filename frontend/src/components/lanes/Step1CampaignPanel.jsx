import { useEffect, useState } from 'react'

import LaneBriefCreator from './LaneBriefCreator.jsx'
import LaneBriefEditor from './LaneBriefEditor.jsx'

/**
 * PR DI — Step 1 panel wrapper.
 *
 * Replaces the bare-Editor / bare-Creator conditional that every
 * v2 lane was carrying inline. Implements the three-state Step 1
 * flow:
 *
 *   1. **No campaign yet** — mount {@link LaneBriefCreator} so the
 *      operator can fill business / product / audience / tone and
 *      save the campaign for the first time. Label reads
 *      "Step 1 · Campaign Setup".
 *
 *   2. **Campaign exists, not editing** — mount a read-only
 *      Campaign Summary card with an `Edit Campaign` button. Label
 *      reads "Step 1 · Campaign Summary". This is the default state
 *      after a campaign exists — the operator should not feel like
 *      they are filling the same form repeatedly.
 *
 *   3. **Campaign exists, editing** — mount {@link LaneBriefEditor}
 *      so the operator can change the saved brief. A `Done editing`
 *      link sits below the editor; clicking it returns to summary
 *      mode without saving. A successful Save auto-exits edit mode.
 *      Label reads "Step 1 · Campaign Setup (editing)".
 *
 * Auto-exits edit mode whenever the focused campaign changes (so
 * the operator can't be stuck in edit mode for one campaign and
 * silently switch into another).
 *
 * Optional `counts` prop renders a small chip row inside the
 * summary — counts come from the parent lane since each lane
 * cares about different scopes (Spokesperson Ad counts ad variants
 * + saved renders; Dialogue counts dialogue lines; Cinematic
 * counts saved videos / reels).
 */
export default function Step1CampaignPanel({
  focused,
  hasSpokesperson = true,
  onCreate = null,
  onSave = null,
  modeLabel = 'campaign',
  testidPrefix = 'lane',
  counts = null,
}) {
  const hasCampaign = Boolean(focused?.id)
  const [editing, setEditing] = useState(false)

  // Auto-exit edit mode on campaign switch — never let stale edit
  // state leak across saved/freshly-selected campaigns.
  useEffect(() => {
    setEditing(false)
  }, [focused?.id])

  const stepLabel = !hasCampaign
    ? 'Step 1 · Campaign Setup'
    : editing
    ? 'Step 1 · Campaign Setup (editing)'
    : 'Step 1 · Campaign Summary'

  const handleSave = async (campaignId, body) => {
    // Editor invokes this with (id, body). On success we exit edit
    // mode so the operator returns to the summary card; on failure
    // we leave the editor mounted so the operator can retry.
    if (!onSave) return
    await onSave(campaignId, body)
    setEditing(false)
  }

  return (
    <div
      data-testid={`${testidPrefix}-lane-step-brief`}
      data-step-state={
        !hasCampaign ? 'creating' : editing ? 'editing' : 'summary'
      }
      className="rounded-lg ring-1 ring-zinc-800 bg-zinc-950/50 p-2.5 space-y-1.5"
    >
      <div className="flex items-center justify-between gap-1">
        <span className="text-[10px] uppercase tracking-wide text-zinc-500 font-mono">
          {stepLabel}
        </span>
        {hasCampaign && !editing && (
          <span className="text-[9px] text-emerald-400 font-mono">
            saved
          </span>
        )}
        {hasCampaign && editing && (
          <span className="text-[9px] text-amber-300 font-mono">
            editing
          </span>
        )}
      </div>

      {!hasCampaign && (
        <LaneBriefCreator
          onCreate={onCreate}
          modeLabel={modeLabel}
          testidPrefix={testidPrefix}
          hasSpokesperson={hasSpokesperson}
        />
      )}

      {hasCampaign && !editing && (
        <CampaignSummary
          campaign={focused}
          counts={counts}
          testidPrefix={testidPrefix}
          onEdit={() => setEditing(true)}
        />
      )}

      {hasCampaign && editing && (
        <div className="space-y-1.5">
          <LaneBriefEditor
            campaign={focused}
            onSave={handleSave}
          />
          <button
            type="button"
            onClick={() => setEditing(false)}
            data-testid={`${testidPrefix}-lane-step-brief-done-editing`}
            className="text-[10px] text-zinc-500 hover:text-zinc-200 font-mono"
            title="Return to the campaign summary without saving changes. Unsaved edits in the editor are discarded."
          >
            ← Done editing (discard unsaved)
          </button>
        </div>
      )}
    </div>
  )
}


/**
 * PR DI — Compact read-only summary of the saved campaign context.
 *
 * Surfaces the four brief fields (business / product / audience /
 * tone) plus an optional counts row (ad variants, saved outputs,
 * dialogue lines) so the operator can see at a glance what they
 * already authored without the visual weight of an editable form.
 *
 * Clicking `Edit Campaign` flips the parent panel into edit mode
 * via the `onEdit` callback. The summary itself stores no state.
 */
function CampaignSummary({
  campaign,
  counts = null,
  testidPrefix = 'lane',
  onEdit = null,
}) {
  if (!campaign) return null
  const business = (campaign.business || '').trim() || 'Untitled campaign'
  const product = (campaign.product || '').trim()
  const audience = (campaign.audience || '').trim()
  const tone = (campaign.tone || '').trim()

  // Counts row — only render the keys the parent supplied so each
  // lane can scope to what it cares about (Spokesperson Ad cares
  // about adVariants + outputs; Dialogue cares about dialogueLines;
  // Cinematic just cares about outputs).
  const countItems = []
  if (counts && Number.isFinite(counts.adVariants)) {
    countItems.push(
      `${counts.adVariants} ad variant${counts.adVariants === 1 ? '' : 's'}`,
    )
  }
  if (counts && Number.isFinite(counts.outputs)) {
    countItems.push(
      `${counts.outputs} saved render${counts.outputs === 1 ? '' : 's'}`,
    )
  }
  if (counts && Number.isFinite(counts.dialogueLines)) {
    countItems.push(
      `${counts.dialogueLines} dialogue line${counts.dialogueLines === 1 ? '' : 's'}`,
    )
  }

  return (
    <div
      data-testid={`${testidPrefix}-lane-campaign-summary`}
      data-campaign-id={campaign.id}
      className="space-y-1.5"
    >
      <div className="flex items-start justify-between gap-2">
        <h5
          className="text-[12px] font-semibold text-zinc-100 truncate"
          title={business}
        >
          {business}
        </h5>
        <button
          type="button"
          onClick={onEdit}
          disabled={!onEdit}
          data-testid={`${testidPrefix}-lane-campaign-summary-edit`}
          title="Open the brief fields for an intentional edit. No Runway calls; just patches business / product / audience / tone."
          className="text-[10px] rounded px-2 py-0.5 font-mono transition-colors ring-1 ring-zinc-700 bg-zinc-800/60 hover:bg-zinc-700/70 hover:ring-zinc-500 text-zinc-200 shrink-0"
        >
          Edit Campaign
        </button>
      </div>
      <dl className="space-y-0.5 text-[10px] leading-snug">
        {product && (
          <div className="flex gap-1.5">
            <dt className="text-zinc-500 font-mono uppercase tracking-wide text-[9px] shrink-0 w-[4.25rem] pt-0.5">
              Product
            </dt>
            <dd className="text-zinc-300 line-clamp-2 flex-1">{product}</dd>
          </div>
        )}
        {audience && (
          <div className="flex gap-1.5">
            <dt className="text-zinc-500 font-mono uppercase tracking-wide text-[9px] shrink-0 w-[4.25rem] pt-0.5">
              Audience
            </dt>
            <dd className="text-zinc-300 line-clamp-2 flex-1">{audience}</dd>
          </div>
        )}
        {tone && (
          <div className="flex gap-1.5">
            <dt className="text-zinc-500 font-mono uppercase tracking-wide text-[9px] shrink-0 w-[4.25rem] pt-0.5">
              Tone
            </dt>
            <dd className="text-zinc-300 line-clamp-1 flex-1">{tone}</dd>
          </div>
        )}
      </dl>
      {countItems.length > 0 && (
        <p
          className="text-[9px] text-zinc-500 font-mono pt-0.5 border-t border-zinc-800/60"
          data-testid={`${testidPrefix}-lane-campaign-summary-counts`}
        >
          {countItems.join(' · ')}
        </p>
      )}
    </div>
  )
}
