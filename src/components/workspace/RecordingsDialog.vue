<!--
  RecordingsDialog — list past terminal recordings and play them back inline.

  Playback strategy: parse the asciinema v2 cast (header + JSON-per-line
  frames), then iterate through frames driving xterm.write with setTimeout
  scaled by a playback speed. No external player dep — the cast format is
  simple enough that hand-rolling beats pulling in asciinema-player + its
  CSS bundle for what is essentially `terminal.write(bytes)`.

  Source format: each frame is [elapsed_seconds, "o", "<bytes>"]. We use
  the elapsed timestamps directly (the file already records pauses).
-->
<template>
  <Dialog
    v-model:visible="visibleModel"
    modal
    header="Terminal Recordings"
    :style="{ width: '60rem', maxWidth: '95vw' }"
    @hide="onClose"
  >
    <div class="flex gap-[0.8rem] min-h-[24rem]">
      <!-- Left: list -->
      <div class="w-[18rem] shrink-0 border-r border-[#243246] pr-[0.6rem] overflow-y-auto">
        <div v-if="loading" class="text-muted text-[0.82rem]">Loading…</div>
        <div v-else-if="loadError" class="text-[#f38ba8] text-[0.82rem]">{{ loadError }}</div>
        <div v-else-if="recordings.length === 0" class="text-muted text-[0.82rem]">
          No recordings yet. Right-click a terminal → Start Recording.
        </div>
        <ul v-else class="list-none p-0 m-0 flex flex-col gap-[0.25rem]">
          <li
            v-for="r in recordings"
            :key="r.id"
            class="cursor-pointer px-[0.45rem] py-[0.35rem] rounded-[0.3rem] text-[0.82rem] border border-transparent"
            :class="selected && selected.id === r.id
              ? 'bg-[#123549] border-[#587296] text-[#dffffa]'
              : 'text-[#c5d4ea] hover:bg-[#0e1e2e]'"
            @click="selectRecording(r)"
          >
            <div class="font-semibold flex items-center gap-[0.35rem]">
              <span v-if="r.status === 'recording'" class="inline-block w-[0.5rem] h-[0.5rem] rounded-full bg-[#f38ba8] animate-pulse" />
              {{ r.terminal_name || `terminal #${r.terminal_id}` }}
            </div>
            <div class="text-muted text-[0.72rem]">{{ formatDate(r.started_at) }}</div>
            <div class="text-muted text-[0.72rem]">
              {{ formatDuration(r.duration) }} · {{ formatBytes(r.byte_count) }}
            </div>
          </li>
        </ul>
      </div>

      <!-- Right: player -->
      <div class="flex-1 min-w-0 flex flex-col gap-[0.4rem]">
        <div v-if="!selected" class="text-muted text-[0.82rem]">
          Select a recording to play it back.
        </div>
        <template v-else>
          <div class="flex items-center gap-[0.4rem] text-[0.78rem]">
            <button
              class="px-2 py-[0.25rem] border border-[#587296] rounded-[0.3rem] cursor-pointer hover:border-[#7ce9de]"
              :disabled="playerBusy"
              @click="playSelected"
            >{{ playing ? 'Restart' : 'Play' }}</button>
            <button
              class="px-2 py-[0.25rem] border border-[#587296] rounded-[0.3rem] cursor-pointer hover:border-[#7ce9de]"
              :disabled="!playing"
              @click="stopPlayback"
            >Stop</button>
            <label class="text-muted ml-[0.4rem]">Speed</label>
            <select v-model.number="speed" class="bg-[#0e1e2e] border border-[#243246] text-[#c5d4ea] rounded-[0.25rem] px-1 py-[0.1rem]">
              <option :value="0.5">0.5×</option>
              <option :value="1">1×</option>
              <option :value="2">2×</option>
              <option :value="4">4×</option>
              <option :value="8">8×</option>
              <option :value="0">instant</option>
            </select>
            <span class="text-muted ml-auto">{{ playbackStatus }}</span>
          </div>
          <div ref="termEl" class="flex-1 min-h-[18rem] bg-black rounded-[0.35rem]" />
          <div class="flex items-center gap-[0.4rem] text-[0.78rem] mt-[0.2rem]">
            <a
              class="text-[#7ce9de] hover:underline cursor-pointer"
              @click="downloadCast"
            >Download .cast</a>
            <button
              class="ml-auto px-2 py-[0.25rem] border border-[#f38ba8] text-[#f38ba8] rounded-[0.3rem] cursor-pointer hover:bg-[#2a1422]"
              :disabled="selected.status === 'recording'"
              @click="deleteSelected"
              :title="selected.status === 'recording' ? 'Stop recording first' : 'Delete this recording'"
            >Delete</button>
          </div>
        </template>
      </div>
    </div>
  </Dialog>
</template>

<script setup>
import { ref, computed, watch, onBeforeUnmount, nextTick } from 'vue'
import Dialog from 'primevue/dialog'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import {
  listRecordings, deleteRecording, fetchRecordingCast, recordingCastUrl,
} from '../../services/recordingService'
import authService from '../../services/authService'

