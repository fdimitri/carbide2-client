// tests/e2e/smoke.spec.js
// Smoke test: login → open project → dump ALL console output and WS frames.
// Use this when diagnosing unknown failures — it shows everything.
//
// Run with:
//   npx playwright test tests/e2e/smoke.spec.js --reporter=list
//
import { test } from '@playwright/test'
import { loginAndCaptureLogs, openFirstProject, dumpWsFrames } from './helpers/session.js'

test('smoke — dump console and WS frames on load', { timeout: 30000 }, async ({ page }) => {
  await loginAndCaptureLogs(page)
  const { wsFrames } = await openFirstProject(page)

  // Let the page settle for 2s so async handlers can fire
  await page.waitForTimeout(2000)

  dumpWsFrames(wsFrames)

  // Always pass — this is a diagnostic, not an assertion test
})
