<template>
  <div class="flex flex-col h-full overflow-hidden">
    <!-- Toolbar -->
    <div class="flex items-center gap-2 px-3 py-1 bg-bg-2 border-b border-line text-ui-sm shrink-0">
      <i class="pi pi-sitemap text-muted text-ui-xs"></i>
      <span class="font-medium whitespace-nowrap">
        merge <span class="font-mono">{{ source }}</span> → <span class="font-mono">{{ target }}</span>
      </span>
      <span v-if="loading" class="text-muted italic">planning…</span>
      <template v-else-if="preview">
        <span class="text-muted whitespace-nowrap">
          {{ preview.actions.length }} change{{ preview.actions.length === 1 ? '' : 's' }}
          <template v-if="preview.conflicts.length"> · {{ unresolvedCount }} of {{ preview.conflicts.length }} conflict{{ preview.conflicts.length === 1 ? '' : 's' }} left</template>
          <template v-else> · no conflicts</template>
        </span>
        <span class="text-muted text-ui-xs whitespace-nowrap" :title="`Common base: ${preview.base?.branch} at seq ${preview.base?.seq}`">
          base {{ preview.base?.branch }}@{{ preview.base?.seq }}
        </span>
      </template>
      <span v-if="notice" class="text-muted italic truncate" :title="notice">{{ notice }}</span>

      <div class="ml-auto flex items-center gap-1 whitespace-nowrap">
        <button class="ui-btn ui-btn-ghost ui-btn-sm" :disabled="loading" title="Plan again against the current heads" @click="fetchPreview">
          <i class="pi pi-refresh text-ui-xs"></i>
        </button>
        <button
          class="ui-btn ui-btn-primary ui-btn-sm"
          :disabled="!canMerge"
          :title="mergeTitle"
          @click="commit"
        >
          <i class="pi pi-check text-ui-xs"></i> Merge into {{ target }}
        </button>
      </div>
    </div>

    <div class="flex-1 min-h-0 overflow-y-auto px-3 py-2 text-ui-sm">
      <div v-if="error" class="text-muted italic mb-2">{{ error }}</div>

      <template v-if="preview">
        <!-- Conflicts -->
        <section v-if="preview.conflicts.length" class="mb-4">
          <h3 class="text-ui-xs uppercase tracking-wide text-muted mb-1">Conflicts</h3>
          <div
            v-for="c in preview.conflicts"
            :key="c.id"
            class="border border-line rounded-ui-md bg-bg-1 px-3 py-2 mb-2"
          >
            <div class="flex items-center gap-2 mb-1">
              <span class="font-mono text-ui-xs px-1 rounded-ui-xs bg-bg-2">{{ c.kind }}</span>
              <span class="font-medium truncate" :title="c.ours?.path || c.theirs?.path">{{ c.ours?.path || c.theirs?.path }}</span>
              <span class="text-muted text-ui-xs truncate" :title="c.detail">{{ c.detail }}</span>
            </div>

            <!-- Content: settle in the per-file merge tab, then re-plan. -->
            <div v-if="c.kind === 'content'" class="flex items-center gap-2">
              <span class="text-muted">
                <span class="font-mono">{{ target }}</span> and <span class="font-mono">{{ source }}</span> both changed the text.
              </span>
              <button class="ui-btn ui-btn-ghost ui-btn-sm" @click="emit('open-merge', c.ours.path, { source: c.theirs.branch, target: c.ours.branch })">
                <i class="pi pi-code text-ui-xs"></i> Resolve…
              </button>
            </div>

            <!-- Identity: keep ours, take theirs, or a path of your own. -->
            <div v-else class="flex flex-wrap items-center gap-x-4 gap-y-1">
              <label class="flex items-center gap-1 whitespace-nowrap" :title="oursTitle(c)">
                <input type="radio" :name="`res-${c.id}`" value="ours" :checked="resolutions[c.id]?.action === 'ours'" @change="setResolution(c.id, 'ours')" />
                keep <span class="font-mono">{{ target }}</span>
                <span class="text-muted">{{ describe(c.ours, c, 'ours') }}</span>
              </label>
              <label v-if="allowsTheirs(c)" class="flex items-center gap-1 whitespace-nowrap" :title="theirsTitle(c)">
                <input type="radio" :name="`res-${c.id}`" value="theirs" :checked="resolutions[c.id]?.action === 'theirs'" @change="setResolution(c.id, 'theirs')" />
                take <span class="font-mono">{{ source }}</span>
                <span class="text-muted">{{ describe(c.theirs, c, 'theirs') }}</span>
              </label>
              <label v-if="allowsPath(c)" class="flex items-center gap-1 whitespace-nowrap">
                <input type="radio" :name="`res-${c.id}`" value="path" :checked="resolutions[c.id]?.action === 'path'" @change="setResolution(c.id, 'path', pathDraft[c.id] || c.theirs?.path || '')" />
                put it at
                <input
                  type="text"
                  spellcheck="false"
                  class="w-56 px-1.5 py-0.5 rounded-ui-xs border monaco-input-bg monaco-input-fg monaco-input-border outline-none font-mono"
                  :value="pathDraft[c.id] ?? (c.theirs?.path || '')"
                  @input="onPathInput(c.id, $event.target.value)"
                  @focus="setResolution(c.id, 'path', pathDraft[c.id] ?? (c.theirs?.path || ''))"
                />
              </label>
            </div>
          </div>
        </section>

        <!-- Planned changes -->
        <section>
          <h3 class="text-ui-xs uppercase tracking-wide text-muted mb-1">
            Changes to <span class="font-mono">{{ target }}</span>
          </h3>
          <div v-if="!preview.actions.length" class="text-muted italic">
            Nothing to merge — <span class="font-mono">{{ target }}</span> already has everything on <span class="font-mono">{{ source }}</span>.
          </div>
          <table v-else class="w-full text-left">
            <tbody>
              <tr v-for="(a, i) in preview.actions" :key="i" class="border-b border-line/50">
                <td class="py-0.5 pr-2 w-20">
                  <span class="font-mono text-ui-xs px-1 rounded-ui-xs bg-bg-2">{{ actionLabel(a) }}</span>
                </td>
                <td class="py-0.5 font-mono truncate">
                  <template v-if="a.kind === 'move'">{{ a.from }} <span class="text-muted">→</span> {{ a.to }}</template>
                  <template v-else-if="a.kind === 'content'">
                    {{ pathOf(a) }}
                    <span class="text-muted text-ui-xs"> {{ a.mode === 'take' ? `take ${source}` : 'auto-merge' }}</span>
                  </template>
                  <template v-else>{{ a.path }}<span v-if="a.ftype === 'folder'" class="text-muted">/</span></template>
                </td>
              </tr>
            </tbody>
          </table>
        </section>
      </template>
    </div>
  </div>
