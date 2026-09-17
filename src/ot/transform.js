// Operational transform over flat-offset primitives (port of DbfsV2::Transform).
//
// A Prim is { start, finish, text, priority } over one coordinate space:
//   insert  start === finish
//   delete  start < finish, text === ''
//   replace start < finish, text !== ''
//
// TP1 holds for transform(a, b): applying a then b' equals b then a'. TP2 does
// NOT hold (server docs/decisions.md #20), so, as on the server, each edit
// should be transformed along one serialized order; transforming the same op
// past concurrent ops in different orders at different sites can diverge.

import { TextBuffer } from './buffer.js'
import { Delta } from './delta.js'
import * as Myers from './myers.js'
import { cmp, cmpKeys, sortByKeys } from './util.js'

// `claim` marks a prim taken from a diff of a whole-file snapshot (setContents,
// a content merge); real edits have none (server decisions #29):
//   'lines'      rewrites or removes whole lines, each ending in a newline; any
//                other change touching one of them is ambiguous
//   'lines_eof'  the same, for lines running to the end of the text
//   'before'     only adds whole lines at a line start; touches no existing
//                line, and goes before any other same-point insert
export class Prim {
  constructor(start, finish, text, priority, claim = null) {
    this.start = start
    this.finish = finish
    this.text = text
    this.priority = priority
    this.claim = claim
  }
  isInsert() { return this.start === this.finish }
  isDelete() { return this.start < this.finish && this.text === '' }
  isReplace() { return this.start < this.finish && this.text !== '' }
  get length() { return this.finish - this.start }
  get ilength() { return this.text.length }
  toArray() { return [this.start, this.finish, this.text, this.priority, this.claim] }
}

const asBuffer = base => (base instanceof TextBuffer ? base : new TextBuffer(base))

const hashToDelta = h => Delta.fromHash(h)

// Transform two concurrent deltas authored against `base` (a TextBuffer or
// string). Returns [aPrime, bPrime] as lists of delta hashes: aPrime applies
// after b, bPrime after a.
export function transform(a, b, base) {
  const buf = asBuffer(base)
  if (isOpaque(a) || isOpaque(b)) return transformOpaque(a, b, buf)

  const aPrims = toPrims(a, buf)
  const bPrims = toPrims(b, buf)
  if (isAmbiguous(aPrims, bPrims)) return transformOpaque(a, b, buf)

  const aPrime = transformList(aPrims, bPrims)
  const bPrime = transformList(bPrims, aPrims)
  return [encode(aPrime, buf, b), encode(bPrime, buf, a)]
}

export function isOpaque(delta) {
  return delta.isPcreReplace()
}

// Diff old -> new into prims, one per line hunk (Myers over lines with their
// trailing newline). A diff only guesses what was edited, so hunks are not
// refined to minimal splices: rewritten or removed lines are one prim with a
// claim on them, added lines an insert claimed 'before' (see Prim).
export function diffPrims(oldText, newText, priority) {
  if (oldText === newText) return []
  const oldT = diffTokens(oldText)
  const newT = diffTokens(newText)
  const hs = diffHunks(oldT, newT)
  const offs = [0]
  for (const t of oldT) offs.push(offs[offs.length - 1] + t.length)
  const out = []
  for (const [os, oe, ns, ne] of hs) {
    const start = offs[os]
    const finish = offs[oe]
    const text = newT.slice(ns, ne).join('')
    if (start === finish && text === '') continue
    if (os === oe) {
      out.push(new Prim(start, finish, text, priority, 'before'))
      continue
    }
    const eof = oe === oldT.length && !oldT[oldT.length - 1].endsWith('\n')
    out.push(new Prim(start, finish, text, priority, eof ? 'lines_eof' : 'lines'))
  }
  return out
}

// Lines including their trailing newline (the last may have none).
// The empty string is one empty line, as in TextBuffer.
export function diffTokens(str) {
  if (str === '') return ['']
  const lines = str.split('\n')
  return lines.map((l, i) => (i < lines.length - 1 ? l + '\n' : l))
}

export function diffHunks(a, b) {
  return Myers.hunks(a, b) ?? diffHunksFallback(a, b)
}

export function diffHunksFallback(a, b) {
  const n = a.length
  const m = b.length
  let p = 0
  while (p < n && p < m && a[p] === b[p]) p++
  let s = 0
  while (s < n - p && s < m - p && a[n - 1 - s] === b[m - 1 - s]) s++
  return [[p, n - s, p, m - s]]
}

