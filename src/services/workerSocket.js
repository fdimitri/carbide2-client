// WorkerSocket — single WebSocket connection to the Carbide2 worker
// Protocol: { cs, cmd, payload }
// Usage: import workerSocket from './workerSocket'
//        workerSocket.connect(token)
//        workerSocket.on('term', 'output', handler)
//        workerSocket.send('chat', 'message', { text: 'hello' })
import { logWs, logInfo, logWarn } from './log'

const getWorkerUrl = () => {
  if (import.meta.env.VITE_WORKER_URL) return import.meta.env.VITE_WORKER_URL
  const host = window.location.hostname
  return `ws://${host}:8080`
}

const RECONNECT_BASE_MS  = 1000
const RECONNECT_MAX_MS   = 30000
const RECONNECT_MAX_TRIES = 10

class WorkerSocket {
  constructor() {
    this._ws         = null
    this._handlers   = {}   // { "cs:cmd": [fn, ...] }
    this._ready      = false
    this._queue      = []
    this._generation = 0    // incremented on each connect() to ignore stale close events
    this._token      = null
    this._reconnectAttempt = 0
    this._reconnectTimer   = null
    this._stopped    = false // true after explicit disconnect()
  }

  connect(token) {
    this._token   = token
    this._stopped = false
    this._reconnectAttempt = 0
    this._clearReconnectTimer()
    this._open()
  }

  _open() {
    // Close old socket without letting its onclose trigger reconnect for the new one
    if (this._ws) {
      const old = this._ws
      old.onclose = null
      old.onerror = null
      old.close()
    }

    const gen = ++this._generation
    const url = `${getWorkerUrl()}/?token=${encodeURIComponent(this._token)}`
    logInfo('WorkerSocket', 'connecting to', url)
    this._ws = new WebSocket(url)

    this._ws.onopen = () => {
      if (this._generation !== gen) return
      logInfo('WorkerSocket', 'connected')
      this._ready = true
      this._reconnectAttempt = 0
      this._queue.forEach(m => this._ws.send(m))
      this._queue = []
    }

    this._ws.onmessage = (event) => {
      if (this._generation !== gen) return
      let msg
      try { msg = JSON.parse(event.data) } catch { return }
      logWs('recv', msg.cs, msg.cmd, msg.payload)
      const key = `${msg.cs}:${msg.cmd}`
      const handlers = this._handlers[key] || []
      const wildcards = this._handlers[`${msg.cs}:*`] || []
      ;[...handlers, ...wildcards].forEach(fn => fn(msg.payload, msg))
    }

    this._ws.onclose = (e) => {
      if (this._generation !== gen) return
      logWarn('WorkerSocket', 'closed', e.code, e.reason)
      this._ready = false
      if (!this._stopped) this._scheduleReconnect()
    }

    this._ws.onerror = (e) => {
      if (this._generation !== gen) return
      logWarn('WorkerSocket', 'error', e)
    }
  }

  _scheduleReconnect() {
    if (this._stopped || this._reconnectAttempt >= RECONNECT_MAX_TRIES) {
      logWarn('WorkerSocket', 'giving up reconnect after', this._reconnectAttempt, 'attempts')
      return
    }
    const delay = Math.min(RECONNECT_BASE_MS * 2 ** this._reconnectAttempt, RECONNECT_MAX_MS)
    this._reconnectAttempt++
    logInfo('WorkerSocket', `reconnecting in ${delay}ms (attempt ${this._reconnectAttempt})`)
    this._reconnectTimer = setTimeout(() => {
      if (!this._stopped) this._open()
    }, delay)
  }

  _clearReconnectTimer() {
    if (this._reconnectTimer !== null) {
      clearTimeout(this._reconnectTimer)
      this._reconnectTimer = null
    }
  }

  disconnect() {
    this._stopped = true
    this._clearReconnectTimer()
    if (this._ws) {
      const old = this._ws
      old.onclose = null
      old.onerror = null
      old.close()
      this._ws = null
    }
    this._ready = false
    this._queue = []
  }

  send(cs, cmd, payload = {}) {
    const msg = JSON.stringify({ cs, cmd, payload })
    if (this._ready) {
      logWs('send', cs, cmd, payload)
      this._ws.send(msg)
    } else {
      logWarn('WorkerSocket', 'not ready, queuing', cs, cmd)
      this._queue.push(msg)
    }
  }

  on(cs, cmd, fn) {
    const key = `${cs}:${cmd}`
    if (!this._handlers[key]) this._handlers[key] = []
    this._handlers[key].push(fn)
    return () => this.off(cs, cmd, fn)
  }

  off(cs, cmd, fn) {
    const key = `${cs}:${cmd}`
    if (!this._handlers[key]) return
    this._handlers[key] = this._handlers[key].filter(h => h !== fn)
  }

  get connected() {
    return this._ws?.readyState === WebSocket.OPEN
  }
}

// Singleton — one connection per project session
export default new WorkerSocket()
