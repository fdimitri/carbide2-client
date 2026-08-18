<!-- Composer — the agent input box: text draft + image attachments.
     Kept as its own component so keystrokes only re-render this small
     tree, never AgentPane's (potentially long) message timeline. -->
<template>
  <div
    class="flex flex-col gap-1.5 p-2 border-t monaco-panel-border monaco-tabs-bg"
    :class="dragOver ? 'ring-2 ring-blue-500/60 ring-inset' : ''"
    @dragover.prevent="dragOver = true"
    @dragleave.prevent="dragOver = false"
    @drop.prevent="onDrop"
  >
    <div v-if="pendingImages.length" class="flex flex-wrap gap-1.5">
      <div
        v-for="(img, idx) in pendingImages"
        :key="idx"
        class="relative group"
        :title="`${img.mime} · ${formatBytes(img.bytes)}`"
      >
        <img
          :src="`data:${img.mime};base64,${img.base64}`"
          class="h-16 w-16 object-cover rounded-ui-xs border monaco-panel-border"
          :alt="`pending ${idx + 1}`"
        />
        <button
          class="absolute -top-1 -right-1 w-4 h-4 leading-3.5 text-ui-xs rounded-full bg-black/80 text-white opacity-80 hover:opacity-100"
          @click="removePending(idx)"
          title="Remove"
        >×</button>
      </div>
    </div>

    <div class="flex gap-2">
      <UiButton
        size="md"
        @click="fileInputEl?.click()"
        :disabled="!canSend"
        title="Attach image(s) (or paste / drag-drop)"
      >📎</UiButton>
      <input
        ref="fileInputEl"
        type="file"
        accept="image/*"
        multiple
        class="hidden"
        @change="onFileInput"
      />
      <textarea
        v-model="draft"
        ref="inputEl"
        @keydown.enter.exact.prevent="onSend"
        @paste="onPaste"
        :placeholder="placeholder"
        rows="1"
        class="flex-1 px-2.5 py-2 text-ui-lg rounded-ui-sm outline-none font-[inherit] border monaco-input-bg monaco-input-fg monaco-input-border focus:monaco-focus-border placeholder:monaco-line-fg resize-none"
      ></textarea>
      <UiButton
        size="md"
        variant="primary"
        @click="onSend"
        :disabled="!canSend || (!draft.trim() && !pendingImages.length)"
      >Send</UiButton>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, nextTick } from 'vue'
import { useWorkspaceStore } from '../../stores/workspaceStore'
import UiButton from '../ui/UiButton.vue'

const props = defineProps({
  connected: { type: Boolean, default: false },
})
const emit = defineEmits(['send'])

const store = useWorkspaceStore()

const draft       = ref('')
const inputEl     = ref(null)
const fileInputEl = ref(null)

// ── Image attachments ─────────────────────────────────────────────
// Queued for the next send; cleared after onSend fires.
const MAX_IMAGES        = 6
const MAX_BYTES_PER_IMG = 8 * 1024 * 1024   // 8 MB raw
const pendingImages     = ref([])
const dragOver          = ref(false)

function formatBytes(n) {
  if (n == null) return ''
  if (n < 1024)        return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onerror = () => reject(r.error || new Error('read failed'))
    r.onload  = () => {
      const s = String(r.result || '')
      const comma = s.indexOf(',')
      resolve(comma >= 0 ? s.slice(comma + 1) : s)
    }
    r.readAsDataURL(file)
  })
}

async function addFiles(files) {
  for (const file of files) {
    if (!file || !file.type || !file.type.startsWith('image/')) continue
    if (pendingImages.value.length >= MAX_IMAGES) break
    if (file.size > MAX_BYTES_PER_IMG) {
      console.warn(`[Composer] image too large, skipped: ${file.name} (${file.size} bytes)`)
      continue
    }
    try {
      const base64 = await fileToBase64(file)
      pendingImages.value.push({ mime: file.type, base64, bytes: file.size })
    } catch (e) {
      console.warn('[Composer] failed to read image', e)
    }
  }
}

function removePending(idx) {
  pendingImages.value.splice(idx, 1)
}

function onFileInput(ev) {
  const files = Array.from(ev.target.files || [])
  addFiles(files)
  ev.target.value = ''   // allow re-selecting same file
}

function onPaste(ev) {
  const items = Array.from(ev.clipboardData?.items || [])
  const files = items
    .filter(it => it.kind === 'file' && it.type.startsWith('image/'))
    .map(it => it.getAsFile())
    .filter(Boolean)
  if (files.length) {
    ev.preventDefault()
    addFiles(files)
  }
}

function onDrop(ev) {
  dragOver.value = false
  const files = Array.from(ev.dataTransfer?.files || [])
  if (files.length) addFiles(files)
}

const activeAgentName = computed(() => {
  const a = (store.agentList || []).find(x => x.slug === store.agentSelectedSlug)
  return a?.name || 'agent'
})

const canSend = computed(() =>
  props.connected && !!store.agentSelectedSlug && store.agentStatus !== 'thinking'
)
const placeholder = computed(() => {
  if (!props.connected) return 'Disconnected.'
  if (!store.agentSelectedSlug) return 'Pick an agent above.'
  if (store.agentStatus === 'thinking') return 'Waiting for agent…'
  return `Ask ${activeAgentName.value}…`
})

function onSend() {
  const text   = draft.value.trim()
  const images = pendingImages.value.slice()
  if (!canSend.value) return
  if (!text && !images.length) return
  emit('send', text, images.length ? images : null)
  draft.value = ''
  pendingImages.value = []
  // Clicking Send moves focus to the button; pull it back so the user can
  // keep typing while the agent works.
  nextTick(() => inputEl.value?.focus())
}
</script>
