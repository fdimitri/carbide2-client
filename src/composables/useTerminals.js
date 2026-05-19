// useTerminals — terminal list, create, rename, and tab binding.
// xterm lifecycle is fully owned by TerminalPane.vue; this composable
// only manages the server-side terminal objects and the create/select flow.
import { ref } from 'vue'
import workerSocket from '../services/workerSocket'
import { logInfo, logWs } from '../services/log'

export function useTerminals({ error, bindTabToActivePane, activePane }) {
  const terminalLoading          = ref(false)
  const terminalList             = ref([])
  const selectedTerminalId       = ref(null)
  const showCreateTerminalDialog = ref(false)
  const terminalCreateName       = ref('')
  const terminalCreateOptions    = ref('')

  let createTerminalTimeout = null

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

  function selectTerminalNode(tid, options = {}) {
    selectedTerminalId.value = tid
    activePane.value = 'terminal'
    const current = terminalList.value.find(t => Number(t.id) === Number(tid))
    if (!options.skipPaneTab) {
      bindTabToActivePane('terminal', tid, current?.name || `terminal #${tid}`)
    }
  }

  function renameTerminalById(tid) {
    const current = terminalList.value.find(t => Number(t.id) === Number(tid))
    const name = window.prompt('Terminal name:', current?.name || `terminal #${tid}`)
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
        terminalLoading.value = false
        const createdId = p.terminal_id
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
      })
    )
  }

  function cleanup() {
    if (createTerminalTimeout) {
      clearTimeout(createTerminalTimeout)
      createTerminalTimeout = null
    }
  }

  return {
    terminalLoading,
    terminalList,
    selectedTerminalId,
    showCreateTerminalDialog,
    terminalCreateName,
    terminalCreateOptions,
    openCreateTerminalDialog,
    confirmCreateTerminal,
    openTerminal,
    selectTerminalNode,
    renameTerminalById,
    renameSelectedTerminal,
    terminalModeNoop,
    registerHandlers,
    cleanup,
  }
}
