// useTerminals — terminal list, create, connect, and xterm lifecycle
import { ref, nextTick } from 'vue'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import workerSocket from '../services/workerSocket'
import { logEntry, logInfo, logWarn, logWs } from '../services/log'

export function useTerminals({ error, bindTabToActivePane, activePane }) {
  const terminalEl         = ref(null)
  const terminalActive     = ref(false)
  const terminalLoading    = ref(false)
  const terminalList       = ref([])
  const selectedTerminalId = ref(null)
  const showCreateTerminalDialog = ref(false)
  const terminalCreateName    = ref('')
  const terminalCreateOptions = ref('')

  let createTerminalTimeout   = null
  let xterm                   = null
  let fitAddon                = null
  let terminalId              = null
  let terminalResizeObserver  = null
  let applyingRemoteResize    = false

  function fitTerminalSoon() {
    requestAnimationFrame(() => {
      fitAddon?.fit()
      requestAnimationFrame(() => fitAddon?.fit())
    })
  }

  function setTerminalEl(el) {
    terminalEl.value = el
  }

  function openCreateTerminalDialog() {
    const maxId = terminalList.value.reduce((max, t) => Math.max(max, Number(t.id) || 0), 0)
    terminalCreateName.value    = `Terminal#${maxId + 1}`
    terminalCreateOptions.value = ''
    showCreateTerminalDialog.value = true
  }

  async function confirmCreateTerminal() {
    const name = terminalCreateName.value.trim() || 'Terminal'
    showCreateTerminalDialog.value = false
    await openTerminal({ name })
  }

  async function openTerminal(options = {}) {
    if (terminalLoading.value) return
    terminalLoading.value = true
    error.value = ''
    try {
      workerSocket.send('term', 'create', { name: options.name })
      createTerminalTimeout = setTimeout(() => {
        terminalLoading.value = false
        error.value = 'Timed out creating terminal. Check worker logs and JWT secret.'
        createTerminalTimeout = null
      }, 5000)
    } catch (e) {
      if (createTerminalTimeout) {
        clearTimeout(createTerminalTimeout)
        createTerminalTimeout = null
      }
      error.value = e.message || 'Failed to create terminal'
      terminalLoading.value = false
    }
  }

  function markTerminalOpen(tid) {
    // Returned as a set from caller; maintained there since openedTerminalIds lives in parent scope
  }

  async function connectToTerminal(tid) {
    terminalLoading.value = true
    try {
      activePane.value = 'terminal'
      terminalId = tid
      const label = terminalList.value.find(t => Number(t.id) === Number(tid))?.name || `terminal #${tid}`
      bindTabToActivePane('terminal', tid, label)
    } catch (e) {
      error.value = e.message || 'Failed to connect to terminal'
    } finally {
      terminalLoading.value = false
    }
  }

  async function selectTerminalNode(tid, options = {}) {
    selectedTerminalId.value = tid
    const current = terminalList.value.find(t => Number(t.id) === Number(tid))
    if (!options.skipPaneTab) {
      bindTabToActivePane('terminal', tid, current?.name || `terminal #${tid}`)
    }
    await connectToTerminal(tid)
  }

  function renameTerminalById(tid) {
    const current = terminalList.value.find(t => Number(t.id) === Number(tid))
    const fallback = `terminal #${tid}`
    const name = window.prompt('Terminal name:', current?.name || fallback)
    if (!name || !name.trim()) return
    workerSocket.send('term', 'rename', { terminal_id: tid, name: name.trim() })
  }

  function renameSelectedTerminal(tid = null) {
    const target = Number(tid) || Number(selectedTerminalId.value)
    if (!target) return
    renameTerminalById(target)
  }

  function terminalModeNoop(tid) {
    error.value = `Terminal #${tid} incognito/exclusive mode is not implemented yet.`
  }

  function focusAnyTerminal(selectTerminal) {
    if (selectedTerminalId.value) {
      selectTerminal(selectedTerminalId.value)
      return
    }
    const first = terminalList.value[0]
    if (first) selectTerminal(first.id)
  }

  function registerHandlers(offHandlers, onTerminalCreated) {
    offHandlers.push(
      workerSocket.on('system', 'error', (p) => {
        if (createTerminalTimeout) {
          clearTimeout(createTerminalTimeout)
          createTerminalTimeout = null
        }
        terminalLoading.value = false
        error.value = p?.message || 'Worker error'
      }),
      workerSocket.on('term', 'list', (p) => {
        logWs('recv', 'term', 'list', p)
        terminalList.value = p.terminals || []
      }),
      workerSocket.on('term', 'created', (p) => {
        logWs('recv', 'term', 'created', p)
        if (createTerminalTimeout) {
          clearTimeout(createTerminalTimeout)
          createTerminalTimeout = null
        }
        const createdId = p.terminal_id
        // Eagerly push to list so the tree updates immediately
        if (!terminalList.value.find(t => Number(t.id) === createdId)) {
          terminalList.value = [
            ...terminalList.value,
            { id: createdId, name: p.name || `terminal-${createdId}`, status: 'active' },
          ]
        }
        logInfo('useTerminals', 'terminal created, id=', createdId)
        selectedTerminalId.value = createdId
        ;(onTerminalCreated || selectTerminalNode)(createdId)
      }),
      workerSocket.on('term', 'renamed', (p) => {
        logWs('recv', 'term', 'renamed', p)
        const tid = Number(p.terminal_id)
        terminalList.value = terminalList.value.map(t =>
          Number(t.id) === tid ? { ...t, name: p.name } : t
        )
        error.value = ''
      }),
      workerSocket.on('term', 'output', (p) => {
        if (xterm && p.terminal_id === terminalId) xterm.write(p.data)
      }),
      workerSocket.on('term', 'joined', (p) => {
        if (!xterm || p.terminal_id !== terminalId) return
        if (Number.isFinite(Number(p.cols)) && Number.isFinite(Number(p.rows))) {
          applyingRemoteResize = true
          xterm.resize(Number(p.cols), Number(p.rows))
          applyingRemoteResize = false
        }
        fitTerminalSoon()
      }),
      workerSocket.on('term', 'resized', (p) => {
        if (!xterm || p.terminal_id !== terminalId) return
        if (!Number.isFinite(Number(p.cols)) || !Number.isFinite(Number(p.rows))) return
        applyingRemoteResize = true
        xterm.resize(Number(p.cols), Number(p.rows))
        applyingRemoteResize = false
      }),
      workerSocket.on('term', 'exit', (p) => {
        if (xterm && p.terminal_id === terminalId) {
          xterm.writeln('\r\n[session ended]')
          terminalActive.value = false
        }
      })
    )
  }

  // Call after the terminalEl DOM element is mounted and a terminal is being opened
  function mountXterm(el) {
    if (xterm) {
      xterm.dispose()
      xterm = null
      fitAddon = null
    }
    xterm    = new Terminal({ cursorBlink: true, fontSize: 14 })
    fitAddon = new FitAddon()
    xterm.loadAddon(fitAddon)
    xterm.open(el)
    fitAddon.fit()
    xterm.onData((data) => {
      if (terminalId) workerSocket.send('term', 'input', { terminal_id: terminalId, data })
    })
    xterm.onResize(({ cols, rows }) => {
      if (applyingRemoteResize || !terminalId) return
      workerSocket.send('term', 'resize', { terminal_id: terminalId, cols, rows })
    })
    terminalActive.value = true
    nextTick(() => {
      fitTerminalSoon()
      xterm?.focus()
    })
  }

  function cleanup() {
    terminalResizeObserver?.disconnect()
    terminalResizeObserver = null
    if (createTerminalTimeout) {
      clearTimeout(createTerminalTimeout)
      createTerminalTimeout = null
    }
    xterm?.dispose()
    xterm    = null
    fitAddon = null
  }

  return {
    terminalEl,
    terminalActive,
    terminalLoading,
    terminalList,
    selectedTerminalId,
    showCreateTerminalDialog,
    terminalCreateName,
    terminalCreateOptions,
    fitTerminalSoon,
    setTerminalEl,
    openCreateTerminalDialog,
    confirmCreateTerminal,
    openTerminal,
    connectToTerminal,
    selectTerminalNode,
    renameTerminalById,
    renameSelectedTerminal,
    terminalModeNoop,
    focusAnyTerminal,
    registerHandlers,
    mountXterm,
    cleanup,
    getXterm: () => xterm,
    getTerminalId: () => terminalId,
  }
}
