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
        class="flex-1 min-h-0"
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


