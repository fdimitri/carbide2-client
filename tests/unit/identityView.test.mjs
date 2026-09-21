import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  chipId, eventKindLabel, eventLine, collapseEvents, folderMoveRoot,
  indexEntriesById, ghostEntries, identityRows, visibleAxis, tickIndexFor,
  playNextIndex, playStartIndex,
} from '../../src/utils/identityView.js'

const DIR  = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
const FILE = 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff'
const OTHER = 'cccccccc-dddd-4eee-8fff-000000000000'

test('chipId is the first 8 hex chars', () => {
  assert.equal(chipId(FILE), 'bbbbbbbb')
  assert.equal(chipId(''), '')
})

test('renamed displays as moved', () => {
  assert.equal(eventKindLabel('renamed'), 'moved')
  assert.equal(eventKindLabel('created'), 'created')
  assert.deepEqual(eventLine({ kind: 'renamed', from_path: '/old', path: '/new' }), {
    kind: 'moved', text: '/old → /new',
  })
})

test('a single rename is not collapsed', () => {
  const rows = collapseEvents([
    { kind: 'renamed', path: '/new', from_path: '/old', file_node_id: FILE },
  ])
  assert.equal(rows.length, 1)
  assert.equal(rows[0].count, 1)
  assert.equal(rows[0].children, null)
})

test('several renamed at one seq collapse to a folder move', () => {
  const events = [
    { kind: 'renamed', path: '/moved', from_path: '/dir', file_node_id: DIR, ftype: 'folder' },
    { kind: 'renamed', path: '/moved/a.rb', from_path: '/dir/a.rb', file_node_id: FILE, ftype: 'file' },
    { kind: 'created', path: '/other', file_node_id: OTHER, ftype: 'file' },
  ]
  const rows = collapseEvents(events)
  assert.equal(rows.length, 2)
  assert.equal(rows[0].kind, 'renamed')
  assert.equal(rows[0].from_path, '/dir')
  assert.equal(rows[0].path, '/moved')
  assert.equal(rows[0].count, 2)
  assert.equal(rows[0].children.length, 2)
  assert.equal(eventLine(rows[0]).text, '/dir → /moved · 2 paths')
  assert.equal(rows[1].kind, 'created')
  assert.equal(folderMoveRoot(events.filter((e) => e.kind === 'renamed')).from_path, '/dir')
})

test('a move is a ghost at the old path and a live chip at the new path', () => {
  const prev = indexEntriesById([
    { id: DIR, path: '/dir', ftype: 'folder' },
    { id: FILE, path: '/dir/a.rb', ftype: 'file' },
  ])
  const entries = [
    { id: DIR, path: '/moved', ftype: 'folder' },
    { id: FILE, path: '/moved/a.rb', ftype: 'file' },
  ]
  const ghosts = ghostEntries(entries, prev)
  assert.equal(ghosts.length, 2)
  assert.deepEqual(ghosts.map((g) => g.path).sort(), ['/dir', '/dir/a.rb'])
  const rows = identityRows(entries, prev)
  const fileLive = rows.find((r) => r.id === FILE && !r.ghost)
  const fileGhost = rows.find((r) => r.id === FILE && r.ghost)
  assert.equal(fileLive.path, '/moved/a.rb')
  assert.equal(fileGhost.path, '/dir/a.rb')
  assert.equal(fileLive.name, 'a.rb')
  assert.equal(fileGhost.name, 'a.rb')
  // Same UUID, not a create+delete pair of different rows without identity.
  assert.equal(rows.filter((r) => r.id === FILE).length, 2)
})

test('a delete is a ghost at the old path only', () => {
  const prev = indexEntriesById([{ id: FILE, path: '/gone.rb', ftype: 'file' }])
  const rows = identityRows([], prev)
  assert.equal(rows.length, 1)
  assert.equal(rows[0].ghost, true)
  assert.equal(rows[0].id, FILE)
  assert.equal(rows[0].name, 'gone.rb')
})

