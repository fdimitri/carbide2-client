// peakHours — evaluate an agent's configured peak-hour windows.
//
// Every value here is UTC. Windows are stored as UTC wall-clock (`HH:MM` +
// UTC weekday names) because local time is uninterpretable in a shared,
// multi-region database: a stored "09:00" has to mean one instant of the week
// no matter which worker or browser reads it. So the clock is read with the
// getUTC* accessors below and the weekday comparison uses getUTCDay — never
// `new Date()`'s local getters.
//
// Shape (see carbide2-server Agent::AddPeakHours):
//   [{ days: ['mon',…,'fri'], start: '09:00', end: '17:00' }]
// `days` empty/absent => every day. end < start => the window crosses UTC
// midnight and belongs to its start day (Fri 23:00–01:00 UTC covers Fri 23:00
// through Sat 01:00).

export const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']

const WEEKDAY_LABEL = {
  sun: 'Sun', mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat',
}

// 'HH:MM' -> minutes past UTC midnight, or null if malformed.
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
export function activePeakWindow(windows, now = new Date()) {
  const list = Array.isArray(windows) ? windows : []
  if (!list.length) return null

  const todayIdx = now.getUTCDay()
  const today = WEEKDAYS[todayIdx]
  const yesterday = WEEKDAYS[(todayIdx + 6) % 7]
  const mins = now.getUTCHours() * 60 + now.getUTCMinutes()

  for (const w of list) {
    const start = minutesOfDay(w?.start)
    const end = minutesOfDay(w?.end)
    if (start == null || end == null || start === end) continue
    const days = windowDays(w)

    if (start < end) {
      // Same-day window: [start, end) on the window's own day.
      if (days.includes(today) && mins >= start && mins < end) return w
    } else {
      // Crosses UTC midnight: [start, 24:00) on the start day, plus
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

// Compact human label for one window, e.g. "Mon–Fri 09:00–17:00 UTC".
// Consecutive days collapse to a range so a weekday window reads as one span.
// `label` names the zone the clock is expressed in — 'UTC' for stored values,
// or an IANA name when previewing an editor value in the user's own zone.
export function formatWindow(w, label = 'UTC') {
  const days = windowDays(w)
  const dlabel = days.length === 7 ? 'Every day' : compactDays(days)
  const s = w?.start || '?'
  const e = w?.end || '?'
  return `${dlabel} ${s}–${e} ${label}`
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
export function describeWindows(windows, label = 'UTC') {
  const list = Array.isArray(windows) ? windows : []
  return list.map((w) => formatWindow(w, label)).join('\n')
}

// ── Timezone editing helpers ────────────────────────────────────────────────
//
// Storage stays UTC (see the header). But a human edits in their own clock, so
// the editor may present times in any IANA zone, defaulting to the browser's.
// The conversion happens only at the UI edge:
//   local wall clock + zone --windowToUtc-->  stored UTC
//   stored UTC            --windowFromUtc--> local wall clock + zone
// Nothing local is ever persisted, and the display-side evaluators above
// (activePeakWindow/isPeakNow) keep reading the clock in UTC only.

// The browser's IANA zone, e.g. 'America/New_York'. 'UTC' if unavailable.
export function browserTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

// Selectable zones. Intl can enumerate them in modern engines; the fallback is
// deliberately short rather than silently wrong.
export function timeZoneList() {
  try {
    const list = Intl.supportedValuesOf?.('timeZone')
    if (Array.isArray(list) && list.length) return list
  } catch { /* older engine */ }
  return [
    'UTC', 'America/New_York', 'America/Chicago', 'America/Denver',
    'America/Los_Angeles', 'Europe/London', 'Europe/Berlin', 'Asia/Kolkata',
    'Asia/Tokyo', 'Australia/Sydney',
  ]
}

const _dtfCache = new Map()

// The wall-clock fields `tz` shows for a given instant.
function _wallFields(tz, date) {
  let dtf = _dtfCache.get(tz)
  if (!dtf) {
    dtf = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    })
    _dtfCache.set(tz, dtf)
  }
  const out = {}
  for (const p of dtf.formatToParts(date)) out[p.type] = p.value
  return {
    year: Number(out.year), month: Number(out.month), day: Number(out.day),
    hour: Number(out.hour), minute: Number(out.minute), second: Number(out.second),
  }
}

// Offset of `tz` at `date`, in ms east of UTC (e.g. -5h for New York in EST).
export function timeZoneOffsetMs(tz, date) {
  const p = _wallFields(tz, date)
  const asUTC = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)
  return asUTC - date.getTime()
}

// A wall-clock reading in `tz` -> the UTC instant it denotes. The offset is
// applied twice so a time near a DST transition resolves to the offset that is
// actually in effect at the resulting instant.
export function instantFromWallClock(tz, year, month, day, hour, minute) {
  const guess = Date.UTC(year, month - 1, day, hour, minute, 0, 0)
  const off1 = timeZoneOffsetMs(tz, new Date(guess))
  let ts = guess - off1
  const off2 = timeZoneOffsetMs(tz, new Date(ts))
  if (off2 !== off1) ts = guess - off2
  return new Date(ts)
}

// A UTC instant -> { day: 'mon', hhmm: 'HH:MM' } as read in `tz`.
export function wallClockInZone(tz, date) {
  const p = _wallFields(tz, date)
  const idx = new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay()
  return {
    day: WEEKDAYS[idx],
    hhmm: `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`,
  }
}

function _hhmm(totalMinutes) {
  const m = ((totalMinutes % 1440) + 1440) % 1440
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

// Window length in minutes; null when malformed or zero-length.
function _durationMinutes(w) {
  const s = minutesOfDay(w?.start)
  const e = minutesOfDay(w?.end)
  if (s == null || e == null || s === e) return null
  return ((e - s) + 1440) % 1440
}

// Concrete Y/M/D for each weekday in the week containing refDate (UTC-anchored
// Sunday). Only the week matters: it selects which DST offset is in effect, so
// using the current week keeps the stored UTC value right for this season.
function _referenceDates(refDate) {
  const base = new Date(Date.UTC(
    refDate.getUTCFullYear(), refDate.getUTCMonth(), refDate.getUTCDate()))
  base.setUTCDate(base.getUTCDate() - base.getUTCDay())
  const map = {}
  for (let i = 0; i < 7; i++) {
    const d = new Date(base.getTime())
    d.setUTCDate(base.getUTCDate() + i)
    map[WEEKDAYS[i]] = { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate() }
  }
  return map
}

// A window expressed in `tz` -> the UTC window(s) that denote the same instants.
// A window whose start and end land on different UTC days is re-anchored to its
// start day (duration is preserved), which is exactly how the stored shape
// encodes a midnight-crossing window. Returns [] for a malformed window.
export function windowToUtc(w, tz, refDate = new Date()) {
  return _convertWindow(w, tz, refDate, 'to-utc')
}

// The inverse: a stored UTC window -> the window to show in `tz`.
export function windowFromUtc(w, tz, refDate = new Date()) {
  return _convertWindow(w, tz, refDate, 'from-utc')
}

function _convertWindow(w, tz, refDate, direction) {
  const dur = _durationMinutes(w)
  if (dur == null) return []
  const days = windowDays(w)
  const startMin = minutesOfDay(w.start)
  const refs = _referenceDates(refDate)
  const out = []
  const seen = new Set()

  for (const day of days) {
    const r = refs[day]
    if (!r) continue

    let day2
    let hhmm
    if (direction === 'to-utc') {
      const inst = instantFromWallClock(tz, r.y, r.m, r.d,
        Math.floor(startMin / 60), startMin % 60)
      day2 = WEEKDAYS[inst.getUTCDay()]
      hhmm = _hhmm(inst.getUTCHours() * 60 + inst.getUTCMinutes())
    } else {
      const inst = new Date(Date.UTC(r.y, r.m - 1, r.d,
        Math.floor(startMin / 60), startMin % 60))
      const local = wallClockInZone(tz, inst)
      day2 = local.day
      hhmm = local.hhmm
    }

    const end = _hhmm(minutesOfDay(hhmm) + dur)
    const key = `${day2}|${hhmm}|${end}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ days: [day2], start: hhmm, end })
  }
  return _collapseAllDays(out)
}

// Seven identical days collapse back to a single `days: []` window (which both
// the server and windowDays read as "every day"), so an every-day rule stays
// one row instead of seven after a conversion.
function _collapseAllDays(windows) {
  const bySpan = new Map()
  for (const w of windows) {
    const key = `${w.start}|${w.end}`
    if (!bySpan.has(key)) bySpan.set(key, [])
    bySpan.get(key).push(w)
  }
  const out = []
  for (const [, group] of bySpan) {
    const days = new Set()
    for (const w of group) for (const d of w.days) days.add(d)
    if (days.size === 7) out.push({ days: [], start: group[0].start, end: group[0].end })
    else out.push(...group)
  }
  // Stable, weekday-ordered output.
  return out.sort((a, b) => {
    const da = a.days.length ? WEEKDAYS.indexOf(a.days[0]) : -1
    const db = b.days.length ? WEEKDAYS.indexOf(b.days[0]) : -1
    return da - db || a.start.localeCompare(b.start)
  })
}
