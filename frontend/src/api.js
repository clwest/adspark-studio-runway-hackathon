async function jsonFetch(path, init = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json', ...(init.headers || {}) },
    ...init,
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`${res.status} ${res.statusText}: ${text}`)
  }
  return res.json()
}

export const api = {
  health: () => jsonFetch('/health'),
  providerStatus: () => jsonFetch('/api/runway/provider-status'),
  organization: () => jsonFetch('/api/runway/organization'),
  generateConcepts: (body) =>
    jsonFetch('/api/concepts', { method: 'POST', body: JSON.stringify(body) }),
  startRunway: (body) =>
    jsonFetch('/api/runway/generate', { method: 'POST', body: JSON.stringify(body) }),
  pollRunway: (taskId) => jsonFetch(`/api/runway/task/${encodeURIComponent(taskId)}`),
  generateReferenceImage: (body) =>
    jsonFetch('/api/runway/image', { method: 'POST', body: JSON.stringify(body) }),
  saveCampaign: (body) =>
    jsonFetch('/api/campaigns', { method: 'POST', body: JSON.stringify(body) }),
  listCampaigns: () => jsonFetch('/api/campaigns'),
  finishCampaign: (campaignId, format = 'landscape') =>
    jsonFetch(
      `/api/campaigns/${encodeURIComponent(campaignId)}/finish?format=${encodeURIComponent(format)}`,
      { method: 'POST' },
    ),
  // PR S — Commercial with Voice. Combines silent visual cut + Avatar
  // Host Clip audio into a voiced MP4 via local ffmpeg. No new Runway
  // calls; preconditions are 409s the UI handles.
  buildCommercialWithVoice: (campaignId) =>
    jsonFetch(
      `/api/campaigns/${encodeURIComponent(campaignId)}/commercial-with-voice`,
      { method: 'POST' },
    ),
  createSpokesperson: (campaignId, body = {}) =>
    jsonFetch(
      `/api/campaigns/${encodeURIComponent(campaignId)}/avatar`,
      { method: 'POST', body: JSON.stringify(body) },
    ),
  presentCampaign: (campaignId, body = {}) =>
    jsonFetch(
      `/api/campaigns/${encodeURIComponent(campaignId)}/host-video`,
      { method: 'POST', body: JSON.stringify(body) },
    ),
  designBrandVoice: (campaignId, body = {}) =>
    jsonFetch(
      `/api/campaigns/${encodeURIComponent(campaignId)}/brand-voice`,
      { method: 'POST', body: JSON.stringify(body) },
    ),
  dubBrandVoice: (campaignId, target_lang) =>
    jsonFetch(
      `/api/campaigns/${encodeURIComponent(campaignId)}/dub`,
      { method: 'POST', body: JSON.stringify({ target_lang }) },
    ),
  startSpokespersonSession: (campaignId) =>
    jsonFetch(
      `/api/campaigns/${encodeURIComponent(campaignId)}/spokesperson-session`,
      { method: 'POST' },
    ),
  endSpokespersonSession: (campaignId, sessionId) =>
    jsonFetch(
      `/api/campaigns/${encodeURIComponent(campaignId)}/spokesperson-session/${encodeURIComponent(sessionId)}`,
      { method: 'DELETE' },
    ),
  deleteCampaign: (campaignId) =>
    jsonFetch(`/api/campaigns/${encodeURIComponent(campaignId)}`, { method: 'DELETE' }),
  // PR R — visual-source flow: upload-image complements the existing
  // /api/runway/image (generate) so the user can choose which path to
  // take.  Uses native fetch since multipart bodies don't go through
  // the JSON wrapper.
  uploadImage: async (file) => {
    const fd = new FormData()
    fd.append('file', file)
    const resp = await fetch('/api/runway/upload-image', {
      method: 'POST',
      body: fd,
    })
    if (!resp.ok) {
      const text = await resp.text().catch(() => '')
      throw new Error(`${resp.status} ${resp.statusText}: ${text}`)
    }
    return resp.json()
  },
  listAvatars: () => jsonFetch('/api/runway/avatars'),
  selectAvatar: (campaignId, body) =>
    jsonFetch(
      `/api/campaigns/${encodeURIComponent(campaignId)}/select-avatar`,
      { method: 'POST', body: JSON.stringify(body) },
    ),
  // PR K — Character Studio
  listCharacters: () => jsonFetch('/api/characters'),
  createCharacter: (body) =>
    jsonFetch('/api/characters', { method: 'POST', body: JSON.stringify(body) }),
  generateCharacterPortrait: (characterId, body = {}) =>
    jsonFetch(
      `/api/characters/${encodeURIComponent(characterId)}/generate-portrait`,
      { method: 'POST', body: JSON.stringify(body) },
    ),
  // PR CX — Knowledge sources. Append a source returns the updated
  // Character so the workspace's local slice stays in sync without
  // re-fetch.
  addCharacterKnowledge: (characterId, body) =>
    jsonFetch(
      `/api/characters/${encodeURIComponent(characterId)}/knowledge`,
      { method: 'POST', body: JSON.stringify(body) },
    ),
  deleteCharacterKnowledge: (characterId, sourceId) =>
    jsonFetch(
      `/api/characters/${encodeURIComponent(characterId)}/knowledge/${encodeURIComponent(sourceId)}`,
      { method: 'DELETE' },
    ),
  createCharacterAvatar: (characterId, body = {}) =>
    jsonFetch(
      `/api/characters/${encodeURIComponent(characterId)}/create-avatar`,
      { method: 'POST', body: JSON.stringify(body) },
    ),
  deleteCharacter: (characterId) =>
    jsonFetch(`/api/characters/${encodeURIComponent(characterId)}`, { method: 'DELETE' }),
  attachCharacter: (campaignId, characterId) =>
    jsonFetch(
      `/api/campaigns/${encodeURIComponent(campaignId)}/attach-character`,
      { method: 'POST', body: JSON.stringify({ character_id: characterId }) },
    ),
  // PR Z — Storyboard Commercial Builder. Plan, generate per shot,
  // stitch, and (optionally) build the voiced storyboard.
  planStoryboard: (campaignId) =>
    jsonFetch(
      `/api/campaigns/${encodeURIComponent(campaignId)}/storyboard/plan`,
      { method: 'POST' },
    ),
  generateStoryboardShot: (campaignId, shotId) =>
    jsonFetch(
      `/api/campaigns/${encodeURIComponent(campaignId)}/storyboard/generate-shot/${encodeURIComponent(shotId)}`,
      { method: 'POST' },
    ),
  stitchStoryboard: (campaignId) =>
    jsonFetch(
      `/api/campaigns/${encodeURIComponent(campaignId)}/storyboard/stitch`,
      { method: 'POST' },
    ),
  buildVoicedStoryboard: (campaignId) =>
    jsonFetch(
      `/api/campaigns/${encodeURIComponent(campaignId)}/storyboard/voiced`,
      { method: 'POST' },
    ),
  // PR AA — Commercial Script. Persists the editable spoken-pitch
  // script on the campaign so host-video / commercial-with-voice
  // auto-host paths speak it verbatim. Pass null/empty to clear.
  saveCommercialScript: (campaignId, script) =>
    jsonFetch(
      `/api/campaigns/${encodeURIComponent(campaignId)}/script`,
      { method: 'POST', body: JSON.stringify({ script }) },
    ),
  // PR DC — Ad Variants. Upsert one variant on a campaign. Pass
  // `id` to update an existing variant in place; omit to create
  // a new one. Returns the updated Campaign.
  upsertAdVariant: (campaignId, body) =>
    jsonFetch(
      `/api/campaigns/${encodeURIComponent(campaignId)}/ad-variant`,
      { method: 'POST', body: JSON.stringify(body) },
    ),
  // PR BQ — Inline brief editor for the v2 lane Step 1. Patches
  // business / product / audience / tone on a saved campaign
  // without touching any of the generated media or firing Runway.
  // Each field is optional; pass null to leave alone, empty string
  // to clear, or a non-empty string to set. Returns the updated
  // Campaign.
  updateCampaignBrief: (campaignId, body) =>
    jsonFetch(
      `/api/campaigns/${encodeURIComponent(campaignId)}/brief`,
      { method: 'POST', body: JSON.stringify(body || {}) },
    ),
  // PR BU — Persist a freshly-generated cinematic video onto a
  // saved campaign. Called by the v2 CinematicLane after PR BT's
  // image_to_video polling resolves SUCCEEDED with an output URL.
  // Backend downloads the URL via VideoCache.fetch, then flips
  // cached_video_url + cache_status to "ok". 502 surfaces if the
  // download fails (mock mode + a fake URL is the common cause —
  // smoke avoids this path by never clicking the button).
  persistCinematicVideo: (campaignId, videoUrl) =>
    jsonFetch(
      `/api/campaigns/${encodeURIComponent(campaignId)}/cinematic-video`,
      { method: 'POST', body: JSON.stringify({ video_url: videoUrl }) },
    ),
  // PR AB — Spokesperson Ad alias. Same artefact + persisted fields
  // as presentCampaign / host-video; the alias exists so the API
  // vocabulary matches the user-facing "talking spokesperson ad"
  // wording. No new files are written.
  // PR EM-b — Cross-session memory routes. The memory layer
  // accumulates entries from every registered source (operator
  // knowledge notes, past realtime transcript summaries, future
  // external feeds) and composes them into a Runway document body
  // the realtime session attaches as RAG.
  listCharacterMemory: (characterId, { campaignId, sourceType } = {}) => {
    const params = new URLSearchParams()
    if (campaignId) params.set('campaign_id', campaignId)
    if (sourceType) params.set('source_type', sourceType)
    const qs = params.toString()
    return jsonFetch(
      `/api/characters/${encodeURIComponent(characterId)}/memory${qs ? '?' + qs : ''}`,
    )
  },
  ingestCharacterMemory: (characterId, { campaignId } = {}) =>
    jsonFetch(
      `/api/characters/${encodeURIComponent(characterId)}/memory/ingest`,
      {
        method: 'POST',
        body: JSON.stringify({ campaign_id: campaignId || null }),
      },
    ),
  deleteCharacterMemoryEntry: (characterId, entryId) =>
    jsonFetch(
      `/api/characters/${encodeURIComponent(characterId)}/memory/${encodeURIComponent(entryId)}`,
      { method: 'DELETE' },
    ),
  composeCharacterMemory: (characterId, { campaignId, publish = false } = {}) =>
    jsonFetch(
      `/api/characters/${encodeURIComponent(characterId)}/memory/compose`,
      {
        method: 'POST',
        body: JSON.stringify({
          campaign_id: campaignId || null,
          publish,
        }),
      },
    ),
  attachCharacterMemory: (characterId, { campaignId, documentId }) =>
    jsonFetch(
      `/api/characters/${encodeURIComponent(characterId)}/memory/attach`,
      {
        method: 'POST',
        body: JSON.stringify({
          campaign_id: campaignId,
          document_id: documentId,
        }),
      },
    ),
  // PR EJ — LLM-driven ad script auto-write. Reads the campaign
  // brief server-side + asks the configured LLM (Ollama or OpenAI
  // per backend settings) to spit out a spoken script. `mode` is
  // 'short' (200-260 chars, fits one avatar_videos line) or 'long'
  // (1000-1400 chars, fed into the long-ad chunker). Pure read —
  // the route doesn't persist; the caller decides whether to save
  // via the existing /ad-variant route.
  autoWriteAdScript: (campaignId, { mode = 'short', spin } = {}) =>
    jsonFetch(
      `/api/campaigns/${encodeURIComponent(campaignId)}/auto-write-script`,
      {
        method: 'POST',
        body: JSON.stringify({ mode, spin: spin || null }),
      },
    ),
  generateSpokespersonAd: (campaignId, body = {}) =>
    jsonFetch(
      `/api/campaigns/${encodeURIComponent(campaignId)}/spokesperson-ad`,
      { method: 'POST', body: JSON.stringify(body) },
    ),
  // PR EF — DaVinci Resolve template-driven polish. Takes the
  // campaign's existing Spokesperson Ad MP4 and routes it through
  // the operator's Resolve template (color grade + transitions +
  // optional Fusion titles), returning a new OutputRecord of kind
  // `spokesperson_ad_resolve`. Local-only — 503 when Resolve isn't
  // running on the same machine as the backend.
  renderViaResolve: (campaignId) =>
    jsonFetch(
      `/api/campaigns/${encodeURIComponent(campaignId)}/resolve-render`,
      { method: 'POST', body: JSON.stringify({}) },
    ),
  // PR AC — editable storyboard shot prompt. Persists the user-edited
  // prompt + resets that shot's status so the next Generate Shot call
  // uses the new text. Invalidates the stitched / voiced storyboard
  // outputs server-side.
  saveStoryboardShotPrompt: (campaignId, shotId, prompt) =>
    jsonFetch(
      `/api/campaigns/${encodeURIComponent(campaignId)}/storyboard/shot/${encodeURIComponent(shotId)}/prompt`,
      { method: 'POST', body: JSON.stringify({ prompt }) },
    ),
  // PR AF — Multi-Character Dialogue Scene Builder. Plan a 3-line
  // scene, edit each line's text/character, render each line via
  // avatar_videos, stitch into one MP4. Mirrors the storyboard
  // helper shape.
  // PR DM — optional `mode` param. Default "reset" preserves the
  // pre-PR-DM behaviour (overwrites existing dialogue_lines).
  // "extend" tops up to the backend default count without
  // disturbing existing lines / their rendered MP4s.
  planDialogue: (campaignId, mode = 'reset') =>
    jsonFetch(
      `/api/campaigns/${encodeURIComponent(campaignId)}/dialogue/plan`,
      {
        method: 'POST',
        body: JSON.stringify({ mode }),
      },
    ),
  saveDialogueLine: (campaignId, lineId, body = {}) =>
    jsonFetch(
      `/api/campaigns/${encodeURIComponent(campaignId)}/dialogue/line/${encodeURIComponent(lineId)}`,
      { method: 'POST', body: JSON.stringify(body) },
    ),
  generateDialogueLine: (campaignId, lineId) =>
    jsonFetch(
      `/api/campaigns/${encodeURIComponent(campaignId)}/dialogue/generate-line/${encodeURIComponent(lineId)}`,
      { method: 'POST' },
    ),
  // PR DO — Long Spokesperson Ad. POSTs the multi-chunk render
  // pipeline. Body: { script (1-1500 chars), variant_id? }. Returns
  // the updated Campaign with one new OutputRecord
  // (kind=long_spokesperson_ad). One avatar_videos task per chunk
  // — typically 3-6 chunks for a 30-60s ad.
  generateLongSpokespersonAd: (campaignId, body) =>
    jsonFetch(
      `/api/campaigns/${encodeURIComponent(campaignId)}/long-spokesperson-ad`,
      { method: 'POST', body: JSON.stringify(body) },
    ),
  stitchDialogue: (campaignId) =>
    jsonFetch(
      `/api/campaigns/${encodeURIComponent(campaignId)}/dialogue/stitch`,
      { method: 'POST' },
    ),
  // PR AG — Vertical / Reels export. Letterbox the Spokesperson Ad
  // and Dialogue Scene MP4s into 720x1280 via local ffmpeg. No new
  // Runway calls; preconditions surface as 409s the UI handles.
  buildSpokespersonReels: (campaignId) =>
    jsonFetch(
      `/api/campaigns/${encodeURIComponent(campaignId)}/spokesperson-ad/reels`,
      { method: 'POST' },
    ),
  buildDialogueSceneReels: (campaignId) =>
    jsonFetch(
      `/api/campaigns/${encodeURIComponent(campaignId)}/dialogue-scene/reels`,
      { method: 'POST' },
    ),
  // PR AI — Avatar documentIds for grounded realtime. Generates a
  // Markdown brand brief from the saved campaign + character +
  // commercial_script, POSTs it to /v1/documents (or returns a mock
  // id), and persists the document id on the campaign so the
  // realtime broker can pass documentIds=[id] on session create.
  attachRealtimeDocument: (campaignId) =>
    jsonFetch(
      `/api/campaigns/${encodeURIComponent(campaignId)}/realtime-document`,
      { method: 'POST' },
    ),
  // PR AJ — Conversation Transcript Retrieval. After a realtime
  // session, fetch the recorded transcript via Runway's
  // GET /v1/avatar_conversations/{id} (the session id doubles as
  // the conversation id). Mock mode returns a deterministic
  // 3-turn replay derived from the saved campaign brief so the
  // replay UX demos without keys.
  fetchRealtimeTranscript: (campaignId, body) =>
    jsonFetch(
      `/api/campaigns/${encodeURIComponent(campaignId)}/realtime-transcript`,
      {
        method: 'POST',
        body: JSON.stringify(body || {}),
      },
    ),
  // PR AK — Brand colour for reels-export styling. Pass an empty
  // string (or null) to clear and revert to the default backdrop.
  setBrandColor: (campaignId, color) =>
    jsonFetch(
      `/api/campaigns/${encodeURIComponent(campaignId)}/brand-color`,
      { method: 'POST', body: JSON.stringify({ color }) },
    ),
  // PR AN — Custom voice cloning foundation. Multipart upload of a
  // 10 s – 5 min audio sample to /api/characters/{id}/clone-voice;
  // the backend POSTs Runway /v1/voices with from.type=audio (or
  // mocks deterministically). Optional ``name`` overrides the
  // default "Character OS — <character>" voice label.
  cloneCharacterVoice: async (characterId, file, name) => {
    const fd = new FormData()
    fd.append('audio', file)
    if (name && name.trim()) fd.append('name', name.trim())
    const resp = await fetch(
      `/api/characters/${encodeURIComponent(characterId)}/clone-voice`,
      { method: 'POST', body: fd },
    )
    if (!resp.ok) {
      const text = await resp.text().catch(() => '')
      throw new Error(`${resp.status} ${resp.statusText}: ${text}`)
    }
    return resp.json()
  },
  // PR AQ — manual retry for the avatar voice swap. The clone route
  // already auto-PATCHes the avatar after a successful clone; this
  // endpoint lets the operator retry without re-uploading. PR BB
  // accepts an optional ``mode`` argument ("apply" | "repair") so
  // the audit-trail entry can distinguish the PR AU "Repair voice
  // drift" click from a normal apply retry; the backend treats both
  // identically and only labels the history entry differently.
  applyCharacterVoiceToAvatar: (characterId, mode) =>
    jsonFetch(
      `/api/characters/${encodeURIComponent(characterId)}/apply-voice`,
      {
        method: 'POST',
        body: JSON.stringify(mode ? { mode } : {}),
      },
    ),
  // PR AV — read-only refresh: re-runs the avatar introspection +
  // drift recompute against the existing Runway avatar without
  // calling PATCH. Useful after a queued upstream change or to
  // confirm a previously-failed verify has cleared.
  refreshCharacterAvatarVoice: (characterId) =>
    jsonFetch(
      `/api/characters/${encodeURIComponent(characterId)}/refresh-avatar-voice`,
      { method: 'POST' },
    ),
  // PR AX — re-fetch the cloned voice's previewUrl from Runway
  // without re-cloning. Reuses the existing fetch_voice_preview
  // helper. Mock mode short-circuits to no URL; existing URL is
  // preserved if the new fetch returns nothing.
  refreshCharacterVoicePreview: (characterId) =>
    jsonFetch(
      `/api/characters/${encodeURIComponent(characterId)}/refresh-voice-preview`,
      { method: 'POST' },
    ),
  // PR CK — merge a metadata patch onto an existing Character.
  // Used by the v2 multi-step Create Spokesperson flow to persist
  // audience_vibe / creation_flow / visual_style_chips /
  // speaking_energy into the existing Character.metadata dict
  // without per-field schema columns. `patch` is a dict; nulls
  // delete a key, missing keys leave existing values alone.
  patchCharacterMetadata: (characterId, patch) =>
    jsonFetch(
      `/api/characters/${encodeURIComponent(characterId)}/metadata`,
      { method: 'POST', body: JSON.stringify({ metadata: patch || {} }) },
    ),
}
