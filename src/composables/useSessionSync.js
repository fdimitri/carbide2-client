// useSessionSync — the browser-session emitter + applier (ADR-002).
//
// ONE choke point for keeping the server-authoritative layout doc in sync with
// the local `useSessionStore`. Two directions:
//
//   OUTBOUND (producer): deep-watch the store → debounce → diff the current wire
//     doc against the last one we sent → ship only the changed path patches as
//     `session/patch`. A drag/burst coalesces into a single settle patch because
//     the watch is debounced; we never emit per-pixel. This is the "the wire doc
//     IS the reactive tree, watch it" decision — no per-mutation event hooks, so
//     a new layout mutation is synced automatically without touching this file.
//
//   INBOUND (producer resume / watcher follow): `session/created|resumed|snapshot`
//     hydrate the whole store via loadDoc(); `session/patch` (watcher relay)
//     applies path ops via applyOps(). After any inbound apply we re-baseline
//     `lastSentDoc` so the resulting store change does NOT echo back out.
//
// Content binding (fs open / term attach / chat join) is NOT handled here — that
// stays event-driven through the normal open flow. This composable only moves the
// LAYOUT/FOCUS doc.
import { watch } from 'vue'
import workerSocket from '../services/workerSocket'
import { logInfo, logWs } from '../services/log'
import { useSessionStore, diffSessionDoc, SESSION_CS, SESSION_DOC_VERSION } from '../stores/sessionStore'
import { VERSION, CLIENT_SHA } from '../version'

// Coalesce a burst of layout mutations (a drag, a multi-step layout switch) into
// one outbound patch. Long enough to swallow a drag, short enough to feel live.
const EMIT_DEBOUNCE_MS = 200

