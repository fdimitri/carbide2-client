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

  test('JWT from login authorises subsequent API calls', async ({ request }) => {
    // Obtain a token.
    const loginResp = await request.post(`${BASE_URL}/api/login`, {
      data: { user: { email: EMAIL, password: PASSWORD } },
    });
    expect(loginResp.status()).toBe(200);
    const { token } = await loginResp.json();

    // Use it against an authenticated endpoint.
    const prefResp = await request.get(`${BASE_URL}/api/preferences`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(prefResp.status(), await prefResp.text()).toBe(200);
    const prefs = await prefResp.json();
    expect(prefs).toBeDefined();
  });

  test('unauthenticated request to protected endpoint is rejected', async ({ request }) => {
    const resp = await request.get(`${BASE_URL}/api/preferences`);
    expect(resp.status()).toBeGreaterThanOrEqual(401);
    expect(resp.status()).toBeLessThan(500);
  });
});

