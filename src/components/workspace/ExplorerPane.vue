<template>
  <aside id="pane-explorer" class="w-full border-r border-line flex flex-col min-h-0 min-w-0">
    <PaneHeader title="Explorer" />

    <!-- Project branch (ADR-042): the tree below is this branch's; files open
         on it. main is always there; others fork the whole tree. -->
    <div class="flex items-center gap-1.5 px-2.5 pb-2 text-ui-sm">
      <i class="pi pi-sitemap text-muted text-ui-xs" title="Project branch"></i>
      <select
        :value="branch"
        class="flex-1 min-w-0 px-1.5 py-0.5 rounded-ui-xs border monaco-input-bg monaco-input-fg monaco-input-border outline-none"
        title="Project branch shown in the explorer"
        @change="switchBranch($event.target.value)"
      >
        <option v-if="!projectBranches.some(b => b.name === branch)" :value="branch">{{ branch }}</option>
        <option v-for="b in projectBranches" :key="b.id || b.name" :value="b.name">{{ b.name }}</option>
      </select>
      <template v-if="creatingBranch">
        <input
          ref="newBranchInput"
          v-model="newBranchName"
          type="text"
          spellcheck="false"
          :placeholder="`new branch from ${branch}`"
          class="w-28 px-1.5 py-0.5 rounded-ui-xs border monaco-input-bg monaco-input-fg monaco-input-border outline-none"
          @keydown.enter.prevent="confirmCreateBranch"
          @keydown.esc.prevent="creatingBranch = false"
        />
        <button class="ui-btn ui-btn-ghost ui-btn-sm" title="Create" @click="confirmCreateBranch"><i class="pi pi-check text-ui-xs"></i></button>
      </template>
      <button v-else class="ui-btn ui-btn-ghost ui-btn-sm" :title="`New project branch from ${branch}`" @click="startCreateBranch">
        <i class="pi pi-plus text-ui-xs"></i>
      </button>
      <button class="ui-btn ui-btn-ghost ui-btn-sm" title="Project branches graph" @click="emit('open-project-history')">
        <i class="pi pi-history text-ui-xs"></i>
      </button>
      <template v-if="branch !== MAIN_BRANCH && parentBranch">
        <button
          class="ui-btn ui-btn-ghost ui-btn-sm"
          :title="`Merge ${branch} into ${parentBranch}…`"
          @click="emit('open-project-merge', { source: branch, target: parentBranch })"
        >
          <i class="pi pi-arrow-up text-ui-xs"></i>
        </button>
        <button
          class="ui-btn ui-btn-ghost ui-btn-sm"
          :title="`Update ${branch} from ${parentBranch}…`"
          @click="emit('open-project-merge', { source: parentBranch, target: branch })"
        >
          <i class="pi pi-arrow-down text-ui-xs"></i>
        </button>
        <button
          class="ui-btn ui-btn-ghost ui-btn-sm"
          :class="{ 'text-accent-fg': currentBranch?.materialized }"
          :disabled="materializing"
          :title="currentBranch?.materialized
            ? `On disk at ${currentBranch.disk} — click to take it off disk (the DBFS keeps it)`
            : `Put ${branch} on disk (.branches/<id>) with its own sync, for terminals and tools`"
          @click="toggleMaterialized"
        >
          <i class="pi text-ui-xs" :class="materializing ? 'pi-spin pi-spinner' : 'pi-database'"></i>
        </button>
        <button
          class="ui-btn ui-btn-ghost ui-btn-sm"
          :title="`Delete project branch ${branch} (history kept)`"
          @click="deleteBranch"
        >
          <i class="pi pi-trash text-ui-xs"></i>
        </button>
      </template>
    </div>
    <div v-if="branchNotice" class="px-2.5 pb-1 text-ui-xs text-muted truncate" :title="branchNotice">{{ branchNotice }}</div>

    <!-- Empty-project banner: project has no files yet -> offer git clone.
         Hidden as soon as the tree has any entry. -->
    <div v-if="fileTree.length === 0 && !gitImportRunning" class="mx-2.5 mb-2 p-2.5 border border-dashed border-dim rounded-ui-md bg-bg-1">
      <div class="text-ui-sm text-muted mb-1.5">This project is empty.</div>
      <UiButton size="sm" class="w-full" @click="showGitImportDialog = true">
        <i class="pi pi-github mr-1.5"></i>Clone from git URL
      </UiButton>
    </div>
    <div v-else-if="gitImportRunning" class="mx-2.5 mb-2 p-2.5 border border-muted rounded-ui-md bg-bg-1 text-ui-sm text-accent-fg">
      <i class="pi pi-spin pi-spinner mr-1.5"></i>Cloning {{ gitImportUrl }}…
    </div>

    <div class="flex-1 min-h-0 overflow-y-auto">
      <Tree
        class="explorer-file-tree"
        :value="explorerNodes"
        v-model:expandedKeys="expandedExplorerKeys"
        v-model:selectionKeys="selectionKeys"
        selectionMode="single"
        :filter="true"
        filterMode="lenient"
        @node-select="onExplorerNodeSelect"
        @node-context-menu="onExplorerNodeContextMenuEvent"
      >
        <template #default="slotProps">
          <div
            class="flex items-center gap-2 w-full min-w-0"
            :draggable="!['group-files','group-terminals','group-channels','agent-group','dir'].includes(slotProps.node.data?.kind)"
            @click="onExplorerNodeSelect(slotProps.node)"
            @dblclick.stop="onExplorerNodeDblClick(slotProps.node)"
            @contextmenu.prevent.stop="onExplorerNodeContextMenu($event, slotProps.node)"
            @dragstart.stop="onExplorerNodeDragStart($event, slotProps.node)"
          >
            <i v-if="treeIconClass(slotProps.node.data)" class="pi" :class="treeIconClass(slotProps.node.data)" aria-hidden="true"></i>
            <span>{{ slotProps.node.label }}</span>
            <!-- Session compatibility + last-updated, mirroring the dropdown -->
            <template v-if="slotProps.node.data?.kind === 'session'">
              <i
                v-if="slotProps.node.data.docIncompatible"
                class="pi pi-exclamation-triangle text-amber ml-1 text-ui-3xs"
                :title="slotProps.node.data.warningTitle"
                aria-hidden="true"
              ></i>
              <i
                v-else-if="slotProps.node.data.buildDiffers"
                class="pi pi-info-circle text-muted ml-1 text-ui-3xs"
                :title="slotProps.node.data.warningTitle"
                aria-hidden="true"
              ></i>
              <span
                v-if="slotProps.node.data.updatedLabel"
                class="ml-auto text-ui-3xs text-dim shrink-0"
                :title="'Last updated ' + slotProps.node.data.updatedLabel"
              >{{ slotProps.node.data.updatedLabel }}</span>
            </template>
            <!-- Agent-accessible badge. AGENT pill = the user has marked
                 this terminal as something the LLM agent may drive via
                 shell_exec. The lock icon appears while the agent is
                 actively holding the busy lock; user input is dropped
                 until release (auto-released after
                 project_settings.agent_shell_busy_timeout_s). -->
            <span
              v-if="slotProps.node.data?.kind === 'terminal' && slotProps.node.data?.agentAccessible"
              class="ml-1 px-1.5 py-px text-ui-3xs font-bold tracking-wide rounded border"
              :class="slotProps.node.data?.agentBusy
                ? 'bg-warn/15 border-warn text-warn'
                : 'bg-sel border-accent-bright text-accent-fg'"
              :title="slotProps.node.data?.agentBusy ? 'Agent is running a command (user input locked)' : 'Agent may drive this terminal'"
            >{{ slotProps.node.data?.agentBusy ? 'AGENT ●' : 'AGENT' }}</span>
            <i
              v-if="slotProps.node.data?.isOpen"
              class="pi pi-circle-fill ml-auto text-accent-bright text-ui-3xs opacity-90"
              title="Open in this browser context"
              aria-hidden="true"
            ></i>
          </div>
        </template>
      </Tree>
    </div>
    <ContextMenu ref="treeContextMenu" :model="contextMenuItems" class="tree-context-overlay" />

    <!-- Create File Dialog -->
    <Dialog v-model:visible="showCreateFileDialog" modal header="New File" :style="{ width: '22rem' }">
      <UiField label="File Name" :hint="`in ${createDialogParentPath}`" class="mb-3">
        <UiInput v-model="createFileName" class="w-full" @keydown.enter="confirmCreateFile" autofocus />
      </UiField>
      <template #footer>
        <div class="ui-dialog-actions">
          <UiButton @click="showCreateFileDialog = false">Cancel</UiButton>
          <UiButton variant="primary" :disabled="!createFileName.trim()" @click="confirmCreateFile">Create</UiButton>
        </div>
      </template>
    </Dialog>

    <!-- Create Folder Dialog -->
    <Dialog v-model:visible="showCreateFolderDialog" modal header="New Folder" :style="{ width: '22rem' }">
      <UiField label="Folder Name" :hint="`in ${createDialogParentPath}`" class="mb-3">
        <UiInput v-model="createFolderName" class="w-full" @keydown.enter="confirmCreateFolder" autofocus />
      </UiField>
      <template #footer>
        <div class="ui-dialog-actions">
          <UiButton @click="showCreateFolderDialog = false">Cancel</UiButton>
          <UiButton variant="primary" :disabled="!createFolderName.trim()" @click="confirmCreateFolder">Create</UiButton>
        </div>
      </template>
    </Dialog>

    <!-- Clone-from-git Dialog: shown only when the project tree is empty.
         Server still enforces emptiness (409 on conflict) so this is just
         a UX gate, not a security boundary. -->
    <Dialog v-model:visible="showGitImportDialog" modal header="Clone from git URL" :style="{ width: '28rem' }">
      <div class="flex flex-col gap-1.5 mb-3">
        <UiField label="Repository URL" compact>
          <UiInput v-model="gitImportUrl" class="w-full" placeholder="https://github.com/user/repo.git" autofocus />
        </UiField>
        <UiField label="Branch / ref" class="mt-1.5" compact>
          <template #label-extra><span class="font-normal opacity-70"> (blank = default branch)</span></template>
          <UiInput v-model="gitImportRef" class="w-full" placeholder="default branch" />
        </UiField>
        <span v-if="gitImportError" class="text-warn text-ui-sm mt-1">{{ gitImportError }}</span>
      </div>
      <template #footer>
        <div class="ui-dialog-actions">
          <UiButton @click="showGitImportDialog = false" :disabled="gitImportSubmitting">Cancel</UiButton>
          <UiButton variant="primary" :disabled="!gitImportUrl.trim() || gitImportSubmitting" @click="confirmGitImport">
            {{ gitImportSubmitting ? 'Starting…' : 'Clone' }}
          </UiButton>
        </div>
      </template>
    </Dialog>

    <!-- Properties Dialog (#5 stat-style file info) -->
    <Dialog v-model:visible="showPropertiesDialog" modal header="Properties" :style="{ width: '28rem' }">
      <div v-if="propertiesLoading" class="text-muted text-ui-md">Loading…</div>
      <div v-else-if="propertiesError" class="text-warn text-ui-md">{{ propertiesError }}</div>
      <table v-else-if="propertiesData" class="w-full text-ui-md">
        <tbody>
          <tr v-for="row in propertiesRows" :key="row.label" class="align-top">
            <td class="py-0.5 pr-2 text-muted whitespace-nowrap w-40">{{ row.label }}</td>
            <td class="py-0.5 text-text break-all">{{ row.value }}</td>
          </tr>
        </tbody>
      </table>
      <template #footer>
        <div class="ui-dialog-actions">
          <UiButton @click="showPropertiesDialog = false">Close</UiButton>
        </div>
      </template>
    </Dialog>
  </aside>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount, watch, nextTick } from 'vue'
