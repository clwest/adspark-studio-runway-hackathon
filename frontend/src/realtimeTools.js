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
  AUTO_WRITE_AND_RENDER_AD: 'auto_write_and_render_ad',
  RENDER_LONG_SPOKESPERSON_AD: 'render_long_spokesperson_ad',
  AUTO_WRITE_AND_RENDER_LONG_AD: 'auto_write_and_render_long_ad',
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

    case REALTIME_TOOL_NAMES.AUTO_WRITE_AND_RENDER_AD: {
      // PR EK — Demo-stopper flow: operator gives the avatar a
      // free-form prompt; this chains the LLM + Runway calls. Two
      // toasts narrate the progression so the ~45-60s wait doesn't
      // feel frozen. Each stage is independently catchable so a
      // failure surfaces *which* stage broke (Llama vs Runway).
      const prompt = String((args && args.prompt) || '').trim()
      if (!campaign?.id) {
        announce?.('Could not run — no active campaign.', 'error')
        return
      }
      if (!prompt) {
        announce?.(
          'Avatar invoked auto-write-and-render with no prompt — ignoring.',
          'error',
        )
        return
      }
      announce?.(
        `🤖 Llama is drafting an ad about "${prompt.slice(0, 60)}${
          prompt.length > 60 ? '…' : ''
        }". ~8 seconds.`,
        'info',
      )
      let writtenScript = ''
      try {
        const result = await api.autoWriteAdScript(campaign.id, {
          mode: 'short',
          spin: prompt,
        })
        writtenScript = String((result && result.script) || '').trim()
        if (!writtenScript) {
          announce?.(
            'Llama returned an empty script — try again with a clearer prompt.',
            'error',
          )
          return
        }
        announce?.(
          `✍️ Script ready (${writtenScript.length} chars). Sending to ` +
            `${character?.name || 'avatar'} now…`,
          'success',
        )
      } catch (err) {
        const msg = err?.message ? String(err.message) : 'unknown error'
        announce?.(`Llama drafting failed: ${msg}`, 'error')
        return
      }
      announce?.(
        `🎬 Rendering Spokesperson Ad with ${
          character?.name || 'the avatar'
        }… ~30-45 seconds.`,
        'info',
      )
      try {
        await api.generateSpokespersonAd(campaign.id, {
          script_override: writtenScript,
        })
        announce?.(
          '✅ Auto-written ad rendered — see Videos tab.',
          'success',
        )
        window.dispatchEvent(new CustomEvent(REFRESH_CAMPAIGNS_EVENT))
        window.dispatchEvent(new CustomEvent(SHOW_VIDEOS_EVENT))
      } catch (err) {
        const msg = err?.message ? String(err.message) : 'unknown error'
        announce?.(
          `Render failed (script was: "${writtenScript.slice(0, 60)}${
            writtenScript.length > 60 ? '…' : ''
          }"): ${msg}`,
          'error',
        )
      }
      return
    }

    case REALTIME_TOOL_NAMES.RENDER_LONG_SPOKESPERSON_AD: {
      // PR EK — verbatim long-ad render. Operator gave the avatar a
      // full long script; backend chunks + stitches.
      const script = String((args && args.script) || '').trim()
      if (!campaign?.id) {
        announce?.('Could not render — no active campaign.', 'error')
        return
      }
      if (!script) {
        announce?.(
          'Avatar asked to render Long Ad but provided no script.',
          'error',
        )
        return
      }
      announce?.(
        `🎬 Rendering Long Spokesperson Ad (${script.length} chars) with ` +
          `${character?.name || 'the avatar'}… ~2-4 minutes (multi-chunk).`,
        'info',
      )
      try {
        await api.generateLongSpokespersonAd(campaign.id, { script })
        announce?.(
          '✅ Long Spokesperson Ad rendered — see Videos tab.',
          'success',
        )
        window.dispatchEvent(new CustomEvent(REFRESH_CAMPAIGNS_EVENT))
        window.dispatchEvent(new CustomEvent(SHOW_VIDEOS_EVENT))
      } catch (err) {
        const msg = err?.message ? String(err.message) : 'unknown error'
        announce?.(`Long Ad render failed: ${msg}`, 'error')
      }
      return
    }

    case REALTIME_TOOL_NAMES.AUTO_WRITE_AND_RENDER_LONG_AD: {
      // PR EK — Demo-stopper for long form. Chains:
      //   1. POST /auto-write-script mode='long' (~10s)
      //   2. POST /long-spokesperson-ad (chunks + N×avatar_videos)
      // Total wall clock typically 2-5 minutes; toasts narrate
      // both stages so the operator never wonders if it's stuck.
      const prompt = String((args && args.prompt) || '').trim()
      if (!campaign?.id) {
        announce?.('Could not run — no active campaign.', 'error')
        return
      }
      if (!prompt) {
        announce?.(
          'Avatar invoked long auto-write with no prompt — ignoring.',
          'error',
        )
        return
      }
      announce?.(
        `🤖 Llama is drafting a LONG ad about "${prompt.slice(0, 60)}${
          prompt.length > 60 ? '…' : ''
        }". ~10 seconds.`,
        'info',
      )
      let writtenScript = ''
      try {
        const result = await api.autoWriteAdScript(campaign.id, {
          mode: 'long',
          spin: prompt,
        })
        writtenScript = String((result && result.script) || '').trim()
        if (!writtenScript) {
          announce?.(
            'Llama returned an empty long script — try again.',
            'error',
          )
          return
        }
        announce?.(
          `✍️ Long script ready (${writtenScript.length} chars). ` +
            `Chunking + rendering with ${character?.name || 'the avatar'}…`,
          'success',
        )
      } catch (err) {
        const msg = err?.message ? String(err.message) : 'unknown error'
        announce?.(`Llama long-drafting failed: ${msg}`, 'error')
        return
      }
      announce?.(
        `🎬 Rendering Long Spokesperson Ad (multi-chunk stitch)… ` +
          `Typically 2-4 minutes total.`,
        'info',
      )
      try {
        await api.generateLongSpokespersonAd(campaign.id, {
          script: writtenScript,
        })
        announce?.(
          '✅ Auto-written long ad rendered — see Videos tab.',
          'success',
        )
        window.dispatchEvent(new CustomEvent(REFRESH_CAMPAIGNS_EVENT))
        window.dispatchEvent(new CustomEvent(SHOW_VIDEOS_EVENT))
      } catch (err) {
        const msg = err?.message ? String(err.message) : 'unknown error'
        announce?.(
          `Long Ad render failed (script was ${writtenScript.length} ` +
            `chars): ${msg}`,
          'error',
        )
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
