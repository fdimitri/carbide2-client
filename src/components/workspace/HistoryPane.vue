<template>
  <div class="flex flex-col h-full overflow-hidden">
    <!-- Toolbar -->
    <div class="flex items-center gap-3 px-3 py-1 bg-bg-2 border-b border-line text-ui-sm shrink-0">
      <i class="pi pi-history text-muted text-ui-xs"></i>
      <span class="font-medium truncate" :title="path || fileId">{{ filename }}</span>
      <span class="text-muted">history</span>

      <label class="flex items-center gap-1 text-muted" title="Split one author's run at a pause longer than this">
        pause
        <select
          v-model.number="gapMs"
          class="px-1.5 py-0.5 rounded-ui-xs border monaco-input-bg monaco-input-fg monaco-input-border outline-none"
        >
          <option v-for="g in GAPS" :key="g.ms" :value="g.ms">{{ g.label }}</option>
        </select>
      </label>

      <label class="flex items-center gap-1 text-muted" title="Show the auto-branches a rebase leaves behind (debugging)">
        <input v-model="showAuto" type="checkbox" class="accent-current" />
        auto-branches
      </label>

      <button class="ui-btn ui-btn-ghost ui-btn-sm" :disabled="loading" title="Reload" @click="fetchDag">
        <i class="pi pi-refresh text-ui-xs"></i>
      </button>

      <span class="text-muted text-ui-xs hidden lg:inline">right-click a node to load it</span>

      <span class="ml-auto text-muted text-ui-xs whitespace-nowrap">
        <template v-if="loading">loading…</template>
        <template v-else-if="graph">{{ rows.length }} nodes · {{ revisionCount }} revisions · {{ laneCount }} lane{{ laneCount === 1 ? '' : 's' }}</template>
      </span>
    </div>

    <div v-if="error" class="px-3 py-1 bg-bg-2 border-b border-line text-ui-sm text-warn shrink-0">{{ error }}</div>
    <div v-if="notice" class="px-3 py-1 bg-bg-2 border-b border-line text-ui-sm text-muted italic shrink-0">{{ notice }}</div>

    <!-- Rail + rows -->
    <div class="flex-1 overflow-auto">
      <div v-if="graph && rows.length === 0" class="p-4 text-muted text-ui-sm italic">No revisions.</div>
      <div v-else-if="graph" class="relative" :style="{ height: `${rows.length * ROW_H}px` }">
        <svg
          class="absolute left-0 top-0 pointer-events-none"
          :width="railWidth"
          :height="rows.length * ROW_H"
        >
          <path
            v-for="(s, i) in segments"
            :key="i"
            :d="segmentPath(s, geometry)"
            :stroke="laneColor(s.lane)"
            :stroke-dasharray="s.kind === 'second_parent' ? '3 3' : null"
            stroke-width="2"
            fill="none"
          />
          <g v-for="(r, i) in rows" :key="r.node.id">
            <circle
              :cx="PAD_X + r.lane * LANE_W"
              :cy="PAD_Y + i * ROW_H"
              :r="r.node.count > 1 ? 5 : 3.5"
              :fill="isHead(r.node) ? laneColor(r.lane) : 'var(--color-bg-1, #111)'"
              :stroke="laneColor(r.lane)"
              stroke-width="2"
            />
          </g>
        </svg>

        <div :style="{ paddingLeft: `${railWidth}px` }">
          <div
            v-for="r in rows"
            :key="r.node.id"
            class="flex items-center gap-2 px-2 text-ui-sm whitespace-nowrap hover:bg-bg-2/60 cursor-context-menu"
            :class="{ 'bg-bg-2': menuNode && menuNode.id === r.node.id }"
            :style="{ height: `${ROW_H}px` }"
            :title="rowTitle(r.node)"
            @contextmenu.prevent="onNodeContextMenu($event, r.node)"
            @dblclick="loadIntoEditor(r.node)"
          >
            <button
              v-for="h in headsAt(r.node.id)"
              :key="h.branch"
              class="px-1.5 rounded-ui-xs text-ui-xs font-medium leading-5"
              :style="{ background: laneColor(r.lane), color: '#fff' }"
              :title="`Switch the ${filename} tab to ${h.branch}`"
              @click="switchTo(h.branch)"
            >{{ h.branch }}</button>

            <span class="text-muted text-ui-xs" v-if="!isHead(r.node) && r.node.branch !== mainBranchName">{{ r.node.branch }}</span>

            <span>{{ r.node.count }} {{ r.node.count === 1 ? 'edit' : 'edits' }}</span>
            <span class="text-muted">{{ kindsSummary(r.node) }}</span>
            <span class="text-muted">by {{ userName(r.node.user_id) }}</span>
            <span class="text-muted text-ui-xs">{{ timeSpan(r.node) }}</span>

            <span
              v-if="r.node.rebased"
              class="px-1.5 rounded-ui-xs text-ui-xs border border-line text-muted"
              :title="`Authored against an older revision; kept as written on ${r.node.rebased.branch} (${r.node.rebased.count} edits), then rebased here`"
            >rebased</span>

            <span class="ml-auto font-mono text-ui-xs text-muted">{{ r.node.id.slice(0, 8) }}</span>
          </div>
        </div>
      </div>
      <div v-else-if="!loading && !error" class="p-4 text-muted text-ui-sm italic">Waiting for the worker…</div>
    </div>

    <ContextMenu ref="nodeMenu" :model="menuItems" class="tree-context-overlay" @hide="menuNode = null" />
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import ContextMenu from 'primevue/contextmenu'
import workerSocket from '../../services/workerSocket'
import { MAIN_BRANCH, useSessionStore } from '../../stores/sessionStore'
import { useWorkspaceStore } from '../../stores/workspaceStore'
import { layoutRail, segmentPath } from '../../utils/railLayout'

