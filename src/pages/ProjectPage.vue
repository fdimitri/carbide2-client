<template>
  <div class="workspace">
    <header class="workspace-header">
      <span class="project-name">{{ project?.name || 'Loading...' }}</span>
      <button class="btn-secondary" @click="$router.push('/dashboard')">← Dashboard</button>
    </header>

    <Menubar :model="menuItems" class="workspace-menubar" />

    <div class="workspace-body">
      <ExplorerPane
        :terminal-list="terminalList"
        :chat-channels="chatChannels"
        :pane-layout="paneLayout"
        :active-pane-index="activePaneIndex"
        :is-joined-channel="isJoinedChannel"
        @open-file="onExplorerOpenFile"
        @open-terminal="onExplorerOpenTerminal"
        @open-channel="onExplorerOpenChannel"
        @open-in-pane="onExplorerOpenInPane"
        @create-terminal="openCreateTerminalDialog"
        @create-channel="openCreateChannelDialog"
        @rename-terminal="renameTerminalById"
        @join-channel="joinChannelFromContext"
        @leave-channel="leaveChannelFromContext"
      />

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
import Menubar from 'primevue/menubar'
import Splitter from 'primevue/splitter'
import SplitterPanel from 'primevue/splitterpanel'
import Dialog from 'primevue/dialog'
import InputText from 'primevue/inputtext'
import WorkspacePaneShell from '../components/workspace/WorkspacePaneShell.vue'
import ExplorerPane from '../components/workspace/ExplorerPane.vue'
import workerSocket from '../services/workerSocket'
import { listProjects, getWsToken } from '../services/projectService'
import { storeToRefs } from 'pinia'
import { usePanes, PANE_COUNTS } from '../composables/usePanes'
import { useTerminals } from '../composables/useTerminals'
import { useChat } from '../composables/useChat'
import { useWorkspaceStore } from '../stores/workspaceStore'

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

const workspaceStore = useWorkspaceStore()
const { wsConnected, joinedChatChannels: storeJoinedChatChannels } = storeToRefs(workspaceStore)

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

// ── Channel dialog ────────────────────────────────────────────────────────────
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

.btn-primary,
.btn-secondary {
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
