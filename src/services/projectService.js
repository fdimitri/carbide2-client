import authService from './authService'

// projectService — workspace-local Project resource.
//
// A Project lives inside a Workspace pod: it owns a file tree, chat channels,
// project settings, and per-project shells. Top-level Workspaces (the
// control-plane resource that provisions the pod itself) live in
// workspaceService.js — do NOT call those endpoints from here.
//
// All calls here use the shared authService.api instance, which already
// targets the workspace pod's API base and carries its bearer token.

export async function listProjects() {
  const res = await authService.api.get('projects')
  return res.data
}

export async function createProject(name, description = '') {
  const res = await authService.api.post('projects', { project: { name, description } })
  return res.data
}

export async function getWsToken(projectId) {
  const res = await authService.api.post(`projects/${projectId}/ws_token`, {})
  return res.data.token
}

export async function listChatChannels(projectId) {
  const res = await authService.api.get(`projects/${projectId}/chat_channels`)
  return res.data || []
}

export async function createChatChannel(projectId, name) {
  const res = await authService.api.post(
    `projects/${projectId}/chat_channels`,
    { chat_channel: { name } }
  )
  return res.data
}

export async function listChatMessages(projectId, channelId) {
  const res = await authService.api.get(
    `projects/${projectId}/chat_channels/${channelId}/chat_messages`
  )
  return res.data || []
}

export async function createChatMessage(projectId, channelId, text) {
  const res = await authService.api.post(
    `projects/${projectId}/chat_channels/${channelId}/chat_messages`,
    { chat_message: { text } }
  )
  return res.data
}

export async function getProjectSettings(projectId) {
  const res = await authService.api.get(`projects/${projectId}/settings`)
  return res.data
}

export async function updateProjectSettings(projectId, settings) {
  const res = await authService.api.patch(`projects/${projectId}/settings`, settings)
  return res.data
}

export async function setProjectRoot(projectId, rootPath, cleanVfs = false) {
  const res = await authService.api.patch(`projects/${projectId}/set_root`, {
    root_path: rootPath,
    clean_vfs: cleanVfs,
  })
  return res.data
}

// Upload a single file or archive (zip/tar/tar.gz) to a project's file tree.
// `file` is a browser File/Blob; `dest` defaults to the project root.
export async function uploadProjectFile(projectId, file, dest = '/') {
  const form = new FormData()
  form.append('file', file, file.name)
  form.append('dest', dest)
  // DO NOT set Content-Type manually here. axios + the browser auto-set
  // `multipart/form-data; boundary=…<random>` when the body is a FormData.
  // Setting `Content-Type: multipart/form-data` ourselves overrides that
  // header and drops the boundary, so Rails' Rack multipart parser can't
  // find the part separators and `params[:file]` arrives empty — which
  // created zero-byte DirectoryEntries with no FileChange. See #1 in
  // .github/May30-Questions.md.
  const res = await authService.api.post(
    `projects/${projectId}/fs/upload`,
    form,
  )
  return res.data
}

// Import the project's configured on-disk root_path into the DB tree.
// Pass `path` to override (must exist server-side).
export async function importProjectFromDisk(projectId, path = null) {
  const body = path ? { path } : {}
  const res = await authService.api.post(`projects/${projectId}/fs/import`, body)
  return res.data
}

// Fetch lightweight entry metadata (size, revisions, posix mode/owner, mtime…)
// for the explorer Properties panel. See #5 in May30-Questions.md.
export async function statProjectEntry(projectId, path) {
  const res = await authService.api.get(`projects/${projectId}/fs/stat`, {
    params: { path },
  })
  return res.data
}

// Fetch a binary blob (image, archive, etc.) from the on-disk VFS and return
// an object URL the caller can drop into <img src> or an <a download>. The
// caller is responsible for calling URL.revokeObjectURL when done.
// See #13 — binary entries live on disk, not in DB.
export async function fetchProjectBlob(projectId, path) {
  const res = await authService.api.get(`projects/${projectId}/fs/blob`, {
    params: { path },
    responseType: 'blob',
  })
  return URL.createObjectURL(res.data)
}

