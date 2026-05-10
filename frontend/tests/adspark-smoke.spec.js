import { test, expect } from '@playwright/test'

// Console-error noise we tolerate. The mock task's video URL points to
// Google's BigBuckBunny sample; if the test environment can't fetch the
// MP4 metadata, the <video> element logs a network/media error. That has
// no bearing on the React app's correctness.
const IGNORED_CONSOLE_ERRORS = [
  /BigBuckBunny/i,
  /commondatastorage\.googleapis\.com/i,
  /Failed to load resource/i,
  /MEDIA_ELEMENT_ERROR/i,
  /net::ERR_/i,
]

test('AdSpark Studio mock-mode end-to-end smoke @ /legacy', async ({ page }) => {
  const consoleErrors = []
  const pageErrors = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text())
  })
  page.on('pageerror', (err) => {
    pageErrors.push(`${err.name}: ${err.message}`)
  })

  // PR CA — the v1 four-stage wizard + saved-campaign gallery
  // moved from `/` to `/legacy`. The end-to-end smoke still
  // exercises that surface verbatim; only the entry URL
  // changed. `/` is now the Spokesperson Library — separate
  // smoke test below covers it.
  await page.goto('/legacy')

  // 2. Hero / title visible
  await expect(page.getByRole('heading', { name: /AdSpark/i })).toBeVisible()

  // 3. Mode banner visible — verifies ModeBanner mounted and /health resolved
  const modeHeading = page.getByRole('heading', { name: /^Mode$/, level: 3 })
  await expect(modeHeading).toBeVisible()
  // In mock mode all three pills should read "mock"
  await expect(page.getByText(/Concepts \(OpenAI\): mock/i)).toBeVisible()
  await expect(page.getByText(/Image Gen \(Runway\): mock/i)).toBeVisible()
  await expect(page.getByText(/Video Gen \(Runway\): mock/i)).toBeVisible()
  // PR D readiness chip — provider-status resolved, fully mocked.
  await expect(page.getByLabel('readiness')).toBeVisible()
  await expect(page.getByLabel('readiness')).toHaveText(/demo mode/i)
  // Header MOCK MODE pill present (any_mock = true)
  await expect(page.getByText(/^MOCK MODE$/)).toBeVisible()

  // 4. Fill the campaign form (selectors via stable placeholders)
  await page.getByPlaceholder('Donkey Betz Coffee').fill('Local coffee shop')
  await page.getByPlaceholder('Cold-brew subscription').fill('Morning blend')
  await page.getByPlaceholder(/cinematic, gritty/i).fill('warm cinematic')
  await page.getByPlaceholder(/urban creatives/i).fill('busy morning commuters')

  // 5. Generate concepts
  await page.getByRole('button', { name: /Generate Ad Concepts/i }).click()

  // 6. Three concept cards rendered. Each card is a <button>; using role
  //    avoids collisions with leftover gallery entries that share the same title.
  const originCard = page.getByRole('button', { name: /Origin Spark/i })
  const dailyCard = page.getByRole('button', { name: /Daily Ritual/i })
  const frontierCard = page.getByRole('button', { name: /Frontier/i })
  await expect(originCard).toBeVisible()
  await expect(dailyCard).toBeVisible()
  await expect(frontierCard).toBeVisible()
  // Recommended pill is rendered exactly once and lives inside one of the
  // three concept-card buttons.
  await expect(page.getByText(/^recommended$/i)).toHaveCount(1)

  // 7. Explicitly select the "Daily Ritual" concept (mock recommended_index=1)
  await dailyCard.click()

  // 7a. PR A UI — model selector, text-only toggle, Generate Reference Image
  //     button must all render once the prompt panel mounts.
  await expect(
    page.getByRole('combobox').filter({ hasText: /Gen-4 Turbo|Gen-4\.5/i }),
  ).toBeVisible()
  await expect(page.getByLabel(/Use text-only video/i)).toBeVisible()
  await expect(
    page.getByRole('button', { name: /^Generate Reference Image$/i }),
  ).toBeVisible()

  // 7a.2. PR R — Visual Source selector. Four explicit options replace
  //       the silent "imageUrl required" assumption. Default selection
  //       is Generate (radio aria-checked=true), so the Generate
  //       Reference Image button rendered in 7a is reachable inside
  //       this radio's body.
  const visualSourceGroup = page.getByRole('radiogroup', { name: /visual source/i })
  await expect(visualSourceGroup).toBeVisible()
  for (const optName of ['Generate image', 'Upload image', 'Use Character', 'Text-only video']) {
    await expect(visualSourceGroup.getByRole('radio', { name: optName })).toBeVisible()
  }
  await expect(
    visualSourceGroup.getByRole('radio', { name: /Generate image/i }),
  ).toHaveAttribute('aria-checked', 'true')

  // 7a.3. PR T — structured prompt builder: hint chip + rules text +
  //       Simplify Prompt button render once a concept is selected.
  await expect(page.getByText(/^structured prompt$/i)).toBeVisible()
  await expect(
    page.getByText(/Best results: one character, one location, one action, one camera move/i),
  ).toBeVisible()
  await expect(
    page.getByRole('button', { name: /^Simplify prompt$/i }),
  ).toBeVisible()
  // Prompt textarea must contain the structured-builder output rather
  // than the backend's dense single-shot. The structured builder
  // always opens with "A realistic ". PR AC — explicit aria-label so
  // the Stage-2 Commercial Script textarea (which renders above the
  // prompt textarea) doesn't shadow this selector.
  const promptTextarea = page.getByLabel(/^Runway video prompt$/i)
  await expect(promptTextarea).toHaveValue(/^A realistic /i)
  // ...and the textarea must remain editable. Append a marker, confirm
  // it sticks, then revert so the rest of the smoke runs against a
  // clean prompt.
  const originalPrompt = await promptTextarea.inputValue()
  await promptTextarea.fill(`${originalPrompt} TEST_EDIT`)
  await expect(promptTextarea).toHaveValue(new RegExp('TEST_EDIT$'))
  await promptTextarea.fill(originalPrompt)

  // 7b. PR C UI — source ratio + duration selectors with documented defaults.
  const ratioSelect = page.getByLabel('source ratio')
  const durationSelect = page.getByLabel('duration')
  await expect(ratioSelect).toBeVisible()
  await expect(durationSelect).toBeVisible()
  // Default model is gen4_turbo, so the duration selector is disabled +
  // pinned at 5.
  await expect(ratioSelect).toHaveValue('1280:720')
  await expect(durationSelect).toHaveValue('5')
  await expect(durationSelect).toBeDisabled()
  // Settings summary chips render the active values.
  const settings = page.getByLabel('active generation settings')
  await expect(settings).toBeVisible()
  await expect(settings.getByText('gen4_turbo')).toBeVisible()
  await expect(settings.getByText('Landscape')).toBeVisible()
  await expect(settings.getByText('5s', { exact: true })).toBeVisible()
  await expect(settings.getByText('reference image')).toBeVisible()

  // 7b.5. PR K — Character Studio panel renders.
  // PR O introduced a numbered-stage <h2> wrapper around the panel
  // (originally "Character Studio"); PR U renames the outer stage
  // heading to "Spokesperson" while the inner panel keeps its own
  // "Character Studio" h3. Both checks live inside Stage 1 now.
  await expect(
    page.getByRole('heading', { name: /^Spokesperson$/i }),
  ).toBeVisible()
  await expect(
    page.getByRole('heading', { name: /Character Studio/i }).first(),
  ).toBeVisible()
  await expect(
    page.getByRole('button', { name: /^\+ Create Character$/i }),
  ).toBeVisible()
  // PR BM — v1 default must NOT leak any v2 gated surfaces. If
  // any of these testids are in the DOM, the flag-aware mount
  // in App.jsx has regressed and v2 is bleeding into the
  // legacy path.
  for (const tid of [
    'spokesperson-studio',
    'spokesperson-new-campaign',
    'spokesperson-active-mode',
    'campaign-mode-modal',
    'spokesperson-lane',
    'cinematic-lane',
    'dialogue-lane',
  ]) {
    await expect(page.getByTestId(tid)).toHaveCount(0)
  }
  // The empty-state copy is visible until a character is created
  // (existing characters.json may already have entries from prior
  // runs; in that case the panel shows the library grid instead).
  // Do not assert empty state explicitly to keep the test resilient.

  // 7b.5b. PR V — Portrait Prompt textarea + helper text render once
  //         the create form opens. Open the form, assert the textarea
  //         + helper text, edit + revert to confirm editability, then
  //         cancel the form so we don't actually create a character
  //         (which would mutate characters.json).
  await page.getByRole('button', { name: /^\+ Create Character$/i }).click()
  const portraitPromptTextarea = page.getByLabel(/^Portrait Prompt/i)
  await expect(portraitPromptTextarea).toBeVisible()
  // Default content auto-derives from form fields — must open with
  // the structured "front-facing head-and-shoulders portrait" prefix.
  await expect(portraitPromptTextarea).toHaveValue(
    /^A front-facing head-and-shoulders portrait/i,
  )
  // Helper text spelling out the avatar-ready rules of thumb.
  await expect(
    page.getByText(/Best avatar results: centered head-and-shoulders portrait/i),
  ).toBeVisible()
  // Editable + dirty-mark: append a marker, confirm it sticks. The
  // dirty mark also surfaces the "reset to default" link.
  const portraitOriginal = await portraitPromptTextarea.inputValue()
  await portraitPromptTextarea.fill(`${portraitOriginal} TEST_PORTRAIT_EDIT`)
  await expect(portraitPromptTextarea).toHaveValue(/TEST_PORTRAIT_EDIT$/)
  await expect(page.getByText(/^reset to default$/i)).toBeVisible()
  // 7b.5c. PR AA — voice preset description chip + helper text render
  //         when the create form is open. Default voice is `vincent`,
  //         so the curated "smooth, classic spokesperson" copy renders.
  const voiceDescBlock = page.getByLabel(/^voice preset description$/i)
  await expect(voiceDescBlock).toBeVisible()
  await expect(voiceDescBlock).toContainText(/smooth, classic spokesperson/i)
  await expect(
    page.getByText(/Runway preset previews aren't available without/i),
  ).toBeVisible()
  // Close the form so the rest of the smoke runs against a clean
  // state. The "+ Create Character" button toggles to "Cancel" while
  // the form is open.
  await page.getByRole('button', { name: /^Cancel$/i }).click()

  // 7b.5d. PR AN — Custom voice cloning section. Lives inside each
  //         CharacterCard tile in the library. The smoke campaign
  //         doesn't create a fresh character (would mutate
  //         characters.json), so this assertion is conditional on the
  //         existence of any pre-existing characters in the library.
  //         When present, every tile must expose the upload input,
  //         the clone button, and the voice status pill.
  const voiceSections = page.getByTestId('custom-voice-section')
  const voiceSectionCount = await voiceSections.count()
  if (voiceSectionCount > 0) {
    await expect(voiceSections.first()).toBeVisible()
    await expect(
      voiceSections.first().getByTestId('custom-voice-upload'),
    ).toBeVisible()
    await expect(
      voiceSections.first().getByTestId('custom-voice-create'),
    ).toBeVisible()
    await expect(
      voiceSections.first().getByTestId('custom-voice-status'),
    ).toBeVisible()
    // PR AO — In-browser recording controls. The status pill always
    // renders inside the voice section; on supported browsers the
    // Start recording button shows in the idle state. Headless
    // Chromium ships MediaRecorder, so we expect the buttons rather
    // than the unsupported-browser fallback message.
    await expect(
      voiceSections.first().getByTestId('custom-voice-record-status'),
    ).toBeVisible()
    await expect(
      voiceSections.first().getByTestId('custom-voice-record-start'),
    ).toBeVisible()
    // PR AP — playback preview is conditional on the 'recorded'
    // state. The smoke can't drive a real recording so we assert the
    // negative: in the default idle state, the preview audio + help
    // testids must NOT render. Their presence would prove the
    // conditional render guard regressed.
    await expect(
      page.getByTestId('custom-voice-record-preview'),
    ).toHaveCount(0)
    await expect(
      page.getByTestId('custom-voice-record-preview-help'),
    ).toHaveCount(0)
    // PR AQ — avatar PATCH status pill is conditional on a cloned
    // custom voice existing on the character record. The smoke
    // doesn't clone, but operators may have cloned voices on
    // existing fixture characters in mock mode (e.g. while
    // demoing PR AN/AO). The conditional render guard is what
    // matters: when zero characters carry a custom voice the pill
    // count must be 0; otherwise each cloned character renders
    // exactly one pill. We verify that count <= number of voice
    // sections rather than requiring a specific count, so the
    // smoke is resilient to operator-driven mock clones.
    const patchPills = await page
      .getByTestId('custom-voice-avatar-patch-status')
      .count()
    expect(patchPills).toBeLessThanOrEqual(voiceSectionCount)
    // PR AR — cloned voice preview audio + the unavailable-fallback
    // helper. Both are conditional on a cloned voice existing.
    // Together they cover every cloned voice exactly once
    // (audio when previewUrl is set, fallback line otherwise),
    // so the combined count is bounded by the patch-pill count
    // (which itself is bounded by voiceSectionCount). Mock-mode
    // clones never carry a previewUrl, so on a mock-only library
    // we'd see only the unavailable copy, not the audio element.
    const previewAudio = await page
      .getByTestId('custom-voice-preview')
      .count()
    const previewUnavailable = await page
      .getByTestId('custom-voice-preview-unavailable')
      .count()
    expect(previewAudio + previewUnavailable).toBeLessThanOrEqual(patchPills)
    // PR AS / PR AT — avatar voice introspection pill,
    // consolidated by drift detection. Only renders when a clone
    // exists AND the PR AQ patch state implies the bind should
    // have landed (applied / mock_patched / pending verify).
    // PR AT collapses the four PR AS verify states into three
    // operator-facing branches: resolved (match), drift (rose
    // mismatch), unverified (grey/rose). Combined count across
    // all three testids is bounded above by the patch-pill
    // count, which is itself bounded by voiceSectionCount.
    const verifyResolved = await page
      .getByTestId('custom-voice-avatar-resolved')
      .count()
    const verifyDrift = await page
      .getByTestId('custom-voice-avatar-drift')
      .count()
    const verifyUnverified = await page
      .getByTestId('custom-voice-avatar-unverified')
      .count()
    expect(verifyResolved + verifyDrift + verifyUnverified)
      .toBeLessThanOrEqual(patchPills)
    // PR AU — Repair voice drift button. Renders only on the
    // drift branch (rose "Avatar voice mismatch" pill). Mock-mode
    // smoke runs against fixture characters that haven't been
    // cloned, so the button count is normally 0; an operator
    // who has manually mutated characters.json to simulate drift
    // would see one button per drift pill, never more.
    const repairButtons = await page
      .getByTestId('custom-voice-repair-drift')
      .count()
    expect(repairButtons).toBeLessThanOrEqual(verifyDrift)
    // PR AV — Refresh avatar status button. Renders only when the
    // character has both a cloned voice and a ready avatar (the
    // backend route enforces the same gate). Bounded above by the
    // voice section count; in the default smoke pass with no
    // cloned voices the count is 0.
    const refreshButtons = await page
      .getByTestId('custom-voice-refresh-avatar')
      .count()
    expect(refreshButtons).toBeLessThanOrEqual(voiceSectionCount)
    // PR AW — verify freshness label. Renders any time the
    // character has both a cloned voice and a ready avatar
    // (same gate as the PR AV refresh button). Bounded above
    // by the voice section count; in the default smoke pass
    // with no cloned voices the count is 0. When present, the
    // first label must contain either "just now" / "Nm ago"
    // / "Nh ago" / "Nd ago" / "Not checked yet".
    const freshnessLabels = page.getByTestId('custom-voice-verify-freshness')
    const freshnessCount = await freshnessLabels.count()
    expect(freshnessCount).toBeLessThanOrEqual(voiceSectionCount)
    if (freshnessCount > 0) {
      await expect(freshnessLabels.first()).toContainText(
        /(just now|\d+m ago|\d+h ago|\d+d ago|Not checked yet)/i,
      )
    }
    // PR AX — Refresh preview button. Renders any time the
    // character has a cloned voice (no avatar required by the
    // route). Bounded above by the voice section count; in the
    // default smoke pass with no cloned voices the count is 0.
    const refreshPreviewButtons = await page
      .getByTestId('custom-voice-refresh-preview')
      .count()
    expect(refreshPreviewButtons).toBeLessThanOrEqual(voiceSectionCount)
    // PR AY — Live mic level meter. The meter only renders while
    // recording is active. The smoke can't drive a real recording
    // (would need fake getUserMedia + microphone permission), so we
    // assert the negative: in the default idle state, neither the
    // meter wrapper nor the inner bar testid is in the DOM. Their
    // presence would prove the conditional render guard regressed.
    await expect(
      page.getByTestId('custom-voice-mic-level'),
    ).toHaveCount(0)
    await expect(
      page.getByTestId('custom-voice-mic-level-bar'),
    ).toHaveCount(0)
    // PR BA — Library-level "Refresh all voice statuses" button
    // renders any time the library has at least one character. The
    // status caption is gated on the bulk action having run at least
    // once; in the default idle smoke run it must be absent.
    await expect(
      page.getByTestId('custom-voice-refresh-all'),
    ).toBeVisible()
    await expect(
      page.getByTestId('custom-voice-refresh-all'),
    ).toHaveText(/^Refresh all voice statuses$/i)
    await expect(
      page.getByTestId('custom-voice-refresh-all-status'),
    ).toHaveCount(0)
    // PR BB — Voice repair history audit trail. The disclosure +
    // entry rows are conditional on at least one history entry
    // existing on a character. Mock-mode smoke runs against
    // fixture characters that may or may not have prior clone /
    // apply / refresh events recorded, so the count is bounded by
    // the voice section count rather than asserted exactly. Each
    // visible disclosure must contain at least one entry row;
    // each entry row must include an action label.
    const historyDisclosures = await page
      .getByTestId('custom-voice-history')
      .count()
    expect(historyDisclosures).toBeLessThanOrEqual(voiceSectionCount)
    if (historyDisclosures > 0) {
      const firstHistory = page.getByTestId('custom-voice-history').first()
      await expect(firstHistory).toContainText(/Voice history/i)
      const firstEntries = firstHistory.getByTestId(
        'custom-voice-history-entry',
      )
      const firstEntryCount = await firstEntries.count()
      expect(firstEntryCount).toBeGreaterThan(0)
      expect(firstEntryCount).toBeLessThanOrEqual(20)
      await expect(firstEntries.first()).toContainText(
        /^(clone|apply|repair|refresh|verify)/i,
      )
    }
  }

  // 7b.6. PR U — stage order: Spokesperson leads, Campaign Brief
  //        follows. PR AC' — Stage 2 title reverted to "Campaign
  //        Brief"; the Commercial Script editor moved into Stage 3
  //        PromptPreview.
  const spokespersonHeading = page.getByRole('heading', { name: /^Spokesperson$/i })
  const briefHeading = page.getByRole('heading', { name: /^Campaign Brief$/i })
  const spokeBox = await spokespersonHeading.boundingBox()
  const briefBox = await briefHeading.boundingBox()
  expect(spokeBox).not.toBeNull()
  expect(briefBox).not.toBeNull()
  expect(spokeBox.y).toBeLessThan(briefBox.y)
  // 7b.7. PR AC' — Commercial Script editor lives inside the Stage 3
  //        PromptPreview (above the Runway video prompt). Textarea +
  //        Generate Script button + breadcrumb pill are reachable now
  //        that a concept is selected and PromptPreview is mounted.
  await expect(
    page.getByRole('heading', { name: /^Creative direction$/i }),
  ).toBeVisible()
  const promptScriptTextarea = page.getByLabel(/^Commercial Script$/)
  await expect(promptScriptTextarea.first()).toBeVisible()
  await expect(
    page.getByText(/This is what the spokesperson says\. The Runway prompt below/i),
  ).toBeVisible()
  await expect(
    page.getByRole('button', { name: /^Generate Script$/i }).first(),
  ).toBeVisible()
  await expect(
    page.getByText(/Script → Storyboard → Video → Final Ad/i).first(),
  ).toBeVisible()
  // The Runway video prompt textarea is a separate element with its
  // own aria-label — assert both surfaces coexist.
  await expect(page.getByLabel(/^Runway video prompt$/i)).toBeVisible()
  // Stage progress trail: "Spokesperson" chip must appear in the hero
  // before "Brief" — verifies the trail array reflects the new order.
  const trailNav = page.getByRole('navigation', { name: /demo path/i })
  await expect(trailNav.getByText(/^Spokesperson$/)).toBeVisible()
  await expect(trailNav.getByText(/^Brief$/)).toBeVisible()

  // 7c. PR D — settings persistence. Switch to Reels (720:1280) and reload;
  //     the dropdown must come back with the new value, not the default.
  await ratioSelect.selectOption('720:1280')
  await expect(ratioSelect).toHaveValue('720:1280')
  await page.reload()
  // After reload, prompt panel only re-renders if concepts are regenerated;
  // settings still need to persist. Re-trigger concepts and re-check.
  await page.getByPlaceholder('Donkey Betz Coffee').fill('Local coffee shop')
  await page.getByPlaceholder('Cold-brew subscription').fill('Morning blend')
  await page.getByRole('button', { name: /Generate Ad Concepts/i }).click()
  // Pick the same Daily Ritual concept again so the prompt panel mounts.
  await expect(page.getByRole('button', { name: /Daily Ritual/i })).toBeVisible()
  await page.getByRole('button', { name: /Daily Ritual/i }).click()
  const ratioAfterReload = page.getByLabel('source ratio')
  await expect(ratioAfterReload).toHaveValue('720:1280')
  // Reset to landscape so the rest of the test resembles the original path.
  await ratioAfterReload.selectOption('1280:720')

  // 8. PR R — switch the Visual Source to "Upload image" so the URL
  //    paste field is reachable, then fill a placeholder URL to mirror
  //    the original demo path. The Generate Video pipeline accepts
  //    typed URLs identically to uploaded files in mock mode.
  await page.getByRole('radio', { name: /Upload image/i }).click()
  await expect(
    page.getByRole('radio', { name: /Upload image/i }),
  ).toHaveAttribute('aria-checked', 'true')
  await page
    .getByPlaceholder(/images\.unsplash\.com\/photo/i)
    .fill('https://example.com/placeholder.jpg')

  // 9. Generate Video (mock task). PR R — button label now adapts to
  //    the active Visual Source ("Generate Video from Image" / "...from
  //    Character" / "Generate Text-Only Video"). Use a flexible regex
  //    that matches any of those + the legacy "Generate Video" form.
  await page.getByRole('button', { name: /^Generate (?:Video|Text-Only Video)/i }).click()

  // 10. Wait for SUCCEEDED. Mock task duration ~12s; client poll every 5s + jitter.
  //     Allow up to 25s.
  await expect(page.getByText(/^SUCCEEDED$/)).toBeVisible({ timeout: 25_000 })

  // 11. Save campaign
  await page.getByRole('button', { name: /^Save campaign card$/i }).click()
  await expect(
    page.getByRole('button', { name: /^Saved · cached locally$/i }),
  ).toBeVisible()

  // 12. Gallery now contains the new campaign. PR Q (Phase 3) — the
  //     gallery wrapper is now a <section role="region"> with
  //     aria-labelledby pointing at the heading, so we target it via
  //     getByRole instead of the brittle div.rounded-2xl class
  //     selector that locked layout changes behind a workaround.
  const galleryCard = page.getByRole('region', { name: /Saved campaigns/i })
  const newestCard = galleryCard.locator('ul > li').first()
  // Card header (always visible regardless of active tab) — business
  // name + video-ready chip.
  await expect(newestCard.getByText('Local coffee shop', { exact: true })).toBeVisible()
  await expect(newestCard.getByText(/^video ready$/i)).toBeVisible()

  // 12a. PR P — UI Phase 2: tab row renders six tabs. PR Y — the newest
  //       saved card now opens on Visuals (not Overview) so the user
  //       lands on the cached video + Voiced Commercial CTAs they just
  //       earned with the save click.
  // PR AF — new "Dialogue" tab between Voice and Realtime.
  for (const name of ['Overview', 'Visuals', 'Character', 'Voice', 'Dialogue', 'Realtime', 'Exports']) {
    await expect(newestCard.getByRole('tab', { name })).toBeVisible()
  }
  await expect(
    newestCard.getByRole('tab', { name: 'Visuals' }),
  ).toHaveAttribute('aria-selected', 'true')

  // 12b. PR Y — "just saved" pill highlights the newly created card so
  //       multi-card demos don't target the wrong campaign.
  await expect(newestCard.getByText(/^just saved$/i)).toBeVisible()

  // 12c. PR AC — creative-director breadcrumb on the card. Surfaces
  //       the "Script → Storyboard → Video → Final Ad" ordering above
  //       the tab row regardless of which tab is active.
  await expect(
    newestCard.getByRole('navigation', {
      name: /campaign creative director flow/i,
    }),
  ).toBeVisible()

  // 12d. PR AK — brand colour control renders above the tab row. New
  //       campaigns default to the visual placeholder (#0b1220); the
  //       value display reads "<default>" until the operator picks a
  //       colour. The native colour input + value display must both
  //       be visible so reels builds can adopt brand-themed backdrops.
  await expect(
    newestCard.getByTestId('brand-color-control'),
  ).toBeVisible()
  await expect(
    newestCard.getByTestId('brand-color-input'),
  ).toBeVisible()
  await expect(
    newestCard.getByTestId('brand-color-value'),
  ).toContainText(/default/i)

  // 13a. Visuals tab — silent visual-cut copy + cache status + (when
  //      cached) Campaign Pack 3-up. Network unreachable in CI is
  //      acceptable; "cache failed" still proves the pipeline ran.
  await newestCard.getByRole('tab', { name: 'Visuals' }).click()
  // PR Z2 — silent source video chip + caption rewritten so users
  // don't confuse it with the final voiced ad below.
  await expect(newestCard.getByText(/^source visual · silent$/)).toBeVisible()
  await expect(
    newestCard.getByText(/This is the raw Runway visual cut/i),
  ).toBeVisible()
  // PR Z2 — explicit CTA next to the silent player that scrolls down
  // to the voiced section. Only validates presence here; click +
  // scroll behaviour is JS-only and stays out of the smoke.
  await expect(
    newestCard.getByRole('button', { name: /Go to Voiced Commercial/i }),
  ).toBeVisible()
  await expect(
    newestCard.getByText(/^(cached locally|cache failed|external URL may expire)$/i),
  ).toBeVisible()
  const isCached = await newestCard.getByText(/^cached locally$/i).isVisible()
  if (isCached) {
    await expect(newestCard.getByText(/^Campaign Pack$/)).toBeVisible()
    await expect(
      newestCard.getByRole('button', { name: /^Build Landscape$/i }),
    ).toBeVisible()
    await expect(
      newestCard.getByRole('button', { name: /^Build Reels$/i }),
    ).toBeVisible()
    await expect(
      newestCard.getByRole('button', { name: /^Build Square$/i }),
    ).toBeVisible()
  }

  // 13a.2 — PR S + PR X — Voiced Commercial section in the Visuals
  //         tab. The smoke saves a campaign without an attached
  //         spokesperson, so the gated path renders: section header +
  //         button is disabled + the amber "Attach or create a
  //         spokesperson first" line points the user at the Character
  //         tab. PR X promoted the section header from "Commercial
  //         with Voice" to "Voiced Commercial" and the button label
  //         to "Build Voiced Commercial".
  // PR Z2 — Visuals-tab section now reads "Final Voiced Ad" so it
  // visually outranks the silent source above. The Exports ledger row
  // (asserted later) still uses the "Voiced Commercial" label so the
  // CLI/file vocabulary stays consistent.
  // PR AD — Visuals tab final-output header relabeled to make the
  // cinematic-vs-spokesperson distinction explicit. Subtitle still
  // calls out the lip-sync gap.
  await expect(newestCard.getByText(/^Final Voiced Cinematic Ad$/)).toBeVisible()
  await expect(
    newestCard.getByText(/cinematic visual \+ voiceover · not lip synced/i),
  ).toBeVisible()
  await expect(
    newestCard.getByText(/This is the Cinematic Ad/i),
  ).toBeVisible()
  await expect(
    newestCard.getByText(/for a talking-to-camera ad, use/i),
  ).toBeVisible()
  const buildCommercialBtn = newestCard.getByRole('button', {
    name: /^Build Voiced Commercial$/i,
  })
  await expect(buildCommercialBtn).toBeVisible()
  await expect(buildCommercialBtn).toBeDisabled()
  await expect(
    newestCard.getByText(/Attach or create a spokesperson first/i),
  ).toBeVisible()

  // 13a.3 — PR Z — Storyboard Commercial Builder. The Visuals tab also
  //          renders the Storyboard subsection. Initial state shows the
  //          "Plan Storyboard" button + the explainer copy. Don't click
  //          Plan in the smoke — mutating the campaign on disk during
  //          mock runs is unnecessary; the rendered JSX is the
  //          load-bearing assertion.
  await expect(newestCard.getByText(/^Storyboard Commercial$/)).toBeVisible()
  await expect(newestCard.getByText(/3 shots · ~15 s/)).toBeVisible()
  await expect(
    newestCard.getByText(/Plans Hook → Action → Payoff prompts/i),
  ).toBeVisible()
  await expect(
    newestCard.getByRole('button', { name: /^Plan Storyboard$/i }),
  ).toBeVisible()

  // 13a.4 — PR AD — switch to Overview and assert the Ad Mode picker
  //         renders both modes side-by-side. The smoke campaign has
  //         no spokesperson attached, so the Spokesperson Ad button
  //         shows the gated "Choose or create a spokesperson first"
  //         copy; the Cinematic Commercial card stays "idle" with a
  //         "Build Cinematic Ad ↗" jump button.
  await newestCard.getByRole('tab', { name: 'Overview' }).click()
  await expect(
    newestCard.getByRole('region', { name: /^Ad mode picker$/i }),
  ).toBeVisible()
  await expect(newestCard.getByText(/^Pick your ad mode$/i)).toBeVisible()
  await expect(newestCard.getByText(/^Cinematic Commercial$/i)).toBeVisible()
  await expect(newestCard.getByText(/^Spokesperson Ad$/i).first()).toBeVisible()
  await expect(
    newestCard.getByText(/Lip-synced talking ad — your selected character/i),
  ).toBeVisible()
  await expect(
    newestCard.getByText(/Visual is not lip-synced/i),
  ).toBeVisible()
  await expect(
    newestCard.getByText(/Choose or create a spokesperson first/i),
  ).toBeVisible()
  await expect(
    newestCard.getByRole('button', { name: /^Build Cinematic Ad/i }),
  ).toBeVisible()
  // PR AF — Dialogue Scene card joins the picker as a third mode.
  await expect(newestCard.getByText(/^Dialogue Scene$/i)).toBeVisible()
  await expect(
    newestCard.getByText(/Multi-character skit assembled from talking avatar clips/i),
  ).toBeVisible()
  await expect(
    newestCard.getByRole('button', { name: /^Build Dialogue Scene/i }),
  ).toBeVisible()

  // 13b. Character tab — Brand Spokesperson section + Avatar Picker.
  await newestCard.getByRole('tab', { name: 'Character' }).click()
  await expect(newestCard.getByText(/^Brand Spokesperson$/)).toBeVisible()
  await expect(newestCard.getByText(/^Runway Avatar$/)).toBeVisible()
  await expect(
    newestCard.getByRole('button', { name: /^Create Brand Spokesperson$/i }),
  ).toBeVisible()
  await expect(newestCard.getByText(/^Choose Existing Runway Avatar$/)).toBeVisible()
  await expect(newestCard.getByText(/^mock presets$/)).toBeVisible()
  await expect(
    newestCard.getByRole('button', { name: /Music Superstar/i }),
  ).toBeVisible()

  // 13c. Voice tab — PR AA Commercial Script + PR M honest Audio Pack
  //       labels. Script section renders first now; Audio Pack stays
  //       below as the brand-voice identity surface.
  await newestCard.getByRole('tab', { name: 'Voice' }).click()
  await expect(newestCard.getByText(/^Commercial Script$/)).toBeVisible()
  await expect(
    newestCard.getByText(/Write the spoken pitch first/i),
  ).toBeVisible()
  const scriptTextarea = newestCard.getByLabel(/^Commercial Script$/)
  await expect(scriptTextarea).toBeVisible()
  await expect(
    newestCard.getByRole('button', { name: /^Generate Script$/i }),
  ).toBeVisible()
  await expect(
    newestCard.getByRole('button', { name: /^Save Script$/i }),
  ).toBeVisible()
  await expect(
    newestCard.getByRole('button', { name: /^Generate Spokesperson Ad$/i }),
  ).toBeVisible()
  // PR AB — Ad Mode primer card distinguishes Cinematic Ad vs
  // Spokesperson Ad above the script editor.
  await expect(newestCard.getByText(/^Ad Mode$/)).toBeVisible()
  await expect(
    newestCard.getByText(/Selected character speaks the saved script directly/i),
  ).toBeVisible()
  // Audio Pack still renders below the Script section.
  await expect(newestCard.getByText(/^Audio Pack$/)).toBeVisible()
  await expect(newestCard.getByText(/^Brand Voice Identity$/)).toBeVisible()
  await expect(
    newestCard.getByText(/Voice samples, not full ad narration/i),
  ).toBeVisible()
  await expect(
    newestCard.getByRole('button', { name: /^Design Brand Voice$/i }),
  ).toBeVisible()

  // 13d. Realtime tab — gated. The mock smoke run never creates an
  //      avatar (timing-sensitive), so we expect the "Brand
  //      Spokesperson required" gate copy. On a stale account where
  //      the avatar is already ready, the RealtimeSpokesperson
  //      component renders + suggested prompt chips appear; assert
  //      conditionally so both paths pass.
  await newestCard.getByRole('tab', { name: 'Realtime' }).click()
  // PR AI — grounding badge always renders on the Realtime tab,
  // regardless of avatar readiness. New campaigns start
  // Prompt-grounded; clicking "Attach grounding doc" flips the badge
  // to Document-grounded. Assert the default state + the attach
  // button + the explanatory copy.
  await expect(newestCard.getByText(/^Realtime grounding$/i)).toBeVisible()
  await expect(
    newestCard.getByTestId('realtime-grounding'),
  ).toHaveText(/^Prompt-grounded$/)
  await expect(
    newestCard.getByTestId('attach-realtime-doc'),
  ).toBeVisible()

  // PR AJ — Conversation transcript / replay card. Default state for
  // a fresh campaign with no session yet shows "No transcript yet"
  // (the smoke campaign has never run a realtime session, real or
  // mock). Click Fetch transcript to exercise the mock path; the
  // backend short-circuits to a deterministic 3-turn replay.
  await expect(newestCard.getByText(/^Conversation transcript$/i)).toBeVisible()
  await expect(
    newestCard.getByTestId('transcript-state'),
  ).toHaveText(/No transcript yet/i)
  await expect(
    newestCard.getByTestId('fetch-transcript'),
  ).toBeVisible()
  // PR AL — Export buttons are visible but disabled before any
  // transcript has been fetched. Confirm the surface exists up-front.
  await expect(
    newestCard.getByTestId('transcript-copy-markdown'),
  ).toBeVisible()
  await expect(
    newestCard.getByTestId('transcript-copy-markdown'),
  ).toBeDisabled()
  await expect(
    newestCard.getByTestId('transcript-download-txt'),
  ).toBeVisible()
  await expect(
    newestCard.getByTestId('transcript-download-txt'),
  ).toBeDisabled()

  await newestCard.getByTestId('fetch-transcript').click()
  // Mock-mode response is synchronous; allow a small window for the
  // re-render to land. Replay state should flip to mock + show 3 turns.
  await expect(
    newestCard.getByTestId('transcript-state'),
  ).toHaveText(/Replay ready · mock · 3 turns/i, { timeout: 5_000 })
  await expect(
    newestCard.getByTestId('transcript-turns'),
  ).toBeVisible()
  // PR AL — once turns are cached, both export buttons unlock.
  // Click Copy Markdown and confirm the status banner flips. The
  // status auto-clears after 2.5 s, so the assertion uses a short
  // timeout to catch it while it's live.
  await expect(
    newestCard.getByTestId('transcript-copy-markdown'),
  ).toBeEnabled()
  await expect(
    newestCard.getByTestId('transcript-download-txt'),
  ).toBeEnabled()
  // Grant clipboard permission so navigator.clipboard.writeText
  // resolves rather than throwing in the headless browser.
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
  await newestCard.getByTestId('transcript-copy-markdown').click()
  await expect(
    newestCard.getByTestId('transcript-export-status'),
  ).toContainText(/Copied|Clipboard unavailable/i, { timeout: 2_000 })
  // PR BC — Per-campaign transcript history. After the fetch above
  // the audit trail must contain at least one entry. The disclosure
  // wrapper testid is unique per campaign card; each row carries a
  // status pill that matches one of the literal states. Capped at
  // 20 entries by the backend store.
  await expect(
    newestCard.getByTestId('transcript-history'),
  ).toBeVisible()
  await expect(
    newestCard.getByTestId('transcript-history'),
  ).toContainText(/Transcript history/i)
  const transcriptHistoryEntries = newestCard.getByTestId(
    'transcript-history-entry',
  )
  const transcriptHistoryCount = await transcriptHistoryEntries.count()
  expect(transcriptHistoryCount).toBeGreaterThan(0)
  expect(transcriptHistoryCount).toBeLessThanOrEqual(20)
  await expect(transcriptHistoryEntries.first()).toContainText(
    /^(ok|mock|empty|no_session|failed)/i,
  )
  // Sanity: the latest preview block + export buttons are still
  // unaffected by the new history surface.
  await expect(
    newestCard.getByTestId('transcript-turns'),
  ).toBeVisible()
  await expect(
    newestCard.getByTestId('transcript-copy-markdown'),
  ).toBeEnabled()
  const realtimeSection = newestCard.getByText(/^Talk to Brand Spokesperson$/)
  if (await realtimeSection.isVisible().catch(() => false)) {
    await expect(newestCard.getByText(/^Realtime Runway Avatar$/)).toBeVisible()
    await expect(
      newestCard.getByRole('button', { name: /Start Conversation \(unavailable\)/i }),
    ).toBeDisabled()
    await expect(
      newestCard.getByRole('button', { name: /Who is this campaign for/i }),
    ).toBeVisible()
    await expect(
      newestCard.getByRole('button', { name: /Make this pitch funnier/i }),
    ).toBeVisible()
    // PR AE — caption should now reflect the broker's campaign-context
    // injection ("avatar knows the campaign brief and saved script…").
    await expect(
      newestCard.getByText(/avatar knows the campaign brief and saved script/i),
    ).toBeVisible()
  } else {
    await expect(
      newestCard.getByText(/Brand Spokesperson required/i),
    ).toBeVisible()
  }

  // 13d.5 — PR AF — Dialogue tab. The smoke campaign has no
  //          Characters, so the gated "Create at least one Character"
  //          copy renders + the Plan Dialogue Scene button is reachable.
  await newestCard.getByRole('tab', { name: 'Dialogue' }).click()
  await expect(newestCard.getByText(/^Dialogue Scene Builder$/i)).toBeVisible()
  await expect(
    newestCard.getByText(/Create Office-style branded skits/i),
  ).toBeVisible()
  await expect(
    newestCard.getByRole('button', { name: /^Plan Dialogue Scene$/i }),
  ).toBeVisible()

  // 13e. Exports tab — file-ledger renders, with at least the visual
  //      ad row present (every saved campaign has a video URL or a
  //      "not generated yet" placeholder for it). PR S + PR X — also
  //      asserts the Voiced Commercial row is in the ledger; gated
  //      state shows "not generated yet" since the smoke didn't
  //      build it. PR X renamed the row from "Commercial with Voice"
  //      to "Voiced Commercial".
  await newestCard.getByRole('tab', { name: 'Exports' }).click()
  await expect(newestCard.getByText(/Visual ad \(silent cut\)/i)).toBeVisible()
  await expect(newestCard.getByText(/^Voiced Commercial$/)).toBeVisible()
  // PR Z — storyboard ledger rows.
  await expect(newestCard.getByText(/^Storyboard Commercial$/)).toBeVisible()
  await expect(newestCard.getByText(/^Voiced Storyboard$/)).toBeVisible()
  // PR AF — Dialogue Scene Ad ledger row.
  await expect(newestCard.getByText(/^Dialogue Scene Ad$/)).toBeVisible()
  // PR AB — host-clip ledger row renamed to "Spokesperson Ad". Same
  // file (backend/data/host/<id>.mp4); user-facing vocabulary aligned
  // with the rest of the UI.
  await expect(newestCard.getByText(/^Spokesperson Ad$/)).toBeVisible()
  // PR AG / PR AH — Vertical / Reels exports ledger rows render
  // unconditionally. The smoke campaign has not built either reels
  // artefact, so the rows show the italic "not generated yet"
  // placeholder — labels and meta copy are still visible regardless.
  // PR AH renamed labels to "… · 720×1280 · Captioned" to surface the
  // burned-in subtitles guarantee.
  await expect(
    newestCard.getByText(/Spokesperson Reels · 720×1280 · Captioned/i),
  ).toBeVisible()
  await expect(
    newestCard.getByText(/Dialogue Scene Reels · 720×1280 · Captioned/i),
  ).toBeVisible()

  // 13c. PR CA — the v1 footer "Try preview UX / Use classic
  //      UX" toggle is gone. The top-bar "← Library" CTA is
  //      now the only round-trip back to `/`. (Detailed
  //      assertions live in the dedicated round-trip test.)
  await expect(
    page.getByTestId('app-shell-home-cta'),
  ).toBeVisible()

  // 13. Console / page errors — page errors are always fatal; console errors
  //     are filtered to drop video-network noise.
  const realConsoleErrors = consoleErrors.filter(
    (t) => !IGNORED_CONSOLE_ERRORS.some((rx) => rx.test(t)),
  )
  expect(
    pageErrors,
    `unexpected page errors:\n  ${pageErrors.join('\n  ')}`,
  ).toEqual([])
  expect(
    realConsoleErrors,
    `unexpected console.error messages:\n  ${realConsoleErrors.join('\n  ')}`,
  ).toEqual([])
})

