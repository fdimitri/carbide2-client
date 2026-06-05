// WorkerSocket — single WebSocket connection to the Carbide2 worker
// Protocol: { cs, cmd, payload }
// Usage: import workerSocket from './workerSocket'
//        workerSocket.connect(token)
//        workerSocket.on('term', 'output', handler)
//        workerSocket.send('chat', 'message', { text: 'hello' })
import { ref } from 'vue'
import { logWs, logInfo, logWarn } from './log'

// Worker WebSocket URL. Behind the workspace ingress the worker is reached
// at <base>/ws (Traefik routes /w/<id>/ws to the worker container's port).
// VITE_WORKER_URL still wins for standalone-dev pointing at a remote worker.
const getWorkerUrl = () => {
  if (import.meta.env.VITE_WORKER_URL) return import.meta.env.VITE_WORKER_URL
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  // Prefer <base href> (server-injected from X-Forwarded-Prefix) — it has
  // the real /w/<id>/ prefix even when the build used --base=./.
  if (typeof document !== 'undefined') {
    const baseHref = document.querySelector('base')?.getAttribute('href')
    if (baseHref) {
      const wsPath = baseHref.replace(/\/$/, '') + '/ws'
      return `${proto}//${window.location.host}${wsPath}`
    }
  }
  const base = (import.meta.env.BASE_URL || '/').replace(/\/$/, '')
  return `${proto}//${window.location.host}${base}/ws`
}

// ── Wire-protocol versioning ────────────────────────────────────────────────
// Compatibility is one integer per side plus a floor, not a SemVer range matrix:
//   PROTOCOL   — the wire protocol this build speaks. Bump on ANY wire change.
//   MIN_SERVER — the oldest worker PROTOCOL this build still tolerates. Bump
//                ONLY on a breaking change.
// Sent to the worker on the handshake URL (&proto=&min_server=); the worker
// advertises its own protocol/min_client in system/connected. We compare both
// floors and, for now, only WARN on a mismatch (advisory — still connect).
const PROTOCOL   = 1
const MIN_SERVER = 1

const RECONNECT_BASE_MS  = 1000
const RECONNECT_MAX_MS   = 30000
// Number of consecutive failed attempts before we consider the worker
// "offline" (a sustained outage). We never stop retrying — an IDE that gives
// up and silently strands the user is worse than one that keeps knocking.
const RECONNECT_OFFLINE_AFTER = 4

// Heartbeat: prove the socket is alive end-to-end (not just TCP-open) and
// measure round-trip latency for the status indicator.
const HEARTBEAT_MS = 10000
// Sliding window for the throughput readout in the status bar.
const RATE_WINDOW_MS = 30000
// Refresh the worker JWT in-band this long before it expires, so a long-lived
// session survives token rotation without ever dropping the socket.
const REAUTH_LEAD_MS = 90000

// True when a token-fetch rejection is an authentication failure (expired /
// revoked upstream session) rather than a transient network error. Auth
// failures must NOT trigger the blind reconnect loop — the app refreshes
// credentials or routes to login instead.
function isAuthError(e) {
  return e?.isAuthError === true ||
         e?.status === 401 ||
         e?.response?.status === 401
}

class WorkerSocket {
  constructor() {
    this._ws         = null
    this._handlers   = {}   // { "cs:cmd": [fn, ...] }
    this._ready      = false
    this._queue      = []
    this._generation = 0    // incremented on each connect() to ignore stale close events
    this._tokenFetcher = null // async () => token string
    this._reconnectAttempt = 0
    this._reconnectTimer   = null
    this._stopped    = false // true after explicit disconnect()

    // ── Reactive, app-wide connection telemetry (consumed by the status bar) ──
    // status: 'idle' (never connected / after disconnect) | 'connecting' |
    //         'connected' | 'reconnecting' | 'offline' (sustained outage) |
    //         'unauthorized' (auth failed — needs credential refresh / login).
    this.status      = ref('idle')
    this.latencyMs   = ref(null)   // last measured round-trip, ms
    this.rateIn      = ref(0)      // bytes/sec received, ~30s average
    this.rateOut     = ref(0)      // bytes/sec sent, ~30s average
    this.attempt     = ref(0)      // current reconnect attempt (0 when connected)
      // Set true when the worker's advertised wire protocol is incompatible
      // with ours (either floor crossed). Advisory only for now — the socket
      // still connects; UI can bind this to a banner. See PROTOCOL/MIN_SERVER.
      this.protocolMismatch = ref(false)
    this._heartbeatTimer = null
    this._rateTimer      = null
    this._inSamples      = []  // [{ t, n }]
    this._outSamples     = []  // [{ t, n }]
    this._tokenExpMs     = null // worker JWT expiry (ms), from system/connected
    this._reauthInFlight = false
  }

