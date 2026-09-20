<template>
  <div class="flex flex-col h-full overflow-hidden">
    <!-- Toolbar -->
    <div class="flex items-center gap-3 px-3 py-1 bg-bg-2 border-b border-line text-ui-sm shrink-0 flex-wrap">
      <i class="pi pi-id-card text-muted text-ui-xs"></i>
      <span class="font-medium">Identity</span>
      <span class="px-1.5 rounded-ui-xs border border-line text-ui-xs text-muted font-mono" :title="`Workspace branch`">{{ branch }}</span>

      <input
        type="range"
        class="flex-1 min-w-[8rem] accent-current"
        min="0"
        :max="sliderMax"
        :disabled="ticks.length === 0"
        :value="tickIndex"
        :title="ticks.length ? `tick ${tickIndex + 1} of ${ticks.length}` : 'No ticks'"
        @input="onSlider"
      />

      <span class="text-muted text-ui-xs whitespace-nowrap font-mono">
        <template v-if="ticks.length">{{ tickIndex + 1 }} / {{ ticks.length }}</template>
        <template v-else>0 / 0</template>
        <template v-if="current"> · seq {{ current.seq }}</template>
      </span>

      <button
        v-for="m in marks"
        :key="m.node_id || m.seq"
        class="px-1.5 rounded-ui-xs text-ui-xs border border-line leading-5"
        :class="current && Number(current.seq) === Number(m.seq) ? 'text-text bg-bg-1' : 'text-muted'"
        :title="`Named snapshot ${m.name} at seq ${m.seq}`"
        @click="fetchAt(m.seq)"
      >{{ m.name }}</button>

      <button class="ui-btn ui-btn-ghost ui-btn-sm ml-auto" :disabled="loading" title="Reload" @click="fetchAxis">
        <i class="pi pi-refresh text-ui-xs"></i>
      </button>

      <span class="text-muted text-ui-xs whitespace-nowrap">
        <template v-if="loading">loading…</template>
      </span>
    </div>

    <div v-if="error" class="px-3 py-1 bg-bg-2 border-b border-line text-ui-sm text-warn shrink-0">{{ error }}</div>

    <div class="flex flex-1 min-h-0 overflow-hidden">
      <!-- Event log -->
      <div class="w-1/3 min-w-[12rem] overflow-auto border-r border-line">
        <div v-if="ticks.length === 0 && !loading" class="p-4 text-muted text-ui-sm italic">No ticks on this branch.</div>
        <div v-else-if="!current && !loading" class="p-4 text-muted text-ui-sm italic">Waiting for the worker…</div>
        <div v-else-if="current && eventRows.length === 0" class="p-4 text-muted text-ui-sm italic">No path events at this seq.</div>
        <div v-else class="py-1">
          <div v-for="row in eventRows" :key="eventKey(row)" class="px-3 py-0.5 text-ui-sm">
            <div class="flex items-baseline gap-2 min-w-0">
              <button
                v-if="row.children"
                class="ui-btn ui-btn-ghost ui-btn-sm shrink-0"
                :title="expanded.has(eventKey(row)) ? 'Collapse paths' : 'Expand paths'"
                @click="toggleEvent(row)"
              >
                <i class="pi text-ui-xs" :class="expanded.has(eventKey(row)) ? 'pi-chevron-down' : 'pi-chevron-right'"></i>
              </button>
              <span class="font-mono text-muted w-[4.5rem] shrink-0">{{ eventKindLabel(row.kind) }}</span>
              <span class="truncate" :title="eventLine(row).text">{{ eventLine(row).text }}</span>
              <button
                v-if="row.file_node_id"
                class="ml-auto shrink-0 font-mono text-ui-xs text-muted px-1 rounded-ui-xs border border-line leading-4"
                :title="row.file_node_id"
                @click="openHistory(row.file_node_id)"
              >{{ chipId(row.file_node_id) }}</button>
            </div>
            <div v-if="row.children && expanded.has(eventKey(row))" class="pl-8 py-0.5">
              <div
                v-for="child in row.children"
                :key="(child.file_node_id || '') + (child.path || '')"
                class="flex items-baseline gap-2 text-ui-xs text-muted"
              >
                <span class="truncate" :title="`${child.from_path} → ${child.path}`">{{ child.from_path }} → {{ child.path }}</span>
                <button
                  v-if="child.file_node_id"
                  class="ml-auto shrink-0 font-mono px-1 rounded-ui-xs border border-line leading-4"
                  :title="child.file_node_id"
                  @click="openHistory(child.file_node_id)"
                >{{ chipId(child.file_node_id) }}</button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Tree -->
      <div class="flex-1 min-w-0 overflow-auto">
        <div v-if="ticks.length === 0 && !loading" class="p-4 text-muted text-ui-sm italic">No ticks on this branch.</div>
        <div v-else-if="treeRows.length === 0 && current" class="p-4 text-muted text-ui-sm italic">Empty tree.</div>
        <div v-else class="py-1">
          <div
            v-for="row in treeRows"
            :key="row.key"
            class="flex items-center gap-1.5 px-2 py-0.5 text-ui-sm"
            :class="{ 'opacity-50': row.ghost }"
            :style="{ paddingLeft: `${8 + row.depth * 14}px` }"
            :title="row.path"
          >
            <button
              v-if="row.id"
              class="font-mono text-ui-xs text-muted px-1 rounded-ui-xs border border-line leading-4 shrink-0"
              :title="row.id"
              @click="openHistory(row.id)"
            >{{ chipId(row.id) }}</button>
            <span
              class="truncate"
              :class="{ 'line-through text-muted': row.ghost }"
            >{{ row.name }}</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
