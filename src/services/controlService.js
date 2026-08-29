import authService from './authService'

// controlService — control-plane inspection/edit endpoints (ADR-015).
// These hit the CONTROL API (same origin /api in control mode), not the
// workspace API. authService.api is scoped correctly by mode.

export async function getMe() {
  const res = await authService.api.get('v1/control/me')
  return res.data
}

export async function getUser(userId) {
  const res = await authService.api.get(`v1/users/${userId}`)
  return res.data
}

export async function listSettings() {
  const res = await authService.api.get('v1/settings')
  return res.data
}

export async function updateSetting(key, value) {
  const res = await authService.api.patch(`v1/settings/${encodeURIComponent(key)}`, { value })
  return res.data
}
