// Runtime/build-time mode detection.
//
// The SAME client build is served in two contexts:
//
//   - workspace mode: served from inside a workspace pod under
//     /w/<projectId>/ by carbide2-server. BASE_URL is /w/<id>/.
//     The full IDE (editor, terminal, chat, file tree) is enabled.
//
//   - control mode: served from carbide2-control Rails as the dashboard.
//     BASE_URL is / (root). Only the auth + project-list views are useful;
//     clicking a project navigates to /w/<id>/ (cross-origin to the
//     workspace pod via Traefik).
//
// Detection order:
//   1. Build-time env VITE_CARBIDE_MODE=control|workspace (preferred).
//   2. Fallback at runtime: BASE_URL of /w/ → workspace, else control.

const envMode = import.meta.env.VITE_CARBIDE_MODE

function detectRuntime() {
  const base = import.meta.env.BASE_URL || '/'
  return base.startsWith('/w/') ? 'workspace' : 'control'
}

export const mode = envMode || detectRuntime()
export const isControlMode = mode === 'control'
export const isWorkspaceMode = mode === 'workspace'
