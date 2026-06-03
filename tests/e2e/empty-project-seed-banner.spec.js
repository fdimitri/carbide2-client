// empty-project-seed-banner.spec.js — regression for the "create = empty project"
// design. A freshly provisioned workspace pod must:
//   1. land directly in the IDE (Model B),
//   2. have an EMPTY file tree (no seeded "Demo Project" sample files),
//   3. surface the in-pod "Clone from git URL" banner that ExplorerPane shows
//      ONLY when the project tree is empty.
//
// Run against a fresh cluster pod:
//   CARBIDE_WS_URL=http://localhost:8080/w/10 \
//   CARBIDE_E2E_EMAIL=test@example.com CARBIDE_E2E_PASSWORD=password123 \
//   npx playwright test tests/e2e/empty-project-seed-banner.spec.js --reporter=list
import { test, expect } from '@playwright/test'
import { loginAndCaptureLogs, openFirstProject } from './helpers/session.js'

test('fresh workspace is empty and shows the clone-from-git banner', async ({ page }) => {
  await loginAndCaptureLogs(page)
  await openFirstProject(page)

  // The empty-project banner offers cloning from a git URL. ExplorerPane only
  // renders it when the VFS has no files — so its presence proves the project
  // booted empty (the old "Demo Project" sample tree would have suppressed it).
  const cloneBtn = page.getByRole('button', { name: /Clone from git URL/i })
  await expect(cloneBtn).toBeVisible({ timeout: 10000 })

  // And there should be no seeded sample files leaking in.
  await expect(page.getByText('Demo Project')).toHaveCount(0)
  await expect(page.getByText('main.rb')).toHaveCount(0)
})