</template>

<script setup>
// ProjectMergePane — merge one project branch into another (its parent, or
// the parent into it): the plan the worker computed (fs/project_merge_preview),
// its conflicts, and the resolutions that let fs/project_merge commit.
//
// Identity conflicts (rename/rename, rename/delete, add/collision, …) are
// settled here: keep the target's version, take the source's, or a path of
// your own. Content conflicts are settled in the per-file merge tab; once
// that commits on the target the file no longer conflicts and a re-plan
// drops it. The merge is atomic on the worker: nothing lands until every
// conflict has an answer.
import { ref, computed, reactive, onMounted, onBeforeUnmount } from 'vue'
import workerSocket from '../../services/workerSocket'

const props = defineProps({
  source: { type: String, required: true },
  target: { type: String, required: true },
})
const emit = defineEmits(['open-merge', 'done'])

const preview     = ref(null)
const loading     = ref(false)
const error       = ref('')
const notice      = ref('')
const resolutions = reactive({})   // id => { action, path? }
const pathDraft   = reactive({})   // id => typed path
let committing = false

const unresolvedCount = computed(() =>
  (preview.value?.conflicts || []).filter((c) => c.kind === 'content' || !resolutions[c.id]?.action).length
)
const canMerge = computed(() => !!preview.value && !loading.value && unresolvedCount.value === 0)
const mergeTitle = computed(() => {
  if (!preview.value) return 'Plan first'
  if (unresolvedCount.value) return `${unresolvedCount.value} conflict(s) still need an answer`
  return `Apply these changes to ${props.target}`
})

