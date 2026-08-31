import authService from './authService'

// workspaceService — control-plane Workspace resource.
//
// A Workspace is a top-level, per-user namespace provisioned by the control
// plane (a dedicated workspace pod, ingress prefix, and storage). It is NOT
// a Project — Projects live inside a Workspace and are managed by the
// workspace pod via projectService.js.
//
// All calls here target the control-plane API at
// /api/v1/control/workspaces, served by Api::V1::Control::WorkspacesController
// in carbide2-control (relocated from /api/workspaces).

export async function listWorkspaces() {
  const res = await authService.api.get('v1/control/workspaces')
  return res.data
}

export async function getWorkspace(workspaceId) {
  const res = await authService.api.get(`v1/control/workspaces/${workspaceId}`)
  return res.data
}

export async function createWorkspace(name, description = '') {
  const res = await authService.api.post('v1/control/workspaces', { name, description })
  return res.data
}

export async function deleteWorkspace(workspaceId) {
  await authService.api.delete(`v1/control/workspaces/${workspaceId}`)
}

// Mint a short-lived JWT scoped to a specific workspace pod. The SPA presents
// this to the workspace ingress when bootstrapping its session.
export async function getWorkspaceToken(workspaceId) {
  const res = await authService.api.post(`v1/control/workspaces/${workspaceId}/token`, {})
  return res.data
}

// Active reachability probe for a workspace pod. Returns
// { id, phase, reachable: { rails, ws }, ok }. The control plane reaches the
// pod's in-cluster Service to check that Rails answers and the worker
// WebSocket upgrades — i.e. "is this workspace actually usable", not just
// "does Kubernetes think the pod exists".
export async function getWorkspaceHealth(workspaceId) {
  const res = await authService.api.get(`v1/control/workspaces/${workspaceId}/health`)
  return res.data
}

// ── ADR-025: patch / roll / templates / registry ──────────────────────────

// Patch a workspace's patchable CR spec fields (resources or image tag).
export async function patchWorkspace(workspaceId, patch) {
  const res = await authService.api.patch(`v1/control/workspaces/${workspaceId}`, patch)
  return res.data
}

// Restart a workspace's pod (explicit, disruptive).
export async function rollWorkspace(workspaceId) {
  const res = await authService.api.post(`v1/control/workspaces/${workspaceId}/roll`)
  return res.data
}

// Seeded resource templates (ADR-016 presets).
export async function listTemplates() {
  const res = await authService.api.get('v1/control/workspace-templates')
  return res.data
}

// Available registry images. Returns 503 when no registry is configured.
export async function listRegistryImages() {
  const res = await authService.api.get('v1/control/registry/images')
  return res.data
}

// Re-export the control-plane mint (ADR-023) for existing importers.
export { mintWorkspaceToken } from './workspaceToken'

