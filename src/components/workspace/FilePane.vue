<template>
  <div class="flex flex-col flex-1 min-h-0 overflow-hidden">
    <div v-if="!fileId" class="flex-1 grid place-items-center text-center text-muted p-4">
      Open a file from the explorer.
    </div>
    <template v-else>
      <!-- No filename header: the tab already shows it. This strip only
           appears when there's a transient status to surface. -->
      <!-- Branch bar: which branch of this file the editor is on, fork a new
           one from it, merge it back. Branches are per file (DBFS v2). -->
      <div v-if="!isBinary"
           class="flex items-center gap-2 px-3 py-1 bg-bg-2 border-b border-line text-ui-sm shrink-0">
        <i class="pi pi-sitemap text-muted text-ui-xs"></i>
        <select
          :value="branch"
          :disabled="!branches.length"
          :title="`Branch of ${filename}`"
          class="px-1.5 py-0.5 rounded-ui-xs border monaco-input-bg monaco-input-fg monaco-input-border outline-none"
          @change="switchBranch($event.target.value)"
        >
          <option v-if="!branches.some(b => b.name === branch)" :value="branch">{{ branch }}</option>
          <option v-for="b in branches" :key="b.name" :value="b.name">{{ b.name }}</option>
        </select>
        <template v-if="creatingBranch">
          <input
            ref="newBranchInput"
            v-model="newBranchName"
            type="text"
            spellcheck="false"
            :placeholder="revision ? `new branch at ${revision.slice(0, 8)}` : `new branch from ${branch}`"
            class="px-1.5 py-0.5 rounded-ui-xs border monaco-input-bg monaco-input-fg monaco-input-border outline-none w-48"
            @keydown.enter.prevent="createBranch"
            @keydown.esc.prevent="creatingBranch = false"
          />
          <button class="ui-btn ui-btn-ghost ui-btn-sm" :disabled="!newBranchName.trim()" @click="createBranch">Create</button>
          <button class="ui-btn ui-btn-ghost ui-btn-sm" @click="creatingBranch = false">Cancel</button>
        </template>
        <button v-else class="ui-btn ui-btn-ghost ui-btn-sm" :title="`Fork a new branch of ${filename} from ${branch}`" @click="startCreateBranch">
          New branch
        </button>
        <button
          v-if="branch !== MAIN_BRANCH"
          class="ui-btn ui-btn-ghost ui-btn-sm"
          :disabled="merging"
          :title="`Merge ${branch} into ${MAIN_BRANCH}`"
          @click="mergeIntoMain"
        >{{ merging ? 'Merging…' : `Merge into ${MAIN_BRANCH}` }}</button>
        <button
          v-if="branch !== MAIN_BRANCH"
          class="ui-btn ui-btn-ghost ui-btn-sm"
          :title="`Delete branch ${branch} of ${filename}`"
          @click="deleteBranch"
        >Delete branch</button>
        <span v-if="branchNotice" class="text-muted italic truncate">{{ branchNotice }}</span>
        <button
          class="ui-btn ui-btn-ghost ui-btn-sm ml-auto"
          :title="`Revision history of ${filename}`"
          @click="emit('open-history')"
        ><i class="pi pi-history text-ui-xs"></i> History</button>
      </div>
      <!-- Pinned: the content AT one revision (from the history rail), read-only. -->
      <div v-if="revision && !isBinary"
           class="flex items-center gap-2 px-3 py-1 bg-bg-2 border-b border-line text-ui-sm shrink-0">
        <i class="pi pi-history text-muted text-ui-xs"></i>
        <span>Viewing revision <span class="font-mono">{{ revision.slice(0, 8) }}</span> — read-only.</span>
        <button class="ui-btn ui-btn-ghost ui-btn-sm" :title="`Back to the head of ${branch}`" @click="unpin">Back to {{ branch }}</button>
        <button class="ui-btn ui-btn-ghost ui-btn-sm" title="Fork a branch at this revision and edit there" @click="startCreateBranch">Branch from here…</button>
      </div>
      <div v-if="loading || loadError || isBinary"
           class="flex items-center gap-3 px-3 py-1 bg-bg-2 border-b border-line text-ui-sm shrink-0">
        <span v-if="loading" class="text-muted italic">Loading…</span>
        <span v-if="loadError" class="text-warn">{{ loadError }}</span>
        <button v-if="conflictBranch" class="ui-btn ui-btn-ghost ui-btn-sm" @click="switchBranch(conflictBranch)">
          Open {{ conflictBranch }}
        </button>
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
        :read-only="!!revision"
        @change="onEditorChange"
        @cursor-change="onCursorChange"
      />
    </template>
  </div>
