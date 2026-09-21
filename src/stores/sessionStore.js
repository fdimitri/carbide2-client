// sessionStore — authoritative browser-session layout document (ADR-002).
//
// This store holds the *server-authoritative* live UI layout that the `session`
// commandSet (worker/handlers/session_handlers.rb) persists and relays. One
// producer mutates it; watchers receive read-only snapshots + patches.
//
// ── Wire ("doc") shape ────────────────────────────────────────────────────────
// The worker treats `doc` as an OPAQUE JSON tree and applies GENERIC path ops:
//   { path: ["a","b"], value: <any> }   // set
//   { path: ["a","b"], op: "delete" }   // delete
//
// CRITICAL CONSTRAINT: the server's `apply_op` navigates HASHES ONLY — it maps
// every path segment to a string and creates missing intermediates as hashes.
// It cannot index into an array. Therefore the canonical doc is hash-keyed all
// the way down, and any array (a pane's `tabs`) is only ever set as a WHOLE
// value at a leaf — never index-navigated on the server:
//
//   {
//     v: 1,
//     layout: "one",
//     activePaneIndex: 0,
//     panes: {
//       "0": { activeTab: "file:<uuid>::main", tabs: [ { key, kind, id, path?, label, branch?, revision? } ] },
//       "1": { activeTab: null, tabs: [] },
//       "2": { activeTab: null, tabs: [] },
//       "3": { activeTab: null, tabs: [] }
//     }
//   }
//
// ── Runtime shape ─────────────────────────────────────────────────────────────
// For ergonomics (and to keep usePanes' public API identical) the store exposes
// `panes` as an ARRAY of PANE_SLOTS entries. loadDoc()/toDoc() convert between
// the hash-keyed wire form and the array runtime form; applyOps() translates a
// hash path back onto the array. The client's applyOps is array-aware; the
// server's is not — which is exactly why the wire form is hash-keyed.
import { defineStore } from 'pinia'
import { ref } from 'vue'

// ── Wire-protocol constants ──────────────────────────────────────────────────
export const SESSION_CS          = 'session' // commandSet name (worker ROUTES)
export const SESSION_DOC_VERSION = 4          // v2: agent tabs carry agent:<uuid> + agentSlug/composerHeightPx
                                              // v3: file tabs carry `branch` (per-file DBFS branch; main by default)
                                              //     and `revision` (null, or a revision the view is pinned at, read-only)
                                              // v4: a file tab is one (FileNode UUID, branch). `id` is the node
                                              //     UUID, `path` is a location cache for the tab title (document
                                              //     ops use id; a missed rename is healed by the next frame
                                              //     that names the path). key is `file:<id>::<branch>`.
export const MAIN_BRANCH         = 'main'
export const PANE_SLOTS          = 4          // usePanes keeps 4 fixed pane slots

// FileNode.id is SecureRandom.uuid. Stable across rename/move on a branch
// (only branch_entries.path / file_nodes.path change). Tab identity is
// (this id, branch); path is the current location on that branch.
export const FILE_NODE_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isFileNodeId(id) {
  return typeof id === 'string' && FILE_NODE_ID_RE.test(id)
}