test('a create has no ghost', () => {
  const rows = identityRows([{ id: FILE, path: '/new.rb', ftype: 'file' }], {})
  assert.equal(rows.length, 1)
  assert.equal(rows[0].ghost, false)
  assert.equal(rows[0].id, FILE)
})

test('unchanged identity is live only — not create+delete', () => {
  const e = { id: FILE, path: '/same.rb', ftype: 'file' }
  const rows = identityRows([e], indexEntriesById([e]))
  assert.equal(rows.length, 1)
  assert.equal(rows[0].ghost, false)
})

test('nested indent follows dirname', () => {
  const rows = identityRows([
    { id: DIR, path: '/dir', ftype: 'folder' },
    { id: FILE, path: '/dir/a.rb', ftype: 'file' },
  ], {})
  assert.equal(rows[0].id, DIR)
  assert.equal(rows[0].depth, 0)
  assert.equal(rows[1].id, FILE)
  assert.equal(rows[1].depth, 1)
})

const AXIS = {
  branch: 'feature',
  segments: [
    {
      branch: 'main',
      ticks: [{ seq: 1, node_id: 'n1' }, { seq: 2, node_id: 'n2' }],
      marks: [{ seq: 2, node_id: 'n2', kind: 'snapshot', name: 'cut' }],
    },
    {
      branch: 'feature',
      ticks: [{ seq: 5, node_id: 'n5' }],
      marks: [{ seq: 5, node_id: 'n5', kind: 'fork', from: 'main' }],
    },
  ],
}

test('this branch only is the last segment', () => {
  const vis = visibleAxis(AXIS, false)
  assert.deepEqual(vis.ticks.map((t) => t.seq), [5])
  assert.equal(vis.ticks[0].branch, 'feature')
  assert.equal(vis.marks.length, 1)
  assert.equal(vis.marks[0].kind, 'fork')
  assert.equal(vis.segments.length, 1)
})

test('include ancestry is every segment', () => {
  const vis = visibleAxis(AXIS, true)
  assert.deepEqual(vis.ticks.map((t) => [t.branch, t.seq]), [['main', 1], ['main', 2], ['feature', 5]])
  assert.equal(vis.marks.find((m) => m.kind === 'snapshot').branch, 'main')
  assert.equal(vis.segments.length, 2)
})

test('a PROTOCOL 13 axis with no segments is one segment', () => {
  const vis = visibleAxis({
    branch: 'feature',
    ticks: [{ seq: 5, node_id: 'n5' }],
    marks: [{ seq: 5, name: 'cut' }],
  }, true)
  assert.equal(vis.ticks[0].branch, 'feature')
  assert.equal(vis.ticks.length, 1)
})

test('tickIndexFor hits the exact tick, else the last seq at or before', () => {
  const vis = visibleAxis(AXIS, true)
  assert.equal(tickIndexFor(vis.ticks, 5, 'feature'), 2)
  assert.equal(tickIndexFor(vis.ticks, 2, 'main'), 1)
  assert.equal(tickIndexFor(vis.ticks, 3, 'main'), 1, 'snapshot seq between running nodes')
  assert.equal(tickIndexFor(vis.ticks, 1, 'main'), 0)
})

test('playNextIndex walks forward and reverse and stops at the ends', () => {
  assert.equal(playNextIndex(0, 4, 1), 1)
  assert.equal(playNextIndex(2, 4, 1), 3)
  assert.equal(playNextIndex(3, 4, 1), null)
  assert.equal(playNextIndex(3, 4, -1), 2)
  assert.equal(playNextIndex(0, 4, -1), null)
  assert.equal(playNextIndex(0, 1, 1), null)
  assert.equal(playNextIndex(0, 4, 0), null)
})

test('playStartIndex restarts from the other end when already at the stop', () => {
  assert.equal(playStartIndex(2, 4, 1), 2)
  assert.equal(playStartIndex(3, 4, 1), 0)
  assert.equal(playStartIndex(0, 4, -1), 3)
  assert.equal(playStartIndex(1, 4, -1), 1)
  assert.equal(playStartIndex(0, 1, 1), null)
})
