import axios from 'axios'

// workspaceToken — mint workspace JWTs from the control plane (ADR-023).
// Shared by authService (workspace:api for REST) and workerSocket's caller
// (workspace:rw for WS) without either importing the other.

// Parse the control-plane workspace id from the page's base href (/w/<id>/),
// injected by the workspace loader from X-Forwarded-Prefix. This is the
// control-plane id (WORKSPACE_PROJECT_ID), NOT the local canonical project id.
function workspaceIdFromBase() {
  if (typeof document === 'undefined') return null
  const baseHref = document.querySelector('base')?.getAttribute('href') || ''
  const m = baseHref.match(/\/w\/(\d+)\/?/)
  return m ? m[1] : null
}

// Mint a workspace JWT for the requested scope. The workspace client holds the
// control bearer in localStorage and must ask control directly.
export async function mintWorkspaceToken(scope) {
  const workspaceId = workspaceIdFromBase()
  if (!workspaceId) {
    throw Object.assign(new Error('workspace id not found in base href'), { status: 400 })
  }
  const controlToken = localStorage.getItem('control_auth_token')
  if (!controlToken) {
    throw Object.assign(new Error('missing control_auth_token'), { status: 401 })
  }
  const res = await axios.post(
    `${window.location.origin}/api/workspaces/${workspaceId}/token`,
    { scope },
    { headers: { Authorization: `Bearer ${controlToken}` }, withCredentials: true }
  )
  return res.data.token
}

// Decode a JWT payload (no signature verification — these are already-issued
// tokens we just need to read claims from). Returns the payload hash or null.
function decodeJwtPayload(token) {
  try {
    const part = token.split('.')[1]
    if (!part) return null
    const base64 = part.replace(/-/g, '+').replace(/_/g, '/')
    const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=')
    return JSON.parse(atob(padded))
  } catch {
    return null
  }
}

// Decode the exp claim (unix seconds) from a JWT, or null.
export function tokenExpirySeconds(token) {
  const payload = decodeJwtPayload(token)
  return payload && typeof payload.exp === 'number' ? payload.exp : null
}

// Lifetime of a JWT in seconds (exp - iat), or null. The re-mint lead is a
// fraction of this, so a token is refreshed before it expires regardless of
// how long its TTL is.
export function tokenTtlSeconds(token) {
  const payload = decodeJwtPayload(token)
  if (!payload || typeof payload.exp !== 'number' || typeof payload.iat !== 'number') return null
  return payload.exp - payload.iat
}
