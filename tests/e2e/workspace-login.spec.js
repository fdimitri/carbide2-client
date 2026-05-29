// Playwright E2E: login flow via the workspace ingress.
//
// Prereq: a user with the credentials below must exist. The substrate
// orchestrator (scripts/test-substrate.sh) seeds it idempotently before
// invoking Playwright. For ad-hoc runs:
//   kubectl -n ws-1 exec deploy/ws-1 -c workspace -- \
//     bundle exec rails runner 'User.find_or_create_by!(email: "e2e@example.com") { |u| u.password = "password123" }'
import { test, expect } from '@playwright/test';

const BASE_URL = process.env.CARBIDE_WS_URL || 'http://localhost:8080/w/1';
const EMAIL    = process.env.CARBIDE_E2E_EMAIL    || 'e2e@example.com';
const PASSWORD = process.env.CARBIDE_E2E_PASSWORD || 'password123';

test.describe('Workspace login', () => {
  test('POST /api/login returns a JWT for valid credentials', async ({ request }) => {
    const resp = await request.post(`${BASE_URL}/api/login`, {
      data: { user: { email: EMAIL, password: PASSWORD } },
    });
    expect(resp.status(), await resp.text()).toBe(200);
    const body = await resp.json();
    expect(body.token, 'response missing token').toBeTruthy();
    // JWT = three base64url segments joined by dots.
    expect(body.token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  });

  test('POST /api/login rejects bad credentials', async ({ request }) => {
    const resp = await request.post(`${BASE_URL}/api/login`, {
      data: { user: { email: EMAIL, password: 'definitely-wrong' } },
    });
    expect(resp.status()).toBeGreaterThanOrEqual(400);
    expect(resp.status()).toBeLessThan(500);
  });

  test('SPA login form authenticates and lands on dashboard', async ({ page }) => {
    await page.goto(`${BASE_URL}/login`);
    await expect(page).toHaveURL(new RegExp(`${BASE_URL.replace(/[/.]/g, '\\$&')}/login$`));
    // Form should render with email + password fields.
    const email = page.getByLabel(/email/i).or(page.locator('input[type="email"]')).first();
    const password = page.getByLabel(/password/i).or(page.locator('input[type="password"]')).first();
    await email.fill(EMAIL);
    await password.fill(PASSWORD);
    // Submit via the visible button (label varies: "Log in", "Sign in", etc.).
    await page.getByRole('button', { name: /log\s*in|sign\s*in/i }).click();
    await page.waitForURL(/\/dashboard(\?|$)/, { timeout: 10_000 });
    expect(await page.evaluate(() => localStorage.getItem('auth_token'))).toBeTruthy();
  });
});
