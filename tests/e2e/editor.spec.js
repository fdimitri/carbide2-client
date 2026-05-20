// editor.spec.js — verify that typing in Monaco emits fs:write over WS
import { test, expect } from '@playwright/test'
import { loginAndCaptureLogs, openFirstProject } from './helpers/session.js'

test('typing in Monaco emits fs:write over WS', async ({ page }) => {
  await loginAndCaptureLogs(page)
  const { wsFrames } = await openFirstProject(page)

  // Wait for the file tree to populate
  await page.waitForTimeout(2000)

  // Click the first file node in the explorer tree
  const fileNode = page.locator('.explorer-file-tree .p-tree-node-leaf').first()
  await expect(fileNode).toBeVisible({ timeout: 10000 })
  await fileNode.click()

  // Wait for Monaco to load the file (Loading… disappears)
  await expect(page.locator('span.italic').filter({ hasText: 'Loading' })).toBeHidden({ timeout: 10000 })
  await page.waitForTimeout(500)

  // Click into the Monaco editor and type
  const monacoEditor = page.locator('.monaco-editor').first()
  await expect(monacoEditor).toBeVisible({ timeout: 5000 })
  await monacoEditor.click()
  await page.keyboard.press('End')
  await page.keyboard.type('x')
  await page.waitForTimeout(500)

  // Dump everything we captured
  console.log('\n=== Console logs above, WS frames below ===')
  const writeSent = wsFrames.filter(f => {
    try { const p = JSON.parse(f.data); return f.dir === '→' && p.cs === 'fs' && p.cmd === 'write' }
    catch { return false }
  })
  console.log(`fs:write frames sent: ${writeSent.length}`)
  for (const f of writeSent) console.log(' ', f.data)

  expect(writeSent.length).toBeGreaterThan(0)
})
