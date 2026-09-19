// node --test tests/unit
import { test, mock } from 'node:test'
import assert from 'node:assert/strict'
import { createFileSync, ACK_TIMEOUT_MS, MAX_SENDS } from '../../src/services/fileSync.js'
import { applyChanges, applyChange, minimalEdit, setContentsText } from '../../src/utils/textChanges.js'

const ins = (line, char, data) => ({ change_type: 'insertDataSingleLine', change_data: JSON.stringify({ startLine: line, startChar: char, data }) })

function harness(opts = {}) {
  const sent = []
  const view = { text: '' }
  const abandoned = []
  const editor = {
    applyChanges: (cs) => { view.text = applyChanges(view.text, cs) },
    replaceContent: (t) => { view.text = t },
  }
  const sync = createFileSync({ id: 'nid', send: (cmd, p) => sent.push({ cmd, ...p }), editor,
                                onAbandon: (b) => abandoned.push(b), ...opts })
  const loaded = (content, revision) => {
    sync.load()
    const r = sync.onContent({ id: 'nid', content, revision })
    view.text = r.content
  }
  const type = (...changes) => { view.text = applyChanges(view.text, changes); sync.localChanges(changes) }
  const writes = () => sent.filter(s => s.cmd === 'write')
  const reads = () => sent.filter(s => s.cmd === 'read')
  return { sent, view, sync, loaded, type, writes, reads, abandoned }
}

test('every read and write names the FileNode id and branch; main by default', () => {
  const h = harness()
  h.loaded('abc', 'r0')
  assert.equal(h.reads()[0].id, 'nid')
  assert.equal(h.reads()[0].path, undefined)
  assert.equal(h.reads()[0].branch, 'main')
  h.type(ins(0, 3, 'd'))
  assert.equal(h.writes()[0].id, 'nid')
  assert.equal(h.writes()[0].path, undefined)
  assert.equal(h.writes()[0].branch, 'main')

  const t = harness({ branch: 'topic' })
  t.loaded('abc', 'r0')
  assert.equal(t.reads()[0].branch, 'topic')
  t.type(ins(0, 3, 'd'))
  assert.equal(t.writes()[0].branch, 'topic')
  assert.equal(t.sync.state.branch, 'topic')
  assert.equal(t.sync.state.id, 'nid')
})

test('one batch in flight; later edits queue and go out on the ack, based on its head', () => {
  const h = harness()
  h.loaded('abc', 'r0')
  h.type(ins(0, 3, 'd'))
  h.type(ins(0, 4, 'e'))
  const writes = h.sent.filter(s => s.cmd === 'write')
  assert.equal(writes.length, 1)
  assert.equal(writes[0].base_revision_id, 'r0')
  h.sync.onWritten({ id: 'nid', mode: 'append', head: 'r1', batch_id: writes[0].batch_id })
  const second = h.sent.filter(s => s.cmd === 'write')[1]
  assert.equal(second.base_revision_id, 'r1')
  assert.deepEqual(second.changes, [ins(0, 4, 'e')])
})

test('rebased ack with nothing pending applies the changes to the view', () => {
  const h = harness()
  h.loaded('one\ntwo', 'r0')
  h.type(ins(1, 3, '!'))
  const w = h.sent.at(-1)
  // server: someone put X at the start; merge commit m1
  h.sync.onWritten({ id: 'nid', mode: 'rebased', head: 'm1', auto_branch_head: 'b1', batch_id: w.batch_id,
                     changes: [ins(0, 0, 'X')] })
  assert.equal(h.view.text, 'Xone\ntwo!')
  assert.equal(h.sync.state.baseRev, 'm1')
})

test('rebased ack while more is pending: next batch is based on our branch head, view untouched', () => {
  const h = harness()
  h.loaded('ab', 'r0')
  h.type(ins(0, 2, 'c'))
  const w = h.sent.at(-1)
  h.type(ins(0, 3, 'd'))
  h.sync.onWritten({ id: 'nid', mode: 'rebased', head: 'm1', auto_branch_head: 'b1', batch_id: w.batch_id,
                     changes: [ins(0, 0, 'X')] })
  assert.equal(h.view.text, 'abcd')
  const next = h.sent.at(-1)
  assert.equal(next.cmd, 'write')
  assert.equal(next.base_revision_id, 'b1')
})

test('remote frames apply only when idle and chained to the base; a gap re-reads', () => {
  const h = harness()
  h.loaded('abc', 'r0')
  assert.equal(h.sync.onRemote('change', { ...ins(0, 0, 'Z'), revision: 'r1', parent: 'r0' }), true)
  assert.equal(h.view.text, 'Zabc')
  const reads = () => h.sent.filter(s => s.cmd === 'read').length
  const before = reads()
  assert.equal(h.sync.onRemote('change', { ...ins(0, 0, 'Q'), revision: 'r9', parent: 'r7' }), false)
  assert.equal(reads(), before + 1)
  assert.equal(h.view.text, 'Zabc')
})

