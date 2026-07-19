import authService from './authService'

// clientService — enumerate the SPA client builds this pod can serve and
// switch between them.
//
// The Decider: the client shell is NOT baked into the pod image. It lives in a
// content-addressed static tier and the pod's loader (SpaController) resolves a
// *pinned* build per full page load. `GET /api/clients` lists what's available;
// selecting one is done by reloading with `?client=<family>@<sha>`, which the
// loader resolves and pins in the `carbide_client` cookie. We NEVER hot-swap
// the running bundle — resolve-once-per-load is the invariant, so switching is
// always a full navigation.

const CLIENT_COOKIE = 'carbide_client'

// The build currently pinned for this browser, as "<family>@<sha>", or null.
// The loader writes this cookie (non-HttpOnly) on every render.
export function currentPin() {
  if (typeof document === 'undefined') return null
  const m = document.cookie.match(/(?:^|;\s*)carbide_client=([^;]+)/)
  return m ? decodeURIComponent(m[1]) : null
}

// { default: "<family>", families: [{ name, default_sha, builds: [...] }] }
export async function listClients() {
  const res = await authService.api.get('clients')
  return res.data
}

// Full-reload onto the given build. Preserves the current path/hash and drops
// any prior `?client=` param.
export function switchTo(family, sha) {
  const url = new URL(window.location.href)
  url.searchParams.set('client', `${family}@${sha}`)
  window.location.assign(url.toString())
}

export { CLIENT_COOKIE }
