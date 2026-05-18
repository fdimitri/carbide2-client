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
            :draggableNodes="true"
            :droppableNodes="true"
            draggableScope="files"
            droppableScope="files"
            @node-drop="onExplorerNodeDrop"
            @node-select="onExplorerNodeSelect"
          >
            <template #default="slotProps">
              <div
                class="prime-tree-node-label"
                @dblclick.stop="onExplorerNodeDblClick(slotProps.node)"
                @contextmenu.prevent.stop="onExplorerNodeContextMenu($event, slotProps.node)"
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
        <Splitter class="workspace-splitter">
          <SplitterPanel
            v-for="(_, paneIndex) in activePanes"
            :key="`pane-${paneIndex}`"
            class="splitter-panel"
          >
            <div class="pane-shell" :class="{ 'pane-shell--active': paneIndex === activePaneIndex }" @click="activatePane(paneIndex, $event)">
              <div class="pane-tabs">
                <button
                  v-for="tab in activePanes[paneIndex].tabs"
                  :key="tab.key"
                  class="pane-tab"
                  :class="{ active: activePanes[paneIndex].activeTab === tab.key }"
                  @click="activatePaneTab(paneIndex, tab.key)"
                >
                  <span>{{ tab.label }}</span>
                  <span class="pane-tab-close" @click.stop="closePaneTab(paneIndex, tab.key)">×</span>
                </button>
                <span v-if="activePanes[paneIndex].tabs.length === 0" class="pane-tab-empty">Empty pane</span>
              </div>

              <div v-if="paneIndex !== activePaneIndex" class="pane-inactive-placeholder">
                Click a tab to activate this pane.
              </div>

              <template v-else>
                <div class="panel-header pane-header">
                  <span v-if="activePane === 'terminal'">Terminal</span>
                  <span v-else-if="activePane === 'chat'">Channel #{{ activeChannelName }}</span>
                  <span v-else>File {{ selectedFileId }}</span>
                  <div class="pane-actions">
                    <div class="pane-meta" v-if="activePane === 'chat'">{{ chatUsers.length }} online</div>
                    <button
                      v-if="activePane === 'terminal' && selectedTerminalId"
                      class="btn-secondary btn-xs"
                      @click="renameSelectedTerminal"
                    >Rename</button>
                  </div>
                </div>

                <div v-show="activePane === 'terminal'" class="pane-content">
                  <div :ref="setTerminalEl" class="xterm-container" @click="xterm?.focus()"></div>
                  <div v-if="!terminalActive" class="panel-placeholder">Select or create a terminal from the tree.</div>
                </div>

                <div v-show="activePane === 'chat'" class="pane-content chat-pane-content">
                  <div class="chat-messages" ref="chatEl">
                    <div v-for="(msg, i) in chatMessages" :key="i" class="chat-msg"
                        :class="{ 'chat-msg--own': msg.user_id === currentUserId }">
                      <span class="chat-name">{{ msg.name }}</span>
                      <span class="chat-text">{{ msg.text }}</span>
                      <span class="chat-time">{{ formatTime(msg.timestamp) }}</span>
                    </div>
                    <div v-if="chatMessages.length === 0" class="panel-placeholder">No messages yet.</div>
                  </div>

                  <div class="chat-input-row">
                    <input
                      v-model="chatInput"
                      @keydown.enter="sendChat"
                      :placeholder="chatJoining ? 'Joining channel...' : 'Type a message...'"
                      :disabled="!wsConnected || chatJoining"
                      class="chat-input"
                    />
                    <button class="btn-primary" @click="sendChat" :disabled="!canSendChat">
                      Send
                    </button>
                  </div>
                </div>

                <div v-show="activePane === 'file'" class="pane-content">
                  <div class="panel-placeholder">
                    File preview pane for <strong>{{ selectedFileId }}</strong>.
                  </div>
                </div>
              </template>
            </div>
          </SplitterPanel>
        </Splitter>

        <Dock
          class="workspace-dock"
          :model="dockItems"
          :position="'bottom'"
          :tooltipOptions="{ event: 'hover', position: 'top' }"
        >
          <template #itemicon="slotProps">
            <i class="pi" :class="slotProps.item.icon"></i>
          </template>
        </Dock>
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
import { ref, onMounted, onBeforeUnmount, nextTick, computed, watch } from 'vue'
import { useRoute } from 'vue-router'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import Tree from 'primevue/tree'
import ContextMenu from 'primevue/contextmenu'
import Menubar from 'primevue/menubar'
import Dock from 'primevue/dock'
import Splitter from 'primevue/splitter'
import SplitterPanel from 'primevue/splitterpanel'
import Dialog from 'primevue/dialog'
import InputText from 'primevue/inputtext'
import workerSocket from '../services/workerSocket'
import { listProjects, getWsToken, listChatChannels, createChatChannel, listChatMessages, createChatMessage } from '../services/projectService'
import authService from '../services/authService'

