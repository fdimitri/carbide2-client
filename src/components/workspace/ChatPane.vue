<!-- ChatPane — messages + right-side user list with typing indicators. -->
<template>
  <div id="pane-chat" class="flex flex-1 min-h-0 monaco-bg monaco-fg overflow-hidden">

    <!-- ── Messages column ────────────────────────────────────────── -->
    <div class="flex flex-col flex-1 min-w-0 min-h-0">

      <!-- ── Call bar (video shares the channel's context) ───────────────── -->
      <div class="flex items-center gap-2 px-3 py-1.5 border-b monaco-panel-border monaco-tabs-bg">
        <template v-if="!callActive">
          <button
            class="ui-btn ui-btn-sm"
            :class="callAvailable ? 'ui-btn-primary' : 'ui-btn-mono'"
            :disabled="!canSend"
            :title="callAvailable ? 'Join the call in progress in this channel' : 'Start a video call in this channel'"
            @click="emit('start-call')"
          >{{ callAvailable ? `Join call (${callAvailableCount})` : '▶ Start call' }}</button>
          <span class="text-ui-xs monaco-line-fg">
            {{ callAvailable ? `Call in progress in #${channelName || 'channel'}` : `Video call in #${channelName || 'channel'}` }}
          </span>
        </template>
        <template v-else>
          <button
            class="ui-btn ui-btn-sm ui-btn-mono"
            @click="emit('toggle-mic')"
          >{{ micEnabled ? 'Mute' : 'Unmute' }}</button>
          <button
            class="ui-btn ui-btn-sm ui-btn-mono"
            @click="emit('toggle-cam')"
          >{{ camEnabled ? 'Camera off' : 'Camera on' }}</button>
          <button
            class="ui-btn ui-btn-sm ui-btn-warn"
            @click="emit('leave-call')"
          >Leave</button>
          <span class="text-ui-xs monaco-line-fg ml-auto">{{ participants.length + 1 }} in call</span>
        </template>
      </div>

      <!-- ── Video tiles ─────────────────────────────────────────────── -->
      <div v-if="callActive" class="flex gap-2 px-3 py-2 overflow-x-auto border-b monaco-panel-border bg-black/20">
        <CallTile :stream="localStream" label="You" :muted="true" />
        <CallTile
          v-for="p in participants"
          :key="p.peer_id"
          :stream="remoteStreams[p.peer_id] || null"
          :label="p.name"
        />
      </div>

      <div class="flex-1 overflow-y-auto p-3 flex flex-col gap-3 min-h-0" ref="chatEl">
        <div v-for="(msg, i) in messages" :key="i"
          :class="msg.system ? 'opacity-50 italic' : ''"
        >
          <template v-if="!msg.system">
            <div class="flex items-start gap-2 max-w-prose">
              <!-- Avatar -->
              <Avatar :id="msg.user_id" :name="msg.name" :src="msg.avatar_url" />
              <div class="flex flex-col min-w-0 gap-0.5">
                <div class="flex items-baseline gap-2">
                  <span class="text-ui-md font-semibold"
                    :class="msg.user_id === currentUserId ? 'text-[var(--vscode-focusBorder,#007acc)]' : ''"
                  >{{ msg.name }}</span>
                  <span class="text-ui-2xs monaco-line-fg opacity-70">{{ formatTime(msg.timestamp) }}</span>
                </div>
                <span class="text-ui-lg leading-[1.35] break-words">{{ msg.text }}</span>
              </div>
            </div>
          </template>
          <template v-else>
            <span class="text-ui-sm monaco-line-fg">{{ msg.text }}</span>
          </template>
        </div>
        <div v-if="messages.length === 0" class="flex flex-1 items-center justify-center monaco-line-fg p-4">
          No messages yet.
        </div>
      </div>

      <div class="flex gap-2 p-2 border-t monaco-panel-border monaco-tabs-bg">
        <input
          v-model="localInput"
          @keydown.enter.prevent="emitSend"
          @keydown="onKeydown"
          :placeholder="joining ? 'Joining channel...' : 'Type a message...'"
          :disabled="!connected || joining"
          class="flex-1 px-2.5 py-2 text-ui-lg rounded-ui-sm outline-none font-[inherit] border monaco-input-bg monaco-input-fg monaco-input-border focus:monaco-focus-border placeholder:monaco-line-fg"
        />
        <button
          class="ui-btn ui-btn-focus"
          @click="emitSend"
          :disabled="!canSend"
        >Send</button>
      </div>
    </div>

    <!-- ── User list ───────────────────────────────────────────────────────── -->
    <aside class="w-32 shrink-0 border-l monaco-panel-border flex flex-col overflow-y-auto py-2">
      <p class="text-ui-2xs font-semibold text-muted uppercase tracking-widest px-2 mb-1 opacity-60">
        Members · {{ users.length }}
      </p>
      <ul class="flex flex-col gap-0.5">
        <li
          v-for="u in users"
          :key="u.user_id"
          class="flex items-center gap-1.5 px-2 py-1 text-ui-sm leading-snug"
          :class="u.user_id === currentUserId ? 'text-[var(--vscode-focusBorder,#007acc)]' : 'monaco-fg'"
        >
          <!-- Typing indicator dot -->
          <span
            class="shrink-0 w-2 h-2 rounded-full transition-all duration-200"
            :style="dotStyle(u.user_id)"
          ></span>
          <span class="truncate">{{ u.name }}</span>
        </li>
      </ul>
    </aside>
  </div>
</template>

<script setup>
import { ref, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import workerSocket from '../../services/workerSocket'
import CallTile from './CallTile.vue'
import Avatar from '../ui/Avatar.vue'

const props = defineProps({
  messages:      { type: Array,   default: () => [] },
  currentUserId: { type: [Number, String], default: null },
  joining:       { type: Boolean, default: false },
  connected:     { type: Boolean, default: false },
  canSend:       { type: Boolean, default: false },
  users:         { type: Array,   default: () => [] },
  typingMap:     { type: Object,  default: () => ({}) },  // { [userId]: until_ms }
  channelId:     { type: Number,  default: null },
  channelName:   { type: String,  default: '' },
  // ── Call (WebRTC) ──
  callActive:    { type: Boolean, default: false },
  callAvailable: { type: Boolean, default: false },
  callAvailableCount: { type: Number, default: 0 },
  localStream:   { type: Object,  default: null },
  remoteStreams: { type: Object,  default: () => ({}) },
  participants:  { type: Array,   default: () => [] },
  micEnabled:    { type: Boolean, default: true },
  camEnabled:    { type: Boolean, default: true },
})

const emit    = defineEmits(['send', 'start-call', 'leave-call', 'toggle-mic', 'toggle-cam'])
const chatEl  = ref(null)
const localInput = ref('')

// ── Auto-scroll ───────────────────────────────────────────────────────────────
watch(
  () => props.messages.length,
  async () => {
    await nextTick()
    if (chatEl.value) chatEl.value.scrollTop = chatEl.value.scrollHeight
  }
)

// ── Typing dot ────────────────────────────────────────────────────────────────
// tick increments every 80ms so computed styles re-evaluate without watchers
const tick = ref(0)
let tickInterval = null

onMounted(() => {
  tickInterval = setInterval(() => { tick.value++ }, 80)
})
onBeforeUnmount(() => {
  clearInterval(tickInterval)
})

function dotStyle(userId) {
  void tick.value   // subscribe to tick
  const until = props.typingMap[userId]
  const typing = until && Date.now() < until
  if (typing) {
    return {
      background: '#5ab0ff',
      boxShadow: '0 0 5px 2px rgba(90,176,255,0.7)',
      opacity: '1',
    }
  }
  return {
    background: 'rgba(255,255,255,0.25)',
    boxShadow: 'none',
    opacity: '0.4',
  }
}

// ── Send ──────────────────────────────────────────────────────────────────────
function emitSend() {
  const text = localInput.value.trim()
  if (!text || !props.canSend) return
  emit('send', text)
  localInput.value = ''
}

// ── Throttled typing event ────────────────────────────────────────────────────
let lastTypingSent = 0
const TYPING_THROTTLE_MS = 100

function onKeydown(e) {
  if (e.key === 'Enter' || !props.channelId || !props.canSend) return
  const now = Date.now()
  if (now - lastTypingSent < TYPING_THROTTLE_MS) return
  lastTypingSent = now
  workerSocket.send('chat', 'typing', { channel_id: props.channelId })
}

function formatTime(ts) {
  if (!ts) return ''
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}
</script>


