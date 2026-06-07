<template>
  <div class="flex flex-col flex-1 min-h-0 overflow-hidden">
    <div v-if="!fileId" class="flex-1 grid place-items-center text-center text-muted p-4">
      Open a file from the explorer.
    </div>
    <template v-else>
      <div class="flex items-center gap-3 px-3 py-1 bg-[#1e1e1e] border-b border-[#333] text-[0.75rem] shrink-0">
        <span class="text-[#cdd6f4] font-medium">{{ filename }}</span>
        <span v-if="loading" class="text-[#6c7086] italic">Loading…</span>
        <span v-if="loadError" class="text-[#f38ba8]">{{ loadError }}</span>
        <span v-if="isBinary" class="text-[#a6adc8] italic">(binary)</span>
      </div>
      <!-- Binary preview — image inline if it looks like one, else a placeholder + download link. See #13. -->
      <div v-if="isBinary" class="flex-1 min-h-0 overflow-auto bg-[#181a20] p-4 grid place-items-center text-center">
        <div v-if="blobLoading" class="text-muted text-[0.85rem]">Fetching…</div>
        <div v-else-if="blobError" class="text-[#f38ba8] text-[0.85rem]">{{ blobError }}</div>
        <img v-else-if="blobUrl && isImage" :src="blobUrl" :alt="filename"
             class="max-w-full max-h-full object-contain rounded border border-[#333]" />
        <div v-else-if="blobUrl" class="flex flex-col items-center gap-3">
          <i class="pi pi-file text-4xl text-[#6c7086]"></i>
          <span class="text-[#cdd6f4] text-[0.9rem]">{{ filename }}</span>
          <a :href="blobUrl" :download="filename"
             class="px-3 py-[0.34rem] bg-transparent border border-[#587296] text-[#c5d4ea] text-[0.85rem] rounded-[0.35rem] hover:border-[#8fcaff] hover:text-[#e6f3ff]">Download</a>
        </div>
      </div>
      <MonacoEditor
        v-else
        ref="editorRef"
        class="flex-1 min-h-0"
        :content="content"
        :language="language"
        :path="fileId"
        @change="onEditorChange"
        @cursor-change="onCursorChange"
      />
    </template>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { useRoute } from 'vue-router'
import MonacoEditor from './MonacoEditor.vue'
import workerSocket from '../../services/workerSocket'
import { extensionToLanguage } from '../../utils/monacoLanguage'
import { useDebugLogStore } from '../../stores/debugLogStore'
import { fetchProjectBlob } from '../../services/projectService'

const debugLog = useDebugLogStore()
const route    = useRoute()
const projectId = Number(route.params.id)

const props = defineProps({
  fileId: {
    type: String,
    default: '',
  },
})

const content    = ref('')
const loading    = ref(false)
const loadError  = ref('')
const editorRef  = ref(null)
const isBinary   = ref(false)
const blobUrl    = ref('')
const blobLoading = ref(false)
const blobError   = ref('')

const filename = computed(() => (props.fileId || '').split('/').pop() || props.fileId)
const language = computed(() => extensionToLanguage(filename.value))
const isImage  = computed(() => /\.(png|jpe?g|gif|webp|bmp|svg|ico|avif)$/i.test(filename.value))

function releaseBlob() {
  if (blobUrl.value) { try { URL.revokeObjectURL(blobUrl.value) } catch {} ; blobUrl.value = '' }
}

async function loadBinaryPreview(path) {
  releaseBlob()
  blobError.value   = ''
  blobLoading.value = true
  try {
    blobUrl.value = await fetchProjectBlob(projectId, path)
  } catch (e) {
    blobError.value = e?.response?.data?.error || e.message || 'fetch failed'
  } finally {
    blobLoading.value = false
  }
}

function requestFile(path) {
  if (!path) return
  releaseBlob()
  isBinary.value  = false
  loading.value   = true
  loadError.value = ''
  content.value   = ''
  workerSocket.send('fs', 'read', { path })
}

