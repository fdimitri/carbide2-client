// Playwright E2E smoke test for workspace substrate
import { test, expect } from '@playwright/test';

const BASE_URL = process.env.CARBIDE_WS_URL || 'http://localhost:8080/w/1';

test.describe('Workspace substrate', () => {
  test('GET /up returns 200', async ({ request }) => {
    const resp = await request.get(`${BASE_URL}/up`);
    expect(resp.status()).toBe(200);
    const body = await resp.text();
    expect(body).toContain('background-color: green');
  });

  test('GET / returns the Vue SPA shell', async ({ request }) => {
    const resp = await request.get(`${BASE_URL}/`);
    expect(resp.status()).toBe(200);
    const body = await resp.text();
    // SPA built into Rails public/ by the workspace Dockerfile.
    expect(body).toContain('Carbide2 IDE');
    expect(body).toMatch(/<div id="app">/);
    // Compiled asset bundle reference proves it's the built SPA, not the
    // Rails landing page fallback.
    expect(body).toMatch(/<script[^>]+src="\/assets\/index-[^"]+\.js"/);
  });
});