const props = defineProps({
  fileId: { type: String, required: true },
  path:   { type: String, default: '' },
})

// open-file-at(view): ProjectPage opens (or focuses) the file's tab and points
// it at { revision } (pinned, read-only) or { branch } (live).
const emit = defineEmits(['open-file-at'])

const store   = useWorkspaceStore()
const session = useSessionStore()
const docBranch = () => session.fileTabView(props.fileId).branch || MAIN_BRANCH

const GAPS = [
  { ms: 0,      label: 'off' },
  { ms: 1000,   label: '1 s' },
  { ms: 3000,   label: '3 s' },
  { ms: 10000,  label: '10 s' },
  { ms: 60000,  label: '1 min' },
]
const ROW_H  = 28
const LANE_W = 14
const PAD_X  = 12
const PAD_Y  = ROW_H / 2
const PALETTE = ['#4f8ef7', '#f79a4f', '#5fc37a', '#d96ed9', '#e05c5c', '#3cb8c4', '#c9b23a', '#9b7bff']

const mainBranchName = MAIN_BRANCH
const filename = computed(() => (props.path || props.fileId).split('/').pop() || props.fileId)

const gapMs    = ref(3000)
const showAuto = ref(false)
const graph    = ref(null)
const loading  = ref(false)
const error    = ref('')
const notice   = ref('')

const layout = computed(() => graph.value
  ? layoutRail(graph.value.nodes || [], graph.value.edges || [])
  : { rows: [], segments: [], laneCount: 0 })
const rows      = computed(() => layout.value.rows)
const segments  = computed(() => layout.value.segments)
const laneCount = computed(() => layout.value.laneCount)
const railWidth = computed(() => PAD_X * 2 + Math.max(0, laneCount.value - 1) * LANE_W)
const geometry  = computed(() => ({ laneWidth: LANE_W, rowHeight: ROW_H, x0: PAD_X, y0: PAD_Y }))
const revisionCount = computed(() => (graph.value?.nodes || []).reduce((n, x) => n + (x.count || 0), 0))

const headsByNode = computed(() => {
  const m = new Map()
  for (const h of (graph.value?.heads || [])) {
    if (!m.has(h.revision)) m.set(h.revision, [])
    m.get(h.revision).push(h)
  }
  return m
})
function headsAt(id) { return headsByNode.value.get(id) || [] }
function isHead(node) { return headsByNode.value.has(node.id) }
function laneColor(lane) { return PALETTE[lane % PALETTE.length] }

function userName(userId) {
  if (userId == null) return 'system'
  if (String(userId) === String(store.currentUserId)) return 'you'
  return graph.value?.users?.[userId] || graph.value?.users?.[String(userId)] || `user ${userId}`
}

const KIND_SHORT = {
  insertDataSingleLine: '+', insertDataMultiLine: '+¶',
  deleteDataSingleLine: '−', deleteDataMultiLine: '−¶',
  replaceDataSingleLine: '±', replaceDataMultiLine: '±¶',
  setContents: '⟲', pcre: 're', writeBinary: 'bin',
}
function kindsSummary(node) {
  const kinds = node.kinds || {}
  return Object.entries(kinds)
    .sort((a, b) => b[1] - a[1])
    .map(([k, n]) => `${KIND_SHORT[k] || k}${n}`)
    .join(' ')
}

function fmtTime(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  const today = new Date().toDateString() === d.toDateString()
  return today ? d.toLocaleTimeString() : d.toLocaleString()
}
function timeSpan(node) {
  if (!node.from || !node.to || node.from === node.to) return fmtTime(node.to)
  const a = new Date(node.from), b = new Date(node.to)
  const sameDay = a.toDateString() === b.toDateString()
  return `${fmtTime(node.from)} – ${sameDay ? b.toLocaleTimeString() : fmtTime(node.to)}`
}
function rowTitle(node) {
  const lines = [
    `${node.count} revision${node.count === 1 ? '' : 's'} on ${node.branch}`,
    `${node.first === node.id ? node.id : `${node.first} … ${node.id}`}`,
    Object.entries(node.kinds || {}).map(([k, n]) => `${k}: ${n}`).join(', '),
  ]
  if (node.rebased) lines.push(`rebased from ${node.rebased.branch} (${node.rebased.count} edits as authored)`)
  return lines.filter(Boolean).join('\n')
}

