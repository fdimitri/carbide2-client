<template>
  <aside class="border-r border-line bg-gradient-to-b from-[rgba(23,34,51,0.95)] to-[rgba(16,25,39,0.95)] flex flex-col min-h-0 min-w-0">
    <div class="flex items-center justify-between px-3 py-[0.65rem] border-b border-line text-[0.84rem] font-bold uppercase tracking-[0.08em]">
      <span>Explorer</span>
    </div>
    <input v-model="explorerSearch" class="mx-[0.6rem] mt-[0.6rem] mb-[0.4rem] px-[0.55rem] py-[0.45rem] text-[0.82rem] bg-[#0f1724] border border-line text-text rounded-[0.35rem] focus:outline-none focus:border-[#8fcaff]" placeholder="Filter explorer..." />

    <!-- Empty-project banner: project has no files yet -> offer git clone.
         Hidden as soon as the tree has any entry. -->
    <div v-if="fileTree.length === 0 && !gitImportRunning" class="mx-[0.6rem] mb-[0.5rem] p-[0.55rem] border border-dashed border-[#3a4c66] rounded-[0.35rem] bg-[#0f1724]">
      <div class="text-[0.78rem] text-muted mb-[0.35rem]">This project is empty.</div>
      <button class="w-full px-[0.55rem] py-[0.34rem] bg-transparent border border-[#587296] text-[#c5d4ea] text-[0.8rem] rounded-[0.35rem] hover:border-[#8fcaff] hover:text-[#e6f3ff]" @click="showGitImportDialog = true">
        <i class="pi pi-github mr-[0.35rem]"></i>Clone from git URL
      </button>
    </div>
    <div v-else-if="gitImportRunning" class="mx-[0.6rem] mb-[0.5rem] p-[0.55rem] border border-[#587296] rounded-[0.35rem] bg-[#0f1724] text-[0.78rem] text-[#cfe8ff]">
      <i class="pi pi-spin pi-spinner mr-[0.35rem]"></i>Cloning {{ gitImportUrl }}…
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
        :filterValue="explorerSearch"
        @node-select="onExplorerNodeSelect"
        @node-context-menu="onExplorerNodeContextMenuEvent"
      >
        <template #default="slotProps">
          <div
            class="flex items-center gap-[0.45rem] w-full min-w-0"
            :draggable="!['group-files','group-terminals','group-channels','dir'].includes(slotProps.node.data?.kind)"
            @click="onExplorerNodeSelect(slotProps.node)"
            @dblclick.stop="onExplorerNodeDblClick(slotProps.node)"
            @contextmenu.prevent.stop="onExplorerNodeContextMenu($event, slotProps.node)"
            @dragstart.stop="onExplorerNodeDragStart($event, slotProps.node)"
          >
            <i class="pi" :class="treeIconClass(slotProps.node.data)" aria-hidden="true"></i>
            <span>{{ slotProps.node.label }}</span>
            <!-- Agent-accessible badge. AGENT pill = the user has marked
                 this terminal as something the LLM agent may drive via
                 shell_exec. The lock icon appears while the agent is
                 actively holding the busy lock; user input is dropped
                 until release (auto-released after
                 project_settings.agent_shell_busy_timeout_s). -->
            <span
              v-if="slotProps.node.data?.kind === 'terminal' && slotProps.node.data?.agentAccessible"
              class="ml-1 px-[0.35rem] py-[0.05rem] text-[0.6rem] font-bold tracking-wide rounded border"
              :class="slotProps.node.data?.agentBusy
                ? 'bg-[#4a1f2c] border-[#ff7da0] text-[#ffd5e0]'
                : 'bg-[#163040] border-[#8fcaff] text-[#cfe8ff]'"
              :title="slotProps.node.data?.agentBusy ? 'Agent is running a command (user input locked)' : 'Agent may drive this terminal'"
            >{{ slotProps.node.data?.agentBusy ? 'AGENT ●' : 'AGENT' }}</span>
            <i
              v-if="slotProps.node.data?.isOpen"
              class="pi pi-circle-fill ml-auto text-[#8fcaff] text-[0.52rem] opacity-90"
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
      <div class="flex flex-col gap-[0.35rem] mb-[0.7rem]">
        <label class="text-muted text-[0.78rem] font-semibold">File Name</label>
        <InputText v-model="createFileName" class="w-full" @keydown.enter="confirmCreateFile" autofocus />
        <span class="text-muted text-[0.75rem]">in {{ createDialogParentPath }}</span>
      </div>
      <template #footer>
        <button class="shrink-0 px-3 py-[0.34rem] bg-transparent border border-[#587296] text-[#c5d4ea] text-[0.85rem] rounded-[0.35rem] cursor-pointer hover:border-[#8fcaff] hover:text-[#e6f3ff]" @click="showCreateFileDialog = false">Cancel</button>
        <button class="shrink-0 px-[0.85rem] py-[0.42rem] bg-[#10243a] border border-accent text-[#cfe8ff] rounded-[0.35rem] cursor-pointer disabled:opacity-55 disabled:cursor-not-allowed" :disabled="!createFileName.trim()" @click="confirmCreateFile">Create</button>
      </template>
    </Dialog>

    <!-- Create Folder Dialog -->
    <Dialog v-model:visible="showCreateFolderDialog" modal header="New Folder" :style="{ width: '22rem' }">
      <div class="flex flex-col gap-[0.35rem] mb-[0.7rem]">
        <label class="text-muted text-[0.78rem] font-semibold">Folder Name</label>
        <InputText v-model="createFolderName" class="w-full" @keydown.enter="confirmCreateFolder" autofocus />
        <span class="text-muted text-[0.75rem]">in {{ createDialogParentPath }}</span>
      </div>
      <template #footer>
        <button class="shrink-0 px-3 py-[0.34rem] bg-transparent border border-[#587296] text-[#c5d4ea] text-[0.85rem] rounded-[0.35rem] cursor-pointer hover:border-[#8fcaff] hover:text-[#e6f3ff]" @click="showCreateFolderDialog = false">Cancel</button>
        <button class="shrink-0 px-[0.85rem] py-[0.42rem] bg-[#10243a] border border-accent text-[#cfe8ff] rounded-[0.35rem] cursor-pointer disabled:opacity-55 disabled:cursor-not-allowed" :disabled="!createFolderName.trim()" @click="confirmCreateFolder">Create</button>
      </template>
    </Dialog>

    <!-- Clone-from-git Dialog: shown only when the project tree is empty.
         Server still enforces emptiness (409 on conflict) so this is just
         a UX gate, not a security boundary. -->
    <Dialog v-model:visible="showGitImportDialog" modal header="Clone from git URL" :style="{ width: '28rem' }">
      <div class="flex flex-col gap-[0.35rem] mb-[0.7rem]">
        <label class="text-muted text-[0.78rem] font-semibold">Repository URL</label>
        <InputText v-model="gitImportUrl" class="w-full" placeholder="https://github.com/user/repo.git" autofocus />
        <label class="text-muted text-[0.78rem] font-semibold mt-[0.4rem]">Branch / ref <span class="font-normal opacity-70">(blank = default branch)</span></label>
        <InputText v-model="gitImportRef" class="w-full" placeholder="default branch" />
        <span v-if="gitImportError" class="text-[#f38ba8] text-[0.78rem] mt-[0.3rem]">{{ gitImportError }}</span>
      </div>
      <template #footer>
        <button class="shrink-0 px-3 py-[0.34rem] bg-transparent border border-[#587296] text-[#c5d4ea] text-[0.85rem] rounded-[0.35rem] cursor-pointer hover:border-[#8fcaff] hover:text-[#e6f3ff]" @click="showGitImportDialog = false" :disabled="gitImportSubmitting">Cancel</button>
        <button class="shrink-0 px-[0.85rem] py-[0.42rem] bg-[#10243a] border border-accent text-[#cfe8ff] rounded-[0.35rem] cursor-pointer disabled:opacity-55 disabled:cursor-not-allowed" :disabled="!gitImportUrl.trim() || gitImportSubmitting" @click="confirmGitImport">
          {{ gitImportSubmitting ? 'Starting…' : 'Clone' }}
        </button>
      </template>
    </Dialog>

    <!-- Properties Dialog (#5 stat-style file info) -->
    <Dialog v-model:visible="showPropertiesDialog" modal header="Properties" :style="{ width: '28rem' }">
      <div v-if="propertiesLoading" class="text-muted text-[0.82rem]">Loading…</div>
      <div v-else-if="propertiesError" class="text-[#f38ba8] text-[0.82rem]">{{ propertiesError }}</div>
      <table v-else-if="propertiesData" class="w-full text-[0.82rem]">
        <tbody>
          <tr v-for="row in propertiesRows" :key="row.label" class="align-top">
            <td class="py-[0.18rem] pr-2 text-muted whitespace-nowrap w-[10rem]">{{ row.label }}</td>
            <td class="py-[0.18rem] text-text break-all">{{ row.value }}</td>
          </tr>
        </tbody>
      </table>
      <template #footer>
        <button class="shrink-0 px-3 py-[0.34rem] bg-transparent border border-[#587296] text-[#c5d4ea] text-[0.85rem] rounded-[0.35rem] cursor-pointer hover:border-[#8fcaff] hover:text-[#e6f3ff]" @click="showPropertiesDialog = false">Close</button>
      </template>
    </Dialog>
  </aside>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import Tree from 'primevue/tree'
import ContextMenu from 'primevue/contextmenu'
import Dialog from 'primevue/dialog'
import InputText from 'primevue/inputtext'
import { logInfo } from '../../services/log'
import { PANE_COUNTS } from '../../composables/usePanes'
import workerSocket from '../../services/workerSocket'
import { useRoute } from 'vue-router'
import { takePendingSeed, currentScope } from '../../services/pendingSeed'

const _explorerRoute = useRoute()
const _explorerProjectId = Number(_explorerRoute.params.id)

const props = defineProps({
  terminalList:     { type: Array,  required: true },
  chatChannels:     { type: Array,  required: true },
  paneLayout:       { type: String, required: true },
  activePaneIndex:  { type: Number, required: true },
  isJoinedChannel:  { type: Function, required: true },
})

const emit = defineEmits([
  'open-file',
  'open-terminal',
  'open-channel',
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
  'open-debug',
])

// ── State ─────────────────────────────────────────────────────────────────────
const explorerSearch        = ref('')
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

function requestFileTree() {
  workerSocket.send('fs', 'tree', {})
}

const _offFsTree      = ref(null)
const _offWsConnected = ref(null)
const _offFsCreated   = ref(null)
const _offFsRenamed   = ref(null)
const _offFsDeleted   = ref(null)
const _offFsStat      = ref(null)
const _offFsStatErr   = ref(null)
const _offFsImportDone = ref(null)

onMounted(() => {
  _offFsTree.value = workerSocket.on('fs', 'tree', (payload) => {
    const root = payload?.tree
    if (!root || Array.isArray(root)) { fileTree.value = []; return }
    fileTree.value = (root.children || []).map(serverNodeToInternal)
    maybeRunPendingSeed()
  })
  _offWsConnected.value = workerSocket.on('system', 'connected', () => requestFileTree())
  _offFsCreated.value   = workerSocket.on('fs', 'created', () => requestFileTree())
  _offFsRenamed.value   = workerSocket.on('fs', 'renamed', () => requestFileTree())
  _offFsDeleted.value   = workerSocket.on('fs', 'deleted', () => requestFileTree())
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
  requestFileTree()
})

onBeforeUnmount(() => {
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
    { key: 'group:debug',     label: 'Debug',     selectable: false, draggable: false, droppable: false, data: { kind: 'group-debug' },     children: [] },
  ]
})

