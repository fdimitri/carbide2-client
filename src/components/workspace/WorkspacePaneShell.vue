<template>
  <div
    :id="'pane-' + paneIndex"
    class="flex flex-col h-full bg-bg-1/70 overflow-hidden"
    :class="paneCount > 1
      ? (paneIndex === activePaneIndex
          ? 'border border-accent/60'
          : 'border border-line')
      : 'border-0'"
    @mousedown.capture="emit('set-active-pane', paneIndex)"
    @dragover.prevent
    @drop.prevent="onPaneDrop($event)"
  >
    <div :id="'pane-tabs-' + paneIndex" class="pane-tab-bar" @dragover.prevent @drop.prevent="onTabBarDrop($event)">
      <button
        v-for="tab in pane.tabs"
        :key="tab.key"
        class="pane-tab"
        :class="{ 'is-active': pane.activeTab === tab.key }"
        draggable="true"
        @dragstart="emit('tab-drag-start', paneIndex, tab.key, $event)"
        @click="emit('activate-tab', paneIndex, tab.key)"
      >
        <span class="pane-tab-body"></span>
        <span>{{ tab.label }}</span>
        <span class="pane-tab-close" @click.stop="emit('close-tab', paneIndex, tab.key)">
          <svg viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"><path d="M1.5 1.5l7 7M8.5 1.5l-7 7" /></svg>
        </span>
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
        :channel-name="activeChatLabel"
        :call-active="paneCallActive"
        :call-available="paneCallAvailable"
        :call-available-count="paneCallAvailableCount"
        :local-stream="store.callLocalStream"
        :remote-streams="store.callRemoteStreams"
        :participants="store.callParticipants"
        :mic-enabled="store.callMicEnabled"
        :cam-enabled="store.callCamEnabled"
        @send="(text) => emit('send-chat', activeChatChannelId, text)"
        @start-call="emit('start-call', activeChatChannelId)"
        @leave-call="emit('leave-call')"
        @toggle-mic="emit('toggle-mic')"
        @toggle-cam="emit('toggle-cam')"
      />
    </div>

    <div class="flex flex-col flex-1 overflow-hidden" v-show="activeTabKind === 'terminal'">
      <TerminalPane
        :key="`term-${paneIndex}-${activeTerminalId || 'none'}`"
        :terminal-id="activeTerminalId"
        :active="paneIndex === activePaneIndex"
        :agent-busy="activeTerminalAgentState.busy"
        :agent-busy-until-ms="activeTerminalAgentState.untilMs"
      />
    </div>

    <div class="flex flex-col flex-1 overflow-hidden" v-show="activeTabKind === 'settings'">
      <ProjectSettingsPane
        v-if="activeSettingsProjectId"
        :key="`settings-${activeSettingsProjectId}`"
        :project-id="activeSettingsProjectId"
      />
    </div>

    <div class="flex flex-col flex-1 overflow-hidden" v-show="activeTabKind === 'debug'">
      <DebugPane />
    </div>

    <div class="flex flex-col flex-1 overflow-hidden" v-show="activeTabKind === 'agent'">
      <AgentPane
        :connected="store.wsConnected"
        @agent-send="(text, images) => emit('agent-send', text, images)"
        @agent-reset="emit('agent-reset')"
        @agent-pick="(slug) => emit('agent-pick', slug)"
        @agent-load="(id) => emit('agent-load', id)"
        @agent-set-visibility="(vis) => emit('agent-set-visibility', vis)"
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
import DebugPane from './DebugPane.vue'
import AgentPane from './AgentPane.vue'

const store = useWorkspaceStore()

const props = defineProps({
  pane: { type: Object, required: true },
  paneIndex: { type: Number, required: true },
  activePaneIndex: { type: Number, required: true },
  paneCount: { type: Number, default: 1 },
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

// Pull the agent-lock state for whichever terminal this pane currently
// shows so TerminalPane can render the busy overlay. Store-driven so it
// reactively updates when the worker rebroadcasts term/list.
const activeTerminalAgentState = computed(() => {
  const tid = activeTerminalId.value
  if (!tid) return { busy: false, untilMs: null }
  const t = (store.terminalList || []).find((x) => Number(x.id) === Number(tid))
  return {
    busy:    !!t?.agent_busy,
    untilMs: Number(t?.agent_busy_until_ms) || null,
  }
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

const paneCallActive = computed(() => {
  const cid = activeChatChannelId.value
  return !!cid && Number(store.callChannelId) === cid
})

// A call is live in this channel but we haven't joined it yet — offer "Join".
const paneCallAvailable = computed(() => {
  const cid = activeChatChannelId.value
  if (!cid || paneCallActive.value) return false
  return (store.activeCalls[cid]?.length || 0) > 0
})

const paneCallAvailableCount = computed(() => {
  const cid = activeChatChannelId.value
  return cid ? (store.activeCalls[cid]?.length || 0) : 0
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
  'start-call',
  'leave-call',
  'toggle-mic',
  'toggle-cam',
  'pane-drop',
  'tab-drag-start',
  'tab-drop',
  'set-active-pane',
  'agent-send',
  'agent-reset',
  'agent-pick',
  'agent-load',
  'agent-set-visibility',
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