</template>

<script setup>
import { ref, computed, watch, nextTick, onMounted, onBeforeUnmount } from 'vue'
import { useRoute } from 'vue-router'
import MonacoEditor from './MonacoEditor.vue'
import workerSocket from '../../services/workerSocket'
import { extensionToLanguage } from '../../utils/monacoLanguage'
import { useDebugLogStore } from '../../stores/debugLogStore'
import { useSessionStore, MAIN_BRANCH } from '../../stores/sessionStore'
import { fetchProjectBlob } from '../../services/projectService'
import { createFileSync } from '../../services/fileSync'
import { applyChanges as applyChangesToText } from '../../utils/textChanges'

const debugLog = useDebugLogStore()
const session  = useSessionStore()
const route    = useRoute()
const projectId = Number(route.params.id)

const emit = defineEmits(['open-history'])

const props = defineProps({
  fileId: {
    type: String,
    default: '',
  },
  // The branch of the file this view is on. Owned by the file's tab (session
  // doc), so it survives a reload and a session resume; switchBranch() changes
  // it there and the new value arrives back through this prop.
  branch: {
    type: String,
    default: MAIN_BRANCH,
  },
  // Set: the view is pinned at this revision (read-only, no sync); `branch` is
  // then the branch to return to. Owned by the tab like `branch`.
  revision: {
    type: String,
    default: null,
  },
})

// ── Branches ──────────────────────────────────────────────────────────────────
const branches       = ref([])      // [{ name, head }] for this file
const creatingBranch = ref(false)
const newBranchName  = ref('')
const newBranchInput = ref(null)
const merging        = ref(false)
const branchNotice   = ref('')
const conflictBranch = ref('')      // auto-branch holding a refused batch; offered as "Open …"
let   pendingCreate  = ''           // name we asked for; switch to it when branch_created lands

function requestBranches() {
  if (props.fileId) workerSocket.send('fs', 'branches', { path: props.fileId })
}

function switchBranch(name) {
  if (!name || name === props.branch) return
  conflictBranch.value = ''
  loadError.value = ''
  if (!session.setFileTabBranch(props.fileId, name)) {
    // No tab owns this view (should not happen); keep the editor usable anyway.
    requestFile(props.fileId, name)
  }
}

function startCreateBranch() {
  creatingBranch.value = true
  newBranchName.value = ''
  branchNotice.value = ''
  nextTick(() => newBranchInput.value?.focus())
}

function createBranch() {
  const name = newBranchName.value.trim()
  if (!name) return
  pendingCreate = name
  creatingBranch.value = false
  const req = { path: props.fileId, name, from: props.branch }
  if (props.revision) req.at_revision = props.revision   // pinned: fork where we are looking
  workerSocket.send('fs', 'branch_create', req)
}

function unpin() {
  loadError.value = ''
  if (!session.setFileTabView(props.fileId, { revision: null })) requestFile(props.fileId, props.branch, null)
}

function mergeIntoMain() {
  if (props.branch === MAIN_BRANCH || merging.value) return
  merging.value = true
  branchNotice.value = ''
  workerSocket.send('fs', 'merge', { path: props.fileId, source: props.branch, target: MAIN_BRANCH })
}

function onFsBranches(payload) {
  if (normPath(payload.path) !== normPath(props.fileId)) return
  branches.value = Array.isArray(payload.branches) ? payload.branches : []
}