const route        = useRoute()
const projectId    = Number(route.params.id)
const project      = ref(null)
const error        = ref('')
const wsConnected  = ref(false)
const activePane = ref('terminal')
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
const selectionKeys = ref({
  [selectedFileId.value]: true,
})
const openedFileIds = ref(new Set([selectedFileId.value]))
const openedTerminalIds = ref(new Set())
const treeContextMenu = ref(null)
const contextMenuItems = ref([])
const showCreateTerminalDialog = ref(false)
const showCreateChannelDialog = ref(false)
const terminalCreateName = ref('')
const terminalCreateOptions = ref('')
const channelCreateName = ref('')
const paneCount = ref(1)
const activePaneIndex = ref(0)
const panes = ref(Array.from({ length: 4 }, () => ({ tabs: [], activeTab: null })))

const activePanes = computed(() => panes.value.slice(0, paneCount.value))

const menuItems = computed(() => ([
  {
    label: 'Create',
    items: [
      { label: 'New Terminal', icon: 'pi pi-terminal', command: () => openCreateTerminalDialog() },
      { label: 'New Channel', icon: 'pi pi-comments', command: () => openCreateChannelDialog() },
    ]
  },
  {
    label: 'Layout',
    items: [
      { label: '1 Pane', command: () => setPaneCount(1) },
      { label: '2 Panes', command: () => setPaneCount(2) },
      { label: '3 Panes', command: () => setPaneCount(3) },
      { label: '4 Panes', command: () => setPaneCount(4) },
    ]
  }
]))

const dockItems = computed(() => ([
  { label: '1 Pane', icon: 'pi-stop', command: () => setPaneCount(1) },
  { label: '2 Panes', icon: 'pi-pause', command: () => setPaneCount(2) },
  { label: '3 Panes', icon: 'pi-th-large', command: () => setPaneCount(3) },
  { label: '4 Panes', icon: 'pi-table', command: () => setPaneCount(4) },
  { label: 'New Terminal', icon: 'pi-plus-circle', command: () => openTerminal() },
  { label: 'Focus Terminal', icon: 'pi-terminal', command: () => focusAnyTerminal() },
  { label: 'Join Channel', icon: 'pi-comments', command: () => focusAnyChannel() },
  { label: 'Open File', icon: 'pi-file', command: () => focusAnyFile() },
]))

function setPaneCount(count) {
  paneCount.value = Math.max(1, Math.min(4, Number(count) || 1))
  if (activePaneIndex.value >= paneCount.value) {
    activePaneIndex.value = paneCount.value - 1
  }
}

function setTerminalEl(el) {
  terminalEl.value = el
}

function openCreateTerminalDialog() {
  const maxTerminalId = terminalList.value.reduce((max, t) => Math.max(max, Number(t.id) || 0), 0)
  terminalCreateName.value = `Terminal#${maxTerminalId + 1}`
  terminalCreateOptions.value = ''
  showCreateTerminalDialog.value = true
}

async function confirmCreateTerminal() {
  const name = terminalCreateName.value.trim() || 'Terminal'
  showCreateTerminalDialog.value = false
  await openTerminal({ name })
}

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

