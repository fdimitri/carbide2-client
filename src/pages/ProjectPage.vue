<template>
  <div class="flex flex-col flex-1 h-full min-h-0 text-text font-ui workspace-bg">
    <header class="flex items-center justify-between px-4 py-[0.65rem] bg-gradient-to-r from-bg-2 to-[#132135] border-b border-line">
      <span class="text-[1.05rem] font-bold tracking-[0.01em]">{{ project?.name || 'Loading...' }}</span>
      <button class="shrink-0 px-3 py-[0.34rem] bg-transparent border border-[#587296] text-[#c5d4ea] text-[0.85rem] rounded-[0.35rem] cursor-pointer hover:border-[#7ce9de] hover:text-[#dffffa]" @click="$router.push('/dashboard')">← Dashboard</button>
    </header>

    <Menubar :model="menuItems" class="workspace-menubar" />

    <div class="grid flex-1 min-h-0 overflow-hidden [grid-template-columns:300px_minmax(0,1fr)] max-[980px]:[grid-template-columns:1fr] max-[980px]:[grid-template-rows:42vh_minmax(0,1fr)]">
      <ExplorerPane
        ref="explorerPane"
        :terminal-list="terminalList"
        :chat-channels="chatChannels"
        :pane-layout="paneLayout"
        :active-pane-index="activePaneIndex"
        :is-joined-channel="isJoinedChannel"
        @open-file="onExplorerOpenFile"
        @open-terminal="onExplorerOpenTerminal"
        @open-channel="onExplorerOpenChannel"
        @open-in-pane="onExplorerOpenInPane"
        @create-terminal="openCreateTerminalDialogTracked"
        @create-channel="openCreateChannelDialog"
        @rename-terminal="renameTerminalById"
        @destroy-terminal="destroyTerminalById"
        @set-terminal-agent-accessible="(e) => setAgentAccessible(e.id, e.enabled)"
        @join-channel="joinChannelFromContext"
        @leave-channel="leaveChannelFromContext"
        @open-upload="onExplorerOpenUpload"
        @open-debug="openDebugPane"
      />

      <section class="flex flex-col flex-1 w-full h-full min-w-0 min-h-0 gap-0 px-[0.4rem] pt-[0.4rem]">
        <Splitter :key="paneLayout" :layout="layoutConfig.outer" class="workspace-splitter flex-1 min-h-0 min-w-0">
          <SplitterPanel
            v-for="(row, rowIdx) in layoutConfig.rows"
            :key="rowIdx"
            :class="row.length > 1 ? 'min-w-0 min-h-0 h-full p-0' : 'min-w-0 min-h-0 h-full'"
          >
            <WorkspacePaneShell
              v-if="row.length === 1"
              :pane="panes[row[0]]"
              :pane-index="row[0]"
              :active-pane-index="activePaneIndex"
              @pane-drop="onPaneDrop"
              @set-active-pane="setActivePane($event)"
              @activate-tab="activatePaneTab"
              @close-tab="closePaneTab"
              @tab-drag-start="onTabDragStart"
              @tab-drop="onTabDrop"
              @rename-terminal="renameSelectedTerminal"
              @send-chat="(channelId, text) => sendChat(channelId, text)"
              @agent-send="agents.send"
              @agent-reset="agents.resetConversation"
              @agent-pick="agents.selectAgent"
              @agent-load="agents.loadConversation"
              @agent-set-visibility="agents.setVisibility"
            />
            <Splitter
              v-else
              :layout="layoutConfig.inner"
              class="workspace-splitter w-full h-full min-h-0 min-w-0"
            >
              <SplitterPanel
                v-for="paneIdx in row"
                :key="paneIdx"
              class="min-w-0 min-h-0 h-full"
              >
                <WorkspacePaneShell
                  :pane="panes[paneIdx]"
                  :pane-index="paneIdx"
                  :active-pane-index="activePaneIndex"
                  @pane-drop="onPaneDrop"
                  @set-active-pane="setActivePane($event)"
                  @activate-tab="activatePaneTab"
                  @close-tab="closePaneTab"
                  @tab-drag-start="onTabDragStart"
                  @tab-drop="onTabDrop"
                  @rename-terminal="renameSelectedTerminal"
                  @send-chat="(channelId, text) => sendChat(channelId, text)"
                  @agent-send="agents.send"
                  @agent-reset="agents.resetConversation"
                  @agent-pick="agents.selectAgent"
                  @agent-load="agents.loadConversation"
                  @agent-set-visibility="agents.setVisibility"
                />
              </SplitterPanel>
            </Splitter>
          </SplitterPanel>
        </Splitter>

        <nav class="flex items-center justify-center gap-1 px-2 py-1 border-t border-[rgba(43,61,88,0.7)] bg-[rgba(10,18,30,0.9)] shrink-0">
            <button v-for="item in dockItems" :key="item.label"
            class="inline-flex items-center justify-center w-8 h-8 rounded-lg border-0 bg-transparent text-muted cursor-pointer text-[0.95rem] transition-colors hover:bg-accent/15 hover:text-accent"
            :title="item.label" @click="item.command">
            <i class="pi" :class="item.icon"></i>
          </button>
        </nav>
      </section>
    </div>

    <div v-if="error" class="px-3 py-2 bg-[#4d1b27] text-[#ffb9c8] border-t border-[#7f3243] text-[0.84rem]">{{ error }}</div>

    <Dialog v-model:visible="showCreateTerminalDialog" modal header="Create Terminal" :style="{ width: '28rem' }">
      <div class="flex flex-col gap-[0.35rem] mb-[0.7rem]">
        <label class="text-muted text-[0.78rem] font-semibold" for="terminal-name">Name</label>
        <InputText id="terminal-name" v-model="terminalCreateName" class="w-full" @keydown.enter="confirmCreateTerminal" />
      </div>
      <div class="flex items-start gap-[0.5rem] mb-[0.7rem]">
        <input
          id="terminal-agent-accessible"
          type="checkbox"
          v-model="terminalCreateAgentAccessible"
          class="mt-[0.25rem]"
          @change="onAgentAccessibleToggleFromUi"
        />
        <label for="terminal-agent-accessible" class="text-[0.82rem] text-text leading-[1.2]">
          <span class="font-semibold text-[#9efdf3]">Agent-accessible</span>
          <span class="block text-muted text-[0.74rem]">
            Allow the LLM agent to drive this terminal via shell_exec.
            The agent's commands will appear here live; while it is
            running a command, your keystrokes are dropped until it
            releases (auto-released by timeout).
          </span>
        </label>
      </div>
      <div class="flex flex-col gap-[0.35rem] mb-[0.7rem]">
        <label class="text-muted text-[0.78rem] font-semibold" for="terminal-options">Options (placeholder)</label>
        <InputText id="terminal-options" v-model="terminalCreateOptions" class="w-full" placeholder="Not implemented yet" disabled />
      </div>
      <template #footer>
        <button class="shrink-0 px-3 py-[0.34rem] bg-transparent border border-[#587296] text-[#c5d4ea] text-[0.85rem] rounded-[0.35rem] cursor-pointer hover:border-[#7ce9de] hover:text-[#dffffa]" @click="showCreateTerminalDialog = false">Cancel</button>
        <button class="shrink-0 px-[0.85rem] py-[0.42rem] bg-[#123549] border border-accent text-[#9efdf3] rounded-[0.35rem] cursor-pointer disabled:opacity-55 disabled:cursor-not-allowed" @click="confirmCreateTerminal">Create</button>
      </template>
    </Dialog>

    <Dialog v-model:visible="showCreateChannelDialog" modal header="Create Channel" :style="{ width: '24rem' }">
      <div class="flex flex-col gap-[0.35rem] mb-[0.7rem]">
        <label class="text-muted text-[0.78rem] font-semibold" for="channel-name">Channel Name</label>
        <InputText id="channel-name" v-model="channelCreateName" class="w-full" @keydown.enter="confirmCreateChannel" />
      </div>
      <template #footer>
        <button class="shrink-0 px-3 py-[0.34rem] bg-transparent border border-[#587296] text-[#c5d4ea] text-[0.85rem] rounded-[0.35rem] cursor-pointer hover:border-[#7ce9de] hover:text-[#dffffa]" @click="showCreateChannelDialog = false">Cancel</button>
        <button class="shrink-0 px-[0.85rem] py-[0.42rem] bg-[#123549] border border-accent text-[#9efdf3] rounded-[0.35rem] cursor-pointer disabled:opacity-55 disabled:cursor-not-allowed" @click="confirmCreateChannel">Create</button>
      </template>
    </Dialog>

    <Dialog v-model:visible="showUploadDialog" modal :header="uploadMode === 'archive' ? 'Upload & Extract Archive' : 'Upload File / Archive'" :style="{ width: '28rem' }">
      <div class="flex flex-col gap-[0.6rem] mb-[0.7rem]">
        <label class="text-muted text-[0.78rem] font-semibold" for="upload-file">File (any file, .zip, .tar, .tar.gz)</label>
        <input id="upload-file" type="file" @change="uploadFile = $event.target.files?.[0] || null"
               class="text-[0.85rem] text-[#c5d4ea]" />
        <label class="text-muted text-[0.78rem] font-semibold mt-[0.4rem]" for="upload-dest">Destination Path</label>
        <InputText id="upload-dest" v-model="uploadDest" class="w-full" placeholder="/" />
        <div v-if="uploadResult" class="text-muted text-[0.75rem] mt-[0.3rem] whitespace-pre-wrap">{{ uploadResult }}</div>
      </div>
      <template #footer>
        <button class="shrink-0 px-3 py-[0.34rem] bg-transparent border border-[#587296] text-[#c5d4ea] text-[0.85rem] rounded-[0.35rem] cursor-pointer hover:border-[#7ce9de] hover:text-[#dffffa]" @click="showUploadDialog = false">Cancel</button>
        <button class="shrink-0 px-[0.85rem] py-[0.42rem] bg-[#123549] border border-accent text-[#9efdf3] rounded-[0.35rem] cursor-pointer disabled:opacity-55 disabled:cursor-not-allowed" :disabled="!uploadFile || uploading" @click="confirmUpload">{{ uploading ? 'Uploading…' : 'Upload' }}</button>
      </template>
    </Dialog>
  </div>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount, computed, watch } from 'vue'
