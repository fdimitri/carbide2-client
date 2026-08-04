import { ref, computed } from 'vue'
import { VERSION, BUILD_META } from '../version'
import authService from '../services/authService'

// Version label composition.
//
// The client bakes only its OWN build SHA (it *is* the client build). The
// server/worker/control/meta SHAs are unknowable at client build time — the
// shell is de-baked from the pod image and served from the static tier — so we
// fetch them at runtime from /api/v1/common/version, a public endpoint both the
// workspace server and the control plane implement identically. The label then
// merges the baked client SHA with the live backend provenance.

const backend = ref(null)
let started = false

function shortSha(sha) {
  return typeof sha === 'string' ? sha.slice(0, 7) : ''
}

async function loadBackendVersion() {
  if (started) return
  started = true
  try {
    const res = await authService.api.get('v1/common/version')
    backend.value = res.data
  } catch {
    // Provenance is cosmetic; on failure we just show the baked-only label.
    backend.value = null
  }
}

const versionLabel = computed(() => {
  const parts = []
  const push = (name, sha) => {
    const short = shortSha(sha)
    if (short) parts.push(`${name}:${short}`)
  }
  push('client', BUILD_META.clientSha)
  const comp = backend.value?.components || {}
  push('meta', comp.meta)
  push('server', comp.server)
  push('worker', comp.worker)
  push('control', comp.control)
  return parts.length ? `v${VERSION} (${parts.join(' ')})` : `v${VERSION}`
})

// Reactive version label that starts from the baked client SHA and fills in the
// backend SHAs once /api/v1/common/version resolves.
export function useVersionLabel() {
  loadBackendVersion()
  return { versionLabel }
}