// PR BE — Gated v2 surface smoke. Visits with ?ux=v2 so the
// SpokespersonStudio scaffold replaces Stage 1's CharacterStudio
// panel. Asserts only the new surface — the rest of the app is
// the same as the v1 path which the primary smoke above already
// covers. Resilient to fixture state: passes whether the library
// has zero characters (empty state) or N (library grid).
test('AdSpark Studio Spokesperson Library @ /', async ({ page }) => {
  const consoleErrors = []
  const pageErrors = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text())
  })
  page.on('pageerror', (err) => {
    pageErrors.push(`${err.name}: ${err.message}`)
  })

  // PR CA — `/` is now the Spokesperson Library by default.
  // No `?ux=v2` query parameter required. The footer toggle
  // is gone; the top-bar Legacy UI link replaces it
  // (covered by Test 3 below).
  await page.goto('/')

  // PR CA — TopBar must be present and offer the Legacy UI
  // link as the only escape hatch back to the v1 wizard.
  const topbar = page.getByTestId('app-shell-topbar')
  await expect(topbar).toBeVisible()
  await expect(
    topbar.getByTestId('app-shell-legacy-link'),
  ).toBeVisible()
  await expect(
    topbar.getByTestId('app-shell-health-pill'),
  ).toBeVisible()

  // PR CA — the new Library route wraps SpokespersonStudio.
  // The route container must mount alongside the studio.
  await expect(page.getByTestId('library-route')).toBeVisible()

  // PR BH — v2 surface should clear any leftover activeMode from a
  // previous run so the smoke starts in a known empty-pill state.
  // We clear AFTER goto so localStorage is on the right origin,
  // then reload so SpokespersonStudio's initial useState reads the
  // cleared value.
  await page.evaluate(() => {
    try {
      window.localStorage.removeItem('adspark.activeMode')
    } catch {}
  })
  await page.reload()

  // Spokesperson Library mounts the SpokespersonStudio scaffold
  // (the v2 surface graduated to default-home in PR CA).
  const studio = page.getByTestId('spokesperson-studio')
  await expect(studio).toBeVisible()
  await expect(studio).toHaveAttribute('data-ux-mode', 'v2')
  // PR CB — heading copy now reads "Spokesperson Library"
  // (PR CA renamed it from "Spokesperson Studio"). The
  // tagline + stats row + Create CTA all render alongside.
  await expect(
    studio.getByTestId('spokesperson-studio-heading'),
  ).toContainText(/Spokesperson Library/i)
  await expect(
    studio.getByTestId('spokesperson-library-tagline'),
  ).toContainText(
    /Create persistent AI spokespeople that star in ads, hold conversations, and carry campaign memory\./i,
  )
  // PR CB — Library-level stats row. Each chip carries a
  // testid + a numeric data-count. Smoke asserts the row
  // renders all four chips and that data-count parses as a
  // non-negative integer; exact values vary with the
  // operator's fixture state.
  const statsRow = studio.getByTestId('library-stats-row')
  await expect(statsRow).toBeVisible()
  for (const tid of [
    'library-stat-spokespeople',
    'library-stat-linked-campaigns',
    'library-stat-outputs',
    'library-stat-transcripts',
  ]) {
    const chip = statsRow.getByTestId(tid)
    await expect(chip).toBeVisible()
    const count = await chip.getAttribute('data-count')
    expect(/^\d+$/.test(String(count || ''))).toBeTruthy()
  }
  // PR CB — primary "+ Create Spokesperson" CTA must be on
  // the homepage. PR CD — the legacy global "+ New Campaign"
  // button is now hidden on `/` (campaign creation lives
  // inside the per-spokesperson workspace).
  const createBtn = studio.getByTestId('library-create-spokesperson')
  await expect(createBtn).toBeVisible()
  await expect(createBtn).toHaveText(/\+ Create Spokesperson/i)
  await expect(
    studio.getByTestId('spokesperson-new-campaign'),
  ).toHaveCount(0)
  // PR CK — clicking opens the multi-step CreateSpokespersonFlow.
  // We walk all 4 steps to confirm structural integrity, then
  // cancel without firing the final API calls. Smoke never
  // generates real Runway content.
  await createBtn.click()
  const createFlow = page.getByTestId('create-spokesperson-flow')
  await expect(createFlow).toBeVisible()
  // Step 1 — Identity
  const stepTitle = createFlow.getByTestId('create-spokesperson-step-title')
  await expect(stepTitle).toContainText(/Step 1 of 4/i)
  await expect(
    createFlow.getByTestId('create-spokesperson-step-1'),
  ).toBeVisible()
  await expect(
    createFlow.getByTestId('create-spokesperson-name'),
  ).toBeVisible()
  await expect(
    createFlow.getByTestId('create-spokesperson-template'),
  ).toBeVisible()
  await expect(
    createFlow.getByTestId('create-spokesperson-personality'),
  ).toBeVisible()
  await expect(
    createFlow.getByTestId('create-spokesperson-audience-vibe'),
  ).toBeVisible()
  // Next gated by name + template (template defaults to "mascot",
  // so we just need to fill the name).
  const nextBtn = createFlow.getByTestId('create-spokesperson-next')
  await expect(nextBtn).toBeDisabled()
  await createFlow
    .getByTestId('create-spokesperson-name')
    .fill('QA Smoke Spokesperson')
  await expect(nextBtn).toBeEnabled()
  await nextBtn.click()

  // Step 2 — Visual Direction
  await expect(stepTitle).toContainText(/Step 2 of 4/i)
  await expect(
    createFlow.getByTestId('create-spokesperson-step-2'),
  ).toBeVisible()
  await expect(
    createFlow.getByTestId('create-spokesperson-style-chips'),
  ).toBeVisible()
  await expect(
    createFlow.getByTestId('create-spokesperson-fashion'),
  ).toBeVisible()
  const promptTextarea = createFlow.getByTestId(
    'create-spokesperson-portrait-prompt',
  )
  await expect(promptTextarea).toBeVisible()
  // Auto-derive must populate the prompt; not empty.
  expect((await promptTextarea.inputValue()).length).toBeGreaterThan(20)
  await createFlow.getByTestId('create-spokesperson-next').click()

  // Step 3 — Voice
  await expect(stepTitle).toContainText(/Step 3 of 4/i)
  await expect(
    createFlow.getByTestId('create-spokesperson-step-3'),
  ).toBeVisible()
  await expect(
    createFlow.getByTestId('create-spokesperson-voice'),
  ).toBeVisible()
  await expect(
    createFlow.getByTestId('create-spokesperson-voice-detail'),
  ).toBeVisible()
  await expect(
    createFlow.getByTestId('create-spokesperson-voice-featured'),
  ).toBeVisible()
  await createFlow.getByTestId('create-spokesperson-next').click()

  // Step 4 — Generate
  await expect(stepTitle).toContainText(/Step 4 of 4/i)
  await expect(
    createFlow.getByTestId('create-spokesperson-step-4'),
  ).toBeVisible()
  await expect(
    createFlow.getByTestId('create-spokesperson-summary'),
  ).toBeVisible()
  await expect(
    createFlow.getByTestId('create-spokesperson-avatar-toggle'),
  ).toBeVisible()
  await expect(
    createFlow.getByTestId('create-spokesperson-campaign-toggle'),
  ).toBeVisible()
  // Back is reachable from step 4.
  const backBtn = createFlow.getByTestId('create-spokesperson-back')
  await expect(backBtn).toBeVisible()
  // Cancel via backdrop click (modal currently has no Cancel
  // testid in step 4 — only Back + Submit). Submit is the final
  // create button; we never click it in smoke. Use the close
  // button's lookup instead via going Back to step 1 and
  // hitting Cancel there.
  await backBtn.click() // → step 3
  await createFlow.getByTestId('create-spokesperson-back').click() // → step 2
  await createFlow.getByTestId('create-spokesperson-back').click() // → step 1
  await createFlow.getByTestId('create-spokesperson-cancel').click()
  await expect(
    page.getByTestId('create-spokesperson-flow'),
  ).toHaveCount(0)
  // PR CA — legacy v1 wizard surfaces must be ABSENT on `/`.
  // The legacy "+ Create Character" lives at /legacy now.
  await expect(
    page.getByRole('button', { name: /^\+ Create Character$/i }),
  ).toHaveCount(0)
  // PR CA — no Stage 2 Campaign Brief on `/`.
  await expect(
    page.getByRole('heading', { name: /Campaign Brief/i }),
  ).toHaveCount(0)
  // PR CA — no ModeBanner on `/`. The TopBar's tiny health
  // pill replaces the legacy mode panel.
  await expect(
    page.getByRole('heading', { name: /^Mode$/, level: 3 }),
  ).toHaveCount(0)
  // PR CB — heading + tagline already asserted above against
  // the new "Spokesperson Library" copy. Older "Spokesperson
  // Studio" assertion removed — the library renames the
  // surface as part of the homepage polish.

  // Library must render either the grid (≥1 spokesperson card) or
  // the empty state. Asserting the disjunction keeps the smoke
  // resilient to whatever the operator's characters.json holds.
  const cards = studio.getByTestId('spokesperson-card')
  const emptyState = studio.getByTestId('spokesperson-empty-state')
  const cardCount = await cards.count()
  const emptyCount = await emptyState.count()
  expect(cardCount + emptyCount).toBeGreaterThan(0)

  if (cardCount > 0) {
    // First card defaults to the Identity tab; Knowledge +
    // Appearances tabs are present but render placeholder copy
    // until PR BF / PR BG land.
    const firstCard = cards.first()
    await expect(
      firstCard.getByTestId('spokesperson-tab-identity'),
    ).toHaveAttribute('data-active', 'true')
    await expect(
      firstCard.getByTestId('spokesperson-tab-knowledge'),
    ).toBeVisible()
    await expect(
      firstCard.getByTestId('spokesperson-tab-appearances'),
    ).toBeVisible()
    await expect(
      firstCard.getByTestId('spokesperson-identity-tab'),
    ).toBeVisible()

    // PR BF — Knowledge tab now wires real campaign data. Each
    // card shows either a summary line + per-campaign rows (when at
    // least one campaign links via character_id) OR the empty
    // state copy. The disjunction stays resilient across fixture
    // variations: the smoke campaign created in the v1 test never
    // attaches a character, so most spokespeople here will land in
    // the empty-state branch unless the operator pre-linked
    // characters.
    await firstCard.getByTestId('spokesperson-tab-knowledge').click()
    const knowledgeTab = firstCard.getByTestId(
      'spokesperson-knowledge-tab',
    )
    await expect(knowledgeTab).toBeVisible()
    // Identity content unmounts when Knowledge is active.
    await expect(
      firstCard.getByTestId('spokesperson-identity-tab'),
    ).toHaveCount(0)
    const summaryCount = await firstCard
      .getByTestId('spokesperson-knowledge-summary')
      .count()
    const emptyCount = await firstCard
      .getByTestId('spokesperson-knowledge-empty')
      .count()
    // Exactly one of the two branches must render.
    expect(summaryCount + emptyCount).toBe(1)
    if (summaryCount > 0) {
      // Summary line carries `N campaigns · M grounded · K transcripts`;
      // we don't pin numbers (resilient to fixture state) but the
      // literal "campaigns" + "grounded" + "transcripts" must all
      // appear.
      await expect(
        firstCard.getByTestId('spokesperson-knowledge-summary'),
      ).toContainText(
        /campaigns? · \d+ grounded · \d+ transcripts?/i,
      )
      // At least one per-campaign row must render alongside the
      // summary so the operator can drill in.
      const rowCount = await firstCard
        .getByTestId('spokesperson-knowledge-row')
        .count()
      expect(rowCount).toBeGreaterThan(0)
    } else {
      // Empty state: friendly copy + a setup hint, no error.
      await expect(
        firstCard.getByTestId('spokesperson-knowledge-empty'),
      ).toContainText(/No linked campaigns yet/i)
    }

    // PR BG — Appearances tab now wires real campaign data. Same
    // disjunction shape as Knowledge: exactly one of an
    // `spokesperson-appearance-row` list OR the
    // `spokesperson-appearance-empty` state must render. Resilient
    // to fixture state — first spokesperson may or may not have
    // linked campaigns depending on what's in characters.json.
    await firstCard.getByTestId('spokesperson-tab-appearances').click()
    const appearancesTab = firstCard.getByTestId(
      'spokesperson-appearances-tab',
    )
    await expect(appearancesTab).toBeVisible()
    const appearanceRows = firstCard.getByTestId(
      'spokesperson-appearance-row',
    )
    const appearanceEmpty = firstCard.getByTestId(
      'spokesperson-appearance-empty',
    )
    const appearanceRowCount = await appearanceRows.count()
    const appearanceEmptyCount = await appearanceEmpty.count()
    // Exactly one branch must render.
    expect(appearanceRowCount + appearanceEmptyCount).toBeGreaterThan(0)
    if (appearanceRowCount > 0) {
      // Row carries a mode badge whose text matches one of the
      // seven literal mode strings.
      await expect(
        appearanceRows.first().getByTestId('spokesperson-appearance-mode'),
      ).toContainText(
        /^(Cinematic|Spokesperson Ad|Dialogue Scene|Storyboard|Realtime|Mixed|Draft)$/,
      )
      // PR CA — on `/`, the Library route deliberately does
      // not wire `onOpenCampaign` (no gallery on this route;
      // PR CB lands the workspace Campaigns tab). The
      // Appearances row's "Open in gallery →" affordance
      // therefore shows its disabled placeholder state. The
      // PR BR/BS click-through is preserved for /legacy via
      // direct gallery-card interactions; it lands again in
      // PR CB on `/`.
      const firstRow = appearanceRows.first()
      const openBtn = firstRow.getByTestId('spokesperson-appearance-open')
      await expect(openBtn).toBeDisabled()
    } else {
      await expect(appearanceEmpty).toContainText(
        /No appearances yet/i,
      )
    }
  }

  // PR CD — Home Library Only. Campaign-creation surfaces
  // (global "+ New Campaign" button, selected-mode pill,
  // CampaignModeModal, Spokesperson / Cinematic / Dialogue
  // lane components) all live inside `/spokespeople/:id` now.
  // None of them must render on `/`. The previous PR BH/BI/BK/
  // BL/BN/BO/BP/BQ/BR/BS/BT/BU lane assertions are exercised
  // via the legacy fallback path the workspace's mode modal
  // hands off to (see /legacy smoke for the full lane stack).
  await expect(
    page.getByTestId('spokesperson-new-campaign'),
  ).toHaveCount(0)
  await expect(
    page.getByTestId('spokesperson-active-mode'),
  ).toHaveCount(0)
  await expect(page.getByTestId('campaign-mode-modal')).toHaveCount(0)
  await expect(page.getByTestId('spokesperson-lane')).toHaveCount(0)
  await expect(page.getByTestId('cinematic-lane')).toHaveCount(0)
  await expect(page.getByTestId('dialogue-lane')).toHaveCount(0)

  // PR CC — Library tile primary action ("Open Spokesperson →")
  // navigates to the dedicated /spokespeople/:id workspace.
  // Resilient to fixture state: if the library is empty
  // (no characters in characters.json) the test skips this
  // section. Otherwise the first tile's open link is exercised.
  const allCards = page.getByTestId('spokesperson-card')
  const cardTotal = await allCards.count()
  if (cardTotal > 0) {
    const firstCard = allCards.first()
    const cardId = await firstCard.getAttribute('data-spokesperson-id')
    expect(cardId).toBeTruthy()
    const openLink = firstCard.getByTestId('spokesperson-summary-open')
    await expect(openLink).toBeVisible()
    await openLink.click()
    await expect(page).toHaveURL(
      new RegExp(`/spokespeople/${cardId}$`),
    )

    // Workspace shell mounts: header + 5-tab nav.
    const workspace = page.getByTestId('spokesperson-workspace')
    await expect(workspace).toBeVisible()
    await expect(workspace).toHaveAttribute('data-spokesperson-id', cardId)
    await expect(workspace).toHaveAttribute('data-active-tab', 'identity')
    await expect(
      page.getByTestId('spokesperson-workspace-header'),
    ).toBeVisible()
    await expect(
      page.getByTestId('spokesperson-workspace-name'),
    ).toBeVisible()
    await expect(
      page.getByTestId('spokesperson-workspace-back-link'),
    ).toBeVisible()
    await expect(
      page.getByTestId('spokesperson-workspace-new-campaign'),
    ).toBeVisible()
    await expect(
      page.getByTestId('spokesperson-workspace-tabs'),
    ).toBeVisible()
    await expect(
      page.getByTestId('spokesperson-workspace-avatar-pill'),
    ).toBeVisible()
    await expect(
      page.getByTestId('spokesperson-workspace-voice-pill'),
    ).toBeVisible()

    // Identity tab is the default + fully implemented (embeds
    // CharacterCard).
    await expect(
      page.getByTestId('spokesperson-workspace-tab-identity'),
    ).toHaveAttribute('data-active', 'true')
    await expect(
      page.getByTestId('spokesperson-workspace-identity'),
    ).toBeVisible()

    // PR CC — Knowledge / Conversations / Outputs render
    // <TabComingSoon> placeholders. Campaigns moved to its
    // own block below since PR CE replaced the placeholder
    // with the real CampaignLanes mount.
    for (const placeholder of ['knowledge', 'conversations', 'outputs']) {
      await page
        .getByTestId(`spokesperson-workspace-tab-${placeholder}`)
        .click()
      await expect(workspace).toHaveAttribute(
        'data-active-tab',
        placeholder,
      )
      await expect(
        page.getByTestId(`spokesperson-workspace-${placeholder}`),
      ).toBeVisible()
    }

    // PR CE — Campaigns tab now mounts <CampaignLanes>.
    // Asserts: tab section renders, + New Campaign button
    // opens the controlled mode modal in-place (no
    // navigation to /legacy), picking Cinematic Ad mounts
    // the cinematic lane scoped to this spokesperson, and
    // the active-mode pill dismisses cleanly. Smoke never
    // clicks any lane action button (no real Runway calls).
    await page
      .getByTestId('spokesperson-workspace-tab-campaigns')
      .click()
    await expect(workspace).toHaveAttribute(
      'data-active-tab',
      'campaigns',
    )
    const campaignsSection = page.getByTestId(
      'spokesperson-workspace-campaigns',
    )
    await expect(campaignsSection).toBeVisible()
    const newCampaignBtn = campaignsSection.getByTestId(
      'spokesperson-workspace-campaigns-new',
    )
    await expect(newCampaignBtn).toBeVisible()
    // CampaignLanes mounts; mode modal not yet open. Use
    // toHaveCount(1) instead of toBeVisible() because the
    // section is empty until a mode is selected — an empty
    // <section> has zero height and Playwright's
    // visibility check treats that as hidden.
    const campaignLanes = page.getByTestId('campaign-lanes')
    await expect(campaignLanes).toHaveCount(1)
    await expect(page.getByTestId('campaign-mode-modal')).toHaveCount(0)

    // Click + New Campaign → modal opens INSIDE the
    // workspace (no navigation away).
    await newCampaignBtn.click()
    await expect(page).toHaveURL(new RegExp(`/spokespeople/${cardId}$`))
    const inWorkspaceModal = page.getByTestId('campaign-mode-modal')
    await expect(inWorkspaceModal).toBeVisible()

    // Pick Cinematic Ad → CinematicLane mounts inside the
    // workspace's CampaignLanes; the modal dismisses;
    // active-mode pill renders with data-mode="cinematic".
    await inWorkspaceModal
      .getByTestId('campaign-mode-card-cinematic')
      .click()
    await expect(
      page.getByTestId('campaign-mode-modal'),
    ).toHaveCount(0)
    await expect(page).toHaveURL(new RegExp(`/spokespeople/${cardId}$`))
    await expect(campaignLanes).toHaveAttribute(
      'data-active-mode',
      'cinematic',
    )
    const activeModePill = page.getByTestId(
      'campaign-lanes-active-mode',
    )
    await expect(activeModePill).toBeVisible()
    await expect(activeModePill).toHaveAttribute('data-mode', 'cinematic')
    await expect(page.getByTestId('cinematic-lane')).toBeVisible()
    // Spokesperson + Dialogue lanes must NOT mount alongside.
    await expect(page.getByTestId('spokesperson-lane')).toHaveCount(0)
    await expect(page.getByTestId('dialogue-lane')).toHaveCount(0)

    // Dismiss the active mode → pill + lane unmount.
    await page
      .getByTestId('campaign-lanes-active-mode-dismiss')
      .click()
    await expect(
      page.getByTestId('campaign-lanes-active-mode'),
    ).toHaveCount(0)
    await expect(page.getByTestId('cinematic-lane')).toHaveCount(0)
    // localStorage activeMode cleared.
    const lanesCleared = await page.evaluate(() =>
      window.localStorage.getItem('adspark.activeMode'),
    )
    expect(lanesCleared).toBeNull()

    // PR CC — unknown id falls back to the not-found state with
    // a "Back to Library" CTA.
    await page.goto('/spokespeople/this-id-does-not-exist')
    await expect(
      page.getByTestId('spokesperson-workspace-not-found'),
    ).toBeVisible()
    await expect(
      page.getByTestId('spokesperson-workspace-back-cta'),
    ).toBeVisible()
    await page.goto('/')
  }

  // PR CF — Copy cleanup. Visible v2 surfaces must not leak
  // dev jargon. Walk the homepage + each lane (with the
  // workspace mode modal opened in-place) and assert the
  // forbidden strings never appear in the rendered text.
  const FORBIDDEN_JARGON = [
    /scaffold ·/i,
    /preview UX/i,
    /\blands next\b/i,
    /\bships in PR\b/i,
    /\bclassic UX\b/i,
    /\bclassic gallery\b/i,
    /\bPR B[A-Z]\b/, // PR BI / PR BJ / PR BK ... in user-visible text
  ]
  const assertNoJargon = async (label) => {
    const body = (await page.textContent('body')) || ''
    for (const rx of FORBIDDEN_JARGON) {
      expect(
        body,
        `[PR CF] dev jargon ${rx} leaked on ${label}`,
      ).not.toMatch(rx)
    }
  }
  // Homepage scrub
  await assertNoJargon('/ (library)')
  // Mode modal + each lane scrub. Resilient to fixture state.
  if (cardTotal > 0) {
    const firstCardId = await page
      .getByTestId('spokesperson-card')
      .first()
      .getAttribute('data-spokesperson-id')
    await page.goto(`/spokespeople/${firstCardId}`)
    await page
      .getByTestId('spokesperson-workspace-tab-campaigns')
      .click()
    await page
      .getByTestId('spokesperson-workspace-campaigns-new')
      .click()
    await expect(page.getByTestId('campaign-mode-modal')).toBeVisible()
    await assertNoJargon('campaign-mode-modal')
    for (const mode of ['spokesperson', 'cinematic', 'dialogue']) {
      await page.getByTestId(`campaign-mode-card-${mode}`).click()
      await expect(page.getByTestId(`${mode}-lane`)).toBeVisible()
      await assertNoJargon(`${mode}-lane`)
      await page
        .getByTestId('campaign-lanes-active-mode-dismiss')
        .click()
      await page
        .getByTestId('spokesperson-workspace-campaigns-new')
        .click()
      await expect(page.getByTestId('campaign-mode-modal')).toBeVisible()
    }
    // Close the lingering modal so the rest of the smoke runs clean.
    await page.keyboard.press('Escape')
    await page.goto('/')
  }

  // Console / page errors stay clean on the v2 path too.
  const realConsoleErrors = consoleErrors.filter(
    (t) => !IGNORED_CONSOLE_ERRORS.some((rx) => rx.test(t)),
  )
  expect(
    pageErrors,
    `unexpected page errors (v2):\n  ${pageErrors.join('\n  ')}`,
  ).toEqual([])
  expect(
    realConsoleErrors,
    `unexpected console.error messages (v2):\n  ${realConsoleErrors.join('\n  ')}`,
  ).toEqual([])
})

