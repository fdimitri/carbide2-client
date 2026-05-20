import authService from './authService'

// All project API calls use the shared authService.api instance, which carries
// the Authorization header and targets the correct host (handles WSL bridging).

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
