// Playwright regression test: ensure the actual IDE shell renders.
//
// Model B: a workspace pod hosts exactly ONE canonical project and has no
// in-pod dashboard. Logging in lands the user directly in that project's IDE
// (the router redirects /dashboard -> /projects/<canonicalId> in workspace
// mode). This test asserts that auto-open path and the core IDE surfaces.
import { test, expect } from '@playwright/test'
import { loginAndCaptureLogs } from './helpers/session.js'

test.describe('Workspace IDE shell', () => {
  test('login lands directly in the single project IDE', async ({ page }) => {
    await loginAndCaptureLogs(page)

    // Workspace mode auto-opens the pod's single canonical project.
    await page.waitForURL('**/projects/**', { timeout: 10000 })

    // Explicitly assert the two UX surfaces the user asked for.
    await expect(page.locator('.workspace-menubar')).toBeVisible({ timeout: 10000 })
    await expect(page.getByText('Explorer', { exact: true })).toBeVisible({ timeout: 10000 })
    await expect(page.locator('.explorer-file-tree')).toBeVisible({ timeout: 10000 })
  })
})