function onFsBranchCreated(payload) {
  if (normPath(payload.path) !== normPath(props.fileId)) return
  if (!branches.value.some(b => b.name === payload.name)) {
    branches.value = [...branches.value, { name: payload.name, head: payload.head }].sort((a, b) => a.name.localeCompare(b.name))
  }
  if (pendingCreate && payload.name === pendingCreate) {
    pendingCreate = ''
    switchBranch(payload.name)
  }
}

function deleteBranch() {
  const name = props.branch
  if (name === MAIN_BRANCH) return
  const msg = `Delete branch ${name} of ${filename.value}?\n\n` +
    'Its history is kept (the branch can be recreated at any of its revisions), but anything on it ' +
    `that was not merged into ${MAIN_BRANCH} will no longer be reachable from a branch.`
  if (!window.confirm(msg)) return
  branchNotice.value = ''
  workerSocket.send('fs', 'branch_delete', { path: props.fileId, name })
}

function onFsBranchDeleted(payload) {
  if (normPath(payload.path) !== normPath(props.fileId)) return
  branches.value = branches.value.filter(b => b.name !== payload.name)
  // Our own branch is gone (the worker only lets the sole viewer delete it, so
  // that was us — or a viewer whose open had not registered yet): back to main.
  if (payload.name === props.branch) {
    branchNotice.value = `Branch ${payload.name} was deleted; back on ${MAIN_BRANCH}.`
    switchBranch(MAIN_BRANCH)
  }
}

function onFsViewerLeft(payload) {
  if (!forThisView(payload)) return
  editorRef.value?.removePeerCursor(payload.user_id)
}

function onFsMerged(payload) {
  if (normPath(payload.path) !== normPath(props.fileId)) return
  merging.value = false
  if (payload.merged) {
    branchNotice.value = `Merged ${payload.source} into ${payload.target}.`
    syncLog('merged', `${payload.source} → ${payload.target}`, payload.head)
    requestBranches()
  } else {
    const why = payload.reason === 'conflict'
      ? `${payload.source} conflicts with ${payload.target}; not merged.`
      : `Not merged: ${payload.error || payload.reason || 'unknown reason'}.`
    branchNotice.value = why
    syncLog('merge refused', why)
  }
}

// Frames for this file but another branch belong to another view.
function forThisView(payload) {
  return normPath(payload.path) === normPath(props.fileId) && (payload.branch || MAIN_BRANCH) === props.branch
}

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

const WARN_ACTIONS = new Set(['write refused', 'write abandoned', 'resend', 'merge refused'])

function syncLog(action, detail, extra) {
  debugLog.push({ severity: WARN_ACTIONS.has(action) ? 'warn' : 'info', source: 'fs', action,
                  detail: [props.fileId, detail, extra].filter(Boolean).join(' — ') })
}

// The worker never answered a batch (see fileSync): it was dropped and the
// file re-read, so say so — the view is about to change under the user.
function onSyncAbandon() {
  loadError.value = 'Your last edits were not acknowledged by the worker and have been dropped; the file was reloaded.'
}

function requestFile(path, branch = props.branch, revision = props.revision) {
  if (!path) return
  releaseBlob()
  isBinary.value  = false
  loading.value   = true
  loadError.value = ''
  content.value   = ''
  conflictBranch.value = ''
  editorRef.value?.clearPeerCursors()   // another file or branch: different viewers
  sync?.dispose()
  if (revision) {
    // Pinned: one read of the content at that revision, no sync — nothing here
    // is a branch head to base edits on, and Monaco is read-only.
    sync = null
    workerSocket.send('fs', 'read', { path, branch, revision_id: revision })
    requestBranches()
    return
  }
  sync = createFileSync({
    path,
    branch,
    send: (cmd, payload) => workerSocket.send('fs', cmd, payload),
    editor: editorAdapter,
    log: syncLog,
    onAbandon: onSyncAbandon,
  })
  sync.load()
  requestBranches()
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
    workerSocket.send('fs', 'cursor', { path: props.fileId, branch: props.branch, line, char })
  }, 50)
}

