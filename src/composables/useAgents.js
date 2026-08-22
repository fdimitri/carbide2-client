// useAgents — talk to worker-side LLM agents over the existing WS.
//
// Wire format (worker/worker.rb handle_agent + worker/agent_session.rb):
//   send: {cs:'agent', cmd:'list',        payload:{}}
//   send: {cs:'agent', cmd:'ask',         payload:{agent_slug, message, conversation_id?}}
//   send: {cs:'agent', cmd:'load',        payload:{conversation_id}}
//   send: {cs:'agent', cmd:'subscribe',   payload:{conversation_id}}
//   send: {cs:'agent', cmd:'unsubscribe', payload:{conversation_id}}
//   recv: {cs:'agent', cmd:'list',         payload:{agents:[…]}}
//   recv: {cs:'agent', cmd:'started',      payload:{conversation_id, agent}}
//   recv: {cs:'agent', cmd:'tool_call',    payload:{tool, args, call_id, conversation_id, agent}}
//   recv: {cs:'agent', cmd:'tool_result',  payload:{tool, call_id, result, conversation_id, agent}}
//   recv: {cs:'agent', cmd:'done',         payload:{content, turn, conversation_id, agent}}
//   recv: {cs:'agent', cmd:'error',        payload:{message, conversation_id?, agent?}}
//
// Live agent state is keyed by conversation_id in workspaceStore; this
// composable routes every inbound frame into the right conversation's map
// entry (#85).
import { storeToRefs } from 'pinia'
import workerSocket from '../services/workerSocket'
import authService from '../services/authService'
import { useWorkspaceStore } from '../stores/workspaceStore'
import { useDebugLogStore } from '../stores/debugLogStore'