// options.bindActiveSurface?: (tab) => void
//   Called for each pane's ACTIVE tab after an inbound hydrate/patch so content
//   binds through the normal open flow. Files/terminals self-bind on component
//   mount, so this is strictly required only for chat (ChatPane is presentational
//   and does not join itself) — but we call it uniformly for every active tab so
//   the binding path is kind-agnostic and future-proof. ACTIVE tabs only: only
//   the active tab per pane renders, so inactive tabs bind when activated
//   (interest management). Must be idempotent — it may run on every inbound apply.
// options.storageKey?: string
//   localStorage key under which we remember the last session_uuid we owned, so
//   a full page reload can silently re-resume it (if it isn't in use elsewhere).
//   A mid-life WS drop doesn't need it — the store keeps sessionUuid in memory.
export function useSessionSync({ bindActiveSurface = null, storageKey = null } = {}) {
  const store = useSessionStore()

  // The last wire doc we've reconciled with the server — the diff baseline. Also
  // set on every inbound hydrate/apply so remote-driven store changes don't echo.
  let lastSentDoc = store.toDoc()
  let applyingRemote = false   // true while mutating the store from a server frame
  let debounceTimer = null
  let stopWatch = null
  // True only while an ensureSession() first-connect flow is awaiting session/list
  // so a manual/dropdown list() refresh doesn't trigger an auto-resume.
  let autoResumePending = false
  const offHandlers = []

  // ── last-session persistence (page-reload resume) ──────────────────────────
  function persistUuid(uuid) {
    if (!storageKey || !uuid) return
    try { localStorage.setItem(storageKey, uuid) } catch { /* private mode / quota */ }
  }
  function readStoredUuid() {
    if (!storageKey) return null
    try { return localStorage.getItem(storageKey) } catch { return null }
  }

  // ── OUTBOUND ────────────────────────────────────────────────────────────────
  function flush() {
    debounceTimer = null
    // Only the producer emits; watchers are read-only, and nothing to send until
    // the session is established.
    if (!store.subscribed || !store.isProducer() || !store.sessionUuid) return

    const next  = store.toDoc()
    const patch = diffSessionDoc(lastSentDoc, next)
    if (patch.length === 0) return

    lastSentDoc = next
    logWs('send', SESSION_CS, 'patch', { ops: patch.length })
    workerSocket.send(SESSION_CS, 'patch', {
      session_uuid: store.sessionUuid,
      ops: patch,
      // Re-stamp the last-writer signature on every write so the stored
      // fingerprint always describes the bytes on disk (this build), not just
      // whoever first created the session.
      client_sha: CLIENT_SHA,
      doc_version: SESSION_DOC_VERSION,
    })
  }

  // Replace the ENTIRE server doc with our freshly normalized one. loadDoc()->
  // toDoc() has already dropped keys this build doesn't understand, so this is a
  // garbage-collection pass that a diff-patch stream can't do (a diff never
  // mentions a defunct key, so it lingers forever). Fired after resuming a
  // session whose stored signature differs from ours.
  function resync() {
    if (!store.subscribed || !store.isProducer() || !store.sessionUuid) return
    const doc = store.toDoc()
    lastSentDoc = doc
    logWs('send', SESSION_CS, 'resync', {})
    workerSocket.send(SESSION_CS, 'resync', {
      session_uuid: store.sessionUuid,
      doc,
      client_sha: CLIENT_SHA,
      doc_version: SESSION_DOC_VERSION,
    })
  }

  function scheduleFlush() {
    if (applyingRemote) return          // change originated from the server
    if (debounceTimer !== null) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(flush, EMIT_DEBOUNCE_MS)
  }

  // ── INBOUND ─────────────────────────────────────────────────────────────────
  // Drive content binding for each pane's ACTIVE tab through the normal open
  // flow. Idempotent (the surface composables no-op if already bound), so it is
  // safe to re-run after every inbound apply. Only active tabs — inactive tabs
  // bind when the user/driver activates them.
  function bindActiveSurfaces() {
    if (typeof bindActiveSurface !== 'function') return
    for (const pane of store.panes) {
      const key = pane?.activeTab
      if (!key) continue
      const tab = (pane.tabs || []).find((t) => t.key === key)
      if (tab) bindActiveSurface(tab)
    }
  }

  // Hydrate the whole store from a snapshot-bearing frame and re-baseline.
  function hydrate(payload, role) {
    applyingRemote = true
    try {
      store.loadDoc(payload?.doc)
      store.setSession({ session_uuid: payload?.session_uuid, name: payload?.name, role })
    } finally {
      applyingRemote = false
    }
    lastSentDoc = store.toDoc()
    if (role === 'producer') persistUuid(store.sessionUuid)
    bindActiveSurfaces()
  }

  function onCreated(payload)  { hydrate(payload, 'producer') }
  function onResumed(payload)  {
    hydrate(payload, 'producer')
    // If we resumed a session last written by a different build (SHA) or an
    // incompatible doc shape (doc_version), re-emit our normalized doc: this
    // drops any defunct keys the old build left behind and re-stamps the
    // signature to us. Same-signature resumes skip it (no-op churn avoided).
    const sha  = payload?.client_sha ?? null
    const docV = payload?.doc_version ?? null
    if (sha !== CLIENT_SHA || docV !== SESSION_DOC_VERSION) resync()
  }
  // A watcher's initial state also arrives as a snapshot; role stays whatever the
  // subscribe flow set (watcher). Default to 'watcher' if unset.
  function onSnapshot(payload) { hydrate(payload, store.role || 'watcher') }

  // Producer's own patch ack — just record the revision.
  function onPatched(payload) { store.setRev(payload?.rev) }

  // Watcher relay — apply the incoming ops and re-baseline so we don't bounce
  // them back (watchers don't emit anyway, but keep the baseline honest).
  function onPatch(payload) {
    applyingRemote = true
    try {
      store.applyOps(payload?.ops)
    } finally {
      applyingRemote = false
    }
    lastSentDoc = store.toDoc()
    bindActiveSurfaces()
  }

  // session/list — record the picker list, and (only when ensureSession is
  // awaiting it) apply the resume-or-create policy: prefer the session we last
  // owned on this browser (page-reload continuity), else the most-recent session
  // NOT currently in use by another tab; if every session is in use (or none
  // exist), start a brand-new one. The list is server-ordered newest-first.
  function onList(payload) {
    const list = Array.isArray(payload?.sessions) ? payload.sessions : []
    store.setSessions(list)
    if (!autoResumePending) return
    autoResumePending = false
    const preferred = readStoredUuid()
    // "Compatible" for auto-resume = the doc SHOULD load, i.e. it was written at
    // the same SESSION_DOC_VERSION. A differing build SHA alone is fine to resume
    // (the picker still flags it); a differing doc_version is not our first pick.
    const matches = (s) => (s.doc_version ?? null) === SESSION_DOC_VERSION
    // Prefer: the exact session we last owned (if version-compatible and free),
    // then the newest free version-MATCHING session, then any free session
    // (mismatch is resumable — the picker flags it — but not our first choice),
    // else start fresh.
    const pick =
      list.find((s) => s.session_uuid === preferred && !s.in_use && matches(s)) ||
      list.find((s) => !s.in_use && matches(s)) ||
      list.find((s) => s.session_uuid === preferred && !s.in_use) ||
      list.find((s) => !s.in_use)
    if (pick) resume(pick.session_uuid)
    else      create()
  }

  // session/deleted — a session we own (or watch) was garbage-collected. If it
  // was the one we're driving, reset local state and establish a replacement so
  // the tab is never left bound to a destroyed session.
  function onDeleted(payload) {
    const uuid = payload?.session_uuid
    if (!uuid) return
    store.setSessions((store.sessions || []).filter((s) => s.session_uuid !== uuid))
    if (uuid === store.sessionUuid) {
      store.reset()
      lastSentDoc = store.toDoc()
      ensureSession()
    }
  }

  // ── Lifecycle ───────────────────────────────────────────────────────────────
  function start() {
    if (stopWatch) return   // idempotent
    logInfo('useSessionSync', 'start')

    // Deep-watch the authoritative layout. usePanes methods mutate these, so this
    // single watch captures every layout change without per-method instrumentation.
    stopWatch = watch(
      () => [store.layout, store.activePaneIndex, store.panes],
      scheduleFlush,
      { deep: true },
    )

    offHandlers.push(
      workerSocket.on(SESSION_CS, 'created',   onCreated),
      workerSocket.on(SESSION_CS, 'resumed',   onResumed),
      workerSocket.on(SESSION_CS, 'snapshot',  onSnapshot),
      workerSocket.on(SESSION_CS, 'patched',   onPatched),
      workerSocket.on(SESSION_CS, 'patch',     onPatch),
      workerSocket.on(SESSION_CS, 'list',      onList),
      workerSocket.on(SESSION_CS, 'deleted',   onDeleted),
    )
  }

  function stop() {
    logInfo('useSessionSync', 'stop')
    if (debounceTimer !== null) { clearTimeout(debounceTimer); debounceTimer = null }
    if (stopWatch) { stopWatch(); stopWatch = null }
    offHandlers.splice(0).forEach((off) => { try { off() } catch { /* noop */ } })
  }

  // ── Producer-side commands (thin wrappers over the wire) ────────────────────
  function create({ fromUuid = null, name = null } = {}) {
    const payload = { client_version: VERSION, client_sha: CLIENT_SHA, doc_version: SESSION_DOC_VERSION }
    if (fromUuid) payload.from_uuid = fromUuid
    if (name != null) payload.name = name
    // A brand-new (non-fork) session seeds the server with the current layout.
    if (!fromUuid) payload.doc = store.toDoc()
    workerSocket.send(SESSION_CS, 'create', payload)
  }

  function resume(sessionUuid) {
    if (!sessionUuid) return
    workerSocket.send(SESSION_CS, 'resume', { session_uuid: sessionUuid })
  }

  function subscribe(sessionUuid) {
    if (!sessionUuid) return
    store.setSession({ role: 'watcher' })
    workerSocket.send(SESSION_CS, 'subscribe', { session_uuid: sessionUuid })
  }

  function unsubscribe(sessionUuid) {
    const uuid = sessionUuid || store.sessionUuid
    if (!uuid) return
    workerSocket.send(SESSION_CS, 'unsubscribe', { session_uuid: uuid })
  }

  // Garbage-collect a session the user owns. If it's the session we're currently
  // driving, the server's session/deleted handler (below) resets us and a fresh
  // ensureSession() spins up a replacement.
  function remove(sessionUuid) {
    const uuid = sessionUuid || store.sessionUuid
    if (!uuid) return
    logWs('send', SESSION_CS, 'delete', { session_uuid: uuid })
    workerSocket.send(SESSION_CS, 'delete', { session_uuid: uuid })
  }

  function list() {
    workerSocket.send(SESSION_CS, 'list', {})
  }
  // Establish this tab's session after the socket is (re)connected. Call on every
  // `system/connected`:
  //   • RECONNECT (we already own a session this page-life): silently re-resume
  //     the same uuid — the store kept it in memory across the drop.
  //   • FIRST connect: fetch the list and let onList apply resume-or-create.
  // Idempotent per connect; the reconnect path never spawns a second session.
  function ensureSession() {
    if (store.sessionUuid && store.isProducer()) {
      resume(store.sessionUuid)
      return
    }
    autoResumePending = true
    list()
  }

  return {
    start, stop,
    create, resume, subscribe, unsubscribe, list, remove,
    ensureSession,
    // exposed for tests / manual flush
    _flush: flush,
  }
}