export function stripFilePath(p) {
  return String(p || '').replace(/^\//, '')
}

export function fileTabKey(id, branch = MAIN_BRANCH) {
  return `file:${id}::${branch || MAIN_BRANCH}`
}

export function fileTabPath(t) {
  if (!t) return ''
  if (t.path) return stripFilePath(t.path)
  if (!isFileNodeId(t.id)) return stripFilePath(t.id)
  return ''
}

export function basenameOfPath(path) {
  const p = stripFilePath(path)
  return p.split('/').pop() || p
}

// Display only: the tab's location (path, label) follows a move. Identity
// (id, key, branch) does not. A missed rename does not break the document;
// the next frame that names the node's path heals the label.
export function withTabLocation(t, path) {
  if (!t || !path) return t
  const p = stripFilePath(path)
  if (!p) return t
  if (t.kind === 'file') {
    const label = basenameOfPath(p)
    if (fileTabPath(t) === p && t.label === label) return t
    return { ...t, path: p, label }
  }
  if (t.kind === 'history' || t.kind === 'preview') {
    const suffix = t.label && t.label.includes('·') ? t.label.split(' · ').slice(1).join(' · ') : t.kind
    const label = `${basenameOfPath(p)} · ${suffix}`
    if (fileTabPath(t) === p && t.label === label) return t
    return { ...t, path: p, label }
  }
  return t
}

export function withTabLocationUnderPrefix(t, oldPrefix, newPrefix) {
  if (!t || (t.kind !== 'file' && t.kind !== 'history' && t.kind !== 'preview')) return t
  const p = fileTabPath(t)
  const oldN = stripFilePath(oldPrefix)
  const newN = stripFilePath(newPrefix)
  if (!p || !oldN || !newN || !p.startsWith(`${oldN}/`)) return t
  return withTabLocation(t, `${newN}${p.slice(oldN.length)}`)
}

// The branch a file tab is on (main when unset).
export function tabBranch(t) {
  return (t && t.kind === 'file' && t.branch) || MAIN_BRANCH
}

export function fileTabMatches(t, id, branch) {
  if (!t || t.kind !== 'file' || id == null || id === '') return false
  if (branch != null && tabBranch(t) !== (branch || MAIN_BRANCH)) return false
  const want = String(id)
  if (String(t.id) === want) return true
  const wantPath = stripFilePath(want)
  const have = fileTabPath(t)
  return !!(wantPath && have && wantPath === have)
}

// Placeholder large-jump threshold for the distance gate (#86). The real
// threshold is deliberately undefined until we have the facts of a real problem.
export const LARGE_JUMP_THRESHOLD = 5

// Decide whether a session row is a "large jump" relative to this client.
// Consults doc_version AND version_history (a chimera doc touched by a far-future
// version is still a large jump even if its last writer demoted it). A row with
// forked_from set was produced by a deliberate fork (consent-by-lineage), so the
// gate does not re-trigger.
export function sessionGateInfo(session) {
  const current = SESSION_DOC_VERSION
  const versions = new Set()
  if (session?.doc_version != null) versions.add(Number(session.doc_version))
  for (const v of (session?.version_history || [])) {
    if (v != null) versions.add(Number(v))
  }
  let maxFuture = current
  for (const v of versions) {
    if (Number.isFinite(v) && v > maxFuture) maxFuture = v
  }
  const distance = maxFuture - current
  return {
    distance,
    largeJump: distance >= LARGE_JUMP_THRESHOLD,
    forkedFrom: session?.forked_from ?? null,
    // A large jump only gates the load if it wasn't already a deliberate fork.
    gated: distance >= LARGE_JUMP_THRESHOLD && !session?.forked_from,
  }
}

// Tab kinds this build can render/parse. Anything else is "from the future" and
// is preserved raw (kept in the doc, not rendered) rather than dropped.
export const KNOWN_TAB_KINDS = new Set([
  'file', 'channel', 'terminal', 'settings', 'debug', 'agent', 'agent-config', 'history', 'preview', 'merge', 'project-merge', 'project-history', 'identity',
])

// Server → client messages (see session_handlers.rb):
//   session/created   { session_uuid, name, doc, forked_from }
//   session/resumed   { session_uuid, name, doc }
//   session/snapshot  { session_uuid, name, doc }
//   session/patched   { session_uuid, rev }        (ack to producer)
//   session/patch     { session_uuid, ops }        (relay to watchers)
//   session/list      { sessions: [...] }
//   session/unsubscribed { session_uuid }
// Client → server commands:
//   create {from_uuid?, name?, doc?} · resume {session_uuid} ·
//   patch {session_uuid, ops} · subscribe {session_uuid} ·
//   unsubscribe {session_uuid} · snapshot {session_uuid} · list {}

function emptyPane() {
  return { tabs: [], activeTab: null }
}

function emptyPanes() {
  return Array.from({ length: PANE_SLOTS }, emptyPane)
}

// ── Op builders (pure) ───────────────────────────────────────────────────────
// The only place doc paths are spelled out. usePanes / useSessionSync build
// patches through these so the wire shape stays consistent and hash-navigable.
export const ops = {
  layout:        (value) => ({ path: ['layout'], value }),
  // The workspace's project branch: what the explorer shows and new file tabs open on.
  branch:        (value) => ({ path: ['branch'], value }),
  activePane:    (value) => ({ path: ['activePaneIndex'], value }),
  paneActiveTab: (i, value) => ({ path: ['panes', String(i), 'activeTab'], value }),
  // Whole-array replacement — server stores it opaquely, never indexes into it.
  paneTabs:      (i, tabs) => ({ path: ['panes', String(i), 'tabs'], value: tabs }),
}

// ── Doc diff (pure) ──────────────────────────────────────────────────────────
// Minimal set of path patches that turns `prev` into `next` (both wire docs from
// toDoc()). This is the emitter's core: useSessionSync diffs the last-sent doc
// against the current one and ships only what changed. Tabs are compared as a
// whole (structural equality) and emitted as a single whole-array op, matching
// the server's array-opaque model. Order is stable so a JSON compare of the two
// docs is a valid "did anything change?" pre-check.
export function diffSessionDoc(prev, next) {
  const a = prev && typeof prev === 'object' ? prev : {}
  const b = next && typeof next === 'object' ? next : {}
  const patch = []

  if (a.layout !== b.layout) patch.push(ops.layout(b.layout))
  if ((a.branch || MAIN_BRANCH) !== (b.branch || MAIN_BRANCH)) patch.push(ops.branch(b.branch || MAIN_BRANCH))
  if (a.activePaneIndex !== b.activePaneIndex) patch.push(ops.activePane(b.activePaneIndex))

  const ap = a.panes && typeof a.panes === 'object' ? a.panes : {}
  const bp = b.panes && typeof b.panes === 'object' ? b.panes : {}
  for (let i = 0; i < PANE_SLOTS; i++) {
    const k  = String(i)
    const pa = ap[k] || {}
    const pb = bp[k] || {}
    if ((pa.activeTab ?? null) !== (pb.activeTab ?? null)) {
      patch.push(ops.paneActiveTab(i, pb.activeTab ?? null))
    }
    if (JSON.stringify(pa.tabs || []) !== JSON.stringify(pb.tabs || [])) {
      patch.push(ops.paneTabs(i, pb.tabs || []))
    }
  }
  return patch
}

// Deep-merge `known` over `base` such that keys present in `base` but absent
// from `known` survive (patch-preserve). Objects merge recursively; arrays of
// objects with a `key` field (tabs) merge element-wise by key; other arrays
// merge by index. Returns a fresh object/array; never mutates inputs.
function mergeDoc(base, known) {
  if (Array.isArray(base) && Array.isArray(known)) {
    if (known.length && known[0] && typeof known[0] === 'object' && 'key' in known[0]) {
      const out = []
      // Preserve raw tabs whose KIND this build doesn't understand (§2: keep in
      // doc, don't render). They are not in `known` (the render model) but must
      // not be dropped.
      for (const b of base) {
        if (b && typeof b === 'object' && typeof b.kind === 'string' && !KNOWN_TAB_KINDS.has(b.kind)) {
          out.push(b)
        }
      }
      // Known tabs: the client's list is authoritative for add/close/reorder.
      // Each known tab still merges unknown per-tab FIELDS from its raw twin.
      for (const k of known) {
        const raw = base.find((b) => b && typeof b === 'object' && b.key === k.key)
        out.push(raw ? mergeDoc(raw, k) : k)
      }
      return out
    }
    return known.map((k, i) => (i < base.length ? mergeDoc(base[i], k) : k))
  }
  if (base && known && typeof base === 'object' && typeof known === 'object') {
    const out = { ...base }
    for (const key of Object.keys(known)) {
      out[key] = (key in base) ? mergeDoc(base[key], known[key]) : known[key]
    }
    return out
  }
  return known
}

function serializeTab(t) {
  const out = { key: t.key, kind: t.kind, id: t.id, label: t.label }
  if (t.agentSlug != null) out.agentSlug = t.agentSlug
  if (t.composerHeightPx != null) out.composerHeightPx = t.composerHeightPx
  // Always written for a file tab, main included: toDoc() patch-preserves
  // fields of the raw doc that the render model omits, so leaving `branch` out
  // on main would let a previously saved branch survive the switch back.
  if (t.kind === 'file') {
    out.branch = t.branch || MAIN_BRANCH
    out.revision = t.revision || null
  }
  const path = fileTabPath(t)
  if (path && (t.kind === 'file' || t.kind === 'history' || t.kind === 'preview')) out.path = path
  return out
}

function deserializeTab(t) {
  const out = {
    key: t.key, kind: t.kind, id: t.id, label: t.label,
    agentSlug: t.agentSlug ?? null,
    composerHeightPx: t.composerHeightPx ?? null,
    branch: t.kind === 'file' ? (t.branch || MAIN_BRANCH) : null,
    revision: t.kind === 'file' ? (t.revision || null) : null,
  }
  if (t.kind === 'file') {
    const nodeId = isFileNodeId(t.id) ? t.id : null
    const path = stripFilePath(t.path) || (nodeId ? '' : stripFilePath(t.id))
    if (path) out.path = path
    out.id = nodeId || path || t.id
    out._wasKey = t.key
    out.key = fileTabKey(out.id, out.branch)
  } else if (t.kind === 'history' || t.kind === 'preview') {
    const path = stripFilePath(t.path)
    if (path) out.path = path
  }
  return out
}

export const useSessionStore = defineStore('session', () => {
  // ── Identity / role ─────────────────────────────────────────────────────────
  const sessionUuid = ref(null)          // server-assigned uuid, null until create/resume
  const name        = ref(null)
  const role        = ref(null)          // 'producer' | 'watcher' | null
  const subscribed  = ref(false)         // true once create/resume/subscribe acked
  const rev         = ref(null)          // last server-acked revision (updated_at float)
  const versionHistory = ref([])         // ordered SESSION_DOC_VERSIONs that wrote this doc
  const forkedFrom     = ref(null)       // parent session_uuid when this is a fork
  const rawDoc         = ref(null)       // last loaded wire doc (unknown keys preserved)

  // ── Authoritative layout (runtime/array form) ───────────────────────────────
  const layout          = ref('one')
  const activePaneIndex = ref(0)
  const panes           = ref(emptyPanes())
  // The project branch this workspace is on (ADR-042): the explorer's tree,
  // and the branch a file tab opens on from it. Per-tab branches still
  // override for that tab.
  const workspaceBranch = ref(MAIN_BRANCH)

  // ── Resume picker ───────────────────────────────────────────────────────────
  // This user's sessions as of the last session/list, newest first. Each entry:
  // { session_uuid, name, updated_at, created_at, in_use }. Drives auto-resume
  // (pick most-recent not-in-use) and a future "Connect session" dropdown.
  const sessions = ref([])

  const isProducer = () => role.value === 'producer'
  const isWatcher  = () => role.value === 'watcher'

  // ── Serialize runtime → wire doc (create payload / diff base) ───────────────
  function toDoc({ sanitize = false } = {}) {
    const panesObj = {}
    for (let i = 0; i < PANE_SLOTS; i++) {
      const p = panes.value[i] || emptyPane()
      panesObj[String(i)] = {
        activeTab: p.activeTab ?? null,
        tabs: (p.tabs || []).map(serializeTab),
      }
    }
    const known = {
      v: SESSION_DOC_VERSION,
      layout: layout.value,
      branch: workspaceBranch.value || MAIN_BRANCH,
      activePaneIndex: activePaneIndex.value,
      panes: panesObj,
    }
    // Preserve unknown keys from the last loaded doc by default (§2). Only an
    // explicit sanitize (or no loaded doc) emits the bare known shape.
    if (sanitize || !rawDoc.value || typeof rawDoc.value !== 'object') return known
    return mergeDoc(rawDoc.value, known)
  }

  // ── Hydrate runtime ← wire doc (session/created|resumed|snapshot) ───────────
  function loadDoc(doc, { sanitize = false } = {}) {
    const d = doc && typeof doc === 'object' ? doc : {}
    layout.value          = typeof d.layout === 'string' ? d.layout : 'one'
    workspaceBranch.value = typeof d.branch === 'string' && d.branch ? d.branch : MAIN_BRANCH
    activePaneIndex.value = Number.isInteger(d.activePaneIndex) ? d.activePaneIndex : 0
    const src   = d.panes && typeof d.panes === 'object' ? d.panes : {}
    const fresh = emptyPanes()
    for (let i = 0; i < PANE_SLOTS; i++) {
      const p = src[String(i)]
      if (p && typeof p === 'object') {
        fresh[i] = {
          activeTab: p.activeTab ?? null,
          tabs: Array.isArray(p.tabs) ? p.tabs.map(deserializeTab) : [],
        }
        const tabs = fresh[i].tabs
        if (fresh[i].activeTab && !tabs.some((t) => t.key === fresh[i].activeTab)) {
          const hit = tabs.find((t) => t._wasKey === fresh[i].activeTab)
          if (hit) fresh[i].activeTab = hit.key
        }
        for (const t of tabs) delete t._wasKey
      }
    }
    panes.value = fresh
    // Keep the full wire doc so toDoc({sanitize:false}) can round-trip unknown
    // keys. Explicit sanitize drops it.
    rawDoc.value = sanitize ? null : d
  }

  // ── Apply inbound wire ops → runtime (watcher side / echo) ──────────────────
  // Array-aware translation of the hash-keyed wire path back onto runtime state.
  // Unknown paths are ignored rather than throwing — the doc is opaque and may
  // grow fields this build doesn't understand yet.
  function applyOps(list) {
    if (!Array.isArray(list)) return
    for (const op of list) {
      if (!op || typeof op !== 'object' || !Array.isArray(op.path)) continue
      applyOne(op)
    }
  }

  function applyOne(op) {
    const path     = op.path
    const isDelete = op.op === 'delete'
    const [head, ...rest] = path

    if (head === 'layout') {
      layout.value = isDelete ? 'one' : String(op.value)
      return
    }
    if (head === 'branch') {
      workspaceBranch.value = isDelete ? MAIN_BRANCH : (String(op.value || '') || MAIN_BRANCH)
      return
    }
    if (head === 'activePaneIndex') {
      activePaneIndex.value = isDelete ? 0 : Number(op.value) || 0
      return
    }
    if (head === 'panes') {
      // Whole-map replace: { path:['panes'], value:{...} }
      if (rest.length === 0) { loadDoc({ layout: layout.value, branch: workspaceBranch.value, activePaneIndex: activePaneIndex.value, panes: isDelete ? {} : op.value }); return }
      const idx = Number(rest[0])
      if (!Number.isInteger(idx) || idx < 0 || idx >= PANE_SLOTS) return
      const pane  = panes.value[idx] || emptyPane()
      const field = rest[1]
      if (field === 'activeTab') {
        pane.activeTab = isDelete ? null : (op.value ?? null)
      } else if (field === 'tabs') {
        pane.tabs = isDelete || !Array.isArray(op.value)
          ? []
          : op.value.map(deserializeTab)
      } else if (field === undefined) {
        // Replace an entire pane object.
        if (isDelete) { panes.value[idx] = emptyPane(); return }
        const v = op.value && typeof op.value === 'object' ? op.value : {}
        pane.activeTab = v.activeTab ?? null
        pane.tabs = Array.isArray(v.tabs) ? v.tabs.map(deserializeTab) : []
      }
      panes.value[idx] = pane
    }
    // any other head → ignore (forward-compat)
  }

  // ── Metadata setters (called from the session/* message handlers) ───────────
  function setSession({ session_uuid, name: n, role: r, version_history, forked_from } = {}) {
    if (session_uuid !== undefined) sessionUuid.value = session_uuid
    if (n !== undefined) name.value = n
    if (r !== undefined) role.value = r
    if (version_history !== undefined) versionHistory.value = Array.isArray(version_history) ? version_history : []
    if (forked_from !== undefined) forkedFrom.value = forked_from ?? null
    subscribed.value = true
  }

  function setRev(v) { if (v !== undefined) rev.value = v }

  function setSessions(list) { sessions.value = Array.isArray(list) ? list : [] }

  // Rapid-dev inspection: report what this build doesn't recognize in the last
  // loaded doc, split into unknown keys vs known-but-unparseable values. Best
  // effort — not permanent API.
  function listUnknown() {
    const d = rawDoc.value && typeof rawDoc.value === 'object' ? rawDoc.value : {}
    const TOP_KNOWN  = new Set(['v', 'layout', 'branch', 'activePaneIndex', 'panes'])
    const PANE_KNOWN = new Set(['activeTab', 'tabs'])
    const TAB_KNOWN  = new Set(['key', 'kind', 'id', 'label', 'agentSlug', 'composerHeightPx'])
    const unknownTop        = Object.keys(d).filter((k) => !TOP_KNOWN.has(k))
    const unknownPaneFields = []
    const unknownTabFields  = []
    const unparseableTabs   = []
    const src = d.panes && typeof d.panes === 'object' ? d.panes : {}
    for (const pk of Object.keys(src)) {
      const pane = src[pk]
      if (!pane || typeof pane !== 'object') continue
      for (const k of Object.keys(pane)) if (!PANE_KNOWN.has(k)) unknownPaneFields.push(`${pk}.${k}`)
      const tabs = Array.isArray(pane.tabs) ? pane.tabs : []
      for (const t of tabs) {
        if (!t || typeof t !== 'object') continue
        for (const k of Object.keys(t)) if (!TAB_KNOWN.has(k)) unknownTabFields.push(`${pk}.${k}`)
        if (typeof t.key !== 'string' || !/^[a-z-]+:.+/.test(t.key)) unparseableTabs.push(`${pk}: ${t.key}`)
      }
    }
    return {
      unknownTop,
      unknownPaneFields,
      unknownTabFields,
      unparseableTabs,
      counts: {
        unknownTop: unknownTop.length,
        unknownPaneFields: unknownPaneFields.length,
        unknownTabFields: unknownTabFields.length,
        unparseableTabs: unparseableTabs.length,
      },
    }
  }

  function reset() {
    sessionUuid.value = null
    name.value        = null
    role.value        = null
    subscribed.value  = false
    rev.value         = null
    versionHistory.value = []
    forkedFrom.value     = null
    rawDoc.value         = null
    layout.value          = 'one'
    workspaceBranch.value = MAIN_BRANCH
    activePaneIndex.value = 0
    panes.value           = emptyPanes()
    sessions.value        = []
  }

  // Point one file tab (the (node, fromBranch) view, else the first matching
  // node) at a branch head or a pinned revision. Identity is (FileNode UUID,
  // branch): switching branch rewrites the tab key, and a (node, branch) that
  // is already open is focused instead of duplicated. Returns false when no
  // tab has this file open.
  function setWorkspaceBranch(name) {
    workspaceBranch.value = String(name || '') || MAIN_BRANCH
  }

  function findFileTab(fileId, branch) {
    for (let p = 0; p < panes.value.length; p++) {
      const pane = panes.value[p]
      const idx = (pane?.tabs || []).findIndex((t) => fileTabMatches(t, fileId, branch))
      if (idx !== -1) return { pane, idx, tab: pane.tabs[idx], paneIndex: p }
    }
    return null
  }

  function setFileTabView(fileId, { branch, revision, fromBranch, projectBranch } = {}) {
    const found = findFileTab(fileId, fromBranch !== undefined ? fromBranch : undefined)
    if (!found) return false
    const cur = found.tab
    const next = {
      branch:   branch === undefined ? tabBranch(cur) : (branch || MAIN_BRANCH),
      revision: revision === undefined ? (cur.revision || null) : (revision || null),
    }
    if (projectBranch !== undefined) next.projectBranch = projectBranch || MAIN_BRANCH
    if (tabBranch(cur) === next.branch && (cur.revision || null) === next.revision &&
        (next.projectBranch === undefined || (cur.projectBranch || tabBranch(cur)) === next.projectBranch)) return true

    const collision = next.branch !== tabBranch(cur) ? findFileTab(cur.id, next.branch) : null
    if (collision && collision.tab !== cur) {
      // Same (node, branch) is already open elsewhere: focus it and apply
      // the requested pin. Dropping `revision` here made "load into editor"
      // from history a no-op when the file was already on that branch in
      // another pane.
      const pinned = { ...collision.tab, revision: next.revision }
      if (next.projectBranch !== undefined) pinned.projectBranch = next.projectBranch
      collision.pane.tabs = collision.pane.tabs.map((t, i) => (t === collision.tab ? pinned : t))
      collision.pane.activeTab = pinned.key
      activePaneIndex.value = collision.paneIndex
      return true
    }

    const key = fileTabKey(cur.id, next.branch)
    const rewritten = { ...cur, ...next, key }
    found.pane.tabs = found.pane.tabs.map((t, i) => (i === found.idx ? rewritten : t))
    if (found.pane.activeTab === cur.key) found.pane.activeTab = key
    return true
  }

  // The view a file tab is on; when several (same node, different branches)
  // are open, `branch` picks one, else the workspace branch, else the first.
  function fileTabView(fileId, branch) {
    if (branch) {
      const found = findFileTab(fileId, branch)
      if (found) return { branch: tabBranch(found.tab), revision: found.tab.revision || null, path: fileTabPath(found.tab), projectBranch: found.tab.projectBranch || tabBranch(found.tab) }
    }
    const foundWs = findFileTab(fileId, workspaceBranch.value)
    if (foundWs) return { branch: tabBranch(foundWs.tab), revision: foundWs.tab.revision || null, path: fileTabPath(foundWs.tab), projectBranch: foundWs.tab.projectBranch || tabBranch(foundWs.tab) }
    const found = findFileTab(fileId)
    if (found) return { branch: tabBranch(found.tab), revision: found.tab.revision || null, path: fileTabPath(found.tab), projectBranch: found.tab.projectBranch || tabBranch(found.tab) }
    return { branch: MAIN_BRANCH, revision: null, path: stripFilePath(fileId), projectBranch: MAIN_BRANCH }
  }

  // Switch the file's tab to a branch head. Un-pins: a pinned view is a
  // revision, not a branch head to edit on. `fromBranch` is the tab being
  // switched (required once two branches of the same node can be open).
  function setFileTabBranch(fileId, branch, fromBranch) {
    return setFileTabView(fileId, { branch, revision: null, fromBranch })
  }

  // Display only. Identity is (id, branch); a rename must not rekey the tab.
  // `fs/renamed` is one source of the new path. Document frames that carry
  // path (opened, content, written, …) are another — the tab does not rely
  // on the rename event.
  function patchTabLocation(rewrite) {
    let changed = false
    for (const pane of panes.value) {
      const next = (pane.tabs || []).map(rewrite)
      if (next.some((t, i) => t !== pane.tabs[i])) {
        pane.tabs = next
        changed = true
      }
    }
    return changed
  }

  function setFileTabLocation(fileId, path, { branch } = {}) {
    if (!fileId || !path) return false
    const want = String(fileId)
    return patchTabLocation((t) => {
      if (t.kind === 'file' && String(t.id) === want && (branch == null || tabBranch(t) === branch)) {
        return withTabLocation(t, path)
      }
      if ((t.kind === 'history' || t.kind === 'preview') && String(t.id) === want) {
        return withTabLocation(t, path)
      }
      return t
    })
  }

  function applyFileRename({ oldPath, newPath, nodeId, branch }) {
    const b = branch || MAIN_BRANCH
    const oldN = stripFilePath(oldPath)
    const newN = stripFilePath(newPath)
    if (!oldN || !newN || oldN === newN) return false
    let changed = false
    if (nodeId) changed = setFileTabLocation(nodeId, newN, { branch: b }) || changed
    // A folder move: descendant tabs still have the old prefix in their
    // location cache. Heal the label; do not touch id/key.
    changed = patchTabLocation((t) => {
      if (nodeId && String(t.id) === String(nodeId)) return t
      if (t.kind === 'file' && tabBranch(t) !== b) return t
      return withTabLocationUnderPrefix(t, oldN, newN)
    }) || changed
    return changed
  }

  // Drop file (and history/preview/merge) tabs for a deleted node, or every
  // file tab still sitting on a deleted project branch.
  function dropFileTabs(fileId, { branch } = {}) {
    if (!fileId) return false
    const want = String(fileId)
    const b = branch == null ? null : String(branch)
    let changed = false
    for (const pane of panes.value) {
      const tabs = pane.tabs || []
      const next = tabs.filter((t) => {
        if (t.kind === 'file' && String(t.id) === want && (b == null || tabBranch(t) === b)) return false
        if ((t.kind === 'history' || t.kind === 'preview') && String(t.id) === want) return false
        if (t.kind === 'merge') {
          const id = String(t.id)
          const last = id.lastIndexOf('|')
          if (last >= 0 && id.slice(last + 1) === want) return false
        }
        return true
      })
      if (next.length !== tabs.length) {
        if (pane.activeTab && !next.some((t) => t.key === pane.activeTab)) {
          pane.activeTab = next[next.length - 1]?.key || null
        }
        pane.tabs = next
        changed = true
      }
    }
    return changed
  }

  function dropTabsOnProjectBranch(name) {
    const b = String(name || '')
    if (!b) return false
    let changed = false
    for (const pane of panes.value) {
      const tabs = pane.tabs || []
      const next = tabs.filter((t) => {
        if (t.kind === 'file' && (tabBranch(t) === b || (t.projectBranch || '') === b)) return false
        if (t.kind === 'merge' && (t.branch || '') === b) return false
        return true
      })
      if (next.length !== tabs.length) {
        if (pane.activeTab && !next.some((t) => t.key === pane.activeTab)) {
          pane.activeTab = next[next.length - 1]?.key || null
        }
        pane.tabs = next
        changed = true
      }
    }
    return changed
  }

  return {
    // identity
    sessionUuid, name, role, subscribed, rev,
    versionHistory, forkedFrom, rawDoc,
    isProducer, isWatcher,
    // layout state
    layout, activePaneIndex, panes, workspaceBranch, setWorkspaceBranch, setFileTabBranch, setFileTabView, fileTabView, setFileTabLocation, applyFileRename, dropFileTabs, dropTabsOnProjectBranch,
    // resume picker
    sessions,
    // (de)serialization + patch application
    toDoc, loadDoc, applyOps,
    // inspection (rapid-dev)
    listUnknown,
    // metadata
    setSession, setRev, setSessions, reset,
  }
})
