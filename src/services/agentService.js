import authService from './authService'

// agentService — workspace-global Agent personas.
//
// Agents are not project-scoped: one Agents table per workspace pod, shared
// across all projects. The worker's AgentSession reads these rows by slug;
// this REST surface lets an admin repoint provider_url/model, toggle tools,
// or enable/disable an agent at runtime without re-seeding or redeploying.
//
// All calls use the shared authService.api instance (workspace API base +
// bearer token already configured).

export async function listAgents() {
  const res = await authService.api.get('agents')
  return res.data || []
}

export async function getAgent(id) {
  const res = await authService.api.get(`agents/${id}`)
  return res.data
}

// `patch` is a partial agent payload. api_key is only sent when non-blank
// (the server preserves the stored key when the field is omitted/empty).
export async function updateAgent(id, patch) {
  const res = await authService.api.patch(`agents/${id}`, patch)
  return res.data
}
