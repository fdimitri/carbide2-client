// useAgents — talk to worker-side LLM agents over the existing WS.
//
// Wire format (worker/worker.rb handle_agent + worker/agent_session.rb):
//   send: {cs:'agent', cmd:'list',    payload:{}}
//   send: {cs:'agent', cmd:'ask',     payload:{agent_slug, message, conversation_id?}}
//   recv: {cs:'agent', cmd:'list',         payload:{agents:[…]}}
//   recv: {cs:'agent', cmd:'started',      payload:{conversation_id, agent}}
//   recv: {cs:'agent', cmd:'tool_call',    payload:{tool, args, call_id, conversation_id, agent}}
//   recv: {cs:'agent', cmd:'tool_result',  payload:{tool, call_id, result, conversation_id, agent}}
//   recv: {cs:'agent', cmd:'done',         payload:{content, turn, conversation_id, agent}}
//   recv: {cs:'agent', cmd:'error',        payload:{message, conversation_id?, agent?}}
//
// MVP: one conversation per project. To support multiple, key state by
// conversation_id and add a tab-per-conversation.
import { storeToRefs } from 'pinia'
import workerSocket from '../services/workerSocket'
import { useWorkspaceStore } from '../stores/workspaceStore'

export function useAgents({ error, bindTabToActivePane }) {
  const store = useWorkspaceStore()
  const {
    agentList, agentSelectedSlug, agentConversationId,
    agentMessages, agentStatus,
  } = storeToRefs(store)

  function openAgentPane() {
    bindTabToActivePane('agent', 0, 'Agent')
    // Refresh list each time the pane is opened (cheap, helps if admin
    // toggled an agent's enabled flag mid-session).
    workerSocket.send('agent', 'list', {})
  }

  function selectAgent(slug) {
    if (slug === agentSelectedSlug.value) return
    agentSelectedSlug.value = slug
    // New agent = new conversation. Worker will assign a fresh id.
    resetConversation()
  }

  function resetConversation() {
    agentConversationId.value = null
    agentMessages.value = []
    agentStatus.value = 'idle'
  }

  function send(text) {
    const trimmed = (text || '').trim()
    if (!trimmed) return
    const slug = agentSelectedSlug.value
    if (!slug) {
      error.value = 'Pick an agent first.'
      return
    }
    agentMessages.value.push({ kind: 'user', text: trimmed })
    agentStatus.value = 'thinking'
    const payload = { agent_slug: slug, message: trimmed }
    if (agentConversationId.value) payload.conversation_id = agentConversationId.value
    workerSocket.send('agent', 'ask', payload)
  }

  function registerHandlers(offHandlers) {
    offHandlers.push(
      workerSocket.on('agent', 'list', (p) => {
        agentList.value = Array.isArray(p?.agents) ? p.agents : []
        // Default to first 'coder' or whatever's enabled if nothing picked.
        if (!agentSelectedSlug.value && agentList.value.length) {
          const preferred = agentList.value.find(a => a.role === 'coder') || agentList.value[0]
          agentSelectedSlug.value = preferred.slug
        }
      }),
      workerSocket.on('agent', 'started', (p) => {
        if (p?.conversation_id) agentConversationId.value = p.conversation_id
      }),
      workerSocket.on('agent', 'tool_call', (p) => {
        agentMessages.value.push({
          kind: 'tool_call',
          id:   p?.call_id,
          name: p?.tool,
          args: p?.args,
        })
      }),
      workerSocket.on('agent', 'tool_result', (p) => {
        agentMessages.value.push({
          kind:   'tool_result',
          id:     p?.call_id,
          name:   p?.tool,
          result: p?.result,
        })
      }),
      workerSocket.on('agent', 'done', (p) => {
        if (p?.content) {
          agentMessages.value.push({ kind: 'assistant', text: String(p.content) })
        }
        agentStatus.value = 'idle'
      }),
      workerSocket.on('agent', 'error', (p) => {
        const msg = p?.message || 'agent error'
        agentMessages.value.push({ kind: 'error', text: msg })
        agentStatus.value = 'error'
      }),
    )
  }

  return {
    agentList, agentSelectedSlug, agentConversationId, agentMessages, agentStatus,
    openAgentPane, selectAgent, resetConversation, send,
    registerHandlers,
  }
}