import { useRoute } from 'vue-router'
import '@xterm/xterm/css/xterm.css'
import Menubar from 'primevue/menubar'
import Splitter from 'primevue/splitter'
import SplitterPanel from 'primevue/splitterpanel'
import Dialog from 'primevue/dialog'
import InputText from 'primevue/inputtext'
import WorkspacePaneShell from '../components/workspace/WorkspacePaneShell.vue'
import ExplorerPane from '../components/workspace/ExplorerPane.vue'
import workerSocket from '../services/workerSocket'
import { listProjects, getWsToken, uploadProjectFile, importProjectFromDisk } from '../services/projectService'
import { storeToRefs } from 'pinia'
import { usePanes, PANE_COUNTS } from '../composables/usePanes'
import { useTerminals } from '../composables/useTerminals'
import { useChat } from '../composables/useChat'
import { useAgents } from '../composables/useAgents'
import { useWorkspaceStore } from '../stores/workspaceStore'
import { useDebugLogStore } from '../stores/debugLogStore'

// ── Layout configuration ──────────────────────────────────────────────────────
const LAYOUT_CONFIGS = {
  'one':                    { outer: 'horizontal', inner: 'horizontal', rows: [[0]] },
  'two-horizontal':         { outer: 'horizontal', inner: 'horizontal', rows: [[0], [1]] },
  'two-vertical':           { outer: 'vertical',   inner: 'horizontal', rows: [[0], [1]] },
  'three-horizontal-wide':  { outer: 'vertical',   inner: 'horizontal', rows: [[0], [1, 2]] },
  'three-vertical-tall':    { outer: 'horizontal', inner: 'vertical',   rows: [[0], [1, 2]] },
  'quad':                   { outer: 'vertical',   inner: 'horizontal', rows: [[0, 1], [2, 3]] },
}