// ── Helpers ───────────────────────────────────────────────────────────────────
function treeIconClass(data) {
  switch (data?.kind) {
    case 'group-files':     return 'pi-folder-open'
    case 'group-terminals': return 'pi-desktop'
    case 'group-channels':  return 'pi-comments'
    case 'group-debug':     return 'pi-bug'
    case 'dir':             return 'pi-folder'
    case 'file':            return 'pi-file'
    case 'terminal':        return 'pi-terminal'
    case 'channel':         return 'pi-hashtag'
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
  }
}

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
      { separator: true },
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
  else if (kind === 'file')    selectionKeys.value = { [node.key]: true }
  contextMenuItems.value = buildContextMenuItems(node)
  if (contextMenuItems.value.length > 0) treeContextMenu.value?.show(event)
}

function onExplorerNodeContextMenuEvent(event) {
  onExplorerNodeContextMenu(event.originalEvent, event.node)
}

function onExplorerNodeDragStart(event, node) {
  const kind = node?.data?.kind
  if (['group-files', 'group-terminals', 'group-channels', 'dir'].includes(kind)) return
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
  workerSocket.send('fs', 'rename', { path: fileId, new_name: next.trim() })
}

function deletePath(path) {
  const name = String(path).split('/').pop() || path
  if (!window.confirm(`Delete "${name}"? This cannot be undone.`)) return
  workerSocket.send('fs', 'delete', { path })
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
  workerSocket.send('fs', 'create_file', { path, content: '' })
  showCreateFileDialog.value = false
}

function confirmCreateFolder() {
  const name = createFolderName.value.trim()
  if (!name) return
  const parent = createDialogParentPath.value.replace(/\/$/, '')
  const path = `${parent}/${name}`
  workerSocket.send('fs', 'create_dir', { path })
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


