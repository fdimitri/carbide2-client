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
  }
})
