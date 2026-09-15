// Rebase a sequence of edits onto concurrent ones, one edit at a time (the
// pure part of DbfsV2::Rebase.onto!, without the branch lock or storage).
//
//   rebase({ base, deltas, concurrent })
//     base        content both sequences start from (string)
//     deltas      the authored edits, in order, each against base + the ones before it
//     concurrent  the edits that landed since base, in order (set .priority to
//                 the revision's priority/id, as the server does, for tie-breaks)
//   => {
//     deltas   Delta[]  the authored edits transformed to apply after `concurrent`
//     bridge   hashes   the concurrent edits transformed to apply after the authored ones
//     content  string   base + concurrent + deltas  (the new head)
//     local    string   base + authored              (the author's state)
//   }
//   throws ConflictError when an authored edit overlaps a concurrent replace,
//   or when local + bridge does not reproduce content
//   throws RangeError when an authored edit is out of range for its state
//
// `deltas`/`concurrent` items may be Deltas, { type, ... } hashes or
// { change_type, change_data } specs. The server also appends an empty-insert
// carrier revision when every authored edit transformed away; that is a storage
// concern and not done here (deltas may come back empty).

import { TextBuffer } from './buffer.js'
import { Delta } from './delta.js'
import { ConflictError } from './errors.js'
import * as Transform from './transform.js'

export function rebase({ base, deltas, concurrent = [] }) {
  const local = new TextBuffer(base)
  const cstate = new TextBuffer(local.toString())
  let bridge = concurrent.map(x => {
    const d = Delta.from(x)
    const prims = Transform.toPrims(d, cstate)
    d.applyTo(cstate)
    return prims
  })
  const out = []

  deltas.forEach((x, i) => {
    const authored = Delta.from(x)
    authored.validateAgainst(local)
    authored.priority ??= authored.priorityFor(null)
    let prims = Transform.toPrims(authored, local)
    bridge = bridge.map(c => {
      if (Transform.isAmbiguous(prims, c)) {
        throw new ConflictError(`edit ${i} overlaps a concurrent replace`)
      }
      const moved = Transform.transformList(prims, c)
      const c2 = Transform.transformList(c, prims)
      prims = moved
      return c2
    })
    authored.applyTo(local)
    for (const h of Transform.deltasFor(prims, cstate)) {
      const d = Delta.fromHash(h)
      d.priority = authored.priority
      out.push(d)
    }
  })

  const check = new TextBuffer(local.toString())
  const bridgeDeltas = bridge.flatMap(c => Transform.deltasFor(c, check))
  if (check.toString() !== cstate.toString()) {
    throw new ConflictError(`rebase of ${deltas.length} edit(s) did not converge; refused`)
  }

  return { deltas: out, bridge: bridgeDeltas, content: cstate.toString(), local: local.toString() }
}
