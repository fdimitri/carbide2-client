<template>
  <div class="relative flex flex-col flex-1 min-h-0">
    <div ref="terminalContainer" class="flex-1 min-h-0 p-1.5 bg-bg-1" />
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
      class="absolute top-1.5 right-2.5 flex items-center gap-1.5 px-2.5 py-1 text-ui-xs font-semibold bg-warn/15 border border-warn text-warn rounded-ui-md pointer-events-none"
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
let joinedTerminalId = null  // the terminal id we've already sent term/join for
let applyingRemoteResize = false
const deadTerminalIds = new Set()  // ids whose shell has exited; don't try to re-join

const onWindowResize = () => fitTerminalSoon()

// Send user/agent keystrokes to the bound terminal's PTY. Shared by xterm's
// onData and the Shift+Ctrl+V paste path so both go through the same guard.
function sendInput(data) {
  if (!boundTerminalId) return
  workerSocket.send('term', 'input', { terminal_id: boundTerminalId, data })
}

// Fit to the container, but never while hidden (0×0). The ResizeObserver
// re-fires when the pane becomes visible with a real size, so a hidden fit
// is unnecessary and can push a bogus 0×0 resize to the worker (#88).
function fitTerminalSoon() {
  const el = terminalContainer.value
  if (!el || el.clientWidth === 0 || el.clientHeight === 0) return
  requestAnimationFrame(() => {
    const el2 = terminalContainer.value
    if (!el2 || el2.clientWidth === 0 || el2.clientHeight === 0) return
    fitAddon?.fit()
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

  // Terminal keyboard capture (#100): browser-level shortcuts must not leak
  // past the terminal, and there needs to be a keyboard copy/paste path.
  // Return value semantics (xterm.js): false => xterm does NOT process the
  // event (we handled it); true/undefined => xterm processes it normally.
  xterm.attachCustomKeyEventHandler((ev) => {
    if (ev.type !== 'keydown') return true
    const key = (ev.key || '').toLowerCase()

    // Ctrl+W closes the browser tab by default. Best-effort: send ^W to the
    // shell and preventDefault so the tab doesn't close. (Chrome/Edge reserve
    // Ctrl+W and ignore preventDefault, so this can only be best-effort there.)
    if (ev.ctrlKey && !ev.shiftKey && !ev.metaKey && key === 'w') {
      ev.preventDefault()
      sendInput('\x17')
      return false
    }

    // Shift+Ctrl+C/V: terminal copy/paste. Bare Ctrl+C must keep sending
    // SIGINT, so only intercept when Shift is also held (and let xterm process
    // everything else by returning true).
    if (ev.ctrlKey && ev.shiftKey && !ev.metaKey && key === 'c') {
      const sel = xterm.getSelection()
      if (sel) navigator.clipboard?.writeText(sel).catch(() => {})
      ev.preventDefault()
      return false
    }
    if (ev.ctrlKey && ev.shiftKey && !ev.metaKey && key === 'v') {
      navigator.clipboard?.readText()
        .then((text) => { if (text) sendInput(text) })
        .catch(() => {})
      ev.preventDefault()
      return false
    }

    return true
  })

  fitTerminalSoon()

  xterm.onData((data) => {
    sendInput(data)
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
  // Idempotent: join each terminal exactly once. With the per-tab model a
  // TerminalPane is keyed by uuid, so this normally runs once at mount.
  if (nextId === joinedTerminalId) {
    if (props.active) {
      await nextTick()
      xterm?.focus()
    }
    return
  }
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
  workerSocket.send('term', 'join', { terminal_id: boundTerminalId })
  joinedTerminalId = nextId
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
      joinedTerminalId = null
      return
    }
    await bindTerminal(nextId)
  },
  { immediate: true }
)

// On re-activation, focus + fit the terminal. fitTerminalSoon is 0×0-guarded,
// so it no-ops while hidden and fits once the pane is actually visible. This
// gives a second chance to fit beyond the ResizeObserver, without the old
// unbounded fit-on-every-show churn.
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
  // NOTE: bindTerminal is NOT called here. The immediate watch on
  // props.terminalId already runs it after the DOM is mounted (bindTerminal
  // awaits nextTick before ensureXterm). Calling it again here caused a
  // double term/join on initial mount.
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


