import axios from 'axios'
import { isControlMode } from './mode'

// API URL is relative to the page origin and the deployed base path
// (import.meta.env.BASE_URL is set by Vite from VITE_BASE — '/' in plain
// local dev, '/w/<projectId>/' when this client is mounted behind the
// workspace ingress). This lets the same build work both as a standalone
// SPA on :5173 and as the in-pod client served under /w/<id>/.
//
// In control mode the dashboard is served from carbide2-control Rails at
// the root, and the Rails API is mounted at /api regardless of where the
// SPA was loaded from, so don't prefix BASE_URL.
const getApiUrl = () => {
  if (isControlMode) {
    return `${window.location.origin}/api`
  }
  const base = import.meta.env.BASE_URL || '/'
  return `${window.location.origin}${base}api`
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
