// workspaceStore — shared workspace state consumed by ProjectPage and WorkspacePaneShell.
// Replaces the prop-drilling chain from ProjectPage → WorkspacePaneShell.
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import authService from '../services/authService'

export const useWorkspaceStore = defineStore('workspace', () => {
  // ── Connection ──────────────────────────────────────────────────────────────
  const wsConnected       = ref(false)
  const currentUserId     = computed(() => authService.userId())

  // ── Terminals ───────────────────────────────────────────────────────────────
  const terminalList       = ref([])   // [{ id, name, status }]
  const selectedTerminalId = ref(null)

  // ── Chat ────────────────────────────────────────────────────────────────────
  const chatChannels           = ref([])   // [{ id, name }]
  const selectedChatChannelId  = ref(null)
  const chatMessagesMap        = ref({})   // { [channelId]: Message[] }
  const chatJoiningMap         = ref({})   // { [channelId]: boolean }
  const joinedChatChannels     = ref(new Set())
  const chatUsersMap           = ref({})   // { [channelId]: [{user_id, name}] }
  const chatTypingMap          = ref({})   // { [channelId]: { [userId]: until_ms } }

  // ── Live call (WebRTC) ──────────────────────────────────────────────────────
  // A call is scoped to a chat channel, so video shares the same context as
  // text. Only one active call at a time (the channel you joined).
  const callChannelId    = ref(null)   // channel id of the call we're in, or null
  const callParticipants = ref([])     // remote peers: [{ peer_id, name }]
  const callLocalStream  = ref(null)   // our own MediaStream (camera + mic)
  const callRemoteStreams = ref({})    // { [peer_id]: MediaStream }
  const callMicEnabled   = ref(true)
  const callCamEnabled   = ref(true)

  // ── Agents (LLM tool-call sessions) ────────────────────────────────────────
  // Single conversation per project for now. AgentPane reads/writes these
  // directly; useAgents composable owns the WS handlers.
  const agentList            = ref([])     // [{ slug, name, role, model, tools, description }]
  const agentListLoaded      = ref(false)  // true once an agent/list reply has arrived
  const agentSelectedSlug    = ref(null)   // which agent the user is talking to
  const agentConversationId  = ref(null)   // assigned by worker via agent/started
  const agentMessages        = ref([])     // unified timeline:
  //   { kind: 'user',          text }
  //   { kind: 'assistant',     text }
  //   { kind: 'tool_call',     id, name, args }
  //   { kind: 'tool_result',   id, name, result }
  //   { kind: 'system',        text }
  //   { kind: 'error',         text }
  const agentStatus          = ref('idle') // 'idle' | 'thinking' | 'error'
  // Recent project-visible conversations (plus owner's privates).
  // Server-pushed via 'agent/recent' on pane open + after activity.
  const agentRecent          = ref([])
  // Visibility of the currently-loaded conversation: 'project' | 'private' | null
  const agentVisibility      = ref(null)
  const agentOwnerUserId     = ref(null)   // who started current convo
  const agentOwnerIsSelf     = ref(true)   // can we edit visibility / post?

  return {
    wsConnected,
    currentUserId,
    terminalList,
    selectedTerminalId,
    chatChannels,
    selectedChatChannelId,
    chatMessagesMap,
    chatJoiningMap,
    joinedChatChannels,
    chatUsersMap,
    chatTypingMap,
    callChannelId,
    callParticipants,
    callLocalStream,
    callRemoteStreams,
    callMicEnabled,
    callCamEnabled,
    agentList,
    agentListLoaded,
    agentSelectedSlug,
    agentConversationId,
    agentMessages,
    agentStatus,
    agentRecent,
    agentVisibility,
    agentOwnerUserId,
    agentOwnerIsSelf,
  }
})
