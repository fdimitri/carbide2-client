// workspaceStore — shared workspace state consumed by ProjectPage and WorkspacePaneShell.
// Replaces the prop-drilling chain from ProjectPage → WorkspacePaneShell.
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import authService from '../services/authService'

export const useWorkspaceStore = defineStore('workspace', () => {
  // ── Connection ──────────────────────────────────────────────────────────────
  const wsConnected       = ref(false)
  const currentUserId     = computed(() => authService.userId())

  // ── Pane focus ──────────────────────────────────────────────────────────────
  const activePaneIndex   = ref(0)

  // ── Chat ────────────────────────────────────────────────────────────────────
  const chatMessagesMap    = ref({})   // { [channelId]: Message[] }
  const chatJoiningMap     = ref({})   // { [channelId]: boolean }
  const joinedChatChannels = ref(new Set())

  return {
    wsConnected,
    currentUserId,
    activePaneIndex,
    chatMessagesMap,
    chatJoiningMap,
    joinedChatChannels,
  }
})
