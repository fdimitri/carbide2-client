// Playwright E2E: login flow via the workspace ingress.
//
// Prereq: a user with the credentials below must exist. The substrate
// orchestrator (scripts/test-substrate.sh) seeds it idempotently before
// invoking Playwright. For ad-hoc runs:
//   kubectl -n ws-1 exec deploy/ws-1 -c workspace -- \
//     bundle exec rails runner 'User.find_or_create_by!(email: "e2e@example.com") { |u| u.password = "password123" }'
import { test, expect } from '@playwright/test';

const BASE_URL = process.env.CARBIDE_WS_URL || 'http://localhost:8080/w/1';
const CONTROL_URL = 'http://localhost:8080';
const EMAIL    = process.env.CARBIDE_E2E_EMAIL    || 'test@example.com';
const PASSWORD = process.env.CARBIDE_E2E_PASSWORD || 'password123';

test.describe('Workspace login', () => {
  test('control login then workspace token exchange returns a JWT', async ({ request }) => {
    const controlResp = await request.post(`${CONTROL_URL}/api/login`, {
      data: { user: { email: EMAIL, password: PASSWORD } },
    });
    expect(controlResp.status(), await controlResp.text()).toBe(200);
    const controlBody = await controlResp.json();
    expect(controlBody.token, 'control response missing token').toBeTruthy();

    const resp = await request.post(`${BASE_URL}/api/login`, {
      headers: { Authorization: `Bearer ${controlBody.token}` },
    });
    expect(resp.status(), await resp.text()).toBe(200);
    const body = await resp.json();
    expect(body.token, 'workspace response missing token').toBeTruthy();
    // JWT = three base64url segments joined by dots.
    expect(body.token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  });

  test('control login rejects bad credentials', async ({ request }) => {
    const resp = await request.post(`${CONTROL_URL}/api/login`, {
      data: { user: { email: EMAIL, password: 'definitely-wrong' } },
    });
    expect(resp.status()).toBeGreaterThanOrEqual(400);
    expect(resp.status()).toBeLessThan(500);
  });

  test('JWT from login authorises subsequent API calls', async ({ request }) => {
    const controlResp = await request.post(`${CONTROL_URL}/api/login`, {
      data: { user: { email: EMAIL, password: PASSWORD } },
    });
    expect(controlResp.status()).toBe(200);
    const { token: controlToken } = await controlResp.json();

    const loginResp = await request.post(`${BASE_URL}/api/login`, {
      headers: { Authorization: `Bearer ${controlToken}` },
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

