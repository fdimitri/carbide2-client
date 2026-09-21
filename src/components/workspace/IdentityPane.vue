<template>
  <div class="flex flex-col h-full overflow-hidden">
    <!-- Toolbar -->
    <div class="flex items-center gap-3 px-3 py-1 bg-bg-2 border-b border-line text-ui-sm shrink-0 flex-wrap">
      <i class="pi pi-id-card text-muted text-ui-xs"></i>
      <span class="font-medium">Identity</span>
      <span class="px-1.5 rounded-ui-xs border border-line text-ui-xs text-muted font-mono" :title="`Workspace branch`">{{ branch }}</span>
      <span
        v-if="current && current.branch && current.branch !== branch"
        class="px-1.5 rounded-ui-xs border border-line text-ui-xs font-mono"
        :title="`This tick is on ${current.branch}`"
      >{{ current.branch }}</span>

      <label
        v-if="hasAncestry"
        class="flex items-center gap-1 text-muted text-ui-xs whitespace-nowrap"
        title="Slider includes first-parent history before this branch was forked"
      >
        <input v-model="includeAncestry" type="checkbox" class="accent-current" />
        include history before fork
      </label>

      <button
        class="ui-btn ui-btn-ghost ui-btn-sm"
        :disabled="ticks.length < 2"
        :title="playDir === -1 ? 'Pause' : 'Play reverse'"
        @click="togglePlay(-1)"
      >
        <i class="pi text-ui-xs" :class="playDir === -1 ? 'pi-pause' : 'pi-backward'"></i>
      </button>

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

      <button
        class="ui-btn ui-btn-ghost ui-btn-sm"
        :disabled="ticks.length < 2"
        :title="playDir === 1 ? 'Pause' : 'Play'"
        @click="togglePlay(1)"
      >
        <i class="pi text-ui-xs" :class="playDir === 1 ? 'pi-pause' : 'pi-play'"></i>
      </button>

      <span class="text-muted text-ui-xs whitespace-nowrap font-mono">
        <template v-if="ticks.length">{{ tickIndex + 1 }} / {{ ticks.length }}</template>
        <template v-else>0 / 0</template>
        <template v-if="current"> · seq {{ current.seq }}</template>
      </span>

      <button
        v-for="m in marks"
        :key="(m.kind || 'mark') + ':' + (m.node_id || m.seq)"
        class="px-1.5 rounded-ui-xs text-ui-xs border border-line leading-5"
        :class="current && Number(current.seq) === Number(m.seq) && current.branch === m.branch ? 'text-text bg-bg-1' : 'text-muted'"
        :title="markTitle(m)"
        @click="stopPlay(); fetchMark(m)"
      >{{ markLabel(m) }}</button>

      <button class="ui-btn ui-btn-ghost ui-btn-sm ml-auto" :disabled="loading && !playDir" title="Reload" @click="fetchAxis">
        <i class="pi pi-refresh text-ui-xs"></i>
      </button>

      <span class="text-muted text-ui-xs whitespace-nowrap">
        <template v-if="loading && !playDir">loading…</template>
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
// Play/reverse walks running-node ticks; dwells PLAY_DWELL_MS after each
// identity_at, stops at the ends (play at last tick restarts at 0).
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import workerSocket from '../../services/workerSocket'
import { MAIN_BRANCH, useSessionStore } from '../../stores/sessionStore'
import { useWorkspaceStore } from '../../stores/workspaceStore'
import {
  chipId, eventKindLabel, eventLine, collapseEvents,
  indexEntriesById, identityRows, visibleAxis, tickIndexFor,
  PLAY_DWELL_MS, PLAY_STALL_MS, playNextIndex, playStartIndex,
} from '../../utils/identityView'

const emit = defineEmits(['open-history'])

const store   = useWorkspaceStore()
const session = useSessionStore()

const branch = computed(() => session.workspaceBranch || MAIN_BRANCH)

const includeAncestry = ref(false)
const rawAxis    = ref(null)
const ticks      = ref([])
const marks      = ref([])
const tickIndex  = ref(0)
const current    = ref(null)
const prevById   = ref(Object.create(null))
const loading    = ref(false)
const error      = ref('')
const expanded   = ref(new Set())
const playDir    = ref(0) // +1 forward, -1 reverse, 0 stopped

const requestedAxisBranch = ref('')
const requestedAtBranch   = ref('')
const requestedSeq        = ref(null)

const sliderMax = computed(() => Math.max(0, ticks.value.length - 1))
const eventRows = computed(() => collapseEvents(current.value?.events || []))
const treeRows  = computed(() => identityRows(current.value?.entries || [], prevById.value))
const hasAncestry = computed(() => (rawAxis.value?.segments || []).length > 1)

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

function markLabel(m) {
  if (m.kind === 'fork') return `forked from ${m.from || '?'}`
  if (m.kind === 'merge') return `merged ${m.from || '?'}`
  return m.name || m.kind || ''
}

function markTitle(m) {
  if (m.kind === 'fork') return `Forked from ${m.from} at seq ${m.seq}`
  if (m.kind === 'merge') return `Merged ${m.from} at seq ${m.seq}`
  return `Named snapshot ${m.name} at seq ${m.seq}`
}

