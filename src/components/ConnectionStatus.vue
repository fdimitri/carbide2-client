<!--
  ConnectionStatus — compact worker-socket health readout for the top nav.

  Surfaces the live WebSocket state from the workerSocket singleton: a colour
  coded status dot + label, round-trip latency, and the 30s average + 1s peak
  in/out throughput. Hidden entirely when idle (no active workspace socket),
  so it only appears where it's meaningful.
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
        :viewBox="sparkViewBox" preserveAspectRatio="none"
        :title="`↓${rateInText} ↑${rateOutText} · Peak ↓${peakInText} ↑${peakOutText}`"
      >
        <rect x="0" y="0" :width="viewW" height="18" fill="rgba(255,255,255,0.04)" rx="2" />
        <polyline
          v-if="inPoints" :points="inPoints"
          fill="none" stroke="#a6e3a1" stroke-width="1" stroke-linejoin="round" vector-effect="non-scaling-stroke"
        />
        <polyline
          v-if="outPoints" :points="outPoints"
          fill="none" stroke="#f38ba8" stroke-width="1" stroke-linejoin="round" vector-effect="non-scaling-stroke"
        />
      </svg>
      <span class="text-muted opacity-70">↓{{ rateInText }} ↑{{ rateOutText }}, Peak ↓{{ peakInText }} ↑{{ peakOutText }}</span>
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
import { computed } from 'vue'
import workerSocket from '../services/workerSocket'
import UiButton from './ui/UiButton.vue'

const status    = workerSocket.status
const latencyMs = workerSocket.latencyMs
const rateIn    = workerSocket.rateIn
const rateOut   = workerSocket.rateOut
const rateInPeak  = workerSocket.rateInPeak
const rateOutPeak = workerSocket.rateOutPeak
const attempt   = workerSocket.attempt

// ── Throughput sparkline ──────────────────────────────────────────────────────
// Draw the worker's 1-second buckets — the SAME series the Peak readout reports
// — not the 30s average. One point per bucket, newest on the right, shared
// auto-scale across both directions. No 1024 floor: idle sits at the bottom.
const SPARK_W = 64
const SPARK_H = 18

const bucketsIn  = workerSocket.rateInBuckets
const bucketsOut = workerSocket.rateOutBuckets

const viewW = computed(() => Math.max(1, bucketsIn.value.length - 1))
const sparkViewBox = computed(() => `0 0 ${viewW.value} 18`)

// Shared scale across both series so up/down stay comparable. Floor at 1 (not
// 1024) so a flat line hugs the bottom rather than a phantom 1 KB/s axis.
const peak = computed(() =>
  Math.max(1, ...bucketsIn.value, ...bucketsOut.value))

function toPoints(buckets) {
  if (!buckets || buckets.length < 2) return ''
  const max = peak.value
  return buckets
    .map((v, i) => {
      const x = i                       // integer columns — no fractional shimmer
      const y = 18 - (Math.min(v, max) / max) * 17 - 0.5
      return `${x},${y.toFixed(1)}`
    })
    .join(' ')
}

const inPoints  = computed(() => toPoints(bucketsIn.value))
const outPoints = computed(() => toPoints(bucketsOut.value))

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
const peakInText  = computed(() => fmtRate(rateInPeak.value))
const peakOutText = computed(() => fmtRate(rateOutPeak.value))

const title = computed(() =>
  `Worker connection: ${label.value}` +
  (latencyMs.value != null ? ` · ${latencyMs.value} ms RTT` : '') +
  ` · in ${rateInText.value} · out ${rateOutText.value}` +
  ` · peak in ${peakInText.value} · out ${peakOutText.value}`)

function retry() {
  workerSocket.reconnectNow()
}
</script>
