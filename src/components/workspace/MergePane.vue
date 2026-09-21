<template>
  <div class="flex flex-col h-full overflow-hidden">
    <!-- Toolbar -->
    <div class="flex items-center gap-2 px-3 py-1 bg-bg-2 border-b border-line text-ui-sm shrink-0">
      <i class="pi pi-sitemap text-muted text-ui-xs"></i>
      <span class="font-medium truncate" :title="path">{{ filename }}</span>
      <span class="text-muted whitespace-nowrap">
        merge <span class="font-mono">{{ source }}</span> → <span class="font-mono">{{ target }}</span>
      </span>

      <span v-if="loading" class="text-muted italic">loading…</span>
      <template v-else-if="preview">
        <span v-if="preview.clean" class="text-muted">no conflicts — review and commit</span>
        <template v-else>
          <span class="text-muted whitespace-nowrap">
            {{ remaining }} of {{ blocks.length }} conflict{{ blocks.length === 1 ? '' : 's' }} left
          </span>
          <button class="ui-btn ui-btn-ghost ui-btn-sm" :disabled="!blocks.length" title="Previous conflict" @click="step(-1)">
            <i class="pi pi-chevron-up text-ui-xs"></i>
          </button>
          <button class="ui-btn ui-btn-ghost ui-btn-sm" :disabled="!blocks.length" title="Next conflict" @click="step(1)">
            <i class="pi pi-chevron-down text-ui-xs"></i>
          </button>
        </template>
      </template>

      <span v-if="notice" class="text-muted italic truncate" :title="notice">{{ notice }}</span>

      <div class="ml-auto flex items-center gap-1 whitespace-nowrap">
        <label class="flex items-center gap-1 text-muted mr-2" title="Show the common ancestor instead of the two heads">
          <input v-model="showBase" type="checkbox" class="accent-current" />
          base
        </label>
        <button class="ui-btn ui-btn-ghost ui-btn-sm" :disabled="!preview" :title="`Result = ${target} as it is`" @click="take('ours')">
          Take {{ target }}
        </button>
        <button class="ui-btn ui-btn-ghost ui-btn-sm" :disabled="!preview" :title="`Result = ${source} as it is`" @click="take('theirs')">
          Take {{ source }}
        </button>
        <button class="ui-btn ui-btn-ghost ui-btn-sm" :disabled="!preview" title="Back to the merged start text" @click="take('merged')">
          Reset
        </button>
        <button class="ui-btn ui-btn-ghost ui-btn-sm" :disabled="loading" title="Re-read both heads" @click="fetchPreview">
          <i class="pi pi-refresh text-ui-xs"></i>
        </button>
        <button
          class="ui-btn ui-btn-primary ui-btn-sm"
          :disabled="!preview || committing || markersLeft"
          :title="markersLeft ? 'Conflict markers remain in the result' : `Commit the result to ${target} as a merge of ${source}`"
          @click="commit"
        >
          <i class="pi pi-check text-ui-xs"></i> Commit to {{ target }}
        </button>
      </div>
    </div>

    <!-- Stale banner: a head moved since the preview -->
    <div v-if="stale" class="flex items-center gap-2 px-3 py-1 bg-bg-2 border-b border-line text-ui-sm shrink-0">
      <i class="pi pi-exclamation-triangle text-muted text-ui-xs"></i>
      <span class="truncate">{{ stale }}</span>
      <button class="ui-btn ui-btn-ghost ui-btn-sm" @click="fetchPreview">Reload heads</button>
      <span class="text-muted text-ui-xs">your result is kept</span>
    </div>

    <!-- Top: the two heads (or base + one head), read-only -->
    <div class="flex flex-1 min-h-0 border-b border-line">
      <div class="flex flex-col flex-1 min-w-0 border-r border-line">
        <div class="px-3 py-0.5 bg-bg-2 border-b border-line text-ui-xs text-muted truncate">
          <template v-if="showBase">base <span class="font-mono">{{ short(preview?.base_revision) }}</span> — common ancestor</template>
          <template v-else><span class="font-mono">{{ target }}</span> <span class="font-mono">{{ short(preview?.target_head) }}</span> — ours</template>
        </div>
        <MonacoEditor class="flex-1 min-h-0" :content="showBase ? (preview?.base ?? '') : (preview?.ours ?? '')" :language="language" :path="path" :read-only="true" />
      </div>
      <div class="flex flex-col flex-1 min-w-0">
        <div class="px-3 py-0.5 bg-bg-2 border-b border-line text-ui-xs text-muted truncate">
          <span class="font-mono">{{ source }}</span> <span class="font-mono">{{ short(preview?.source_head) }}</span> — theirs
        </div>
        <MonacoEditor class="flex-1 min-h-0" :content="preview?.theirs ?? ''" :language="language" :path="path" :read-only="true" />
      </div>
    </div>

    <!-- Bottom: the result, editable -->
    <div class="flex flex-col flex-1 min-h-0">
      <div class="px-3 py-0.5 bg-bg-2 border-b border-line text-ui-xs text-muted truncate">
        result — what <span class="font-mono">{{ target }}</span> becomes
        <span v-if="markersLeft"> · conflict markers remain</span>
      </div>
      <MonacoEditor
        ref="resultEditor"
        class="flex-1 min-h-0"
        :content="resultText"
        :language="language"
        :path="path"
        @change="onResultChange"
      />
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import MonacoEditor from './MonacoEditor.vue'
import workerSocket from '../../services/workerSocket'
import { extensionToLanguage } from '../../utils/monacoLanguage'
import { MAIN_BRANCH, useSessionStore } from '../../stores/sessionStore'

