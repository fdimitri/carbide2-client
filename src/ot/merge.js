// Three-way content merge (the pure part of DbfsV2::Merge).
//
// The server's merge_auto finds the DAG merge base and loads the three
// contents; here the caller supplies them. Each side is diffed against the base
// (line hunks refined to minimal splices), overlapping write regions are a
// conflict, otherwise theirs is transformed past ours and both are applied.

import { TextBuffer } from './buffer.js'
import { Delta } from './delta.js'
import { ConflictError } from './errors.js'
import * as Transform from './transform.js'
import { sortByKeys } from './util.js'

// Apply same-space prims right to left (descending start, list order on ties).
export function applyPrims(buf, prims) {
  for (const p of sortByKeys(prims, x => [-x.start])) {
    Delta.fromHash(Transform.toDelta(p, buf)).applyTo(buf)
  }
  return buf
}

export function regionsOf(prims) {
  return prims.map(p => ({
    start: p.start,
    end: p.finish,
    type: p.isInsert() ? 'insert' : (p.isReplace() ? 'replace' : 'delete'),
  }))
}

// [] when clean, else [{ target, source }] with the regions involved.
export function conflicts(base, ours, theirs) {
  const o = Transform.diffPrims(base, ours, 'ours')
  const t = Transform.diffPrims(base, theirs, 'theirs')
  if (!Transform.isAmbiguous(o, t)) return []
  return [{ target: regionsOf(o), source: regionsOf(t) }]
}

// Merged content, or throws ConflictError.
export function autoMergeContent(base, ours, theirs) {
  const o = Transform.diffPrims(base, ours, 'ours')
  const t = Transform.diffPrims(base, theirs, 'theirs')
  if (Transform.isAmbiguous(o, t)) throw new ConflictError('overlapping changes')
  const tPrime = Transform.transformList(t, o)
  const buf = new TextBuffer(base)
  applyPrims(buf, o)
  applyPrims(buf, tPrime)
  return buf.toString()
}

// { merged: true, content } | { merged: false, reason: 'conflict', conflicts }
export function mergeContents(base, ours, theirs) {
  const confs = conflicts(base, ours, theirs)
  if (confs.length > 0) return { merged: false, reason: 'conflict', conflicts: confs }
  return { merged: true, content: autoMergeContent(base, ours, theirs) }
}
