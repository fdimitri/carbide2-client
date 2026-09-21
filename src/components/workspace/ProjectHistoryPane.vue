<template>
  <div class="flex flex-col h-full overflow-hidden">
    <!-- Toolbar -->
    <div class="flex items-center gap-3 px-3 py-1 bg-bg-2 border-b border-line text-ui-sm shrink-0">
      <i class="pi pi-sitemap text-muted text-ui-xs"></i>
      <span class="font-medium">Project branches</span>

      <label class="flex items-center gap-1 text-muted" title="Split one author's run at a pause longer than this">
        pause
        <select
          v-model.number="gapMs"
          class="px-1.5 py-0.5 rounded-ui-xs border monaco-input-bg monaco-input-fg monaco-input-border outline-none"
        >
          <option v-for="g in GAPS" :key="g.ms" :value="g.ms">{{ g.label }}</option>
        </select>
      </label>

      <button class="ui-btn ui-btn-ghost ui-btn-sm" :disabled="loading" title="Reload" @click="fetchDag">
        <i class="pi pi-refresh text-ui-xs"></i>
      </button>

      <span class="text-muted text-ui-xs hidden lg:inline">right-click a node for its branch</span>

      <span class="ml-auto text-muted text-ui-xs whitespace-nowrap">
        <template v-if="loading">loading…</template>
        <template v-else-if="graph">{{ liveBranches.length }} branch{{ liveBranches.length === 1 ? '' : 'es' }} · {{ rows.length }} nodes · {{ laneCount }} lane{{ laneCount === 1 ? '' : 's' }}</template>
      </span>
    </div>

    <div v-if="error" class="px-3 py-1 bg-bg-2 border-b border-line text-ui-sm text-warn shrink-0">{{ error }}</div>

    <!-- Rail + rows -->
    <div class="flex-1 overflow-auto">
      <div v-if="graph && rows.length === 0" class="p-4 text-muted text-ui-sm italic">Nothing yet.</div>
      <div v-else-if="graph" class="relative" :style="{ height: `${rows.length * ROW_H}px` }">
        <svg class="absolute left-0 top-0 pointer-events-none" :width="railWidth" :height="rows.length * ROW_H">
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
              :r="r.node.kinds?.merged || r.node.kinds?.forked ? 5.5 : (r.node.count > 1 ? 5 : 3.5)"
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
            @dblclick="switchTo(r.node.branch)"
          >
            <button
              v-for="h in headsAt(r.node.id)"
              :key="h.branch"
              class="px-1.5 rounded-ui-xs text-ui-xs font-medium leading-5"
              :style="{ background: laneColor(r.lane), color: '#fff' }"
              :title="h.branch === currentBranch ? 'The workspace is on this branch' : `Switch the workspace to ${h.branch}`"
              @click="switchTo(h.branch)"
            >{{ h.branch }}<template v-if="h.branch === currentBranch"> ●</template></button>

            <span v-if="!isHead(r.node)" class="text-muted text-ui-xs">{{ r.node.branch }}</span>

            <span>{{ summary(r.node) }}</span>
            <span class="text-muted">by {{ userName(r.node.user_id) }}</span>
            <span class="text-muted text-ui-xs">{{ timeSpan(r.node) }}</span>

            <span class="ml-auto font-mono text-ui-xs text-muted" :title="`seq ${r.node.first_seq}…${r.node.seq}`">
              {{ r.node.first_seq === r.node.seq ? `#${r.node.seq}` : `#${r.node.first_seq}–${r.node.seq}` }}
            </span>
          </div>
        </div>
      </div>
      <div v-else-if="!loading && !error" class="p-4 text-muted text-ui-sm italic">Waiting for the worker…</div>
    </div>

    <ContextMenu ref="nodeMenu" :model="menuItems" class="tree-context-overlay" @hide="menuNode = null" />
  </div>
</template>

<script setup>
// ProjectHistoryPane — the project's branches as a rail (fs/project_dag).
// One lane per project branch; a node is a run of activity (edits, file
// events, a fork, a merge). Head chips switch the workspace; the context menu
// offers the branch's merges.
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import ContextMenu from 'primevue/contextmenu'
import workerSocket from '../../services/workerSocket'
import { MAIN_BRANCH, useSessionStore } from '../../stores/sessionStore'
import { useWorkspaceStore } from '../../stores/workspaceStore'
import { layoutRail, segmentPath } from '../../utils/railLayout'

const emit = defineEmits(['open-project-merge'])

const store   = useWorkspaceStore()
const session = useSessionStore()

const GAPS = [
  { ms: 0,      label: 'off' },
  { ms: 3000,   label: '3 s' },
  { ms: 60000,  label: '1 min' },
  { ms: 600000, label: '10 min' },
  { ms: 3600000, label: '1 h' },
]
const ROW_H  = 28
const LANE_W = 14
const PAD_X  = 12
const PAD_Y  = ROW_H / 2
const PALETTE = ['#4f8ef7', '#f79a4f', '#5fc37a', '#d96ed9', '#e05c5c', '#3cb8c4', '#c9b23a', '#9b7bff']

const gapMs   = ref(60000)
const graph   = ref(null)
const loading = ref(false)
const error   = ref('')

