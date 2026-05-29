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

  // ── Agents (LLM tool-call sessions) ────────────────────────────────────────
  // Single conversation per project for now. AgentPane reads/writes these
  // directly; useAgents composable owns the WS handlers.
  const agentList            = ref([])     // [{ slug, name, role, model, tools, description }]
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
    agentList,
    agentSelectedSlug,
    agentConversationId,
    agentMessages,
    agentStatus,
  }
})
