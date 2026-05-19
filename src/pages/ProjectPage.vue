<template>
  <div class="workspace">
    <header class="workspace-header">
      <span class="project-name">{{ project?.name || 'Loading...' }}</span>
      <button class="btn-secondary" @click="$router.push('/dashboard')">← Dashboard</button>
    </header>

    <Menubar :model="menuItems" class="workspace-menubar" />

    <div class="workspace-body">
      <aside class="explorer">
        <div class="explorer-header">
          <span>Explorer</span>
        </div>
        <input v-model="explorerSearch" class="tree-search" placeholder="Filter explorer..." />

        <div class="tree-file-list">
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
                class="prime-tree-node-label"
                :draggable="!['group-files','group-terminals','group-channels','dir'].includes(slotProps.node.data?.kind)"
                @click="onExplorerNodeSelect(slotProps.node)"
                @dblclick.stop="onExplorerNodeDblClick(slotProps.node)"
                @contextmenu.prevent.stop="onExplorerNodeContextMenu($event, slotProps.node)"
                @dragstart.stop="onExplorerNodeDragStart($event, slotProps.node)"
              >
                <i class="pi" :class="treeIconClass(slotProps.node.data)" aria-hidden="true"></i>
                <span>{{ slotProps.node.label }}</span>
                <i
                  v-if="slotProps.node.data?.isOpen"
                  class="pi pi-circle-fill node-open-indicator"
                  title="Open in this browser context"
                  aria-hidden="true"
                ></i>
              </div>
            </template>
          </Tree>
        </div>
        <ContextMenu ref="treeContextMenu" :model="contextMenuItems" class="tree-context-overlay" />
      </aside>

      <section class="main-pane">
        <Splitter :key="paneLayout" :layout="layoutConfig.outer" class="workspace-splitter">
          <SplitterPanel
            v-for="(row, rowIdx) in layoutConfig.rows"
            :key="rowIdx"
            :class="row.length > 1 ? 'splitter-panel splitter-panel-inner' : 'splitter-panel'"
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
            />
            <Splitter
              v-else
              :layout="layoutConfig.inner"
              class="workspace-splitter splitter-nested"
            >
              <SplitterPanel
                v-for="paneIdx in row"
                :key="paneIdx"
                class="splitter-panel"
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
                />
              </SplitterPanel>
            </Splitter>
          </SplitterPanel>
        </Splitter>

        <nav class="workspace-dock">
          <button v-for="item in dockItems" :key="item.label" class="dock-btn" :title="item.label" @click="item.command">
            <i class="pi" :class="item.icon"></i>
          </button>
        </nav>
      </section>
    </div>

    <div v-if="error" class="error-banner">{{ error }}</div>

    <Dialog v-model:visible="showCreateTerminalDialog" modal header="Create Terminal" :style="{ width: '28rem' }">
      <div class="form-row">
        <label class="form-label" for="terminal-name">Name</label>
        <InputText id="terminal-name" v-model="terminalCreateName" class="form-input" @keydown.enter="confirmCreateTerminal" />
      </div>
      <div class="form-row">
        <label class="form-label" for="terminal-options">Options (placeholder)</label>
        <InputText id="terminal-options" v-model="terminalCreateOptions" class="form-input" placeholder="Not implemented yet" disabled />
      </div>
      <template #footer>
        <button class="btn-secondary" @click="showCreateTerminalDialog = false">Cancel</button>
        <button class="btn-primary" @click="confirmCreateTerminal">Create</button>
      </template>
    </Dialog>

    <Dialog v-model:visible="showCreateChannelDialog" modal header="Create Channel" :style="{ width: '24rem' }">
      <div class="form-row">
        <label class="form-label" for="channel-name">Channel Name</label>
        <InputText id="channel-name" v-model="channelCreateName" class="form-input" @keydown.enter="confirmCreateChannel" />
      </div>
      <template #footer>
        <button class="btn-secondary" @click="showCreateChannelDialog = false">Cancel</button>
        <button class="btn-primary" @click="confirmCreateChannel">Create</button>
      </template>
    </Dialog>
  </div>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount, computed, watch } from 'vue'
