// Deterministic avatar colour + initials. A given id always maps to the same
// colour across sessions, so the same user/agent reads consistently everywhere.

const AVATAR_COLORS = [
  '#5ab0ff', '#a6e3a1', '#f9e2af', '#f38ba8', '#cba6f7',
  '#94e2d5', '#fab387', '#89b4fa', '#f5c2e7', '#74c7ec',
]

export function avatarColor(id) {
  const key = String(id ?? '')
  let hash = 0
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) | 0
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length]
}

export function initials(name) {
  const parts = String(name || '?').trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

export function useAvatar() {
  return { avatarColor, initials }
}
