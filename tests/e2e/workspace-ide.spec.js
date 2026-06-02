// Playwright regression test: ensure the actual IDE shell renders.
import { test, expect } from '@playwright/test'
import { loginAndCaptureLogs } from './helpers/session.js'

const BASE = process.env.CARBIDE_WS_URL || 'http://localhost:5173'
const EMAIL = process.env.CARBIDE_E2E_EMAIL || 'test@example.com'
const PASSWORD = process.env.CARBIDE_E2E_PASSWORD || 'password123'

test.describe('Workspace IDE shell', () => {
  test('menu bar and Explorer pane are visible after opening a project', async ({ page, request }) => {
    const projectName = `e2e-ide-${Date.now()}`

    // Seed one project for this user so opening ProjectPage is deterministic.
    const loginResp = await request.post(`${BASE}/api/login`, {
      data: { user: { email: EMAIL, password: PASSWORD } },
    })
    expect(loginResp.ok()).toBeTruthy()
    const { token } = await loginResp.json()

    const createResp = await request.post(`${BASE}/api/projects`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { project: { name: projectName, description: 'IDE shell regression fixture' } },
    })
    expect(createResp.ok()).toBeTruthy()

    await loginAndCaptureLogs(page)

    const projectTitle = page.locator('div.cursor-pointer h3', { hasText: projectName })
    await expect(projectTitle).toBeVisible({ timeout: 10000 })
    await projectTitle.click()

    await page.waitForURL('**/projects/**', { timeout: 10000 })

    // Explicitly assert the two UX surfaces the user asked for.
    await expect(page.locator('.workspace-menubar')).toBeVisible({ timeout: 10000 })
    await expect(page.getByText('Explorer', { exact: true })).toBeVisible({ timeout: 10000 })
    await expect(page.locator('.explorer-file-tree')).toBeVisible({ timeout: 10000 })
  })
})