import { useRoute } from 'vue-router'
import '@xterm/xterm/css/xterm.css'
import Tree from 'primevue/tree'
import ContextMenu from 'primevue/contextmenu'
import Menubar from 'primevue/menubar'
import Splitter from 'primevue/splitter'
import SplitterPanel from 'primevue/splitterpanel'
import Dialog from 'primevue/dialog'
import InputText from 'primevue/inputtext'
import WorkspacePaneShell from '../components/workspace/WorkspacePaneShell.vue'
import workerSocket from '../services/workerSocket'
import { logInfo } from '../services/log'
import { listProjects, getWsToken } from '../services/projectService'
import { storeToRefs } from 'pinia'
import { usePanes, PANE_COUNTS } from '../composables/usePanes'
import { useTerminals } from '../composables/useTerminals'
import { useChat } from '../composables/useChat'
import { useWorkspaceStore } from '../stores/workspaceStore'

// ── Layout configuration ──────────────────────────────────────────────────────
// Each entry describes the outer Splitter direction, inner Splitter direction,
// and which pane indices belong in each "row" of the outer Splitter.
// Rows with a single index render a plain pane; rows with multiple indices get
// a nested inner Splitter.
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

const workspaceStore = useWorkspaceStore()
const { wsConnected, joinedChatChannels: storeJoinedChatChannels } = storeToRefs(workspaceStore)

// ── Composables ───────────────────────────────────────────────────────────────
// usePanes receives forward references to the page-level select* wrappers below
const {
  paneLayout, activePaneIndex, panes,
  menuLayoutItems, dockLayoutItems,
  bindTabToActivePane, bindTabToPane, setPaneLayout,
  activatePaneTab, closePaneTab,
  onTabDragStart, onTabDrop, onPaneDrop,
} = usePanes({
  activePane,
  pendingNavigation,
})

const terminals = useTerminals({ error, bindTabToActivePane, activePane })
const {
  terminalLoading, terminalList, selectedTerminalId,
  showCreateTerminalDialog, terminalCreateName, terminalCreateOptions,
  openCreateTerminalDialog, confirmCreateTerminal,
  openTerminal, renameTerminalById, renameSelectedTerminal, terminalModeNoop,
  registerHandlers: registerTerminalHandlers, cleanup: cleanupTerminals,
} = terminals

const chat = useChat(projectId, { wsConnected, error, bindTabToActivePane, activePane })
const {
  chatEl, chatChannels, selectedChatChannelId, chatUsers,
  activeChannelName,
  isJoinedChannel, setJoinedChannel, createChannelByName, sendChat, scrollChat,
  joinChannelFromContext, leaveChannelFromContext,
  registerHandlers: registerChatHandlers, init: initChat, cleanup: cleanupChat,
} = chat

