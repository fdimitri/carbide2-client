import authService from './authService'

// workspaceService — control-plane Workspace resource.
//
// A Workspace is a top-level, per-user namespace provisioned by the control
// plane (a dedicated workspace pod, ingress prefix, and storage). It is NOT
// a Project — Projects live inside a Workspace and are managed by the
// workspace pod via projectService.js.
//
// All calls here target the control-plane API at /api/workspaces, served by
// Api::WorkspacesController in carbide2-control.

export async function listWorkspaces() {
  const res = await authService.api.get('workspaces')
  return res.data
}

export async function getWorkspace(workspaceId) {
  const res = await authService.api.get(`workspaces/${workspaceId}`)
  return res.data
}

export async function createWorkspace(name, description = '') {
  const res = await authService.api.post('workspaces', { name, description })
  return res.data
}

export async function deleteWorkspace(workspaceId) {
  await authService.api.delete(`workspaces/${workspaceId}`)
}

// Mint a short-lived JWT scoped to a specific workspace pod. The SPA presents
// this to the workspace ingress when bootstrapping its session.
export async function getWorkspaceToken(workspaceId) {
  const res = await authService.api.post(`workspaces/${workspaceId}/token`, {})
  return res.data
}
