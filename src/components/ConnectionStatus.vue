<!--
  ConnectionStatus — compact worker-socket health readout for the top nav.

  Surfaces the live WebSocket state from the workerSocket singleton: a colour
  coded status dot + label, round-trip latency, and the ~30s average in/out
  throughput. Hidden entirely when idle (no active workspace socket), so it
  only appears where it's meaningful.
-->
<template>
  <div v-if="status !== 'idle'" class="flex items-center gap-2 font-mono text-[0.7rem]">
    <span class="flex items-center gap-1.5" :title="title">
      <span class="inline-block w-2 h-2 rounded-full" :class="dotClass"></span>
      <span :class="labelClass">{{ label }}</span>
    </span>
    <template v-if="status === 'connected'">
      <span class="text-muted">{{ latencyText }}</span>
      <span class="text-muted opacity-70">↓{{ rateInText }} ↑{{ rateOutText }}</span>
    </template>
    <button
      v-else-if="status === 'offline' || status === 'reconnecting'"
      class="px-1.5 py-0.5 rounded border border-[rgba(126,233,222,0.4)] text-[#7ce9de] hover:bg-[rgba(126,233,222,0.12)]"
      @click="retry"
    >Retry now</button>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import workerSocket from '../services/workerSocket'

const status    = workerSocket.status
const latencyMs = workerSocket.latencyMs
const rateIn    = workerSocket.rateIn
const rateOut   = workerSocket.rateOut
const attempt   = workerSocket.attempt

const label = computed(() => ({
  connecting:   'Connecting…',
  connected:    'Connected',
  reconnecting: `Reconnecting… (${attempt.value})`,
  offline:      'Offline',
  unauthorized: 'Auth expired',
}[status.value] || status.value))

const dotClass = computed(() => ({
  connecting:   'bg-[#f9e2af] animate-pulse',
  connected:    'bg-[#a6e3a1]',
  reconnecting: 'bg-[#f9e2af] animate-pulse',
  offline:      'bg-[#f38ba8]',
  unauthorized: 'bg-[#f38ba8]',
}[status.value] || 'bg-[#6c7086]'))

const labelClass = computed(() =>
  (status.value === 'offline' || status.value === 'unauthorized')
    ? 'text-[#f38ba8]'
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

const title = computed(() =>
  `Worker connection: ${label.value}` +
  (latencyMs.value != null ? ` · ${latencyMs.value} ms RTT` : '') +
  ` · in ${rateInText.value} · out ${rateOutText.value}`)

function retry() {
  workerSocket.reconnectNow()
}
</script>
