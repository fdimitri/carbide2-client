<template>
  <div class="flex flex-col flex-1 min-h-0 bg-[rgba(10,16,26,0.9)] text-text">
    <div class="flex items-center justify-between px-3 py-[0.45rem] border-b border-line text-[0.78rem]">
      <span class="font-semibold uppercase tracking-[0.08em] text-muted">Debug Channel</span>
      <div class="flex items-center gap-2">
        <span class="text-muted">{{ events.length }} event{{ events.length === 1 ? '' : 's' }}</span>
        <button class="px-2 py-[0.2rem] bg-transparent border border-[#587296] text-[#c5d4ea] rounded-[0.3rem] cursor-pointer hover:border-[#7ce9de] hover:text-[#dffffa]"
                @click="debugLog.clear()">Clear</button>
      </div>
    </div>
    <div ref="scrollEl" class="flex-1 min-h-0 overflow-y-auto font-mono text-[0.78rem] leading-[1.35] px-2 py-1">
      <div v-if="events.length === 0" class="text-muted p-3 italic">
        No events yet. Actions like uploads, imports, and terminal creation will appear here.
      </div>
      <div v-for="ev in events" :key="ev.id"
           class="flex items-baseline gap-2 px-1 py-[0.15rem] border-b border-[rgba(43,61,88,0.4)]">
        <span class="text-muted shrink-0">{{ fmtTime(ev.ts) }}</span>
        <span class="shrink-0 px-[0.35rem] rounded text-[0.7rem] uppercase"
              :class="severityClass(ev.severity)">{{ ev.severity }}</span>
        <span class="shrink-0 text-[#9efdf3]">{{ ev.source }}</span>
        <span class="shrink-0 text-[#c5d4ea]">{{ ev.action }}</span>
        <span class="text-[#dfe7f3] break-all whitespace-pre-wrap">{{ ev.detail }}</span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { nextTick, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useDebugLogStore } from '../../stores/debugLogStore'

const debugLog = useDebugLogStore()
const { events } = storeToRefs(debugLog)
const scrollEl = ref(null)

function fmtTime(ts) {
  const d = new Date(ts)
  return d.toLocaleTimeString(undefined, { hour12: false }) + '.' + String(d.getMilliseconds()).padStart(3, '0')
}

function severityClass(s) {
  switch (s) {
    case 'error': return 'bg-[#4d1b27] text-[#ffb9c8]'
    case 'warn':  return 'bg-[#4a3a1a] text-[#ffe2a1]'
    case 'ok':    return 'bg-[#1b4d2d] text-[#b9ffd0]'
    default:      return 'bg-[#1e3148] text-[#bcd6f5]'
  }
}

watch(() => events.value.length, async () => {
  await nextTick()
  const el = scrollEl.value
  if (el) el.scrollTop = el.scrollHeight
})
</script>
