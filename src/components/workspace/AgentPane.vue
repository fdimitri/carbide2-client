<!-- AgentPane — talk to a worker-side LLM agent. Renders a unified
     timeline of user messages, assistant replies, and collapsible
     tool_call / tool_result blocks emitted by AgentSession in
     worker/agent_session.rb. -->
<template>
  <div class="flex flex-col flex-1 min-h-0 monaco-bg monaco-fg overflow-hidden">

    <!-- Toolbar: agent picker + new conversation -->
    <div class="flex items-center gap-2 px-3 py-[0.4rem] border-b monaco-panel-border monaco-tabs-bg text-[0.8rem]">
      <label class="opacity-70">Agent:</label>
      <select
        :value="store.agentSelectedSlug || ''"
        @change="onPickAgent($event.target.value)"
        :disabled="!agents.length"
        class="px-[0.4rem] py-[0.2rem] rounded-[0.25rem] border monaco-input-bg monaco-input-fg monaco-input-border outline-none"
      >
        <option value="" disabled>{{ agents.length ? 'Select…' : 'None available' }}</option>
        <option v-for="a in agents" :key="a.slug" :value="a.slug">
          {{ a.name }} ({{ a.role }})
        </option>
      </select>
      <span class="opacity-60 truncate" :title="activeAgentDescription">
        {{ activeAgentMeta }}
      </span>
      <span class="ml-auto flex items-center gap-2">
        <span v-if="store.agentStatus === 'thinking'" class="text-[0.72rem] opacity-70 italic">thinking…</span>
        <button
          class="px-[0.55rem] py-[0.2rem] text-[0.72rem] rounded-[0.25rem] border monaco-panel-border opacity-80 hover:opacity-100"
          @click="onReset"
          :disabled="store.agentStatus === 'thinking'"
          title="Start a fresh conversation"
        >New</button>
      </span>
    </div>

    <!-- Conversation picker + visibility -->
    <div class="flex items-center gap-2 px-3 py-[0.35rem] border-b monaco-panel-border text-[0.75rem]">
      <label class="opacity-70">Conversation:</label>
      <select
        :value="store.agentConversationId || ''"
        @change="onPickConversation($event.target.value)"
        class="flex-1 min-w-0 px-[0.4rem] py-[0.15rem] rounded-[0.25rem] border monaco-input-bg monaco-input-fg monaco-input-border outline-none"
      >
        <option value="">— current (new) —</option>
        <option v-for="c in store.agentRecent" :key="c.conversation_id" :value="c.conversation_id">
          {{ conversationLabel(c) }}
        </option>
      </select>
      <button
        v-if="store.agentConversationId && store.agentOwnerIsSelf"
        class="px-[0.5rem] py-[0.15rem] text-[0.7rem] rounded-[0.25rem] border monaco-panel-border opacity-80 hover:opacity-100"
        @click="onToggleVisibility"
        :title="store.agentVisibility === 'project' ? 'Click to make private' : 'Click to share with project'"
      >
        {{ store.agentVisibility === 'project' ? '🌐 shared' : '🔒 private' }}
      </button>
      <span
        v-else-if="store.agentConversationId && !store.agentOwnerIsSelf"
        class="text-[0.7rem] opacity-60 italic"
        :title="'Owned by another user — read-only view'"
      >watching</span>
    </div>

    <!-- Timeline -->
    <div class="flex-1 overflow-y-auto p-3 flex flex-col gap-2 min-h-0" ref="scrollEl">
      <div v-if="!messages.length && !store.agentSelectedSlug" class="flex-1 grid place-items-center monaco-line-fg p-4 text-[0.85rem]">
        No agents seeded. Run <code>rails db:seed</code>.
      </div>
      <div v-else-if="!messages.length" class="flex-1 grid place-items-center monaco-line-fg p-4 text-[0.85rem]">
        Ask {{ activeAgentName }} something.
      </div>

      <template v-for="(m, i) in messages" :key="i">
        <!-- User -->
        <div v-if="m.kind === 'user'" class="flex flex-col gap-[0.1rem] max-w-[80ch] self-end">
          <span class="text-[0.72rem] opacity-60 self-end">you</span>
          <span class="text-[0.86rem] leading-[1.35] break-words whitespace-pre-wrap px-[0.6rem] py-[0.35rem] rounded-[0.35rem] border monaco-panel-border monaco-input-bg">{{ m.text }}</span>
        </div>

        <!-- Assistant -->
        <div v-else-if="m.kind === 'assistant'" class="flex flex-col gap-[0.1rem] max-w-[80ch]">
          <span class="text-[0.72rem] opacity-60">{{ activeAgentName }}</span>
          <span
            class="text-[0.86rem] leading-[1.35] break-words whitespace-pre-wrap"
            :class="m.muted ? 'opacity-50 italic' : ''"
          >{{ m.text }}</span>
        </div>

        <!-- Tool call/result pair — render as collapsible -->
        <details v-else-if="m.kind === 'tool_call'" class="text-[0.78rem] border monaco-panel-border rounded-[0.3rem] px-[0.5rem] py-[0.25rem] opacity-90">
          <summary class="cursor-pointer select-none">
            <span class="opacity-70">tool →</span>
            <code class="font-mono">{{ m.name }}({{ shortArgs(m.args) }})</code>
          </summary>
          <pre class="text-[0.72rem] mt-1 whitespace-pre-wrap break-words opacity-80">{{ pretty(m.args) }}</pre>
        </details>

        <details v-else-if="m.kind === 'tool_result'" class="text-[0.78rem] border monaco-panel-border rounded-[0.3rem] px-[0.5rem] py-[0.25rem] opacity-80">
          <summary class="cursor-pointer select-none">
            <span class="opacity-60">result ←</span>
            <code class="font-mono">{{ m.name }}</code>
            <span class="opacity-60">{{ resultSummary(m.result) }}</span>
          </summary>
          <pre class="text-[0.72rem] mt-1 whitespace-pre-wrap break-words opacity-80">{{ pretty(m.result) }}</pre>
        </details>

        <!-- System / error -->
        <div v-else-if="m.kind === 'error'" class="text-[0.78rem] text-red-400 italic">
          {{ m.text }}
        </div>
        <div v-else class="text-[0.78rem] opacity-60 italic">{{ m.text }}</div>
      </template>
    </div>

    <!-- Composer -->
    <div class="flex gap-2 p-[0.55rem] border-t monaco-panel-border monaco-tabs-bg">
      <textarea
        v-model="draft"
        @keydown.enter.exact.prevent="onSend"
        :placeholder="placeholder"
        :disabled="!canSend"
        rows="1"
        class="flex-1 px-[0.65rem] py-[0.45rem] text-[0.85rem] rounded-[0.3rem] outline-none font-[inherit] border monaco-input-bg monaco-input-fg monaco-input-border focus:monaco-focus-border placeholder:monaco-line-fg resize-none"
      ></textarea>
      <button
        class="px-[0.9rem] py-[0.45rem] text-[0.85rem] text-white rounded-[0.3rem] cursor-pointer font-[inherit] border-0 monaco-focus-bg hover:brightness-115 disabled:opacity-40 disabled:cursor-default"
        @click="onSend"
        :disabled="!canSend || !draft.trim()"
      >Send</button>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, nextTick } from 'vue'
