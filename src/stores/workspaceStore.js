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
  const terminalList       = ref([])   // [{ id, uuid, name, status }]
  const selectedTerminalId = ref(null)
  // True once at least one term/list has arrived, so consumers can distinguish
  // "terminals not loaded yet" from "this terminal is genuinely gone (defunct)".
  const terminalsLoaded    = ref(false)

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
  // Channel-wide call presence, independent of whether we're in the call:
  // { [channelId]: [{ peer_id, user_id, name }] }. Lets us show a "Join call"
  // affordance to members who aren't participating yet.
  const activeCalls      = ref({})

  // ── Agents (LLM tool-call sessions) ────────────────────────────────────────
  // Catalog + recent list are shared; live state is keyed by conversation id
  // so multiple panes/conversations can coexist without cross-talk (#85).
  const agentList            = ref([])     // [{ slug, name, role, model, tools, description }]
  const agentListLoaded      = ref(false)  // true once an agent/list reply has arrived
  const agentMessagesByConversation = ref({})  // { [conversation_id]: Message[] }
  const agentStatusByConversation   = ref({})  // { [conversation_id]: 'idle'|'thinking'|'error' }
  const agentMetaByConversation     = ref({})  // { [conversation_id]: { visibility, ownerUserId, ownerIsSelf, agentSlug } }
  const agentRecent          = ref([])

  function ensureAgentConversation(id) {
    if (id == null || id === '') return null
    const cid = String(id)
    if (!agentMessagesByConversation.value[cid]) agentMessagesByConversation.value[cid] = []
    if (!agentStatusByConversation.value[cid]) agentStatusByConversation.value[cid] = 'idle'
    if (!agentMetaByConversation.value[cid]) {
      agentMetaByConversation.value[cid] = { visibility: null, ownerUserId: null, ownerIsSelf: true, agentSlug: null }
    }
    return cid
  }

  function agentMessagesFor(id) {
    const cid = ensureAgentConversation(id)
    return cid ? agentMessagesByConversation.value[cid] : []
  }

  function agentStatusFor(id) {
    const cid = ensureAgentConversation(id)
    return cid ? agentStatusByConversation.value[cid] : 'idle'
  }

  function agentMetaFor(id) {
    const cid = ensureAgentConversation(id)
    return cid ? agentMetaByConversation.value[cid] : { visibility: null, ownerUserId: null, ownerIsSelf: true, agentSlug: null }
  }

  function releaseAgentConversation(id) {
    if (id == null) return
    const cid = String(id)
    delete agentMessagesByConversation.value[cid]
    delete agentStatusByConversation.value[cid]
    delete agentMetaByConversation.value[cid]
  }

  // ── Identity ───────────────────────────────────────────────────────────────
  // Name of the project currently open in the workspace. Set by ProjectPage on
  // load and cleared on unmount, so the shared top nav (App.vue) can show the
  // project label without a second header bar.
  const projectName          = ref('')

  return {
    wsConnected,
    currentUserId,
    terminalList,
    selectedTerminalId,
    terminalsLoaded,
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
    activeCalls,
    agentList,
    agentListLoaded,
    agentMessagesByConversation,
    agentStatusByConversation,
    agentMetaByConversation,
    ensureAgentConversation,
    agentMessagesFor,
    agentStatusFor,
    agentMetaFor,
    releaseAgentConversation,
    agentRecent,
    projectName,
  }
})