export function useAgents({ error, bindTabToActivePane, onConversationLoaded = null }) {
  const store    = useWorkspaceStore()
  const debugLog = useDebugLogStore()
  const {
    agentList, agentListLoaded, agentRecent,
    agentMessagesByConversation, agentStatusByConversation, agentMetaByConversation,
  } = storeToRefs(store)

  function openAgentPane() {
    bindTabToActivePane('agent', '', 'Agent')
    // Refresh list each time the pane is opened (cheap, helps if admin
    // toggled an agent's enabled flag mid-session).
    workerSocket.send('agent', 'list', {})
    workerSocket.send('agent', 'recent', { limit: 25 })
  }

  // Per-conversation accessors (canonical map, shared across panes).
  function messages(conversationId) { return store.agentMessagesFor(conversationId) }
  function status(conversationId)    { return store.agentStatusFor(conversationId) }
  function meta(conversationId)      { return store.agentMetaFor(conversationId) }

  function selectAgent(conversationId, slug) {
    if (!conversationId) return
    meta(conversationId).agentSlug = slug
    // New agent = new conversation. Worker will assign a fresh id; the caller
    // (pane) owns resetting its tab key to the fresh agent:<uuid>.
  }

  function loadConversation(conversationId) {
    if (!conversationId) return
    workerSocket.send('agent', 'load', { conversation_id: conversationId })
    workerSocket.send('agent', 'subscribe', { conversation_id: conversationId })
  }

  // Ref-counted unsubscribe: callers increment/decrement per pane tab reference.
  // The worker subscription is released only at 0 refs; the buffered transcript
  // is released at 0 refs too.
  const refCounts = new Map()
  function retain(conversationId) {
    if (!conversationId) return
    const n = refCounts.get(conversationId) || 0
    refCounts.set(conversationId, n + 1)
  }
  function release(conversationId) {
    if (!conversationId) return
    const n = refCounts.get(conversationId) || 0
    if (n <= 1) {
      refCounts.delete(conversationId)
      workerSocket.send('agent', 'unsubscribe', { conversation_id: conversationId })
      store.releaseAgentConversation(conversationId)
    } else {
      refCounts.set(conversationId, n - 1)
    }
  }

  // Message-less create: worker mints the UUID, resolves the promise with it.
  // Callers await this before sending the first ask (avoids temp-key promotion).
  //
  // NOTE: no explicit `agent/subscribe` here — the worker subscribes the
  // session server-side in both agent/create and agent/ask (idempotently), so
  // delivery membership is already established before the first stream frame.
  // Explicit `agent/subscribe` exists only for loadConversation, which loads
  // without asking. See agent_handlers.rb.
  const pendingCreates = new Map()  // slug -> resolve fn(s)
  function createConversation(slug) {
    return new Promise((resolve, reject) => {
      if (!slug) { reject(new Error('no agent slug')); return }
      const waiters = pendingCreates.get(slug) || []
      waiters.push(resolve)
      pendingCreates.set(slug, waiters)
      workerSocket.send('agent', 'create', { agent_slug: slug })
      // Safety net: don't leave a waiter hanging forever if ack is lost.
      setTimeout(() => {
        const list = pendingCreates.get(slug) || []
        const i = list.indexOf(resolve)
        if (i >= 0) { list.splice(i, 1); reject(new Error('agent/create timed out')) }
      }, 8000)
    })
  }

  function setVisibility(conversationId, visibility) {
    if (!conversationId) return
    workerSocket.send('agent', 'set_visibility', {
      conversation_id: conversationId,
      visibility,
    })
  }

  function stop(conversationId) {
    if (!conversationId) return
    workerSocket.send('agent', 'stop', { conversation_id: conversationId })
    debugLog.push({ source: 'agent', action: 'stop', detail: `convo=${conversationId}` })
  }

  function currentUserName() {
    const u = authService.currentUser
    return u?.name || u?.email || 'you'
  }

  // The asker's local user turn. The worker broadcasts the same turn to other
  // subscribers, so only the origin pushes it locally.
  function send(conversationId, text, images = null) {
    const trimmed = (text || '').trim()
    const hasImages = Array.isArray(images) && images.length > 0
    if (!trimmed && !hasImages) return
    const slug = meta(conversationId).agentSlug
    if (!slug) { error.value = 'Pick an agent first.'; return }
    messages(conversationId).push({
      kind: 'user',
      text: trimmed,
      images: hasImages ? images : null,
      user_id: store.currentUserId,
      name: currentUserName(),
    })
    agentStatusByConversation.value[conversationId] = 'thinking'
    const payload = { agent_slug: slug, message: trimmed }
    if (conversationId) payload.conversation_id = conversationId
    if (hasImages) payload.images = images
    workerSocket.send('agent', 'ask', payload)
    debugLog.push({ source: 'agent', action: 'ask',
      detail: `slug=${slug} convo=${conversationId || '(new)'} chars=${trimmed.length}${hasImages ? ` images=${images.length}` : ''}` })
  }

  function registerHandlers(offHandlers) {
    // Throttled streaming buffer per conversation. Commits deltas to the
    // in-progress assistant message ~every 40ms; flushed before a tool_call/
    // done/stopped finalizes the turn.
    const pending = {}   // conversationId => { text, reason }
    const timers  = {}

    function liveStreamMsg(cid) {
      const arr = messages(cid)
      const last = arr[arr.length - 1]
      return (last && last.kind === 'assistant' && last.streaming) ? last : null
    }

    function commitStream(cid) {
      timers[cid] = null
      const msg = liveStreamMsg(cid)
      const p = pending[cid]
      if (!msg) { if (p) { p.text = ''; p.reason = '' }; return }
      if (p) {
        if (p.text)   { msg.text = (msg.text || '') + p.text; p.text = '' }
        if (p.reason) { msg.reasoning = (msg.reasoning || '') + p.reason; p.reason = '' }
      }
    }

    function flushStream(cid) {
      if (timers[cid]) { clearTimeout(timers[cid]); timers[cid] = null }
      commitStream(cid)
    }

    function pushAssistant(cid, obj) { messages(cid).push({ kind: 'assistant', ...obj }) }

    offHandlers.push(
      // The worker assigns a fresh session on every (re)connect; re-request
      // the catalog + recent list whenever the socket comes up.
      workerSocket.on('system', 'connected', () => {
        workerSocket.send('agent', 'list', {})
        workerSocket.send('agent', 'recent', { limit: 25 })
      }),
      workerSocket.on('agent', 'list', (p) => {
        agentList.value = Array.isArray(p?.agents) ? p.agents : []
        agentListLoaded.value = true
      }),
      workerSocket.on('agent', 'started', (p) => {
        const cid = p?.conversation_id
        if (cid) store.ensureAgentConversation(cid)
        debugLog.push({ source: 'agent', action: 'started',
          detail: `convo=${cid || '?'} agent=${p?.agent || '?'}` })
      }),
      workerSocket.on('agent', 'created', (p) => {
        const cid = p?.conversation_id
        const slug = p?.agent
        if (cid) store.ensureAgentConversation(cid)
        if (slug && pendingCreates.has(slug)) {
          const waiters = pendingCreates.get(slug)
          pendingCreates.delete(slug)
          waiters.forEach((resolve) => resolve(cid))
        }
        debugLog.push({ source: 'agent', action: 'created',
          detail: `convo=${cid || '?'} agent=${slug || '?'}` })
      }),
      workerSocket.on('agent', 'user_turn', (p) => {
        const cid = p?.conversation_id
        if (!cid) return
        // The sender already pushed this locally; only other subscribers
        // receive it. Routing is by conversation id, so it can't leak into
        // another thread.
        messages(cid).push({
          kind: 'user',
          text: p?.text ?? '',
          images: Array.isArray(p?.images) ? p.images : null,
          user_id: p?.user_id ?? null,
          name: p?.name ?? null,
        })
        debugLog.push({ source: 'agent', action: 'user_turn',
          detail: `convo=${cid} user=${p?.user_id || '?'}` })
      }),
      workerSocket.on('agent', 'stream', (p) => {
        const cid = p?.conversation_id
        if (!cid) return
        if (!liveStreamMsg(cid)) pushAssistant(cid, { text: '', reasoning: '', streaming: true })
        if (!pending[cid]) pending[cid] = { text: '', reason: '' }
        if (p?.delta != null)           pending[cid].text   += String(p.delta)
        if (p?.reasoning_delta != null) pending[cid].reason += String(p.reasoning_delta)
        if (!timers[cid]) timers[cid] = setTimeout(() => commitStream(cid), 40)
        agentStatusByConversation.value[cid] = 'thinking'
      }),
      workerSocket.on('agent', 'tool_call', (p) => {
        const cid = p?.conversation_id
        if (!cid) return
        flushStream(cid)
        const live = liveStreamMsg(cid)
        if (live) live.streaming = false
        messages(cid).push({ kind: 'tool_call', id: p?.call_id, name: p?.tool, args: p?.args })
        let argSummary = ''
        try { argSummary = JSON.stringify(p?.args || {}) } catch { argSummary = '?' }
        if (argSummary.length > 120) argSummary = argSummary.slice(0, 117) + '…'
        debugLog.push({ source: 'agent', action: 'tool_call',
          detail: `${p?.tool || '?'}(${argSummary})` })
      }),
      workerSocket.on('agent', 'tool_result', (p) => {
        const cid = p?.conversation_id
        if (!cid) return
        messages(cid).push({ kind: 'tool_result', id: p?.call_id, name: p?.tool, result: p?.result })
        const r = p?.result
        let summary = ''
        if (r && typeof r === 'object') {
          if (r.error)            summary = `error=${String(r.error).slice(0,80)}`
          else if ('exit_code' in r) summary = `exit=${r.exit_code} bytes=${(r.output||'').length}${r.truncated?' trunc':''}${r.timed_out?' timeout':''}`
          else if (Array.isArray(r.entries)) summary = `entries=${r.entries.length}`
          else if (typeof r.content === 'string') summary = `bytes=${r.content.length}${r.truncated?' trunc':''}`
          else summary = Object.keys(r).slice(0,4).join(',')
        } else if (typeof r === 'string') summary = `len=${r.length}`
        debugLog.push({ source: 'agent', severity: r && r.error ? 'error' : 'ok',
          action: 'tool_result', detail: `${p?.tool || '?'} ${summary}` })
      }),
      workerSocket.on('agent', 'stopped', (p) => {
        const cid = p?.conversation_id
        if (!cid) return
        flushStream(cid)
        const live = liveStreamMsg(cid)
        if (live) {
          live.streaming = false
          if (live.text) { live.stopped = true }
          else { live.text = '(stopped)'; live.muted = true }
        } else {
          pushAssistant(cid, { text: '(stopped)', muted: true })
        }
        agentStatusByConversation.value[cid] = 'idle'
        debugLog.push({ source: 'agent', action: 'stopped',
          detail: `convo=${cid} turn=${p?.turn ?? '?'}` })
      }),
      workerSocket.on('agent', 'done', (p) => {
        const cid = p?.conversation_id
        if (!cid) return
        flushStream(cid)
        const finish    = p?.finish_reason || null
        const reasoning = p?.reasoning || null
        const truncated = finish === 'length'
        const live = liveStreamMsg(cid)
        if (live) {
          live.streaming = false
          live.finish_reason = finish
          live.truncated = truncated
          if (reasoning) live.reasoning = reasoning
          if (p?.content) live.text = String(p.content)
          if (!live.text) {
            if (truncated) { live.text = '(response truncated — increase model context window)'; live.muted = true }
            else           { live.text = '(no reply)'; live.muted = true }
          }
        } else if (p?.content) {
          pushAssistant(cid, { text: String(p.content), finish_reason: finish, reasoning, truncated })
        } else if (truncated) {
          pushAssistant(cid, { text: '(response truncated — increase model context window)', finish_reason: finish, reasoning, truncated: true, muted: true })
        } else {
          pushAssistant(cid, { text: '(no reply)', finish_reason: finish, reasoning, muted: true })
        }
        agentStatusByConversation.value[cid] = 'idle'
        debugLog.push({ source: 'agent',
          severity: truncated ? 'warn' : (p?.content ? 'ok' : 'warn'),
          action: 'done',
          detail: `turn=${p?.turn ?? '?'} finish=${finish || '?'} chars=${(p?.content || '').length}${reasoning ? ` reasoning=${reasoning.length}` : ''}` })
        workerSocket.send('agent', 'recent', { limit: 25 })
      }),
      workerSocket.on('agent', 'error', (p) => {
        const cid = p?.conversation_id
        const msg = p?.message || 'agent error'
        if (cid) {
          messages(cid).push({ kind: 'error', text: msg })
          agentStatusByConversation.value[cid] = 'error'
        }
        debugLog.push({ source: 'agent', severity: 'error', action: 'error', detail: msg })
      }),
      workerSocket.on('agent', 'recent', (p) => {
        agentRecent.value = Array.isArray(p?.conversations) ? p.conversations : []
      }),
      workerSocket.on('agent', 'loaded', (p) => {
        const cid = p?.conversation_id
        if (!cid) return
        store.ensureAgentConversation(cid)
        const arr = agentMessagesByConversation.value[cid]
        arr.splice(0, arr.length, ...(Array.isArray(p?.messages) ? p.messages : []))
        agentStatusByConversation.value[cid] = 'idle'
        const m = meta(cid)
        m.visibility = p?.visibility || 'project'
        m.ownerUserId = p?.owner_user_id ?? null
        m.ownerIsSelf = !!p?.owner_is_self
        if (p?.agent) m.agentSlug = p.agent
        if (typeof onConversationLoaded === 'function') onConversationLoaded(cid, p?.agent || null)
        debugLog.push({ source: 'agent', action: 'loaded',
          detail: `convo=${cid} msgs=${(p?.messages || []).length} vis=${p?.visibility}` })
      }),
      workerSocket.on('agent', 'visibility_changed', (p) => {
        const cid = p?.conversation_id
        if (!cid) return
        const m = meta(cid)
        if (m) m.visibility = p.visibility
        const row = agentRecent.value.find(c => c.conversation_id === cid)
        if (row) row.visibility = p.visibility
        workerSocket.send('agent', 'recent', { limit: 25 })
        debugLog.push({ source: 'agent', action: 'visibility_changed',
          detail: `convo=${cid} -> ${p?.visibility}` })
      }),
      workerSocket.on('agent', 'subscribed', (p) => {
        debugLog.push({ source: 'agent', action: 'subscribed',
          detail: `convo=${p?.conversation_id || '?'}` })
      }),
      workerSocket.on('agent', 'unsubscribed', (p) => {
        debugLog.push({ source: 'agent', action: 'unsubscribed',
          detail: `convo=${p?.conversation_id || '?'}` })
      }),
    )
  }

  return {
    agentList, agentListLoaded, agentRecent,
    agentMessagesByConversation, agentStatusByConversation, agentMetaByConversation,
    messages, status, meta,
    openAgentPane, selectAgent, loadConversation, createConversation,
    retain, release,
    setVisibility, stop, send, releaseAgentConversation: store.releaseAgentConversation,
    registerHandlers,
  }
}
