// recordingService — REST wrappers for terminal recording (asciinema cast)
// management. Lists, downloads, and deletes are owned by the Rails app;
// start/stop are issued through the worker WS (see useTerminals.js).
import authService from './authService'

export async function listRecordings(projectId) {
  const res = await authService.api.get(`projects/${projectId}/recordings`)
  return res.data
}

export async function deleteRecording(projectId, recordingId) {
  await authService.api.delete(`projects/${projectId}/recordings/${recordingId}`)
}

// Returns the parsed asciinema cast as { header, frames }. header is the
// first JSON line ({version,width,height,timestamp,...}); frames is an
// array of [elapsed_s, channel, data] tuples (channel is "o" for output).
export async function fetchRecordingCast(projectId, recordingId) {
  const res = await authService.api.get(
    `projects/${projectId}/recordings/${recordingId}/cast`,
    { responseType: 'text', transformResponse: [(d) => d] }
  )
  const text = typeof res.data === 'string' ? res.data : ''
  const lines = text.split('\n').filter((l) => l.length > 0)
  if (lines.length === 0) return { header: null, frames: [] }
  let header = null
  try { header = JSON.parse(lines[0]) } catch { header = null }
  const frames = []
  for (let i = 1; i < lines.length; i++) {
    try {
      const f = JSON.parse(lines[i])
      if (Array.isArray(f) && f.length >= 3) frames.push(f)
    } catch { /* skip malformed line */ }
  }
  return { header, frames }
}

// URL for an <a download> link / inline asciinema-player <source> tag.
// Returns the path; caller composes with auth headers as needed.
export function recordingCastUrl(projectId, recordingId) {
  return `projects/${projectId}/recordings/${recordingId}/cast`
}