// ── Shared state ──────────────────────────────────────────────────────────────
const route       = useRoute()
const projectId   = Number(route.params.id)
const project     = ref(null)
const error       = ref('')
const activePane  = ref('terminal')
const pendingNavigation = ref(null)
const offHandlers = []
const explorerPane = ref(null)
const workspaceStore = useWorkspaceStore()
const { wsConnected, joinedChatChannels: storeJoinedChatChannels } = storeToRefs(workspaceStore)
const debugLog = useDebugLogStore()

// ── Composables ───────────────────────────────────────────────────────────────
const {
  paneLayout, activePaneIndex, panes,
  menuLayoutItems, dockLayoutItems,
  bindTabToActivePane, bindTabToPane, setPaneLayout,
  activatePaneTab, closePaneTab,
  onTabDragStart, onTabDrop, onPaneDrop,
} = usePanes({ activePane, pendingNavigation })

const terminals = useTerminals({ error, bindTabToActivePane, activePane })
const {
  terminalLoading, terminalList, selectedTerminalId,
  showCreateTerminalDialog, terminalCreateName, terminalCreateOptions,
  terminalCreateAgentAccessible, suggestedTerminalName, onAgentAccessibleToggle,
  openCreateTerminalDialog, confirmCreateTerminal,
  openTerminal, renameTerminalById, renameSelectedTerminal, destroyTerminalById, terminalModeNoop,
  setAgentAccessible,
  registerHandlers: registerTerminalHandlers, cleanup: cleanupTerminals,
} = terminals