import Tree from 'primevue/tree'
import ContextMenu from 'primevue/contextmenu'
import Dialog from 'primevue/dialog'
import { logInfo } from '../../services/log'
import { PANE_COUNTS } from '../../composables/usePanes'
import workerSocket from '../../services/workerSocket'
import { useRoute } from 'vue-router'
import { takePendingSeed, currentScope } from '../../services/pendingSeed'
import { SESSION_DOC_VERSION, MAIN_BRANCH, useSessionStore } from '../../stores/sessionStore'
import { CLIENT_SHA } from '../../version'
import PaneHeader from '../ui/PaneHeader.vue'
import UiButton from '../ui/UiButton.vue'
import UiInput from '../ui/UiInput.vue'
import UiField from '../ui/UiField.vue'

const _explorerRoute = useRoute()
const _explorerProjectId = Number(_explorerRoute.params.id)

const props = defineProps({
  terminalList:     { type: Array,  required: true },
  chatChannels:     { type: Array,  required: true },
  agentConversations: { type: Array, required: true },
  // Configured agents (store.agentList). Drives the agent-grouped conversation
  // tree and the "New Conversation" submenu (#120).
  agentList:        { type: Array, default: () => [] },
  sessions:         { type: Array,  required: true },
  currentSessionUuid: { type: String, default: null },
  paneLayout:       { type: String, required: true },
  activePaneIndex:  { type: Number, required: true },
  isJoinedChannel:  { type: Function, required: true },
})

