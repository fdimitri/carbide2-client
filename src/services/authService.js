import axios from 'axios'
import { ref } from 'vue'
import { isControlMode } from './mode'
import { mintWorkspaceToken, tokenExpirySeconds, tokenTtlSeconds } from './workspaceToken'

// Per-pod token isolation.
//
// Every workspace pod is served from the SAME browser origin
// (e.g. localhost:8080) but under a different base path (/w/8/, /w/7/ …).
// localStorage is scoped to the ORIGIN, not the path, so a single shared
// key would let a JWT minted by pod A be replayed against pod B. Each pod
// has its OWN database with its OWN user ids, so pod B's
// `User.find(token.sub)` then fails and every /api/* call errors out,
// leaving an empty dashboard. Scope the stored workspace token + user to
// the workspace's base path so each pod keeps its own credentials.
function workspaceScope() {
  let base = '/'
  if (typeof document !== 'undefined') {
    const baseHref = document.querySelector('base')?.getAttribute('href')
    if (baseHref) base = new URL(baseHref, window.location.origin).pathname
  }
  if (base === '/') base = import.meta.env.BASE_URL || '/'
  return base.endsWith('/') ? base : `${base}/`
}

const WS_SCOPE = isControlMode ? '' : workspaceScope()
const TOKEN_KEY = isControlMode ? 'control_auth_token' : `workspace_auth_token:${WS_SCOPE}`
const USER_KEY = isControlMode ? 'control_user' : `workspace_user:${WS_SCOPE}`

// API URL is relative to the page origin and the deployed base path.
// Prefer <base href> (injected server-side from X-Forwarded-Prefix when
// the SPA is mounted under /w/<id>/), then fall back to Vite's BASE_URL
// for plain local dev. document.baseURI is the resolved absolute URL,
// so `${baseURI}api` produces e.g. http://host/w/2/api in workspace mode
// or http://localhost:5173/api in `npm run dev`.
//
// In control mode the API is always at /api at origin root regardless of
// where the SPA was loaded from.
const getApiUrl = () => {
  if (isControlMode) {
    return `${window.location.origin}/api`
  }
  if (typeof document !== 'undefined') {
    const baseHref = document.querySelector('base')?.getAttribute('href')
    if (baseHref) {
      // document.baseURI resolves <base href> against the current location.
      return new URL('api', document.baseURI).toString()
    }
  }
  const base = import.meta.env.BASE_URL || '/'
  return `${window.location.origin}${base.endsWith('/') ? base : base + '/'}api`
}

const API_URL = getApiUrl()

const api = axios.create({
  baseURL: API_URL,
  withCredentials: true,
})