import { useWorkspaceStore } from '../../stores/workspaceStore'

const props = defineProps({
  connected: { type: Boolean, default: false },
})
const emit = defineEmits(['agent-send', 'agent-reset', 'agent-pick', 'agent-load', 'agent-set-visibility'])

const store    = useWorkspaceStore()
const draft    = ref('')
const scrollEl = ref(null)

const agents   = computed(() => store.agentList || [])
const messages = computed(() => store.agentMessages || [])

const activeAgent = computed(() =>
  agents.value.find(a => a.slug === store.agentSelectedSlug) || null
)
const activeAgentName = computed(() => activeAgent.value?.name || 'agent')
const activeAgentMeta = computed(() => {
  const a = activeAgent.value
  if (!a) return ''
  const tools = Array.isArray(a.tools) && a.tools.length ? `· ${a.tools.length} tool${a.tools.length === 1 ? '' : 's'}` : '· no tools'
  return `${a.model || ''} ${tools}`.trim()
})
const activeAgentDescription = computed(() => activeAgent.value?.description || '')

const canSend = computed(() =>
  props.connected && !!store.agentSelectedSlug && store.agentStatus !== 'thinking'
)
const placeholder = computed(() => {
  if (!props.connected) return 'Disconnected.'
  if (!store.agentSelectedSlug) return 'Pick an agent above.'
  if (store.agentStatus === 'thinking') return 'Waiting for agent…'
  return `Ask ${activeAgentName.value}…`
})

function onSend() {
  const text = draft.value.trim()
  if (!text || !canSend.value) return
  emit('agent-send', text)
  draft.value = ''
}

function onReset()  { emit('agent-reset') }
function onPickAgent(slug) { emit('agent-pick', slug) }

function onPickConversation(id) {
  if (!id) { emit('agent-reset'); return }
  if (id === store.agentConversationId) return
  emit('agent-load', id)
}

function onToggleVisibility() {
  const next = store.agentVisibility === 'project' ? 'private' : 'project'
  emit('agent-set-visibility', next)
}

function conversationLabel(c) {
  const who    = c.owner_is_self ? 'you' : (c.owner_name || `user ${c.owner_user_id}`)
  const lock   = c.visibility === 'private' ? '\uD83D\uDD12 ' : ''
  const when   = relativeTime(c.last_activity_at)
  const title  = c.title || '(untitled)'
  const tail   = `· ${c.agent_name} · ${who} · ${when}`
  return `${lock}${title} ${tail}`
}

function relativeTime(iso) {
  if (!iso) return ''
  const d = new Date(iso).getTime()
  if (!d) return ''
  const s = Math.round((Date.now() - d) / 1000)
  if (s < 60)        return `${s}s ago`
  if (s < 3600)      return `${Math.round(s/60)}m ago`
  if (s < 86400)     return `${Math.round(s/3600)}h ago`
  return `${Math.round(s/86400)}d ago`
}

function shortArgs(args) {
  if (!args || typeof args !== 'object') return ''
  const keys = Object.keys(args)
  if (!keys.length) return ''
  return keys.map(k => {
    const v = args[k]
    const s = typeof v === 'string' ? `"${v}"` : JSON.stringify(v)
    return `${k}: ${s.length > 40 ? s.slice(0, 37) + '…' : s}`
  }).join(', ')
}

function pretty(v) {
  if (v == null) return ''
  try { return typeof v === 'string' ? v : JSON.stringify(v, null, 2) }
  catch { return String(v) }
}

function resultSummary(r) {
  if (r == null) return ''
  if (typeof r === 'string') return r.length > 60 ? ` (${r.length} chars)` : ` ${r}`
  if (r.error) return ` error: ${r.error}`
  if (Array.isArray(r.entries)) return ` ${r.entries.length} entries`
  if (typeof r.content === 'string') {
    const n = r.content.length
    return ` ${n} bytes${r.truncated ? ' (truncated)' : ''}`
  }
  return ''
}

// Auto-scroll on new message
watch(() => messages.value.length, async () => {
  await nextTick()
  if (scrollEl.value) scrollEl.value.scrollTop = scrollEl.value.scrollHeight
})
</script>
