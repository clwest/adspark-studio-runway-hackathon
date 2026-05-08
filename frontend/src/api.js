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
  generateConcepts: (body) =>
    jsonFetch('/api/concepts', { method: 'POST', body: JSON.stringify(body) }),
  startRunway: (body) =>
    jsonFetch('/api/runway/generate', { method: 'POST', body: JSON.stringify(body) }),
  pollRunway: (taskId) => jsonFetch(`/api/runway/task/${encodeURIComponent(taskId)}`),
  saveCampaign: (body) =>
    jsonFetch('/api/campaigns', { method: 'POST', body: JSON.stringify(body) }),
  listCampaigns: () => jsonFetch('/api/campaigns'),
  finishCampaign: (campaignId) =>
    jsonFetch(`/api/campaigns/${encodeURIComponent(campaignId)}/finish`, {
      method: 'POST',
    }),
}
