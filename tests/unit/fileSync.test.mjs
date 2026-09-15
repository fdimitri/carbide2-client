// node --test tests/unit
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createFileSync } from '../../src/services/fileSync.js'
import { applyChanges, applyChange, minimalEdit } from '../../src/utils/textChanges.js'

const ins = (line, char, data) => ({ change_type: 'insertDataSingleLine', change_data: JSON.stringify({ startLine: line, startChar: char, data }) })

function harness() {
  const sent = []
  const view = { text: '' }
  const editor = {
    applyChanges: (cs) => { view.text = applyChanges(view.text, cs) },
    replaceContent: (t) => { view.text = t },
  }
  const sync = createFileSync({ path: '/f', send: (cmd, p) => sent.push({ cmd, ...p }), editor })
  const loaded = (content, revision) => {
    sync.load()
    const r = sync.onContent({ path: '/f', content, revision })
    view.text = r.content
  }
  const type = (...changes) => { view.text = applyChanges(view.text, changes); sync.localChanges(changes) }
  return { sent, view, sync, loaded, type }
}

test('one batch in flight; later edits queue and go out on the ack, based on its head', () => {
  const h = harness()
  h.loaded('abc', 'r0')
  h.type(ins(0, 3, 'd'))
  h.type(ins(0, 4, 'e'))
  const writes = h.sent.filter(s => s.cmd === 'write')
  assert.equal(writes.length, 1)
  assert.equal(writes[0].base_revision_id, 'r0')
  h.sync.onWritten({ path: '/f', mode: 'append', head: 'r1', batch_id: writes[0].batch_id })
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
  h.sync.onWritten({ path: '/f', mode: 'rebased', head: 'm1', branch_head: 'b1', batch_id: w.batch_id,
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
  h.sync.onWritten({ path: '/f', mode: 'rebased', head: 'm1', branch_head: 'b1', batch_id: w.batch_id,
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
  h.sync.onWritten({ path: '/f', mode: 'append', head: 'r1', batch_id: inflight.batch_id })
  const queued = h.sent.at(-1)
  assert.equal(queued.base_revision_id, 'r1')
  assert.deepEqual(queued.changes, [ins(0, 4, 'e')])
})

test('a refused batch drops local state and re-reads', () => {
  const h = harness()
  h.loaded('abc', 'r0')
  h.type(ins(0, 3, 'd'))
  const w = h.sent.at(-1)
  assert.equal(h.sync.onError({ path: '/f', error: 'conflict', conflict: true, resync: true, branch: 'auto/1/x', batch_id: w.batch_id }), true)
  assert.equal(h.sync.outstanding, false)
  assert.equal(h.sent.at(-1).cmd, 'read')
  h.sync.onContent({ path: '/f', content: 'XYZ', revision: 'r2' })
  assert.equal(h.view.text, 'XYZ')
  assert.equal(h.sync.state.baseRev, 'r2')
})

test('textChanges matches the server delta semantics', () => {
  assert.equal(applyChange('ab\ncd', 'insertDataMultiLine', JSON.stringify({ startLine: 0, startChar: 1, data: 'X\nY' })), 'aX\nYb\ncd')
  assert.equal(applyChange('ab\ncd', 'deleteDataMultiLine', JSON.stringify({ startLine: 0, startChar: 1, endLine: 1, endChar: 1 })), 'ad')
  assert.equal(applyChange('abcd', 'deleteDataSingleLine', JSON.stringify({ startLine: 0, startChar: 1, endChar: 3 })), 'ad')
  assert.equal(applyChange('ab\ncd', 'replaceDataMultiLine', JSON.stringify({ startLine: 0, startChar: 1, endLine: 1, endChar: 1, data: '-' })), 'a-d')
  assert.deepEqual(minimalEdit('hello world', 'hello brave world'), [6, 6, 'brave '])
  assert.equal(minimalEdit('same', 'same'), null)
})
