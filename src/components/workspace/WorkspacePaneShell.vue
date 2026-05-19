<template>
  <div
    class="pane-shell"
    :class="{ 'pane-shell--active': paneIndex === activePaneIndex }"
    @mousedown.capture="emit('set-active-pane', paneIndex)"
    @dragover.prevent
    @drop.prevent="onPaneDrop($event)"
  >
    <div class="pane-tabs" @dragover.prevent @drop.prevent="onTabBarDrop($event)">
      <button
        v-for="tab in pane.tabs"
        :key="tab.key"
        class="pane-tab"
        :class="{ active: pane.activeTab === tab.key }"
        draggable="true"
        @dragstart="emit('tab-drag-start', paneIndex, tab.key, $event)"
        @click="emit('activate-tab', paneIndex, tab.key)"
      >
        <span>{{ tab.label }}</span>
        <span class="pane-tab-close" @click.stop="emit('close-tab', paneIndex, tab.key)">x</span>
      </button>
      <span v-if="pane.tabs.length === 0" class="pane-tab-empty">Empty pane</span>
    </div>

    <div class="pane-content" v-show="activeTabKind === 'file'">
      <FilePane :file-id="activeFileId" />
    </div>

    <div class="pane-content" v-show="activeTabKind === 'channel'">
      <ChatPane
        :messages="paneMessages"
        :current-user-id="store.currentUserId"
        :joining="paneJoining"
        :connected="store.wsConnected"
        :can-send="paneCanSend"
        @send="(text) => emit('send-chat', activeChatChannelId, text)"
      />
    </div>

    <div class="pane-content" v-show="activeTabKind === 'terminal'">
      <TerminalPane
        :key="`term-${paneIndex}-${activeTerminalId || 'none'}`"
        :terminal-id="activeTerminalId"
        :active="paneIndex === activePaneIndex"
      />
    </div>

    <div v-if="pane.tabs.length === 0" class="pane-content" style="display: flex; align-items: center; justify-content: center; color: #91a2bc;">
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

<style scoped>
.pane-shell {
  display: flex;
  flex-direction: column;
  height: 100%;
  border: 1px solid rgba(84, 110, 146, 0.35);
  background: rgba(13, 20, 32, 0.7);
  overflow: hidden;
}

.pane-shell--active {
  border-color: rgba(46, 196, 182, 0.65);
}

.pane-tabs {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.3rem;
  border-bottom: 1px solid rgba(43, 61, 88, 0.9);
  overflow-x: auto;
}

.pane-tab {
  border: 1px solid rgba(87, 114, 150, 0.6);
  background: rgba(22, 34, 51, 0.7);
  color: #dce6f7;
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
  border-color: #2ec4b6;
  color: #d7fff6;
  box-shadow: inset 0 -2px 0 #2ec4b6;
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
  color: #91a2bc;
  font-size: 0.74rem;
  padding-left: 0.2rem;
}

.pane-content {
  display: flex;
  flex-direction: column;
  flex: 1;
  overflow: hidden;
}
</style>