// Track the name we last auto-suggested so toggling the agent-accessible
// checkbox can overwrite it without trampling a name the user typed.
let lastSuggestedTerminalName = ''
function openCreateTerminalDialogTracked() {
  openCreateTerminalDialog()
  lastSuggestedTerminalName = terminalCreateName.value
}
function onAgentAccessibleToggleFromUi() {
  onAgentAccessibleToggle(lastSuggestedTerminalName)
  // Composable only overwrites the name when it matches what we last
  // suggested (or is blank). Remember the new suggestion for the next
  // toggle cycle so user edits stay sticky.
  lastSuggestedTerminalName = suggestedTerminalName(terminalCreateAgentAccessible.value)
}

const chat = useChat(projectId, { wsConnected, error, bindTabToActivePane, activePane })
const {
  chatEl, chatChannels, selectedChatChannelId,
  activeChannelName,
  isJoinedChannel, setJoinedChannel, createChannelByName, sendChat, scrollChat,
  joinChannelFromContext, leaveChannelFromContext,
  registerHandlers: registerChatHandlers, init: initChat, cleanup: cleanupChat,
} = chat

const agents = useAgents({ error, bindTabToActivePane })
const { registerHandlers: registerAgentHandlers } = agents

// ── Channel dialog ────────────────────────────────────────────────────────────
const showCreateChannelDialog = ref(false)
const channelCreateName       = ref('')

// ── Upload / Import (Files menu) ─────────────────────────────────────────────
const showUploadDialog = ref(false)
const uploadFile       = ref(null)
const uploadDest       = ref('/')
const uploadMode       = ref('file') // 'file' or 'archive' — UX hint only
const uploading        = ref(false)
const uploadResult     = ref('')

function openUploadDialog(dest = '/', mode = 'file') {
  uploadFile.value = null
  uploadDest.value = dest || '/'
  uploadMode.value = mode === 'archive' ? 'archive' : 'file'
  uploadResult.value = ''
  showUploadDialog.value = true
}

function onExplorerOpenUpload(payload) {
  openUploadDialog(payload?.dest || '/', payload?.mode || 'file')
}

function openDebugPane() {
  bindTabToActivePane('debug', 0, 'Debug')
}

