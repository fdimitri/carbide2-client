// helpers/session.js — shared login + project-open helpers for all e2e scripts.
import { expect } from '@playwright/test'

const BASE = 'http://localhost:5173'
const EMAIL = 'dev@example.com'
const PASSWORD = 'password'

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
  await page.waitForURL('**/dashboard', { timeout: 10000 })
}

/**
 * Open the first project listed on the dashboard, wait for ProjectPage to mount.
 * Returns after system:connected is logged (i.e. WS is live).
 */
export async function openFirstProject(page) {
  // Wait for at least one project card to appear
  const card = page.locator('.project-card').first()
  await expect(card).toBeVisible({ timeout: 10000 })

  // Capture WS frames
  const wsFrames = []
  page.on('websocket', ws => {
    ws.on('framesent', f => wsFrames.push({ dir: '→', data: f.payload }))
    ws.on('framereceived', f => wsFrames.push({ dir: '←', data: f.payload }))
  })

  await card.click()
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