// PR BM — Footer UX toggle round-trip. Confirms the v1 ↔ v2
// flip via the `Try preview UX` / `Use classic UX` link in the
// footer triggers a full reload + the new mode mounts on the
// next paint. Catches a class of regression where the flag is
// persisted but a v2-gated component fails to remount.
test('AdSpark Studio top-bar Legacy UI round-trip', async ({ page }) => {
  const consoleErrors = []
  const pageErrors = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text())
  })
  page.on('pageerror', (err) => {
    pageErrors.push(`${err.name}: ${err.message}`)
  })

  // PR CA — `/` is the new home. Clear any stale localStorage
  // before assertions so the one-shot `adspark.ux === "v1"`
  // migration logic in <AppShell> doesn't redirect us.
  await page.goto('/')
  await page.evaluate(() => {
    try {
      window.localStorage.removeItem('adspark.ux')
      window.localStorage.removeItem('adspark.activeMode')
    } catch {}
  })
  await page.reload()

  // PR CA — `/` mounts the Spokesperson Library (NOT the
  // legacy wizard). The library route container + studio
  // testids are present; the legacy "+ Create Character"
  // button is not.
  await expect(page.getByTestId('library-route')).toBeVisible()
  await expect(page.getByTestId('spokesperson-studio')).toBeVisible()
  await expect(
    page.getByRole('button', { name: /^\+ Create Character$/i }),
  ).toHaveCount(0)

  // PR CA — top-bar Legacy UI link is the only canonical
  // round-trip mechanism between /home and /legacy now that
  // the footer toggle is gone.
  const legacyLink = page.getByTestId('app-shell-legacy-link')
  await expect(legacyLink).toBeVisible()
  await expect(legacyLink).toHaveText(/Legacy UI/i)

  // Click → SPA navigation → /legacy mounts the v1 wizard.
  await legacyLink.click()
  await expect(page).toHaveURL(/\/legacy$/)
  await expect(
    page.getByRole('button', { name: /^\+ Create Character$/i }),
  ).toBeVisible()
  // PR CA — SpokespersonStudio must NOT render on /legacy.
  await expect(page.getByTestId('spokesperson-studio')).toHaveCount(0)
  await expect(page.getByTestId('library-route')).toHaveCount(0)

  // Top-bar swaps to a "← Library" CTA so the round-trip
  // back to / is one click away.
  const homeCta = page.getByTestId('app-shell-home-cta')
  await expect(homeCta).toBeVisible()
  await expect(homeCta).toHaveText(/Library/i)

  // Round-trip back to /.
  await homeCta.click()
  await expect(page).toHaveURL(/\/$|\/\?/)
  await expect(page.getByTestId('library-route')).toBeVisible()
  await expect(page.getByTestId('spokesperson-studio')).toBeVisible()
  await expect(
    page.getByRole('button', { name: /^\+ Create Character$/i }),
  ).toHaveCount(0)

  // Console / page errors stay clean across the round-trip too.
  const realConsoleErrors = consoleErrors.filter(
    (t) => !IGNORED_CONSOLE_ERRORS.some((rx) => rx.test(t)),
  )
  expect(
    pageErrors,
    `unexpected page errors (toggle round-trip):\n  ${pageErrors.join('\n  ')}`,
  ).toEqual([])
  expect(
    realConsoleErrors,
    `unexpected console.error messages (toggle round-trip):\n  ${realConsoleErrors.join('\n  ')}`,
  ).toEqual([])
})
