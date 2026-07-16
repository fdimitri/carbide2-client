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

export const useSessionStore = defineStore('session', () => {
  // ── Identity / role ─────────────────────────────────────────────────────────
  const sessionUuid = ref(null)          // server-assigned uuid, null until create/resume
  const name        = ref(null)
  const role        = ref(null)          // 'producer' | 'watcher' | null
  const subscribed  = ref(false)         // true once create/resume/subscribe acked
  const rev         = ref(null)          // last server-acked revision (updated_at float)

  // ── Authoritative layout (runtime/array form) ───────────────────────────────
  const layout          = ref('one')
  const activePaneIndex = ref(0)
  const panes           = ref(emptyPanes())

  const isProducer = () => role.value === 'producer'
  const isWatcher  = () => role.value === 'watcher'

  // ── Serialize runtime → wire doc (create payload / diff base) ───────────────
  function toDoc() {
    const panesObj = {}
    for (let i = 0; i < PANE_SLOTS; i++) {
      const p = panes.value[i] || emptyPane()
      panesObj[String(i)] = {
        activeTab: p.activeTab ?? null,
        tabs: (p.tabs || []).map((t) => ({ key: t.key, kind: t.kind, id: t.id, label: t.label })),
      }
    }
    return {
      v: SESSION_DOC_VERSION,
      layout: layout.value,
      activePaneIndex: activePaneIndex.value,
      panes: panesObj,
    }
  }

  // ── Hydrate runtime ← wire doc (session/created|resumed|snapshot) ───────────
  function loadDoc(doc) {
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
  function setSession({ session_uuid, name: n, role: r } = {}) {
    if (session_uuid !== undefined) sessionUuid.value = session_uuid
    if (n !== undefined) name.value = n
    if (r !== undefined) role.value = r
    subscribed.value = true
  }

  function setRev(v) { if (v !== undefined) rev.value = v }

  function reset() {
    sessionUuid.value = null
    name.value        = null
    role.value        = null
    subscribed.value  = false
    rev.value         = null
    layout.value          = 'one'
    activePaneIndex.value = 0
    panes.value           = emptyPanes()
  }

  return {
    // identity
    sessionUuid, name, role, subscribed, rev,
    isProducer, isWatcher,
    // layout state
    layout, activePaneIndex, panes,
    // (de)serialization + patch application
    toDoc, loadDoc, applyOps,
    // metadata
    setSession, setRev, reset,
  }
})
