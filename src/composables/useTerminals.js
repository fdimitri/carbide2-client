// useTerminals — terminal list, create, rename, and tab binding.
// xterm lifecycle is fully owned by TerminalPane.vue; this composable
// only manages the server-side terminal objects and the create/select flow.
import { ref } from 'vue'
import { storeToRefs } from 'pinia'
import workerSocket from '../services/workerSocket'
import { logInfo, logWs } from '../services/log'
import { useWorkspaceStore } from '../stores/workspaceStore'
import { useDebugLogStore } from '../stores/debugLogStore'

export function useTerminals({ error, bindTabToActivePane, activePane }) {
  const store = useWorkspaceStore()
  const { terminalList, selectedTerminalId } = storeToRefs(store)
  const debugLog = useDebugLogStore()

  const terminalLoading          = ref(false)
  const showCreateTerminalDialog = ref(false)
  const terminalCreateName       = ref('')
  const terminalCreateOptions    = ref('')
  const terminalCreateAgentAccessible = ref(false)

  let createTerminalTimeout = null

  // Suggest a sensible default name based on whether the terminal is being
  // created agent-accessible. AgentShell-N is the convention the user picked
  // so all agent-touchable terminals are visually grouped/searchable.
  function suggestedTerminalName(agentAccessible) {
    if (agentAccessible) {
      const maxAgent = terminalList.value.reduce((max, t) => {
        const m = /^AgentShell-(\d+)$/.exec(t.name || '')
        return m ? Math.max(max, Number(m[1])) : max
      }, 0)
      return `AgentShell-${maxAgent + 1}`
    }
    const maxId = terminalList.value.reduce((max, t) => Math.max(max, Number(t.id) || 0), 0)
    return `Terminal#${maxId + 1}`
  }

  function openCreateTerminalDialog() {
    terminalCreateAgentAccessible.value = false
    terminalCreateName.value    = suggestedTerminalName(false)
    terminalCreateOptions.value = ''
    showCreateTerminalDialog.value = true
  }

  // Watcher hook: ProjectPage can call this when the user toggles the
  // agent-accessible checkbox so the suggested name updates (but doesn't
  // overwrite the user's manual edit).
  function onAgentAccessibleToggle(prevSuggested) {
    const current = terminalCreateName.value.trim()
    if (current === '' || current === prevSuggested) {
      terminalCreateName.value = suggestedTerminalName(terminalCreateAgentAccessible.value)
    }
  }

  async function confirmCreateTerminal() {
    const name = terminalCreateName.value.trim() || 'Terminal'
    const agentAccessible = !!terminalCreateAgentAccessible.value
    showCreateTerminalDialog.value = false
    await openTerminal({ name, agent_accessible: agentAccessible })
  }

  async function openTerminal(options = {}) {
    if (terminalLoading.value) return
    terminalLoading.value = true
    error.value = ''
    try {
      workerSocket.send('term', 'create', {
        name: options.name,
        agent_accessible: !!options.agent_accessible,
      })
      debugLog.push({ severity: 'info', source: 'term', action: 'create-requested', detail: `name=${options.name || '(default)'} agent=${!!options.agent_accessible}` })
      createTerminalTimeout = setTimeout(() => {
        terminalLoading.value = false
        error.value = 'Timed out creating terminal. Check worker logs and JWT secret.'
        debugLog.push({ severity: 'error', source: 'term', action: 'create-timeout', detail: `name=${options.name || '(default)'}` })
        createTerminalTimeout = null
      }, 5000)
    } catch (e) {
      if (createTerminalTimeout) {
        clearTimeout(createTerminalTimeout)
        createTerminalTimeout = null
      }
      error.value = e.message || 'Failed to create terminal'
      debugLog.push({ severity: 'error', source: 'term', action: 'create-failed', detail: e.message || 'unknown' })
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

  function destroyTerminalById(tid) {
    const target = Number(tid)
    if (!target) return
    if (!window.confirm(`Destroy terminal #${target}? The shell process will be killed.`)) return
    workerSocket.send('term', 'destroy', { terminal_id: target })
    debugLog.push({ severity: 'warn', source: 'term', action: 'destroy-requested', detail: `id=${target}` })
  }

  function terminalModeNoop(tid) {
    error.value = `Terminal #${tid} incognito/exclusive mode is not implemented yet.`
  }

  // Toggle the agent_accessible flag on an existing terminal. Worker may
  // refuse (e.g. project mismatch); the term/list rebroadcast confirms or
  // reverts our optimistic state.
  function setAgentAccessible(tid, enabled) {
    const target = Number(tid)
    if (!target) return
    workerSocket.send('term', 'set_agent_accessible', {
      terminal_id: target,
      enabled: !!enabled,
    })
    debugLog.push({
      severity: 'info', source: 'term', action: 'set-agent-accessible',
      detail: `id=${target} enabled=${!!enabled}`,
    })
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
        debugLog.push({ severity: 'error', source: 'worker', action: 'system-error', detail: p?.message || 'unknown' })
      }),
      workerSocket.on('term', 'list', (p) => {
        logWs('recv', 'term', 'list', p)
        // Worker now sends agent_accessible / agent_busy / agent_busy_until_ms
        // per entry — pass them through unchanged so the UI can badge.
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
            {
              id: createdId,
              name: p.name || `terminal-${createdId}`,
              status: 'active',
              agent_accessible: !!p.agent_accessible,
              agent_busy: false,
              agent_busy_until_ms: null,
            },
          ]
        }
        logInfo('useTerminals', 'terminal created, id=', createdId)
        debugLog.push({ severity: 'ok', source: 'term', action: 'created', detail: `id=${createdId} name=${p.name || ''}` })
        selectedTerminalId.value = createdId
        ;(onTerminalCreated || selectTerminalNode)(createdId)
      }),
      workerSocket.on('term', 'renamed', (p) => {
        logWs('recv', 'term', 'renamed', p)
        const tid = Number(p.terminal_id)
        terminalList.value = terminalList.value.map(t =>
          Number(t.id) === tid ? { ...t, name: p.name } : t
        )
        debugLog.push({ severity: 'info', source: 'term', action: 'renamed', detail: `id=${tid} name=${p.name}` })
        error.value = ''
      }),
      workerSocket.on('term', 'exit', (p) => {
        logWs('recv', 'term', 'exit', p)
        const tid = Number(p.terminal_id)
        terminalList.value = terminalList.value.filter(t => Number(t.id) !== tid)
        if (Number(selectedTerminalId.value) === tid) selectedTerminalId.value = null
        debugLog.push({ severity: 'info', source: 'term', action: 'exited', detail: `id=${tid} code=${p.code ?? ''}` })
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
    terminalCreateAgentAccessible,
    suggestedTerminalName,
    onAgentAccessibleToggle,
    openCreateTerminalDialog,
    confirmCreateTerminal,
    openTerminal,
    selectTerminalNode,
    renameTerminalById,
    renameSelectedTerminal,
    destroyTerminalById,
    terminalModeNoop,
    setAgentAccessible,
    registerHandlers,
    cleanup,
  }
}
