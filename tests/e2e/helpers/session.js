// helpers/session.js — shared login + project-open helpers for all e2e scripts.
import { expect } from '@playwright/test'

// When running against the k3d cluster set:
//   CARBIDE_WS_URL=http://localhost:8080/w/2
//   CARBIDE_E2E_EMAIL=e2e@example.com
//   CARBIDE_E2E_PASSWORD=password123
// Default to the local Vite dev server.
const BASE = process.env.CARBIDE_WS_URL || 'http://localhost:5173'
const EMAIL = process.env.CARBIDE_E2E_EMAIL || 'test@example.com'
const PASSWORD = process.env.CARBIDE_E2E_PASSWORD || 'password123'

/**
 * Log in and navigate to the dashboard.
 * Attaches a console listener that prints all browser logs to stdout.
 */
export async function loginAndCaptureLogs(page) {
  // Enable full logging bitmask before any navigation
  await page.addInitScript(() => {
    localStorage.setItem('carbide_log', '255')
  })

  // Mirror browser console to the terminal so we can read it
  page.on('console', msg => {
    const type = msg.type().toUpperCase().padEnd(5)
    console.log(`[BROWSER ${type}] ${msg.text()}`)
  })
  page.on('pageerror', err => {
    console.error(`[BROWSER ERROR] ${err.message}`)
  })

  await page.goto(`${BASE}/login`)
  await page.fill('#email', EMAIL)
  await page.fill('#password', PASSWORD)
  await page.click('button[type=submit]')
  // Model B: in workspace mode the router redirects /dashboard straight to
  // the pod's single canonical project IDE, so the URL may settle on either
  // /dashboard (control mode) or /projects/<id> (workspace mode).
  await page.waitForURL(
    (url) => /\/(dashboard|projects)(\/|$)/.test(new URL(url).pathname),
    { timeout: 10000 },
  )
}

/**
 * Ensure ProjectPage is mounted. In workspace mode (Model B) the pod already
 * auto-opened its single project, so this just sets up WS capture. In control
 * mode it clicks the first project card. Waits until the IDE is live.
 */
export async function openFirstProject(page) {
  // Capture WS frames
  const wsFrames = []
  page.on('websocket', ws => {
    ws.on('framesent', f => wsFrames.push({ dir: '→', data: f.payload }))
    ws.on('framereceived', f => wsFrames.push({ dir: '←', data: f.payload }))
  })

  if (!/\/projects(\/|$)/.test(new URL(page.url()).pathname)) {
    // Control mode: a project card is present; click it.
    const card = page.locator('div.cursor-pointer h3').first()
    await expect(card).toBeVisible({ timeout: 10000 })
    await card.click()
  }

  await page.waitForURL('**/projects/**', { timeout: 10000 })

  // Give the WS a moment to connect and receive system:connected + term:list
  await page.waitForTimeout(1500)

  return { wsFrames }
}

/**
 * Dump collected WS frames to stdout.
 */
export function dumpWsFrames(wsFrames) {
  if (!wsFrames.length) { console.log('[WS] No frames captured'); return }
  console.log(`\n[WS FRAMES] ${wsFrames.length} total:`)
  for (const f of wsFrames) {
    let payload = f.data
    try { payload = JSON.stringify(JSON.parse(f.data), null, 0) } catch (_) { /* binary/non-json */ }
    console.log(`  ${f.dir} ${payload}`)
  }
}
