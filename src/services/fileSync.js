// fileSync — keeps one open text file in step with DBFS v2 (worker PROTOCOL 7).
//
// The client holds no revision DAG and does no OT. It tracks:
//
//   baseRev   the server revision the editor's content is known to equal,
//             excluding local edits not yet acknowledged
//   inflight  the one batch of local edits sent and not yet acknowledged
//   pending   local edits typed since (sent when the inflight batch is acked)
//
// Every batch is sent with base_revision_id = baseRev. The server serializes it:
// appended if baseRev is still the head, otherwise auto-branched at baseRev and
// rebased onto main one edit at a time. So a client that fell behind — a peer
// typed while our batch was in flight, or we were offline — just keeps sending;
// the ack of a rebased batch carries the edits that take our view to the head.
//
// Remote frames (another viewer's edits, an external change) are only applied
// when we hold no unacknowledged edits AND the frame's `parent` is our baseRev.
// While we hold edits they are ignored: our next batch is rebased past them and
// its ack brings them. A frame that doesn't follow baseRev means we missed something,
// so we re-read the file.
//
// Framework-free so it can be exercised without Vue or Monaco: the caller
// supplies `send` and an `editor` adapter.
//
//   const sync = createFileSync({ path, send, editor })
//   editor: { applyChanges(changes), replaceContent(text) }
//     changes: [{ change_type, change_data }] applied in order; change_data is
//     the JSON string of { startLine, startChar, endLine?, endChar?, data? }
//   send(cmd, payload): an 'fs' frame to the worker

let batchCounter = 0

function newBatchId() {
  batchCounter += 1
  const rnd = (globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`)
  return `${rnd}-${batchCounter}`
}

function sameRev(a, b) {
  return (a ?? null) === (b ?? null)
}

export function createFileSync({ path, send, editor, log = () => {} }) {
  const state = {
    path,
    loaded: false,
    connected: true,
    baseRev: null,
    inflight: null,   // { batchId, base, changes }
    pending: [],
    resyncing: false,
    discarding: false, // a batch was refused: the view holds edits main never took
  }

  const outstanding = () => !!state.inflight || state.pending.length > 0

  function load() {
    state.resyncing = state.loaded
    send('read', { path: state.path })
  }

  function resync(reason) {
    log('resync', reason)
    load()
  }

  function sendInflight() {
    const b = state.inflight
    send('write', { path: state.path, changes: b.changes, base_revision_id: b.base, batch_id: b.batchId })
  }

  function flush() {
    if (!state.loaded || !state.connected || state.inflight || state.pending.length === 0) return
    state.inflight = { batchId: newBatchId(), base: state.baseRev, changes: state.pending }
    state.pending = []
    sendInflight()
  }

  // fs/content. Returns { initial: true, content } for the first load (the
  // caller renders it), { applied: true } for a resync applied to the editor,
  // or { ignored: true }.
  function onContent(payload) {
    if (!state.loaded) {
      state.loaded = true
      state.baseRev = payload.revision ?? null
      state.pending = []
      state.resyncing = false
      return { initial: true, content: payload.content ?? '' }
    }
    // After a refused batch the view holds edits the server never took, so it
    // is replaced no matter what (onError already dropped the queue).
    if (state.discarding) {
      state.discarding = false
      state.pending = []
      editor.replaceContent(payload.content ?? '')
      state.baseRev = payload.revision ?? null
      state.resyncing = false
      return { applied: true }
    }
    // Edits typed since the re-read was requested are based on the view we
    // already have; don't pull the rug. The ack of their batch brings us up.
    if (outstanding()) {
      state.resyncing = false
      flush()
      return { ignored: true }
    }
    editor.replaceContent(payload.content ?? '')
    state.baseRev = payload.revision ?? null
    state.resyncing = false
    return { applied: true }
  }

  // Returns false when the edits were dropped: typed after a refused batch and
  // before the re-read that replaces the view (they're based on a view the
  // server never had).
  function localChanges(changes) {
    if (!changes || changes.length === 0) return true
    if (state.discarding) return false
    state.pending.push(...changes)
    flush()
    return true
  }

  // fs/written for this path.
  function onWritten(payload) {
    if (!state.inflight) return
    if (payload.batch_id && payload.batch_id !== state.inflight.batchId) return
    state.inflight = null

    if (payload.mode === 'rebased') {
      if (state.pending.length > 0) {
        // Our editor holds branch_head + pending. Base the next batch on our
        // own branch head (the server keeps the bridge from it to the head);
        // that ack brings the combined view.
        state.baseRev = payload.branch_head
      } else {
        editor.applyChanges(payload.changes || [])
        state.baseRev = payload.head
      }
    } else {
      state.baseRev = payload.head
    }
    flush()
  }

  // fs/change | fs/set_contents from someone else (or the watcher).
  function onRemote(kind, payload) {
    if (!state.loaded || state.discarding || outstanding()) return false
    if (!sameRev(payload.parent, state.baseRev)) {
      resync(`remote ${kind} parent ${payload.parent} != base ${state.baseRev}`)
      return false
    }
    if (kind === 'change') {
      editor.applyChanges([{ change_type: payload.change_type, change_data: payload.change_data }])
    } else if (kind === 'set_contents') {
      editor.replaceContent(payload.content ?? '')
    } else {
      return false
    }
    state.baseRev = payload.revision
    return true
  }

  // fs/error for this path. Returns true when it was a sync error handled here
  // (the batch was not applied to main; the view is re-read).
  function onError(payload) {
    if (!payload.resync) return false
    if (payload.batch_id && state.inflight && payload.batch_id !== state.inflight.batchId) return false
    log('write refused', payload.error, payload.branch)
    state.inflight = null
    state.pending = []
    state.discarding = true
    resync('write refused')
    return true
  }

  function onDisconnected() {
    state.connected = false
  }

  function onConnected() {
    state.connected = true
    if (!state.loaded) return load()
    if (state.inflight) return sendInflight()   // same batch_id: the server dedupes a batch it already applied
    if (state.pending.length > 0) return flush()
    resync('reconnected')
  }

  return {
    state,
    load,
    onContent,
    localChanges,
    onWritten,
    onRemote,
    onError,
    onDisconnected,
    onConnected,
    get outstanding() { return outstanding() },
  }
}
