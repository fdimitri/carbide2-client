// Identity visualizer: flatten FileEvents and nest identity_at.entries.
// A FileNode UUID is identity; path is location. A move is the same id at a
// new path (ghost at the old one) — never a create+delete pair.

import { stripTreePath, treeBasename, treeParentPath } from './fileTree.js'

export function chipId(id) {
  return String(id || '').replace(/-/g, '').slice(0, 8)
}

export function eventKindLabel(kind) {
  if (kind === 'renamed') return 'moved'
  return kind || ''
}

export function isFolderType(ftype) {
  return ftype === 'folder' || ftype === 'dir'
}

function pathPrefix(parent, child) {
  const a = stripTreePath(parent)
  const b = stripTreePath(child)
  if (!a) return true
  return b === a || b.startsWith(`${a}/`)
}

// The folder being moved is the from_path that prefixes the others.
export function folderMoveRoot(events) {
  const list = events || []
  if (!list.length) return null
  return list.reduce((best, e) => {
    const a = best.from_path || ''
    const b = e.from_path || ''
    if (pathPrefix(a, b)) return best
    if (pathPrefix(b, a)) return e
    return stripTreePath(a).length <= stripTreePath(b).length ? best : e
  })
}

// Group FileEvents at one seq. Several `renamed` rows are one folder move.
export function collapseEvents(events) {
  const list = Array.isArray(events) ? events : []
  const renamed = list.filter((e) => e.kind === 'renamed')
  const collapse = renamed.length > 1
  const out = []
  let emittedGroup = false
  for (const e of list) {
    if (e.kind === 'renamed' && collapse) {
      if (!emittedGroup) {
        const root = folderMoveRoot(renamed)
        out.push({
          kind: 'renamed',
          path: root.path,
          from_path: root.from_path,
          file_node_id: root.file_node_id,
          ftype: root.ftype,
          count: renamed.length,
          children: renamed,
        })
        emittedGroup = true
      }
      continue
    }
    out.push({
      kind: e.kind,
      path: e.path,
      from_path: e.from_path,
      file_node_id: e.file_node_id,
      ftype: e.ftype,
      count: 1,
      children: null,
    })
  }
  return out
}

export function eventLine(row) {
  const kind = eventKindLabel(row.kind)
  if (row.kind === 'renamed') {
    const core = `${row.from_path || ''} → ${row.path || ''}`
    if (row.count > 1) return { kind, text: `${core} · ${row.count} paths` }
    return { kind, text: core }
  }
  return { kind, text: row.path || '' }
}

export function indexEntriesById(entries) {
  const m = Object.create(null)
  for (const e of entries || []) {
    if (e?.id) m[e.id] = e
  }
  return m
}

// Ghosts: id in prev, gone from current (deleted) OR still present at a new
// path (moved away). Live rows stay at the current path. Same UUID is never
// split into a synthetic create+delete.
export function ghostEntries(entries, prevById) {
  const current = new Map((entries || []).map((e) => [e.id, e]))
  const ghosts = []
  for (const [id, prev] of Object.entries(prevById || {})) {
    if (!prev) continue
    const now = current.get(id)
    if (!now) {
      ghosts.push({ ...prev, ghost: true })
      continue
    }
    if (stripTreePath(now.path) !== stripTreePath(prev.path)) {
      ghosts.push({ ...prev, ghost: true })
    }
  }
  return ghosts
}

function sortRows(rows) {
  return rows.slice().sort((a, b) => {
    if (a.ghost !== b.ghost) return a.ghost ? 1 : -1
    return String(a.id || '').localeCompare(String(b.id || ''))
  })
}

function sortChildNorms(norms, atPath) {
  return norms.slice().sort((a, b) => {
    const aItems = atPath.get(a) || []
    const bItems = atPath.get(b) || []
    const aDir = aItems.some((i) => isFolderType(i.ftype)) ? 0 : 1
    const bDir = bItems.some((i) => isFolderType(i.ftype)) ? 0 : 1
    if (aDir !== bDir) return aDir - bDir
    return treeBasename(a).toLowerCase().localeCompare(treeBasename(b).toLowerCase())
  })
}

