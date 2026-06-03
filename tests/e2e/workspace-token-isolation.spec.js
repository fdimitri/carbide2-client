// Regression: workspace auth tokens must be isolated per workspace pod.
//
// Every workspace pod is served under the SAME browser origin
// (localhost:8080) but at a different path (/w/8/, /w/9/ …) and each pod has
// its OWN database with its OWN user ids. If the SPA stores the workspace
// JWT under a single origin-scoped localStorage key, a token minted by pod A
// is replayed against pod B, whose `User.find(sub)` then raises
// RecordNotFound -> 404 on every /api/* call, leaving an empty dashboard.
//
// This test reproduces the cross-workspace replay and asserts the second
// workspace lands in its IDE with NO 404s on /api/projects.
import { test, expect } from '@playwright/test'

const CONTROL = 'http://localhost:8080'
const WS_A = process.env.CARBIDE_WS_A || 'http://localhost:8080/w/8'
const WS_B = process.env.CARBIDE_WS_B || 'http://localhost:8080/w/9'
const EMAIL = process.env.CARBIDE_E2E_EMAIL || 'test@example.com'
const PASSWORD = process.env.CARBIDE_E2E_PASSWORD || 'password123'

async function loginVia(page, base) {
  await page.goto(`${base}/login`)
  await page.fill('#email', EMAIL)
  await page.fill('#password', PASSWORD)
  await page.click('button[type=submit]')
  await page.waitForURL((u) => /\/(dashboard|projects)(\/|$)/.test(new URL(u).pathname), { timeout: 15000 })
}

test('navigating between two workspaces does not 404 on /api/projects', async ({ page }) => {
  const apiFailures = []
  page.on('response', (res) => {
    const u = res.url()
    if (/\/api\/(projects|workspaces)\b/.test(u) && res.status() >= 400) {
      apiFailures.push(`${res.status()} ${u}`)
    }
  })

  // 1) Log into workspace A — mints WS_A's token under the shared origin.
  await loginVia(page, WS_A)
  await page.waitForURL('**/projects/**', { timeout: 15000 })

  // 2) Now navigate directly to workspace B's dashboard in the SAME tab
  //    (same origin -> shares localStorage). This is the user's flow.
  await page.goto(`${WS_B}/dashboard`)

  // Workspace B must auto-open its own single project IDE.
  await page.waitForURL('**/projects/**', { timeout: 15000 })
  await expect(page.locator('.workspace-menubar')).toBeVisible({ timeout: 15000 })
  await expect(page.locator('.explorer-file-tree')).toBeVisible({ timeout: 15000 })

  expect(apiFailures, `API 4xx/5xx during cross-workspace navigation:\n${apiFailures.join('\n')}`).toEqual([])
})
