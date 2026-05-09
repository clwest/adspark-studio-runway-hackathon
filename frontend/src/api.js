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
  // PR AB — Spokesperson Ad alias. Same artefact + persisted fields
  // as presentCampaign / host-video; the alias exists so the API
  // vocabulary matches the user-facing "talking spokesperson ad"
  // wording. No new files are written.
  generateSpokespersonAd: (campaignId, body = {}) =>
    jsonFetch(
      `/api/campaigns/${encodeURIComponent(campaignId)}/spokesperson-ad`,
      { method: 'POST', body: JSON.stringify(body) },
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
}