async function confirmUpload() {
  if (!uploadFile.value) return
  uploading.value = true
  uploadResult.value = ''
  const fname = uploadFile.value.name
  const dest  = uploadDest.value || '/'
  try {
    const r = await uploadProjectFile(projectId, uploadFile.value, dest)
    uploadResult.value = `OK — files: ${r.files}, dirs: ${r.dirs}, skipped: ${r.skipped}` +
      (r.errors?.length ? `\nerrors:\n${r.errors.slice(0, 5).join('\n')}` : '')
    debugLog.push({
      severity: 'ok', source: 'upload', action: 'uploaded',
      detail: `${fname} → ${dest}  files=${r.files} dirs=${r.dirs} skipped=${r.skipped}` +
        (r.errors?.length ? `  errors=${r.errors.length}` : ''),
    })
    explorerPane.value?.refreshTree?.()
  } catch (e) {
    const msg = e.response?.data?.error || e.message
    uploadResult.value = `Error: ${msg}`
    debugLog.push({ severity: 'error', source: 'upload', action: 'failed', detail: `${fname} → ${dest}: ${msg}` })
  } finally {
    uploading.value = false
  }
}

async function triggerImportFromDisk() {
  try {
    const r = await importProjectFromDisk(projectId)
    const msg = `Imported from ${r.root_path}: ${r.files} files, ${r.dirs} dirs, ${r.existing} kept, ${r.skipped} skipped`
    debugLog.push({ severity: 'ok', source: 'import', action: 'import-from-disk', detail: msg })
    explorerPane.value?.refreshTree?.()
  } catch (e) {
    const msg = e.response?.data?.error || e.message
    error.value = `Import failed: ${msg}`
    debugLog.push({ severity: 'error', source: 'import', action: 'failed', detail: msg })
  }
}

function refreshTreeFromServer() {
  explorerPane.value?.refreshTree?.()
  debugLog.push({ severity: 'info', source: 'fs', action: 'refresh-tree', detail: 'requested file tree from server (DB)' })
}

// Mirror any status / error banner text into the Debug Channel for history.
watch(error, (msg) => {
  if (!msg) return
  const severity = /fail|error/i.test(msg) ? 'error' : 'info'
  debugLog.push({ severity, source: 'status', action: 'banner', detail: msg })
})

// ── Menus ─────────────────────────────────────────────────────────────────────
const layoutConfig = computed(() => LAYOUT_CONFIGS[paneLayout.value] ?? LAYOUT_CONFIGS['one'])

const menuItems = computed(() => ([
  {
    label: 'Create',
    items: [
      { label: 'New File...',   icon: 'pi pi-file-plus', command: () => explorerPane.value?.openCreateFileDialog('/') },
      { label: 'New Folder...', icon: 'pi pi-folder',    command: () => explorerPane.value?.openCreateFolderDialog('/') },
      { separator: true },
      { label: 'New Terminal', icon: 'pi pi-terminal', command: () => openCreateTerminalDialogTracked() },
      { label: 'New Channel',  icon: 'pi pi-comments', command: () => openCreateChannelDialog() },
    ]
  },
  {
    label: 'Layout',
    items: menuLayoutItems.value,
  },
  {
    label: 'Project',
    items: [
      { label: 'Settings…', icon: 'pi pi-cog', command: () => bindTabToActivePane('settings', projectId, 'Settings') },
    ]
  },
  {
    label: 'Files',
    items: [
      { label: 'Upload File / Archive…',           icon: 'pi pi-upload',   command: () => openUploadDialog('/', 'file') },
      { label: 'Import From Disk (rescan files)',  icon: 'pi pi-download', command: () => triggerImportFromDisk() },
      { separator: true },
      { label: 'Refresh Tree (reload from server)',icon: 'pi pi-refresh',  command: () => refreshTreeFromServer() },
    ]
  },
  {
    label: 'Debug',
    items: [
      { label: 'Open Debug Channel', icon: 'pi pi-bug',   command: () => openDebugPane() },
      { label: 'Clear Debug Log',    icon: 'pi pi-trash', command: () => debugLog.clear() },
    ]
  },
  {
    label: 'Agent',
    items: [
      { label: 'Open Agent Pane', icon: 'pi pi-sparkles', command: () => agents.openAgentPane() },
      { label: 'New Conversation', icon: 'pi pi-refresh',  command: () => agents.resetConversation() },
    ]
  },
]))

