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

test('AdSpark Studio mock-mode end-to-end smoke', async ({ page }) => {
  const consoleErrors = []
  const pageErrors = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text())
  })
  page.on('pageerror', (err) => {
    pageErrors.push(`${err.name}: ${err.message}`)
  })

  // 1. Load the app
  await page.goto('/')

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
  // always opens with "A realistic ".
  const promptTextarea = page.locator('textarea').first()
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
  // The empty-state copy is visible until a character is created
  // (existing characters.json may already have entries from prior
  // runs; in that case the panel shows the library grid instead).
  // Do not assert empty state explicitly to keep the test resilient.

  // 7b.6. PR U — stage order: Spokesperson must appear before Campaign
  //        Brief in the DOM. We compare bounding boxes since the visual
  //        order is what matters; both are sticky enough that flex/wrap
  //        won't reorder them on a desktop viewport.
  const spokespersonHeading = page.getByRole('heading', { name: /^Spokesperson$/i })
  const briefHeading = page.getByRole('heading', { name: /^Campaign Brief$/i })
  const spokeBox = await spokespersonHeading.boundingBox()
  const briefBox = await briefHeading.boundingBox()
  expect(spokeBox).not.toBeNull()
  expect(briefBox).not.toBeNull()
  expect(spokeBox.y).toBeLessThan(briefBox.y)
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

  // 12a. PR P — UI Phase 2: tab row renders six tabs and Overview is
  //       active by default.
  for (const name of ['Overview', 'Visuals', 'Character', 'Voice', 'Realtime', 'Exports']) {
    await expect(newestCard.getByRole('tab', { name })).toBeVisible()
  }
  await expect(
    newestCard.getByRole('tab', { name: 'Overview' }),
  ).toHaveAttribute('aria-selected', 'true')

  // 13a. Visuals tab — silent visual-cut copy + cache status + (when
  //      cached) Campaign Pack 3-up. Network unreachable in CI is
  //      acceptable; "cache failed" still proves the pipeline ran.
  await newestCard.getByRole('tab', { name: 'Visuals' }).click()
  await expect(newestCard.getByText(/^visual-only · silent$/)).toBeVisible()
  await expect(
    newestCard.getByText(/Visual cut only — Runway gen4_turbo/i),
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

  // 13a.2 — PR S — Commercial with Voice section in the Visuals tab.
  //         The smoke saves a campaign without a host clip so the
  //         gated path renders: section header + button is disabled +
  //         the explanatory amber line points the user at the
  //         Character tab.
  await expect(newestCard.getByText(/^Commercial with Voice$/)).toBeVisible()
  await expect(
    newestCard.getByText(/Combines the silent visual cut with the Avatar Host Clip audio/i),
  ).toBeVisible()
  const buildCommercialBtn = newestCard.getByRole('button', {
    name: /^Build Commercial with Voice$/i,
  })
  await expect(buildCommercialBtn).toBeVisible()
  await expect(buildCommercialBtn).toBeDisabled()
  await expect(
    newestCard.getByText(/Generate the Avatar Host Clip first/i),
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

  // 13c. Voice tab — Audio Pack with PR M honest labels.
  await newestCard.getByRole('tab', { name: 'Voice' }).click()
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
  } else {
    await expect(
      newestCard.getByText(/Brand Spokesperson required/i),
    ).toBeVisible()
  }

  // 13e. Exports tab — file-ledger renders, with at least the visual
  //      ad row present (every saved campaign has a video URL or a
  //      "not generated yet" placeholder for it). PR S — also asserts
  //      the Commercial with Voice row is in the ledger; gated state
  //      shows "not generated yet" since the smoke didn't build it.
  await newestCard.getByRole('tab', { name: 'Exports' }).click()
  await expect(newestCard.getByText(/Visual ad \(silent cut\)/i)).toBeVisible()
  await expect(newestCard.getByText(/^Commercial with Voice$/)).toBeVisible()

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
