// useChat — chat channel state, join/leave, messaging
import { ref, computed } from 'vue'
import { storeToRefs } from 'pinia'
import workerSocket from '../services/workerSocket'
import { listChatChannels, createChatChannel, listChatMessages, createChatMessage } from '../services/projectService'
import { useWorkspaceStore } from '../stores/workspaceStore'

export function useChat(projectId, { wsConnected, error, bindTabToActivePane, activePane }) {
  const store = useWorkspaceStore()
  const { chatMessagesMap, chatJoiningMap, joinedChatChannels } = storeToRefs(store)

  const chatEl                 = ref(null)
  const chatChannels           = ref([])
  const selectedChatChannelId  = ref(null)
  const chatUsers              = ref([])
  let joinTimeoutHandle        = null

  const currentUserId     = computed(() => store.currentUserId)
  const activeChannelName = computed(() => {
    const ch = chatChannels.value.find(c => c.id === Number(selectedChatChannelId.value))
    return ch?.name || 'none'
  })

  function isJoinedChannel(channelId) {
    return joinedChatChannels.value.has(Number(channelId))
  }

  function setJoinedChannel(channelId, joined) {
    const next = new Set(joinedChatChannels.value)
    if (joined) next.add(Number(channelId))
    else        next.delete(Number(channelId))
    joinedChatChannels.value = next
  }

  function startJoinWait(channelId) {
    chatJoiningMap.value = { ...chatJoiningMap.value, [channelId]: true }
    if (joinTimeoutHandle) clearTimeout(joinTimeoutHandle)
    joinTimeoutHandle = setTimeout(() => {
      if (!isJoinedChannel(channelId)) {
        chatJoiningMap.value = { ...chatJoiningMap.value, [channelId]: false }
        error.value = 'Could not join channel yet. Check worker connection and try again.'
      }
      joinTimeoutHandle = null
    }, 4500)
  }

  function clearJoinWait(channelId) {
    chatJoiningMap.value = { ...chatJoiningMap.value, [channelId]: false }
    if (joinTimeoutHandle) {
      clearTimeout(joinTimeoutHandle)
      joinTimeoutHandle = null
    }
  }

  async function switchChatChannel() {
    if (!selectedChatChannelId.value) return
    const nextChannel = Number(selectedChatChannelId.value)
    activePane.value = 'chat'

    // Only join if not already joined
    if (!isJoinedChannel(nextChannel)) {
      startJoinWait(nextChannel)
      workerSocket.send('chat', 'join', { channel_id: nextChannel })
    }

    // Load history if not already loaded
    if (!chatMessagesMap.value[nextChannel]) {
      try {
        const msgs = await listChatMessages(projectId, nextChannel)
        chatMessagesMap.value = { ...chatMessagesMap.value, [nextChannel]: msgs }
      } catch (e) {
        chatMessagesMap.value = { ...chatMessagesMap.value, [nextChannel]: [] }
        error.value = e.message || 'Failed to load channel history'
      }
    }
  }

  async function selectChannelNode(channelId, options = {}) {
    selectedChatChannelId.value = channelId
    const current = chatChannels.value.find(c => Number(c.id) === Number(channelId))
    if (!options.skipPaneTab) {
      bindTabToActivePane('channel', channelId, current?.name || `channel #${channelId}`)
    }
    await switchChatChannel()
  }

  async function createChannelByName(name) {
    const channel = await createChatChannel(projectId, name.trim())
    chatChannels.value.push(channel)
    selectedChatChannelId.value = channel.id
    await switchChatChannel()
  }

  async function sendChat(channelId, text) {
    const cid = channelId ? Number(channelId) : Number(selectedChatChannelId.value)
    const trimmed = (text || '').trim()
    if (!trimmed || !cid) return

    if (!isJoinedChannel(cid)) {
      error.value = 'Not joined to this channel yet.'
      return
    }

    error.value = ''

    try {
      await createChatMessage(projectId, cid, trimmed)
    } catch (e) {
      error.value = e.message || 'Failed to save chat message'
      return
    }

    workerSocket.send('chat', 'message', { channel_id: cid, text: trimmed })
  }

  function scrollChat() {
    if (chatEl.value) chatEl.value.scrollTop = chatEl.value.scrollHeight
  }

  function joinChannelFromContext(channelId) {
    selectedChatChannelId.value = channelId
    return switchChatChannel()
  }

  function leaveChannelFromContext(channelId) {
    if (!isJoinedChannel(channelId)) return
    setJoinedChannel(channelId, false)
    workerSocket.send('chat', 'leave', { channel_id: channelId })
  }

  function registerHandlers(offHandlers) {
    offHandlers.push(
      workerSocket.on('chat', 'message', (p) => {
        const cid = Number(p.channel_id ?? p.chat_channel_id)
        const arr = chatMessagesMap.value[cid]
        if (arr) arr.push(p)
      }),
      workerSocket.on('chat', 'user_join', (p) => {
        const cid = Number(p.channel_id ?? p.chat_channel_id)
        if (cid === Number(selectedChatChannelId.value)) {
          if (!chatUsers.value.find(u => u.user_id === p.user_id))
            chatUsers.value.push({ user_id: p.user_id, name: p.name })
        }
        const arr = chatMessagesMap.value[cid]
        if (arr) arr.push({ system: true, text: `${p.name} joined`, timestamp: new Date().toISOString() })
      }),
      workerSocket.on('chat', 'user_leave', (p) => {
        const cid = Number(p.channel_id ?? p.chat_channel_id)
        if (cid === Number(selectedChatChannelId.value))
          chatUsers.value = chatUsers.value.filter(u => u.user_id !== p.user_id)
        const arr = chatMessagesMap.value[cid]
        if (arr) arr.push({ system: true, text: `${p.name} left`, timestamp: new Date().toISOString() })
      }),
      workerSocket.on('chat', 'user_list', (p) => {
        const cid = Number(p.channel_id ?? p.chat_channel_id)
        if (cid === Number(selectedChatChannelId.value))
          chatUsers.value = p.users || []
      }),
      workerSocket.on('chat', 'joined', (p) => {
        const cid = Number(p.channel_id)
        if (cid) {
          setJoinedChannel(cid, true)
          clearJoinWait(cid)
          error.value = ''
        }
      }),
      workerSocket.on('chat', 'left', (p) => {
        const cid = Number(p.channel_id)
        if (cid) {
          setJoinedChannel(cid, false)
          chatJoiningMap.value = { ...chatJoiningMap.value, [cid]: false }
        }
      })
    )
  }

  async function init() {
    chatChannels.value = await listChatChannels(projectId)
    if (chatChannels.value.length === 0) {
      const general = await createChatChannel(projectId, 'general')
      chatChannels.value = [general]
    }
    selectedChatChannelId.value = null
    store.chatMessagesMap = {}
  }

  function cleanup() {
    if (joinTimeoutHandle) {
      clearTimeout(joinTimeoutHandle)
      joinTimeoutHandle = null
    }
  }

  return {
    chatEl,
    chatChannels,
    selectedChatChannelId,
    chatUsers,
    activeChannelName,
    isJoinedChannel,
    setJoinedChannel,
    switchChatChannel,
    selectChannelNode,
    createChannelByName,
    sendChat,
    scrollChat,
    joinChannelFromContext,
    leaveChannelFromContext,
    registerHandlers,
    init,
    cleanup,
  }
}
