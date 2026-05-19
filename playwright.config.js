// Playwright config for carbide2-client diagnostic scripts.
// Assumes: Rails on :3000, Vite dev on :5173, worker on :8080.
import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 20000,
  use: {
    baseURL: 'http://localhost:5173',
    headless: true,
    // Capture console + WS frames for every test
    // (individual scripts also attach listeners manually)
  },
  reporter: [['list'], ['json', { outputFile: '/tmp/carbide2-playwright.json' }]],
})