function parseTabKey(key) {
  if (!key || typeof key !== 'string' || !key.includes(':')) return null
  const [kind, rawId] = key.split(':')
  if (kind === 'file') return { kind, id: rawId }
  return { kind, id: Number(rawId) }
}

function bindTabToActivePane(kind, id, label) {
  const pane = panes.value[activePaneIndex.value]
  const key = `${kind}:${id}`
  if (!pane.tabs.find((t) => t.key === key)) {
    pane.tabs.push({ key, kind, id, label })
  }
  pane.activeTab = key
}

function activatePane(paneIndex, event = null) {
  // Ignore clicks on interactive controls inside a pane (inputs, buttons, tabs).
  if (event?.target?.closest?.('input, textarea, button, .pane-tab, .chat-input-row')) return
  if (paneIndex === activePaneIndex.value) return
  activePaneIndex.value = paneIndex
  const key = panes.value[paneIndex]?.activeTab
  if (key) activatePaneTab(paneIndex, key)
}

async function activatePaneTab(paneIndex, key) {
  activePaneIndex.value = paneIndex
  const parsed = parseTabKey(key)
  if (!parsed) return

  if (parsed.kind === 'file') {
    selectFileNode(parsed.id, { skipPaneTab: true })
    return
  }

  if (parsed.kind === 'terminal') {
    await selectTerminalNode(parsed.id, { skipPaneTab: true })
    return
  }

  if (parsed.kind === 'channel') {
    await selectChannelNode(parsed.id, { skipPaneTab: true })
  }
}

function closePaneTab(paneIndex, key) {
  const pane = panes.value[paneIndex]
  if (!pane) return
  const idx = pane.tabs.findIndex((t) => t.key === key)
  if (idx === -1) return

  pane.tabs.splice(idx, 1)

  if (pane.activeTab !== key) return
  if (pane.tabs.length === 0) {
    pane.activeTab = null
    if (paneIndex === activePaneIndex.value) {
      activePane.value = 'file'
      terminalActive.value = false
    }
    return
  }

  const nextIdx = Math.max(0, idx - 1)
  const nextTab = pane.tabs[nextIdx]
  pane.activeTab = nextTab.key
  if (paneIndex === activePaneIndex.value) {
    activatePaneTab(paneIndex, nextTab.key)
  }
}

function focusAnyTerminal() {
  if (selectedTerminalId.value) {
    selectTerminalNode(selectedTerminalId.value)
    return
  }
  const first = terminalList.value[0]
  if (first) selectTerminalNode(first.id)
}

function focusAnyChannel() {
  if (selectedChatChannelId.value) {
    selectChannelNode(Number(selectedChatChannelId.value))
    return
  }
  const first = chatChannels.value[0]
  if (first) selectChannelNode(first.id)
}

function focusAnyFile() {
  if (selectedFileId.value) {
    selectFileNode(selectedFileId.value)
    return
  }
  selectFileNode('README.md')
}

bindTabToActivePane('file', selectedFileId.value, 'README.md')

// Terminal
const terminalEl       = ref(null)
const terminalActive   = ref(false)
const terminalLoading  = ref(false)
const terminalList     = ref([])
const selectedTerminalId = ref(null)
let createTerminalTimeout = null
let xterm    = null
let fitAddon = null
let terminalId = null
let terminalResizeObserver = null
let applyingRemoteResize = false
const onWindowResize = () => fitTerminalSoon()
const offHandlers = []

