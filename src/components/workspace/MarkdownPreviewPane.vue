<!-- MarkdownPreviewPane.vue — a rendered, live view of a markdown file.
     Follows the same (branch, revision) as the file's editor tab when one is
     open (so editing on a branch previews that branch), main otherwise. It
     is a viewer of the file's sync stream: the same fs/content + fs/change
     frames the editor gets, applied to a plain string instead of Monaco, and
     it never writes. -->
<template>
  <div class="flex flex-col h-full overflow-hidden">
    <div class="flex items-center gap-2 px-3 py-1 bg-bg-2 border-b border-line text-ui-sm shrink-0">
      <i class="pi pi-eye text-muted text-ui-xs"></i>
      <span class="font-medium truncate" :title="fileId">{{ filename }}</span>
      <span class="text-muted">preview</span>
      <span class="px-1.5 rounded-ui-xs border border-line text-ui-xs text-muted font-mono" :title="`Branch of ${filename}`">{{ branch }}</span>
      <span v-if="revision" class="text-muted text-ui-xs" :title="revision">
        at <span class="font-mono">{{ revision.slice(0, 8) }}</span>
      </span>
      <span v-if="loading" class="text-muted italic">Loading…</span>
      <span v-else-if="loadError" class="text-warn truncate" :title="loadError">{{ loadError }}</span>
      <button
        class="ui-btn ui-btn-ghost ui-btn-sm ml-auto"
        :title="`Open ${filename} in the editor`"
        @click="emit('open-file')"
      ><i class="pi pi-pencil text-ui-xs"></i> Edit</button>
    </div>

    <div class="flex-1 min-h-0 overflow-auto bg-bg-1 px-8 py-6">
      <div v-if="!loading && !text.trim()" class="text-muted italic text-ui-sm">(empty file)</div>
      <div v-else ref="docEl" class="markdown-body markdown-doc text-ui-lg break-words" v-html="html"></div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, nextTick, onMounted, onBeforeUnmount } from 'vue'
import workerSocket from '../../services/workerSocket'
import { MAIN_BRANCH } from '../../stores/sessionStore'
import { createFileSync } from '../../services/fileSync'
import { applyChanges } from '../../utils/textChanges'
import { renderMarkdownDocument } from '../../utils/markdown'
import { hydrateDiagrams } from '../../utils/diagrams'

const props = defineProps({
  fileId:   { type: String, required: true },
  branch:   { type: String, default: MAIN_BRANCH },
  revision: { type: String, default: null },   // pinned, like the editor tab
})
const emit = defineEmits(['open-file'])

const filename  = computed(() => props.fileId.split('/').pop() || props.fileId)
const docEl     = ref(null)
const text      = ref('')
const html      = ref('')
const loading   = ref(false)
const loadError = ref('')

// Re-render a beat after the last change: a burst of keystrokes from the
// editor next door is one parse, not one per frame.
let renderTimer = null
watch(text, (t) => {
  clearTimeout(renderTimer)
  renderTimer = setTimeout(() => { html.value = renderMarkdownDocument(t) }, 120)
})
// v-html has replaced the DOM by the next tick; diagram fences are then filled
// in (cached ones at once, edited ones when their render lands).
watch(html, () => nextTick(() => hydrateDiagrams(docEl.value)))

// ── Sync: a string in place of Monaco ────────────────────────────────────────
let sync = null
const stringEditor = {
  replaceContent(t) { text.value = t },
  applyChanges(changes) { text.value = applyChanges(text.value, changes) },
}

function normPath(p) { return (p || '').replace(/^\//, '') }
function forThisView(payload) {
  return normPath(payload.path) === normPath(props.fileId) && (payload.branch || MAIN_BRANCH) === props.branch
}

function request() {
  sync?.dispose()
  sync = null
  loading.value = true
  loadError.value = ''
  text.value = ''
  if (props.revision) {
    workerSocket.send('fs', 'read', { path: props.fileId, branch: props.branch, revision_id: props.revision })
    return
  }
  sync = createFileSync({
    path: props.fileId, branch: props.branch, send: (cmd, payload) => workerSocket.send('fs', cmd, payload),
    editor: stringEditor,
    onAbandon: () => { loadError.value = 'Lost the file; reload to retry.' },
  })
  sync.load()
}

function onFsContent(payload) {
  if (!forThisView(payload)) return
  if (props.revision) {
    if (!payload.pinned || payload.revision !== props.revision) return
    loading.value = false
    text.value = payload.content ?? ''
    return
  }
  if (payload.pinned) return
  loading.value = false
  const res = sync?.onContent(payload)
  if (res?.initial) text.value = res.content
}
function onFsChange(payload)      { if (forThisView(payload)) sync?.onRemote('change', payload) }
function onFsSetContents(payload) { if (forThisView(payload)) sync?.onRemote('set_contents', payload) }
function onFsError(payload) {
  if (normPath(payload.path) !== normPath(props.fileId)) return
  if (payload.branch && payload.branch !== props.branch) return
  loading.value = false
  loadError.value = payload.error || 'error'
}
function onWsDisconnected() { sync?.onDisconnected() }
function onWsConnected() {
  loadError.value = ''
  if (sync?.state.loaded) sync.onConnected()
  else request()
}

const offs = [
  workerSocket.on('fs', 'content',      onFsContent),
  workerSocket.on('fs', 'change',       onFsChange),
  workerSocket.on('fs', 'set_contents', onFsSetContents),
  workerSocket.on('fs', 'error',        onFsError),
  workerSocket.on('system', 'disconnected', onWsDisconnected),
  workerSocket.on('system', 'connected',    onWsConnected),
]

watch(() => [props.fileId, props.branch, props.revision], () => request())
onMounted(request)
onBeforeUnmount(() => {
  clearTimeout(renderTimer)
  sync?.dispose()
  offs.forEach((off) => off?.())
})
</script>
