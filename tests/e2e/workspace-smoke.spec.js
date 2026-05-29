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

  test('GET / returns Vue SPA shell', async ({ request }) => {
    const resp = await request.get(`${BASE_URL}/`);
    expect(resp.status()).toBe(200);
    const body = await resp.text();
    expect(body).toContain('Carbide2 IDE');
    expect(body).toMatch(/<div id="app">/);
  });

  // Add more E2E checks as the UI/IDE is implemented
});