function fitTerminalSoon() {
  // Run fit after layout settles; single-pass fit can leave stale 24-row sizing.
  requestAnimationFrame(() => {
    fitAddon?.fit()
    requestAnimationFrame(() => fitAddon?.fit())
  })
}
// Chat
const chatEl       = ref(null)
const chatChannels = ref([])
const selectedChatChannelId = ref(null)
const chatMessages = ref([])
const chatUsers    = ref([])
const chatInput    = ref('')
const chatJoining  = ref(false)
const joinedChatChannels = ref(new Set())
let joinTimeoutHandle = null
const currentUserId = computed(() => authService.userId())
const activeChannelName = computed(() => {
  const ch = chatChannels.value.find(c => c.id === Number(selectedChatChannelId.value))
  return ch?.name || 'none'
})

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
    selectable: true,
    draggable: false,
    droppable: false,
    data: { kind: 'terminal', id: t.id, isOpen: openedTerminalIds.value.has(Number(t.id)) }
  }))

  const channels = chatChannels.value.map((c) => ({
    key: `channel:${c.id}`,
    label: c.name,
    selectable: true,
    draggable: false,
    droppable: false,
    data: { kind: 'channel', id: c.id, isOpen: isJoinedChannel(c.id) }
  }))

  return [
    {
      key: 'group:files',
      label: 'Files',
      selectable: false,
      draggable: false,
      droppable: false,
      data: { kind: 'group-files' },
      children: primeFileNodes.value,
    },
    {
      key: 'group:terminals',
      label: 'Terminals',
      selectable: false,
      draggable: false,
      droppable: false,
      data: { kind: 'group-terminals' },
      children: terminals,
    },
    {
      key: 'group:channels',
      label: 'Channels',
      selectable: false,
      draggable: false,
      droppable: false,
      data: { kind: 'group-channels' },
      children: channels,
    }
  ]
})

const canSendChat = computed(() => {
  const cid = Number(selectedChatChannelId.value)
  return wsConnected.value && !chatJoining.value && !!chatInput.value.trim() && joinedChatChannels.value.has(cid)
})

function activeChannelMatches(payload) {
  const active = Number(selectedChatChannelId.value)
  const incoming = Number(payload?.channel_id ?? payload?.chat_channel_id)
  return !!active && !!incoming && active === incoming
}