function normPath(p) { return (p || '').replace(/^\//, '') }

// ── Send local edits to server ────────────────────────────────────────────────
function monacoChangesToWsPayload(changes) {
  const out = []
  for (const ch of changes) {
    const { range, text, rangeLength } = ch
    const startLine = range.startLineNumber - 1
    const startChar = range.startColumn - 1
    const endLine   = range.endLineNumber - 1
    const endChar   = range.endColumn - 1
    if (rangeLength > 0) {
      const changeType = startLine === endLine ? 'deleteDataSingleLine' : 'deleteDataMultiLine'
      out.push({ change_type: changeType, change_data: JSON.stringify({ startLine, startChar, endLine, endChar }), start_line: startLine, start_char: startChar, end_line: endLine, end_char: endChar })
    }
    if (text) {
      const changeType = text.includes('\n') ? 'insertDataMultiLine' : 'insertDataSingleLine'
      out.push({ change_type: changeType, change_data: JSON.stringify({ startLine, startChar, data: text }), start_line: startLine, start_char: startChar })
    }
  }
  return out
}

function onEditorChange(monacoChanges) {
  if (!props.fileId) return
  const changes = monacoChangesToWsPayload(monacoChanges)
  if (changes.length) workerSocket.send('fs', 'write', { path: props.fileId, changes })
}

// ── Cursor tracking ───────────────────────────────────────────────────────────
let cursorTimer = null
function onCursorChange({ line, char }) {
  if (!props.fileId) return
  clearTimeout(cursorTimer)
  cursorTimer = setTimeout(() => {
    workerSocket.send('fs', 'cursor', { path: props.fileId, line, char })
  }, 50)
}

// ── Receive remote edits from peers ──────────────────────────────────────────
function onFsChange(payload) {
  if (normPath(payload.path) !== normPath(props.fileId)) return
  editorRef.value?.applyRemoteChange(payload.change_type, payload.change_data)
}

function onFsSetContents(payload) {
  if (normPath(payload.path) !== normPath(props.fileId)) return
  const bytes = (payload.content ?? '').length
  debugLog.push({
    severity: 'info',
    source: 'fs',
    action: 'set_contents',
    detail: `${payload.path} (${bytes} chars) — inotify reload`,
  })
  editorRef.value?.applyRemoteChange('setContents', payload.content)
}

function onFsCursor(payload) {
  if (normPath(payload.path) !== normPath(props.fileId)) return
  editorRef.value?.setPeerCursor(payload.user_id, payload.name, payload.line, payload.char)
}

function onFsOpened(payload) {
  if (normPath(payload.path) !== normPath(props.fileId)) return
  for (const v of (payload.viewers || [])) {
    if (v.cursor) editorRef.value?.setPeerCursor(v.user_id, v.name, v.cursor.line, v.cursor.char)
  }
}

// ── WS response handlers ──────────────────────────────────────────────────────

function onFsContent(payload) {
  if (normPath(payload.path) !== normPath(props.fileId)) return
  loading.value = false
  content.value = payload.content ?? ''
}

function onFsError(payload) {
  if (normPath(payload.path) !== normPath(props.fileId)) return
  loading.value = false
  // The worker returns this exact error string when a binary entry is read
  // via the text path. Promote into the binary-preview branch and fetch the
  // bytes via HTTP. See #13 in May30-Questions.md.
  if (typeof payload.error === 'string' && payload.error.includes('binary')) {
    isBinary.value = true
    loadError.value = ''
    loadBinaryPreview(props.fileId)
    return
  }
  loadError.value = payload.error || 'unknown error'
}

const offContent    = workerSocket.on('fs', 'content',     onFsContent)
const offError      = workerSocket.on('fs', 'error',       onFsError)
const offChange     = workerSocket.on('fs', 'change',      onFsChange)
const offSetContents = workerSocket.on('fs', 'set_contents', onFsSetContents)
const offCursor      = workerSocket.on('fs', 'cursor',       onFsCursor)
const offOpened      = workerSocket.on('fs', 'opened',       onFsOpened)

// Connection-aware loading. A dropped socket would otherwise leave the editor
// stuck on "Loading…" forever (the fs/content reply never arrives). Clear the
// spinner with an honest message on disconnect, and transparently re-open +
// re-read the file once the socket comes back so the view self-heals.
function onWsDisconnected() {
  if (loading.value) {
    loading.value = false
    loadError.value = 'Connection lost — will reload when reconnected.'
  }
}
function onWsConnected() {
  if (!props.fileId) return
  loadError.value = ''
  workerSocket.send('fs', 'open', { path: props.fileId })
  requestFile(props.fileId)
}
const offDisconnected = workerSocket.on('system', 'disconnected', onWsDisconnected)
const offConnected    = workerSocket.on('system', 'connected',    onWsConnected)

onMounted(() => {
  if (props.fileId) {
    workerSocket.send('fs', 'open', { path: props.fileId })
    requestFile(props.fileId)
  }
})

watch(() => props.fileId, (next, prev) => {
  if (prev) workerSocket.send('fs', 'close', { path: prev })
  if (next) {
    workerSocket.send('fs', 'open', { path: next })
    requestFile(next)
  }
})

onBeforeUnmount(() => {
  clearTimeout(cursorTimer)
  if (props.fileId) workerSocket.send('fs', 'close', { path: props.fileId })
  releaseBlob()
  offContent(); offError(); offChange(); offSetContents(); offCursor(); offOpened()
  offDisconnected(); offConnected()
})
</script>