  // tokenFetcher: async () => string — called fresh on every (re)connect so the
  // name claim stays current and expired tokens are never reused.
  // Also accepts a plain string for backwards-compat.
  connect(tokenFetcher) {
    this._tokenFetcher = typeof tokenFetcher === 'function'
      ? tokenFetcher
      : () => Promise.resolve(tokenFetcher)
    this._stopped = false
    this._reconnectAttempt = 0
    this.attempt.value = 0
    this.status.value = 'connecting'
    this._startRateTimer()
    this._clearReconnectTimer()
    this._open()
  }

  async _open() {
    if (this._ws) {
      const old = this._ws
      old.onclose = null
      old.onerror = null
      old.close()
    }

    let token
    try {
      token = await this._tokenFetcher()
    } catch (e) {
      // Auth failure (expired/revoked upstream session) is unrecoverable by
      // retrying with the same credentials — surface it so the app can refresh
      // or route to login, and stop the blind reconnect loop.
      if (isAuthError(e)) {
        logWarn('WorkerSocket', 'token fetch unauthorized — needs re-auth')
        this.status.value = 'unauthorized'
        this._emitLocal('system', 'unauthorized', {})
        return
      }
      logWarn('WorkerSocket', 'failed to fetch token:', e)
      if (!this._stopped) this._scheduleReconnect()
      return
    }

    const gen = ++this._generation
      const url = `${getWorkerUrl()}/?token=${encodeURIComponent(token)}` +
        `&proto=${PROTOCOL}&min_server=${MIN_SERVER}`
    this._ws = new WebSocket(url)

    this._ws.onopen = () => {
      if (this._generation !== gen) return
      logInfo('WorkerSocket', 'connected')
      this._ready = true
      this._reconnectAttempt = 0
      this.attempt.value = 0
      this.status.value = 'connected'
      this._queue.forEach(m => { this._countOut(m); this._ws.send(m) })
      this._queue = []
      this._startHeartbeat()
      this._emitLocal('system', 'open', {})
    }

    this._ws.onmessage = (event) => {
      if (this._generation !== gen) return
      this._countIn(event.data)
      let msg
      try { msg = JSON.parse(event.data) } catch { return }
      // Heartbeat reply — measure round-trip and swallow (not an app event).
      if (msg.cs === 'system' && msg.cmd === 'pong') {
        if (msg.payload && typeof msg.payload.t === 'number') {
          this.latencyMs.value = Math.max(0, Date.now() - msg.payload.t)
        }
        return
      }
      // Capture token expiry so we can refresh in-band before it lapses.
      if (msg.cs === 'system' && msg.cmd === 'connected') {
        this._setTokenExp(msg.payload?.token_exp)
        this._checkProtocol(msg.payload)
      }
      // Reauth outcomes are workerSocket-internal — adopt the new expiry and
      // swallow them rather than leaking to app handlers.
      if (msg.cs === 'system' && msg.cmd === 'reauth_ok') {
        this._setTokenExp(msg.payload?.exp)
        this._reauthInFlight = false
        logInfo('WorkerSocket', 'reauth ok')
        return
      }
      if (msg.cs === 'system' && msg.cmd === 'reauth_failed') {
        this._reauthInFlight = false
        logWarn('WorkerSocket', 'reauth failed:', msg.payload?.message)
        return
      }
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
      this.latencyMs.value = null
      this._tokenExpMs = null
      this._reauthInFlight = false
      this._stopHeartbeat()
      if (!this._stopped) {
        this._emitLocal('system', 'disconnected', { code: e.code })
        this._scheduleReconnect()
      }
    }

    this._ws.onerror = (e) => {
      if (this._generation !== gen) return
      logWarn('WorkerSocket', 'error', e)
    }
  }

  _scheduleReconnect() {
    if (this._stopped) return
    const delay = Math.min(RECONNECT_BASE_MS * 2 ** this._reconnectAttempt, RECONNECT_MAX_MS)
    this._reconnectAttempt++
    this.attempt.value = this._reconnectAttempt
    // Surface a clear "offline" state once the outage is sustained, but keep
    // retrying forever at the capped interval rather than abandoning the user.
    this.status.value = this._reconnectAttempt >= RECONNECT_OFFLINE_AFTER
      ? 'offline'
      : 'reconnecting'
    logInfo('WorkerSocket', `reconnecting in ${delay}ms (attempt ${this._reconnectAttempt})`)
    this._reconnectTimer = setTimeout(() => {
      if (!this._stopped) this._open()
    }, delay)
  }

  // Force an immediate reconnect attempt (e.g. user clicked "Retry now").
  reconnectNow() {
    if (this._stopped || !this._tokenFetcher) return
    this._reconnectAttempt = 0
    this.attempt.value = 0
    this.status.value = 'connecting'
    this._clearReconnectTimer()
    this._open()
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
    this._stopHeartbeat()
    this._stopRateTimer()
    if (this._ws) {
      const old = this._ws
      old.onclose = null
      old.onerror = null
      old.close()
      this._ws = null
    }
    this._ready = false
    this._queue = []
    this.status.value = 'idle'
    this.latencyMs.value = null
    this.attempt.value = 0
    this.rateIn.value = 0
    this.rateOut.value = 0
    this._inSamples = []
    this._outSamples = []
    this._tokenExpMs = null
    this._reauthInFlight = false
  }

