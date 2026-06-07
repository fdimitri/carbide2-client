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
      <div v-if="!messages.length && !store.agentSelectedSlug && store.agentListLoaded && !agents.length" class="flex-1 grid place-items-center monaco-line-fg p-4 text-[0.85rem]">
        No agents seeded. Run <code>rails db:seed</code>.
      </div>
      <div v-else-if="!messages.length && !store.agentSelectedSlug" class="flex-1 grid place-items-center monaco-line-fg p-4 text-[0.85rem]">
        Loading agents…
      </div>
      <div v-else-if="!messages.length" class="flex-1 grid place-items-center monaco-line-fg p-4 text-[0.85rem]">
        Ask {{ activeAgentName }} something.
      </div>

      <template v-for="(m, i) in messages" :key="i">
        <!-- User -->
        <div v-if="m.kind === 'user'" class="flex flex-col gap-[0.15rem] max-w-[80ch] self-end">
          <span class="text-[0.72rem] opacity-60 self-end">you</span>
          <div
            v-if="m.images && m.images.length"
            class="flex flex-wrap gap-1 self-end max-w-full"
          >
            <img
              v-for="(img, ii) in m.images"
              :key="ii"
              :src="`data:${img.mime};base64,${img.base64}`"
              class="max-h-40 max-w-[16rem] rounded-[0.25rem] border monaco-panel-border"
              :alt="`attachment ${ii + 1}`"
            />
          </div>
          <span
            v-if="m.text"
            class="text-[0.86rem] leading-[1.35] break-words whitespace-pre-wrap px-[0.6rem] py-[0.35rem] rounded-[0.35rem] border monaco-panel-border monaco-input-bg"
          >{{ m.text }}</span>
        </div>

        <!-- Assistant -->
        <div v-else-if="m.kind === 'assistant'" class="flex flex-col gap-[0.15rem] max-w-[80ch]">
          <span class="text-[0.72rem] opacity-60 flex items-center gap-2">
            {{ activeAgentName }}
            <span
              v-if="m.truncated"
              class="text-[0.65rem] uppercase tracking-wider px-[0.35rem] py-[0.05rem] rounded-[0.2rem] border border-amber-600/60 text-amber-400 font-semibold"
              title="Model hit its max_tokens / context limit before finishing. Increase the model's context window or max_tokens in your provider."
            >truncated</span>
          </span>
          <details
            v-if="m.reasoning"
            class="text-[0.78rem] border monaco-panel-border rounded-[0.3rem] px-[0.5rem] py-[0.25rem] opacity-80"
          >
            <summary class="cursor-pointer select-none opacity-70">reasoning ({{ m.reasoning.length }} chars)</summary>
            <div class="markdown-body text-[0.8rem] mt-1 opacity-90" v-html="renderMarkdown(m.reasoning)"></div>
          </details>
          <div
            class="markdown-body text-[0.86rem] leading-[1.4] break-words"
            :class="m.muted ? 'opacity-60 italic' : ''"
            v-html="renderMarkdown(m.text)"
          ></div>
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
    <div
      class="flex flex-col gap-[0.4rem] p-[0.55rem] border-t monaco-panel-border monaco-tabs-bg"
      :class="dragOver ? 'ring-2 ring-blue-500/60 ring-inset' : ''"
      @dragover.prevent="dragOver = true"
      @dragleave.prevent="dragOver = false"
      @drop.prevent="onDrop"
    >
      <div v-if="pendingImages.length" class="flex flex-wrap gap-[0.4rem]">
        <div
          v-for="(img, idx) in pendingImages"
          :key="idx"
          class="relative group"
          :title="`${img.mime} · ${formatBytes(img.bytes)}`"
        >
          <img
            :src="`data:${img.mime};base64,${img.base64}`"
            class="h-16 w-16 object-cover rounded-[0.25rem] border monaco-panel-border"
            :alt="`pending ${idx + 1}`"
          />
          <button
            class="absolute -top-1 -right-1 w-4 h-4 leading-[0.85rem] text-[0.7rem] rounded-full bg-black/80 text-white opacity-80 hover:opacity-100"
            @click="removePending(idx)"
            title="Remove"
          >×</button>
        </div>
      </div>

      <div class="flex gap-2">
        <button
          class="px-[0.6rem] py-[0.45rem] text-[0.85rem] rounded-[0.3rem] border monaco-panel-border opacity-80 hover:opacity-100 disabled:opacity-30 disabled:cursor-default"
          @click="fileInputEl?.click()"
          :disabled="!canSend"
          title="Attach image(s) (or paste / drag-drop)"
        >📎</button>
        <input
          ref="fileInputEl"
          type="file"
          accept="image/*"
          multiple
          class="hidden"
          @change="onFileInput"
        />
        <textarea
          v-model="draft"
          @keydown.enter.exact.prevent="onSend"
          @paste="onPaste"
          :placeholder="placeholder"
          :disabled="!canSend"
          rows="1"
          class="flex-1 px-[0.65rem] py-[0.45rem] text-[0.85rem] rounded-[0.3rem] outline-none font-[inherit] border monaco-input-bg monaco-input-fg monaco-input-border focus:monaco-focus-border placeholder:monaco-line-fg resize-none"
        ></textarea>
        <button
          class="px-[0.9rem] py-[0.45rem] text-[0.85rem] text-white rounded-[0.3rem] cursor-pointer font-[inherit] border-0 monaco-focus-bg hover:brightness-115 disabled:opacity-40 disabled:cursor-default"
          @click="onSend"
          :disabled="!canSend || (!draft.trim() && !pendingImages.length)"
        >Send</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, nextTick } from 'vue'