// ── Explorer tree state ───────────────────────────────────────────────────────
const explorerSearch = ref('')
const selectedFileId = ref('README.md')
const fileTree = ref([
  {
    id: 'app',
    name: 'app',
    type: 'dir',
    children: [
      {
        id: 'app/controllers',
        name: 'controllers',
        type: 'dir',
        children: [
          { id: 'app/controllers/application_controller.rb', name: 'application_controller.rb', type: 'file' },
          {
            id: 'app/controllers/api',
            name: 'api',
            type: 'dir',
            children: [
              { id: 'app/controllers/api/chat_channels_controller.rb', name: 'chat_channels_controller.rb', type: 'file' },
              { id: 'app/controllers/api/chat_messages_controller.rb', name: 'chat_messages_controller.rb', type: 'file' }
            ]
          }
        ]
      },
      {
        id: 'app/models',
        name: 'models',
        type: 'dir',
        children: [
          { id: 'app/models/project.rb', name: 'project.rb', type: 'file' },
          { id: 'app/models/chat_channel.rb', name: 'chat_channel.rb', type: 'file' },
          { id: 'app/models/chat_message.rb', name: 'chat_message.rb', type: 'file' }
        ]
      }
    ]
  },
  {
    id: 'frontend',
    name: 'frontend',
    type: 'dir',
    children: [
      {
        id: 'frontend/src',
        name: 'src',
        type: 'dir',
        children: [
          {
            id: 'frontend/src/pages',
            name: 'pages',
            type: 'dir',
            children: [
              { id: 'frontend/src/pages/ProjectPage.vue', name: 'ProjectPage.vue', type: 'file' }
            ]
          },
          {
            id: 'frontend/src/services',
            name: 'services',
            type: 'dir',
            children: [
              { id: 'frontend/src/services/workerSocket.js', name: 'workerSocket.js', type: 'file' },
              { id: 'frontend/src/services/projectService.js', name: 'projectService.js', type: 'file' }
            ]
          }
        ]
      }
    ]
  },
  {
    id: 'worker',
    name: 'worker',
    type: 'dir',
    children: [
      { id: 'worker/worker.rb', name: 'worker.rb', type: 'file' },
      { id: 'worker/terminal_instance.rb', name: 'terminal_instance.rb', type: 'file' },
      { id: 'worker/chat_room.rb', name: 'chat_room.rb', type: 'file' },
      { id: 'worker/session.rb', name: 'session.rb', type: 'file' }
    ]
  },
  { id: 'README.md', name: 'README.md', type: 'file' },
  { id: 'UX_NOTES.md', name: 'UX_NOTES.md', type: 'file' }
])
const expandedExplorerKeys = ref({
  'group:files': true,
  'group:terminals': true,
  'group:channels': true,
  app: true,
  'app/controllers': true,
  frontend: true,
  'frontend/src': true,
  worker: true,
})
const selectionKeys     = ref({ [selectedFileId.value]: true })
const openedFileIds     = ref(new Set([selectedFileId.value]))
const openedTerminalIds = ref(new Set())
const treeContextMenu   = ref(null)
const contextMenuItems  = ref([])

// Channel dialog (terminal dialog lives in useTerminals)
const showCreateChannelDialog = ref(false)
const channelCreateName       = ref('')

// ── Menus ─────────────────────────────────────────────────────────────────────
const layoutConfig = computed(() => LAYOUT_CONFIGS[paneLayout.value] ?? LAYOUT_CONFIGS['one'])

const menuItems = computed(() => ([
  {
    label: 'Create',
    items: [
      { label: 'New Terminal', icon: 'pi pi-terminal', command: () => openCreateTerminalDialog() },
      { label: 'New Channel',  icon: 'pi pi-comments', command: () => openCreateChannelDialog() },
    ]
  },
  {
    label: 'Layout',
    items: menuLayoutItems.value,
  }
]))

const dockItems = computed(() => ([
  ...dockLayoutItems.value,
  { label: 'New Terminal',   icon: 'pi-plus-circle', command: () => openTerminal() },
  { label: 'Focus Terminal', icon: 'pi-terminal',    command: () => focusAnyTerminal() },
  { label: 'Join Channel',   icon: 'pi-comments',    command: () => focusAnyChannel() },
  { label: 'Open File',      icon: 'pi-file',        command: () => focusAnyFile() },
]))

// ── Page-level wrapper functions (update selectionKeys + delegate to composables) ──
async function selectTerminalNode(tid, options = {}) {
  selectedTerminalId.value = tid
  selectionKeys.value = { [`term:${tid}`]: true }
  markTerminalOpen(tid)
  if (options.paneIndex != null) activePaneIndex.value = options.paneIndex
  await terminals.selectTerminalNode(tid, options)
}

async function selectChannelNode(channelId, options = {}) {
  selectionKeys.value = { [`channel:${channelId}`]: true }
  if (options.paneIndex != null) activePaneIndex.value = options.paneIndex
  await chat.selectChannelNode(channelId, options)
}

