<!--
  ConnectionStatus — compact worker-socket health readout for the top nav.

  Surfaces the live WebSocket state from the workerSocket singleton: a colour
  coded status dot + label, round-trip latency, and the ~30s average in/out
  throughput. Hidden entirely when idle (no active workspace socket), so it
  only appears where it's meaningful.
-->
<template>
  <div v-if="status !== 'idle'" class="flex items-center gap-2 font-mono text-ui-xs">
    <span class="flex items-center gap-1.5" :title="title">
      <span class="inline-block w-2 h-2 rounded-full" :class="dotClass"></span>
      <span :class="labelClass">{{ label }}</span>
    </span>
    <template v-if="status === 'connected'">
      <span class="text-muted">{{ latencyText }}</span>
      <!-- Throughput sparkline: shared auto-scale, green = down (in), red = up (out) -->
      <svg
        class="shrink-0"
        :width="SPARK_W" :height="SPARK_H"
        viewBox="0 0 64 18" preserveAspectRatio="none"
        :title="`↓${rateInText} ↑${rateOutText} · peak ${peakText}`"
      >
        <rect x="0" y="0" width="64" height="18" fill="rgba(255,255,255,0.04)" rx="2" />
        <polyline
          v-if="inPoints" :points="inPoints"
          fill="none" stroke="#a6e3a1" stroke-width="1" stroke-linejoin="round" vector-effect="non-scaling-stroke"
        />
        <polyline
          v-if="outPoints" :points="outPoints"
          fill="none" stroke="#f38ba8" stroke-width="1" stroke-linejoin="round" vector-effect="non-scaling-stroke"
        />
      </svg>
      <span class="text-muted opacity-70">↓{{ rateInText }} ↑{{ rateOutText }}</span>
    </template>
    <UiButton
      v-else-if="status === 'offline' || status === 'reconnecting'"
      size="xs"
      class="px-1.5 py-0.5 border-accent/40 text-accent-bright hover:bg-accent/10"
      @click="retry"
    >Retry now</UiButton>
  </div>
</template>

<script setup>
import { computed, ref, onMounted, onBeforeUnmount } from 'vue'
import workerSocket from '../services/workerSocket'
import UiButton from './ui/UiButton.vue'

const status    = workerSocket.status
const latencyMs = workerSocket.latencyMs
const rateIn    = workerSocket.rateIn
const rateOut   = workerSocket.rateOut
const attempt   = workerSocket.attempt

// ── Throughput sparkline ──────────────────────────────────────────────────────
// Keep a short ring buffer of recent in/out samples and draw two polylines on a
// shared auto-scaled axis. Display size (CSS px) vs the fixed 64×18 viewbox.
const SPARK_W = 64
const SPARK_H = 18
const SAMPLES = 64           // one column per viewbox unit
const SAMPLE_MS = 1000
const inHist  = ref([])
const outHist = ref([])
let sampleTimer = null

onMounted(() => {
  sampleTimer = setInterval(() => {
    const push = (arr, v) => {
      arr.push(v || 0)
      if (arr.length > SAMPLES) arr.shift()
    }
    push(inHist.value,  rateIn.value)
    push(outHist.value, rateOut.value)
    // trigger reactivity (arrays mutated in place)
    inHist.value  = inHist.value.slice()
    outHist.value = outHist.value.slice()
  }, SAMPLE_MS)
})
onBeforeUnmount(() => clearInterval(sampleTimer))

// Shared peak across both series so up/down stay comparable. Min floor avoids a
// flat line jumping to full-scale on the first byte.
const peak = computed(() => {
  const m = Math.max(1024, ...inHist.value, ...outHist.value)
  return m
})

function toPoints(arr) {
  if (arr.length < 2) return ''
  const max = peak.value
  const stepX = 64 / (SAMPLES - 1)
  // newest sample on the right; pad older history to the left
  const offset = SAMPLES - arr.length
  return arr
    .map((v, i) => {
      const x = (offset + i) * stepX
      const y = 18 - (Math.min(v, max) / max) * 17 - 0.5
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
}

const inPoints  = computed(() => toPoints(inHist.value))
const outPoints = computed(() => toPoints(outHist.value))

const label = computed(() => ({
  connecting:   'Connecting…',
  connected:    'Connected',
  reconnecting: `Reconnecting… (${attempt.value})`,
  offline:      'Offline',
  unauthorized: 'Auth expired',
}[status.value] || status.value))

const dotClass = computed(() => ({
  connecting:   'bg-amber animate-pulse',
  connected:    'bg-success',
  reconnecting: 'bg-amber animate-pulse',
  offline:      'bg-warn',
  unauthorized: 'bg-warn',
}[status.value] || 'bg-muted'))

const labelClass = computed(() =>
  (status.value === 'offline' || status.value === 'unauthorized')
    ? 'text-warn'
    : 'text-muted')

function fmtRate(bytesPerSec) {
  const b = bytesPerSec || 0
  if (b < 1024) return `${Math.round(b)} B/s`
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB/s`
  return `${(b / (1024 * 1024)).toFixed(1)} MB/s`
}

const latencyText = computed(() =>
  latencyMs.value == null ? '—' : `${latencyMs.value} ms`)
const rateInText  = computed(() => fmtRate(rateIn.value))
const rateOutText = computed(() => fmtRate(rateOut.value))
const peakText    = computed(() => fmtRate(peak.value))

const title = computed(() =>
  `Worker connection: ${label.value}` +
  (latencyMs.value != null ? ` · ${latencyMs.value} ms RTT` : '') +
  ` · in ${rateInText.value} · out ${rateOutText.value}`)

function retry() {
  workerSocket.reconnectNow()
}
</script>