const dockItems = computed(() => ([
  ...dockLayoutItems.value,
  { label: 'New Terminal',   icon: 'pi-plus-circle', command: () => openTerminal() },
  { label: 'Focus Terminal', icon: 'pi-terminal',    command: () => focusAnyTerminal() },
  { label: 'Join Channel',   icon: 'pi-comments',    command: () => focusAnyChannel() },
  { label: 'Open File',      icon: 'pi-file',        command: () => focusAnyFile() },
]))

// ── Navigation helpers ────────────────────────────────────────────────────────
async function selectTerminalNode(tid, options = {}) {
  selectedTerminalId.value = tid
  if (options.paneIndex != null) activePaneIndex.value = options.paneIndex
  await terminals.selectTerminalNode(tid, options)
}

async function selectChannelNode(channelId, options = {}) {
  if (options.paneIndex != null) activePaneIndex.value = options.paneIndex
  await chat.selectChannelNode(channelId, options)
}

function selectFileNode(fileId, options = {}) {
  if (!options.skipPaneTab) {
    const label = String(fileId).split('/').pop() || String(fileId)
    if (options.paneIndex != null) {
      bindTabToPane(options.paneIndex, 'file', fileId, label)
    } else {
      bindTabToActivePane('file', fileId, label)
    }
  }
  activePane.value = 'file'
}

// ── Pending navigation from usePanes ─────────────────────────────────────────
watch(pendingNavigation, async (pending) => {
  if (!pending) return
  pendingNavigation.value = null
  const { kind, id, opts = {} } = pending
  if (kind === 'terminal')      await selectTerminalNode(id, opts)
  else if (kind === 'channel')  await selectChannelNode(id, opts)
  else if (kind === 'file')     selectFileNode(id, opts)
})

// ── ExplorerPane event handlers ───────────────────────────────────────────────
function onExplorerOpenFile(fileId) {
  selectFileNode(fileId)
}

async function onExplorerOpenTerminal(tid) {
  await selectTerminalNode(tid)
}

async function onExplorerOpenChannel(channelId) {
  await selectChannelNode(channelId)
}

async function onExplorerOpenInPane({ kind, id, paneIndex }) {
  activePaneIndex.value = paneIndex
  if (kind === 'file')          selectFileNode(id, { paneIndex })
  else if (kind === 'terminal') await selectTerminalNode(id, { paneIndex })
  else if (kind === 'channel')  await selectChannelNode(id, { paneIndex })
}

// ── Channel dialog ────────────────────────────────────────────────────────────
function openCreateChannelDialog() {
  channelCreateName.value = ''
  showCreateChannelDialog.value = true
}

async function confirmCreateChannel() {
  const name = channelCreateName.value.trim()
  if (!name) return
  showCreateChannelDialog.value = false
  await createChannelByName(name)
}

// ── Focus shortcuts ───────────────────────────────────────────────────────────
function setActivePane(index) {
  activePaneIndex.value = index
}

function focusAnyTerminal() {
  if (selectedTerminalId.value) { selectTerminalNode(selectedTerminalId.value); return }
  const first = terminalList.value[0]
  if (first) selectTerminalNode(first.id)
}

function focusAnyChannel() {
  if (selectedChatChannelId.value) { selectChannelNode(Number(selectedChatChannelId.value)); return }
  const first = chatChannels.value[0]
  if (first) selectChannelNode(first.id)
}

function focusAnyFile() {
  // No default file. User picks something from the explorer.
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────
onMounted(async () => {
  try {
    const projects = await listProjects()
    project.value = projects.find(p => p.id === projectId)

    await initChat()

    offHandlers.push(
      workerSocket.on('system', 'connected', () => {
        wsConnected.value = true
        storeJoinedChatChannels.value = new Set()
      })
    )

    registerTerminalHandlers(offHandlers, (tid) => selectTerminalNode(tid))
    registerChatHandlers(offHandlers)
    registerAgentHandlers(offHandlers)

    workerSocket.connect(() => getWsToken(projectId))
    // Intentionally do not auto-open any file; explorer will populate from server.
  } catch (e) {
    error.value = e.message || 'Failed to connect'
  }
})

onBeforeUnmount(() => {
  offHandlers.forEach(off => off())
  cleanupChat()
  cleanupTerminals()
  workerSocket.disconnect()
})
</script>