function selectFileNode(fileId, options = {}) {
  selectedFileId.value = fileId
  selectionKeys.value = { [fileId]: true }
  markFileOpen(fileId)
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

// ── Pending navigation from usePanes (decouples usePanes from page functions) ──
watch(pendingNavigation, async (pending) => {
  if (!pending) return
  pendingNavigation.value = null
  const { kind, id, opts = {} } = pending
  if (kind === 'terminal')      await selectTerminalNode(id, opts)
  else if (kind === 'channel')  await selectChannelNode(id, opts)
  else if (kind === 'file')     selectFileNode(id, opts)
})

// ── Explorer helpers ──────────────────────────────────────────────────────────
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
  const terminals = terminalList.value.map((t) => ({
    key: `term:${t.id}`,
    label: t.name || `terminal #${t.id}`,
    selectable: true, draggable: false, droppable: false,
    data: { kind: 'terminal', id: t.id, isOpen: openedTerminalIds.value.has(Number(t.id)) }
  }))
  const channels = chatChannels.value.map((c) => ({
    key: `channel:${c.id}`,
    label: c.name,
    selectable: true, draggable: false, droppable: false,
    data: { kind: 'channel', id: c.id, isOpen: isJoinedChannel(c.id) }
  }))
  return [
    { key: 'group:files',     label: 'Files',     selectable: false, draggable: false, droppable: false, data: { kind: 'group-files' },     children: primeFileNodes.value },
    { key: 'group:terminals', label: 'Terminals', selectable: false, draggable: false, droppable: false, data: { kind: 'group-terminals' }, children: terminals },
    { key: 'group:channels',  label: 'Channels',  selectable: false, draggable: false, droppable: false, data: { kind: 'group-channels' },  children: channels },
  ]
})

function treeIconClass(data) {
  switch (data?.kind) {
    case 'group-files':     return 'pi-folder-open'
    case 'group-terminals': return 'pi-desktop'
    case 'group-channels':  return 'pi-comments'
    case 'dir':             return 'pi-folder'
    case 'file':            return 'pi-file'
    case 'terminal':        return 'pi-terminal'
    case 'channel':         return 'pi-hashtag'
    default:                return 'pi-circle'
  }
}

function onExplorerNodeSelect(event) {
  const node = event?.node || event
  if (!node?.data?.kind) return
  if (node.data.kind === 'file')     { selectFileNode(node.key);           return }
  if (node.data.kind === 'terminal') { selectTerminalNode(node.data.id);   return }
  if (node.data.kind === 'channel')  { selectChannelNode(node.data.id) }
}

function onExplorerNodeDblClick(node) {
  if (!node?.data?.kind) return
  if (node.data.kind === 'terminal') renameTerminalById(node.data.id)
}

// Open a node in a specific pane by index (used by context menu "Open in Pane N")
async function openNodeInPane(node, paneIndex) {
  activePaneIndex.value = paneIndex
  const kind = node?.data?.kind
  if (kind === 'file')     { await selectFileNode(node.key, { paneIndex }) }
  else if (kind === 'terminal') { await selectTerminalNode(node.data.id, { paneIndex }) }
  else if (kind === 'channel')  { await selectChannelNode(node.data.id, { paneIndex }) }
}

// Build "Open" + "Open in Pane N" items for openable node kinds
function buildOpenItems(node) {
  const validPaneCount = PANE_COUNTS[paneLayout.value] || 1
  if (validPaneCount === 1) {
    return [{ label: 'Open', command: () => openNodeInPane(node, 0) }]
  }
  const items = [
    { label: 'Open', command: () => openNodeInPane(node, activePaneIndex.value) },
    { separator: true },
  ]
  for (let i = 0; i < validPaneCount; i++) {
    const idx = i
    items.push({ label: `Open in Pane ${i + 1}`, command: () => openNodeInPane(node, idx) })
  }
  return items
}

function onExplorerNodeContextMenu(event, node) {
  if (!node?.data?.kind) return
  const kind = node.data.kind
  if (kind === 'terminal')      { selectedTerminalId.value = node.data.id; selectionKeys.value = { [`term:${node.data.id}`]: true } }
  else if (kind === 'channel')  { selectionKeys.value = { [`channel:${node.data.id}`]: true } }
  else if (kind === 'file')     { selectionKeys.value = { [node.key]: true } }
  contextMenuItems.value = buildContextMenuItems(node)
  if (contextMenuItems.value.length > 0) treeContextMenu.value?.show(event)
}

