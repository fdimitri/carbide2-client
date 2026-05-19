// Carbide2 bitmask logger
// Enable in browser console: window.carbide.log(mask)
//
// Bits:
//   ENTRY = 1    — function entry/exit with args
//   INFO  = 2    — general informational
//   WARN  = 4    — warnings / unexpected state
//   WS    = 8    — WebSocket send/receive raw dumps
//   DRAG  = 16   — drag-and-drop events
//   PANE  = 32   — pane/tab state changes
//   TERM  = 64   — terminal lifecycle (create/join/output/exit)
//   CHAT  = 128  — chat join/leave/message
//
// Presets:
//   window.carbide.log(0)    // off
//   window.carbide.log(8)    // WS only
//   window.carbide.log(64)   // terminal only
//   window.carbide.log(255)  // everything

export const LOG = {
  ENTRY: 1 << 0,   //   1
  INFO:  1 << 1,   //   2
  WARN:  1 << 2,   //   4
  WS:    1 << 3,   //   8
  DRAG:  1 << 4,   //  16
  PANE:  1 << 5,   //  32
  TERM:  1 << 6,   //  64
  CHAT:  1 << 7,   // 128
}

let _mask = 0
try { _mask = parseInt(localStorage.getItem('carbide_log') || '0', 10) || 0 } catch {}

export function setLogMask(mask) {
  _mask = mask >>> 0
  try { localStorage.setItem('carbide_log', String(_mask)) } catch {}
  const names = Object.entries(LOG).filter(([, v]) => _mask & v).map(([k]) => k)
  console.info(`[carbide/log] mask=${_mask} (${_mask.toString(2).padStart(8, '0')}b) enabled: ${names.join(', ') || 'none'}`)
}

export function logEntry(tag, fn, ...args) {
  if (!(_mask & LOG.ENTRY)) return
  console.groupCollapsed(`[ENTRY] ${tag}::${fn}`, ...args)
  console.trace()
  console.groupEnd()
}

export function logInfo(tag, ...args) {
  if (!(_mask & LOG.INFO)) return
  console.log(`[INFO] [${tag}]`, ...args)
}

export function logWarn(tag, ...args) {
  if (!(_mask & LOG.WARN)) return
  console.warn(`[WARN] [${tag}]`, ...args)
}

export function logWs(direction, cs, cmd, payload) {
  if (!(_mask & LOG.WS)) return
  const arrow = direction === 'recv' ? '←' : '→'
  console.log(`[WS] ${arrow} ${cs}:${cmd}`, payload)
}

export function logDrag(tag, ...args) {
  if (!(_mask & LOG.DRAG)) return
  console.log(`[DRAG] [${tag}]`, ...args)
}

export function logPane(tag, ...args) {
  if (!(_mask & LOG.PANE)) return
  console.log(`[PANE] [${tag}]`, ...args)
}

export function logTerm(tag, ...args) {
  if (!(_mask & LOG.TERM)) return
  console.log(`[TERM] [${tag}]`, ...args)
}

export function logChat(tag, ...args) {
  if (!(_mask & LOG.CHAT)) return
  console.log(`[CHAT] [${tag}]`, ...args)
}

// Expose to browser console
if (typeof window !== 'undefined') {
  window.carbide = window.carbide || {}
  window.carbide.log  = setLogMask
  window.carbide.LOG  = LOG
  window.carbide.logMask = () => _mask
  window.carbide.help = () => {
    console.table(Object.entries(LOG).map(([name, bit]) => ({
      name, bit, enabled: !!(_mask & bit)
    })))
    console.info('Usage: window.carbide.log(72)  // WS(8) + TERM(64)')
    console.info('State: window.carbide.state    // live reactive state snapshot')
  }
}

export default { LOG, setLogMask, logEntry, logInfo, logWarn, logWs, logDrag, logPane, logTerm, logChat }