// True when a replace overlaps any prim of the other side, an insert falls
// strictly inside a replace, or either side touches a line the other's
// snapshot diff claimed. Such pairs have no intention-preserving transform.
export function isAmbiguous(aPrims, bPrims) {
  return aPrims.some(ap => ap.isReplace() && bPrims.some(bp => regionsOverlap(ap, bp))) ||
    bPrims.some(bp => bp.isReplace() && aPrims.some(ap => regionsOverlap(ap, bp))) ||
    aPrims.some(ap => bPrims.some(bp => touchesClaim(ap, bp) || touchesClaim(bp, ap)))
}

// Does `o` change a line that claimed prim `c` rewrites? c covers whole lines
// [c.start, c.finish); a newline belongs to the line it ends.
export function touchesClaim(c, o) {
  if (c.claim !== 'lines' && c.claim !== 'lines_eof') return false
  if (o.isInsert()) {
    const p = o.start
    if (c.start < p && p < c.finish) return true
    if (p === c.finish && c.claim === 'lines_eof') return true
    return p === c.start && !o.text.endsWith('\n')
  }
  return o.start < c.finish && c.start < o.finish
}

export function regionsOverlap(x, y) {
  if (x.isInsert() && y.isInsert()) return false
  const xs = x.start
  const xe = x.isInsert() ? x.start : x.finish
  const ys = y.start
  const ye = y.isInsert() ? y.start : y.finish
  return xs < ye && ys < xe
}

// Opaque ops: apply both in a deterministic order and hand each side the
// resulting snapshot, so either application order converges.
export function transformOpaque(a, b, base) {
  const key = d => [String(d.priority ?? ''), d.type, JSON.stringify(d.payload)]
  const ordered = [a, b].sort((x, y) => cmpKeys(key(x), key(y)))
  const merged = new TextBuffer(asBuffer(base).toString())
  for (const d of ordered) d.applyTo(merged)
  const sc = { type: 'setContents', data: merged.toString() }
  return [[sc], [{ ...sc }]]
}

// Transform each of `ops` past all of `others`. Both lists are same-space, so
// `others` is folded right to left (descending start, list order on ties),
// which is a valid chained sequence.
export function transformList(ops, others) {
  const chained = sortByKeys(others, o => [-o.start])
  return ops.flatMap(op => chained.reduce((acc, other) => acc.flatMap(o => {
    const out = transformOne(o, other)
    for (const t of out) t.claim = o.claim // a prim keeps its claim wherever it moves
    return out
  }), [op]))
}

export function encode(prims, base, applied) {
  const buf = new TextBuffer(asBuffer(base).toString())
  applied.applyTo(buf)
  return deltasFor(prims, buf)
}

// Delta hashes for a same-space prim list, applied right to left to `buf`
// (which is advanced); the returned sequence is a valid chained patch.
export function deltasFor(prims, buf) {
  return sortByKeys(prims, p => [-p.start]).map(p => {
    const h = toDelta(p, buf)
    hashToDelta(h).applyTo(buf)
    return h
  })
}

export function transformOne(a, b) {
  if (a.isInsert() && b.isInsert()) return transformII(a, b)
  if (a.isInsert() && b.isDelete()) return transformID(a, b)
  if (a.isInsert() && b.isReplace()) return transformIR(a, b)
  if (a.isDelete() && b.isInsert()) return transformDI(a, b)
  if (a.isDelete() && b.isDelete()) return transformDD(a, b)
  if (a.isDelete() && b.isReplace()) return transformDR(a, b)
  if (a.isReplace() && b.isInsert()) return transformRI(a, b)
  if (a.isReplace() && b.isDelete()) return transformRD(a, b)
  if (a.isReplace() && b.isReplace()) return transformRR(a, b)
  return [a]
}

const P = (s, f, t, pr) => new Prim(s, f, t, pr)

// At a tie, a snapshot's added lines go before a plain insert; otherwise
// priority decides.
function insertFirst(a, b) {
  const aLines = a.claim === 'before' && b.claim !== 'before'
  const bLines = b.claim === 'before' && a.claim !== 'before'
  if (aLines) return true
  if (bLines) return false
  return cmp(a.priority, b.priority) <= 0
}

function transformII(a, b) {
  if (a.start < b.start || (a.start === b.start && insertFirst(a, b))) return [a]
  return [P(a.start + b.ilength, a.finish + b.ilength, a.text, a.priority)]
}

function transformID(a, b) {
  if (a.start <= b.start) return [a]
  if (a.start >= b.finish) return [P(a.start - b.length, a.finish - b.length, a.text, a.priority)]
  return [P(b.start, b.start, a.text, a.priority)]
}