  send(cs, cmd, payload = {}) {
    const msg = JSON.stringify({ cs, cmd, payload })
    if (this._ready) {
      logWs('send', cs, cmd, payload)
      this._countOut(msg)
      this._ws.send(msg)
    } else {
      logWarn('WorkerSocket', 'not ready, queuing', cs, cmd)
      this._queue.push(msg)
    }
  }

  // ── Local (client-originated) lifecycle events ──────────────────────────────
  // Dispatched through the same handler map as server messages so app code can
  // react to open/close uniformly, e.g. workerSocket.on('system','disconnected')
  _emitLocal(cs, cmd, payload) {
    const handlers = this._handlers[`${cs}:${cmd}`] || []
    const wildcards = this._handlers[`${cs}:*`] || []
    ;[...handlers, ...wildcards].forEach(fn => fn(payload, { cs, cmd, payload }))
  }

  // ── Heartbeat ───────────────────────────────────────────────────────────────
  _startHeartbeat() {
    this._stopHeartbeat()
    const beat = () => {
      if (!this._ready) return
      this.send('system', 'ping', { t: Date.now() })
      this._maybeReauth()
    }
    beat()
    this._heartbeatTimer = setInterval(beat, HEARTBEAT_MS)
  }

  _stopHeartbeat() {
    if (this._heartbeatTimer !== null) {
      clearInterval(this._heartbeatTimer)
      this._heartbeatTimer = null
    }
  }

  // ── In-band token refresh ───────────────────────────────────────────────────
  _setTokenExp(expSeconds) {
    this._tokenExpMs = (typeof expSeconds === 'number') ? expSeconds * 1000 : null
  }

  // Compare the worker's advertised wire protocol against ours. A pre-versioning
  // worker omits these fields (treated as 0), so the floor check still runs.
  // Advisory for now: we only warn and flag — the socket stays connected.
  _checkProtocol(payload) {
    const serverProto     = Number(payload?.protocol) || 0
    const serverMinClient = Number(payload?.min_client) || 0
    const ok = PROTOCOL >= serverMinClient && serverProto >= MIN_SERVER
    this.protocolMismatch.value = !ok
    if (!ok) {
      logWarn('WorkerSocket',
        `wire-protocol mismatch: client(proto=${PROTOCOL} min_server=${MIN_SERVER}) ` +
        `server(proto=${serverProto} min_client=${serverMinClient}) — ` +
        'connected anyway; behaviour may be inconsistent. Reload after deploy completes.')
    }
  }

  // Mint a fresh worker JWT and present it over the live socket shortly before
  // the current one lapses, so the connection never has to drop for rotation.
  async _maybeReauth() {
    if (!this._ready || this._reauthInFlight || !this._tokenExpMs) return
    if (Date.now() < this._tokenExpMs - REAUTH_LEAD_MS) return
    this._reauthInFlight = true
    let token
    try {
      token = await this._tokenFetcher()
    } catch (e) {
      this._reauthInFlight = false
      // Upstream session is gone — let the app refresh credentials / re-login.
      // The worker's expiry sweep will close the socket if we never recover.
      if (isAuthError(e)) {
        logWarn('WorkerSocket', 'reauth token fetch unauthorized')
        this.status.value = 'unauthorized'
        this._emitLocal('system', 'unauthorized', {})
      } else {
        logWarn('WorkerSocket', 'reauth token fetch failed:', e)
      }
      return
    }
    if (this._ready) this.send('system', 'reauth', { token })
    else this._reauthInFlight = false
  }

  // ── Throughput sampling (~30s sliding average) ──────────────────────────────
  _countIn(data)  { this._inSamples.push({ t: Date.now(), n: this._sizeOf(data) }) }
  _countOut(data) { this._outSamples.push({ t: Date.now(), n: this._sizeOf(data) }) }

  _sizeOf(data) {
    if (typeof data === 'string') return data.length
    if (data && typeof data.byteLength === 'number') return data.byteLength
    return 0
  }

  _startRateTimer() {
    if (this._rateTimer !== null) return
    this._rateTimer = setInterval(() => this._recomputeRates(), 2000)
  }

  _stopRateTimer() {
    if (this._rateTimer !== null) {
      clearInterval(this._rateTimer)
      this._rateTimer = null
    }
  }

  _recomputeRates() {
    const cutoff = Date.now() - RATE_WINDOW_MS
    this._inSamples  = this._inSamples.filter(s => s.t >= cutoff)
    this._outSamples = this._outSamples.filter(s => s.t >= cutoff)
    const secs = RATE_WINDOW_MS / 1000
    this.rateIn.value  = this._inSamples.reduce((a, s) => a + s.n, 0) / secs
    this.rateOut.value = this._outSamples.reduce((a, s) => a + s.n, 0) / secs
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
