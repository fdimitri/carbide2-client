<template>
  <div class="flex flex-col flex-1 min-h-0 overflow-hidden">
    <div v-if="!fileId" class="flex-1 grid place-items-center text-center text-muted p-4">
      Open a file from the explorer.
    </div>
    <template v-else>
      <!-- No filename header: the tab already shows it. This strip only
           appears when there's a transient status to surface. -->
      <div v-if="loading || loadError || isBinary"
           class="flex items-center gap-3 px-3 py-1 bg-bg-2 border-b border-line text-ui-sm shrink-0">
        <span v-if="loading" class="text-muted italic">Loading…</span>
        <span v-if="loadError" class="text-warn">{{ loadError }}</span>
        <span v-if="isBinary" class="text-muted italic">(binary)</span>
      </div>
      <!-- Binary preview — image inline if it looks like one, else a placeholder + download link. See #13. -->
      <div v-if="isBinary" class="flex-1 min-h-0 overflow-auto bg-bg-2 p-4 grid place-items-center text-center">
        <div v-if="blobLoading" class="text-muted text-ui-lg">Fetching…</div>
        <div v-else-if="blobError" class="text-warn text-ui-lg">{{ blobError }}</div>
        <img v-else-if="blobUrl && isImage" :src="blobUrl" :alt="filename"
             class="max-w-full max-h-full object-contain rounded border border-line" />
        <div v-else-if="blobUrl" class="flex flex-col items-center gap-3">
          <i class="pi pi-file text-4xl text-muted"></i>
          <span class="text-text text-ui-xl">{{ filename }}</span>
            <a :href="blobUrl" :download="filename"
           class="ui-btn ui-btn-ghost">Download</a>
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
import { createFileSync } from '../../services/fileSync'
import { applyChanges as applyChangesToText } from '../../utils/textChanges'

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

// ── DBFS sync ─────────────────────────────────────────────────────────────────
// One fileSync per open path (services/fileSync.js): it owns the base revision,
// the in-flight/pending edit queue and the decision of which remote frames to
// apply. The editor adapter falls back to the `content` prop while Monaco is
// still mounting, so nothing that arrives in that window is lost.
const editorAdapter = {
  applyChanges(changes) {
    if (editorRef.value?.applyChanges(changes)) return
    content.value = applyChangesToText(content.value, changes)
  },
  replaceContent(text) {
    if (editorRef.value?.replaceContent(text)) return
    content.value = text
  },
}

let sync = null

const WARN_ACTIONS = new Set(['write refused', 'write abandoned', 'resend'])

function syncLog(action, detail, extra) {
  debugLog.push({ severity: WARN_ACTIONS.has(action) ? 'warn' : 'info', source: 'fs', action,
                  detail: [props.fileId, detail, extra].filter(Boolean).join(' — ') })
}

// The worker never answered a batch (see fileSync): it was dropped and the
// file re-read, so say so — the view is about to change under the user.
function onSyncAbandon() {
  loadError.value = 'Your last edits were not acknowledged by the worker and have been dropped; the file was reloaded.'
}

function requestFile(path) {
  if (!path) return
  releaseBlob()
  isBinary.value  = false
  loading.value   = true
  loadError.value = ''
  content.value   = ''
  sync?.dispose()
  sync = createFileSync({
    path,
    send: (cmd, payload) => workerSocket.send('fs', cmd, payload),
    editor: editorAdapter,
    log: syncLog,
    onAbandon: onSyncAbandon,
  })
  sync.load()
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
  if (!props.fileId || !sync) return
  sync.localChanges(monacoChangesToWsPayload(monacoChanges))
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
  sync?.onRemote('change', payload)
}

function onFsSetContents(payload) {
  if (normPath(payload.path) !== normPath(props.fileId)) return
  const bytes = (payload.content ?? '').length
  debugLog.push({
    severity: 'info',
    source: 'fs',
    action: 'set_contents',
    detail: `${payload.path} (${bytes} chars)${payload.source ? ` — ${payload.source}` : ''}`,
  })
  sync?.onRemote('set_contents', payload)
}

function onFsWritten(payload) {
  if (normPath(payload.path) !== normPath(props.fileId)) return
  if (payload.mode === 'rebased') syncLog('rebased', `onto ${payload.head}`, payload.branch)
  sync?.onWritten(payload)
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
  const res = sync?.onContent(payload)
  if (!res || res.initial) content.value = res ? res.content : (payload.content ?? '')
}

function onFsError(payload) {
  if (normPath(payload.path) !== normPath(props.fileId)) return
  loading.value = false
  // A refused batch (conflicting merge, bad coordinates, unknown base): nothing
  // reached main, and fileSync re-reads the file. When a merge conflicted the
  // edits are kept on an auto-branch server-side; say where.
  if (sync?.onError(payload)) {
    loadError.value = payload.branch
      ? `Your last edits overlapped someone else's and were not merged; they are saved on branch ${payload.branch}.`
      : ''
    return
  }
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
const offWritten     = workerSocket.on('fs', 'written',      onFsWritten)
const offCursor      = workerSocket.on('fs', 'cursor',       onFsCursor)
const offOpened      = workerSocket.on('fs', 'opened',       onFsOpened)

// Connection-aware loading. A dropped socket would otherwise leave the editor
// stuck on "Loading…" forever (the fs/content reply never arrives). Clear the
// spinner with an honest message on disconnect, and transparently re-read the
// file once the socket comes back so the view self-heals.
//
// fs/open is NOT sent here (or anywhere in this component). Opening and closing
// a file is owned centrally by ProjectPage, driven by the set of open file tabs,
// so a tab that moves between panes or remounts never emits a close that would
// drop the file out from under another view. This component is a pure view.
//
// Edits typed while disconnected stay queued in fileSync (not in the socket's
// own queue) and are sent against the revision they were typed on once the
// socket is back; the server merges them. A batch that was in flight when the
// socket dropped is resent with the same batch_id, which the worker dedupes.
function onWsDisconnected() {
  sync?.onDisconnected()
  if (loading.value) {
    loading.value = false
    loadError.value = 'Connection lost — will reload when reconnected.'
  }
}
function onWsConnected() {
  if (!props.fileId) return
  loadError.value = ''
  if (sync && sync.state.path === props.fileId && sync.state.loaded) {
    sync.onConnected()
  } else {
    requestFile(props.fileId)
  }
}
const offDisconnected = workerSocket.on('system', 'disconnected', onWsDisconnected)
const offConnected    = workerSocket.on('system', 'connected',    onWsConnected)

onMounted(() => {
  if (props.fileId) requestFile(props.fileId)
})

// fileId only changes if this instance is repointed; it does not touch the
// open/close wire (see onWsDisconnected above).
watch(() => props.fileId, (next) => {
  if (next) requestFile(next)
})

onBeforeUnmount(() => {
  clearTimeout(cursorTimer)
  sync?.dispose()
  releaseBlob()
  offContent(); offError(); offChange(); offSetContents(); offWritten(); offCursor(); offOpened()
  offDisconnected(); offConnected()
})
</script>


