<template>
  <div class="file-pane">
    <div v-if="!fileId" class="file-pane__placeholder">
      Open a file from the explorer.
    </div>
    <template v-else>
      <div class="file-pane__title-bar">
        <span class="file-pane__filename">{{ filename }}</span>
        <span v-if="loading" class="file-pane__status">Loading…</span>
        <span v-if="loadError" class="file-pane__status file-pane__status--error">{{ loadError }}</span>
      </div>
      <MonacoEditor
        class="file-pane__editor"
        :content="content"
        :language="language"
        :path="fileId"
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

const filename = computed(() => (props.fileId || '').split('/').pop() || props.fileId)
const language = computed(() => extensionToLanguage(filename.value))

function requestFile(path) {
  if (!path) return
  loading.value   = true
  loadError.value = ''
  content.value   = ''
  workerSocket.send('fs', 'read', { path })
}

function onFsContent(payload) {
  if (payload.path !== props.fileId) return
  loading.value = false
  content.value = payload.content ?? ''
}

function onFsError(payload) {
  if (payload.path !== props.fileId) return
  loading.value   = false
  loadError.value = payload.error || 'unknown error'
}

const offContent = workerSocket.on('fs', 'content', onFsContent)
const offError   = workerSocket.on('fs', 'error',   onFsError)

onMounted(() => requestFile(props.fileId))

watch(() => props.fileId, (next) => requestFile(next))

onBeforeUnmount(() => {
  offContent()
  offError()
})
</script>

<style scoped>
.file-pane {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.file-pane__placeholder {
  flex: 1;
  display: grid;
  place-items: center;
  text-align: center;
  color: #91a2bc;
  padding: 1rem;
}

.file-pane__title-bar {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.25rem 0.75rem;
  background: #1e1e1e;
  border-bottom: 1px solid #333;
  font-size: 0.75rem;
  flex-shrink: 0;
}

.file-pane__filename {
  color: #cdd6f4;
  font-weight: 500;
}

.file-pane__status {
  color: #6c7086;
  font-style: italic;
}

.file-pane__status--error {
  color: #f38ba8;
  font-style: normal;
}

.file-pane__editor {
  flex: 1;
  min-height: 0;
}
</style>