function isJoinedChannel(channelId) {
  return joinedChatChannels.value.has(Number(channelId))
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

function setJoinedChannel(channelId, joined) {
  const next = new Set(joinedChatChannels.value)
  if (joined) {
    next.add(Number(channelId))
  } else {
    next.delete(Number(channelId))
  }
  joinedChatChannels.value = next
}

function onExplorerNodeSelect(event) {
  const node = event?.node || event
  if (!node?.data?.kind) return

  if (node.data.kind === 'file') {
    selectFileNode(node.key)
    return
  }

  if (node.data.kind === 'terminal') {
    selectTerminalNode(node.data.id)
    return
  }

  if (node.data.kind === 'channel') {
    selectChannelNode(node.data.id)
  }
}

function onExplorerNodeDblClick(node) {
  if (!node?.data?.kind) return
  if (node.data.kind === 'terminal') {
    renameTerminalById(node.data.id)
  }
}

function onExplorerNodeContextMenu(event, node) {
  if (!node?.data?.kind) return
  const kind = node.data.kind

  if (kind === 'terminal') {
    selectedTerminalId.value = node.data.id
    selectionKeys.value = { [`term:${node.data.id}`]: true }
  } else if (kind === 'channel') {
    selectionKeys.value = { [`channel:${node.data.id}`]: true }
  } else if (kind === 'file') {
    selectionKeys.value = { [node.key]: true }
  }

  contextMenuItems.value = buildContextMenuItems(node)
  if (contextMenuItems.value.length > 0) {
    treeContextMenu.value?.show(event)
  }
}

function buildContextMenuItems(node) {
  const kind = node?.data?.kind
  if (kind === 'group-terminals') {
    return [
      { label: 'New Terminal...', command: () => openCreateTerminalDialog() },
    ]
  }

  if (kind === 'group-channels') {
    return [
      { label: 'New Channel...', command: () => openCreateChannelDialog() },
    ]
  }

  if (kind === 'channel') {
    const cid = node.data.id
    const joined = isJoinedChannel(cid)
    return [
      { label: 'Join', disabled: joined, command: () => joinChannelFromContext(cid) },
      { label: 'Leave', disabled: !joined, command: () => leaveChannelFromContext(cid) },
    ]
  }

  if (kind === 'terminal') {
    const tid = node.data.id
    return [
      { label: 'Incognito/Exclusive', command: () => terminalModeNoop(tid) },
      { label: 'Rename', command: () => renameTerminalById(tid) },
    ]
  }

  if (kind === 'file') {
    const fileId = node.key
    return [
      { label: 'View Extended Attributes', command: () => viewExtendedAttributes(fileId) },
      { label: 'Rename', command: () => renameFileById(fileId) },
      { label: 'Copy', command: () => noopFileAction('Copy') },
      { label: 'Cut', command: () => noopFileAction('Cut') },
      { label: 'Delete', command: () => noopFileAction('Delete') },
    ]
  }

  return []
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

async function joinChannelFromContext(channelId) {
  selectedChatChannelId.value = channelId
  await switchChatChannel()
}

function leaveChannelFromContext(channelId) {
  if (!isJoinedChannel(channelId)) return
  setJoinedChannel(channelId, false)
  workerSocket.send('chat', 'leave', { channel_id: channelId })
}

function terminalModeNoop(tid) {
  error.value = `Terminal #${tid} incognito/exclusive mode is not implemented yet.`
}

function viewExtendedAttributes(fileId) {
  error.value = `Extended attributes for ${fileId} are not wired yet.`
}

function noopFileAction(action) {
  error.value = `${action} is currently a no-op.`
}

function treeIconClass(data) {
  switch (data?.kind) {
    case 'group-files': return 'pi-folder-open'
    case 'group-terminals': return 'pi-desktop'
    case 'group-channels': return 'pi-comments'
    case 'dir': return 'pi-folder'
    case 'file': return 'pi-file'
    case 'terminal': return 'pi-terminal'
    case 'channel': return 'pi-hashtag'
    default: return 'pi-circle'
  }
}

function startJoinWait(channelId) {
  chatJoining.value = true
  if (joinTimeoutHandle) clearTimeout(joinTimeoutHandle)
  joinTimeoutHandle = setTimeout(() => {
    if (!isJoinedChannel(channelId) && Number(selectedChatChannelId.value) === Number(channelId)) {
      chatJoining.value = false
      error.value = 'Could not join channel yet. Check worker connection and try again.'
    }
    joinTimeoutHandle = null
  }, 4500)
}

function clearJoinWaitIfActive(channelId) {
  if (Number(selectedChatChannelId.value) !== Number(channelId)) return
  chatJoining.value = false
  if (joinTimeoutHandle) {
    clearTimeout(joinTimeoutHandle)
    joinTimeoutHandle = null
  }
}

onMounted(async () => {
  try {
    const projects = await listProjects()
    project.value  = projects.find(p => p.id === projectId)

    // Load channels list before websocket messages.
    chatChannels.value = await listChatChannels(projectId)
    if (chatChannels.value.length === 0) {
      const general = await createChatChannel(projectId, 'general')
      chatChannels.value = [general]
    }
    selectedChatChannelId.value = null
    chatMessages.value = []

    // Fetch token now, but connect only after handlers are registered to avoid
    // missing early 'system:connected' and chat join events.
    const token = await getWsToken(projectId)

    offHandlers.push(
      workerSocket.on('system', 'connected', () => {
        wsConnected.value = true
        joinedChatChannels.value = new Set()
      })
    )

    // Terminal list handler
    offHandlers.push(
      workerSocket.on('term', 'list', (p) => {
        terminalList.value = p.terminals || []
      }),
      workerSocket.on('term', 'created', (p) => {
        // Terminal was created, list will be broadcasted
        if (createTerminalTimeout) {
          clearTimeout(createTerminalTimeout)
          createTerminalTimeout = null
        }
        const createdTerminalId = p.terminal_id
        selectedTerminalId.value = createdTerminalId
        selectTerminalNode(createdTerminalId)
      }),
      workerSocket.on('term', 'renamed', () => {
        error.value = ''
      })
    )

    offHandlers.push(
      workerSocket.on('system', 'error', (p) => {
        if (createTerminalTimeout) {
          clearTimeout(createTerminalTimeout)
          createTerminalTimeout = null
        }
        terminalLoading.value = false
        error.value = p?.message || 'Worker error'
      })
    )

    // Chat handlers
    offHandlers.push(
      workerSocket.on('chat', 'message', (p) => {
        if (!activeChannelMatches(p)) return
        chatMessages.value.push(p)
        nextTick(() => scrollChat())
      }),
      workerSocket.on('chat', 'user_join', (p) => {
        if (!activeChannelMatches(p)) return
        if (!chatUsers.value.find(u => u.user_id === p.user_id)) {
          chatUsers.value.push({ user_id: p.user_id, name: p.name })
        }
        chatMessages.value.push({ system: true, text: `${p.name} joined`, timestamp: new Date().toISOString() })
        nextTick(() => scrollChat())
      }),
      workerSocket.on('chat', 'user_leave', (p) => {
        if (!activeChannelMatches(p)) return
        chatUsers.value = chatUsers.value.filter(u => u.user_id !== p.user_id)
        chatMessages.value.push({ system: true, text: `${p.name} left`, timestamp: new Date().toISOString() })
      }),
      workerSocket.on('chat', 'user_list', (p) => {
        if (!activeChannelMatches(p)) return
        chatUsers.value = p.users || []
      }),
      workerSocket.on('chat', 'joined', (p) => {
        const cid = Number(p.channel_id)
        if (cid) setJoinedChannel(cid, true)
        if (cid) {
          clearJoinWaitIfActive(cid)
          error.value = ''
        }
      }),
      workerSocket.on('chat', 'left', (p) => {
        const cid = Number(p.channel_id)
        if (cid) setJoinedChannel(cid, false)
        if (cid && cid === Number(selectedChatChannelId.value)) {
          chatJoining.value = true
        }
      })
    )

    // Terminal output handler (registered once, filtered by terminalId)
    offHandlers.push(
      workerSocket.on('term', 'output', (p) => {
        if (xterm && p.terminal_id === terminalId) {
          xterm.write(p.data)
        }
      }),
      workerSocket.on('term', 'joined', (p) => {
        if (!xterm || p.terminal_id !== terminalId) return
        if (Number.isFinite(Number(p.cols)) && Number.isFinite(Number(p.rows))) {
          applyingRemoteResize = true
          xterm.resize(Number(p.cols), Number(p.rows))
          applyingRemoteResize = false
        }
        fitTerminalSoon()
      }),
      workerSocket.on('term', 'resized', (p) => {
        if (!xterm || p.terminal_id !== terminalId) return
        if (!Number.isFinite(Number(p.cols)) || !Number.isFinite(Number(p.rows))) return
        applyingRemoteResize = true
        xterm.resize(Number(p.cols), Number(p.rows))
        applyingRemoteResize = false
      }),
      workerSocket.on('term', 'exit', (p) => {
        if (xterm && p.terminal_id === terminalId) {
          xterm.writeln('\r\n[session ended]')
          terminalActive.value = false
        }
      })
    )

    // Connect after registering all handlers so no initial events are missed.
    workerSocket.connect(token)
  } catch (e) {
    error.value = e.message || 'Failed to connect'
  }
})

// Re-focus xterm whenever terminal becomes active (handles re-renders)
watch(terminalActive, (active) => {
  if (active) {
    nextTick(() => {
      fitTerminalSoon()
      xterm?.focus()
    })
  }
})

// Route keystrokes to xterm when it's active and nothing else has focus
function onDocumentKeydown(e) {
  if (!terminalActive.value || !xterm || activePane.value !== 'terminal') return
  const tag = document.activeElement?.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || document.activeElement?.isContentEditable) return
  xterm.focus()
}

onMounted(() => { document.addEventListener('keydown', onDocumentKeydown) })

onBeforeUnmount(() => {
  document.removeEventListener('keydown', onDocumentKeydown)
  window.removeEventListener('resize', onWindowResize)
  terminalResizeObserver?.disconnect()
  terminalResizeObserver = null
  if (joinTimeoutHandle) {
    clearTimeout(joinTimeoutHandle)
    joinTimeoutHandle = null
  }
  offHandlers.forEach(off => off())
  workerSocket.disconnect()
  xterm?.dispose()
})

async function openTerminal(options = {}) {
  if (terminalLoading.value) return
  terminalLoading.value = true
  error.value = ''
  try {
    // Send create message via WebSocket
    workerSocket.send('term', 'create', { name: options.name })
    // Never leave UI stuck if worker does not answer.
    createTerminalTimeout = setTimeout(() => {
      terminalLoading.value = false
      error.value = 'Timed out creating terminal. Check worker logs and JWT secret.'
      createTerminalTimeout = null
    }, 5000)
  } catch (e) {
    if (createTerminalTimeout) {
      clearTimeout(createTerminalTimeout)
      createTerminalTimeout = null
    }
    error.value = e.message || 'Failed to create terminal'
    terminalLoading.value = false
  }
}

async function connectToTerminal(tid) {
  terminalLoading.value = true
  try {
    // Ensure terminal container is mounted before xterm.open().
    activePane.value = 'terminal'
    terminalId = tid
    markTerminalOpen(tid)
    await nextTick()

    if (!terminalEl.value) {
      throw new Error('Terminal pane not ready')
    }

    const needsReattach = !xterm || !terminalEl.value.querySelector('.xterm')

    if (needsReattach) {
      xterm?.dispose()
      xterm    = new Terminal({ cursorBlink: true, fontSize: 14, theme: { background: '#1e1e1e' } })
      fitAddon = new FitAddon()
      xterm.loadAddon(fitAddon)
      xterm.open(terminalEl.value)
      fitAddon.fit()

      xterm.onData(data => {
        console.log('[xterm onData] data:', JSON.stringify(data), 'terminalId:', terminalId, 'wsReady:', workerSocket._ready)
        workerSocket.send('term', 'input', { terminal_id: terminalId, data })
      })

      xterm.onResize(({ cols, rows }) => {
        if (applyingRemoteResize) return
        workerSocket.send('term', 'resize', { terminal_id: terminalId, cols, rows })
      })

      window.addEventListener('resize', onWindowResize)
      // Keep xterm sized to its container when layout changes without window resize.
      terminalResizeObserver = new ResizeObserver(() => fitTerminalSoon())
      terminalResizeObserver.observe(terminalEl.value)
    } else {
      // Clear terminal when switching to new session
      xterm.reset()
      fitTerminalSoon()
    }

    workerSocket.send('term', 'join', { terminal_id: terminalId })
    terminalActive.value = true
    // Focus AFTER Vue re-renders (terminalActive flip may cause DOM changes)
    await nextTick()
    xterm.focus()
  } catch (e) {
    error.value = e.message || 'Failed to connect to terminal'
  } finally {
    terminalLoading.value = false
  }
}

async function refreshTerminalList() {
  try {
    // Terminal list is broadcasted by worker, no need to manually refresh
  } catch (e) {
    console.error('Failed to refresh terminal list:', e)
  }
}

async function switchTerminal() {
  if (!selectedTerminalId.value) return
  await connectToTerminal(selectedTerminalId.value)
}

async function selectTerminalNode(tid, options = {}) {
  selectedTerminalId.value = tid
  selectionKeys.value = { [`term:${tid}`]: true }
  const current = terminalList.value.find(t => Number(t.id) === Number(tid))
  if (!options.skipPaneTab) {
    bindTabToActivePane('terminal', tid, current?.name || `terminal #${tid}`)
  }
  await switchTerminal()
}

async function switchChatChannel() {
  if (!selectedChatChannelId.value) return
  const nextChannel = Number(selectedChatChannelId.value)
  activePane.value = 'chat'
  startJoinWait(nextChannel)

  // Join selected channel immediately so loading history can never block chat state.
  workerSocket.send('chat', 'join', { channel_id: nextChannel })

  // PART previous active channel if joined, then JOIN the next channel.
  joinedChatChannels.value.forEach((cid) => {
    if (cid !== nextChannel) {
      workerSocket.send('chat', 'leave', { channel_id: cid })
    }
  })

  chatUsers.value = []
  try {
    chatMessages.value = await listChatMessages(projectId, nextChannel)
  } catch (e) {
    chatMessages.value = []
    error.value = e.message || 'Failed to load channel history'
  }
}

async function selectChannelNode(channelId, options = {}) {
  selectedChatChannelId.value = channelId
  selectionKeys.value = { [`channel:${channelId}`]: true }
  const current = chatChannels.value.find(c => Number(c.id) === Number(channelId))
  if (!options.skipPaneTab) {
    bindTabToActivePane('channel', channelId, current?.name || `channel #${channelId}`)
  }
  await switchChatChannel()
}

function selectFileNode(fileId, options = {}) {
  selectedFileId.value = fileId
  selectionKeys.value = { [fileId]: true }
  markFileOpen(fileId)
  if (!options.skipPaneTab) {
    const label = String(fileId).split('/').pop() || String(fileId)
    bindTabToActivePane('file', fileId, label)
  }
  activePane.value = 'file'
}

async function renameSelectedTerminal() {
  if (!selectedTerminalId.value) return
  renameTerminalById(selectedTerminalId.value)
}

function renameTerminalById(tid) {
  const current = terminalList.value.find(t => Number(t.id) === Number(tid))
  const fallback = `terminal #${tid}`
  const name = window.prompt('Terminal name:', current?.name || fallback)
  if (!name || !name.trim()) return
  workerSocket.send('term', 'rename', { terminal_id: tid, name: name.trim() })
}

function renameFileById(fileId) {
  const parts = String(fileId).split('/')
  const current = parts[parts.length - 1] || String(fileId)
  const next = window.prompt('File name:', current)
  if (!next || !next.trim()) return
  const nextName = next.trim()

  const updateNodes = (nodes) => nodes.map((node) => {
    if (node.id === fileId) {
      return { ...node, name: nextName }
    }
    if (node.children?.length) {
      return { ...node, children: updateNodes(node.children) }
    }
    return node
  })

  fileTree.value = updateNodes(fileTree.value)
}

async function createChannelByName(name) {
  const channel = await createChatChannel(projectId, name.trim())
  chatChannels.value.push(channel)
  selectedChatChannelId.value = channel.id
  await switchChatChannel()
}

async function createChannel() {
  openCreateChannelDialog()
}


async function sendChat() {
  const text = chatInput.value.trim()
  if (!text || !selectedChatChannelId.value) return

  if (!isJoinedChannel(selectedChatChannelId.value)) {
    chatJoining.value = true
    error.value = 'Joining selected channel...'
    return
  }

  error.value = ''

  try {
    await createChatMessage(projectId, selectedChatChannelId.value, text)
  } catch (e) {
    error.value = e.message || 'Failed to save chat message'
    return
  }

  workerSocket.send('chat', 'message', { channel_id: selectedChatChannelId.value, text })
  chatInput.value = ''
}

function scrollChat() {
  if (chatEl.value) chatEl.value.scrollTop = chatEl.value.scrollHeight
}

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
  height: 100%;
  max-height: 100%;
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
  max-height: 100%;
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
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
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
  min-width: 0;
  min-height: 0;
  max-height: 100%;
  gap: 0.45rem;
  padding: 0.4rem;
}

.workspace-splitter {
  flex: 1;
  min-height: 0;
  border: 1px solid var(--line);
  background: rgba(8, 16, 28, 0.45);
}

.splitter-panel {
  min-width: 0;
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
  align-self: center;
  border: 1px solid rgba(115, 148, 191, 0.45);
  border-radius: 0.9rem;
  background: rgba(10, 18, 30, 0.86);
  backdrop-filter: blur(8px);
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
