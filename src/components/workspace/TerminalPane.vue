<template>
  <div class="terminal-pane">
    <div ref="terminalContainer" class="terminal-pane__container" />
    <div v-if="!terminalId" class="terminal-pane__placeholder">
      Select or create a terminal from the tree.
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
})

const terminalContainer = ref(null)
let xterm = null
let fitAddon = null
let terminalResizeObserver = null
let boundTerminalId = null
let applyingRemoteResize = false

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
  boundTerminalId = nextId
  await nextTick()
  if (!ensureXterm()) return
  xterm.reset()
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
    if (!xterm || Number(payload.terminal_id) !== Number(boundTerminalId)) return
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
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', onWindowResize)
  terminalResizeObserver?.disconnect()
  terminalResizeObserver = null
  offHandlers.forEach((off) => off())
  xterm?.dispose()
})
</script>

<style scoped>
.terminal-pane {
  position: relative;
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}

.terminal-pane__container {
  flex: 1;
  min-height: 0;
  padding: 0.35rem;
  background: #0b1017;
}

.terminal-pane__placeholder {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  text-align: center;
  color: #91a2bc;
  padding: 1rem;
  pointer-events: none;
}
</style>