const currentBranch = computed(() => session.workspaceBranch || MAIN_BRANCH)
const liveBranches  = computed(() => (graph.value?.branches || []).filter((b) => !b.deleted))
const branchByName  = computed(() => new Map((graph.value?.branches || []).map((b) => [b.name, b])))

const layout = computed(() => graph.value
  ? layoutRail(graph.value.nodes || [], graph.value.edges || [])
  : { rows: [], segments: [], laneCount: 0 })
const rows      = computed(() => layout.value.rows)
const segments  = computed(() => layout.value.segments)
const laneCount = computed(() => layout.value.laneCount)
const railWidth = computed(() => PAD_X * 2 + Math.max(0, laneCount.value - 1) * LANE_W)
const geometry  = computed(() => ({ laneWidth: LANE_W, rowHeight: ROW_H, x0: PAD_X, y0: PAD_Y }))

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

const KIND_LABEL = {
  edit: ['edit', 'edits'], created: ['file created', 'files created'], deleted: ['file deleted', 'files deleted'],
  renamed: ['rename', 'renames'], restored: ['file restored', 'files restored'],
}
function summary(node) {
  const kinds = node.kinds || {}
  const parts = []
  if (kinds.forked) parts.push(`forked from ${branchByName.value.get(node.branch)?.forked_from || 'parent'}`)
  if (kinds.merged) parts.push(`merge${kinds.merged > 1 ? ` ×${kinds.merged}` : ''}`)
  for (const [k, n] of Object.entries(kinds).sort((a, b) => b[1] - a[1])) {
    if (k === 'forked' || k === 'merged') continue
    const [one, many] = KIND_LABEL[k] || [k, k]
    parts.push(`${n} ${n === 1 ? one : many}`)
  }
  return parts.join(' · ')
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
  return [
    `${node.branch}: seq ${node.first_seq}${node.first_seq === node.seq ? '' : `–${node.seq}`}`,
    Object.entries(node.kinds || {}).map(([k, n]) => `${k}: ${n}`).join(', '),
  ].filter(Boolean).join('\n')
}

// A head chip (or double-click) puts the workspace on that branch.
function switchTo(branch) {
  if (!branch) return
  const b = branchByName.value.get(branch)
  if (b?.deleted) return
  session.setWorkspaceBranch(branch)
}

// ── Node context menu ────────────────────────────────────────────────────────
const nodeMenu = ref(null)
const menuNode = ref(null)
function onNodeContextMenu(event, node) {
  menuNode.value = node
  nodeMenu.value?.show(event)
}

const menuItems = computed(() => {
  const n = menuNode.value
  if (!n) return []
  const b = branchByName.value.get(n.branch)
  const items = []
  if (b && !b.deleted) {
    if (n.branch !== currentBranch.value) {
      items.push({ label: `Switch workspace to ${n.branch}`, icon: 'pi pi-arrow-right', command: () => switchTo(n.branch) })
    }
    if (b.forked_from) {
      items.push({ label: `Merge ${n.branch} into ${b.forked_from}…`, icon: 'pi pi-arrow-up',
                   command: () => emit('open-project-merge', { source: n.branch, target: b.forked_from }) })
      items.push({ label: `Update ${n.branch} from ${b.forked_from}…`, icon: 'pi pi-arrow-down',
                   command: () => emit('open-project-merge', { source: b.forked_from, target: n.branch }) })
    }
  } else {
    items.push({ label: `${n.branch} (deleted)`, disabled: true })
  }
  items.push({ separator: true })
  items.push({ label: 'Copy seq', icon: 'pi pi-copy', command: () => navigator.clipboard?.writeText(String(n.seq)) })
  return items
})

// ── Data ─────────────────────────────────────────────────────────────────────
function fetchDag() {
  if (!store.wsConnected) return
  loading.value = true
  error.value = ''
  workerSocket.send('fs', 'project_dag', { gap_ms: gapMs.value })
}

let refreshTimer = null
function scheduleRefresh() {
  clearTimeout(refreshTimer)
  refreshTimer = setTimeout(fetchDag, 400)
}

const offs = []
onMounted(() => {
  offs.push(
    workerSocket.on('fs', 'project_dag', (p) => { loading.value = false; graph.value = p }),
    workerSocket.on('fs', 'error', (p) => {
      if (!loading.value) return
      if (p?.op && p.op !== 'project_dag') return
      if (!p?.op && (p?.path || p?.id || p?.source || p?.target)) return
      loading.value = false
      error.value = p.error || p.message || 'unknown error'
    }),
    workerSocket.on('fs', 'project_branch_created', scheduleRefresh),
    workerSocket.on('fs', 'project_branch_deleted', scheduleRefresh),
    workerSocket.on('fs', 'project_merged', (p) => { if (p?.merged) scheduleRefresh() }),
    workerSocket.on('fs', 'written', scheduleRefresh),
    workerSocket.on('fs', 'created', scheduleRefresh),
    workerSocket.on('fs', 'renamed', scheduleRefresh),
    workerSocket.on('fs', 'deleted', scheduleRefresh),
    workerSocket.on('system', 'connected', fetchDag),
  )
  fetchDag()
})
onBeforeUnmount(() => { clearTimeout(refreshTimer); for (const off of offs) off() })
watch(gapMs, fetchDag)
</script>
