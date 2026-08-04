// tests/e2e/reconnect.spec.js
// Foundational reconnect test — the prerequisite for session *resume*.
//
// Session resume (ADR-002) is a strict superset of "reconnect correctly": if a
// dropped socket doesn't re-bind its ephemeral per-socket subscriptions
// (TERMINALS / CHAT_ROOMS / OPEN_DOCUMENTS on the worker), resuming a whole
// layout on top of that will inherit the same bug. So we pin the reconnect
// behaviour first.
//
// What this exercises:
//   1. Open a terminal + a chat channel and confirm they're live.
//   2. Drop the network (Playwright offline) so the worker socket closes.
//   3. Restore the network and let WorkerSocket's backoff reconnect.
//   4. Assert a NEW worker socket is established (system/connected re-emitted).
//   5. Assert chat re-joins and still echoes (useChat replays desiredChannels
//      on 'system','connected' — this path is expected to work).
//   6. Assert the terminal still receives output after reconnect. This is the
//      historically UNTESTED path: the worker's TERMINALS registry is keyed by
//      the *socket*, so a reconnect must re-attach. A failure here is a real
//      finding, not a flaky test — see ADR-002 "Open risks".
//
// Run against a live stack (no standalone target yet — see carbide2#38):
//   CARBIDE_WS_URL=http://localhost:8080/w/10 \
//   CARBIDE_E2E_EMAIL=... CARBIDE_E2E_PASSWORD=... \
//   npx playwright test tests/e2e/reconnect.spec.js --reporter=list
//
import { test, expect } from '@playwright/test'
import { loginAndCaptureLogs } from './helpers/session.js'

// ── Socket tracking ─────────────────────────────────────────────────────────
// A reconnect creates a brand-new WebSocket object, so counting worker sockets
// is the cleanest signal that reconnection actually happened. We keep per-socket
// frame logs + open/close timestamps so assertions can be scoped to "after the
// drop".

/** Only the worker socket carries a `token=` query param; ignore Vite HMR ws. */
function isWorkerSocket(url) {
  return /[?&]token=/.test(url)
}

function trackWorkerSockets(page) {
  const sockets = []
  page.on('websocket', (ws) => {
    if (!isWorkerSocket(ws.url())) return
    const rec = { url: ws.url(), openedAt: Date.now(), closedAt: null, frames: [] }
    sockets.push(rec)
    ws.on('framesent', (f) => rec.frames.push({ dir: '→', data: f.payload, t: Date.now() }))
    ws.on('framereceived', (f) => rec.frames.push({ dir: '←', data: f.payload, t: Date.now() }))
    ws.on('close', () => { rec.closedAt = Date.now() })
  })
  return sockets
}

/** Wait until at least `n` worker sockets have been observed. */
async function waitForSocketCount(page, sockets, n, { timeout = 20000 } = {}) {
  await expect
    .poll(() => sockets.length, { timeout, message: `expected ${n} worker sockets` })
    .toBeGreaterThanOrEqual(n)
}

/** Did `socket` receive a system/connected frame after `sinceMs`? */
function sawConnectedAfter(socket, sinceMs = 0) {
  return socket.frames.some((f) => {
    if (f.dir !== '←' || f.t < sinceMs) return false
    try { const m = JSON.parse(f.data); return m.cs === 'system' && m.cmd === 'connected' }
    catch { return false }
  })
}

/** Count term/output frames received on `socket` after `sinceMs`. */
function termOutputCount(socket, sinceMs = 0) {
  return socket.frames.filter((f) => {
    if (f.dir !== '←' || f.t < sinceMs) return false
    try { const m = JSON.parse(f.data); return m.cs === 'term' && m.cmd === 'output' }
    catch { return false }
  }).length
}

// ── The test ────────────────────────────────────────────────────────────────

test('reconnect: surfaces re-bind after a socket drop', { timeout: 90000 }, async ({ page }) => {
  const sockets = trackWorkerSockets(page)

  await loginAndCaptureLogs(page)

  // ProjectPage auto-opens the pod's canonical project in workspace mode. Wait
  // for the first worker socket to connect.
  await page.waitForURL('**/projects/**', { timeout: 15000 })
  await waitForSocketCount(page, sockets, 1)
  await expect
    .poll(() => sawConnectedAfter(sockets[0]), { timeout: 15000 })
    .toBe(true)

  // ── 1. Open a terminal and prove it's live ────────────────────────────────
  const newTermBtn = page.locator('.dock-btn[title="New Terminal"]')
  await expect(newTermBtn).toBeVisible({ timeout: 8000 })
  await newTermBtn.click()
  await expect(page.locator('.pane-tab', { hasText: /bash|terminal/i }).first())
    .toBeVisible({ timeout: 8000 })
  await expect(page.locator('.terminal-pane__container .xterm-viewport').first())
    .toBeVisible({ timeout: 8000 })

  await page.keyboard.type('echo pre-drop')
  await page.keyboard.press('Enter')
  await expect
    .poll(() => termOutputCount(sockets[0]), { timeout: 8000 })
    .toBeGreaterThan(0)

  // ── 2. Open general chat and prove it echoes ──────────────────────────────
  const generalNode = page.locator('.p-tree-node-label', { hasText: 'general' }).first()
  await expect(generalNode).toBeVisible({ timeout: 8000 })
  await generalNode.click()
  await expect(page.locator('.chat-input').first()).toBeEnabled({ timeout: 8000 })

  const preMsg = `pre-drop-${Date.now()}`
  await page.locator('.chat-input').first().fill(preMsg)
  await page.locator('.chat-input').first().press('Enter')
  await expect(page.locator('.chat-msg .chat-text', { hasText: preMsg }).first())
    .toBeVisible({ timeout: 8000 })

  // ── 3. Drop the network → worker socket must close ────────────────────────
  const dropAt = Date.now()
  await page.context().setOffline(true)
  await expect
    .poll(() => sockets[0].closedAt !== null, { timeout: 15000, message: 'socket did not close' })
    .toBe(true)

  // ── 4. Restore the network → WorkerSocket backoff reconnects ──────────────
  await page.context().setOffline(false)
  await waitForSocketCount(page, sockets, 2, { timeout: 30000 })
  const reconnected = sockets[sockets.length - 1]
  await expect
    .poll(() => sawConnectedAfter(reconnected, dropAt), { timeout: 20000 })
    .toBe(true)

  // ── 5. Chat must re-join and still echo (expected to pass) ────────────────
  // useChat replays desiredChannels on 'system','connected'.
  await expect(page.locator('.chat-input').first()).toBeEnabled({ timeout: 15000 })
  const postMsg = `post-drop-${Date.now()}`
  await page.locator('.chat-input').first().fill(postMsg)
  await page.locator('.chat-input').first().press('Enter')
  await expect(page.locator('.chat-msg .chat-text', { hasText: postMsg }).first())
    .toBeVisible({ timeout: 10000 })

  // ── 6. Terminal must still receive output after reconnect ─────────────────
  // The worker's TERMINALS registry is keyed by socket; a reconnect has to
  // re-attach the PTY. This is the untested path (ADR-002 open risks) — a
  // failure here is a genuine finding about the reconnect story, not flake.
  const reconnectAt = Date.now()
  await page.locator('.terminal-pane__container .xterm-viewport').first().click()
  await page.keyboard.type('echo post-drop')
  await page.keyboard.press('Enter')
  await expect
    .poll(() => termOutputCount(reconnected, reconnectAt), {
      timeout: 12000,
      message: 'terminal produced no output after reconnect — PTY did not re-attach',
    })
    .toBeGreaterThan(0)
})