// A three-way merge for a human to finish (ADR-036): `source` into `target`
// of one file. Top: the two heads (or the base), read-only. Bottom: the
// result, pre-filled with the server's start text — the exact auto-merge when
// clean, diff3 markers otherwise — edited freely, committed as a merge commit
// pinned at the heads shown. If either head moves meanwhile the commit is
// refused as stale and the result is kept for re-review.
const props = defineProps({
  fileId: { type: String, default: '' },
  path:   { type: String, required: true },
  source: { type: String, required: true },
  target: { type: String, required: true },
  // Project tree this merge's content lines live on (workspace / merge target).
  branch: { type: String, default: '' },
})
const emit = defineEmits(['done'])
const session = useSessionStore()
const projectBranch = computed(() => props.branch || session.workspaceBranch || MAIN_BRANCH)

const MARKER_RE = /^(<{7}|={7}|>{7})( |$)/m

const filename     = computed(() => props.path.split('/').pop() || props.path)
const language     = computed(() => extensionToLanguage(filename.value))
const preview      = ref(null)
const loading      = ref(false)
const committing   = ref(false)
const notice       = ref('')
const stale        = ref('')
const showBase     = ref(false)
const resultText   = ref('')       // what the result editor is (re)seeded with
const currentText  = ref('')       // what it currently holds
const resultEditor = ref(null)
const blocks       = computed(() => preview.value?.conflict_blocks || [])
const markersLeft  = computed(() => MARKER_RE.test(currentText.value))
const remaining    = computed(() => (currentText.value.match(/^<{7}( |$)/gm) || []).length)
let cursor = -1

const short = (id) => (id ? String(id).slice(0, 8) : '—')

function fetchPreview() {
  loading.value = true
  notice.value = ''
  workerSocket.send('fs', 'merge_preview', {
    id: props.fileId, source: props.source, target: props.target, branch: projectBranch.value,
  })
}

function seed(text) {
  currentText.value = text
  // The content watch only fires on a change; re-seeding the same text (Reset
  // after edits) goes straight to the editor.
  if (resultText.value === text) resultEditor.value?.replaceContent(text)
  else resultText.value = text
  nextTick(() => highlight())
}

function take(which) {
  if (!preview.value) return
  seed(which === 'ours' ? preview.value.ours : which === 'theirs' ? preview.value.theirs : preview.value.merged)
}

// Whole-line highlights on the marker blocks as they currently stand in the
// result (recomputed from the text, since the human is editing it).
function highlight() {
  const lines = currentText.value.split('\n')
  const ranges = []
  let open = -1
  lines.forEach((l, i) => {
    if (/^<{7}( |$)/.test(l)) open = i
    else if (/^>{7}( |$)/.test(l) && open >= 0) { ranges.push([open, i + 1]); open = -1 }
  })
  resultEditor.value?.setHighlights(ranges)
  return ranges
}

function step(dir) {
  const ranges = highlight()
  if (!ranges.length) return
  cursor = (cursor + dir + ranges.length) % ranges.length
  resultEditor.value?.revealLine(ranges[cursor][0])
}

let changeTimer = null
function onResultChange() {
  clearTimeout(changeTimer)
  changeTimer = setTimeout(() => {
    currentText.value = resultEditor.value?.getValue() ?? currentText.value
    highlight()
  }, 150)
}

function commit() {
  if (!preview.value || committing.value) return
  const content = resultEditor.value?.getValue() ?? currentText.value
  if (MARKER_RE.test(content)) { notice.value = 'Resolve the remaining markers first.'; return }
  committing.value = true
  stale.value = ''
  workerSocket.send('fs', 'merge_resolve', {
    id: props.fileId, source: props.source, target: props.target, content,
    expected_head: preview.value.target_head, expected_source_head: preview.value.source_head,
    branch: projectBranch.value,
  })
}

function forThisMerge(payload) {
  return props.fileId && payload.id && String(payload.id) === String(props.fileId) &&
    payload.source === props.source && payload.target === props.target &&
    (!payload.branch || payload.branch === projectBranch.value)
}

function onPreview(payload) {
  if (!forThisMerge(payload)) return
  loading.value = false
  const first = !preview.value
  preview.value = payload
  stale.value = ''
  // Keep a human's in-progress result across a reload of the heads.
  if (first || !currentText.value) seed(payload.merged)
  else notice.value = 'Heads reloaded; your result was kept.'
}

function onMerged(payload) {
  if (!forThisMerge(payload)) return
  if (!committing.value) return
  committing.value = false
  if (payload.merged) {
    emit('done', { head: payload.head })
    return
  }
  if (payload.reason === 'stale') {
    stale.value = payload.error || 'A head moved while you were resolving; reload and re-check.'
  } else {
    notice.value = `Not merged: ${payload.error || payload.reason || 'unknown reason'}.`
  }
}

function onError(payload) {
  if (payload?.id && String(payload.id) !== String(props.fileId)) return
  if (payload?.source && payload.source !== props.source) return
  if (payload?.target && payload.target !== props.target) return
  if (!loading.value && !committing.value) return
  loading.value = false
  committing.value = false
  notice.value = payload?.error || payload?.message || 'error'
}

const offs = [
  workerSocket.on('fs', 'merge_preview', onPreview),
  workerSocket.on('fs', 'merged',        onMerged),
  workerSocket.on('fs', 'error',         onError),
  workerSocket.on('system', 'connected', fetchPreview),
]

watch(() => [props.fileId, props.path, props.source, props.target], () => { preview.value = null; currentText.value = ''; fetchPreview() })
onMounted(fetchPreview)
onBeforeUnmount(() => {
  clearTimeout(changeTimer)
  for (const off of offs) off()
})
</script>
