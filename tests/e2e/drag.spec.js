// tests/e2e/drag.spec.js
// Diagnostic: capture all console output + WS frames during drag operations.
// This is a diagnostic script, not a pass/fail test.
//
// Run with:
//   npx playwright test tests/e2e/drag.spec.js --reporter=list
//
import { test } from '@playwright/test'
import { loginAndCaptureLogs, openFirstProject, dumpWsFrames } from './helpers/session.js'

test('drag diagnostic — tab drag and tree-to-pane drag', { timeout: 30000 }, async ({ page }) => {
  await loginAndCaptureLogs(page)
  const { wsFrames } = await openFirstProject(page)

  // Give the app time to render the explorer and panes
  await page.waitForTimeout(1000)

  // --- Attempt 1: drag first tab to second pane ---
  console.log('\n[DRAG TEST] Attempting tab drag...')
  const tabs = page.locator('.pane-tab')
  const tabCount = await tabs.count()
  console.log(`[DRAG TEST] Found ${tabCount} tabs`)

  if (tabCount > 0) {
    const tab = tabs.first()
    const tabBox = await tab.boundingBox()
    console.log(`[DRAG TEST] Tab bounding box: ${JSON.stringify(tabBox)}`)

    // Find a second pane to drop onto
    const panes = page.locator('.workspace-pane, .splitter-panel')
    const paneCount = await panes.count()
    console.log(`[DRAG TEST] Found ${paneCount} panes`)

    if (paneCount > 1) {
      const targetPane = panes.nth(1)
      const paneBox = await targetPane.boundingBox()
      console.log(`[DRAG TEST] Target pane bounding box: ${JSON.stringify(paneBox)}`)

      if (tabBox && paneBox) {
        await page.mouse.move(tabBox.x + tabBox.width / 2, tabBox.y + tabBox.height / 2)
        await page.mouse.down()
        await page.waitForTimeout(100)
        await page.mouse.move(paneBox.x + paneBox.width / 2, paneBox.y + paneBox.height / 2, { steps: 10 })
        await page.waitForTimeout(200)
        await page.mouse.up()
        await page.waitForTimeout(500)
        console.log('[DRAG TEST] Tab drag complete')
      }
    }
  }

  // --- Attempt 2: drag tree node to pane ---
  console.log('\n[DRAG TEST] Attempting tree node drag...')
  const treeNodes = page.locator('.p-tree-node-label')
  const nodeCount = await treeNodes.count()
  console.log(`[DRAG TEST] Found ${nodeCount} tree nodes`)

  if (nodeCount > 0) {
    // Find a leaf node (file or terminal) — skip group/folder nodes
    for (let i = 0; i < Math.min(nodeCount, 10); i++) {
      const node = treeNodes.nth(i)
      const label = await node.textContent()
      console.log(`[DRAG TEST] Tree node ${i}: "${label?.trim()}"`)
    }

    const leafNode = treeNodes.nth(1) // usually a file or terminal
    const nodeBox = await leafNode.boundingBox()
    const firstPane = page.locator('.workspace-pane, [class*="pane"]').first()
    const paneBox = await firstPane.boundingBox()

    console.log(`[DRAG TEST] Node box: ${JSON.stringify(nodeBox)}`)
    console.log(`[DRAG TEST] Pane box: ${JSON.stringify(paneBox)}`)

    if (nodeBox && paneBox) {
      await page.mouse.move(nodeBox.x + nodeBox.width / 2, nodeBox.y + nodeBox.height / 2)
      await page.mouse.down()
      await page.waitForTimeout(100)
      await page.mouse.move(paneBox.x + paneBox.width / 2, paneBox.y + paneBox.height / 2, { steps: 10 })
      await page.waitForTimeout(200)
      await page.mouse.up()
      await page.waitForTimeout(500)
      console.log('[DRAG TEST] Tree node drag complete')
    }
  }

  dumpWsFrames(wsFrames)
})