// IdentityPane — one branch's trees over time (fs/identity_axis + fs/identity_at).
// Not the Branches rail (ProjectHistoryPane). A tree is a state; a move is a
// transition: ghost at the old path, same UUID chip live at the new path.
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import workerSocket from '../../services/workerSocket'
import { MAIN_BRANCH, useSessionStore } from '../../stores/sessionStore'
import { useWorkspaceStore } from '../../stores/workspaceStore'
import {
  chipId, eventKindLabel, eventLine, collapseEvents,
  indexEntriesById, identityRows,
} from '../../utils/identityView'

const emit = defineEmits(['open-history'])

const store   = useWorkspaceStore()
const session = useSessionStore()

const branch = computed(() => session.workspaceBranch || MAIN_BRANCH)

const ticks      = ref([])
const marks      = ref([])
const tickIndex  = ref(0)
const current    = ref(null)
const prevById   = ref(Object.create(null))
const loading    = ref(false)
const error      = ref('')
const expanded   = ref(new Set())

const requestedBranch = ref('')
const requestedSeq    = ref(null)

const sliderMax = computed(() => Math.max(0, ticks.value.length - 1))
const eventRows = computed(() => collapseEvents(current.value?.events || []))
const treeRows  = computed(() => identityRows(current.value?.entries || [], prevById.value))

function eventKey(row) {
  return `${row.kind}:${row.from_path || ''}:${row.path || ''}:${row.file_node_id || ''}`
}

function toggleEvent(row) {
  const key = eventKey(row)
  const next = new Set(expanded.value)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  expanded.value = next
}

function openHistory(fileNodeId) {
  if (!fileNodeId) return
  emit('open-history', fileNodeId)
}

function fetchAxis() {
  if (!store.wsConnected) return
  const b = branch.value
  requestedBranch.value = b
  loading.value = true
  error.value = ''
  workerSocket.send('fs', 'identity_axis', { branch: b })
}

function fetchAt(seq) {
  if (!store.wsConnected) return
  if (seq == null) return
  const b = requestedBranch.value || branch.value
  requestedBranch.value = b
  requestedSeq.value = Number(seq)
  loading.value = true
  error.value = ''
  workerSocket.send('fs', 'identity_at', { branch: b, seq: Number(seq) })
}

function jumpToLastTick() {
  if (!ticks.value.length) {
    current.value = null
    prevById.value = Object.create(null)
    requestedSeq.value = null
    return
  }
  tickIndex.value = ticks.value.length - 1
  fetchAt(ticks.value[tickIndex.value].seq)
}

function onSlider(e) {
  const i = Number(e.target.value)
  tickIndex.value = i
  const t = ticks.value[i]
  if (t) fetchAt(t.seq)
}

function onAxis(p) {
  if (!p || p.branch !== requestedBranch.value) return
  ticks.value = Array.isArray(p.ticks) ? p.ticks : []
  marks.value = Array.isArray(p.marks) ? p.marks : []
  loading.value = false
  jumpToLastTick()
}

function onAt(p) {
  if (!p || p.branch !== requestedBranch.value) return
  if (requestedSeq.value != null && Number(p.seq) !== Number(requestedSeq.value)) return
  const prev = current.value
  if (prev && Number(prev.seq) !== Number(p.seq)) {
    prevById.value = indexEntriesById(prev.entries)
  } else if (!prev) {
    prevById.value = Object.create(null)
  }
  current.value = p
  loading.value = false
  error.value = ''
}

function onError(p) {
  if (!loading.value || p?.path) return
  loading.value = false
  error.value = p.error || 'unknown error'
}

const offs = []
onMounted(() => {
  offs.push(
    workerSocket.on('fs', 'identity_axis', onAxis),
    workerSocket.on('fs', 'identity_at', onAt),
    workerSocket.on('fs', 'error', onError),
    workerSocket.on('system', 'connected', fetchAxis),
  )
  fetchAxis()
})
onBeforeUnmount(() => { for (const off of offs) off() })

watch(branch, () => {
  current.value = null
  prevById.value = Object.create(null)
  ticks.value = []
  marks.value = []
  tickIndex.value = 0
  fetchAxis()
})
</script>