const emit = defineEmits([
  'open-file',
  'branch-changed',
  'open-project-merge',
  'open-project-history',
  'open-preview',
  'open-terminal',
  'open-channel',
  'open-agent',
  'create-agent-conversation',
  'fork-agent',
  'rename-agent',
  'open-session',
  'clone-session',
  'delete-session',
  'open-in-pane',
  'create-terminal',
  'create-channel',
  'rename-terminal',
  'destroy-terminal',
  'set-terminal-agent-accessible',
  'start-recording-terminal',
  'stop-recording-terminal',
  'open-recordings',
  'join-channel',
  'leave-channel',
  'open-upload',
  'download-entry',
  'open-debug',
])

// ── State ─────────────────────────────────────────────────────────────────────
const selectedFileId        = ref(null)
const openedFileIds         = ref(new Set())
const openedTerminalIds     = ref(new Set())
const treeContextMenu           = ref(null)
const contextMenuItems          = ref([])
const showCreateFileDialog      = ref(false)
const showCreateFolderDialog    = ref(false)
const createDialogParentPath    = ref('/')
const createFileName            = ref('')
const createFolderName          = ref('')
const selectionKeys         = ref({})
const expandedExplorerKeys  = ref({
  'group:files':     true,
  'group:terminals': true,
  'group:channels':  true,
  'group:agents':    true,
  'group:sessions':  true,
  'group:debug':     true,
})

// Properties dialog state (#5)
const showPropertiesDialog = ref(false)
const propertiesPath       = ref('')
const propertiesData       = ref(null)
const propertiesLoading    = ref(false)
const propertiesError      = ref('')

// Git-import dialog state — only meaningful while the project is empty.
// gitImportRunning stays true from successful POST until the first fs/created
// event arrives (fileTree becomes non-empty); the watcher takes care of the
// rest automatically.
const showGitImportDialog = ref(false)
const gitImportUrl        = ref('')
const gitImportRef        = ref('')
const gitImportSubmitting = ref(false)
const gitImportRunning    = ref(false)
const gitImportError      = ref('')

async function confirmGitImport() {
  gitImportError.value = ''
  const url = gitImportUrl.value.trim()
  const ref_ = gitImportRef.value.trim()
  if (!url) return
  gitImportSubmitting.value = true
  // The worker owns the clone+ingest: it clones into the project root, walks
  // the result into the DBFS, and broadcasts a tree refresh — all in-process.
  workerSocket.send('fs', 'import_git', { git_url: url, git_ref: ref_ })
  gitImportRunning.value    = true
  showGitImportDialog.value = false
  gitImportSubmitting.value = false
}

// Seed-on-first-open: if a seed method was chosen on the control-plane create
// form, it was stashed as a pending seed keyed by this pod's base path. Run it
// once, the first time we learn the project is empty. Runs at most once per
// mount; takePendingSeed clears the marker so a reload won't re-clone.
const _pendingSeedHandled = ref(false)
async function maybeRunPendingSeed() {
  if (_pendingSeedHandled.value) return
  _pendingSeedHandled.value = true
  const seed = takePendingSeed(currentScope())
  if (!seed || seed.method !== 'git' || !seed.gitUrl) return
  if (fileTree.value.length > 0) return // already has content; nothing to seed
  gitImportUrl.value   = seed.gitUrl
  gitImportRef.value   = seed.gitRef || ''
  gitImportError.value = ''
  gitImportRunning.value = true
  workerSocket.send('fs', 'import_git', { git_url: seed.gitUrl, git_ref: seed.gitRef || '' })
}

// (watcher that clears gitImportRunning lives after fileTree is declared)

const fileTree = ref([])

// Clear the "Cloning…" banner the moment files start showing up. The
// VfsWatcher's fs/created event triggers requestFileTree, which sets
// fileTree to a non-empty array; that's our cue.
watch(() => fileTree.value.length, (n) => { if (n > 0) gitImportRunning.value = false })