function buildContextMenuItems(node) {
  const kind = node?.data?.kind
  if (kind === 'group-terminals') return [{ label: 'New Terminal...', command: () => openCreateTerminalDialog() }]
  if (kind === 'group-channels')  return [{ label: 'New Channel...',  command: () => openCreateChannelDialog() }]
  if (kind === 'channel') {
    const cid = node.data.id
    const joined = isJoinedChannel(cid)
    return [
      ...buildOpenItems(node),
      { separator: true },
      { label: 'Join',  disabled:  joined, command: () => joinChannelFromContext(cid) },
      { label: 'Leave', disabled: !joined, command: () => leaveChannelFromContext(cid) },
    ]
  }
  if (kind === 'terminal') {
    const tid = node.data.id
    return [
      ...buildOpenItems(node),
      { separator: true },
      { label: 'Incognito/Exclusive', command: () => terminalModeNoop(tid) },
      { label: 'Rename',              command: () => renameTerminalById(tid) },
    ]
  }
  if (kind === 'file') {
    const fileId = node.key
    return [
      ...buildOpenItems(node),
      { separator: true },
      { label: 'View Extended Attributes', command: () => viewExtendedAttributes(fileId) },
      { label: 'Rename',                   command: () => renameFileById(fileId) },
      { label: 'Copy',   command: () => noopFileAction('Copy') },
      { label: 'Cut',    command: () => noopFileAction('Cut') },
      { label: 'Delete', command: () => noopFileAction('Delete') },
    ]
  }
  return []
}

function onExplorerNodeDragStart(event, node) {
  const kind = node?.data?.kind
  if (['group-files', 'group-terminals', 'group-channels', 'dir'].includes(kind)) return
  // For file nodes, id is a string path; for terminal/channel, id is numeric
  const id = kind === 'file' ? String(node.data.id) : Number(node.data.id)
  logInfo('ProjectPage', 'dragstart node', kind, id)
  event.dataTransfer.clearData()
  event.dataTransfer.effectAllowed = 'copy'
  event.dataTransfer.setData('application/x-carbide-node', JSON.stringify({ kind, id, label: node.label }))
}

function onExplorerNodeContextMenuEvent(event) {
  // Fired by PrimeVue Tree @node-context-menu for clicks outside the label div
  onExplorerNodeContextMenu(event.originalEvent, event.node)
}

function onExplorerNodeDrop(event) {
  const nextRootNodes = event?.value || []
  const filesGroup = nextRootNodes.find((n) => n?.key === 'group:files')
  if (!filesGroup || !Array.isArray(filesGroup.children)) return
  fileTree.value = filesGroup.children.map(extractFileTreeFromPrimeNode)
}

function extractFileTreeFromPrimeNode(node) {
  const kind = node?.data?.kind === 'dir' ? 'dir' : 'file'
  return {
    id: node.data?.id || node.key,
    name: node.label || node.data?.id || node.key,
    type: kind,
    children: kind === 'dir'
      ? (Array.isArray(node.children) ? node.children.map(extractFileTreeFromPrimeNode) : [])
      : undefined,
  }
}

function renameFileById(fileId) {
  const parts = String(fileId).split('/')
  const current = parts[parts.length - 1] || String(fileId)
  const next = window.prompt('File name:', current)
  if (!next || !next.trim()) return
  const nextName = next.trim()
  const updateNodes = (nodes) => nodes.map((node) => {
    if (node.id === fileId) return { ...node, name: nextName }
    if (node.children?.length) return { ...node, children: updateNodes(node.children) }
    return node
  })
  fileTree.value = updateNodes(fileTree.value)
}

function viewExtendedAttributes(fileId) { error.value = `Extended attributes for ${fileId} are not wired yet.` }
function noopFileAction(action)          { error.value = `${action} is currently a no-op.` }

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
  if (selectedFileId.value) { selectFileNode(selectedFileId.value); return }
  selectFileNode('README.md')
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────