function applyVisible({ jump } = {}) {
  const vis = visibleAxis(rawAxis.value, includeAncestry.value)
  ticks.value = vis.ticks
  marks.value = vis.marks
  if (!ticks.value.length) {
    tickIndex.value = 0
    if (jump) {
      current.value = null
      prevById.value = Object.create(null)
      requestedSeq.value = null
      requestedAtBranch.value = ''
    }
    return
  }
  if (jump) {
    jumpToLastTick()
    return
  }
  const cur = current.value
  const i = ticks.value.findIndex((t) =>
    cur && Number(t.seq) === Number(cur.seq) && t.branch === cur.branch)
  if (i >= 0) tickIndex.value = i
  else jumpToLastTick()
}

function fetchAxis() {
  stopPlay()
  if (!store.wsConnected) return
  const b = branch.value
  requestedAxisBranch.value = b
  loading.value = true
  error.value = ''
  workerSocket.send('fs', 'identity_axis', { branch: b })
}

function syncTick(seq, tickBranch) {
  if (!ticks.value.length) return
  tickIndex.value = tickIndexFor(ticks.value, seq, tickBranch)
}

function fetchAt(seq, tickBranch, { silent } = {}) {
  if (!store.wsConnected) return
  if (seq == null) return
  const b = tickBranch || requestedAtBranch.value || branch.value
  requestedAtBranch.value = b
  requestedSeq.value = Number(seq)
  syncTick(seq, b)
  if (!silent) {
    loading.value = true
    error.value = ''
  }
  workerSocket.send('fs', 'identity_at', { branch: b, seq: Number(seq) })
}

function fetchMark(m) {
  fetchAt(m.seq, m.branch)
}

function jumpToLastTick() {
  if (!ticks.value.length) {
    current.value = null
    prevById.value = Object.create(null)
    requestedSeq.value = null
    requestedAtBranch.value = ''
    return
  }
  tickIndex.value = ticks.value.length - 1
  const t = ticks.value[tickIndex.value]
  fetchAt(t.seq, t.branch)
}

function onSlider(e) {
  stopPlay()
  const i = Number(e.target.value)
  tickIndex.value = i
  const t = ticks.value[i]
  if (t) fetchAt(t.seq, t.branch)
}

let playTimer = null
let playStallTimer = null
let playGen = 0

function clearPlayTimers() {
  if (playTimer) { clearTimeout(playTimer); playTimer = null }
  if (playStallTimer) { clearTimeout(playStallTimer); playStallTimer = null }
}

function stopPlay() {
  playGen += 1
  playDir.value = 0
  clearPlayTimers()
}

function tickMatches(i) {
  const t = ticks.value[i]
  const cur = current.value
  return !!(t && cur && Number(cur.seq) === Number(t.seq) && cur.branch === t.branch)
}

function goToTick(i, { silent } = {}) {
  if (i < 0 || i >= ticks.value.length) return
  tickIndex.value = i
  const t = ticks.value[i]
  if (t) fetchAt(t.seq, t.branch, { silent })
}

function armPlayStall(gen) {
  if (playStallTimer) { clearTimeout(playStallTimer); playStallTimer = null }
  playStallTimer = setTimeout(() => {
    playStallTimer = null
    if (playGen !== gen) return
    stopPlay()
  }, PLAY_STALL_MS)
}

function schedulePlayAdvance() {
  clearPlayTimers()
  if (!playDir.value) return
  const gen = playGen
  const dir = playDir.value
  playTimer = setTimeout(() => {
    playTimer = null
    if (playGen !== gen || playDir.value !== dir) return
    const next = playNextIndex(tickIndex.value, ticks.value.length, dir)
    if (next == null) {
      stopPlay()
      return
    }
    goToTick(next, { silent: true })
    armPlayStall(gen)
  }, PLAY_DWELL_MS)
}

function togglePlay(dir) {
  if (playDir.value === dir) {
    stopPlay()
    return
  }
  const start = playStartIndex(tickIndex.value, ticks.value.length, dir)
  if (start == null) return
  playGen += 1
  clearPlayTimers()
  playDir.value = dir
  loading.value = false
  if (start !== tickIndex.value || !tickMatches(start)) {
    goToTick(start, { silent: true })
    armPlayStall(playGen)
  } else {
    schedulePlayAdvance()
  }
}

function onAxis(p) {
  if (!p || p.branch !== requestedAxisBranch.value) return
  rawAxis.value = p
  loading.value = false
  applyVisible({ jump: true })
}

function onAt(p) {
  if (!p || p.branch !== requestedAtBranch.value) return
  if (requestedSeq.value != null && Number(p.seq) !== Number(requestedSeq.value)) return
  const prev = current.value
  if (prev && (Number(prev.seq) !== Number(p.seq) || prev.branch !== p.branch)) {
    prevById.value = indexEntriesById(prev.entries)
  } else if (!prev) {
    prevById.value = Object.create(null)
  }
  current.value = p
  loading.value = false
  error.value = ''
  if (playDir.value) schedulePlayAdvance()
}

function onError(p) {
  const playing = !!playDir.value
  const op = p?.op
  if (op && op !== 'identity_axis' && op !== 'identity_at') return
  if (!op && (p?.path || p?.id || p?.source || p?.target)) return
  if (!loading.value && !playing) return
  stopPlay()
  loading.value = false
  error.value = p.error || p.message || 'unknown error'
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
onBeforeUnmount(() => {
  stopPlay()
  for (const off of offs) off()
})

watch(branch, () => {
  stopPlay()
  current.value = null
  prevById.value = Object.create(null)
  ticks.value = []
  marks.value = []
  rawAxis.value = null
  tickIndex.value = 0
  includeAncestry.value = false
  fetchAxis()
})

watch(includeAncestry, () => {
  stopPlay()
  applyVisible()
})
</script>
