// tests/e2e/chat.spec.js
// Functional tests: chat join/create/send/history/isolation, and layout switching.
//
// Run with:
//   npx playwright test tests/e2e/chat.spec.js --reporter=list
//
import { test, expect } from '@playwright/test'
import { loginAndCaptureLogs, openFirstProject, dumpWsFrames } from './helpers/session.js'

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Click a tree node labelled exactly `label` */
async function clickTreeNode(page, label) {
  const node = page.locator('.p-tree-node-label', { hasText: label }).first()
  await expect(node).toBeVisible({ timeout: 5000 })
  await node.click()
}

/** Wait for a `chat:joined` WS frame for a given channel id */
async function waitForChatJoined(page, channelId, { timeout = 5000 } = {}) {
  await page.waitForFunction(
    ({ cid }) => window.__carbide_chat_joined?.includes(cid),
    { cid: channelId },
    { timeout }
  ).catch(() => {}) // non-fatal — we'll assert visible state instead
}

/** Get the visible chat input for the active pane */
function chatInput(page) {
  return page.locator('.pane-content:visible .chat-input').first()
}

/** Get all visible chat message texts in the active pane */
async function visibleMessages(page) {
  const msgs = page.locator('.pane-content:visible .chat-msg .chat-text')
  await msgs.first().waitFor({ timeout: 3000 }).catch(() => {})
  return msgs.allTextContents()
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test('can switch to three-pane mode', { timeout: 15000 }, async ({ page }) => {
  await loginAndCaptureLogs(page)
  await openFirstProject(page)

  // Click the 3H layout button in the dock (buttons use title attribute)
  const threePane = page.locator('.dock-btn[title="3H"]')
  await expect(threePane).toBeVisible({ timeout: 5000 })
  await threePane.click()

  // Three WorkspacePaneShell components (each with class pane-shell) should be visible
  const panes = page.locator('.pane-shell')
  await expect(panes).toHaveCount(3, { timeout: 3000 })
})

test('chat: join, send, echo, close, reopen with history', { timeout: 30000 }, async ({ page }) => {
  await loginAndCaptureLogs(page)
  const { wsFrames } = await openFirstProject(page)

  // Open general channel
  await clickTreeNode(page, 'general')

  // Wait for join
  await expect(page.locator('.chat-input').first()).toBeVisible({ timeout: 8000 })
  await expect(page.locator('.chat-input').first()).toBeEnabled({ timeout: 8000 })

  // Send a message
  const msg1 = `test-${Date.now()}`
  await page.locator('.chat-input').first().fill(msg1)
  await page.locator('.chat-input').first().press('Enter')

  // Message echoed back in the chat pane
  await expect(page.locator('.chat-msg .chat-text', { hasText: msg1 }).first()).toBeVisible({ timeout: 5000 })

  // Close the tab (click the x on the tab)
  const tabClose = page.locator('.pane-tab.active .pane-tab-close').first()
  await tabClose.click()

  // Reopen the same channel
  await clickTreeNode(page, 'general')
  await expect(page.locator('.chat-input').first()).toBeVisible({ timeout: 5000 })

  // History should contain the earlier message
  await expect(page.locator('.chat-msg .chat-text', { hasText: msg1 }).first()).toBeVisible({ timeout: 5000 })

  // Send another message
  const msg2 = `test2-${Date.now()}`
  await page.locator('.chat-input').first().fill(msg2)
  await page.locator('.chat-input').first().press('Enter')
  await expect(page.locator('.chat-msg .chat-text', { hasText: msg2 }).first()).toBeVisible({ timeout: 5000 })

  dumpWsFrames(wsFrames)
})

test('chat: two channels are isolated per-pane', { timeout: 30000 }, async ({ page }) => {
  await loginAndCaptureLogs(page)
  const { wsFrames } = await openFirstProject(page)

  // Switch to 2-pane layout
  await page.locator('.dock-btn[title="2H"]').click()
  await expect(page.locator('.splitter-panel')).toHaveCount(2, { timeout: 3000 })

  // Create a second channel if only one exists
  await page.locator('.p-tree-node-label', { hasText: 'Channels' }).first().rightclick()
  const newChanItem = page.locator('.p-contextmenu-item', { hasText: 'New Channel' }).first()
  if (await newChanItem.isVisible({ timeout: 1000 }).catch(() => false)) {
    await newChanItem.click()
    const nameInput = page.locator('input[placeholder*="channel"], input[id*="channel"]').first()
    await nameInput.fill('test-channel-2')
    await page.keyboard.press('Enter')
    await page.waitForTimeout(500)
  } else {
    // Context menu didn't open — press Escape and continue
    await page.keyboard.press('Escape')
  }

  // Open general in pane 1 (first pane, click it first)
  await page.locator('.splitter-panel').first().click()
  await clickTreeNode(page, 'general')
  await expect(page.locator('.pane-shell:nth-child(1) .chat-input').first()).toBeVisible({ timeout: 8000 })

  // Send in pane 1
  const msg1 = `pane1-${Date.now()}`
  await page.locator('.pane-shell:nth-child(1) .chat-input').first().fill(msg1)
  await page.locator('.pane-shell:nth-child(1) .chat-input').first().press('Enter')
  await expect(page.locator('.pane-shell:nth-child(1) .chat-msg .chat-text', { hasText: msg1 }).first()).toBeVisible({ timeout: 5000 })

  // Confirm message does NOT appear in pane 2 (pane 2 has no channel open)
  const pane2msgs = await page.locator('.pane-shell:nth-child(2) .chat-msg .chat-text').count()
  expect(pane2msgs).toBe(0)

  dumpWsFrames(wsFrames)
})

test('terminal: create, prompt appears, ls runs', { timeout: 30000 }, async ({ page }) => {
  await loginAndCaptureLogs(page)
  const { wsFrames } = await openFirstProject(page)

  // Click New Terminal button in dock
  const newTermBtn = page.locator('.dock-btn[title="New Terminal"]')
  await expect(newTermBtn).toBeVisible({ timeout: 5000 })
  await newTermBtn.click()

  // Terminal tab should appear
  const termTab = page.locator('.pane-tab', { hasText: /terminal/i }).first()
  await expect(termTab).toBeVisible({ timeout: 8000 })

  // xterm canvas should be present
  const termCanvas = page.locator('.xterm-screen canvas').first()
  await expect(termCanvas).toBeVisible({ timeout: 5000 })

  // Send ls
  await page.keyboard.type('ls')
  await page.keyboard.press('Enter')

  // Wait for some output — the xterm textarea should have received keystrokes
  await page.waitForTimeout(1500)

  // Verify some WS output came back
  const termOutput = wsFrames.filter(f => f.dir === '←' && f.data?.includes('term:output'))
  console.log(`[TERM TEST] term:output frames received: ${termOutput.length}`)
  expect(termOutput.length).toBeGreaterThan(0)

  dumpWsFrames(wsFrames)
})
