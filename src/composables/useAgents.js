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
import { useDebugLogStore } from '../stores/debugLogStore'

export function useAgents({ error, bindTabToActivePane }) {
  const store    = useWorkspaceStore()
  const debugLog = useDebugLogStore()
  const {
    agentList, agentListLoaded, agentSelectedSlug, agentConversationId,
    agentMessages, agentStatus,
    agentRecent, agentVisibility, agentOwnerUserId, agentOwnerIsSelf,
  } = storeToRefs(store)

  function openAgentPane() {
    bindTabToActivePane('agent', 0, 'Agent')
    // Refresh list each time the pane is opened (cheap, helps if admin
    // toggled an agent's enabled flag mid-session).
    workerSocket.send('agent', 'list', {})
    workerSocket.send('agent', 'recent', { limit: 25 })
  }

  function selectAgent(slug) {
    if (slug === agentSelectedSlug.value) return
    agentSelectedSlug.value = slug
    // New agent = new conversation. Worker will assign a fresh id.
    resetConversation()
  }

  function resetConversation() {
    agentConversationId.value = null
    agentMessages.value       = []
    agentStatus.value         = 'idle'
    agentVisibility.value     = null
    agentOwnerUserId.value    = null
    agentOwnerIsSelf.value    = true
  }

  function loadConversation(conversationId) {
    if (!conversationId) return
    workerSocket.send('agent', 'load', { conversation_id: conversationId })
  }

  function setVisibility(visibility) {
    if (!agentConversationId.value) return
    workerSocket.send('agent', 'set_visibility', {
      conversation_id: agentConversationId.value,
      visibility,
    })
  }

  function send(text, images = null) {
    const trimmed = (text || '').trim()
    const hasImages = Array.isArray(images) && images.length > 0
    if (!trimmed && !hasImages) return
    const slug = agentSelectedSlug.value
    if (!slug) {
      error.value = 'Pick an agent first.'
      return
    }
    agentMessages.value.push({ kind: 'user', text: trimmed, images: hasImages ? images : null })
    agentStatus.value = 'thinking'
    const payload = { agent_slug: slug, message: trimmed }
    if (agentConversationId.value) payload.conversation_id = agentConversationId.value
    if (hasImages) payload.images = images   // [{mime, base64}, ...]
    workerSocket.send('agent', 'ask', payload)
    debugLog.push({ source: 'agent', action: 'ask',
      detail: `slug=${slug} convo=${agentConversationId.value || '(new)'} chars=${trimmed.length}${hasImages ? ` images=${images.length}` : ''}` })
  }

  function registerHandlers(offHandlers) {
    offHandlers.push(
      // The worker assigns a fresh session on every (re)connect (e.g. after a
      // worker restart), so re-request the agent list whenever the socket
      // comes up. Without this, an agent pane opened before the socket was
      // ready — or one that outlived a worker restart — would keep showing an
      // empty list. Mirrors ExplorerPane's tree refresh on 'system:connected'.
      workerSocket.on('system', 'connected', () => {
        workerSocket.send('agent', 'list', {})
        workerSocket.send('agent', 'recent', { limit: 25 })
      }),
      workerSocket.on('agent', 'list', (p) => {
        agentList.value = Array.isArray(p?.agents) ? p.agents : []
        agentListLoaded.value = true
        // Default to first 'coder' or whatever's enabled if nothing picked.
        if (!agentSelectedSlug.value && agentList.value.length) {
          const preferred = agentList.value.find(a => a.role === 'coder') || agentList.value[0]
          agentSelectedSlug.value = preferred.slug
        }
      }),
      workerSocket.on('agent', 'started', (p) => {
        if (p?.conversation_id) agentConversationId.value = p.conversation_id
        debugLog.push({ source: 'agent', action: 'started',
          detail: `convo=${p?.conversation_id || '?'} agent=${p?.agent || '?'}` })
      }),
      workerSocket.on('agent', 'tool_call', (p) => {
        agentMessages.value.push({
          kind: 'tool_call',
          id:   p?.call_id,
          name: p?.tool,
          args: p?.args,
        })
        let argSummary = ''
        try { argSummary = JSON.stringify(p?.args || {}) } catch { argSummary = '?' }
        if (argSummary.length > 120) argSummary = argSummary.slice(0, 117) + '…'
        debugLog.push({ source: 'agent', action: 'tool_call',
          detail: `${p?.tool || '?'}(${argSummary})` })
      }),
      workerSocket.on('agent', 'tool_result', (p) => {
        agentMessages.value.push({
          kind:   'tool_result',
          id:     p?.call_id,
          name:   p?.tool,
          result: p?.result,
        })
        const r = p?.result
        let summary = ''
        if (r && typeof r === 'object') {
          if (r.error)            summary = `error=${String(r.error).slice(0,80)}`
          else if ('exit_code' in r) summary = `exit=${r.exit_code} bytes=${(r.output||'').length}${r.truncated?' trunc':''}${r.timed_out?' timeout':''}`
          else if (Array.isArray(r.entries)) summary = `entries=${r.entries.length}`
          else if (typeof r.content === 'string') summary = `bytes=${r.content.length}${r.truncated?' trunc':''}`
          else summary = Object.keys(r).slice(0,4).join(',')
        } else if (typeof r === 'string') {
          summary = `len=${r.length}`
        }
        debugLog.push({ source: 'agent',
          severity: r && r.error ? 'error' : 'ok',
          action: 'tool_result', detail: `${p?.tool || '?'} ${summary}` })
      }),
      workerSocket.on('agent', 'done', (p) => {
        const finish    = p?.finish_reason || null
        const reasoning = p?.reasoning || null
        const truncated = finish === 'length'
        if (p?.content) {
          agentMessages.value.push({
            kind: 'assistant', text: String(p.content),
            finish_reason: finish, reasoning, truncated,
          })
        } else if (truncated) {
          // Model was cut off before it could emit any visible text. This is
          // the case that used to render as a misleading "(no reply)" —
          // typically caused by too-small context window in LM Studio /
          // llama.cpp. The reasoning_content may still be useful so we
          // attach it.
          agentMessages.value.push({
            kind: 'assistant',
            text: '(response truncated — increase model context window)',
            finish_reason: finish, reasoning, truncated: true, muted: true,
          })
        } else {
          // The model finished its turn without producing any reply text
          // (e.g. tool-only turn with finish_reason='stop'). Render a faint
          // marker so the user knows the agent is no longer working.
          agentMessages.value.push({
            kind: 'assistant', text: '(no reply)',
            finish_reason: finish, reasoning, muted: true,
          })
        }
        agentStatus.value = 'idle'
        debugLog.push({ source: 'agent',
          severity: truncated ? 'warn' : (p?.content ? 'ok' : 'warn'),
          action: 'done',
          detail: `turn=${p?.turn ?? '?'} finish=${finish || '?'} chars=${(p?.content || '').length}${reasoning ? ` reasoning=${reasoning.length}` : ''}` })
        // Bump the recent list so this convo (or its updated timestamp)
        // appears in the dropdown for everyone in the project.
        workerSocket.send('agent', 'recent', { limit: 25 })
      }),
      workerSocket.on('agent', 'error', (p) => {
        const msg = p?.message || 'agent error'
        agentMessages.value.push({ kind: 'error', text: msg })
        agentStatus.value = 'error'
        debugLog.push({ source: 'agent', severity: 'error', action: 'error', detail: msg })
      }),
      workerSocket.on('agent', 'recent', (p) => {
        agentRecent.value = Array.isArray(p?.conversations) ? p.conversations : []
      }),
      workerSocket.on('agent', 'loaded', (p) => {
        agentConversationId.value = p?.conversation_id || null
        agentMessages.value       = Array.isArray(p?.messages) ? p.messages : []
        agentStatus.value         = 'idle'
        agentVisibility.value     = p?.visibility || 'project'
        agentOwnerUserId.value    = p?.owner_user_id ?? null
        agentOwnerIsSelf.value    = !!p?.owner_is_self
        // Switch the agent picker to match the loaded conversation.
        if (p?.agent && p.agent !== agentSelectedSlug.value) {
          agentSelectedSlug.value = p.agent
        }
        debugLog.push({ source: 'agent', action: 'loaded',
          detail: `convo=${p?.conversation_id} msgs=${(p?.messages || []).length} vis=${p?.visibility}` })
      }),
      workerSocket.on('agent', 'visibility_changed', (p) => {
        // Update current convo if it matches; refresh recent dropdown.
        if (p?.conversation_id === agentConversationId.value) {
          agentVisibility.value = p.visibility
        }
        const row = agentRecent.value.find(c => c.conversation_id === p?.conversation_id)
        if (row) row.visibility = p.visibility
        // Re-pull recents in case a private->project flip newly exposes a row
        // (or project->private hides one for non-owners).
        workerSocket.send('agent', 'recent', { limit: 25 })
        debugLog.push({ source: 'agent', action: 'visibility_changed',
          detail: `convo=${p?.conversation_id} -> ${p?.visibility}` })
      }),
    )
  }

  return {
    agentList, agentSelectedSlug, agentConversationId, agentMessages, agentStatus,
    agentRecent, agentVisibility, agentOwnerUserId, agentOwnerIsSelf,
    openAgentPane, selectAgent, resetConversation, send,
    loadConversation, setVisibility,
    registerHandlers,
  }
}