function transformIR(a, b) {
  if (a.start <= b.start) return [a]
  if (a.start >= b.finish) {
    const shift = b.ilength - b.length
    return [P(a.start + shift, a.finish + shift, a.text, a.priority)]
  }
  return [P(b.start, b.start, a.text, a.priority)]
}

function transformDI(a, b) {
  if (b.start <= a.start) return [P(a.start + b.ilength, a.finish + b.ilength, a.text, a.priority)]
  if (b.start >= a.finish) return [a]
  // Insert inside the deleted range: split the delete around it (same space).
  return [
    P(a.start, b.start, '', a.priority),
    P(b.start + b.ilength, a.finish + b.ilength, '', a.priority),
  ]
}

function transformDD(a, b) {
  if (b.finish <= a.start) return [P(a.start - b.length, a.finish - b.length, '', a.priority)]
  if (b.start >= a.finish) return [a]
  const out = []
  if (a.start < b.start) out.push(P(a.start, b.start, '', a.priority))
  if (a.finish > b.finish) out.push(P(b.start, b.start + (a.finish - b.finish), '', a.priority))
  return out
}

function transformDR(a, b) {
  if (a.finish <= b.start) return [a]
  if (a.start >= b.finish) {
    const shift = b.length - b.ilength
    return [P(a.start - shift, a.finish - shift, '', a.priority)]
  }
  const out = []
  if (a.start < b.start) out.push(P(a.start, b.start, '', a.priority))
  if (a.finish > b.finish) {
    out.push(P(b.start + b.ilength, b.start + b.ilength + (a.finish - b.finish), '', a.priority))
  }
  return out
}

function transformRI(a, b) {
  if (b.start <= a.start) return [P(a.start + b.ilength, a.finish + b.ilength, a.text, a.priority)]
  if (b.start >= a.finish) return [a]
  throw new Error('transformRI: insert inside replace must route to opaque (invariant violated)')
}

function transformRD(a, b) {
  if (a.finish <= b.start) return [a]
  if (a.start >= b.finish) return [P(a.start - b.length, a.finish - b.length, a.text, a.priority)]
  if (b.start <= a.start && b.finish >= a.finish) return [P(b.start, b.start, a.text, a.priority)]
  throw new Error('transformRD: overlapping replace/delete must route to opaque (invariant violated)')
}

function transformRR(a, b) {
  if (a.finish <= b.start) return [a]
  const shift = b.length - b.ilength
  return [P(a.start - shift, a.finish - shift, a.text, a.priority)]
}

// Delta -> prims in `base`'s coordinate space.
export function toPrims(delta, base) {
  const buf = asBuffer(base)
  switch (delta.type) {
    case 'setContents':
      return diffPrims(buf.toString(), delta.data, delta.priorityFor(buf))
    case 'insertDataSingleLine':
    case 'insertDataMultiLine': {
      const o = buf.offset(delta.startLine, delta.startChar)
      return [P(o, o, delta.data, delta.priorityFor(buf))]
    }
    case 'deleteDataSingleLine':
    case 'deleteDataMultiLine': {
      const s = buf.offset(delta.startLine, delta.startChar)
      const e = delta.type === 'deleteDataSingleLine'
        ? buf.offset(delta.startLine, delta.endChar)
        : buf.offset(delta.endLine, delta.endChar)
      return [P(s, e, '', delta.priorityFor(buf))]
    }
    case 'replaceDataSingleLine':
    case 'replaceDataMultiLine': {
      const s = buf.offset(delta.startLine, delta.startChar)
      const e = delta.type === 'replaceDataSingleLine'
        ? buf.offset(delta.startLine, delta.endChar)
        : buf.offset(delta.endLine, delta.endChar)
      return [P(s, e, delta.data, delta.priorityFor(buf))]
    }
    case 'pcreReplaceSingleLine':
    case 'pcreReplaceMultiLine':
      return delta.matches(buf).map(([b, e, rep]) => P(b, e, rep, delta.priorityFor(buf)))
    default:
      throw new Error(`unknown delta type ${delta.type}`)
  }
}

// Prim -> multi-line delta hash in `buf`'s coordinates.
export function toDelta(prim, buf) {
  const [sl, sc] = buf.position(prim.start)
  const [el, ec] = buf.position(prim.finish)
  if (prim.isDelete()) return { type: 'deleteDataMultiLine', startLine: sl, startChar: sc, endLine: el, endChar: ec }
  if (prim.isInsert()) return { type: 'insertDataMultiLine', startLine: sl, startChar: sc, data: prim.text }
  return { type: 'replaceDataMultiLine', startLine: sl, startChar: sc, endLine: el, endChar: ec, data: prim.text }
}
