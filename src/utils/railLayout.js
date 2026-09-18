// railLayout — lay a condensed revision DAG (fs/dag) out as a git-style rail
// graph: one row per node, newest first; lanes are columns; an edge is drawn
// as segments between consecutive rows, curving when it changes lane.
//
// Input: `nodes` oldest-first, topologically ordered (every parent before its
// children — Graph.condense guarantees this), and `edges` { from: parent id,
// to: child id, kind: 'parent' | 'second_parent' }.
//
// Output:
//   rows      [{ node, lane }]                      row i is rows[i]; y grows downwards
//   segments  [{ row, fromLane, toLane, kind, lane }]
//             a line from the centre of `row` to the centre of `row + 1`:
//             leaving (row, fromLane), arriving (row + 1, toLane). `lane` is the
//             lane that carries the edge (for colouring); kind is the edge kind.
//   laneCount how many lanes were needed
//
// The walk, newest first: a node lands in the lane already waiting for it (the
// lane its first child reserved for it), else the first free lane. Every lane
// waiting for it converges onto it. It then reserves its own lane for its first
// parent, and for a second parent either joins a lane already waiting for that
// parent or opens a new one. A lane is freed when the node it waited for is
// placed and reserves nothing (a root).

export function layoutRail(nodes, edges) {
  const present = new Set(nodes.map((n) => n.id))
  const parentsOf = new Map()   // child id -> [{ id, kind }] first parent first
  for (const e of edges) {
    if (!present.has(e.from) || !present.has(e.to)) continue
    const list = parentsOf.get(e.to) || []
    if (e.kind === 'second_parent') list.push({ id: e.from, kind: e.kind })
    else list.unshift({ id: e.from, kind: 'parent' })
    parentsOf.set(e.to, list)
  }

  const order = topological(nodes, parentsOf).reverse()   // newest first
  const rows = []
  const segments = []
  // lanes[i] = null | { waiting: parent id, kind, srcs: [lane indexes the segment
  // into the next row leaves from] }
  let lanes = []
  let laneCount = 0

  order.forEach((node, row) => {
    // Where does this node land?
    let lane = lanes.findIndex((l) => l && l.waiting === node.id)
    if (lane === -1) {
      lane = lanes.findIndex((l) => l == null)
      if (lane === -1) { lane = lanes.length; lanes.push(null) }
    }
    laneCount = Math.max(laneCount, lane + 1)

    // Segments from the previous row into this one: every lane either
    // converges here (it was waiting for us) or continues straight.
    if (row > 0) {
      lanes.forEach((l, i) => {
        if (!l) return
        const toLane = l.waiting === node.id ? lane : i
        for (const src of l.srcs) {
          segments.push({ row: row - 1, fromLane: src, toLane, kind: l.kind, lane: i })
        }
        l.srcs = [i]
      })
    }

    // Lanes that were waiting for us are done with that wait.
    lanes = lanes.map((l) => (l && l.waiting === node.id ? null : l))
    rows.push({ node, lane })

    const parents = parentsOf.get(node.id) || []
    if (parents.length === 0) {
      lanes[lane] = null
    } else {
      lanes[lane] = { waiting: parents[0].id, kind: parents[0].kind, srcs: [lane] }
      for (const p of parents.slice(1)) {
        const j = lanes.findIndex((l) => l && l.waiting === p.id)
        if (j !== -1) {
          // Already a lane heading there: our dot also feeds it.
          lanes[j].srcs.push(lane)
        } else {
          let k = lanes.findIndex((l) => l == null)
          if (k === -1) { k = lanes.length; lanes.push(null) }
          lanes[k] = { waiting: p.id, kind: p.kind, srcs: [lane] }
          laneCount = Math.max(laneCount, k + 1)
        }
      }
    }
    // Trim trailing free lanes so laneCount reflects real width.
    while (lanes.length && lanes[lanes.length - 1] == null) lanes.pop()
  })

  return { rows, segments, laneCount }
}

// `nodes` with every parent before its children, keeping the given order
// otherwise. The server already sends it this way; this only guards against a
// child that arrives first (it is held back until its parents are placed).
function topological(nodes, parentsOf) {
  const done = new Set()
  const waiting = new Map()   // parent id -> nodes waiting on it
  const out = []
  const pendingParent = (n) => (parentsOf.get(n.id) || []).find((p) => !done.has(p.id))?.id
  for (const n of nodes) {
    const w = pendingParent(n)
    if (w) { (waiting.get(w) || waiting.set(w, []).get(w)).push(n); continue }
    const stack = [n]
    while (stack.length) {
      const x = stack.pop()
      if (done.has(x.id)) continue
      const wx = pendingParent(x)
      if (wx) { (waiting.get(wx) || waiting.set(wx, []).get(wx)).push(x); continue }
      out.push(x)
      done.add(x.id)
      const kids = waiting.get(x.id)
      if (kids) { waiting.delete(x.id); for (let i = kids.length - 1; i >= 0; i--) stack.push(kids[i]) }
    }
  }
  // Anything still waiting is in a cycle or depends on a missing node: append as-is.
  for (const list of waiting.values()) for (const n of list) if (!done.has(n.id)) { out.push(n); done.add(n.id) }
  return out
}

// SVG path for one segment, given row/lane geometry. A lane change is an
// S-curve within the row gap; a straight run is a line.
export function segmentPath(seg, { laneWidth, rowHeight, x0 = 0, y0 = 0 }) {
  const x1 = x0 + seg.fromLane * laneWidth
  const x2 = x0 + seg.toLane * laneWidth
  const y1 = y0 + seg.row * rowHeight
  const y2 = y1 + rowHeight
  if (x1 === x2) return `M${x1},${y1} L${x2},${y2}`
  const ym = (y1 + y2) / 2
  return `M${x1},${y1} C${x1},${ym} ${x2},${ym} ${x2},${y2}`
}
