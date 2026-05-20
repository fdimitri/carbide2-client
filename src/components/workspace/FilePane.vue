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
      </div>
      <MonacoEditor
        ref="editorRef"
        class="flex-1 min-h-0"
        :content="content"
        :language="language"
        :path="fileId"
        @change="onEditorChange"
      />
    </template>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import MonacoEditor from './MonacoEditor.vue'
import workerSocket from '../../services/workerSocket'
import { extensionToLanguage } from '../../utils/monacoLanguage'

const props = defineProps({
  fileId: {
    type: String,
    default: '',
  },
})

const content   = ref('')
const loading   = ref(false)
const loadError = ref('')
const editorRef = ref(null)

const filename = computed(() => (props.fileId || '').split('/').pop() || props.fileId)
const language = computed(() => extensionToLanguage(filename.value))

function requestFile(path) {
  if (!path) return
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

// ── Receive remote edits from peers ──────────────────────────────────────────
function onFsChange(payload) {
  if (normPath(payload.path) !== normPath(props.fileId)) return
  editorRef.value?.applyRemoteChange(payload.change_type, payload.change_data)
}

function onFsSetContents(payload) {
  if (normPath(payload.path) !== normPath(props.fileId)) return
  editorRef.value?.applyRemoteChange('setContents', payload.content)
}

// ── WS response handlers ──────────────────────────────────────────────────────

function onFsContent(payload) {
  if (normPath(payload.path) !== normPath(props.fileId)) return
  loading.value = false
  content.value = payload.content ?? ''
}

function onFsError(payload) {
  if (normPath(payload.path) !== normPath(props.fileId)) return
  loading.value   = false
  loadError.value = payload.error || 'unknown error'
}

const offContent    = workerSocket.on('fs', 'content',     onFsContent)
const offError      = workerSocket.on('fs', 'error',       onFsError)
const offChange     = workerSocket.on('fs', 'change',      onFsChange)
const offSetContents = workerSocket.on('fs', 'set_contents', onFsSetContents)

onMounted(() => requestFile(props.fileId))

watch(() => props.fileId, (next) => requestFile(next))

onBeforeUnmount(() => {
  offContent()
  offError()
  offChange()
  offSetContents()
})
</script>


