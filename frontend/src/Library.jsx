import { useEffect, useState } from 'react'

import { api } from './api'
import {
  loadActiveSpokespersonId,
  saveActiveSpokespersonId,
} from './settings'
import SpokespersonStudio from './components/SpokespersonStudio.jsx'

/**
 * PR CA — Spokesperson Library route ( `/` ).
 *
 * Becomes the app's default homepage. Replaces the v1
 * 4-stage wizard as the first thing users see. Wraps the
 * existing SpokespersonStudio scaffold (PR BE through PR BU)
 * — the studio already owns its own campaigns/characters
 * fetch + the lane render surface, so this wrapper stays
 * small and focused on:
 *
 *   - active-spokesperson state (mirrored to localStorage,
 *     same key the v1 wizard uses, so toggling between `/`
 *     and `/legacy` keeps the active selection in sync).
 *   - a `refresh()` callback the studio fires after
 *     character / campaign mutations (the v1 wizard reads
 *     the same data from its own useEffect — staying out of
 *     each other's way is fine for PR CA; a shared store
 *     lands in a future slice).
 *   - intentionally not wiring `onOpenCampaign`. The v2
 *     "Open in gallery →" affordance shows the disabled
 *     placeholder on `/` since the gallery lives at
 *     `/legacy`. PR CB will introduce the workspace
 *     campaigns tab + replace the legacy click-through.
 *
 * Backend untouched. v1 wizard / gallery / mode banner /
 * footer toggle all unreachable from this route — they live
 * at /legacy.
 */
export default function Library() {
  const [activeCharacterId, setActiveCharacterIdState] = useState(
    loadActiveSpokespersonId(),
  )
  const setActiveCharacterId = (id) => {
    saveActiveSpokespersonId(id)
    setActiveCharacterIdState(id)
  }

  // PR CA — bump key forces SpokespersonStudio to refetch
  // on demand. No-op when the studio is mid-mount; it owns
  // its own loading state and re-runs `refresh()` from its
  // useEffect when remounted.
  const [refreshKey, setRefreshKey] = useState(0)
  const handleCharactersChanged = () => setRefreshKey((k) => k + 1)

  // Pre-warm the campaigns + characters lists on first
  // mount via the same helpers the studio uses, so the
  // studio's own first-paint is fast (it'll hit a warm
  // backend rather than a cold one). Failures are silent —
  // the studio surfaces its own "Couldn't load spokespeople"
  // copy if needed.
  useEffect(() => {
    api.listCampaigns().catch(() => {})
    api.listCharacters().catch(() => {})
  }, [])

  return (
    <main
      data-testid="library-route"
      className="max-w-6xl mx-auto px-4 sm:px-6 py-6 space-y-4"
    >
      <SpokespersonStudio
        key={refreshKey}
        onCharactersChanged={handleCharactersChanged}
        activeCharacterId={activeCharacterId}
        onSetActive={setActiveCharacterId}
        // PR CA — no onOpenCampaign on `/` (no gallery here).
        // Appearances rows render the disabled-placeholder
        // "Open in gallery →" affordance until PR CB lands the
        // workspace Campaigns tab.
        onOpenCampaign={undefined}
      />
    </main>
  )
}
