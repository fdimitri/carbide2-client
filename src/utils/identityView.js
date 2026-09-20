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
