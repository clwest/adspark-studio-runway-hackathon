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

  // 8. Reference Image URL — placeholder value to mirror the demo path
  await page
    .getByPlaceholder(/images\.unsplash\.com\/photo/i)
    .fill('https://example.com/placeholder.jpg')

  // 9. Generate Video (mock task)
  await page.getByRole('button', { name: /^Generate Video$/i }).click()

  // 10. Wait for SUCCEEDED. Mock task duration ~12s; client poll every 5s + jitter.
  //     Allow up to 25s.
  await expect(page.getByText(/^SUCCEEDED$/)).toBeVisible({ timeout: 25_000 })

  // 11. Save campaign
  await page.getByRole('button', { name: /^Save campaign card$/i }).click()
  await expect(
    page.getByRole('button', { name: /^Saved · cached locally$/i }),
  ).toBeVisible()

  // 12. Gallery now contains the new campaign. Scope to the gallery card
  //     specifically (a `div.rounded-2xl` containing the heading) so we don't
  //     accidentally match ModeBanner <li> bullets or the App root. The
  //     newly saved campaign sits at the top of the campaigns <ul>.
  const galleryCard = page
    .locator('div.rounded-2xl')
    .filter({ has: page.getByRole('heading', { name: /Saved campaigns/i }) })
    .first()
  const newestCard = galleryCard.locator('ul > li').first()
  await expect(newestCard.getByText('Local coffee shop', { exact: true })).toBeVisible()
  await expect(newestCard.getByText(/^video ready$/i)).toBeVisible()
  // Cache pipeline must report a known status. Network unreachable in CI is
  // acceptable; "cache failed" still proves the pipeline ran end-to-end.
  await expect(
    newestCard.getByText(/^(cached locally|cache failed|external URL may expire)$/i),
  ).toBeVisible()
  // 13a. The Campaign Pack only appears when caching succeeded; if the mock
  //      URL was reachable in this run, assert all three per-format Build
  //      buttons render. Otherwise it's expected to be absent — that's still
  //      a valid path.
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
