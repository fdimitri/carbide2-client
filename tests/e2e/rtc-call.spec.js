// tests/e2e/rtc-call.spec.js
// Two-user WebRTC call in a shared chat channel.
//
// Verifies the full path: both peers join the same channel, start a call, and
// each receives the other's live video stream (fake camera frames flowing).
//
// Run against the cluster with two distinct project members:
//   CARBIDE_WS_URL=http://localhost:8080/w/10 \
//   npx playwright test tests/e2e/rtc-call.spec.js --reporter=list
import { test, expect } from '@playwright/test'

const BASE = process.env.CARBIDE_WS_URL || 'http://localhost:8080/w/10'
// The dev workspace pod is single-identity, so both tabs log in as the same
// user. Peers are addressed by a per-connection peer_id, so one user joining
// from two tabs is a valid two-peer call (and the case multi-device support
// must handle).
const USER_A = process.env.RTC_USER_A || 'test@example.com'
const USER_B = process.env.RTC_USER_B || 'test@example.com'
const PASSWORD = process.env.CARBIDE_E2E_PASSWORD || 'password123'

// Fake camera/mic + auto-grant permission so getUserMedia resolves headless.
test.use({
  launchOptions: {
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
  },
})

async function loginAndOpenChannel(page, email) {
  const rtcFrames = []
  page.on('websocket', ws => {
    ws.on('framesent', f => { try { const m = JSON.parse(f.payload); if (m.cs === 'rtc') rtcFrames.push(['→', m.cmd]) } catch {} })
    ws.on('framereceived', f => { try { const m = JSON.parse(f.payload); if (m.cs === 'rtc') rtcFrames.push(['←', m.cmd]) } catch {} })
  })

  await page.goto(`${BASE}/login`)
  await page.fill('#email', email)
  await page.fill('#password', PASSWORD)
  await page.click('button[type=submit]')
  // May land on /dashboard (control mode) or /projects/<id> (workspace mode).
  await page.waitForURL(
    (url) => /\/(dashboard|projects)(\/|$)/.test(new URL(url).pathname),
    { timeout: 15000 },
  )
  if (!/\/projects(\/|$)/.test(new URL(page.url()).pathname)) {
    await page.locator('div.cursor-pointer h3').first().click()
    await page.waitForURL('**/projects/**', { timeout: 15000 })
  }
  await page.waitForTimeout(1500)

  // Open the 'general' channel (auto-joins chat).
  await page.locator('.p-tree-node-label', { hasText: 'general' }).first().click()
  // Wait for the call bar's Start call button to become enabled (chat joined).
  await expect(page.locator('button', { hasText: 'Start call' }).first()).toBeEnabled({ timeout: 10000 })
  return rtcFrames
}

async function startCall(page) {
  await page.locator('button', { hasText: 'Start call' }).first().click()
  // Local tile should appear (You).
  await expect(page.locator('video').first()).toBeVisible({ timeout: 10000 })
}

// Count call-strip videos that are actually rendering frames.
async function liveRemoteVideoCount(page) {
  return page.evaluate(() => {
    const vids = [...document.querySelectorAll('video')]
    // The first is the local "You" tile; remotes are the rest.
    return vids.slice(1).filter(v => v.videoWidth > 0 && v.readyState >= 2).length
  })
}

test('two users see each other on a channel call', { timeout: 60000 }, async ({ browser }) => {
  const ctxA = await browser.newContext()
  const ctxB = await browser.newContext()
  const pageA = await ctxA.newPage()
  const pageB = await ctxB.newPage()

  const framesA = await loginAndOpenChannel(pageA, USER_A)
  const framesB = await loginAndOpenChannel(pageB, USER_B)

  // A starts first, then B (B becomes the offerer toward A).
  await startCall(pageA)
  await pageA.waitForTimeout(500)
  await startCall(pageB)

  // Allow ICE/DTLS to complete and frames to flow.
  await expect.poll(() => liveRemoteVideoCount(pageA), { timeout: 25000 }).toBeGreaterThan(0)
  await expect.poll(() => liveRemoteVideoCount(pageB), { timeout: 25000 }).toBeGreaterThan(0)

  console.log('[RTC A frames]', JSON.stringify(framesA))
  console.log('[RTC B frames]', JSON.stringify(framesB))

  // Sanity: B (newcomer) should have sent an offer; A should have received one.
  expect(framesB.some(([d, c]) => d === '→' && c === 'signal')).toBeTruthy()

  await ctxA.close()
  await ctxB.close()
})
