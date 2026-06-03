// pending-seed-producer.spec.js — verifies the "seed at create time" bridge's
// PRODUCER half: choosing "Clone from git" on the control-plane create form
// stashes a pending seed in localStorage keyed by the new pod's base path
// (/w/<id>/), which the pod IDE later consumes (see pending-seed-consumer).
//
// Run against the control plane root:
//   CARBIDE_WS_URL=http://localhost:8080 \
//   CARBIDE_E2E_EMAIL=test@example.com CARBIDE_E2E_PASSWORD=password123 \
//   npx playwright test tests/e2e/pending-seed-producer.spec.js --reporter=list
import { test, expect } from '@playwright/test'
import { loginAndCaptureLogs } from './helpers/session.js'

const GIT_URL = 'https://github.com/fdimitri/carbide2-site'

test('control create form stashes a pending git seed', async ({ page }) => {
  await loginAndCaptureLogs(page)

  await page.getByRole('button', { name: /New Workspace/i }).click()
  await page.locator('input').first().fill(`seedtest-${Date.now()}`)
  await page.getByRole('button', { name: /Clone from git/i }).click()
  await page.getByPlaceholder('https://github.com/user/repo.git').fill(GIT_URL)
  await page.getByRole('button', { name: /^Create$/ }).click()

  // After creation the form resets; a pending seed must now exist for the new
  // workspace, keyed by its /w/<id>/ base path with the chosen git URL.
  await expect.poll(async () => {
    return page.evaluate(() => {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i)
        if (k && k.startsWith('carbide_pending_seed:/w/')) return localStorage.getItem(k)
      }
      return null
    })
  }, { timeout: 15000 }).not.toBeNull()

  const seedRaw = await page.evaluate(() => {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k && k.startsWith('carbide_pending_seed:/w/')) return localStorage.getItem(k)
    }
    return null
  })
  const seed = JSON.parse(seedRaw)
  expect(seed.method).toBe('git')
  expect(seed.gitUrl).toBe(GIT_URL)
})
