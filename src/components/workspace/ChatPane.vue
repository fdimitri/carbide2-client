<template>
  <div class="flex flex-col flex-1 min-h-0 monaco-bg monaco-fg">
    <div class="flex-1 overflow-y-auto p-3 flex flex-col gap-2 min-h-0" ref="chatEl">
      <div v-for="(msg, i) in messages" :key="i"
        class="flex flex-col gap-[0.1rem] max-w-[80ch]"
      >
        <span class="text-[0.8rem] font-semibold opacity-75"
          :class="msg.user_id === currentUserId ? 'text-[var(--vscode-focusBorder,#007acc)]' : ''"
        >{{ msg.name }}</span>
        <span class="text-[0.86rem] leading-[1.3] break-words">{{ msg.text }}</span>
        <span class="text-[0.72rem] monaco-line-fg">{{ formatTime(msg.timestamp) }}</span>
      </div>
      <div v-if="messages.length === 0" class="flex flex-1 items-center justify-center monaco-line-fg p-4">
        No messages yet.
      </div>
    </div>

    <div class="flex gap-2 p-[0.55rem] border-t monaco-panel-border monaco-tabs-bg">
      <input
        v-model="localInput"
        @keydown.enter.prevent="emitSend"
        :placeholder="joining ? 'Joining channel...' : 'Type a message...'"
        :disabled="!connected || joining"
        class="flex-1 px-[0.65rem] py-[0.45rem] text-[0.85rem] rounded-[0.3rem] outline-none font-[inherit] border monaco-input-bg monaco-input-fg monaco-input-border focus:monaco-focus-border placeholder:monaco-line-fg"
      />
      <button
        class="px-[0.9rem] py-[0.45rem] text-[0.85rem] text-white rounded-[0.3rem] cursor-pointer font-[inherit] border-0 monaco-focus-bg hover:brightness-115 disabled:opacity-40 disabled:cursor-default"
        @click="emitSend"
        :disabled="!canSend"
      >
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


