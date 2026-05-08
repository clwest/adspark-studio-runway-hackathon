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
}
