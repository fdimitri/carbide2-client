<!-- AgentPane — talk to a worker-side LLM agent. Renders a unified
     timeline of user messages, assistant replies, and collapsible
     tool_call / tool_result blocks emitted by AgentSession in
     worker/agent_session.rb. -->
<template>
  <div class="flex flex-col flex-1 min-h-0 monaco-bg monaco-fg overflow-hidden">

    <!-- Toolbar: agent picker + new conversation -->
    <PaneToolbar class="text-ui-md">
      <label class="opacity-70">Agent:</label>
      <select
        :value="selectedSlug || ''"
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
        <span v-if="convoStatus === 'thinking'" class="text-ui-xs opacity-70 italic">thinking…</span>
        <UiButton
          size="xs"
          :disabled="!convId || exporting"
          title="Export this conversation as JSON"
          @click="onExport"
        >Export</UiButton>
        <UiButton
          size="xs"
          @click="onReset"
          :disabled="convoStatus === 'thinking'"
          title="Start a fresh conversation"
        >New</UiButton>
        <UiButton
          size="xs"
          :disabled="!convId || convoStatus === 'thinking'"
          title="Fork this conversation at its latest turn"
          @click="onFork"
        >Fork</UiButton>
      </span>
    </PaneToolbar>

    <!-- Status bar: conversation token totals (cached / missed / completion) -->
    <div v-if="convId" class="flex items-center gap-3 px-3 py-1 text-ui-xs text-muted border-b border-line/60">
      <span title="Cache hits (prompt tokens served from cache)">cached {{ fmtCost(usageTotals.cached) }}</span>
      <span title="Cache misses (prompt tokens re-prefilled uncached)">missed {{ fmtCost(usageTotals.missed) }}</span>
      <span title="Completion (output) tokens">out {{ fmtCost(usageTotals.completion) }}</span>
    </div>

    <!-- Conversation picker + visibility -->
    <PaneToolbar class="text-ui-sm">
      <label class="opacity-70">Conversation:</label>
      <select
        :value="convId || ''"
        @change="onPickConversation($event.target.value)"
        class="flex-1 min-w-0 px-1.5 py-0.5 rounded-ui-xs border monaco-input-bg monaco-input-fg monaco-input-border outline-none"
      >
        <option value="">— current (new) —</option>
        <option v-for="c in store.agentRecent" :key="c.conversation_id" :value="c.conversation_id">
          {{ conversationLabel(c) }}
        </option>
      </select>
      <UiButton
        v-if="convId && convoMeta.ownerIsSelf"
        size="xs"
        @click="onToggleVisibility"
        :title="convoMeta.visibility === 'project' ? 'Click to make private' : 'Click to share with project'"
      >
        {{ convoMeta.visibility === 'project' ? '🌐 shared' : '🔒 private' }}
      </UiButton>
      <span
        v-else-if="convId && !convoMeta.ownerIsSelf"
        class="text-ui-xs opacity-60 italic"
        :title="'Owned by another user — read-only view'"
      >watching</span>
      <UiButton
        size="xs"
        variant="warn"
        :disabled="convoStatus !== 'thinking'"
        title="Stop the agent (interrupt model + tool activity)"
        @click="onStop"
      >Stop</UiButton>
    </PaneToolbar>

    <!-- Debug expand: tombstone (clean) tool history (ADR-033 phase 1) -->
    <details class="mx-3 mb-2 text-ui-sm">
      <summary class="cursor-pointer select-none opacity-70 hover:opacity-100 py-0.5">Clean (tombstone) tool history</summary>
      <div class="flex flex-col gap-2 mt-2 p-2 rounded-ui-sm bg-white/[0.03]">
        <div class="flex items-center gap-2">
          <label class="opacity-70 shrink-0">Scope</label>
          <select v-model="cleanScope" class="px-1.5 py-0.5 rounded-ui-xs border monaco-input-bg monaco-input-fg monaco-input-border outline-none">
            <option value="both">results + call text</option>
            <option value="results">results only</option>
            <option value="calls">call text only</option>
          </select>
          <label class="opacity-70 shrink-0">Mode</label>
          <select v-model="cleanMode" class="px-1.5 py-0.5 rounded-ui-xs border monaco-input-bg monaco-input-fg monaco-input-border outline-none">
            <option value="first_n">first N items</option>
            <option value="n_size">N bytes</option>
            <option value="before_datetime">before date/time</option>
          </select>
        </div>
        <div class="flex items-center gap-2">
          <UiInput
            v-if="cleanMode === 'before_datetime'"
            v-model="cleanParam"
            type="datetime-local"
            class="flex-1"
            size="sm"
            placeholder="cutoff"
          />
          <UiInput
            v-else
            v-model.number="cleanParam"
            type="number"
            min="1"
            class="flex-1"
            size="sm"
            :placeholder="cleanMode === 'first_n' ? 'N items' : 'N bytes'"
          />
          <UiButton size="xs" @click="onCleanPreview">Preview</UiButton>
          <UiButton size="xs" variant="warn" :disabled="!cleanPreview" @click="onCleanConfirm">Clean</UiButton>
        </div>
        <div v-if="cleanPreview" class="text-ui-xs opacity-80">
          <div>evictable: {{ cleanPreview.total_results }} results · {{ cleanPreview.total_calls }} calls · {{ formatBytes(cleanPreview.total_bytes) }}</div>
          <div>would remove: {{ cleanPreview.removed_results }} results · {{ cleanPreview.removed_calls }} calls · {{ formatBytes(cleanPreview.bytes_reclaimed) }}</div>
          <div v-if="cleanPreview.verdict">
            verdict: <span :class="cleanPreview.verdict === 'extend' ? 'text-amber' : 'text-accent-fg'">{{ cleanPreview.verdict }}</span>
            · f={{ (cleanPreview.f * 100).toFixed(0) }}%
            · surcharge ≈ {{ cleanPreview.surcharge != null ? cleanPreview.surcharge.toFixed(2) + '×' : '—' }}
            · {{ cleanPreview.recovery_turns != null ? 'recovery ~' + cleanPreview.recovery_turns + ' turns' : 'no recovery' }}
          </div>
        </div>
        <div v-if="cleanResult" class="text-ui-xs text-accent-fg">
          removed: {{ cleanResult.removed_results }} results · {{ cleanResult.removed_calls }} calls · {{ formatBytes(cleanResult.bytes_reclaimed) }}
        </div>
      </div>
    </details>

    <!-- Timeline -->
    <div class="flex-1 overflow-y-auto p-3 flex flex-col gap-2 min-h-0" ref="scrollEl" @scroll="onScroll">
      <div v-if="!messages.length && !selectedSlug && store.agentListLoaded && !agents.length" class="flex-1 grid place-items-center monaco-line-fg p-4 text-ui-lg">
        No agents seeded. Run <code>rails db:seed</code>.
      </div>
      <div v-else-if="!messages.length && !selectedSlug" class="flex-1 grid place-items-center monaco-line-fg p-4 text-ui-lg">
        Loading agents…
      </div>
      <div v-else-if="!messages.length" class="flex-1 grid place-items-center monaco-line-fg p-4 text-ui-lg">
        Ask {{ activeAgentName }} something.
      </div>

      <div
        v-for="m in timeline"
        :key="m._uid"
        v-memo="[m._sig]"
      >
        <!-- User — left-aligned, avatar + name, same language as ChatPane -->
        <div v-if="m.kind === 'user'" class="flex items-start gap-2">
          <Avatar :id="m.user_id != null ? m.user_id : selfLabel" :name="userLabel(m)" />
          <div class="flex flex-col min-w-0 gap-1">
            <span class="text-ui-md font-semibold">{{ userLabel(m) }}</span>
            <div
              v-if="m.images && m.images.length"
              class="flex flex-wrap gap-1 max-w-full"
            >
              <img
                v-for="(img, ii) in m.images"
                :key="ii"
                :src="`data:${img.mime};base64,${img.base64}`"
                class="max-h-40 max-w-64 rounded-ui-xs border monaco-panel-border"
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
          <Avatar :id="selectedSlug || activeAgentName" :name="activeAgentName" />
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
                <span
                  v-if="item.stopped"
                  class="self-start text-ui-2xs uppercase tracking-wider px-1.5 py-0 rounded-ui-xs border border-amber-600/60 text-amber-400 font-semibold"
                  title="Stopped by a project member"
                >stopped</span>
                <details
                  v-if="item.reasoning"
                  class="text-ui-xs rounded-ui-sm bg-white/[0.05]"
                  :open="reasoningIsOpen(m._uid, ii, item.streaming)"
                  @toggle="onReasoningToggle(m._uid, ii, $event)"
                >
                  <summary class="cursor-pointer select-none font-mono opacity-45 hover:opacity-75 marker:opacity-30 px-2 py-0.5 truncate">reasoning · {{ item.reasoning.length }} chars<span v-if="item.streaming" class="opacity-60"> · thinking…</span></summary>
                  <!-- Progressive markdown: finished blocks parse once and
                       freeze; the streaming tail stays plain text. -->
                  <div class="markdown-body text-ui-md px-2 pb-1 opacity-90">
                    <template v-for="blk in renderMarkdownBlocks(item.reasoning, item.streaming)" :key="blk.key">
                      <div v-if="blk.kind === 'html'" v-memo="[blk.content]" v-html="blk.content"></div>
                      <div v-else v-memo="[blk.content]" class="whitespace-pre-wrap break-words">{{ blk.content }}</div>
                    </template>
                  </div>
                </details>
                <div
                  class="markdown-body text-ui-lg leading-normal break-words"
                  :class="item.muted ? 'opacity-60 italic' : ''"
                >
                  <template v-for="blk in renderMarkdownBlocks(item.text, item.streaming)" :key="blk.key">
                    <div v-if="blk.kind === 'html'" v-memo="[blk.content]" v-html="blk.content"></div>
                    <div v-else v-memo="[blk.content]" class="whitespace-pre-wrap">{{ blk.content }}</div>
                  </template>
                </div>
              </template>
            </template>
          </div>
        </div>

        <!-- System / error -->
        <div v-else-if="m.kind === 'error'" class="text-ui-sm text-red-400 italic">
          {{ m.text }}
        </div>
        <!-- Per-turn fork marker (ADR-032): fork at this logical turn's boundary -->
        <div v-else-if="m.kind === 'turn_fork'" class="flex items-center gap-2 pl-2 text-ui-xs opacity-70">
          <UiButton
            size="xs"
            :disabled="convoStatus === 'thinking'"
            title="Fork the conversation up to and including this turn"
            @click="onForkAt(m.fork_at_turn)"
          >⤴ fork</UiButton>
          <span v-if="usageByTurn[m.agent_turn_id]" class="text-muted" :title="usageTooltip(usageByTurn[m.agent_turn_id])">
            ≈ {{ fmtCost(usageByTurn[m.agent_turn_id].cost) }} tok
          </span>
        </div>
        <div v-else class="text-ui-sm opacity-60 italic">{{ m.text }}</div>
      </div>
      <!-- Bottom sentinel: autoscroll anchors to this element via
           scrollIntoView instead of reading scrollHeight and writing
           scrollTop. Always rendered as the last child of the scroll
           container so the browser resolves real geometry and scrolls
           atomically (no forced layout read in the stream hot path). -->
      <div ref="bottomRef" class="h-px shrink-0" aria-hidden="true"></div>
    </div>

    <!-- Composer (isolated so typing doesn't re-render the timeline) -->
    <Composer :connected="connected" :agent-slug="selectedSlug" :agent-status="convoStatus" @send="onComposerSend" />
  </div>
</template>

<script setup>
import { ref, computed, watch, nextTick, onMounted, onBeforeUnmount } from 'vue'
import { useWorkspaceStore } from '../../stores/workspaceStore'
import { renderMarkdownBlocks } from '../../utils/markdown'
import UiButton from '../ui/UiButton.vue'
import UiInput from '../ui/UiInput.vue'
import PaneToolbar from '../ui/PaneToolbar.vue'
import Avatar from '../ui/Avatar.vue'
import Composer from './Composer.vue'
import authService from '../../services/authService'
import { exportConversation } from '../../services/agentService'

const props = defineProps({
  connected: { type: Boolean, default: false },
  conversationId: { type: String, default: null },
  agentSlug: { type: String, default: null },
  projectId: { type: [Number, String], required: true },
})
const emit = defineEmits(['agent-send', 'agent-reset', 'agent-pick', 'agent-load', 'agent-set-visibility', 'agent-stop', 'agent-create', 'agent-clean', 'agent-fork'])

const store    = useWorkspaceStore()
const scrollEl = ref(null)
const exporting = ref(false)

const agents   = computed(() => store.agentList || [])
const convId   = computed(() => props.conversationId || null)
const messages = computed(() => store.agentMessagesFor(convId.value))
const usageRows = computed(() => store.agentUsageFor(convId.value))
const convoStatus = computed(() => store.agentStatusFor(convId.value))
const convoMeta   = computed(() => store.agentMetaFor(convId.value))
const selectedSlug = computed(() => props.agentSlug || convoMeta.value.agentSlug || null)

// Merge each tool_call with its matching tool_result (same call id) into a
// single row, so a tool invocation reads as one line — name(args) → summary —
// instead of two stacked boxes. Then everything the agent emits in one turn
// (its tool calls + its reply) is grouped under a single Coder turn, so tool
// calls are attributed to the agent — not left dangling under the user message.
// Within a turn, consecutive tool rows coalesce into one collapsible group.
// Stable per-source-message ids so v-for keys stay put when `timeline`
// re-derives on every streamed delta (index keys forced the whole list to
// re-render each token). The WeakMap ties an id to object identity without
// mutating the reactive source messages.
const _uidMap = new WeakMap()
let _uidSeq = 0
function uidFor(o) {
  let id = _uidMap.get(o)
  if (id === undefined) { id = ++_uidSeq; _uidMap.set(o, id) }
  return id
}

// A render signature for a turn: changes only while the turn is streaming or a
// tool result lands, so `v-memo` can skip re-rendering turns that haven't
// changed — the fix for the O(n) full-list re-render on every token.
function turnSig(items) {
  let s = ''
  for (const it of items) {
    if (it.type === 'tools') {
      s += 'T'
      for (const t of it.tools) s += t.done ? 'd' : 'p'
    } else {
      s += 'X' + (it.text || '').length + ':' + (it.reasoning || '').length +
           ':' + (it.streaming ? 1 : 0) + ':' + (it.truncated ? 1 : 0) + ':' + (it.muted ? 1 : 0) +
           ':' + (it.stopped ? 1 : 0)
    }
    s += '|'
  }
  return s
}

const timeline = computed(() => {
  // Fork boundaries: agent_turn_id -> last message turn in that logical turn.
  const boundary = new Map()
  for (const m of messages.value) {
    if (m.agent_turn_id == null) continue
    const cur = boundary.get(m.agent_turn_id)
    if (cur == null || m.turn > cur) boundary.set(m.agent_turn_id, m.turn)
  }
  const forkTurns = new Set(boundary.values())

  // Pass 1: merge tool_call + tool_result by id into one `tool` row. Each row
  // carries the source message's stable uid so turn keys don't shift.
  const merged = []
  const byId = new Map()
  for (const m of messages.value) {
    if (m.kind === 'tool_call') {
      const row = { kind: 'tool', id: m.id, name: m.name, args: m.args, result: undefined, done: false, turn: m.turn, agent_turn_id: m.agent_turn_id, _uid: uidFor(m) }
      if (m.id != null) byId.set(m.id, row)
      merged.push(row)
    } else if (m.kind === 'tool_result') {
      const row = m.id != null ? byId.get(m.id) : null
      if (row) { row.result = m.result; row.done = true; row.turn = m.turn; row.agent_turn_id = m.agent_turn_id }
      else merged.push({ kind: 'tool', id: m.id, name: m.name, result: m.result, done: true, turn: m.turn, agent_turn_id: m.agent_turn_id, _uid: uidFor(m) })
    } else {
      merged.push(m)
    }
  }
  // Pass 2: fold agent-side entries (tools + assistant text) into Coder turns.
  const out = []
  let turn = null
  for (const m of merged) {
    if (m.kind === 'tool' || m.kind === 'assistant') {
      if (!turn) { turn = { kind: 'assistant_turn', items: [], _uid: (m._uid ?? uidFor(m)), turn: null, agent_turn_id: null }; out.push(turn) }
      if (m.kind === 'tool') {
        const last = turn.items[turn.items.length - 1]
        if (last && last.type === 'tools') last.tools.push(m)
        else turn.items.push({ type: 'tools', tools: [m] })
      } else {
        turn.items.push({ type: 'text', text: m.text, reasoning: m.reasoning, truncated: m.truncated, muted: m.muted, streaming: m.streaming, stopped: m.stopped })
      }
      if (m.turn != null) turn.turn = Math.max(turn.turn ?? -1, m.turn)
      if (m.agent_turn_id != null) turn.agent_turn_id = m.agent_turn_id
    } else {
      turn = null
      out.push({ ...m, _uid: uidFor(m), _sig: 'x' + (m.text || '').length + ':' + (m.images ? m.images.length : 0) })
    }
  }
  // Signature per turn so v-memo skips settled turns.
  for (const row of out) {
    if (row.kind === 'assistant_turn') row._sig = turnSig(row.items)
  }
  // Emit a per-turn fork marker after each completed logical turn (assistant
  // rows only; a user-only turn is not a valid fork point).
  const withForks = []
  for (const row of out) {
    withForks.push(row)
    if (row.kind === 'assistant_turn' && row.turn != null && forkTurns.has(row.turn)) {
      withForks.push({
        kind: 'turn_fork',
        fork_at_turn: row.turn,
        agent_turn_id: row.agent_turn_id,
        _uid: `fork_${row.turn}`,
        _sig: `fork:${row.turn}`,
      })
    }
  }
  return withForks
})

// Reasoning disclosure open state. Defaults to open-while-streaming and
// closed once the turn finalizes; a user's manual toggle is remembered per
// reasoning block (keyed by turn uid + item index) so expanding it survives
// the streaming→done collapse instead of being yanked shut (#64 follow-up).
const reasoningOpen = ref(new Map())   // "turnUid:itemIndex" -> boolean (user override)

function reasoningIsOpen(turnUid, itemIndex, streaming) {
  const key = `${turnUid}:${itemIndex}`
  const m = reasoningOpen.value
  return m.has(key) ? m.get(key) : streaming
}

function onReasoningToggle(turnUid, itemIndex, event) {
  const key = `${turnUid}:${itemIndex}`
  const next = new Map(reasoningOpen.value)
  next.set(key, event.currentTarget?.open ?? false)
  reasoningOpen.value = next
}

// Signed-in user, for the user-message avatar. Mirrors ChatPane's colour-from-id
// + initials fallback; no avatar image is actually wired anywhere yet.
const selfUser  = computed(() => authService.currentUser || null)
const selfLabel = computed(() => selfUser.value?.name || selfUser.value?.email || 'you')

// Per-message author label: the worker injects user_id + name for user turns;
// fall back to the viewer only for legacy rows that predate #79.
function userLabel(m) {
  if (m?.name) return m.name
  if (m?.user_id != null) return String(m.user_id)
  return selfLabel.value
}

const activeAgent = computed(() =>
  agents.value.find(a => a.slug === selectedSlug.value) || null
)
const activeAgentName = computed(() => activeAgent.value?.name || 'agent')
const activeAgentMeta = computed(() => {
  const a = activeAgent.value
  if (!a) return ''
  const tools = Array.isArray(a.tools) && a.tools.length ? `· ${a.tools.length} tool${a.tools.length === 1 ? '' : 's'}` : '· no tools'
  return `${a.model || ''} ${tools}`.trim()
})
const activeAgentDescription = computed(() => activeAgent.value?.description || '')

// The composer owns draft + image state; re-pin to the bottom on send.
function onComposerSend(text, images) {
  pinned = true
  emit('agent-send', text, images)
}

function onReset()  { emit('agent-reset') }
function onPickAgent(slug) { emit('agent-pick', slug) }
function onStop()   { emit('agent-stop') }
function onFork()   { emit('agent-fork', null) }
function onForkAt(turn) { emit('agent-fork', turn) }

// ADR-032/033: per-turn token cost, from cached/uncached usage deltas.
// Cached input costs ~1/3 of uncached; completion output is full price.
// Cost is normalized to uncached-input units: cached/3 + uncached + completion.
// Deltas (turn - last_turn) attribute prompt growth to a turn.
function tokenCost(row) {
  const cached = row?.cached_tokens || 0
  const uncached = row?.uncached_tokens || 0
  const completion = row?.completion_tokens || 0
  return cached / 3 + uncached + completion
}

// Group usage rows by logical turn; each turn's cost is the sum of its
// requests' costs. Returns { [agent_turn_id]: { cached, uncached, completion, cost } }.
const usageByTurn = computed(() => {
  const map = {}
  for (const r of usageRows.value) {
    const tid = r.agent_turn_id
    if (tid == null) continue
    const e = (map[tid] ||= { cached: 0, uncached: 0, completion: 0, cost: 0 })
    e.cached    += r.cached_tokens || 0
    e.uncached  += r.uncached_tokens || 0
    e.completion += r.completion_tokens || 0
    e.cost      += tokenCost(r)
  }
  return map
})

function fmtCost(c) {
  if (c == null || !c) return ''
  if (c < 1000) return `${Math.round(c)}`
  if (c < 1000000) return `${(c / 1000).toFixed(1)}k`
  return `${(c / 1000000).toFixed(2)}M`
}

function usageTooltip(e) {
  return `cached ${e.cached} · uncached ${e.uncached} · completion ${e.completion} · cost ${Math.round(e.cost)} tok`
}

// Conversation-wide totals for the status bar: cached (cache hits) vs missed
// (uncached prompt tokens that re-prefilled), plus completion output.
const usageTotals = computed(() => {
  let cached = 0, missed = 0, completion = 0
  for (const r of usageRows.value) {
    cached     += r.cached_tokens || 0
    missed     += r.uncached_tokens || 0
    completion += r.completion_tokens || 0
  }
  return { cached, missed, completion }
})

// ADR-033 phase 1: clean (tombstone) tool history. Preview does a dry-run;
// confirm evicts. The preview/result land in store.agentCleanByConversation.
const cleanMode  = ref('first_n')
const cleanScope = ref('both')
const cleanParam = ref(null)

const cleanInfo    = computed(() => store.agentCleanFor(convId.value))
const cleanPreview = computed(() => cleanInfo.value.preview || null)
const cleanResult  = computed(() => cleanInfo.value.result || null)

function cleanPayload(dryRun) {
  const p = { dryRun, mode: cleanMode.value, scope: cleanScope.value }
  if (cleanMode.value === 'before_datetime') {
    p.cutoff = cleanParam.value ? new Date(cleanParam.value).toISOString() : ''
  } else if (cleanMode.value === 'first_n') {
    p.n = cleanParam.value
  } else {
    p.bytes = cleanParam.value
  }
  return p
}
function onCleanPreview() { emit('agent-clean', cleanPayload(true)) }
function onCleanConfirm() { emit('agent-clean', cleanPayload(false)) }

function formatBytes(n) {
  if (n == null) return '—'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(2)} MB`
}

// Export the current conversation as a JSON file (#33). The server returns
// lossless JSON; we wrap it in a Blob and trigger a browser download.
async function onExport() {
  if (!convId.value || exporting.value) return
  exporting.value = true
  try {
    const data = await exportConversation(props.projectId, convId.value)
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href     = url
    a.download = `agent-conversation-${convId.value.slice(0, 8)}.json`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  } catch (e) {
    window.alert(e?.response?.data?.error || e?.message || 'export failed')
  } finally {
    exporting.value = false
  }
}

function onPickConversation(id) {
  if (!id) { emit('agent-reset'); return }
  if (id === convId.value) return
  emit('agent-load', id)
}

function onToggleVisibility() {
  const next = convoMeta.value.visibility === 'project' ? 'private' : 'project'
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

// ── Scroll management ────────────────────────────────────────────────────
// Default position is the newest content (bottom). We remember an explicit
// scrollTop only when the user scrolls AWAY from the bottom (they're reading
// older content); otherwise the position is just "bottom", so content growth
// while away doesn't leave a stale pixel offset. Positions are keyed per
// conversation id.
const STICK_PX = 48
let pinned = true
const scrollPositions = new Map()   // conversationId -> scrollTop (only when not at bottom)
const bottomRef = ref(null)

function convoKey() {
  return convId.value || '__new__'
}

function atBottom() {
  const el = scrollEl.value
  if (!el || el.clientHeight === 0) return true
  return el.scrollHeight - el.scrollTop - el.clientHeight <= STICK_PX
}

// Scroll by anchoring the bottom sentinel to the end of the scrollport.
// scrollIntoView does the layout + scroll atomically, so this never forces
// a JS-side geometry read before the write (scrollTop = scrollHeight does).
function scrollToBottom() {
  bottomRef.value?.scrollIntoView({ block: 'end' })
}

// Coalesce autoscroll to at most once per animation frame. The stream commits
// ~25 batches/sec (40ms throttle); scrolling each batch is wasteful and each
// scroll invalidation re-triggers layout anyway.
let scrollRaf = null
function scheduleScrollToBottom() {
  if (!pinned || scrollRaf != null) return
  scrollRaf = requestAnimationFrame(() => {
    scrollRaf = null
    // Re-check at frame time: the user may have scrolled up between the
    // schedule call and this frame. Only follow the sentinel if still pinned.
    if (pinned) scrollToBottom()
  })
}

function savePosition() {
  const el = scrollEl.value
  if (!el || el.clientHeight === 0) return
  if (atBottom()) scrollPositions.delete(convoKey())
  else scrollPositions.set(convoKey(), el.scrollTop)
}

function applyPosition() {
  const el = scrollEl.value
  if (!el || el.clientHeight === 0) return
  const saved = scrollPositions.get(convoKey())
  if (saved != null) {
    el.scrollTop = saved
    pinned = false
  } else {
    scrollToBottom()
    pinned = true
  }
}

// Only unpin when the user actively scrolls away from the bottom, so we never
// yank them back while they're reading earlier output. Ignore scroll events
// while hidden (v-show collapses clientHeight to 0).
function onScroll() {
  const el = scrollEl.value
  if (!el || el.clientHeight === 0) return
  pinned = atBottom()
  savePosition()
}

const scrollSignal = computed(() => {
  const arr  = messages.value
  const last = arr[arr.length - 1]
  const tail = last ? `${(last.text || '').length}:${(last.reasoning || '').length}` : ''
  return `${arr.length}:${tail}`
})

// Follow streaming + new user turns when pinned (e.g. sending a question).
watch(scrollSignal, async () => {
  if (!pinned) return
  await nextTick()
  scheduleScrollToBottom()
})

// Conversation switch: restore the remembered position for that conversation,
// or default to the bottom (newest content) for a first visit.
watch(() => props.conversationId, async () => {
  await nextTick()
  applyPosition()
})

// When the pane is re-shown after being hidden with v-show, its clientHeight
// goes 0 -> real; re-apply the remembered position (which was a no-op while
// hidden). Also covers the initial mount. While pinned to the bottom, any
// height change to the scroll viewport (e.g. the composer shrinking back to
// one line after a send) re-pins to the new bottom — otherwise the last few
// pixels of the just-sent message stay hidden.
let lastClientHeight = 0
function onResizeObserved() {
  const el = scrollEl.value
  if (!el) return
  const h = el.clientHeight
  if (h > 0 && lastClientHeight === 0) {
    applyPosition()
  } else if (h > 0 && h !== lastClientHeight && pinned) {
    scrollToBottom()
  }
  lastClientHeight = h
}

let resizeObserver = null

onMounted(async () => {
  await nextTick()
  applyPosition()
  if (scrollEl.value && typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(onResizeObserved)
    resizeObserver.observe(scrollEl.value)
  }
})

onBeforeUnmount(() => {
  if (scrollRaf != null) {
    cancelAnimationFrame(scrollRaf)
    scrollRaf = null
  }
  if (resizeObserver) {
    resizeObserver.disconnect()
    resizeObserver = null
  }
})
</script>

