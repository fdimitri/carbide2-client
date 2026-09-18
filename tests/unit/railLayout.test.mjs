import test from 'node:test'
import assert from 'node:assert/strict'
import { layoutRail, segmentPath } from '../../src/utils/railLayout.js'

// The shape Graph.condense produces (oldest first, parents before children):
//
//   r2 ── r5 ── b2 ── m        main
//    └── f2 ────────┘          feature, merged into m
const nodes = [
  { id: 'r2', branch: 'main' },
  { id: 'r5', branch: 'main' },
  { id: 'f2', branch: 'feature' },
  { id: 'b2', branch: 'main' },
  { id: 'm',  branch: 'main' },
]
const edges = [
  { from: 'r2', to: 'r5', kind: 'parent' },
  { from: 'r2', to: 'f2', kind: 'parent' },
  { from: 'r5', to: 'b2', kind: 'parent' },
  { from: 'b2', to: 'm',  kind: 'parent' },
  { from: 'f2', to: 'm',  kind: 'second_parent' },
]

const seg = (list, row, fromLane, toLane) =>
  list.find((s) => s.row === row && s.fromLane === fromLane && s.toLane === toLane)

test('rows are newest first; main keeps lane 0, the branch takes lane 1', () => {
  const { rows, laneCount } = layoutRail(nodes, edges)
  assert.deepEqual(rows.map((r) => [r.node.id, r.lane]),
    [['m', 0], ['b2', 0], ['f2', 1], ['r5', 0], ['r2', 0]])
  assert.equal(laneCount, 2)
})

test('a merge curves out of the merge row into the branch lane; the fork curves back at the fork row', () => {
  const { segments } = layoutRail(nodes, edges)
  // m -> b2 straight down lane 0; m's second parent f2 leaves m's dot and curves into lane 1
  assert.ok(seg(segments, 0, 0, 0))
  const out = seg(segments, 0, 0, 1)
  assert.equal(out.kind, 'second_parent')
  // lane 1 continues straight past b2 into f2
  assert.ok(seg(segments, 1, 1, 1))
  // f2 -> r2 travels lane 1 past r5, then converges onto r2 in lane 0
  assert.ok(seg(segments, 2, 1, 1))
  assert.ok(seg(segments, 3, 1, 0))
  assert.ok(seg(segments, 3, 0, 0))
  // No segment leaves the last row.
  assert.equal(segments.filter((s) => s.row === 4).length, 0)
})

test('a root in a free lane frees it for the next branch that needs one', () => {
  // Two independent files' worth of history never happens (one file, one DAG),
  // but a deleted-branch dead end does: an unreachable run with no head edge.
  const n = [{ id: 'a' }, { id: 'b' }, { id: 'x' }, { id: 'c' }]
  const e = [{ from: 'a', to: 'b', kind: 'parent' }, { from: 'b', to: 'c', kind: 'parent' }, { from: 'a', to: 'x', kind: 'parent' }]
  const { rows, laneCount } = layoutRail(n, e)
  assert.deepEqual(rows.map((r) => [r.node.id, r.lane]), [['c', 0], ['x', 1], ['b', 0], ['a', 0]])
  assert.equal(laneCount, 2)
})

test('a parent listed after its child is placed below it anyway', () => {
  // Same DAG with the auto-branch visible, but a2 (b2's second parent) arrives
  // after b2 in the list: the layout must not open a lane for a "childless" a2.
  const n = [
    { id: 'r2' }, { id: 'r5' }, { id: 'f2' }, { id: 'b2' }, { id: 'a2' }, { id: 'm' },
  ]
  const e = [...edges,
    { from: 'r2', to: 'a2', kind: 'parent' },
    { from: 'a2', to: 'b2', kind: 'second_parent' },
  ]
  const { rows, laneCount } = layoutRail(n, e)
  const ids = rows.map((r) => r.node.id)
  assert.ok(ids.indexOf('b2') < ids.indexOf('a2'), 'child above parent')
  assert.ok(ids.indexOf('m') < ids.indexOf('f2'))
  assert.equal(laneCount, 3)
})

test('edges to nodes that are not present are ignored', () => {
  const { rows, segments } = layoutRail([{ id: 'a' }], [{ from: 'ghost', to: 'a', kind: 'parent' }])
  assert.deepEqual(rows.map((r) => r.lane), [0])
  assert.equal(segments.length, 0)
})

test('segmentPath: straight line in one lane, S-curve across lanes', () => {
  const g = { laneWidth: 10, rowHeight: 20 }
  assert.equal(segmentPath({ row: 1, fromLane: 0, toLane: 0 }, g), 'M0,20 L0,40')
  assert.equal(segmentPath({ row: 0, fromLane: 0, toLane: 1 }, g), 'M0,0 C0,10 10,10 10,20')
})
