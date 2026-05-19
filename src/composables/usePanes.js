// usePanes — multi-pane layout state: layouts, tabs, drag-drop
import { ref, computed } from 'vue'
import { logEntry, logInfo, logWarn } from '../services/log'

export const PANE_COUNTS = {
  one:                    1,
  'two-horizontal':       2,
  'two-vertical':         2,
  'three-horizontal-wide': 3,
  'three-vertical-tall':  3,
  quad:                   4,
}

export function usePanes({ activePane, pendingNavigation }) {
  const paneLayout     = ref('one')
  const activePaneIndex = ref(0)
  const panes          = ref(Array.from({ length: 4 }, () => ({ tabs: [], activeTab: null })))

  const menuLayoutItems = computed(() => [
    { label: '1 Pane',                                     command: () => setPaneLayout('one') },
    { label: '2 Panes (horizontal)',                       command: () => setPaneLayout('two-horizontal') },
    { label: '2 Panes (vertical)',                         command: () => setPaneLayout('two-vertical') },
    { label: '3 Panes (Horizontal wide, two vertical)',    command: () => setPaneLayout('three-horizontal-wide') },
    { label: '3 Panes (Vertical tall, two horizontal)',    command: () => setPaneLayout('three-vertical-tall') },
    { label: '4 Panes (Quad)',                             command: () => setPaneLayout('quad') },
  ])

  const dockLayoutItems = computed(() => [
    { label: '1 Pane',    icon: 'pi-stop',       command: () => setPaneLayout('one') },
    { label: '2H',        icon: 'pi-pause',      command: () => setPaneLayout('two-horizontal') },
    { label: '2V',        icon: 'pi-bars',       command: () => setPaneLayout('two-vertical') },
    { label: '3H',        icon: 'pi-th-large',   command: () => setPaneLayout('three-horizontal-wide') },
    { label: '3V',        icon: 'pi-clone',      command: () => setPaneLayout('three-vertical-tall') },
    { label: '4Q',        icon: 'pi-table',      command: () => setPaneLayout('quad') },
  ])

  function setPaneLayout(layout) {
    const next      = PANE_COUNTS[layout] ? layout : 'one'
    const nextCount = PANE_COUNTS[next]
    const prevCount = PANE_COUNTS[paneLayout.value]

    // Evict tabs from panes being hidden into the last visible pane.
    if (nextCount < prevCount) {
      const targetPane = panes.value[nextCount - 1]
      for (let i = nextCount; i < prevCount; i++) {
        const hiddenPane = panes.value[i]
        for (const tab of hiddenPane.tabs) {
          if (!targetPane.tabs.find((t) => t.key === tab.key)) {
            targetPane.tabs.push(tab)
          }
        }
        // If the target had nothing active, inherit from the evicted pane.
        if (!targetPane.activeTab && hiddenPane.activeTab) {
          targetPane.activeTab = hiddenPane.activeTab
        }
        hiddenPane.tabs      = []
        hiddenPane.activeTab = null
      }
    }

    paneLayout.value = next
    if (activePaneIndex.value >= nextCount) activePaneIndex.value = nextCount - 1
  }

  function parseTabKey(key) {
    if (!key || typeof key !== 'string' || !key.includes(':')) return null
    const [kind, rawId] = key.split(':')
    if (kind === 'file') return { kind, id: rawId }
    return { kind, id: Number(rawId) }
  }

  function bindTabToActivePane(kind, id, label) {
    const pane = panes.value[activePaneIndex.value]
    const key  = `${kind}:${id}`
    if (!pane.tabs.find((t) => t.key === key)) {
      pane.tabs.push({ key, kind, id, label })
    }
    pane.activeTab = key
  }

  function bindTabToPane(targetPaneIndex, kind, id, label) {
    const pane = panes.value[targetPaneIndex]
    if (!pane) return
    activePaneIndex.value = targetPaneIndex
    const key = `${kind}:${id}`
    if (!pane.tabs.find((t) => t.key === key)) {
      pane.tabs.push({ key, kind, id, label })
    }
    pane.activeTab = key
  }

  function activatePaneTab(paneIndex, key) {
    const pane = panes.value[paneIndex]
    if (!pane) return
    activePaneIndex.value = paneIndex
    pane.activeTab = key
    const parsed = parseTabKey(key)
    if (!parsed) return
    pendingNavigation.value = { kind: parsed.kind, id: parsed.id, opts: { skipPaneTab: true } }
  }

  function closePaneTab(paneIndex, key) {
    const pane = panes.value[paneIndex]
    if (!pane) return
    const idx = pane.tabs.findIndex((t) => t.key === key)
    if (idx === -1) return

    pane.tabs.splice(idx, 1)

    if (pane.activeTab !== key) return
    if (pane.tabs.length === 0) {
      pane.activeTab = null
      if (paneIndex === activePaneIndex.value) {
        activePane.value = 'file'
      }
      return
    }

    const nextIdx = Math.max(0, idx - 1)
    const nextTab = pane.tabs[nextIdx]
    pane.activeTab = nextTab.key
    if (paneIndex === activePaneIndex.value) {
      activatePaneTab(paneIndex, nextTab.key)
    }
  }

  function onTabDragStart(fromPaneIndex, tabKey, event) {
    logInfo('usePanes', 'tab dragstart', fromPaneIndex, tabKey)
    const payload = { fromPaneIndex, tabKey }
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('application/x-carbide-tab', JSON.stringify(payload))
  }

  async function onTabDrop(toPaneIndex, event) {
    const raw = event?.dataTransfer?.getData('application/x-carbide-tab')
    if (!raw) return
    let payload = null
    try { payload = JSON.parse(raw) } catch { return }

    const fromPaneIndex = Number(payload?.fromPaneIndex)
    const tabKey        = payload?.tabKey
    if (!Number.isInteger(fromPaneIndex) || typeof tabKey !== 'string') return
    if (!panes.value[fromPaneIndex] || !panes.value[toPaneIndex]) return

    logInfo('usePanes', 'tab drop', fromPaneIndex, '->', toPaneIndex, tabKey)

    const sourcePane = panes.value[fromPaneIndex]
    const targetPane = panes.value[toPaneIndex]
    const tabIdx     = sourcePane.tabs.findIndex((t) => t.key === tabKey)
    if (tabIdx === -1) return

    if (fromPaneIndex === toPaneIndex) {
      targetPane.activeTab  = tabKey
      activePaneIndex.value = toPaneIndex
      await activatePaneTab(toPaneIndex, tabKey)
      return
    }

    const [tab] = sourcePane.tabs.splice(tabIdx, 1)
    if (!targetPane.tabs.find((t) => t.key === tab.key)) targetPane.tabs.push(tab)
    targetPane.activeTab = tab.key

    if (sourcePane.activeTab === tabKey) {
      sourcePane.activeTab = sourcePane.tabs[sourcePane.tabs.length - 1]?.key || null
    }

    activePaneIndex.value = toPaneIndex
    await activatePaneTab(toPaneIndex, tab.key)
  }

  function onPaneDrop(paneIndex, event) {
    const raw = event?.dataTransfer?.getData('application/x-carbide-node')
    if (!raw) return
    let payload = null
    try { payload = JSON.parse(raw) } catch { return }
    if (!payload?.kind) return

    logInfo('usePanes', 'onPaneDrop', paneIndex, payload)
    activePaneIndex.value = paneIndex

    if (payload.kind === 'terminal') {
      pendingNavigation.value = { kind: 'terminal', id: Number(payload.id), opts: {} }
      return
    }
    if (payload.kind === 'channel') {
      pendingNavigation.value = { kind: 'channel', id: Number(payload.id), opts: {} }
      return
    }
    if (payload.kind === 'file') {
      pendingNavigation.value = { kind: 'file', id: String(payload.id), opts: {} }
    }
  }

  return {
    paneLayout,
    activePaneIndex,
    panes,
    menuLayoutItems,
    dockLayoutItems,
    setPaneLayout,
    parseTabKey,
    bindTabToActivePane,
    bindTabToPane,
    activatePaneTab,
    closePaneTab,
    onTabDragStart,
    onTabDrop,
    onPaneDrop,
  }
}
