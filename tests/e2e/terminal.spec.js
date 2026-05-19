// tests/e2e/terminal.spec.js
// Diagnostic: login → open project → create a terminal → verify it appears.
//
// Run with:
//   npx playwright test tests/e2e/terminal.spec.js --reporter=list
//
import { test, expect } from '@playwright/test'
import { loginAndCaptureLogs, openFirstProject, dumpWsFrames } from './helpers/session.js'

test('create terminal appears in pane', async ({ page }) => {
  await loginAndCaptureLogs(page)
  const { wsFrames } = await openFirstProject(page)

  // Click the "New Terminal" button in the dock
  const newTermBtn = page.locator('button', { hasText: /terminal/i }).first()
  await expect(newTermBtn).toBeVisible({ timeout: 5000 })
  await newTermBtn.click()

  // A tab labelled "bash" (or similar) should appear within 5s
  const termTab = page.locator('.pane-tab', { hasText: /bash|terminal/i }).first()
  await expect(termTab).toBeVisible({ timeout: 5000 })

  dumpWsFrames(wsFrames)
})
