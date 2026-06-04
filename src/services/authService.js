import axios from 'axios'
import { ref } from 'vue'
import { isControlMode } from './mode'

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

function decodeJwtPayload(token) {
  try {
    const part = token.split('.')[1]
    if (!part) return null
    const base64 = part.replace(/-/g, '+').replace(/_/g, '/')
    const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=')
    return JSON.parse(atob(padded))
  } catch {
    return null
  }
}

function tokenIsExpired(token) {
  const payload = decodeJwtPayload(token)
  if (!payload || typeof payload.exp !== 'number') return true
  const now = Math.floor(Date.now() / 1000)
  return payload.exp <= now
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

async function exchangeWorkspaceToken(controlToken) {
  const response = await api.post('/login', {}, {
    headers: { Authorization: `Bearer ${controlToken}` },
  })

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
        return { user, token }
      }

      // Workspace mode: first authenticate against control-plane, then
      // exchange the control token for a workspace token.
      const controlLogin = localStorage.getItem('control_auth_token')
      let controlToken = controlLogin
      let controlUser = readStoredUser()
      if (!controlToken) {
        const response = await loginControl(email, password)
        controlToken = response.token
        controlUser = response.user
        localStorage.setItem('control_auth_token', controlToken)
        localStorage.setItem('control_user', JSON.stringify(controlUser))
      }

      const exchange = await exchangeWorkspaceToken(controlToken)
      const { user, token } = exchange
      this.currentUser = user
      this.token = token
      localStorage.setItem(TOKEN_KEY, token)
      localStorage.setItem(USER_KEY, JSON.stringify(user))
      api.defaults.headers.common['Authorization'] = `Bearer ${token}`

      return { user, token, controlUser }
    } catch (error) {
      throw new Error(error.response?.data?.message || 'Login failed')
    }
  },

  logout() {
    this.currentUser = null
    this.token = null
    localStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem(USER_KEY)
    delete api.defaults.headers.common['Authorization']
  },

  userId() {
    const token = localStorage.getItem(TOKEN_KEY)
    if (!token) return null
    try {
      const payload = JSON.parse(atob(token.split('.')[1]))
      return payload.sub || payload.user
    } catch { return null }
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
          if (this.currentUser) return true
          // Token with missing user state should be treated as stale.
          this.logout()
        }
      }

      if (!isControlMode) {
        const controlToken = localStorage.getItem('control_auth_token')
        if (controlToken && !tokenIsExpired(controlToken)) {
          try {
            const exchange = await exchangeWorkspaceToken(controlToken)
            this.currentUser = exchange.user
            this.token = exchange.token
            localStorage.setItem(TOKEN_KEY, exchange.token)
            localStorage.setItem(USER_KEY, JSON.stringify(exchange.user))
            api.defaults.headers.common['Authorization'] = `Bearer ${exchange.token}`
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

  // Silently mint a fresh workspace bearer by re-exchanging the still-valid
  // control token. Returns true on success. In control mode the control token
  // IS the bearer, so there is nothing to refresh — only a fresh login helps.
  async refresh() {
    if (isControlMode) return false
    if (this._refreshPromise) return this._refreshPromise
    this._refreshPromise = (async () => {
      const controlToken = localStorage.getItem('control_auth_token')
      if (!controlToken || tokenIsExpired(controlToken)) return false
      try {
        const exchange = await exchangeWorkspaceToken(controlToken)
        this.currentUser = exchange.user
        this.token = exchange.token
        localStorage.setItem(TOKEN_KEY, exchange.token)
        localStorage.setItem(USER_KEY, JSON.stringify(exchange.user))
        api.defaults.headers.common['Authorization'] = `Bearer ${exchange.token}`
        this.sessionExpired.value = false
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
}

// 401 interceptor: a single expired-bearer response should not silently break
// the app. Attempt one in-place refresh (re-exchange the control token) and
// replay the request; if that fails, the upstream session is truly gone —
// flag it so the UI can prompt re-authentication. The exchange endpoint itself
// (/login) is exempt to avoid recursion.
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

export default authService
