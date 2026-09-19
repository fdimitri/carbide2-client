// Explorer forest. Identity is FileNode UUID; path is location.
//
// fs/tree is the snapshot (connect, branch switch, import, merge, a bulk
// created at `/`). created / renamed / deleted patch that snapshot in place
// so a file create does not round-trip the whole tree.

export function stripTreePath(p) {
  return String(p || '').replace(/^\//, '')
}

export function treeBasename(p) {
  const s = stripTreePath(p)
  const i = s.lastIndexOf('/')
  return i === -1 ? s : s.slice(i + 1)
}

export function treeParentPath(p) {
  const s = stripTreePath(p)
  const i = s.lastIndexOf('/')
  return i === -1 ? '' : s.slice(0, i)
}

// Root create, git import, and the watcher's reconcile sweep are not a
// single node — the client asks for a snapshot.
export function isBulkTreeEvent(payload) {
  if (!payload) return true
  const path = stripTreePath(payload.path)
  if (!path) return true
  if (payload.reason === 'import_git') return true
  if (payload.source === 'inotify-reconcile') return true
  return false
}

function sortChildren(nodes) {
  return nodes.slice().sort((a, b) => {
    const ad = a.type === 'dir' ? 0 : 1
    const bd = b.type === 'dir' ? 0 : 1
    if (ad !== bd) return ad - bd
    return String(a.name).toLowerCase().localeCompare(String(b.name).toLowerCase())
  })
}

function asDir(type) {
  return type === 'folder' || type === 'dir'
}

function makeNode(payload) {
  const path = stripTreePath(payload.path)
  const dir = asDir(payload.type)
  const node = {
    id: payload.id || path,
    path,
    name: treeBasename(path),
    type: dir ? 'dir' : 'file',
  }
  if (dir) node.children = []
  return node
}

function upsert(nodes, node) {
  const idx = nodes.findIndex((n) => n.path === node.path || (node.id && String(n.id) === String(node.id)))
  if (idx === -1) return sortChildren([...nodes, node])
  const prev = nodes[idx]
  const nextNode = { ...prev, ...node, path: node.path, name: node.name, type: node.type, id: node.id || prev.id }
  if (nextNode.type === 'dir') nextNode.children = prev.children || node.children || []
  else delete nextNode.children
  const next = nodes.slice()
  next[idx] = nextNode
  return sortChildren(next)
}

function insertNode(nodes, node, at = '') {
  const parent = treeParentPath(node.path)
  if (parent === at) return upsert(nodes, node)
  const rest = at ? parent.slice(at.length + 1) : parent
  const nextSeg = rest.split('/')[0]
  const childPath = at ? `${at}/${nextSeg}` : nextSeg
  const idx = nodes.findIndex((n) => n.type === 'dir' && n.path === childPath)
  if (idx === -1) {
    const stub = { id: childPath, path: childPath, name: nextSeg, type: 'dir', children: [] }
    return insertNode(sortChildren([...nodes, stub]), node, at)
  }
  const dir = nodes[idx]
  const next = nodes.slice()
  next[idx] = { ...dir, children: insertNode(dir.children || [], node, childPath) }
  return next
}

function rewritePrefix(node, oldP, newP) {
  const p = node.path || ''
  if (p !== oldP && !p.startsWith(`${oldP}/`)) return node
  const path = `${newP}${p.slice(oldP.length)}`
  const next = { ...node, path, name: treeBasename(path) }
  if (next.children) next.children = next.children.map((c) => rewritePrefix(c, oldP, newP))
  return next
}

function mapNode(nodes, match, fn) {
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i]
    if (match(n)) {
      const next = nodes.slice()
      next[i] = fn(n)
      return next
    }
    if (n.type === 'dir' && n.children) {
      const ch = mapNode(n.children, match, fn)
      if (ch !== n.children) {
        const next = nodes.slice()
        next[i] = { ...n, children: ch }
        return next
      }
    }
  }
  return nodes
}

function removePath(nodes, want) {
  const idx = nodes.findIndex((n) => n.path === want)
  if (idx !== -1) {
    const next = nodes.slice()
    next.splice(idx, 1)
    return next
  }
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i]
    if (n.type !== 'dir' || !n.children || !(want === n.path || want.startsWith(`${n.path}/`))) continue
    const ch = removePath(n.children, want)
    if (ch === n.children) continue
    const next = nodes.slice()
    next[i] = { ...n, children: ch }
    return next
  }
  return nodes
}

export function findTreeNode(nodes, { id, path } = {}) {
  const wantPath = path != null ? stripTreePath(path) : ''
  const walk = (list) => {
    for (const n of list || []) {
      if (id != null && id !== '' && String(n.id) === String(id)) return n
      if (wantPath && n.path === wantPath) return n
      if (n.children) {
        const hit = walk(n.children)
        if (hit) return hit
      }
    }
    return null
  }
  return walk(nodes)
}

// Returns a new forest, or null when the client should ask for fs/tree.
export function applyCreated(nodes, payload) {
  if (isBulkTreeEvent(payload)) return null
  return insertNode(nodes || [], makeNode(payload))
}

export function applyRenamed(nodes, payload) {
  const oldP = stripTreePath(payload?.old_path)
  const newP = stripTreePath(payload?.new_path)
  if (!oldP || !newP || oldP === newP) return nodes || []
  const id = payload?.id
  const match = (n) => (id && String(n.id) === String(id)) || n.path === oldP
  if (!findTreeNode(nodes, { id, path: oldP })) return null
  const parent = treeParentPath(newP)
  const renamed = mapNode(nodes || [], match, (n) => {
    const next = rewritePrefix({ ...n, id: id || n.id }, oldP, newP)
    next.name = treeBasename(newP)
    next.path = newP
    return next
  })
  // Same-parent rename (the worker's fs/rename): resort that directory.
  if (treeParentPath(oldP) === parent) {
    return mapAtDir(renamed, parent, sortChildren)
  }
  return renamed
}

function mapAtDir(nodes, dirPath, fn) {
  const dir = stripTreePath(dirPath)
  if (!dir) return fn(nodes)
  return mapNode(nodes, (n) => n.type === 'dir' && n.path === dir, (n) => ({
    ...n, children: fn(n.children || []),
  }))
}

export function applyDeleted(nodes, payload) {
  const path = stripTreePath(payload?.path)
  if (!path) return null
  return removePath(nodes || [], path)
}
