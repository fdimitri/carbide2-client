<template>
  <aside class="border-r border-line bg-gradient-to-b from-[rgba(23,34,51,0.95)] to-[rgba(16,25,39,0.95)] flex flex-col min-h-0 min-w-0">
    <div class="flex items-center justify-between px-3 py-[0.65rem] border-b border-line text-[0.84rem] font-bold uppercase tracking-[0.08em]">
      <span>Explorer</span>
    </div>
    <input v-model="explorerSearch" class="mx-[0.6rem] mt-[0.6rem] mb-[0.4rem] px-[0.55rem] py-[0.45rem] text-[0.82rem] bg-[#0f1724] border border-line text-text rounded-[0.35rem] focus:outline-none focus:border-[#67e8dc]" placeholder="Filter explorer..." />

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
            <i
              v-if="slotProps.node.data?.isOpen"
              class="pi pi-circle-fill ml-auto text-[#7ce9de] text-[0.52rem] opacity-90"
              title="Open in this browser context"
              aria-hidden="true"
            ></i>
          </div>
        </template>
      </Tree>
    </div>
    <ContextMenu ref="treeContextMenu" :model="contextMenuItems" class="tree-context-overlay" />
  </aside>
</template>

<script setup>
import { ref, computed } from 'vue'
import Tree from 'primevue/tree'
import ContextMenu from 'primevue/contextmenu'
import { logInfo } from '../../services/log'
import { PANE_COUNTS } from '../../composables/usePanes'

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
  'join-channel',
  'leave-channel',
])

// ── State ─────────────────────────────────────────────────────────────────────
const explorerSearch        = ref('')
const selectedFileId        = ref('README.md')
const openedFileIds         = ref(new Set(['README.md']))
const openedTerminalIds     = ref(new Set())
const treeContextMenu       = ref(null)
const contextMenuItems      = ref([])
const selectionKeys         = ref({ [selectedFileId.value]: true })
const expandedExplorerKeys  = ref({
  'group:files':     true,
  'group:terminals': true,
  'group:channels':  true,
  app:               true,
  'app/controllers': true,
  frontend:          true,
  'frontend/src':    true,
  worker:            true,
})

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
              { id: 'app/controllers/api/chat_messages_controller.rb', name: 'chat_messages_controller.rb', type: 'file' },
            ],
          },
        ],
      },
      {
        id: 'app/models',
        name: 'models',
        type: 'dir',
        children: [
          { id: 'app/models/project.rb',       name: 'project.rb',       type: 'file' },
          { id: 'app/models/chat_channel.rb',  name: 'chat_channel.rb',  type: 'file' },
          { id: 'app/models/chat_message.rb',  name: 'chat_message.rb',  type: 'file' },
        ],
      },
    ],
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
            children: [{ id: 'frontend/src/pages/ProjectPage.vue', name: 'ProjectPage.vue', type: 'file' }],
          },
          {
            id: 'frontend/src/services',
            name: 'services',
            type: 'dir',
            children: [
              { id: 'frontend/src/services/workerSocket.js',    name: 'workerSocket.js',    type: 'file' },
              { id: 'frontend/src/services/projectService.js',  name: 'projectService.js',  type: 'file' },
            ],
          },
        ],
      },
    ],
  },
  {
    id: 'worker',
    name: 'worker',
    type: 'dir',
    children: [
      { id: 'worker/worker.rb',            name: 'worker.rb',            type: 'file' },
      { id: 'worker/terminal_instance.rb', name: 'terminal_instance.rb', type: 'file' },
      { id: 'worker/chat_room.rb',         name: 'chat_room.rb',         type: 'file' },
      { id: 'worker/session.rb',           name: 'session.rb',           type: 'file' },
    ],
  },
  { id: 'README.md',   name: 'README.md',   type: 'file' },
  { id: 'UX_NOTES.md', name: 'UX_NOTES.md', type: 'file' },
])

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
    data: { kind: 'terminal', id: t.id, isOpen: openedTerminalIds.value.has(Number(t.id)) },
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
  ]
})

// ── Helpers ───────────────────────────────────────────────────────────────────
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
    return [
      ...buildOpenItems(node),
      { separator: true },
      { label: 'Rename', command: () => emit('rename-terminal', tid) },
    ]
  }
  if (kind === 'file') {
    return [
      ...buildOpenItems(node),
      { separator: true },
      { label: 'Rename', command: () => renameFileById(node.key) },
      { label: 'Copy',   command: () => {} },
      { label: 'Cut',    command: () => {} },
      { label: 'Delete', command: () => {} },
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

// ── Exposed for parent to mark items open (after terminal/channel create) ─────
defineExpose({ markTerminalOpen, markFileOpen })
</script>