onMounted(async () => {
  try {
    const projects = await listProjects()
    project.value = projects.find(p => p.id === projectId)

    await initChat()

    const token = await getWsToken(projectId)

    offHandlers.push(
      workerSocket.on('system', 'connected', () => {
        wsConnected.value = true
        storeJoinedChatChannels.value = new Set()
      })
    )

    registerTerminalHandlers(offHandlers, (tid) => selectTerminalNode(tid))
    registerChatHandlers(offHandlers)

    workerSocket.connect(token)
    selectFileNode('README.md')
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

// ── Utilities ─────────────────────────────────────────────────────────────────
function formatTime(ts) {
  if (!ts) return ''
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}
</script>

<style scoped>
.workspace {
  --bg-0: #0d1219;
  --bg-1: #111a26;
  --bg-2: #162233;
  --bg-3: #1f2f45;
  --line: #2b3d58;
  --text: #dce6f7;
  --muted: #91a2bc;
  --accent: #2ec4b6;
  --warn: #f07167;
  display: flex;
  flex-direction: column;
  flex: 1;
  height: 100%;
  min-height: 0;
  color: var(--text);
  background:
    radial-gradient(circle at 0% 0%, rgba(46, 196, 182, 0.08) 0, transparent 30%),
    radial-gradient(circle at 100% 100%, rgba(85, 130, 255, 0.1) 0, transparent 35%),
    var(--bg-0);
  font-family: "IBM Plex Sans", "Manrope", "Segoe UI", sans-serif;
}

.workspace-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.65rem 1rem;
  background: linear-gradient(90deg, var(--bg-2), #132135);
  border-bottom: 1px solid var(--line);
}

:deep(.workspace-menubar.p-menubar) {
  border: 0;
  border-bottom: 1px solid var(--line);
  border-radius: 0;
  background: linear-gradient(180deg, #101a29, #0f1724);
}

:deep(.workspace-menubar .p-menubar-item-link) {
  color: var(--text);
}

.project-name {
  font-size: 1.05rem;
  font-weight: 700;
  letter-spacing: 0.01em;
}

.workspace-body {
  display: grid;
  grid-template-columns: 300px minmax(0, 1fr);
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.explorer {
  border-right: 1px solid var(--line);
  background: linear-gradient(180deg, rgba(23, 34, 51, 0.95), rgba(16, 25, 39, 0.95));
  display: flex;
  flex-direction: column;
  min-height: 0;
  min-width: 0;
}

.explorer-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.65rem 0.75rem;
  border-bottom: 1px solid var(--line);
  font-size: 0.84rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.explorer-actions {
  display: inline-flex;
  gap: 0.35rem;
}

.tree-filter-select,
.tree-search,
.chat-input {
  background: #0f1724;
  border: 1px solid var(--line);
  color: var(--text);
  border-radius: 0.35rem;
}

.tree-filter-select {
  font-size: 0.75rem;
  padding: 0.2rem 0.35rem;
}

.tree-search {
  margin: 0.6rem 0.6rem 0.4rem;
  padding: 0.45rem 0.55rem;
  font-size: 0.82rem;
}

.tree-group {
  margin: 0.25rem 0.4rem;
  border: 1px solid rgba(84, 110, 146, 0.3);
  border-radius: 0.45rem;
  overflow: hidden;
}

.tree-file-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}

:deep(.tree-context-overlay.p-contextmenu) {
  background: #0d1522;
  border: 1px solid rgba(115, 148, 191, 0.45);
  box-shadow: 0 12px 28px rgba(0, 0, 0, 0.45);
}

.explorer-file-tree {
  background: transparent;
  border: 0;
  color: var(--text);
}

.prime-tree-node-label {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  width: 100%;
  min-width: 0;
}

.node-open-indicator {
  margin-left: auto;
  color: #7ce9de;
  font-size: 0.52rem;
  opacity: 0.9;
}

:deep(.explorer-file-tree .p-tree-root) {
  padding: 0.2rem;
}

:deep(.explorer-file-tree .p-tree-node-content) {
  border-radius: 0.3rem;
  padding: 0.25rem 0.35rem;
  color: var(--text);
}

:deep(.explorer-file-tree .p-tree-node-content:hover) {
  background: rgba(74, 110, 157, 0.35);
}

:deep(.explorer-file-tree .p-tree-node-toggle-button) {
  width: 1rem;
  height: 1rem;
  color: #9cb1cf;
}

:deep(.explorer-file-tree .p-tree-node-selectable.p-tree-node-selected > .p-tree-node-content),
:deep(.explorer-file-tree .p-tree-node-content.p-tree-node-selectable.p-tree-node-selected) {
  background: rgba(46, 196, 182, 0.17);
  box-shadow: inset 2px 0 0 var(--accent);
  color: #d7fff6;
}

:deep(.explorer-file-tree .pi-folder),
:deep(.explorer-file-tree .pi-file) {
  color: #86d7ff;
  font-size: 0.82rem;
}

.tree-group-header {
  background: var(--bg-2);
  color: var(--muted);
  padding: 0.42rem 0.55rem;
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

:deep(.explorer-file-tree .p-tree-container .p-treenode .p-treenode-content) {
  border-radius: 0.32rem;
}

.tree-node {
  width: 100%;
  text-align: left;
  background: transparent;
  border: 0;
  border-top: 1px solid rgba(84, 110, 146, 0.2);
  color: var(--text);
  padding: 0.42rem 0.55rem;
  font-size: 0.84rem;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 0.45rem;
}

.tree-node:hover { background: rgba(74, 110, 157, 0.35); }

.tree-node-file {
  gap: 0.3rem;
  padding-right: 0.35rem;
}

.tree-node-dir {
  color: #d1dcf2;
}

.tree-node-indent {
  flex: 0 0 auto;
}

.tree-twistie {
  width: 0.8rem;
  flex: 0 0 0.8rem;
  color: #a4b6d0;
  font-size: 0.72rem;
  text-align: center;
}

.tree-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tree-node.active {
  background: rgba(46, 196, 182, 0.17);
  color: #d7fff6;
  box-shadow: inset 2px 0 0 var(--accent);
}

.tree-node:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.tree-node-create {
  color: #c5ffe2;
  font-weight: 600;
}

.tree-icon {
  color: #7ce9de;
  font-family: "IBM Plex Mono", "Fira Code", monospace;
  font-size: 0.74rem;
}

.tree-empty {
  padding: 0.55rem;
  color: var(--muted);
  font-size: 0.78rem;
}

.main-pane {
  display: flex;
  flex-direction: column;
  flex: 1;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  gap: 0;
  padding: 0.4rem 0.4rem 0 0.4rem;
}

.workspace-splitter {
  width: 100%;
  height: 100%;
  flex: 1;
  min-height: 0;
  min-width: 0;
  border: 1px solid var(--line);
  background: rgba(8, 16, 28, 0.45);
}

.splitter-panel {
  min-width: 0;
  min-height: 0;
  height: 100%;
}

.splitter-panel-inner {
  padding: 0;
}

.splitter-nested {
  width: 100%;
  height: 100%;
}

.pane-shell {
  display: flex;
  flex-direction: column;
  min-height: 0;
  height: 100%;
  border: 1px solid rgba(84, 110, 146, 0.35);
  background: rgba(13, 20, 32, 0.7);
}

.pane-shell--active {
  border-color: rgba(46, 196, 182, 0.65);
}

.pane-tabs {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.3rem;
  border-bottom: 1px solid var(--line);
  overflow-x: auto;
}

.pane-tab {
  border: 1px solid rgba(87, 114, 150, 0.6);
  background: rgba(22, 34, 51, 0.7);
  color: var(--text);
  border-radius: 0.3rem;
  padding: 0.22rem 0.45rem;
  font-size: 0.74rem;
  cursor: pointer;
  white-space: nowrap;
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
}

.pane-tab.active {
  border-color: var(--accent);
  color: #d7fff6;
  box-shadow: inset 0 -2px 0 var(--accent);
}

.pane-tab-close {
  display: inline-grid;
  place-items: center;
  width: 0.95rem;
  height: 0.95rem;
  border-radius: 999px;
  font-size: 0.72rem;
  line-height: 1;
  color: #b7c7df;
}

.pane-tab-close:hover {
  background: rgba(255, 255, 255, 0.12);
  color: #ffffff;
}

.pane-tab-empty {
  color: var(--muted);
  font-size: 0.74rem;
  padding-left: 0.2rem;
}

.pane-inactive-placeholder {
  flex: 1;
  display: grid;
  place-items: center;
  color: var(--muted);
  font-size: 0.82rem;
  padding: 0.75rem;
}

.workspace-dock {
  flex-shrink: 0;
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: center;
  gap: 0.25rem;
  padding: 0.35rem 0.75rem;
  margin: 0.3rem auto 0.35rem;
  border: 1px solid rgba(115, 148, 191, 0.45);
  border-radius: 0.9rem;
  background: rgba(10, 18, 30, 0.86);
  backdrop-filter: blur(8px);
}

.dock-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2rem;
  height: 2rem;
  border-radius: 0.5rem;
  border: none;
  background: transparent;
  color: var(--muted);
  cursor: pointer;
  font-size: 0.95rem;
  transition: background 0.15s, color 0.15s;
}

.dock-btn:hover {
  background: rgba(46, 196, 182, 0.15);
  color: var(--accent);
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: var(--bg-1);
  border-bottom: 1px solid var(--line);
  padding: 0.5rem 0.85rem;
  font-weight: 700;
}

.pane-actions {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
}

.pane-meta {
  font-size: 0.75rem;
  color: #8ef7be;
  font-weight: 600;
}

.pane-content {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}

.xterm-container {
  flex: 1;
  min-height: 0;
  padding: 0.35rem;
  background: #0b1017;
}

.panel-placeholder {
  flex: 1;
  display: grid;
  place-items: center;
  text-align: center;
  color: var(--muted);
  padding: 1rem;
}

.chat-pane-content {
  background: linear-gradient(180deg, #0f1826, #0c1420);
}

.chat-messages {
  flex: 1;
  overflow-y: auto;
  padding: 0.75rem;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.chat-msg {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
  max-width: 80ch;
}

.chat-msg--own .chat-name { color: #8df4e9; }

.chat-name {
  color: #b4c5df;
  font-size: 0.8rem;
  font-weight: 600;
}

.chat-text {
  color: #eff5ff;
  font-size: 0.86rem;
  line-height: 1.3;
  word-break: break-word;
}

.chat-time {
  color: #778ba8;
  font-size: 0.72rem;
}

.chat-input-row {
  display: flex;
  gap: 0.5rem;
  padding: 0.55rem;
  border-top: 1px solid var(--line);
  background: rgba(17, 26, 38, 0.85);
}

.chat-input {
  flex: 1;
  padding: 0.45rem 0.65rem;
  font-size: 0.85rem;
}

.chat-input:focus,
.tree-search:focus,
.tree-filter-select:focus {
  outline: none;
  border-color: #67e8dc;
}

.btn-primary,
.btn-secondary {
  border-radius: 0.35rem;
  cursor: pointer;
}

.btn-xs {
  padding: 0.2rem 0.45rem;
  font-size: 0.72rem;
}

.btn-primary {
  padding: 0.42rem 0.85rem;
  background: #123549;
  border: 1px solid #2ec4b6;
  color: #9efdf3;
}

.btn-primary:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.btn-secondary {
  padding: 0.34rem 0.7rem;
  background: transparent;
  border: 1px solid #587296;
  color: #c5d4ea;
  font-size: 0.85rem;
}

.btn-secondary:hover {
  border-color: #7ce9de;
  color: #dffffa;
}

.form-row {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  margin-bottom: 0.7rem;
}

.form-label {
  color: var(--muted);
  font-size: 0.78rem;
  font-weight: 600;
}

.form-input {
  width: 100%;
}

.error-banner {
  padding: 0.5rem 0.8rem;
  background: #4d1b27;
  color: #ffb9c8;
  border-top: 1px solid #7f3243;
  font-size: 0.84rem;
}

@media (max-width: 980px) {
  .workspace-body {
    grid-template-columns: 1fr;
    grid-template-rows: 42vh minmax(0, 1fr);
    max-height: 100%;
  }

  .explorer {
    border-right: none;
    border-bottom: 1px solid var(--line);
  }
}
</style>
