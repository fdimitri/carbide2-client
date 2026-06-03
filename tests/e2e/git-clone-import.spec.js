// git-clone-import.spec.js — verifies that a project seeded via the in-pod
// "import from git" flow renders the cloned files in the IDE explorer.
//
// Run against the pod where the clone landed (e.g. carbide2-site on /w/11):
//   CARBIDE_WS_URL=http://localhost:8080/w/11 \
//   CARBIDE_E2E_EMAIL=test@example.com CARBIDE_E2E_PASSWORD=password123 \
//   npx playwright test tests/e2e/git-clone-import.spec.js --reporter=list
import { test, expect } from '@playwright/test'
import { loginAndCaptureLogs, openFirstProject } from './helpers/session.js'

test('cloned repo files render in the explorer', async ({ page }) => {
  await loginAndCaptureLogs(page)
  await openFirstProject(page)

  // Files cloned from github.com/fdimitri/carbide2-site (default branch).
  await expect(page.getByText('README.md', { exact: true })).toBeVisible({ timeout: 15000 })
  await expect(page.getByText('package.json', { exact: true })).toBeVisible({ timeout: 15000 })

  // The empty-project banner must be gone once files exist.
  await expect(page.getByRole('button', { name: /Clone from git URL/i })).toHaveCount(0)
})
