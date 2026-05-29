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

  test('GET / returns Rails welcome', async ({ page }) => {
    const resp = await page.goto(`${BASE_URL}/`);
    expect(resp.status()).toBe(200);
    const content = await page.content();
    expect(content).toContain('Ruby on Rails');
  });

  // Add more E2E checks as the UI/IDE is implemented
});