// Nested indented rows from flat entries + ghosts at previous paths.
export function identityRows(entries, prevById) {
  const items = [
    ...(entries || []).map((e) => ({ ...e, ghost: false })),
    ...ghostEntries(entries, prevById),
  ]
  const atPath = new Map()
  for (const item of items) {
    const norm = stripTreePath(item.path)
    if (!norm) continue
    if (!atPath.has(norm)) atPath.set(norm, [])
    atPath.get(norm).push({ ...item, name: treeBasename(item.path), norm })
  }
  const childrenOf = new Map()
  for (const norm of atPath.keys()) {
    const parent = treeParentPath(norm)
    if (!childrenOf.has(parent)) childrenOf.set(parent, [])
    childrenOf.get(parent).push(norm)
  }
  const out = []
  function walk(parent, depth) {
    const childNorms = sortChildNorms([...new Set(childrenOf.get(parent) || [])], atPath)
    for (const norm of childNorms) {
      for (const row of sortRows(atPath.get(norm) || [])) {
        out.push({
          key: `${row.ghost ? 'g' : 'l'}:${row.id || norm}:${norm}`,
          id: row.id,
          path: row.path,
          name: row.name,
          ftype: row.ftype,
          ghost: !!row.ghost,
          depth,
        })
      }
      walk(norm, depth + 1)
    }
  }
  walk('', 0)
  return out
}

function stampBranch(seg) {
  const branch = seg?.branch
  const ticks = (seg?.ticks || []).map((t) => ({ ...t, branch }))
  const marks = (seg?.marks || []).map((m) => ({ ...m, branch }))
  return { branch, ticks, marks }
}

function fallbackSegments(axis) {
  if (Array.isArray(axis?.segments) && axis.segments.length) return axis.segments
  if (Array.isArray(axis?.ticks) || Array.isArray(axis?.marks)) {
    return [{ branch: axis.branch, ticks: axis.ticks || [], marks: axis.marks || [] }]
  }
  return []
}

function lastSegment(segments, asked) {
  if (!segments.length) return []
  if (asked) {
    for (let i = segments.length - 1; i >= 0; i--) {
      if (segments[i].branch === asked) return [segments[i]]
    }
  }
  return [segments[segments.length - 1]]
}

// Slider index for a mark or identity_at: the tick at `(seq, branch)`, else
// the last tick whose seq is ≤ that clock (snapshot marks sit between
// running nodes).
export function tickIndexFor(ticks, seq, branch) {
  const list = ticks || []
  const s = Number(seq)
  if (!list.length || Number.isNaN(s)) return 0
  let exact = -1
  let last = -1
  for (let i = 0; i < list.length; i++) {
    const t = list[i]
    const ts = Number(t.seq)
    if (ts <= s) last = i
    if (ts === s && (!branch || t.branch === branch)) exact = i
  }
  if (exact >= 0) return exact
  return last >= 0 ? last : 0
}

// Auto-play dwell after identity_at lands so the tree and ghosts are visible.
export const PLAY_DWELL_MS = 500
// Give up if identity_at never comes back (worker stall / dropped frame).
export const PLAY_STALL_MS = 8000

// Next slider index for auto-play. `dir` is +1 (forward) or -1 (reverse).
// null means the run is over (start or end of the timeline).
export function playNextIndex(index, count, dir) {
  const n = Number(index) + Number(dir)
  const len = Number(count)
  if (!(len > 0) || !dir || Number.isNaN(n)) return null
  if (n < 0 || n >= len) return null
  return n
}

// Index to start from when Play is pressed. At the last tick, forward
// restarts at 0; at the first tick, reverse restarts at the end — otherwise
// the button would no-op.
export function playStartIndex(index, count, dir) {
  const i = Number(index)
  const len = Number(count)
  if (len < 2 || !dir || Number.isNaN(i)) return null
  if (dir > 0 && i >= len - 1) return 0
  if (dir < 0 && i <= 0) return len - 1
  return Math.min(Math.max(i, 0), len - 1)
}

// `includeAncestry` is all first-parent segments; otherwise the last segment
// (the branch the axis was asked about).
export function visibleAxis(axis, includeAncestry) {
  const segments = fallbackSegments(axis)
  const chosen = includeAncestry ? segments : lastSegment(segments, axis?.branch)
  const stamped = chosen.map(stampBranch)
  return {
    ticks: stamped.flatMap((s) => s.ticks),
    marks: stamped.flatMap((s) => s.marks),
    segments: stamped,
  }
}
