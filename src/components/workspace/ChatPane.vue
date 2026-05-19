<template>
  <div class="chat-pane">
    <div class="chat-pane__messages" ref="chatEl">
      <div v-for="(msg, i) in messages" :key="i" class="chat-msg" :class="{ 'chat-msg--own': msg.user_id === currentUserId }">
        <span class="chat-name">{{ msg.name }}</span>
        <span class="chat-text">{{ msg.text }}</span>
        <span class="chat-time">{{ formatTime(msg.timestamp) }}</span>
      </div>
      <div v-if="messages.length === 0" class="chat-pane__placeholder">No messages yet.</div>
    </div>

    <div class="chat-input-row">
      <input
        v-model="localInput"
        @keydown.enter.prevent="emitSend"
        :placeholder="joining ? 'Joining channel...' : 'Type a message...'"
        :disabled="!connected || joining"
        class="chat-input"
      />
      <button class="btn-primary" @click="emitSend" :disabled="!canSend">
        Send
      </button>
    </div>
  </div>
</template>

<script setup>
import { ref, watch, nextTick } from 'vue'

const props = defineProps({
  messages: { type: Array, default: () => [] },
  currentUserId: { type: [Number, String], default: null },
  joining: { type: Boolean, default: false },
  connected: { type: Boolean, default: false },
  canSend: { type: Boolean, default: false },
})

const emit = defineEmits(['send'])
const chatEl = ref(null)
const localInput = ref('')

watch(
  () => props.messages.length,
  async () => {
    await nextTick()
    if (chatEl.value) chatEl.value.scrollTop = chatEl.value.scrollHeight
  }
)

function emitSend() {
  const text = localInput.value.trim()
  if (!text || !props.canSend) return
  emit('send', text)
  localInput.value = ''
}

function formatTime(ts) {
  if (!ts) return ''
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}
</script>

<style scoped>
.chat-pane {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  background: linear-gradient(180deg, #0f1826, #0c1420);
}

.chat-pane__messages {
  flex: 1;
  overflow-y: auto;
  padding: 0.75rem;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  min-height: 0;
}

.chat-pane__placeholder {
  flex: 1;
  display: grid;
  place-items: center;
  color: #91a2bc;
  padding: 1rem;
}

.chat-msg {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
  max-width: 80ch;
}

.chat-msg--own .chat-name { color: #8df4e9; }

.chat-name {
  color: #b4c5df;
  font-size: 0.8rem;
  font-weight: 600;
}

.chat-text {
  color: #eff5ff;
  font-size: 0.86rem;
  line-height: 1.3;
  word-break: break-word;
}

.chat-time {
  color: #778ba8;
  font-size: 0.72rem;
}

.chat-input-row {
  display: flex;
  gap: 0.5rem;
  padding: 0.55rem;
  border-top: 1px solid #2b3d58;
  background: rgba(17, 26, 38, 0.85);
}
</style>
