<template>
  <div class="relative flex flex-col flex-1 min-h-0">
    <div ref="terminalContainer" class="flex-1 min-h-0 p-[0.35rem] bg-[#0b1017]" />
    <div v-if="!terminalId" class="absolute inset-0 grid place-items-center text-center text-muted p-4 pointer-events-none">
      Select or create a terminal from the tree.
    </div>
    <!-- Agent-busy overlay. Shown when the bound terminal is currently
         locked by the agent for a shell_exec call. Pointer events pass
         through to the xterm beneath so the user can still scroll and
         copy, but the visible banner makes it obvious why their
         keystrokes are being silently dropped. Auto-clears when the
         agent releases (or the worker auto-releases on timeout). -->
    <div
      v-if="terminalId && agentBusy"
      class="absolute top-[0.35rem] right-[0.6rem] flex items-center gap-[0.35rem] px-[0.55rem] py-[0.25rem] text-[0.74rem] font-semibold bg-[#4a1f2c] border border-[#ff7da0] text-[#ffd5e0] rounded-[0.35rem] pointer-events-none"
      :title="agentBusyUntilMs ? `Agent lock auto-releases in ${Math.max(0, Math.round((agentBusyUntilMs - nowMs) / 1000))}s` : 'Agent is running a command'"
    >
      <i class="pi pi-lock" aria-hidden="true"></i>
      <span>AGENT RUNNING — input locked</span>
      <span v-if="agentBusyUntilMs" class="opacity-80">
        ({{ Math.max(0, Math.round((agentBusyUntilMs - nowMs) / 1000)) }}s)
      </span>
    </div>
  </div>
</template>

<script setup>
import { ref, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import workerSocket from '../../services/workerSocket'

const props = defineProps({
  terminalId: {
    type: [Number, String],
    default: null,
  },
  active: {
    type: Boolean,
    default: false,
  },
  // Agent-lock state for this terminal. Sourced from the workspace's
  // terminalList so the overlay reacts to worker term/list broadcasts
  // without TerminalPane having to subscribe directly.
  agentBusy: {
    type: Boolean,
    default: false,
  },
  agentBusyUntilMs: {
    type: Number,
    default: null,
  },
})

const nowMs = ref(Date.now())
let nowTimer = null

const terminalContainer = ref(null)
let xterm = null
let fitAddon = null
let terminalResizeObserver = null
let boundTerminalId = null
let applyingRemoteResize = false
const deadTerminalIds = new Set()  // ids whose shell has exited; don't try to re-join

const onWindowResize = () => fitTerminalSoon()

function fitTerminalSoon() {
  requestAnimationFrame(() => {
    fitAddon?.fit()
    requestAnimationFrame(() => fitAddon?.fit())
  })
}

function ensureXterm() {
  if (!terminalContainer.value) return false
  const needsReattach = !xterm || !terminalContainer.value.querySelector('.xterm')
  if (!needsReattach) return true

  xterm?.dispose()
  xterm = new Terminal({ cursorBlink: true, fontSize: 14, theme: { background: '#1e1e1e' } })
  fitAddon = new FitAddon()
  xterm.loadAddon(fitAddon)
  xterm.open(terminalContainer.value)
  fitTerminalSoon()

  xterm.onData((data) => {
    if (!boundTerminalId) return
    workerSocket.send('term', 'input', { terminal_id: boundTerminalId, data })
  })

  xterm.onResize(({ cols, rows }) => {
    if (!boundTerminalId || applyingRemoteResize) return
    workerSocket.send('term', 'resize', { terminal_id: boundTerminalId, cols, rows })
  })

  window.addEventListener('resize', onWindowResize)
  terminalResizeObserver?.disconnect()
  terminalResizeObserver = new ResizeObserver(() => fitTerminalSoon())
  terminalResizeObserver.observe(terminalContainer.value)
  return true
}

async function bindTerminal(terminalId) {
  const nextId = Number(terminalId)
  if (!nextId) return
  const sameAsBound = nextId === Number(boundTerminalId)
  boundTerminalId = nextId
  await nextTick()
  if (!ensureXterm()) return
  // If this terminal has already exited, keep whatever's in the buffer
  // (so the user can scroll back through what happened) and don't bother
  // the worker with a join the server will only refuse.
  if (deadTerminalIds.has(nextId)) {
    if (props.active) {
      await nextTick()
      xterm.focus()
    }
    return
  }
  // Only reset on a fresh bind — re-activating the same tab shouldn't
  // wipe scrollback.
  if (!sameAsBound) xterm.reset()
  workerSocket.send('term', 'join', { terminal_id: boundTerminalId })
  if (props.active) {
    await nextTick()
    xterm.focus()
  }
}

const offHandlers = [
  workerSocket.on('term', 'output', (payload) => {
    if (!xterm || Number(payload.terminal_id) !== Number(boundTerminalId)) return
    xterm.write(payload.data)
  }),
  workerSocket.on('term', 'joined', (payload) => {
    if (!xterm || Number(payload.terminal_id) !== Number(boundTerminalId)) return
    if (Number.isFinite(Number(payload.cols)) && Number.isFinite(Number(payload.rows))) {
      applyingRemoteResize = true
      xterm.resize(Number(payload.cols), Number(payload.rows))
      applyingRemoteResize = false
    }
    fitTerminalSoon()
    if (props.active) xterm.focus()
  }),
  workerSocket.on('term', 'resized', (payload) => {
    if (!xterm || Number(payload.terminal_id) !== Number(boundTerminalId)) return
    if (!Number.isFinite(Number(payload.cols)) || !Number.isFinite(Number(payload.rows))) return
    applyingRemoteResize = true
    xterm.resize(Number(payload.cols), Number(payload.rows))
    applyingRemoteResize = false
  }),
  workerSocket.on('term', 'exit', (payload) => {
    const tid = Number(payload.terminal_id)
    if (tid) deadTerminalIds.add(tid)
    if (!xterm || tid !== Number(boundTerminalId)) return
    xterm.writeln('\r\n[session ended]')
  }),
]

watch(
  () => props.terminalId,
  async (nextId) => {
    if (!nextId) {
      boundTerminalId = null
      xterm?.reset()
      return
    }
    await bindTerminal(nextId)
  },
  { immediate: true }
)

watch(
  () => props.active,
  async (active) => {
    if (!active || !xterm) return
    await nextTick()
    fitTerminalSoon()
    xterm.focus()
  }
)

onMounted(async () => {
  if (props.terminalId) {
    await bindTerminal(props.terminalId)
  }
  // 1Hz tick is enough for a countdown badge; we throw it away when
  // the component unmounts to avoid leaking a timer per pane.
  nowTimer = setInterval(() => { nowMs.value = Date.now() }, 1000)
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', onWindowResize)
  terminalResizeObserver?.disconnect()
  terminalResizeObserver = null
  offHandlers.forEach((off) => off())
  xterm?.dispose()
  if (nowTimer) { clearInterval(nowTimer); nowTimer = null }
})
</script>


