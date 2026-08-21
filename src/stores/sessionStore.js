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
//       "0": { activeTab: "file:src/x", tabs: [ { key, kind, id, label } ] },
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
export const SESSION_DOC_VERSION = 1          // bump on a breaking doc-shape change
export const PANE_SLOTS          = 4          // usePanes keeps 4 fixed pane slots

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
  'file', 'channel', 'terminal', 'settings', 'debug', 'agent', 'agent-config',
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
        tabs: (p.tabs || []).map((t) => ({ key: t.key, kind: t.kind, id: t.id, label: t.label })),
      }
    }
    const known = {
      v: SESSION_DOC_VERSION,
      layout: layout.value,
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
    activePaneIndex.value = Number.isInteger(d.activePaneIndex) ? d.activePaneIndex : 0
    const src   = d.panes && typeof d.panes === 'object' ? d.panes : {}
    const fresh = emptyPanes()
    for (let i = 0; i < PANE_SLOTS; i++) {
      const p = src[String(i)]
      if (p && typeof p === 'object') {
        fresh[i] = {
          activeTab: p.activeTab ?? null,
          tabs: Array.isArray(p.tabs)
            ? p.tabs.map((t) => ({ key: t.key, kind: t.kind, id: t.id, label: t.label }))
            : [],
        }
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
    if (head === 'activePaneIndex') {
      activePaneIndex.value = isDelete ? 0 : Number(op.value) || 0
      return
    }
    if (head === 'panes') {
      // Whole-map replace: { path:['panes'], value:{...} }
      if (rest.length === 0) { loadDoc({ layout: layout.value, activePaneIndex: activePaneIndex.value, panes: isDelete ? {} : op.value }); return }
      const idx = Number(rest[0])
      if (!Number.isInteger(idx) || idx < 0 || idx >= PANE_SLOTS) return
      const pane  = panes.value[idx] || emptyPane()
      const field = rest[1]
      if (field === 'activeTab') {
        pane.activeTab = isDelete ? null : (op.value ?? null)
      } else if (field === 'tabs') {
        pane.tabs = isDelete || !Array.isArray(op.value)
          ? []
          : op.value.map((t) => ({ key: t.key, kind: t.kind, id: t.id, label: t.label }))
      } else if (field === undefined) {
        // Replace an entire pane object.
        if (isDelete) { panes.value[idx] = emptyPane(); return }
        const v = op.value && typeof op.value === 'object' ? op.value : {}
        pane.activeTab = v.activeTab ?? null
        pane.tabs = Array.isArray(v.tabs) ? v.tabs.map((t) => ({ key: t.key, kind: t.kind, id: t.id, label: t.label })) : []
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
    const TOP_KNOWN  = new Set(['v', 'layout', 'activePaneIndex', 'panes'])
    const PANE_KNOWN = new Set(['activeTab', 'tabs'])
    const TAB_KNOWN  = new Set(['key', 'kind', 'id', 'label'])
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
    activePaneIndex.value = 0
    panes.value           = emptyPanes()
    sessions.value        = []
  }

  return {
    // identity
    sessionUuid, name, role, subscribed, rev,
    versionHistory, forkedFrom, rawDoc,
    isProducer, isWatcher,
    // layout state
    layout, activePaneIndex, panes,
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
