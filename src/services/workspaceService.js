import axios from 'axios'
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

// Active reachability probe for a workspace pod. Returns
// { id, phase, reachable: { rails, ws }, ok }. The control plane reaches the
// pod's in-cluster Service to check that Rails answers and the worker
// WebSocket upgrades — i.e. "is this workspace actually usable", not just
// "does Kubernetes think the pod exists".
export async function getWorkspaceHealth(workspaceId) {
  const res = await authService.api.get(`workspaces/${workspaceId}/health`)
  return res.data
}

// Parse the control-plane workspace id from the page's base href (/w/<id>/),
// injected by the workspace loader from X-Forwarded-Prefix. This is the
// control-plane id (WORKSPACE_PROJECT_ID), NOT the local canonical project id.
function workspaceIdFromBase() {
  if (typeof document === 'undefined') return null
  const baseHref = document.querySelector('base')?.getAttribute('href') || ''
  const m = baseHref.match(/\/w\/(\d+)\/?/)
  return m ? m[1] : null
}

// Mint a worker JWT from the control plane (ADR-023). The workspace client
// holds the control bearer in localStorage and must ask control directly —
// authService.api is workspace-scoped and cannot reach control.
export async function mintWorkerToken() {
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
    {},
    { headers: { Authorization: `Bearer ${controlToken}` }, withCredentials: true }
  )
  return res.data.token
}