function readStoredUser() {
  const raw = localStorage.getItem(USER_KEY)
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

function tokenIsExpired(token) {
  const exp = tokenExpirySeconds(token)
  if (!exp) return true
  const now = Math.floor(Date.now() / 1000)
  return exp <= now
}

function readControlUser() {
  const raw = localStorage.getItem('control_user')
  if (!raw) return null
  try { return JSON.parse(raw) } catch { return null }
}

function controlApiUrl(path) {
  return `${window.location.origin}${path}`
}

async function loginControl(email, password) {
  const response = await axios.post(controlApiUrl('/api/login'), {
    user: { email, password },
  }, { withCredentials: true })

  return response.data
}

const authService = {
  api,
  currentUser: readStoredUser(),
  token: localStorage.getItem(TOKEN_KEY),
  readyPromise: null,
  // Reactive: set true when the upstream session is truly gone (silent refresh
  // failed). The app watches this to show the "session expired" overlay.
  sessionExpired: ref(false),
  // Guards against several concurrent 401s all kicking off their own refresh.
  _refreshPromise: null,
  // Timer that proactively re-mints workspace:api at TTL*0.2 remaining.
  _refreshTimer: null,
  // Timer that proactively renews the control login token at TTL*0.2 remaining
  // (ADR-015 sliding renewal; the server enforces the 7-day absolute ceiling).
  _controlRenewTimer: null,
  // Guards against concurrent renew calls.
  _controlRenewPromise: null,
  // The LOCAL workspace user id (users.id), fetched from /api/v1/server/me.
  // This is the value every *.user_id in the pod uses, NOT the token's user_id.
  localUserId: ref(null),
  // Reactive expiry (ms epoch) of the current workspace bearer and the control
  // login token, for display in the UI. null = unknown/no token.
  tokenExpiryMs: ref(null),
  controlTokenExpiryMs: ref(null),

  get isAuthenticated() {
    return !!this.token && !!this.currentUser
  },

  async login(email, password) {
    try {
      if (isControlMode) {
        const response = await loginControl(email, password)
        const { user, token } = response
        this.currentUser = user
        this.token = token
        localStorage.setItem(TOKEN_KEY, token)
        localStorage.setItem(USER_KEY, JSON.stringify(user))
        api.defaults.headers.common['Authorization'] = `Bearer ${token}`
        this._refreshExpiryDisplay()
        this._scheduleControlRenew(token)
        return { user, token }
      }

      // Workspace mode: authenticate against control, then mint a workspace:api
      // token from control (ADR-023). The control user becomes currentUser.
      const controlLogin = localStorage.getItem('control_auth_token')
      let controlToken = controlLogin
      let controlUser = readStoredUser()
      if (!controlToken || tokenIsExpired(controlToken)) {
        const response = await loginControl(email, password)
        controlToken = response.token
        controlUser = response.user
        localStorage.setItem('control_auth_token', controlToken)
        localStorage.setItem('control_user', JSON.stringify(controlUser))
      }
      this._scheduleControlRenew(controlToken)

      const token = await mintWorkspaceToken('workspace:api')
      const user = controlUser || { email: email }
      this.currentUser = user
      this.token = token
      localStorage.setItem(TOKEN_KEY, token)
      localStorage.setItem(USER_KEY, JSON.stringify(user))
      api.defaults.headers.common['Authorization'] = `Bearer ${token}`
      this._refreshExpiryDisplay()
      this._scheduleRefresh(token)
      this.fetchMe()

      return { user, token, controlUser }
    } catch (error) {
      throw new Error(error.response?.data?.message || 'Login failed')
    }
  },

  logout() {
    this._clearRefreshTimer()
    this._clearControlRenewTimer()
    this.currentUser = null
    this.token = null
    this.tokenExpiryMs.value = null
    this.controlTokenExpiryMs.value = null
    localStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem(USER_KEY)
    localStorage.removeItem('control_auth_token')
    localStorage.removeItem('control_user')
    delete api.defaults.headers.common['Authorization']
  },

  // Fetch the LOCAL user id for this workspace from /api/v1/server/me.
  // This is the id the workspace's *.user_id columns use; it is unrelated to
  // the control-plane id in the token.
  async fetchMe() {
    if (isControlMode) return
    try {
      const res = await this.api.get('v1/server/me')
      if (typeof res.data?.user_id === 'number' || typeof res.data?.user_id === 'string') {
        this.localUserId.value = res.data.user_id
      }
    } catch {
      // Keep the last-known id; the socket's system/connected will reconcile.
    }
  },

  userId() {
    return this.localUserId.value
  },

  async checkAuth() {
    if (this.readyPromise) return this.readyPromise

    this.readyPromise = (async () => {
      const token = localStorage.getItem(TOKEN_KEY)
      if (token) {
        if (tokenIsExpired(token)) {
          localStorage.removeItem(TOKEN_KEY)
          localStorage.removeItem(USER_KEY)
        } else {
          this.token = token
          this.currentUser = readStoredUser()
          api.defaults.headers.common['Authorization'] = `Bearer ${token}`
          this._refreshExpiryDisplay()
          if (this.currentUser) {
            if (isControlMode) this._renewControlIfNeeded(token)
            return true
          }
          // Token with missing user state should be treated as stale.
          this.logout()
        }
      }

      if (!isControlMode) {
        const controlToken = localStorage.getItem('control_auth_token')
        if (controlToken && !tokenIsExpired(controlToken)) {
          try {
            this._renewControlIfNeeded(controlToken)
            const token = await mintWorkspaceToken('workspace:api')
            this.token = token
            localStorage.setItem(TOKEN_KEY, token)
            // The workspace "user" is just the control user mirror (id+email).
            this.currentUser = readStoredUser() || readControlUser()
            api.defaults.headers.common['Authorization'] = `Bearer ${token}`
            this._scheduleRefresh(token)
            this._refreshExpiryDisplay()
            this.fetchMe()
            return true
          } catch {
            this.logout()
            return false
          }
        }

        if (controlToken && tokenIsExpired(controlToken)) {
          localStorage.removeItem('control_auth_token')
          localStorage.removeItem('control_user')
        }
      }

      return false
    })()

    try {
      return await this.readyPromise
    } finally {
      this.readyPromise = null
    }
  },

  // Arm a timer that re-mints workspace:api when 80% of its lifetime has
  // elapsed (lead = TTL * 0.2), so the REST bearer never actually lapses and
  // a 401 round-trip never happens in the steady state.
  _scheduleRefresh(token) {
    this._clearRefreshTimer()
    const ttl = tokenTtlSeconds(token)
    const exp = tokenExpirySeconds(token)
    if (!ttl || !exp) return
    const leadMs = ttl * 0.2 * 1000
    const delayMs = Math.max(0, (exp * 1000 - leadMs) - Date.now())
    this._refreshTimer = setTimeout(() => { this.refresh() }, delayMs)
  },

  _clearRefreshTimer() {
    if (this._refreshTimer != null) {
      clearTimeout(this._refreshTimer)
      this._refreshTimer = null
    }
  },

  // Silently mint a fresh workspace:api token (ADR-023). Returns true on
  // success. In control mode the control token IS the bearer, so there is
  // nothing to refresh — only a fresh login helps.
  async refresh() {
    if (isControlMode) return false
    if (this._refreshPromise) return this._refreshPromise
    this._refreshPromise = (async () => {
      const controlToken = localStorage.getItem('control_auth_token')
      if (!controlToken || tokenIsExpired(controlToken)) return false
      try {
        const token = await mintWorkspaceToken('workspace:api')
        this.token = token
        localStorage.setItem(TOKEN_KEY, token)
        api.defaults.headers.common['Authorization'] = `Bearer ${token}`
        this.sessionExpired.value = false
        this._scheduleRefresh(token)
        this._refreshExpiryDisplay()
        return true
      } catch {
        return false
      }
    })()
    try {
      return await this._refreshPromise
    } finally {
      this._refreshPromise = null
    }
  },

  // ── Control login-token renewal (ADR-015) ───────────────────────────────
  // Renew the control login token in place (no password). The server re-signs
  // with a fresh exp and preserves auth_time, rejecting once now-auth_time
  // exceeds the session ceiling. In workspace mode this is re-keyed downward:
  // a fresh control token re-mints workspace:api (worker reauth mints its own
  // workspace:rw on its own timer).
  async renewControl() {
    if (this._controlRenewPromise) return this._controlRenewPromise
    this._controlRenewPromise = (async () => {
      const controlToken = localStorage.getItem('control_auth_token')
      if (!controlToken) return false
      try {
        const res = await axios.post(controlApiUrl('/api/v1/control/renew'), {}, {
          headers: { Authorization: `Bearer ${controlToken}` },
          withCredentials: true
        })
        const newToken = res.data.token
        localStorage.setItem('control_auth_token', newToken)
        this._scheduleControlRenew(newToken)
        this._refreshExpiryDisplay()

        if (isControlMode) {
          this.token = newToken
          api.defaults.headers.common['Authorization'] = `Bearer ${newToken}`
        } else {
          await this.refresh()   // re-key: re-mint workspace:api from the new control token
        }
        return true
      } catch (e) {
        if (e?.response?.status === 401) {
          // Ceiling reached or token expired — needs a full login.
          this.sessionExpired.value = true
        }
        return false
      }
    })()
    try {
      return await this._controlRenewPromise
    } finally {
      this._controlRenewPromise = null
    }
  },

  _scheduleControlRenew(token) {
    this._clearControlRenewTimer()
    const ttl = tokenTtlSeconds(token)
    const exp = tokenExpirySeconds(token)
    if (!ttl || !exp) return
    const leadMs = ttl * 0.2 * 1000
    const delayMs = Math.max(0, (exp * 1000 - leadMs) - Date.now())
    this._controlRenewTimer = setTimeout(() => { this.renewControl() }, delayMs)
  },

  // Renew now if the token is still valid but already inside its renew window
  // (past exp - ttl*0.2). This covers a tab that was closed/backgrounded when
  // the one-shot timer would have fired: on load we renew immediately rather
  // than waiting ~19h again. An already-expired token cannot be renewed (the
  // endpoint rejects it), so that falls through to full login.
  _renewControlIfNeeded(token) {
    const ttl = tokenTtlSeconds(token)
    const exp = tokenExpirySeconds(token)
    if (!ttl || !exp) return
    const now = Math.floor(Date.now() / 1000)
    if (now >= exp - ttl * 0.2 && now < exp) {
      this.renewControl()
    } else {
      this._scheduleControlRenew(token)
    }
  },

  _clearControlRenewTimer() {
    if (this._controlRenewTimer != null) {
      clearTimeout(this._controlRenewTimer)
      this._controlRenewTimer = null
    }
  },

  // Update the reactive expiry refs from a freshly stored token.
  _refreshExpiryDisplay() {
    const control = localStorage.getItem('control_auth_token')
    const workspace = localStorage.getItem(TOKEN_KEY)
    this.controlTokenExpiryMs.value = control
      ? (tokenExpirySeconds(control) ?? 0) * 1000 : null
    this.tokenExpiryMs.value = workspace
      ? (tokenExpirySeconds(workspace) ?? 0) * 1000 : null
  },
}

// 401 interceptor: a single expired-bearer response should not silently break
// the app. Attempt one in-place mint of a fresh workspace:api token and replay;
// if that fails, the upstream session is truly gone — flag it so the UI can
// prompt re-authentication.
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const original = error.config
    const status = error.response?.status
    const isLoginCall = original?.url?.includes('/login')
    if (status === 401 && original && !original._retried && !isLoginCall) {
      original._retried = true
      const ok = await authService.refresh()
      if (ok) {
        original.headers = original.headers || {}
        original.headers['Authorization'] = `Bearer ${authService.token}`
        return api(original)
      }
      authService.sessionExpired.value = true
    }
    return Promise.reject(error)
  },
)

// Restore token on page load
authService.checkAuth()

// Cross-window renew propagation (ADR-015): tokens live in shared localStorage.
// When ANOTHER window renews the control token, the `storage` event fires here
// (not in the window that wrote it); adopt the new token and re-key downward.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key !== 'control_auth_token' || !e.newValue) return
    if (isControlMode) {
      authService.token = e.newValue
      authService.api.defaults.headers.common['Authorization'] = `Bearer ${e.newValue}`
      authService._scheduleControlRenew(e.newValue)
      authService._refreshExpiryDisplay()
    } else {
      authService._scheduleControlRenew(e.newValue)
      authService.refresh()   // re-mint workspace:api from the new control token
    }
  })
}

export default authService