test('remote frames are ignored while our edits are unacknowledged', () => {
  const h = harness()
  h.loaded('abc', 'r0')
  h.type(ins(0, 3, 'd'))
  assert.equal(h.sync.onRemote('change', { ...ins(0, 0, 'Z'), revision: 'r1', parent: 'r0' }), false)
  assert.equal(h.view.text, 'abcd')
})

test('offline edits queue; reconnect sends them on the old base; an in-flight batch is resent with its batch_id', () => {
  const h = harness()
  h.loaded('abc', 'r0')
  h.type(ins(0, 3, 'd'))
  const inflight = h.sent.at(-1)
  h.sync.onDisconnected()
  h.type(ins(0, 4, 'e'))
  assert.equal(h.sent.filter(s => s.cmd === 'write').length, 1, 'nothing sent while offline')
  h.sync.onConnected()
  const resent = h.sent.at(-1)
  assert.equal(resent.batch_id, inflight.batch_id)
  assert.deepEqual(resent.changes, inflight.changes)
  h.sync.onWritten({ id: 'nid', mode: 'append', head: 'r1', batch_id: inflight.batch_id })
  const queued = h.sent.at(-1)
  assert.equal(queued.base_revision_id, 'r1')
  assert.deepEqual(queued.changes, [ins(0, 4, 'e')])
})

test('a refused batch drops local state and re-reads', () => {
  const h = harness()
  h.loaded('abc', 'r0')
  h.type(ins(0, 3, 'd'))
  const w = h.sent.at(-1)
  assert.equal(h.sync.onError({ id: 'nid', branch: 'main', error: 'conflict', conflict: true, resync: true, auto_branch: 'auto/1/x', batch_id: w.batch_id }), true)
  assert.equal(h.sync.outstanding, false)
  assert.equal(h.sent.at(-1).cmd, 'read')
  h.sync.onContent({ id: 'nid', content: 'XYZ', revision: 'r2' })
  assert.equal(h.view.text, 'XYZ')
  assert.equal(h.sync.state.baseRev, 'r2')
})

test('an unacknowledged batch is resent with its batch_id, then abandoned: queue dropped, file re-read, caller told', () => {
  mock.timers.enable({ apis: ['setTimeout'] })
  try {
    const h = harness()
    h.loaded('abc', 'r0')
    h.type(ins(0, 3, 'd'))
    const first = h.writes()[0]
    h.type(ins(0, 4, 'e'))                       // queued behind the inflight batch
    assert.equal(h.writes().length, 1)

    for (let n = 2; n <= MAX_SENDS; n++) {
      mock.timers.tick(ACK_TIMEOUT_MS)
      assert.equal(h.writes().length, n, `send ${n}`)
      assert.equal(h.writes().at(-1).batch_id, first.batch_id)
      assert.deepEqual(h.writes().at(-1).changes, first.changes)
    }
    const readsBefore = h.reads().length
    mock.timers.tick(ACK_TIMEOUT_MS)
    assert.equal(h.writes().length, MAX_SENDS, 'no further sends')
    assert.equal(h.sync.outstanding, false, 'inflight and pending dropped')
    assert.equal(h.reads().length, readsBefore + 1, 'file re-read')
    assert.equal(h.abandoned.length, 1)
    assert.equal(h.abandoned[0].batchId, first.batch_id)

    assert.equal(h.sync.localChanges([ins(0, 5, 'f')]), false, 'typing before the re-read is dropped')
    h.sync.onContent({ id: 'nid', content: 'abc', revision: 'r0' })
    assert.equal(h.view.text, 'abc')
    h.type(ins(0, 3, 'g'))
    assert.equal(h.writes().length, MAX_SENDS + 1, 'editing resumes after the reload')
  } finally {
    mock.timers.reset()
  }
})

test('an ack cancels the resend timer; a disconnect pauses it and the reconnect resend starts a fresh budget', () => {
  mock.timers.enable({ apis: ['setTimeout'] })
  try {
    const h = harness()
    h.loaded('abc', 'r0')
    h.type(ins(0, 3, 'd'))
    const w = h.writes()[0]
    h.sync.onWritten({ id: 'nid', mode: 'append', head: 'r1', batch_id: w.batch_id })
    mock.timers.tick(ACK_TIMEOUT_MS * MAX_SENDS * 2)
    assert.equal(h.writes().length, 1, 'acked batch is never resent')
    assert.equal(h.abandoned.length, 0)

    h.type(ins(0, 4, 'e'))
    assert.equal(h.writes().length, 2)
    mock.timers.tick(ACK_TIMEOUT_MS)                 // one resend used
    assert.equal(h.writes().length, 3)
    h.sync.onDisconnected()
    mock.timers.tick(ACK_TIMEOUT_MS * MAX_SENDS * 2)
    assert.equal(h.writes().length, 3, 'nothing sent while disconnected')
    assert.equal(h.abandoned.length, 0, 'not abandoned for a dead socket')
    h.sync.onConnected()
    assert.equal(h.writes().length, 4, 'resent on reconnect')
    for (let n = 1; n < MAX_SENDS; n++) mock.timers.tick(ACK_TIMEOUT_MS)
    assert.equal(h.writes().length, 3 + MAX_SENDS, 'full budget again after reconnect')
    assert.equal(h.abandoned.length, 0)
  } finally {
    mock.timers.reset()
  }
})

