// peakHours — an agent's configured peak-hour windows, as entered.
//
// A window is ONE thing: the days it covers, its start/end times, and the
// timezone those times were entered in.
//
//   [{ days: ['mon',…,'fri'], start: '21:00', end: '00:00', tz: 'America/New_York' }]
//
// The zone is stored WITH the window and the wall-clock times are stored as
// typed. A recurring window is anchored to a local clock — "9pm New York" is
// 9pm New York in January and in July — so converting it to a fixed UTC instant
// would be wrong twice over: it would drift by an hour across a DST boundary,
// and it would throw away the clock the user actually meant. Wall clock + an
// explicit zone is unambiguous; wall clock alone would not be.
//
// `days` empty/absent => every day. end < start => the window crosses midnight
// and belongs to its start day (Fri 21:00–00:00 covers Fri 21:00–24:00).
// `tz` absent => 'UTC' (windows predating the zone field).

export const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']

export const DEFAULT_TZ = 'UTC'

const WEEKDAY_LABEL = {
  sun: 'Sun', mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat',
}

// The zone a window is expressed in.
export function windowTimeZone(w) {
  const tz = String(w?.tz ?? '').trim()
  return tz || DEFAULT_TZ
}

// 'HH:MM' -> minutes past local midnight, or null if malformed.
export function minutesOfDay(hhmm) {
  const m = /^(\d{2}):(\d{2})$/.exec(String(hhmm ?? '').trim())
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  if (h > 23 || min > 59) return null
  return h * 60 + min
}

// Days actually covered by a window, in sun..sat order. Empty input means
// "every day".
export function windowDays(w) {
  const raw = Array.isArray(w?.days) ? w.days : []
  const set = new Set(raw.map((d) => String(d).toLowerCase()))
  const picked = WEEKDAYS.filter((d) => set.has(d))
  return picked.length ? picked : [...WEEKDAYS]
}

// Is `now` inside any of the windows? Returns the matching window or null.
//
// Each window's zone is consulted independently: `now` is projected into that
// zone's wall clock, and the weekday/time comparison is done there. That is the
// whole of the timezone handling — no conversion of the stored window.
export function activePeakWindow(windows, now = new Date()) {
  const list = Array.isArray(windows) ? windows : []
  if (!list.length) return null

  for (const w of list) {
    const start = minutesOfDay(w?.start)
    const end = minutesOfDay(w?.end)
    if (start == null || end == null || start === end) continue

    const { dayIdx, mins } = wallClockOf(windowTimeZone(w), now)
    const today = WEEKDAYS[dayIdx]
    const yesterday = WEEKDAYS[(dayIdx + 6) % 7]
    const days = windowDays(w)

    if (start < end) {
      // Same-day window: [start, end) on the window's own day.
      if (days.includes(today) && mins >= start && mins < end) return w
    } else {
      // Crosses midnight: [start, 24:00) on the start day, plus
      // [00:00, end) on the following day.
      if (days.includes(today) && mins >= start) return w
      if (days.includes(yesterday) && mins < end) return w
    }
  }
  return null
}

export function isPeakNow(windows, now = new Date()) {
  return activePeakWindow(windows, now) != null
}

// Compact human label for one window, e.g. "Mon–Fri 21:00–00:00 America/New_York".
// Consecutive days collapse to a range so a weekday window reads as one span.
export function formatWindow(w) {
  const days = windowDays(w)
  const dlabel = days.length === 7 ? 'Every day' : compactDays(days)
  const s = w?.start || '?'
  const e = w?.end || '?'
  return `${dlabel} ${s}–${e} ${windowTimeZone(w)}`
}

// "Mon–Fri" when contiguous, else "Mon, Wed, Fri".
function compactDays(days) {
  const idx = days.map((d) => WEEKDAYS.indexOf(d)).sort((a, b) => a - b)
  const contiguous = idx.every((v, i) => i === 0 || v === idx[i - 1] + 1)
  if (contiguous && idx.length > 2) {
    return `${WEEKDAY_LABEL[WEEKDAYS[idx[0]]]}–${WEEKDAY_LABEL[WEEKDAYS[idx[idx.length - 1]]]}`
  }
  return days.map((d) => WEEKDAY_LABEL[d] || d).join(', ')
}

// All windows, one per line, for a tooltip.
export function describeWindows(windows) {
  const list = Array.isArray(windows) ? windows : []
  return list.map((w) => formatWindow(w)).join('\n')
}

// ── Timezone helpers ────────────────────────────────────────────────────────

// The browser's IANA zone, e.g. 'America/New_York'. 'UTC' if unavailable.
export function browserTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || DEFAULT_TZ
  } catch {
    return DEFAULT_TZ
  }
}

// SELECTABLE zones, for the picker only — never for validating a stored value.
//
// Intl enumerates CLDR's canonical zones, which omits the whole Etc/* alias
// namespace and 'UTC' itself, so UTC is prepended rather than assumed present.
// There is deliberately no hardcoded fallback list: a fabricated subset of the
// world's zones is not a fallback, it is a wrong answer that looks like one.
// If the platform cannot enumerate, offer the two things actually known.
export function timeZoneList() {
  const canonical = (() => {
    try {
      const list = Intl.supportedValuesOf?.('timeZone')
      if (Array.isArray(list) && list.length) return list
    } catch { /* no enumeration */ }
    return []
  })()

  if (!canonical.length) return [DEFAULT_TZ, browserTimeZone()]
  return [DEFAULT_TZ, ...canonical.filter((z) => z !== DEFAULT_TZ)]
}

const _dtfCache = new Map()

// { dayIdx, mins } — the wall-clock weekday and minute-of-day `tz` shows for a
// given instant. The weekday comes from the LOCAL date in `tz`, not the UTC
// date, so a window late in the evening in a negative-offset zone is judged
// against the day the user experienced.
function wallClockOf(tz, date) {
  let dtf = _dtfCache.get(tz)
  if (!dtf) {
    dtf = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit',
    })
    _dtfCache.set(tz, dtf)
  }
  const out = {}
  for (const p of dtf.formatToParts(date)) out[p.type] = p.value
  const dayIdx = new Date(Date.UTC(Number(out.year), Number(out.month) - 1, Number(out.day))).getUTCDay()
  return { dayIdx, mins: Number(out.hour) * 60 + Number(out.minute) }
}

// A UTC instant -> { day: 'mon', hhmm: 'HH:MM' } as read in `tz`.
export function wallClockInZone(tz, date) {
  const { dayIdx, mins } = wallClockOf(tz, date)
  const hhmm = `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`
  return { day: WEEKDAYS[dayIdx], hhmm }
}