// ── Receive remote edits from peers ──────────────────────────────────────────
function onFsChange(payload) {
  if (!forThisView(payload)) return
  sync?.onRemote('change', payload)
}

function onFsSetContents(payload) {
  if (!forThisView(payload)) return
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
  if (!forThisView(payload)) return
  if (payload.mode === 'rebased') syncLog('rebased', `onto ${payload.head}`, payload.auto_branch)
  sync?.onWritten(payload)
}

function onFsCursor(payload) {
  if (!forThisView(payload)) return
  editorRef.value?.setPeerCursor(payload.user_id, payload.name, payload.line, payload.char)
}

function onFsOpened(payload) {
  if (!forThisView(payload)) return
  for (const v of (payload.viewers || [])) {
    if (v.cursor) editorRef.value?.setPeerCursor(v.user_id, v.name, v.cursor.line, v.cursor.char)
  }
}

// ── WS response handlers ──────────────────────────────────────────────────────

function onFsContent(payload) {
  if (!forThisView(payload)) return
  if (props.revision) {
    // Only the pinned read we asked for; a live head arriving late is not ours.
    if (!payload.pinned || payload.revision !== props.revision) return
    loading.value = false
    content.value = payload.content ?? ''
    return
  }
  if (payload.pinned) return
  loading.value = false
  const res = sync?.onContent(payload)
  if (!res || res.initial) content.value = res ? res.content : (payload.content ?? '')
}

function onFsError(payload) {
  // Errors for a command that named no branch (branch_create, a bad path)
  // still concern this file's view.
  if (normPath(payload.path) !== normPath(props.fileId)) return
  if (payload.branch && payload.branch !== props.branch) return
  loading.value = false
  // A refused batch (conflicting merge, bad coordinates, unknown base): nothing
  // reached the branch, and fileSync re-reads the file. When a merge conflicted
  // the edits are kept on an auto-branch server-side; say where and offer to
  // open it (the auto-branch is a branch like any other).
  if (sync?.onError(payload)) {
    conflictBranch.value = payload.auto_branch || ''
    loadError.value = payload.auto_branch
      ? `Your last edits overlapped someone else's and were not merged; they are saved on branch ${payload.auto_branch}.`
      : `Your last edits could not be applied (${payload.error || 'refused'}); the file was reloaded.`
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
const offBranches    = workerSocket.on('fs', 'branches',     onFsBranches)
const offBranchCreated = workerSocket.on('fs', 'branch_created', onFsBranchCreated)
const offBranchDeleted = workerSocket.on('fs', 'branch_deleted', onFsBranchDeleted)
const offViewerLeft  = workerSocket.on('fs', 'viewer_left',  onFsViewerLeft)
const offMerged      = workerSocket.on('fs', 'merged',       onFsMerged)

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
  // The worker forgets who is viewing what; peers re-announce themselves by
  // moving after the reconnect, so nothing stale should be left drawn.
  editorRef.value?.clearPeerCursors()
  if (loading.value) {
    loading.value = false
    loadError.value = 'Connection lost — will reload when reconnected.'
  }
}
function onWsConnected() {
  if (!props.fileId) return
  loadError.value = ''
  if (sync && sync.state.path === props.fileId && sync.state.branch === props.branch && sync.state.loaded) {
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
// open/close wire (see onWsDisconnected above). A branch change comes from
// the tab (switchBranch wrote it there): re-read on the new branch. The
// open/close for the (path, branch) pair is ProjectPage's, from the same tab.
watch(() => [props.fileId, props.branch, props.revision], ([next]) => {
  if (next) requestFile(next)
})

onBeforeUnmount(() => {
  clearTimeout(cursorTimer)
  sync?.dispose()
  releaseBlob()
  offContent(); offError(); offChange(); offSetContents(); offWritten(); offCursor(); offOpened()
  offBranches(); offBranchCreated(); offBranchDeleted(); offViewerLeft(); offMerged()
  offDisconnected(); offConnected()
})
</script>