// A head chip puts the file's tab on that branch (opening the tab if needed).
function switchTo(branch) {
  notice.value = ''
  emit('open-file-at', { branch, revision: null })
}

// ── Node context menu ────────────────────────────────────────────────────────
const nodeMenu = ref(null)
const menuNode = ref(null)
let   pendingBranch = ''   // name asked for by "Branch from here"; open it when created

function onNodeContextMenu(event, node) {
  menuNode.value = node
  nodeMenu.value?.show(event)
}

// The node is a run; its id is the LAST revision, i.e. the state after every
// edit in the run. That is what the editor shows.
function loadIntoEditor(node) {
  if (!node) return
  notice.value = ''
  emit('open-file-at', { revision: node.id })
}

function branchFromHere(node) {
  if (!node) return
  const name = window.prompt(`New branch of ${filename.value} at revision ${node.id.slice(0, 8)}:`, '')
  const trimmed = (name || '').trim()
  if (!trimmed) return
  pendingBranch = trimmed
  notice.value = ''
  workerSocket.send('fs', 'branch_create', { id: props.fileId, branch: docBranch(), name: trimmed, at_revision: node.id })
}

function onFsBranchCreated(payload) {
  scheduleRefresh(payload)
  if (!forThisFile(payload) || !pendingBranch || payload.name !== pendingBranch) return
  pendingBranch = ''
  emit('open-file-at', { branch: payload.name, revision: null })
}

const menuItems = computed(() => {
  const n = menuNode.value
  if (!n) return []
  const items = [
    { label: 'Load into editor', icon: 'pi pi-file-edit', command: () => loadIntoEditor(n) },
    { label: 'Branch from here…', icon: 'pi pi-sitemap', command: () => branchFromHere(n) },
  ]
  for (const h of headsAt(n.id)) {
    items.push({ label: `Switch editor to ${h.branch}`, icon: 'pi pi-arrow-right', command: () => switchTo(h.branch) })
  }
  items.push({ separator: true })
  items.push({ label: 'Copy revision id', icon: 'pi pi-copy', command: () => navigator.clipboard?.writeText(n.id) })
  if (n.first && n.first !== n.id) {
    items.push({ label: 'Copy first revision id', icon: 'pi pi-copy', command: () => navigator.clipboard?.writeText(n.first) })
  }
  return items
})

// ── Data ─────────────────────────────────────────────────────────────────────
function fetchDag() {
  if (!props.fileId || !store.wsConnected) return
  loading.value = true
  error.value = ''
  workerSocket.send('fs', 'dag', { id: props.fileId, branch: docBranch(), gap_ms: gapMs.value, auto: showAuto.value })
}

function forThisFile(payload) {
  const ok = payload?.id != null && String(payload.id) === String(props.fileId)
  if (ok && payload.path) {
    session.setFileTabLocation(props.fileId, payload.path, { branch: payload.branch || docBranch() })
  }
  return ok
}

function onFsDag(payload) {
  if (!forThisFile(payload)) return
  loading.value = false
  graph.value = payload
}

function onFsError(payload) {
  if (!forThisFile(payload) || !loading.value) return
  // Only errors while our own request is out; the file tab handles its own.
  loading.value = false
  error.value = payload.error || payload.message || 'unknown error'
}

// Any frame that changes this file's DAG re-fetches, debounced: keystrokes
// stream in per edit, the rail redraws at most every REFRESH_MS.
const REFRESH_MS = 1500
let refreshTimer = null
function scheduleRefresh(payload) {
  if (!forThisFile(payload)) return
  clearTimeout(refreshTimer)
  refreshTimer = setTimeout(fetchDag, REFRESH_MS)
}

const offs = [
  workerSocket.on('fs', 'dag',            onFsDag),
  workerSocket.on('fs', 'error',          onFsError),
  workerSocket.on('fs', 'written',        scheduleRefresh),
  workerSocket.on('fs', 'change',         scheduleRefresh),
  workerSocket.on('fs', 'set_contents',   scheduleRefresh),
  workerSocket.on('fs', 'branch_created', onFsBranchCreated),
  workerSocket.on('fs', 'branch_deleted', scheduleRefresh),
  workerSocket.on('fs', 'merged',         scheduleRefresh),
  workerSocket.on('system', 'connected',  () => fetchDag()),
]

watch([gapMs, showAuto, () => props.fileId], fetchDag)
onMounted(fetchDag)
onBeforeUnmount(() => {
  clearTimeout(refreshTimer)
  for (const off of offs) off()
})
</script>
