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
  // PR EM-e — memory-aware tools
  RECALL_RECENT_CONVERSATIONS: 'recall_recent_conversations',
  ATTACH_MEMORY_TO_CAMPAIGN: 'attach_memory_to_campaign',
  // PR EM-g — character-to-character handoff
  HANDOFF_TO_CHARACTER: 'handoff_to_character',
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
// PR EM-g — handoff payload: { character_id, campaign_id, target_name }
// Workspace listens + navigates to /spokespeople/{id}?tab=conversations&campaign={id}&autostart=1
export const HANDOFF_EVENT = 'character-os:handoff'

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

    case REALTIME_TOOL_NAMES.HANDOFF_TO_CHARACTER: {
      // PR EM-g — operator asks for a different spokesperson, or
      // current avatar decides the question is better-suited to
      // another persona. Resolve the requested name to a character,
      // pick their most recent campaign, and fire a navigation
      // event the workspace catches.
      //
      // Pre-conditions are strict: target must exist, have a ready
      // Runway avatar, and own at least one campaign. Every failure
      // mode toasts a specific cause so the operator can fix it
      // (e.g. attach a campaign to that character) and re-try.
      const targetRaw = String((args && args.character_name) || '').trim()
      if (!targetRaw) {
        announce?.(
          'Handoff failed — no character name supplied.',
          'error',
        )
        return
      }

      let charsResp
      try {
        charsResp = await api.listCharacters()
      } catch (e) {
        announce?.(
          `Handoff failed loading characters: ${e?.message || e}`,
          'error',
        )
        return
      }
      const targetLower = targetRaw.toLowerCase()
      const candidates = (charsResp.characters || [])
        .filter((c) => c?.name)
      // Exact-match first, then case-insensitive substring, then id.
      const found =
        candidates.find((c) => c.name.toLowerCase() === targetLower)
        || candidates.find((c) =>
          c.name.toLowerCase().includes(targetLower),
        )
        || candidates.find((c) => c.id === targetRaw)
      if (!found) {
        announce?.(
          `🎤 Handoff failed — couldn\u2019t find a spokesperson matching "${targetRaw}".`,
          'error',
        )
        return
      }
      const currentId = character?.id || campaign?.character_id
      if (found.id === currentId) {
        announce?.(
          `🎤 ${found.name} is already the active spokesperson — no handoff needed.`,
          'info',
        )
        return
      }
      if (found.runway_avatar_status !== 'ready') {
        announce?.(
          `🎤 ${found.name} doesn\u2019t have a ready Runway avatar yet ` +
            `(status: ${found.runway_avatar_status || 'unknown'}).`,
          'error',
        )
        return
      }

      let campsResp
      try {
        campsResp = await api.listCampaigns()
      } catch (e) {
        announce?.(
          `Handoff failed loading campaigns: ${e?.message || e}`,
          'error',
        )
        return
      }
      const targetCamps = (campsResp.campaigns || [])
        .filter((c) => c.character_id === found.id)
        .sort((a, b) =>
          String(b.updated_at || b.created_at || '').localeCompare(
            String(a.updated_at || a.created_at || ''),
          ),
        )
      if (targetCamps.length === 0) {
        announce?.(
          `🎤 ${found.name} has no campaigns yet — can\u2019t hand off without a campaign brief.`,
          'error',
        )
        return
      }
      const targetCampaign = targetCamps[0]

      announce?.(
        `🎤 Handing off to ${found.name} — opening conversation on "${
          targetCampaign.business || targetCampaign.id
        }"…`,
        'info',
      )

      // Fire the navigation event. The workspace's listener resolves
      // the URL + activates the conversations tab + auto-starts the
      // new session.
      window.dispatchEvent(
        new CustomEvent(HANDOFF_EVENT, {
          detail: {
            character_id: found.id,
            campaign_id: targetCampaign.id,
            target_name: found.name,
          },
        }),
      )
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

    case REALTIME_TOOL_NAMES.RECALL_RECENT_CONVERSATIONS: {
      // PR EM-e — operator asks "what have we talked about?". Pull
      // the character's transcript-source memory entries (PR EM-a),
      // optionally filtered by a topic query, and toast up to 5
      // recent matches. The avatar narrates over the toasts — it
      // can't directly receive the entry contents (client_event is
      // fire-and-forget), but the operator can see exactly what was
      // recalled and the avatar's narration lands as truthful
      // because the toasts are visible.
      //
      // PR EM-e2 — fall back to campaign.character_id when the
      // character prop hasn't loaded yet. The realtime session can
      // fire tools before CampaignGallery's async character lookup
      // completes; the campaign always has the character_id, so
      // use that as the source of truth.
      const query = String((args && args.query) || '').trim().toLowerCase()
      const characterId = character?.id || campaign?.character_id
      const characterName = character?.name || 'Avatar'
      if (!characterId) {
        announce?.(
          'Could not recall — no active character bound to this session.',
          'error',
        )
        return
      }
      try {
        const resp = await api.listCharacterMemory(characterId, {
          sourceType: 'transcript',
        })
        let entries = resp.entries || []
        if (query) {
          entries = entries.filter((e) => {
            const hay = `${e.title} ${e.content}`.toLowerCase()
            return hay.includes(query)
          })
        }
        entries = entries.slice(0, 5)
        if (entries.length === 0) {
          announce?.(
            query
              ? `💭 ${characterName} doesn't recall any conversations about "${query}" yet.`
              : `💭 ${characterName} doesn't have any saved conversations to recall yet. ` +
                `Try "save what we talked about" later to start the memory loop.`,
            'info',
          )
          return
        }
        announce?.(
          `💭 ${characterName} recalls ${entries.length} ` +
            `conversation${entries.length === 1 ? '' : 's'}` +
            (query ? ` about "${query}"` : '') +
            `:`,
          'info',
        )
        // One toast per recalled entry so the operator can read the
        // summary. Slight stagger so the toast surface doesn't
        // collapse the entries into a single block.
        for (let i = 0; i < entries.length; i++) {
          const e = entries[i]
          const preview = e.content.length > 200
            ? e.content.slice(0, 200) + '…'
            : e.content
          setTimeout(
            () =>
              announce?.(
                `  • ${preview}`,
                'info',
              ),
            (i + 1) * 200,
          )
        }
      } catch (err) {
        const msg = err?.message ? String(err.message) : 'unknown error'
        announce?.(`Recall failed: ${msg}`, 'error')
      }
      return
    }

    case REALTIME_TOOL_NAMES.ATTACH_MEMORY_TO_CAMPAIGN: {
      // PR EM-e — operator says "save what we talked about". The
      // handler chains compose → publish → attach in one stretch.
      // Each stage toasts so the operator follows the wait; on
      // success the active campaign now carries the memory document
      // and the NEXT realtime session on this campaign attaches it
      // as RAG via documentIds.
      //
      // PR EM-e2 — fall back to campaign.character_id when the
      // character prop hasn't loaded yet (same race as recall_recent).
      const characterId = character?.id || campaign?.character_id
      const characterName = character?.name || 'Avatar'
      if (!characterId) {
        announce?.(
          'Could not save — no active character bound to this session.',
          'error',
        )
        return
      }
      if (!campaign?.id) {
        announce?.(
          'Could not save — no active campaign to attach memory to.',
          'error',
        )
        return
      }
      // PR EM-i — capture the LIVE conversation before composing.
      // Previously the chain went straight to compose, which only
      // sees memory entries already in the JsonMemoryStore — so the
      // current conversation never landed in the published document.
      // Now we (1) try to fetch the transcript for this campaign's
      // active runway_conversation_id, (2) run ingest synchronously
      // so the new transcript becomes a memory entry, THEN compose.
      // Step 1 is best-effort: Runway may not return mid-session
      // transcripts, in which case we fall through to "save what's
      // already in the store" — strictly no worse than the prior
      // behaviour.
      announce?.(
        `🧠 ${characterName} is capturing this conversation…`,
        'info',
      )
      try {
        await api.fetchRealtimeTranscript(campaign.id, {})
      } catch (err) {
        // 409 (no session) / 404 (conversation not ready) / mid-call
        // 4xx are all OK to swallow — ingest will still run and pick
        // up whatever the store already has. Log to console for
        // diagnostic but don't toast: the operator doesn't need to
        // see a noisy "transcript not ready yet" intermediate state.
        // eslint-disable-next-line no-console
        console.warn(
          '[attach_memory_to_campaign] transcript fetch failed (continuing):',
          err?.message || err,
        )
      }
      try {
        await api.ingestCharacterMemory(characterId, {
          campaignId: campaign.id,
        })
      } catch (err) {
        const msg = err?.message ? String(err.message) : 'unknown error'
        announce?.(`Memory ingest failed: ${msg}`, 'error')
        return
      }
      announce?.(
        `🧠 Composing the updated memory document…`,
        'info',
      )
      let documentId = null
      let bodyChars = 0
      try {
        const composed = await api.composeCharacterMemory(characterId, {
          publish: true,
        })
        if (!composed?.document_id) {
          announce?.(
            `Memory publish returned no document_id: ${composed?.error || 'unknown'}`,
            'error',
          )
          return
        }
        documentId = composed.document_id
        bodyChars = composed.body_chars || 0
        announce?.(
          `✓ Published — ${bodyChars} chars, ${composed.included_count} entries. Attaching to "${campaign.business || campaign.id}"…`,
          'success',
        )
      } catch (err) {
        const msg = err?.message ? String(err.message) : 'unknown error'
        announce?.(`Publish failed: ${msg}`, 'error')
        return
      }
      try {
        const attached = await api.attachCharacterMemory(characterId, {
          campaignId: campaign.id,
          documentId,
        })
        if (attached?.attached) {
          announce?.(
            `📎 Memory attached to "${attached.campaign_business || campaign.id}". ` +
              `Next realtime session on this campaign will use it as RAG.`,
            'success',
          )
        } else {
          announce?.(
            `⚠️ Attach didn\u2019t take. document_id ${documentId} still uploaded; ` +
              `you can attach manually from the Memory tab.`,
            'error',
          )
        }
      } catch (err) {
        const msg = err?.message ? String(err.message) : 'unknown error'
        announce?.(
          `Attach failed: ${msg}. document_id ${documentId} is still uploaded; ` +
            `try again from the Memory tab.`,
          'error',
        )
      }
      return
    }

    default:
      // Unknown tool — ignore. The avatar may try names we haven't
      // wired yet; better to silently no-op than crash the session.
      // eslint-disable-next-line no-console
      console.warn('[realtimeTools] unknown tool:', tool)
  }
}