test('ackTimeoutMs: 0 disables the resend timer', () => {
  mock.timers.enable({ apis: ['setTimeout'] })
  try {
    const h = harness({ ackTimeoutMs: 0 })
    h.loaded('abc', 'r0')
    h.type(ins(0, 3, 'd'))
    mock.timers.tick(ACK_TIMEOUT_MS * MAX_SENDS * 2)
    assert.equal(h.writes().length, 1)
    assert.equal(h.abandoned.length, 0)
  } finally {
    mock.timers.reset()
  }
})

test('while a re-read is out, further gap frames are dropped instead of each requesting another read', () => {
  const h = harness()
  h.loaded('abc', 'r0')
  const reads = () => h.reads().length
  const before = reads()
  assert.equal(h.sync.onRemote('change', { ...ins(0, 0, 'Q'), revision: 'r9', parent: 'r7' }), false)
  assert.equal(reads(), before + 1)
  assert.equal(h.sync.onRemote('change', { ...ins(0, 0, 'R'), revision: 'r10', parent: 'r9' }), false)
  assert.equal(h.sync.onRemote('change', { ...ins(0, 0, 'S'), revision: 'r11', parent: 'r10' }), false)
  assert.equal(reads(), before + 1, 'one read per gap')
  assert.equal(h.view.text, 'abc')
  // A frame chained to the current base is also not applied mid-read: the
  // reply reflects it already.
  assert.equal(h.sync.onRemote('change', { ...ins(0, 0, 'Z'), revision: 'r1', parent: 'r0' }), false)
  h.sync.onContent({ id: 'nid', content: 'SRQabc', revision: 'r11' })
  assert.equal(h.view.text, 'SRQabc')
  assert.equal(h.sync.state.baseRev, 'r11')
  assert.equal(h.sync.onRemote('change', { ...ins(0, 0, 'T'), revision: 'r12', parent: 'r11' }), true)
  assert.equal(h.view.text, 'TSRQabc')
})

test('a refusal while a re-read is already out does not request a second read; that reply replaces the view', () => {
  const h = harness()
  h.loaded('abc', 'r0')
  h.sync.onRemote('change', { ...ins(0, 0, 'Q'), revision: 'r9', parent: 'r7' })   // gap -> read
  const before = h.reads().length
  h.type(ins(0, 3, 'd'))
  const w = h.writes().at(-1)
  assert.equal(h.sync.onError({ id: 'nid', error: 'conflict', resync: true, batch_id: w.batch_id }), true)
  assert.equal(h.reads().length, before, 'no duplicate read')
  h.sync.onContent({ id: 'nid', content: 'Qabc', revision: 'r9' })
  assert.equal(h.view.text, 'Qabc')
  assert.equal(h.sync.state.discarding, false)
  assert.equal(h.sync.state.baseRev, 'r9')
})

test('a disconnect forgets an outstanding re-read so the reconnect can issue one', () => {
  const h = harness()
  h.loaded('abc', 'r0')
  h.sync.onRemote('change', { ...ins(0, 0, 'Q'), revision: 'r9', parent: 'r7' })
  const before = h.reads().length
  h.sync.onDisconnected()
  h.sync.onConnected()
  assert.equal(h.reads().length, before + 1)
})

test('setContents change_data is read the same way on both apply paths', () => {
  assert.equal(setContentsText(JSON.stringify({ data: 'new text' })), 'new text')
  assert.equal(setContentsText({ data: 'new text' }), 'new text')
  assert.equal(setContentsText('plain'), 'plain')
  assert.equal(applyChange('old', 'setContents', JSON.stringify({ data: 'new text' })), 'new text')
})

test('textChanges matches the server delta semantics', () => {
  assert.equal(applyChange('ab\ncd', 'insertDataMultiLine', JSON.stringify({ startLine: 0, startChar: 1, data: 'X\nY' })), 'aX\nYb\ncd')
  assert.equal(applyChange('ab\ncd', 'deleteDataMultiLine', JSON.stringify({ startLine: 0, startChar: 1, endLine: 1, endChar: 1 })), 'ad')
  assert.equal(applyChange('abcd', 'deleteDataSingleLine', JSON.stringify({ startLine: 0, startChar: 1, endChar: 3 })), 'ad')
  assert.equal(applyChange('ab\ncd', 'replaceDataMultiLine', JSON.stringify({ startLine: 0, startChar: 1, endLine: 1, endChar: 1, data: '-' })), 'a-d')
  assert.deepEqual(minimalEdit('hello world', 'hello brave world'), [6, 6, 'brave '])
  assert.equal(minimalEdit('same', 'same'), null)
})
