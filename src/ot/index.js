// Client-side port of the DBFS v2 operational-transform core
// (carbide2-server lib/dbfs_v2: buffer, delta, myers, transform, and the pure
// parts of merge and rebase). Framework-free; nothing in the app imports it yet.
//
//   import { TextBuffer, Delta, Transform, Merge, rebase } from '../ot/index.js'
//
//   const base = new TextBuffer('one\ntwo')
//   const a = Delta.fromChange({ change_type: 'insertDataSingleLine', change_data: '{"startLine":0,"startChar":0,"data":"X"}' })
//   const b = new Delta('deleteDataSingleLine', { startLine: 1, startChar: 0, endChar: 3 })
//   a.priority = 'rev-a'; b.priority = 'rev-b'
//   const [aPrime, bPrime] = Transform.transform(a, b, base)   // TP1: a·b' == b·a'
//
//   Merge.mergeContents(base, ours, theirs)                     // three-way
//   rebase({ base, deltas: mine, concurrent: theirs })          // edits past edits
//
// Semantics match the server so both sides can compute the same result, with
// two known gaps:
//   * offsets are UTF-16 code units (JS/Monaco); the server counts code points,
//     so text with characters outside the BMP (emoji) indexes differently;
//   * PCRE patterns run on JS RegExp with Ruby's common syntax mapped
//     (see rubyRegex.js); Onigmo-only constructs throw.
// And one inherited property: TP1 holds, TP2 does not (server decisions #20).

export { TextBuffer } from './buffer.js'
export { Delta, CHANGE_TYPES } from './delta.js'
export { ConflictError, OverlapConflict } from './errors.js'
export { rebase } from './rebase.js'
export { sha1Hex } from './sha1.js'
export * as Transform from './transform.js'
export * as Merge from './merge.js'
export * as Myers from './myers.js'
export { Prim } from './transform.js'