function isMine(p) {
  return p && p.source === props.source && p.target === props.target
}

function fetchPreview() {
  loading.value = true
  error.value = ''
  workerSocket.send('fs', 'project_merge_preview', { source: props.source, target: props.target })
}

function commit() {
  if (!canMerge.value) return
  committing = true
  notice.value = 'merging…'
  const res = {}
  for (const c of preview.value.conflicts) {
    const r = resolutions[c.id]
    if (!r?.action) continue
    res[c.id] = r.action === 'path' ? { action: 'path', path: (pathDraft[c.id] ?? c.theirs?.path ?? '').trim() } : { action: r.action }
  }
  workerSocket.send('fs', 'project_merge', { source: props.source, target: props.target, resolutions: res })
}

function setResolution(id, action, path) {
  resolutions[id] = action === 'path' ? { action, path } : { action }
}
function onPathInput(id, value) {
  pathDraft[id] = value
  resolutions[id] = { action: 'path', path: value }
}

// Which answers make sense for a conflict kind.
function allowsTheirs(c) {
  return !['add/collision', 'rename/collision'].includes(c.kind)
}
function allowsPath(c) {
  return c.theirs && c.theirs.path && c.kind !== 'modify/delete' && c.kind !== 'rename/delete'
}
function describe(side, c, which) {
  if (!side) return '(deleted)'
  const kinds = c.kind.split('/')
  const k = which === 'ours' ? kinds[0] : kinds[1]
  if (k === 'delete') return '(deleted)'
  if (k === 'modify') return '(edited)'
  return side.path
}
function oursTitle(c) {
  return `Leave ${props.target} as it is for this file`
}
function theirsTitle(c) {
  const k = c.kind.split('/')[1]
  return k === 'delete' ? `Delete it on ${props.target}` : `Apply ${props.source}'s change on ${props.target}`
}

function actionLabel(a) {
  return { delete: 'delete', move: 'move', add: 'add', content: 'content' }[a.kind] || a.kind
}
// A content action names the node; its path on the target is in the plan's
// moves/adds, else unchanged from the conflicts/preview — best effort here.
function pathOf(a) {
  if (a.path) return a.path
  const mv = preview.value?.actions.find((x) => x.id === a.id && x.kind === 'move')
  if (mv) return mv.to
  const add = preview.value?.actions.find((x) => x.id === a.id && x.kind === 'add')
  if (add) return add.path
  return a.id
}

const offs = []
onMounted(() => {
  offs.push(
    workerSocket.on('fs', 'project_merge_preview', (p) => {
      if (!isMine(p)) return
      loading.value = false
      preview.value = p
      // Keep answers for conflicts that are still there; drop the rest.
      const live = new Set((p.conflicts || []).map((c) => c.id))
      for (const id of Object.keys(resolutions)) if (!live.has(id)) delete resolutions[id]
    }),
    workerSocket.on('fs', 'project_merged', (p) => {
      if (!isMine(p)) { if (p?.target === props.target || p?.target === props.source) fetchPreview(); return }
      if (p.merged) {
        notice.value = `merged at seq ${p.seq}`
        if (committing) { committing = false; emit('done', p); return }
        fetchPreview()
      } else {
        committing = false
        notice.value = ''
        preview.value = p
      }
    }),
    // A per-file resolution landed on our target: the plan may have changed.
    workerSocket.on('fs', 'merged', (p) => { if (p?.merged) fetchPreview() }),
    workerSocket.on('fs', 'error', (p) => {
      if (p?.source !== props.source || p?.target !== props.target) return
      loading.value = false
      committing = false
      notice.value = ''
      error.value = p.error || 'merge failed'
    }),
    workerSocket.on('system', 'connected', () => fetchPreview()),
  )
  fetchPreview()
})
onBeforeUnmount(() => { for (const off of offs) off() })
</script>
