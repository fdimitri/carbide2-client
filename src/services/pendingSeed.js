// pendingSeed.js — bridges a "seed method" chosen on the control-plane create
// form to the workspace pod's IDE, which performs the actual seeding once it
// boots.
//
// Why localStorage: the control plane and every workspace pod are served from
// the SAME browser origin (e.g. localhost:8080) under different base paths
// (/w/<id>/). localStorage is origin-scoped, so a marker written while on the
// control dashboard survives the cross-path redirect into /w/<id>/. We key by
// the pod's base path so each pod only consumes its own pending seed.

const PREFIX = 'carbide_pending_seed:'

function normalizeScope(scope) {
  return scope.endsWith('/') ? scope : `${scope}/`
}

function keyFor(scope) {
  return `${PREFIX}${normalizeScope(scope)}`
}

// The base path of the page currently being served (e.g. "/w/10/"). Mirrors
// authService.workspaceScope() so the pod reads the same key the control form
// wrote.
export function currentScope() {
  let base = '/'
  if (typeof document !== 'undefined') {
    const baseHref = document.querySelector('base')?.getAttribute('href')
    if (baseHref) base = new URL(baseHref, window.location.origin).pathname
  }
  if (base === '/') base = import.meta.env.BASE_URL || '/'
  return normalizeScope(base)
}

// Record a seed to run when the pod at `scope` (e.g. "/w/10/") first opens.
// `seed` is { method: 'git', gitUrl, gitRef }.
export function setPendingSeed(scope, seed) {
  try {
    localStorage.setItem(keyFor(scope), JSON.stringify(seed))
  } catch (_e) { /* storage unavailable — seed silently skipped */ }
}

// Atomically read AND clear the pending seed for `scope`, returning it (or
// null). Clearing on read makes the seed fire at most once.
export function takePendingSeed(scope) {
  try {
    const key = keyFor(scope)
    const raw = localStorage.getItem(key)
    if (!raw) return null
    localStorage.removeItem(key)
    return JSON.parse(raw)
  } catch (_e) {
    return null
  }
}
