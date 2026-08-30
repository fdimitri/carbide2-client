import axios from 'axios'
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

// ── Passkeys (ADR-021) ────────────────────────────────────────────────

// List this user's registered passkeys.
export async function listPasskeys() {
  const res = await authService.api.get('v1/webauthn/credentials')
  return res.data
}

// Begin registration: server returns { challenge, options }. `options` is the
// PublicKeyCredentialCreationOptions JSON the browser's navigator.credentials
// needs. We only decode base64url fields into ArrayBuffers client-side.
export async function beginPasskeyRegistration() {
  const res = await authService.api.post('v1/webauthn/registration/begin', {})
  return res.data
}

// Complete registration: send the credential the authenticator produced, plus
// the top-level nickname the server persists.
export async function completePasskeyRegistration(challenge, credential, nickname) {
  const res = await authService.api.post('v1/webauthn/registration/complete', {
    challenge,
    credential,
    nickname
  })
  return res.data
}

// Remove a passkey by id.
export async function removePasskey(id) {
  await authService.api.delete(`v1/webauthn/credentials/${encodeURIComponent(id)}`)
}

// Begin passkey assertion for a given email (username-first, non-resident).
export async function beginPasskeyAssertion(email) {
  const res = await axios.post(`${window.location.origin}/api/v1/webauthn/assertion/begin`, { email })
  return res.data
}

// Complete passkey assertion; returns { token, user } on success.
export async function completePasskeyAssertion(email, challenge, credential) {
  const res = await axios.post(`${window.location.origin}/api/v1/webauthn/assertion/complete`, {
    email,
    challenge,
    credential
  })
  return res.data
}
