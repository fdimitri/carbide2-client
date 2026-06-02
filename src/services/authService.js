import axios from 'axios'
import { isControlMode } from './mode'

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

const authService = {
  api,
  currentUser: null,
  token: localStorage.getItem('auth_token'),

  get isAuthenticated() {
    return !!this.token && !!this.currentUser
  },

  async login(email, password) {
    try {
      const response = await api.post('/login', {
        user: { email, password },
      })

      const { user, token } = response.data
      this.currentUser = user
      this.token = token
      localStorage.setItem('auth_token', token)
      api.defaults.headers.common['Authorization'] = `Bearer ${token}`

      return { user, token }
    } catch (error) {
      throw new Error(error.response?.data?.message || 'Login failed')
    }
  },

  logout() {
    this.currentUser = null
    this.token = null
    localStorage.removeItem('auth_token')
    delete api.defaults.headers.common['Authorization']
  },

  userId() {
    const token = localStorage.getItem('auth_token')
    if (!token) return null
    try {
      const payload = JSON.parse(atob(token.split('.')[1]))
      return payload.sub || payload.user
    } catch { return null }
  },

  async checkAuth() {
    const token = localStorage.getItem('auth_token')
    if (token) {
      this.token = token
      api.defaults.headers.common['Authorization'] = `Bearer ${token}`
      try {
        return true
      } catch {
        this.logout()
        return false
      }
    }
    return false
  },
}

// Restore token on page load
authService.checkAuth()

export default authService
