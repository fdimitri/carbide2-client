<template>
  <div
    class="flex flex-col h-full border border-[rgba(84,110,146,0.35)] bg-[rgba(13,20,32,0.7)] overflow-hidden"
    :class="paneIndex === activePaneIndex ? 'border-[rgba(46,196,182,0.65)]' : ''"
    @mousedown.capture="emit('set-active-pane', paneIndex)"
    @dragover.prevent
    @drop.prevent="onPaneDrop($event)"
  >
    <div class="flex items-center gap-1 p-[0.3rem] border-b border-[rgba(43,61,88,0.9)] overflow-x-auto" @dragover.prevent @drop.prevent="onTabBarDrop($event)">
      <button
        v-for="tab in pane.tabs"
        :key="tab.key"
        class="border border-[rgba(87,114,150,0.6)] bg-[rgba(22,34,51,0.7)] text-text rounded-[0.3rem] px-[0.45rem] py-[0.22rem] text-[0.74rem] cursor-pointer whitespace-nowrap inline-flex items-center gap-[0.35rem]"
        :class="pane.activeTab === tab.key ? 'border-accent text-accent-fg shadow-[inset_0_-2px_0_var(--color-accent)]' : ''"
        draggable="true"
        @dragstart="emit('tab-drag-start', paneIndex, tab.key, $event)"
        @click="emit('activate-tab', paneIndex, tab.key)"
      >
        <span>{{ tab.label }}</span>
        <span class="inline-grid place-items-center w-[0.95rem] h-[0.95rem] rounded-full text-[0.72rem] leading-none text-[#b7c7df] hover:bg-white/10 hover:text-white" @click.stop="emit('close-tab', paneIndex, tab.key)">x</span>
      </button>
      <span v-if="pane.tabs.length === 0" class="text-muted text-[0.74rem] pl-[0.2rem]">Empty pane</span>
    </div>

    <div class="flex flex-col flex-1 overflow-hidden" v-show="activeTabKind === 'file'">
      <FilePane :file-id="activeFileId" />
    </div>

    <div class="flex flex-col flex-1 overflow-hidden" v-show="activeTabKind === 'channel'">
      <ChatPane
        :messages="paneMessages"
        :current-user-id="store.currentUserId"
        :joining="paneJoining"
        :connected="store.wsConnected"
        :can-send="paneCanSend"
        :users="paneUsers"
        :typing-map="paneTypingMap"
        :channel-id="activeChatChannelId"
        @send="(text) => emit('send-chat', activeChatChannelId, text)"
      />
    </div>

    <div class="flex flex-col flex-1 overflow-hidden" v-show="activeTabKind === 'terminal'">
      <TerminalPane
        :key="`term-${paneIndex}-${activeTerminalId || 'none'}`"
        :terminal-id="activeTerminalId"
        :active="paneIndex === activePaneIndex"
      />
    </div>

    <div class="flex flex-col flex-1 overflow-hidden" v-show="activeTabKind === 'settings'">
      <ProjectSettingsPane
        v-if="activeSettingsProjectId"
        :key="`settings-${activeSettingsProjectId}`"
        :project-id="activeSettingsProjectId"
      />
    </div>

    <div v-if="pane.tabs.length === 0" class="flex flex-col flex-1 items-center justify-center text-muted">
      <div>No content. Select or create an item from the explorer.</div>
    </div>
  </div>
</template>

<script setup>
import { computed, watch } from 'vue'
import { useWorkspaceStore } from '../../stores/workspaceStore'
import TerminalPane from './TerminalPane.vue'
import ChatPane from './ChatPane.vue'
import FilePane from './FilePane.vue'
import ProjectSettingsPane from './ProjectSettingsPane.vue'

const store = useWorkspaceStore()

const props = defineProps({
  pane: { type: Object, required: true },
  paneIndex: { type: Number, required: true },
  activePaneIndex: { type: Number, required: true },
})

const effectiveActiveKey = computed(() => {
  const key = props.pane?.activeTab
  if (typeof key === 'string' && key.length > 0) return key
  const first = props.pane?.tabs?.[0]?.key
  return typeof first === 'string' ? first : null
})

const activeTabKind = computed(() => {
  const key = effectiveActiveKey.value
  if (!key) return null
  return key.split(':')[0] || null
})

const activeTerminalId = computed(() => {
  if (activeTabKind.value !== 'terminal') return null
  return Number((effectiveActiveKey.value || '').split(':')[1]) || null
})

const activeFileId = computed(() => {
  if (activeTabKind.value !== 'file') return ''
  return (effectiveActiveKey.value || '').split(':').slice(1).join(':')
})

const activeSettingsProjectId = computed(() => {
  if (activeTabKind.value !== 'settings') return null
  return Number((effectiveActiveKey.value || '').split(':')[1]) || null
})

const activeChatChannelId = computed(() => {
  if (activeTabKind.value !== 'channel') return null
  return Number((effectiveActiveKey.value || '').split(':')[1]) || null
})

const paneMessages = computed(() => {
  const cid = activeChatChannelId.value
  return cid ? (store.chatMessagesMap[cid] ?? []) : []
})

const paneJoining = computed(() => {
  const cid = activeChatChannelId.value
  return cid ? !!(store.chatJoiningMap[cid]) : false
})

const paneCanSend = computed(() => {
  const cid = activeChatChannelId.value
  if (!cid || !store.wsConnected) return false
  if (paneJoining.value) return false
  return store.joinedChatChannels?.has?.(cid) ?? false
})

const paneUsers = computed(() => {
  const cid = activeChatChannelId.value
  return cid ? (store.chatUsersMap[cid] ?? []) : []
})

const paneTypingMap = computed(() => {
  const cid = activeChatChannelId.value
  return cid ? (store.chatTypingMap[cid] ?? {}) : {}
})

const activeChatLabel = computed(() => {
  if (activeTabKind.value !== 'channel') return ''
  const fromTab = props.pane?.tabs?.find((t) => t.key === effectiveActiveKey.value)?.label
  return fromTab || String((effectiveActiveKey.value || '').split(':')[1] || '')
})

const emit = defineEmits([
  'activate-tab',
  'close-tab',
  'rename-terminal',
  'send-chat',
  'pane-drop',
  'tab-drag-start',
  'tab-drop',
  'set-active-pane',
])

function onTabBarDrop(event) {
  // Tab bar accepts both tab moves and node drops
  if (event.dataTransfer.types.includes('application/x-carbide-tab')) {
    emit('tab-drop', props.paneIndex, event)
  } else {
    emit('pane-drop', props.paneIndex, event)
  }
}

function onPaneDrop(event) {
  // Pane body accepts both tab moves and node drops
  if (event.dataTransfer.types.includes('application/x-carbide-tab')) {
    emit('tab-drop', props.paneIndex, event)
  } else {
    emit('pane-drop', props.paneIndex, event)
  }
}
</script>


