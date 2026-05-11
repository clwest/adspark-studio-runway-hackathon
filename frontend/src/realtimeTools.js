/**
 * PR EE — Realtime tool dispatch (client side).
 *
 * Tool names + descriptions are advertised by the backend in
 * `DEFAULT_REALTIME_TOOLS` (see
 * `backend/app/services/realtime_avatar_client.py`). When the
 * avatar's LLM decides to invoke one, the SDK delivers a
 * `client_event` over WebRTC with shape:
 *
 *   { type: 'client_event', tool: <name>, args: <object> }
 *
 * This module dispatches that event to a per-tool handler built
 * from the active campaign + character context. Handlers are
 * fire-and-forget — they kick off async work and let the avatar
 * keep talking. The frontend separately notifies the operator
 * via toast / inline UI.
 *
 * Keep names in sync with the backend catalog. The avatar can
 * only invoke names that exist on both sides; the SDK silently
 * drops events for unknown names.
 */

import { api } from './api'

export const REALTIME_TOOL_NAMES = Object.freeze({
  RECALL_KNOWLEDGE: 'recall_knowledge',
  RENDER_SPOKESPERSON_AD: 'render_spokesperson_ad',
  SHOW_VIDEOS_TAB: 'show_videos_tab',
})

// Custom window-event names SpokespersonWorkspace listens for to
// react to avatar tool invocations without prop-drilling through
// CampaignGallery → RealtimeSpokesperson. Loose coupling.
//   - SHOW_VIDEOS_EVENT: flip activeTab → 'outputs'
//   - REFRESH_CAMPAIGNS_EVENT: re-fetch campaigns so a newly-rendered
//     output (appended server-side via the tool path) actually
//     surfaces in the Videos tab. UI-button renders refresh local
//     state inline; tool-path renders don't, hence this event.
export const SHOW_VIDEOS_EVENT = 'character-os:show-videos'
export const REFRESH_CAMPAIGNS_EVENT = 'character-os:refresh-campaigns'

/**
 * Dispatch a `client_event` to the correct handler.
 *
 * @param {{tool: string, args: unknown}} event  SDK event payload
 * @param {object} deps                          per-call dependencies
 * @param {object} deps.campaign                 current campaign record
 * @param {object|null} deps.character           attached spokesperson (knowledge_sources)
 * @param {(message: string, tone?: string) => void} deps.announce  toast helper
 * @returns {Promise<void>}
 */
export async function dispatchRealtimeToolEvent(event, deps) {
  if (!event || event.type !== 'client_event') return
  const { tool, args } = event
  const { campaign, character, announce } = deps || {}

  switch (tool) {
    case REALTIME_TOOL_NAMES.RECALL_KNOWLEDGE: {
      // Pure-frontend: the character record already carries
      // `knowledge_sources` (PR CX). Filter inline by the avatar's
      // query so the toast tells the operator what we surfaced.
      const query = String((args && args.query) || '').trim().toLowerCase()
      const sources = (character && character.knowledge_sources) || []
      const matched = query
        ? sources.filter((s) => {
            const haystack = `${s.title || ''} ${s.content || ''}`.toLowerCase()
            return haystack.includes(query)
          })
        : sources
      const count = matched.length
      if (count > 0) {
        const preview = matched
          .slice(0, 3)
          .map((s) => s.title || '(untitled)')
          .join(', ')
        announce?.(
          `📚 ${character?.name || 'Avatar'} recalled ${count} knowledge ` +
            `source${count === 1 ? '' : 's'}: ${preview}.`,
          'info',
        )
      } else {
        announce?.(
          `📚 ${character?.name || 'Avatar'} searched knowledge ` +
            `for "${query || '(empty)'}" — no matches.`,
          'info',
        )
      }
      return
    }

    case REALTIME_TOOL_NAMES.RENDER_SPOKESPERSON_AD: {
      const script = String((args && args.script) || '').trim()
      if (!campaign?.id) {
        announce?.('Could not render — no active campaign.', 'error')
        return
      }
      if (!script) {
        announce?.(
          'Avatar asked to render but provided no script.',
          'error',
        )
        return
      }
      announce?.(
        `🎬 Rendering Spokesperson Ad for ${campaign.product || campaign.business || campaign.id}… ` +
          'Should be ~30–45 seconds.',
        'info',
      )
      try {
        await api.generateSpokespersonAd(campaign.id, { script_override: script })
        announce?.(
          '✅ Spokesperson Ad rendered — see Videos tab.',
          'success',
        )
        // Refresh the workspace's local campaigns state so the new
        // OutputRecord shows up — without this the Videos tab keeps
        // rendering the stale list from initial mount.
        window.dispatchEvent(new CustomEvent(REFRESH_CAMPAIGNS_EVENT))
        // Auto-navigate so the operator can see the new output land.
        window.dispatchEvent(new CustomEvent(SHOW_VIDEOS_EVENT))
      } catch (err) {
        const msg = err?.message ? String(err.message) : 'unknown error'
        announce?.(`Spokesperson Ad render failed: ${msg}`, 'error')
      }
      return
    }

    case REALTIME_TOOL_NAMES.SHOW_VIDEOS_TAB: {
      window.dispatchEvent(new CustomEvent(SHOW_VIDEOS_EVENT))
      announce?.(
        `📺 ${character?.name || 'Avatar'} opened the Videos tab.`,
        'info',
      )
      return
    }

    default:
      // Unknown tool — ignore. The avatar may try names we haven't
      // wired yet; better to silently no-op than crash the session.
      // eslint-disable-next-line no-console
      console.warn('[realtimeTools] unknown tool:', tool)
  }
}
