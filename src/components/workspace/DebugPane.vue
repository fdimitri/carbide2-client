<template>
  <div class="flex flex-col flex-1 min-h-0 bg-bg-1/90 text-text">
    <PaneHeader title="Debug Channel" size="sm">
      <template #actions>
        <span class="text-muted">{{ events.length }} event{{ events.length === 1 ? '' : 's' }}</span>
        <PaneToolbarButton @click="debugLog.clear()">Clear</PaneToolbarButton>
      </template>
    </PaneHeader>
    <div ref="scrollEl" class="flex-1 min-h-0 overflow-y-auto font-mono text-ui-sm leading-[1.35] px-2 py-1">
      <div v-if="events.length === 0" class="text-muted p-3 italic">
        No events yet. Actions like uploads, imports, and terminal creation will appear here.
      </div>
      <div v-for="ev in events" :key="ev.id"
          class="flex items-baseline gap-2 px-1 py-0.5 border-b border-line/40">
        <span class="text-muted shrink-0">{{ fmtTime(ev.ts) }}</span>
        <span class="shrink-0 px-1.5 rounded text-ui-xs uppercase"
              :class="severityClass(ev.severity)">{{ ev.severity }}</span>
        <span class="shrink-0 text-accent-fg">{{ ev.source }}</span>
        <span class="shrink-0 text-text">{{ ev.action }}</span>
        <span class="text-text break-all whitespace-pre-wrap">{{ ev.detail }}</span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { nextTick, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useDebugLogStore } from '../../stores/debugLogStore'
import PaneHeader from '../ui/PaneHeader.vue'
import PaneToolbarButton from '../ui/PaneToolbarButton.vue'

const debugLog = useDebugLogStore()
const { events } = storeToRefs(debugLog)
const scrollEl = ref(null)

function fmtTime(ts) {
  const d = new Date(ts)
  return d.toLocaleTimeString(undefined, { hour12: false }) + '.' + String(d.getMilliseconds()).padStart(3, '0')
}

function severityClass(s) {
  switch (s) {
    case 'error': return 'bg-warn/15 text-warn'
    case 'warn':  return 'bg-amber/15 text-amber'
    case 'ok':    return 'bg-success/15 text-success'
    default:      return 'bg-sel text-text'
  }
}

watch(() => events.value.length, async () => {
  await nextTick()
  const el = scrollEl.value
  if (el) el.scrollTop = el.scrollHeight
})
</script>
