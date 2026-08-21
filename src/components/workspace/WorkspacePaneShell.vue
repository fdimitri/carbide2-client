<template>
  <div
    :id="'pane-' + paneIndex"
    class="flex flex-col h-full bg-bg-1/70 overflow-hidden"
    :class="paneCount > 1
      ? (paneIndex === activePaneIndex
          ? 'workspace-pane is-active'
          : 'workspace-pane')
      : ''"
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
      <span v-if="pane.tabs.length === 0" class="text-muted text-ui-xs pl-1">Empty pane</span>
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

    <!-- Terminal tabs: one TerminalPane per open terminal tab, keyed by the
         stable uuid so it stays mounted for the tab's lifetime. Inactive tabs
         are hidden with v-show (not destroyed), so switching never remounts /
         rejoins / replays scrollback (#89). -->
    <template v-for="tab in terminalTabs" :key="tab.id">
      <div
        class="flex flex-col flex-1 overflow-hidden"
        v-show="activeTabKind === 'terminal' && activeTerminalUuid === tab.id"
      >
        <TerminalPane
          :terminal-id="terminalIdFor(tab.id)"
          :active="paneIndex === activePaneIndex && activeTabKind === 'terminal' && activeTerminalUuid === tab.id"
          :agent-busy="agentStateFor(tab.id).busy"
          :agent-busy-until-ms="agentStateFor(tab.id).untilMs"
        />
      </div>
    </template>

    <!-- Defunct active terminal: the tab's uuid no longer resolves to a live
         terminal. Show this only when the active tab is a terminal and there
         is no corresponding tab renderer. -->
    <div
      v-if="terminalDefunct"
      class="flex flex-col flex-1 items-center justify-center text-center text-muted p-4 gap-2"
    >
      <i class="pi pi-times-circle text-2xl" />
      <div>This terminal has ended and is no longer available.</div>
      <div class="text-ui-xs">Close this tab and open a new terminal.</div>
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
        :conversation-id="activeAgentConversationId"
        :agent-slug="activeAgentSlug"
        @agent-send="(text, images) => emit('agent-send', paneIndex, activeAgentConversationId, text, images)"
        @agent-reset="emit('agent-reset', paneIndex, activeAgentConversationId)"
        @agent-pick="(slug) => emit('agent-pick', paneIndex, activeAgentConversationId, slug)"
        @agent-load="onAgentLoad"
        @agent-set-visibility="(vis) => emit('agent-set-visibility', activeAgentConversationId, vis)"
        @agent-stop="emit('agent-stop', activeAgentConversationId)"
      />
    </div>

    <div class="flex flex-col flex-1 overflow-hidden" v-show="activeTabKind === 'agent-config'">
      <AgentConfigPane v-if="activeTabKind === 'agent-config'" />
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
import AgentConfigPane from './AgentConfigPane.vue'

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

const activeTerminalUuid = computed(() => {
  if (activeTabKind.value !== 'terminal') return null
  // Everything after 'terminal:' is the stable uuid (uuids contain no colon,
  // but join defensively anyway).
  return (effectiveActiveKey.value || '').split(':').slice(1).join(':') || null
})

// All terminal tabs in this pane (each gets a persistent renderer, #89).
// For terminal tabs, `id` IS the stable uuid (see useTerminals.selectTerminalNode).
const terminalTabs = computed(() =>
  (props.pane?.tabs || []).filter((t) => t.kind === 'terminal' && t.id)
)

// Resolve a terminal tab's stable uuid to the live terminal entry's integer id.
function terminalIdFor(uuid) {
  const e = (store.terminalList || []).find((t) => t.uuid === uuid)
  return e ? Number(e.id) : null
}

function agentStateFor(uuid) {
  const e = (store.terminalList || []).find((t) => t.uuid === uuid)
  if (!e) return { busy: false, untilMs: null }
  return { busy: !!e.agent_busy, untilMs: Number(e.agent_busy_until_ms) || null }
}

// Defunct = the ACTIVE tab references a terminal uuid that isn't in the (already
// loaded) terminal list, i.e. its shell has exited. Gated on terminalsLoaded so
// a tab doesn't flash "defunct" before the first term/list arrives.
const terminalDefunct = computed(() => {
  if (activeTabKind.value !== 'terminal') return false
  const uuid = activeTerminalUuid.value
  if (!uuid || !store.terminalsLoaded) return false
  return !(store.terminalList || []).some((t) => t.uuid === uuid)
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

const activeAgentConversationId = computed(() => {
  if (activeTabKind.value !== 'agent') return null
  const id = (effectiveActiveKey.value || '').split(':').slice(1).join(':') || null
  return id || null
})

const activeAgentSlug = computed(() => {
  if (activeTabKind.value !== 'agent') return null
  const tab = props.pane?.tabs?.find((t) => t.key === effectiveActiveKey.value)
  return tab?.agentSlug || null
})

// Picking a conversation from the pane's dropdown rewrites this pane's agent tab
// key to agent:<id> (per-pane identity) before asking ProjectPage to load it.
function onAgentLoad(id) {
  if (!id) return
  const tab = props.pane?.tabs?.find((t) => t.kind === 'agent' && t.key === effectiveActiveKey.value)
  if (tab) {
    tab.key = `agent:${id}`
    tab.id  = id
    props.pane.activeTab = tab.key
  }
  emit('agent-load', id)
}

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
  'agent-stop',
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


