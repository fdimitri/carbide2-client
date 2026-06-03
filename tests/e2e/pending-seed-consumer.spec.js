// pending-seed-consumer.spec.js — verifies the "seed at create time" bridge's
// CONSUMER half: a pending git seed stashed in localStorage (keyed by the
// pod's base path, as the control-plane create form does) is picked up by the
// workspace IDE on first open, which auto-runs import_from_git.
//
// Pre-req: the target pod's project must be EMPTY (the seed only fires on an
// empty tree). Run against a freshly-emptied pod, e.g. /w/10:
//   CARBIDE_WS_URL=http://localhost:8080/w/10 \
//   CARBIDE_E2E_EMAIL=test@example.com CARBIDE_E2E_PASSWORD=password123 \
//   npx playwright test tests/e2e/pending-seed-consumer.spec.js --reporter=list
import { test, expect } from '@playwright/test'
import { loginAndCaptureLogs, openFirstProject } from './helpers/session.js'

test('pending git seed auto-clones on first open', async ({ page }) => {
  // Stash the pending seed BEFORE any app script runs, exactly as the control
  // create form would after creating /w/10.
  await page.addInitScript(() => {
    localStorage.setItem(
      'carbide_pending_seed:/w/10/',
      JSON.stringify({ method: 'git', gitUrl: 'https://github.com/fdimitri/carbide2-site', gitRef: '' }),
    )
  })

  await loginAndCaptureLogs(page)
  await openFirstProject(page)

  // The IDE should auto-fire the clone and the cloned files should surface.
  await expect(page.getByText('README.md', { exact: true })).toBeVisible({ timeout: 25000 })
  await expect(page.getByText('package.json', { exact: true })).toBeVisible({ timeout: 25000 })

  // The marker is consumed (cleared) so a reload won't re-clone.
  const leftover = await page.evaluate(() => localStorage.getItem('carbide_pending_seed:/w/10/'))
  expect(leftover).toBeNull()
})