import { useWorkspaceStore } from '../../stores/workspaceStore'
import { renderMarkdown } from '../../utils/markdown'

const props = defineProps({
  connected: { type: Boolean, default: false },
})
const emit = defineEmits(['agent-send', 'agent-reset', 'agent-pick', 'agent-load', 'agent-set-visibility'])

const store    = useWorkspaceStore()
const draft    = ref('')
const scrollEl = ref(null)

// ── Image attachments ─────────────────────────────────────────────
// Queued for the next send; cleared after onSend fires.
const MAX_IMAGES        = 6
const MAX_BYTES_PER_IMG = 8 * 1024 * 1024   // 8 MB raw
const pendingImages     = ref([])
const fileInputEl       = ref(null)
const dragOver          = ref(false)

function formatBytes(n) {
  if (n == null) return ''
  if (n < 1024)        return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onerror = () => reject(r.error || new Error('read failed'))
    r.onload  = () => {
      const s = String(r.result || '')
      const comma = s.indexOf(',')
      resolve(comma >= 0 ? s.slice(comma + 1) : s)
    }
    r.readAsDataURL(file)
  })
}

async function addFiles(files) {
  for (const file of files) {
    if (!file || !file.type || !file.type.startsWith('image/')) continue
    if (pendingImages.value.length >= MAX_IMAGES) break
    if (file.size > MAX_BYTES_PER_IMG) {
      console.warn(`[AgentPane] image too large, skipped: ${file.name} (${file.size} bytes)`)
      continue
    }
    try {
      const base64 = await fileToBase64(file)
      pendingImages.value.push({ mime: file.type, base64, bytes: file.size })
    } catch (e) {
      console.warn('[AgentPane] failed to read image', e)
    }
  }
}

function removePending(idx) {
  pendingImages.value.splice(idx, 1)
}

function onFileInput(ev) {
  const files = Array.from(ev.target.files || [])
  addFiles(files)
  ev.target.value = ''   // allow re-selecting same file
}

function onPaste(ev) {
  const items = Array.from(ev.clipboardData?.items || [])
  const files = items
    .filter(it => it.kind === 'file' && it.type.startsWith('image/'))
    .map(it => it.getAsFile())
    .filter(Boolean)
  if (files.length) {
    ev.preventDefault()
    addFiles(files)
  }
}

function onDrop(ev) {
  dragOver.value = false
  const files = Array.from(ev.dataTransfer?.files || [])
  if (files.length) addFiles(files)
}

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
  const text   = draft.value.trim()
  const images = pendingImages.value.slice()
  if (!canSend.value) return
  if (!text && !images.length) return
  emit('agent-send', text, images.length ? images : null)
  draft.value = ''
  pendingImages.value = []
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

