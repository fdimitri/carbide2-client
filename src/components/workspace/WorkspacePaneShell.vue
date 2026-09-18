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

    <!-- File tabs: one FilePane per open file tab (see the agent block for the
         rationale). The file identity comes from the tab's own key. -->
    <template v-for="tab in fileTabs" :key="tab.key">
      <div
        class="flex flex-col flex-1 overflow-hidden"
        v-show="activeTabKind === 'file' && effectiveActiveKey === tab.key"
      >
        <FilePane
          :file-id="fileIdOf(tab)"
          :branch="tabBranch(tab)"
          :revision="tab.revision || null"
          @open-history="emit('open-history', fileIdOf(tab))"
          @open-preview="emit('open-preview', fileIdOf(tab))"
          @open-merge="(m) => emit('open-merge', fileIdOf(tab), m)"
        />
      </div>
    </template>

    <!-- Merge tabs: a three-way resolution of source into target for one file. -->
    <template v-for="tab in mergeTabs" :key="tab.key">
      <div
        class="flex flex-col flex-1 overflow-hidden"
        v-show="activeTabKind === 'merge' && effectiveActiveKey === tab.key"
      >
        <MergePane
          :path="mergeIdOf(tab).path"
          :source="mergeIdOf(tab).source"
          :target="mergeIdOf(tab).target"
          @done="() => { emit('open-file-at', mergeIdOf(tab).path, { branch: mergeIdOf(tab).target, revision: null }); emit('close-tab', paneIndex, tab.key) }"
        />
      </div>
    </template>

    <!-- Project merge tabs: a whole-tree merge of one project branch into another. -->
    <template v-for="tab in projectMergeTabs" :key="tab.key">
      <div
        class="flex flex-col flex-1 overflow-hidden"
        v-show="activeTabKind === 'project-merge' && effectiveActiveKey === tab.key"
      >
        <ProjectMergePane
          :source="projectMergeIdOf(tab).source"
          :target="projectMergeIdOf(tab).target"
          @open-merge="(path, m) => emit('open-merge', path, m)"
          @done="() => emit('close-tab', paneIndex, tab.key)"
        />
      </div>
    </template>

    <!-- History tabs: the file's revision DAG as a rail, one per open history tab. -->
    <template v-for="tab in historyTabs" :key="tab.key">
      <div
        class="flex flex-col flex-1 overflow-hidden"
        v-show="activeTabKind === 'history' && effectiveActiveKey === tab.key"
      >
        <HistoryPane :file-id="String(tab.id)" @open-file-at="(view) => emit('open-file-at', String(tab.id), view)" />
      </div>
    </template>

    <!-- Preview tabs: a markdown file rendered, following its editor tab's view. -->
    <template v-for="tab in previewTabs" :key="tab.key">
      <div
        class="flex flex-col flex-1 overflow-hidden"
        v-show="activeTabKind === 'preview' && effectiveActiveKey === tab.key"
      >
        <MarkdownPreviewPane
          :file-id="String(tab.id)"
          :branch="session.fileTabView(String(tab.id)).branch"
          :revision="session.fileTabView(String(tab.id)).revision"
          @open-file="emit('open-file-at', String(tab.id), {})"
        />
      </div>
    </template>

    <!-- Channel tabs: one ChatPane per open channel tab. Every channel-derived
         prop is read for THAT tab's channel id, never the pane's active one, so
         a background channel can no longer render another channel's messages. -->
    <template v-for="tab in channelTabs" :key="tab.key">
      <div
        class="flex flex-col flex-1 overflow-hidden"
        v-show="activeTabKind === 'channel' && effectiveActiveKey === tab.key"
      >
        <ChatPane
          :messages="messagesFor(channelIdOf(tab))"
          :current-user-id="store.currentUserId"
          :joining="joiningFor(channelIdOf(tab))"
          :connected="store.wsConnected"
          :can-send="canSendFor(channelIdOf(tab))"
          :users="usersFor(channelIdOf(tab))"
          :typing-map="typingMapFor(channelIdOf(tab))"
          :channel-id="channelIdOf(tab)"
          :channel-name="channelLabelFor(tab)"
          :call-active="callActiveFor(channelIdOf(tab))"
          :call-available="callAvailableFor(channelIdOf(tab))"
          :call-available-count="callAvailableCountFor(channelIdOf(tab))"
          :local-stream="store.callLocalStream"
          :remote-streams="store.callRemoteStreams"
          :participants="store.callParticipants"
          :mic-enabled="store.callMicEnabled"
          :cam-enabled="store.callCamEnabled"
          @send="(text) => emit('send-chat', channelIdOf(tab), text)"
          @start-call="emit('start-call', channelIdOf(tab))"
          @leave-call="emit('leave-call')"
          @toggle-mic="emit('toggle-mic')"
          @toggle-cam="emit('toggle-cam')"
        />
      </div>
    </template>

    <!-- Terminal tabs: one TerminalPane per open terminal tab, keyed by the
         stable uuid so it stays mounted for the tab's lifetime. Inactive tabs
         are hidden with v-show (not destroyed), so switching never remounts /
         rejoins / replays scrollback (#89). A tab whose terminal no longer
         resolves to a live entry is unmounted entirely — otherwise the stale
         xterm stays visible and splits the pane with the defunct overlay. -->
    <template v-for="tab in terminalTabs" :key="tab.id">
      <div
        v-if="terminalIdFor(tab.id) != null"
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

    <!-- Debug tabs: DebugPane reads the global debug-log store, so it has no
         per-tab identity, but render it per tab anyway for one uniform rule. -->
    <template v-for="tab in debugTabs" :key="tab.key">
      <div
        class="flex flex-col flex-1 overflow-hidden"
        v-show="activeTabKind === 'debug' && effectiveActiveKey === tab.key"
      >
        <DebugPane />
      </div>
    </template>

    <!-- Agent tabs: one AgentPane per open agent tab, keyed by the tab key so
         each tab owns its own component instance (draft, attachments, scroll,
         composer state). Inactive tabs stay mounted and are hidden with v-show,
         so switching never remounts. The transcript is NOT per-instance — it
         comes from the shared per-conversation store keyed by conversation id
         (ADR-011); only the instance is per tab. -->
    <template v-for="tab in agentTabs" :key="tab.key">
      <div
        class="flex flex-col flex-1 overflow-hidden"
        v-show="activeTabKind === 'agent' && effectiveActiveKey === tab.key"
      >
        <AgentPane
          :connected="store.wsConnected"
          :conversation-id="agentConversationId(tab)"
          :agent-slug="tab.agentSlug || null"
          :project-id="projectId"
          :composer-height-px="tab.composerHeightPx ?? null"
          @composer-resize="(h) => (tab.composerHeightPx = h)"
          @agent-send="(text, images) => emit('agent-send', paneIndex, agentConversationId(tab), text, images)"
          @agent-reset="emit('agent-reset', paneIndex, agentConversationId(tab))"
          @agent-pick="(slug) => emit('agent-pick', paneIndex, agentConversationId(tab), slug)"
          @agent-load="(id) => onAgentLoadTab(tab, id)"
          @agent-set-visibility="(vis) => emit('agent-set-visibility', agentConversationId(tab), vis)"
          @agent-stop="emit('agent-stop', agentConversationId(tab))"
          @agent-clean="(opts) => emit('agent-clean', agentConversationId(tab), opts)"
          @agent-fork="(turn) => emit('agent-fork', agentConversationId(tab), turn)"
        />
      </div>
    </template>

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
import HistoryPane from './HistoryPane.vue'
import ProjectSettingsPane from './ProjectSettingsPane.vue'
import DebugPane from './DebugPane.vue'
import AgentPane from './AgentPane.vue'
import AgentConfigPane from './AgentConfigPane.vue'
import { tabBranch, useSessionStore } from '../../stores/sessionStore'
import MarkdownPreviewPane from './MarkdownPreviewPane.vue'
import MergePane from './MergePane.vue'
import ProjectMergePane from './ProjectMergePane.vue'

const store = useWorkspaceStore()

const session = useSessionStore()

const props = defineProps({
  pane: { type: Object, required: true },
  paneIndex: { type: Number, required: true },
  activePaneIndex: { type: Number, required: true },
  paneCount: { type: Number, default: 1 },
  projectId: { type: [Number, String], required: true },
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

const activeSettingsProjectId = computed(() => {
  if (activeTabKind.value !== 'settings') return null
  return Number((effectiveActiveKey.value || '').split(':')[1]) || null
})

// ── File / channel / debug tabs (one instance per tab) ────────────────────
const fileTabs = computed(() =>
  (props.pane?.tabs || []).filter((t) => t.kind === 'file')
)
function fileIdOf(tab) {
  return (tab?.key || '').split(':').slice(1).join(':')
}

const channelTabs = computed(() =>
  (props.pane?.tabs || []).filter((t) => t.kind === 'channel')
)
function channelIdOf(tab) {
  const id = Number((tab?.key || '').split(':')[1])
  return Number.isFinite(id) && id > 0 ? id : null
}
function channelLabelFor(tab) {
  return tab?.label || String(channelIdOf(tab) ?? '')
}

const debugTabs = computed(() =>
  (props.pane?.tabs || []).filter((t) => t.kind === 'debug')
)
const historyTabs = computed(() =>
  (props.pane?.tabs || []).filter((t) => t.kind === 'history')
)
const mergeTabs = computed(() =>
  (props.pane?.tabs || []).filter((t) => t.kind === 'merge')
)
const projectMergeTabs = computed(() =>
  (props.pane?.tabs || []).filter((t) => t.kind === 'project-merge')
)
// A project-merge tab's id is "source|target" (see ProjectPage.openProjectMergePane).
function projectMergeIdOf(tab) {
  const id = String(tab.id)
  const a = id.indexOf('|')
  return { source: id.slice(0, a), target: id.slice(a + 1) }
}
// A merge tab's id is "source|target|path" (see ProjectPage.openMergePane).
function mergeIdOf(tab) {
  const id = String(tab.id)
  const a = id.indexOf('|')
  const b = id.indexOf('|', a + 1)
  return { source: id.slice(0, a), target: id.slice(a + 1, b), path: id.slice(b + 1) }
}
const previewTabs = computed(() =>
  (props.pane?.tabs || []).filter((t) => t.kind === 'preview')
)

// Per-channel chat state, read for a specific channel id so each tab renders
// its own channel. These are functions rather than computeds because the
// template calls them with each tab's id.

// Every agent tab in this pane gets its own AgentPane (see the template).
const agentTabs = computed(() =>
  (props.pane?.tabs || []).filter((t) => t.kind === 'agent')
)

// A tab's conversation id, parsed from its OWN key (`agent:<uuid>`); null for a
// fresh `agent:` tab, which has no conversation until its first send. Read
// per-tab, never from the pane's active tab — that is the whole point of the
// per-tab instance.
function agentConversationId(tab) {
  const id = (tab?.key || '').split(':').slice(1).join(':')
  return id || null
}

// Picking a conversation from a tab's dropdown rewrites THAT tab's key to
// agent:<id> before asking ProjectPage to load it. The previous conversation's
// reference is released (via the emit) so switching doesn't leak a worker
// subscription + buffered transcript. The tab is passed in explicitly — with
// one instance per tab there is no longer an "active" tab to look up.
function onAgentLoadTab(tab, id) {
  if (!tab || !id) return
  const oldId = agentConversationId(tab)
  tab.key = `agent:${id}`
  tab.id  = id
  props.pane.activeTab = tab.key
  emit('agent-load', id, oldId)
}

function messagesFor(cid) {
  return cid ? (store.chatMessagesMap[cid] ?? []) : []
}

function joiningFor(cid) {
  return cid ? !!(store.chatJoiningMap[cid]) : false
}

function canSendFor(cid) {
  if (!cid || !store.wsConnected) return false
  if (joiningFor(cid)) return false
  return store.joinedChatChannels?.has?.(cid) ?? false
}

function usersFor(cid) {
  return cid ? (store.chatUsersMap[cid] ?? []) : []
}

function typingMapFor(cid) {
  return cid ? (store.chatTypingMap[cid] ?? {}) : {}
}

function callActiveFor(cid) {
  return !!cid && Number(store.callChannelId) === cid
}

// A call is live in this channel but we haven't joined it yet — offer "Join".
function callAvailableFor(cid) {
  if (!cid || callActiveFor(cid)) return false
  return (store.activeCalls[cid]?.length || 0) > 0
}

function callAvailableCountFor(cid) {
  return cid ? (store.activeCalls[cid]?.length || 0) : 0
}

const emit = defineEmits([
  'open-history',
  'open-preview',
  'open-merge',
  'open-file-at',
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
  'agent-clean',
  'agent-fork',
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


