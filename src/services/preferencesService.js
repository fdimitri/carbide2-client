// User preferences API — GET and PATCH /api/preferences
import authService from './authService'

const { api } = authService

export async function getPreferences() {
  const res = await api.get('/preferences')
  return res.data
}

export async function updatePreferences(prefs) {
  const res = await api.patch('/preferences', prefs)
  return res.data
}
