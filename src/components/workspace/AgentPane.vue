<!-- AgentPane — talk to a worker-side LLM agent. Renders a unified
     timeline of user messages, assistant replies, and collapsible
     tool_call / tool_result blocks emitted by AgentSession in
     worker/agent_session.rb. -->
<template>
  <div class="flex flex-col flex-1 min-h-0 monaco-bg monaco-fg overflow-hidden">

    <!-- Toolbar: agent picker + new conversation -->
    <div class="flex items-center gap-2 px-3 py-1.5 border-b monaco-panel-border monaco-tabs-bg text-ui-md">
      <label class="opacity-70">Agent:</label>
      <select
        :value="store.agentSelectedSlug || ''"
        @change="onPickAgent($event.target.value)"
        :disabled="!agents.length"
        class="px-1.5 py-1 rounded-ui-xs border monaco-input-bg monaco-input-fg monaco-input-border outline-none"
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
        <span v-if="store.agentStatus === 'thinking'" class="text-ui-xs opacity-70 italic">thinking…</span>
        <UiButton
          size="xs"
          @click="onReset"
          :disabled="store.agentStatus === 'thinking'"
          title="Start a fresh conversation"
        >New</UiButton>
      </span>
    </div>

    <!-- Conversation picker + visibility -->
    <div class="flex items-center gap-2 px-3 py-1.5 border-b monaco-panel-border text-ui-sm">
      <label class="opacity-70">Conversation:</label>
      <select
        :value="store.agentConversationId || ''"
        @change="onPickConversation($event.target.value)"
        class="flex-1 min-w-0 px-1.5 py-0.5 rounded-ui-xs border monaco-input-bg monaco-input-fg monaco-input-border outline-none"
      >
        <option value="">— current (new) —</option>
        <option v-for="c in store.agentRecent" :key="c.conversation_id" :value="c.conversation_id">
          {{ conversationLabel(c) }}
        </option>
      </select>
      <UiButton
        v-if="store.agentConversationId && store.agentOwnerIsSelf"
        size="xs"
        @click="onToggleVisibility"
        :title="store.agentVisibility === 'project' ? 'Click to make private' : 'Click to share with project'"
      >
        {{ store.agentVisibility === 'project' ? '🌐 shared' : '🔒 private' }}
      </UiButton>
      <span
        v-else-if="store.agentConversationId && !store.agentOwnerIsSelf"
        class="text-ui-xs opacity-60 italic"
        :title="'Owned by another user — read-only view'"
      >watching</span>
    </div>

    <!-- Timeline -->
    <div class="flex-1 overflow-y-auto p-3 flex flex-col gap-2 min-h-0" ref="scrollEl">
      <div v-if="!messages.length && !store.agentSelectedSlug && store.agentListLoaded && !agents.length" class="flex-1 grid place-items-center monaco-line-fg p-4 text-ui-lg">
        No agents seeded. Run <code>rails db:seed</code>.
      </div>
      <div v-else-if="!messages.length && !store.agentSelectedSlug" class="flex-1 grid place-items-center monaco-line-fg p-4 text-ui-lg">
        Loading agents…
      </div>
      <div v-else-if="!messages.length" class="flex-1 grid place-items-center monaco-line-fg p-4 text-ui-lg">
        Ask {{ activeAgentName }} something.
      </div>

      <template v-for="(m, i) in timeline" :key="i">
        <!-- User — left-aligned, avatar + name, same language as ChatPane -->
        <div v-if="m.kind === 'user'" class="flex items-start gap-2">
          <Avatar :id="selfLabel" :name="selfLabel" />
          <div class="flex flex-col min-w-0 gap-1">
            <span class="text-ui-md font-semibold">{{ selfLabel }}</span>
            <div
              v-if="m.images && m.images.length"
              class="flex flex-wrap gap-1 max-w-full"
            >
              <img
                v-for="(img, ii) in m.images"
                :key="ii"
                :src="`data:${img.mime};base64,${img.base64}`"
                class="max-h-40 max-w-[16rem] rounded-ui-xs border monaco-panel-border"
                :alt="`attachment ${ii + 1}`"
              />
            </div>
            <span
              v-if="m.text"
              class="text-ui-lg leading-snug break-words whitespace-pre-wrap"
            >{{ m.text }}</span>
          </div>
        </div>

        <!-- Assistant turn — one Coder header, then its tool calls + reply -->
        <div v-else-if="m.kind === 'assistant_turn'" class="flex items-start gap-2">
          <Avatar :id="store.agentSelectedSlug || activeAgentName" :name="activeAgentName" />
          <div class="flex flex-col min-w-0 gap-1">
            <span class="text-ui-md font-semibold">{{ activeAgentName }}</span>
            <template v-for="(item, ii) in m.items" :key="ii">
              <!-- Tool calls — grouped; same disclosure language as reasoning -->
              <details v-if="item.type === 'tools'" class="text-ui-xs rounded-ui-sm bg-white/[0.03]">
                <summary class="cursor-pointer select-none font-mono opacity-45 hover:opacity-75 marker:opacity-30 px-2 py-0.5 truncate">
                  {{ item.tools.length }} tool {{ item.tools.length === 1 ? 'call' : 'calls' }}<span class="opacity-70"> · {{ toolNames(item.tools) }}</span>
                </summary>
                <div class="flex flex-col pl-2 pb-0.5">
                  <details v-for="(t, ti) in item.tools" :key="ti" class="group text-ui-xs rounded-ui-xs px-2 py-0.5 hover:bg-white/[0.04]">
                    <summary class="cursor-pointer select-none font-mono opacity-45 group-hover:opacity-80 marker:opacity-30 truncate">
                      {{ t.name }}({{ shortArgs(t.args) }})<template v-if="t.done"><span class="opacity-40"> → </span><span class="opacity-70">{{ resultSummary(t.result).trim() }}</span></template><span v-else class="opacity-40 italic"> …</span>
                    </summary>
                    <pre v-if="t.args !== undefined" class="text-ui-2xs mt-1 whitespace-pre-wrap break-words opacity-60">{{ pretty(t.args) }}</pre>
                    <pre v-if="t.done" class="text-ui-2xs mt-1 whitespace-pre-wrap break-words opacity-50">{{ pretty(t.result) }}</pre>
                  </details>
                </div>
              </details>

              <!-- Reply text (+ optional reasoning / truncated badge) -->
              <template v-else>
                <span
                  v-if="item.truncated"
                  class="self-start text-ui-2xs uppercase tracking-wider px-1.5 py-0 rounded-ui-xs border border-amber-600/60 text-amber-400 font-semibold"
                  title="Model hit its max_tokens / context limit before finishing. Increase the model's context window or max_tokens in your provider."
                >truncated</span>
                <details
                  v-if="item.reasoning"
                  class="text-ui-xs rounded-ui-sm bg-white/[0.05]"
                >
                  <summary class="cursor-pointer select-none font-mono opacity-45 hover:opacity-75 marker:opacity-30 px-2 py-0.5 truncate">reasoning · {{ item.reasoning.length }} chars</summary>
                  <div class="markdown-body text-ui-md px-2 pb-1 opacity-90" v-html="renderMarkdown(item.reasoning)"></div>
                </details>
                <div
                  class="markdown-body text-ui-lg leading-normal break-words"
                  :class="item.muted ? 'opacity-60 italic' : ''"
                  v-html="renderMarkdown(item.text)"
                ></div>
              </template>
            </template>
          </div>
        </div>

        <!-- System / error -->
        <div v-else-if="m.kind === 'error'" class="text-ui-sm text-red-400 italic">
          {{ m.text }}
        </div>
        <div v-else class="text-ui-sm opacity-60 italic">{{ m.text }}</div>
      </template>
    </div>

    <!-- Composer -->
    <div
      class="flex flex-col gap-1.5 p-2 border-t monaco-panel-border monaco-tabs-bg"
      :class="dragOver ? 'ring-2 ring-blue-500/60 ring-inset' : ''"
      @dragover.prevent="dragOver = true"
      @dragleave.prevent="dragOver = false"
      @drop.prevent="onDrop"
    >
      <div v-if="pendingImages.length" class="flex flex-wrap gap-1.5">
        <div
          v-for="(img, idx) in pendingImages"
          :key="idx"
          class="relative group"
          :title="`${img.mime} · ${formatBytes(img.bytes)}`"
        >
          <img
            :src="`data:${img.mime};base64,${img.base64}`"
            class="h-16 w-16 object-cover rounded-ui-xs border monaco-panel-border"
            :alt="`pending ${idx + 1}`"
          />
          <button
            class="absolute -top-1 -right-1 w-4 h-4 leading-[0.85rem] text-ui-xs rounded-full bg-black/80 text-white opacity-80 hover:opacity-100"
            @click="removePending(idx)"
            title="Remove"
          >×</button>
        </div>
      </div>

      <div class="flex gap-2">
        <UiButton
          size="md"
          @click="fileInputEl?.click()"
          :disabled="!canSend"
          title="Attach image(s) (or paste / drag-drop)"
        >📎</UiButton>
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
          class="flex-1 px-2.5 py-2 text-ui-lg rounded-ui-sm outline-none font-[inherit] border monaco-input-bg monaco-input-fg monaco-input-border focus:monaco-focus-border placeholder:monaco-line-fg resize-none"
        ></textarea>
        <UiButton
          size="md"
          variant="primary"
          @click="onSend"
          :disabled="!canSend || (!draft.trim() && !pendingImages.length)"
        >Send</UiButton>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, nextTick } from 'vue'