const props = defineProps({
  visible:   { type: Boolean, required: true },
  projectId: { type: [String, Number], required: true },
})
const emit = defineEmits(['update:visible'])

const visibleModel = computed({
  get: () => props.visible,
  set: (v) => emit('update:visible', v),
})

const loading     = ref(false)
const loadError   = ref('')
const recordings  = ref([])
const selected    = ref(null)
const speed       = ref(1)
const playing     = ref(false)
const playerBusy  = ref(false)
const playbackStatus = ref('')

const termEl = ref(null)
let term = null
let fit  = null
let playTimers = []

watch(() => props.visible, async (v) => {
  if (v) {
    await refresh()
  } else {
    stopPlayback()
    disposeTerm()
    selected.value = null
  }
})

async function refresh() {
  loading.value = true
  loadError.value = ''
  try {
    recordings.value = await listRecordings(props.projectId)
  } catch (e) {
    loadError.value = e?.response?.data?.error || e.message || 'failed to load recordings'
  } finally {
    loading.value = false
  }
}

function selectRecording(r) {
  if (selected.value?.id === r.id) return
  stopPlayback()
  selected.value = r
  // Defer term mount until the right pane is rendered.
  nextTick(() => { ensureTerm() })
}

function ensureTerm() {
  if (!termEl.value) return
  if (term) {
    term.clear()
    return
  }
  term = new Terminal({
    convertEol: false,
    cursorBlink: false,
    fontSize: 13,
    fontFamily: 'ui-monospace, Menlo, Consolas, monospace',
    theme: { background: '#000000' },
  })
  fit = new FitAddon()
  term.loadAddon(fit)
  term.open(termEl.value)
  try { fit.fit() } catch { /* noop */ }
}

function disposeTerm() {
  if (term) {
    try { term.dispose() } catch { /* noop */ }
    term = null
    fit  = null
  }
}

async function playSelected() {
  if (!selected.value) return
  stopPlayback()
  ensureTerm()
  playerBusy.value = true
  playbackStatus.value = 'loading…'
  try {
    const { header, frames } = await fetchRecordingCast(props.projectId, selected.value.id)
    if (term && header && header.width && header.height) {
      term.resize(header.width, header.height)
    }
    term?.reset()
    playbackStatus.value = `${frames.length} frames`
    playing.value = true
    scheduleFrames(frames)
  } catch (e) {
    playbackStatus.value = e?.response?.data?.error || e.message || 'load failed'
    playing.value = false
  } finally {
    playerBusy.value = false
  }
}

function scheduleFrames(frames) {
  const startWall = performance.now()
  const spd = speed.value
  for (let i = 0; i < frames.length; i++) {
    const [t, ch, data] = frames[i]
    if (ch !== 'o') continue
    if (spd === 0) {
      // Instant: write everything synchronously.
      term?.write(data)
      if (i === frames.length - 1) finishPlayback()
      continue
    }
    const delayMs = (t * 1000) / spd
    const due = startWall + delayMs - performance.now()
    const handle = setTimeout(() => {
      term?.write(data)
      if (i === frames.length - 1) finishPlayback()
    }, Math.max(0, due))
    playTimers.push(handle)
  }
  if (spd === 0) finishPlayback()
}

function finishPlayback() {
  playing.value = false
  playbackStatus.value = 'done'
}

function stopPlayback() {
  for (const h of playTimers) clearTimeout(h)
  playTimers = []
  playing.value = false
}

async function deleteSelected() {
  const r = selected.value
  if (!r) return
  if (!window.confirm(`Delete recording from ${formatDate(r.started_at)}?`)) return
  try {
    await deleteRecording(props.projectId, r.id)
    recordings.value = recordings.value.filter(x => x.id !== r.id)
    stopPlayback()
    selected.value = null
  } catch (e) {
    window.alert(e?.response?.data?.error || e.message || 'delete failed')
  }
}

async function downloadCast() {
  if (!selected.value) return
  // Use authService.api to fetch with auth, then trigger an <a download>.
  const path = recordingCastUrl(props.projectId, selected.value.id) + '?download=true'
  try {
    const res = await authService.api.get(path, { responseType: 'blob' })
    const url = URL.createObjectURL(res.data)
    const a = document.createElement('a')
    a.href = url
    a.download = `recording-${selected.value.id}.cast`
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 5000)
  } catch (e) {
    window.alert(e?.response?.data?.error || e.message || 'download failed')
  }
}

function onClose() {
  stopPlayback()
  disposeTerm()
}

onBeforeUnmount(() => {
  stopPlayback()
  disposeTerm()
})

function formatDate(iso) {
  if (!iso) return ''
  try { return new Date(iso).toLocaleString() } catch { return String(iso) }
}
function formatDuration(s) {
  if (s == null) return '—'
  const sec = Math.round(s)
  if (sec < 60) return `${sec}s`
  const m = Math.floor(sec / 60)
  const r = sec % 60
  return `${m}m ${r}s`
}
function formatBytes(n) {
  if (n == null) return '0 B'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}
</script>