// ── File tree from WebSocket ─────────────────────────────────────────────────
function serverNodeToInternal(node) {
  const id = node.path === '/' ? '' : node.path.replace(/^\//, '')
  const result = { id: id || node.name, name: node.name, type: node.type === 'folder' ? 'dir' : 'file' }
  if (node.type === 'folder') result.children = (node.children || []).map(serverNodeToInternal)
  return result
}

// ── Project branch ──────────────────────────────────────────────────────────
const session         = useSessionStore()
const branch          = computed(() => session.workspaceBranch || MAIN_BRANCH)
const projectBranches = ref([])       // [{ id, name, forked_from, ... }]
const creatingBranch  = ref(false)
const newBranchName   = ref('')
const newBranchInput  = ref(null)
const branchNotice    = ref('')
const currentBranch   = computed(() => projectBranches.value.find((b) => b.name === branch.value) || null)
const parentBranch    = computed(() => currentBranch.value?.forked_from || null)
const materializing   = ref(false)

function requestFileTree() {
  workerSocket.send('fs', 'tree', { branch: branch.value })
}

function requestProjectBranches() {
  workerSocket.send('fs', 'project_branches', {})
}

// A frame about another branch's tree is not ours. Frames from a worker that
// predates project branches carry no branch: main.
function forThisBranch(payload) {
  return (payload?.branch || MAIN_BRANCH) === branch.value
}

function switchBranch(name) {
  if (!name || name === branch.value) return
  branchNotice.value = ''
  session.setWorkspaceBranch(name)
  emit('branch-changed', name)
}

function startCreateBranch() {
  creatingBranch.value = true
  newBranchName.value = ''
  nextTick(() => newBranchInput.value?.focus())
}

function confirmCreateBranch() {
  const name = newBranchName.value.trim()
  if (!name) return
  creatingBranch.value = false
  branchNotice.value = `Creating ${name}…`
  workerSocket.send('fs', 'project_branch_create', { name, from: branch.value })
}

function deleteBranch() {
  const name = branch.value
  if (name === MAIN_BRANCH) return
  if (!window.confirm(`Delete project branch "${name}"? Its history is kept; the name becomes free.`)) return
  workerSocket.send('fs', 'project_branch_delete', { name })
}

// Materialization is the user's call per branch: on disk (its own directory
// and flusher/watcher pair) or DBFS-only. Main is always on disk.
function toggleMaterialized() {
  const b = currentBranch.value
  if (!b || b.name === MAIN_BRANCH || materializing.value) return
  const on = !b.materialized
  if (!on && !window.confirm(`Take "${b.name}" off disk? Its directory ${b.disk} is removed; the branch stays in the DBFS.`)) return
  materializing.value = true
  branchNotice.value = on ? `Writing ${b.name} to disk…` : `Removing ${b.name} from disk…`
  workerSocket.send('fs', 'project_branch_materialize', { name: b.name, on })
}

function onProjectBranchMaterialized(payload) {
  const b = payload?.branch
  if (!b?.name) return
  projectBranches.value = projectBranches.value.map((x) => (x.name === b.name ? { ...x, ...b } : x))
  if (b.name === branch.value) {
    materializing.value = false
    branchNotice.value = b.materialized ? `${b.name} is on disk at ${b.disk}` : ''
  }
}

function onProjectBranches(payload) {
  projectBranches.value = Array.isArray(payload?.branches) ? payload.branches : []
  // A session doc can name a branch that is gone: fall back to main.
  if (!projectBranches.value.some((b) => b.name === branch.value)) switchBranch(MAIN_BRANCH)
}

function onProjectBranchCreated(payload) {
  const b = payload?.branch
  if (!b?.name) return
  if (!projectBranches.value.some((x) => x.name === b.name)) projectBranches.value = [...projectBranches.value, b]
  if (branchNotice.value === `Creating ${b.name}…`) {
    branchNotice.value = ''
    switchBranch(b.name)
  }
}

function onProjectBranchDeleted(payload) {
  const name = payload?.name
  if (!name) return
  projectBranches.value = projectBranches.value.filter((x) => x.name !== name)
  if (branch.value === name) switchBranch(MAIN_BRANCH)
}

watch(branch, () => requestFileTree())

const _offFsTree      = ref(null)
const _offWsConnected = ref(null)
const _offFsCreated   = ref(null)
const _offFsRenamed   = ref(null)
const _offFsDeleted   = ref(null)
const _offFsStat      = ref(null)
const _offFsStatErr   = ref(null)
const _offFsImportDone = ref(null)
const _offBranches     = []

onMounted(() => {
  _offFsTree.value = workerSocket.on('fs', 'tree', (payload) => {
    if (!forThisBranch(payload)) return
    const root = payload?.tree
    if (!root || Array.isArray(root)) { fileTree.value = []; return }
    fileTree.value = (root.children || []).map(serverNodeToInternal)
    maybeRunPendingSeed()
  })
  _offWsConnected.value = workerSocket.on('system', 'connected', () => { requestProjectBranches(); requestFileTree() })
  _offFsCreated.value   = workerSocket.on('fs', 'created', (p) => { if (forThisBranch(p)) requestFileTree() })
  _offFsRenamed.value   = workerSocket.on('fs', 'renamed', (p) => { if (forThisBranch(p)) requestFileTree() })
  _offFsDeleted.value   = workerSocket.on('fs', 'deleted', (p) => { if (forThisBranch(p)) requestFileTree() })
  _offBranches.push(
    workerSocket.on('fs', 'project_branches',        onProjectBranches),
    workerSocket.on('fs', 'project_branch_created',  onProjectBranchCreated),
    workerSocket.on('fs', 'project_branch_deleted',  onProjectBranchDeleted),
    workerSocket.on('fs', 'project_branch_materialized', onProjectBranchMaterialized),
    workerSocket.on('fs', 'project_merged', (p) => { if (p?.merged && p.target === branch.value) requestFileTree() }),
    workerSocket.on('fs', 'error', (p) => {
      if (p?.error && /project branch|branch name|materialize|on disk/.test(String(p.error))) {
        branchNotice.value = p.error
        materializing.value = false
      }
    }),
  )
  _offFsStat.value      = workerSocket.on('fs', 'stat', (payload) => {
    // Only consume the response if it matches the path we asked about; this
    // lets other panes also do fs/stat without us snatching their replies.
    if (!showPropertiesDialog.value) return
    if (payload?.path && payload.path !== propertiesPath.value) return
    propertiesData.value    = payload
    propertiesLoading.value = false
  })
  _offFsStatErr.value   = workerSocket.on('fs', 'error', (payload) => {
    // A failed git import clears the "Cloning…" banner and surfaces the error.
    if (gitImportRunning.value) {
      gitImportRunning.value = false
      gitImportError.value   = payload?.message || payload?.error || 'import failed'
      logInfo('[ExplorerPane] git import failed: ' + gitImportError.value)
    }
    if (!propertiesLoading.value) return
    if (payload?.path && payload.path !== propertiesPath.value) return
    propertiesError.value   = payload?.error || payload?.message || 'stat failed'
    propertiesLoading.value = false
  })
  _offFsImportDone.value = workerSocket.on('fs', 'import_done', () => {
    gitImportRunning.value = false
    requestFileTree()
  })
  requestProjectBranches()
  requestFileTree()
})

onBeforeUnmount(() => {
  for (const off of _offBranches) off()
  _offFsTree.value?.()
  _offWsConnected.value?.()
  _offFsCreated.value?.()
  _offFsRenamed.value?.()
  _offFsDeleted.value?.()
  _offFsStat.value?.()
  _offFsStatErr.value?.()
  _offFsImportDone.value?.()
})

// ── Computed tree nodes ───────────────────────────────────────────────────────
const primeFileNodes = computed(() => {
  const mapNode = (node) => ({
    key: node.id,
    label: node.name,
    selectable: node.type === 'file',
    draggable: true,
    droppable: node.type === 'dir',
    data: {
      kind: node.type === 'file' ? 'file' : 'dir',
      type: node.type,
      id: node.id,
      isOpen: node.type === 'file' && openedFileIds.value.has(node.id),
    },
    children: node.children?.map(mapNode) || [],
  })
  return fileTree.value.map(mapNode)
})

// ── Agent conversation tree (ADR-032) ─────────────────────────────────────────
// Forks nest under their ancestor recursively; roots (no forked_from) are the
// top-level children of the Agents group. Lineage is a tree because forks never
// merge (in this decision).
function agentLabel(c) {
  const title = c.title || '(untitled)'
  const branch = c.forked_from_conversation_id ? '↳ ' : ''
  const at = c.forked_at_turn != null ? ` (t${c.forked_at_turn})` : ''
  return `${branch}${title}${at}`
}

function buildAgentNodes(convs, agentSlug) {
  const byId = new Map()
  convs.forEach((c) => byId.set(c.conversation_id, c))
  const children = new Map()   // parent id -> [child convs]
  const roots = []
  convs.forEach((c) => {
    const parent = c.forked_from_conversation_id
    if (parent && byId.has(parent)) {
      if (!children.has(parent)) children.set(parent, [])
      children.get(parent).push(c)
    } else {
      roots.push(c)
    }
  })
  const byActivity = (a, b) => String(b.last_activity_at || '').localeCompare(String(a.last_activity_at || ''))
  const node = (c) => ({
    key: `agent:${c.conversation_id}`,
    label: agentLabel(c),
    selectable: true, draggable: false, droppable: false,
    class: 'p-tree-agent-node',
    data: { kind: 'agent', id: c.conversation_id, agentSlug, isOpen: false },
    children: (children.get(c.conversation_id) || []).sort(byActivity).map(node),
  })
  return roots.sort(byActivity).map(node)
}

// Conversations are grouped under the agent that owns them (#120). Groups come
// from the CONFIGURED agents, so an agent with no conversations still appears
// (and can be used to start one). A conversation whose agent is no longer
// configured (disabled or deleted) lands in a trailing "Other" group rather
// than vanishing from the tree.
const agentGroupNodes = computed(() => {
  const convs  = props.agentConversations || []
  const agents = props.agentList || []
  const bySlug = new Map()
  for (const c of convs) {
    const s = c.agent_slug || ''
    if (!bySlug.has(s)) bySlug.set(s, [])
    bySlug.get(s).push(c)
  }

  const configured = new Set(agents.map((a) => a.slug))
  const groups = agents.map((a) => ({
    key: `agent-group:${a.slug}`,
    label: a.name || a.slug,
    selectable: false, draggable: false, droppable: false,
    class: 'p-tree-agent-group-node',
    data: { kind: 'agent-group', slug: a.slug, enabled: a.enabled !== false },
    children: buildAgentNodes(bySlug.get(a.slug) || [], a.slug),
  }))

  const orphans = convs.filter((c) => !configured.has(c.agent_slug || ''))
  if (orphans.length) {
    groups.push({
      key: 'agent-group:__unconfigured__',
      label: 'Other',
      selectable: false, draggable: false, droppable: false,
      class: 'p-tree-agent-group-node',
      data: { kind: 'agent-group', slug: null, enabled: false },
      children: buildAgentNodes(orphans, null),
    })
  }
  return groups
})

// Expand agent groups once, as they first appear, so conversations are visible
// without a click. Seeded per key, so collapsing one is not immediately undone.
const _seededAgentGroupKeys = new Set()
watch(agentGroupNodes, (groups) => {
  let next = null
  for (const g of groups) {
    if (_seededAgentGroupKeys.has(g.key)) continue
    _seededAgentGroupKeys.add(g.key)
    next = { ...(next || expandedExplorerKeys.value), [g.key]: true }
  }
  if (next) expandedExplorerKeys.value = next
}, { immediate: true })

// ── Browser session nodes (ADR-002) ───────────────────────────────────────
// Sessions are flat (not nested); a fork is denoted by the ↳ prefix, mirroring
// the menubar dropdown. "Clone" in the context menu maps to session fork.
function sessionLabel(s) {
  const base   = s.name || `Session ${String(s.session_uuid).slice(0, 8)}`
  const branch = s.forked_from ? '↳ ' : ''
  if (s.session_uuid === props.currentSessionUuid) return `${branch}${base} (current)`
  if (s.in_use) return `${branch}${base} (in use)`
  return `${branch}${base}`
}

// Compatibility, mirroring the menubar dropdown: doc-version mismatch = amber
// warning; only a differing build SHA = subtle info. Both get a tooltip.
function sessionCompat(s) {
  const savedSha  = s.client_sha || null
  const savedDocV = s.doc_version ?? null
  const docIncompatible = savedDocV != null && savedDocV !== SESSION_DOC_VERSION
  const buildDiffers    = savedSha != null && savedSha !== CLIENT_SHA
  const savedBuild = savedSha ? `client:${savedSha}` : 'an unknown build'
  const loadBuild  = CLIENT_SHA ? `client:${CLIENT_SHA}` : 'this build'
  const warningTitle = docIncompatible
    ? `Saved by ${savedBuild} (doc v${savedDocV ?? '?'}); loading with ${loadBuild} (doc v${SESSION_DOC_VERSION}). Doc version differs — layout may not load correctly.`
    : buildDiffers
      ? `Saved by ${savedBuild}; loading with ${loadBuild} (doc v${SESSION_DOC_VERSION}). Different build — should be compatible.`
      : ''
  return { docIncompatible, buildDiffers, warningTitle }
}

function sessionUpdated(s) {
  if (!s?.updated_at) return ''
  const d = new Date(s.updated_at)
  if (!d.getTime()) return ''
  return d.toLocaleString()
}

const sessionNodes = computed(() =>
  (props.sessions || []).map((s) => {
    const c = sessionCompat(s)
    return {
      key: `session:${s.session_uuid}`,
      label: sessionLabel(s),
      selectable: true, draggable: false, droppable: false,
      data: {
        kind: 'session',
        id: s.session_uuid,
        inUse: !!s.in_use,
        isCurrent: s.session_uuid === props.currentSessionUuid,
        docIncompatible: c.docIncompatible,
        buildDiffers: c.buildDiffers,
        warningTitle: c.warningTitle,
        updatedLabel: sessionUpdated(s),
      },
    }
  })
)

const explorerNodes = computed(() => {
  const termNodes = props.terminalList.map((t) => ({
    key: `term:${t.id}`,
    label: t.name || `terminal #${t.id}`,
    selectable: true, draggable: false, droppable: false,
    data: {
      kind: 'terminal',
      id: t.id,
      isOpen: openedTerminalIds.value.has(Number(t.id)),
      agentAccessible: !!t.agent_accessible,
      agentBusy: !!t.agent_busy,
      recording: !!t.recording,
    },
  }))
  const channelNodes = props.chatChannels.map((c) => ({
    key: `channel:${c.id}`,
    label: c.name,
    selectable: true, draggable: false, droppable: false,
    data: { kind: 'channel', id: c.id, isOpen: props.isJoinedChannel(c.id) },
  }))
  return [
    { key: 'group:files',     label: 'Files',     selectable: false, draggable: false, droppable: false, data: { kind: 'group-files' },     children: primeFileNodes.value },
    { key: 'group:terminals', label: 'Terminals', selectable: false, draggable: false, droppable: false, data: { kind: 'group-terminals' }, children: termNodes },
    { key: 'group:channels',  label: 'Channels',  selectable: false, draggable: false, droppable: false, data: { kind: 'group-channels' },  children: channelNodes },
    { key: 'group:agents',    label: 'Agents',    selectable: false, draggable: false, droppable: false, data: { kind: 'group-agents' },    class: 'p-tree-group-agents', children: agentGroupNodes.value },
    { key: 'group:sessions',  label: 'Sessions',  selectable: false, draggable: false, droppable: false, data: { kind: 'group-sessions' },  children: sessionNodes.value },
    { key: 'group:debug',     label: 'Debug',     selectable: false, draggable: false, droppable: false, data: { kind: 'group-debug' },     children: [] },
  ]
})

// ── Helpers ───────────────────────────────────────────────────────────────────
function treeIconClass(data) {
  switch (data?.kind) {
    case 'group-files':     return 'pi-folder-open'
    case 'group-terminals': return 'pi-desktop'
    case 'group-channels':  return 'pi-comments'
    case 'group-agents':    return 'pi-sparkles'
    case 'agent-group':     return 'pi-user'
    case 'group-sessions':  return 'pi-window-maximize'
    case 'group-debug':     return 'pi-bug'
    case 'dir':             return 'pi-folder'
    case 'file':            return 'pi-file'
    case 'terminal':        return 'pi-terminal'
    case 'channel':         return 'pi-hashtag'
    case 'agent':           return ''   // no icon; forks carry a ↳ prefix in the label
    default:                return 'pi-circle'
  }
}

function markFileOpen(fileId) {
  const next = new Set(openedFileIds.value)
  next.add(String(fileId))
  openedFileIds.value = next
}

function markTerminalOpen(tid) {
  const next = new Set(openedTerminalIds.value)
  next.add(Number(tid))
  openedTerminalIds.value = next
}

// ── Event handlers ────────────────────────────────────────────────────────────
function onExplorerNodeSelect(event) {
  const node = event?.node || event
  if (!node?.data?.kind) return
  if (node.data.kind === 'file') {
    selectedFileId.value = node.key
    selectionKeys.value = { [node.key]: true }
    markFileOpen(node.key)
    emit('open-file', node.key)
    return
  }
  if (node.data.kind === 'terminal') {
    selectionKeys.value = { [`term:${node.data.id}`]: true }
    markTerminalOpen(node.data.id)
    emit('open-terminal', node.data.id)
    return
  }
  if (node.data.kind === 'channel') {
    selectionKeys.value = { [`channel:${node.data.id}`]: true }
    emit('open-channel', node.data.id)
  }
  if (node.data.kind === 'agent') {
    selectionKeys.value = { [`agent:${node.data.id}`]: true }
    emit('open-agent', node.data.id)
  }
  if (node.data.kind === 'session') {
    selectionKeys.value = { [`session:${node.data.id}`]: true }
    emit('open-session', node.data.id)
  }
  if (node.data.kind === 'group-debug') {
    emit('open-debug')
  }
}

function onExplorerNodeDblClick(node) {
  if (!node?.data?.kind) return
  if (node.data.kind === 'terminal') emit('rename-terminal', node.data.id)
}

function openNodeInPane(node, paneIndex) {
  const kind = node?.data?.kind
  if (kind === 'file') {
    markFileOpen(node.key)
    emit('open-in-pane', { kind: 'file',     id: node.key,      label: node.label, paneIndex })
  } else if (kind === 'terminal') {
    markTerminalOpen(node.data.id)
    emit('open-in-pane', { kind: 'terminal', id: node.data.id,  label: node.label, paneIndex })
  } else if (kind === 'channel') {
    emit('open-in-pane', { kind: 'channel',  id: node.data.id,  label: node.label, paneIndex })
  } else if (kind === 'agent') {
    emit('open-in-pane', { kind: 'agent',    id: node.data.id,  label: node.label, paneIndex })
  }
}

// Files the preview tab can render.
function isMarkdownPath(p) { return /\.(md|mdx|markdown)$/i.test(p || '') }

function buildOpenItems(node) {
  const validPaneCount = PANE_COUNTS[props.paneLayout] || 1
  if (validPaneCount === 1) {
    return [{ label: 'Open', command: () => openNodeInPane(node, 0) }]
  }
  const items = [
    { label: 'Open', command: () => openNodeInPane(node, props.activePaneIndex) },
    { separator: true },
  ]
  for (let i = 0; i < validPaneCount; i++) {
    const idx = i
    items.push({ label: `Open in Pane ${i + 1}`, command: () => openNodeInPane(node, idx) })
  }
  return items
}

function buildContextMenuItems(node) {
  const kind = node?.data?.kind
  if (kind === 'group-terminals') return [{ label: 'New Terminal...', command: () => emit('create-terminal') }]
  if (kind === 'group-channels')  return [{ label: 'New Channel...',  command: () => emit('create-channel') }]
  if (kind === 'group-agents') {
    // The Agents root offers a submenu of agents; a specific agent group (or a
    // conversation) starts one directly for that agent, with no submenu (#120).
    const enabled = (props.agentList || []).filter((a) => a.enabled !== false)
    if (!enabled.length) return [{ label: 'New Conversation...', icon: 'pi pi-sparkles', disabled: true }]
    return [{
      label: 'New Conversation...',
      icon: 'pi pi-sparkles',
      items: enabled.map((a) => ({
        label: a.name || a.slug,
        command: () => emit('create-agent-conversation', a.slug),
      })),
    }]
  }
  if (kind === 'agent-group') {
    return [{
      label: 'New Conversation...',
      icon: 'pi pi-sparkles',
      disabled: !node.data.slug,
      command: () => emit('create-agent-conversation', node.data.slug),
    }]
  }
  if (kind === 'group-debug')     return [{ label: 'Open Debug Channel', icon: 'pi pi-bug', command: () => emit('open-debug') }]
  if (kind === 'group-files') {
    return [
      { label: 'New File...',                   icon: 'pi pi-file-plus', command: () => openCreateFileDialog('/') },
      { label: 'New Folder...',                 icon: 'pi pi-folder',    command: () => openCreateFolderDialog('/') },
      { separator: true },
      { label: 'Upload File Here…',             icon: 'pi pi-upload',    command: () => emit('open-upload', { dest: '/', mode: 'file' }) },
      { label: 'Upload & Extract Archive Here…',icon: 'pi pi-box',       command: () => emit('open-upload', { dest: '/', mode: 'archive' }) },
    ]
  }
  if (kind === 'dir') {
    const dirPath = '/' + node.key.replace(/^\//, '')
    return [
      { label: 'New File...',                   icon: 'pi pi-file-plus', command: () => openCreateFileDialog(dirPath) },
      { label: 'New Folder...',                 icon: 'pi pi-folder',    command: () => openCreateFolderDialog(dirPath) },
      { separator: true },
      { label: 'Upload File Here…',             icon: 'pi pi-upload',    command: () => emit('open-upload', { dest: dirPath, mode: 'file' }) },
      { label: 'Upload & Extract Archive Here…',icon: 'pi pi-box',       command: () => emit('open-upload', { dest: dirPath, mode: 'archive' }) },
      { separator: true },
      { label: 'Download', icon: 'pi pi-download', command: () => emit('download-entry', dirPath) },
      { label: 'Properties...', icon: 'pi pi-info-circle', command: () => openPropertiesDialog(dirPath) },
      { label: 'Delete', icon: 'pi pi-trash', command: () => deletePath(node.key) },
    ]
  }
  if (kind === 'channel') {
    const cid = node.data.id
    const joined = props.isJoinedChannel(cid)
    return [
      ...buildOpenItems(node),
      { separator: true },
      { label: 'Join',  disabled:  joined, command: () => emit('join-channel', cid) },
      { label: 'Leave', disabled: !joined, command: () => emit('leave-channel', cid) },
    ]
  }
  if (kind === 'agent') {
    return [
      ...buildOpenItems(node),
      { separator: true },
      { label: 'New Conversation...', icon: 'pi pi-sparkles', disabled: !node.data.agentSlug,
        command: () => emit('create-agent-conversation', node.data.agentSlug) },
      { label: 'Rename...', icon: 'pi pi-pencil', command: () => emit('rename-agent', node.data.id) },
      { label: 'Fork at latest', icon: 'pi pi-code-fork', command: () => emit('fork-agent', node.data.id) },
    ]
  }
  if (kind === 'session') {
    const sid = node.data.id
    return [
      { label: 'Open', icon: 'pi pi-external-link', command: () => emit('open-session', sid) },
      { separator: true },
      { label: 'Clone', icon: 'pi pi-copy', command: () => emit('clone-session', sid) },
      { label: 'Delete', icon: 'pi pi-trash', command: () => emit('delete-session', sid) },
    ]
  }
  if (kind === 'terminal') {
    const tid = node.data.id
    const isAgent = !!node.data.agentAccessible
    const isRecording = !!node.data.recording
    return [
      ...buildOpenItems(node),
      { separator: true },
      { label: 'Rename',  icon: 'pi pi-pencil', command: () => emit('rename-terminal', tid) },
      isAgent
        ? { label: 'Revoke agent access', icon: 'pi pi-lock',
            command: () => emit('set-terminal-agent-accessible', { id: tid, enabled: false }) }
        : { label: 'Make agent-accessible', icon: 'pi pi-bolt',
            command: () => emit('set-terminal-agent-accessible', { id: tid, enabled: true }) },
      isRecording
        ? { label: 'Stop Recording',  icon: 'pi pi-stop-circle',  command: () => emit('stop-recording-terminal',  tid) }
        : { label: 'Start Recording', icon: 'pi pi-circle-fill',  command: () => emit('start-recording-terminal', tid) },
      { label: 'Recordings...', icon: 'pi pi-list', command: () => emit('open-recordings') },
      { label: 'Destroy', icon: 'pi pi-trash',  command: () => emit('destroy-terminal', tid) },
    ]
  }
  if (kind === 'file') {
    const filePath = '/' + node.key.replace(/^\//, '')
    return [
      ...buildOpenItems(node),
      ...(isMarkdownPath(filePath)
        ? [{ label: 'Open Preview', icon: 'pi pi-eye', command: () => emit('open-preview', String(node.data.id)) }]
        : []),
      { separator: true },
      { label: 'Download', icon: 'pi pi-download', command: () => emit('download-entry', filePath) },
      { label: 'Properties...', icon: 'pi pi-info-circle', command: () => openPropertiesDialog(filePath) },
      { label: 'Rename', icon: 'pi pi-pencil', command: () => renameFileById(node.key) },
      { label: 'Delete', icon: 'pi pi-trash',  command: () => deletePath(node.key) },
    ]
  }
  return []
}

function onExplorerNodeContextMenu(event, node) {
  if (!node?.data?.kind) return
  const kind = node.data.kind
  if (kind === 'terminal')     selectionKeys.value = { [`term:${node.data.id}`]: true }
  else if (kind === 'channel') selectionKeys.value = { [`channel:${node.data.id}`]: true }
  else if (kind === 'agent')   selectionKeys.value = { [`agent:${node.data.id}`]: true }
  else if (kind === 'session') selectionKeys.value = { [`session:${node.data.id}`]: true }
  else if (kind === 'file')    selectionKeys.value = { [node.key]: true }
  contextMenuItems.value = buildContextMenuItems(node)
  if (contextMenuItems.value.length > 0) treeContextMenu.value?.show(event)
}

function onExplorerNodeContextMenuEvent(event) {
  onExplorerNodeContextMenu(event.originalEvent, event.node)
}

function onExplorerNodeDragStart(event, node) {
  const kind = node?.data?.kind
  if (['group-files', 'group-terminals', 'group-channels', 'agent-group', 'dir'].includes(kind)) return
  const id = kind === 'file' ? String(node.data.id) : Number(node.data.id)
  logInfo('ExplorerPane', 'dragstart node', kind, id)
  event.dataTransfer.clearData()
  event.dataTransfer.effectAllowed = 'copy'
  event.dataTransfer.setData('application/x-carbide-node', JSON.stringify({ kind, id, label: node.label }))
}

function renameFileById(fileId) {
  const parts = String(fileId).split('/')
  const current = parts[parts.length - 1] || String(fileId)
  const next = window.prompt('Rename to:', current)
  if (!next || !next.trim()) return
  workerSocket.send('fs', 'rename', { path: fileId, new_name: next.trim(), branch: branch.value })
}

function deletePath(path) {
  const name = String(path).split('/').pop() || path
  if (!window.confirm(`Delete "${name}"? This cannot be undone.`)) return
  workerSocket.send('fs', 'delete', { path, branch: branch.value })
}

function openCreateFileDialog(parentPath) {
  createDialogParentPath.value = parentPath || '/'
  createFileName.value = ''
  showCreateFileDialog.value = true
}

function openCreateFolderDialog(parentPath) {
  createDialogParentPath.value = parentPath || '/'
  createFolderName.value = ''
  showCreateFolderDialog.value = true
}

function confirmCreateFile() {
  const name = createFileName.value.trim()
  if (!name) return
  const parent = createDialogParentPath.value.replace(/\/$/, '')
  const path = `${parent}/${name}`
  workerSocket.send('fs', 'create_file', { path, content: '', branch: branch.value })
  showCreateFileDialog.value = false
}

function confirmCreateFolder() {
  const name = createFolderName.value.trim()
  if (!name) return
  const parent = createDialogParentPath.value.replace(/\/$/, '')
  const path = `${parent}/${name}`
  workerSocket.send('fs', 'create_dir', { path, branch: branch.value })
  showCreateFolderDialog.value = false
}

// ── Properties dialog (#5) ───────────────────────────────────────────────────
function openPropertiesDialog(path) {
  propertiesPath.value    = path
  propertiesData.value    = null
  propertiesError.value   = ''
  propertiesLoading.value = true
  showPropertiesDialog.value = true
  workerSocket.send('fs', 'stat', { path })
}

function formatBytes(n) {
  if (n == null) return '—'
  if (n < 1024)            return `${n} B`
  if (n < 1024 * 1024)     return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(2)} MB`
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`
}
function formatMode(m) {
  if (m == null) return '—'
  // Render as octal + symbolic, e.g. '0644 (rw-r--r--)'
  const oct = (m & 0o7777).toString(8).padStart(4, '0')
  const sym = ['', '', ''].map((_, i) => {
    const shift = (2 - i) * 3
    const bits  = (m >> shift) & 0o7
    return (bits & 4 ? 'r' : '-') + (bits & 2 ? 'w' : '-') + (bits & 1 ? 'x' : '-')
  }).join('')
  return `0${oct} (${sym})`
}
function formatTs(ts) {
  if (!ts) return '—'
  try { return new Date(ts).toLocaleString() } catch { return String(ts) }
}

const propertiesRows = computed(() => {
  const d = propertiesData.value
  if (!d) return []
  const rows = [
    { label: 'Path',         value: d.path },
    { label: 'Type',         value: d.type + (d.binary ? ' (binary)' : '') },
    { label: 'Size',         value: formatBytes(d.size) },
  ]
  if (d.type === 'file') {
    rows.push({ label: 'Revisions',    value: String(d.revisions ?? 0) })
    rows.push({ label: 'On-disk size', value: d.last_size != null ? formatBytes(d.last_size) : '—' })
  }
  rows.push(
    { label: 'POSIX mode',  value: formatMode(d.posix_mode) },
    { label: 'POSIX owner', value: d.posix_owner || '—' },
    { label: 'POSIX group', value: d.posix_group || '—' },
    { label: 'Modified',    value: formatTs(d.mtime) },
    { label: 'Created',     value: formatTs(d.created_at) },
    { label: 'Updated',     value: formatTs(d.updated_at) },
  )
  return rows
})

// ── Exposed for parent to mark items open / trigger create dialogs ──────────
defineExpose({ markTerminalOpen, markFileOpen, openCreateFileDialog, openCreateFolderDialog, refreshTree: requestFileTree })
</script>