import { useWorkspaceStore } from '../../stores/workspaceStore'
import { renderMarkdown } from '../../utils/markdown'
import UiButton from '../ui/UiButton.vue'
import Avatar from '../ui/Avatar.vue'
import authService from '../../services/authService'

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

// Merge each tool_call with its matching tool_result (same call id) into a
// single row, so a tool invocation reads as one line — name(args) → summary —
// instead of two stacked boxes. Then everything the agent emits in one turn
// (its tool calls + its reply) is grouped under a single Coder turn, so tool
// calls are attributed to the agent — not left dangling under the user message.
// Within a turn, consecutive tool rows coalesce into one collapsible group.
const timeline = computed(() => {
  // Pass 1: merge tool_call + tool_result by id into one `tool` row.
  const merged = []
  const byId = new Map()
  for (const m of messages.value) {
    if (m.kind === 'tool_call') {
      const row = { kind: 'tool', id: m.id, name: m.name, args: m.args, result: undefined, done: false }
      if (m.id != null) byId.set(m.id, row)
      merged.push(row)
    } else if (m.kind === 'tool_result') {
      const row = m.id != null ? byId.get(m.id) : null
      if (row) { row.result = m.result; row.done = true }
      else merged.push({ kind: 'tool', id: m.id, name: m.name, result: m.result, done: true })
    } else {
      merged.push(m)
    }
  }
  // Pass 2: fold agent-side entries (tools + assistant text) into Coder turns.
  const out = []
  let turn = null
  for (const m of merged) {
    if (m.kind === 'tool' || m.kind === 'assistant') {
      if (!turn) { turn = { kind: 'assistant_turn', items: [] }; out.push(turn) }
      if (m.kind === 'tool') {
        const last = turn.items[turn.items.length - 1]
        if (last && last.type === 'tools') last.tools.push(m)
        else turn.items.push({ type: 'tools', tools: [m] })
      } else {
        turn.items.push({ type: 'text', text: m.text, reasoning: m.reasoning, truncated: m.truncated, muted: m.muted })
      }
    } else {
      turn = null
      out.push(m)
    }
  }
  return out
})

// Signed-in user, for the user-message avatar. Mirrors ChatPane's colour-from-id
// + initials fallback; no avatar image is actually wired anywhere yet.
const selfUser  = computed(() => authService.currentUser || null)
const selfLabel = computed(() => selfUser.value?.name || selfUser.value?.email || 'you')

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

// Compact name preview for a grouped run of tool calls, collapsing consecutive
// duplicates ("read_file ×3") and truncating long bursts.
function toolNames(tools) {
  const out = []
  for (const t of tools) {
    const last = out[out.length - 1]
    if (last && last.name === t.name) last.count++
    else out.push({ name: t.name, count: 1 })
  }
  const parts = out.map(e => e.count > 1 ? `${e.name} ×${e.count}` : e.name)
  if (parts.length > 4) return parts.slice(0, 4).join(', ') + `, +${parts.length - 4} more`
  return parts.join(', ')
}

// Auto-scroll on new message
watch(() => messages.value.length, async () => {
  await nextTick()
  if (scrollEl.value) scrollEl.value.scrollTop = scrollEl.value.scrollHeight
})
</script>

