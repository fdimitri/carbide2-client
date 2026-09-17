// src/ot — ported from carbide2-server test/dbfs_v2 (buffer, delta, pcre,
// transform, diff) plus client-specific checks. Convergence and merge/rebase
// properties are in ot-properties.test.mjs; differential checks against the
// Ruby implementation are in tests/parity.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { TextBuffer, Delta, Transform, Merge, Myers, ConflictError, OverlapConflict, rebase, sha1Hex } from '../../src/ot/index.js'
import { applyChange } from '../../src/utils/textChanges.js'

const b = s => new TextBuffer(s)
const d = (type, payload, priority) => {
  const x = new Delta(type, payload)
  if (priority != null) x.priority = priority
  return x
}
const applyHashes = (text, hashes) => hashes.reduce((t, h) => Delta.fromHash(h).applyToString(t), text)

// --- buffer -------------------------------------------------------------------
test('buffer: empty is one empty line; trailing newline kept', () => {
  assert.deepEqual(b('').lines, [''])
  assert.equal(b('').toString(), '')
  assert.deepEqual(b('a\nb\n').lines, ['a', 'b', ''])
  assert.equal(b('a\nb\n').toString(), 'a\nb\n')
})

test('buffer: offset flattens newlines, position inverts it, both clamp', () => {
  const x = b('ab\ncd')
  assert.deepEqual([[0, 0], [0, 1], [0, 2], [1, 0], [1, 2]].map(([l, c]) => x.offset(l, c)), [0, 1, 2, 3, 5])
  assert.deepEqual([0, 2, 3, 5].map(o => x.position(o)), [[0, 0], [0, 2], [1, 0], [1, 2]])
  assert.equal(b('abc').offset(99, 99), 3)
  assert.equal(b('abc').offset(-5, -5), 0)
  assert.deepEqual(x.position(99), [1, 2])
})

// --- delta --------------------------------------------------------------------
test('delta: insert, delete, replace, setContents', () => {
  assert.equal(d('insertDataSingleLine', { startLine: 0, startChar: 1, data: 'X' }).applyToString('ab'), 'aXb')
  assert.equal(d('insertDataMultiLine', { startLine: 0, startChar: 1, data: 'X\nY' }).applyToString('ab\ncd'), 'aX\nYb\ncd')
  assert.equal(d('deleteDataSingleLine', { startLine: 0, startChar: 1, endChar: 3 }).applyToString('abcd'), 'ad')
  assert.equal(d('deleteDataMultiLine', { startLine: 0, startChar: 1, endLine: 2, endChar: 1 }).applyToString('a\nbb\nccc'), 'acc')
  assert.equal(d('replaceDataSingleLine', { startLine: 0, startChar: 1, endChar: 4, data: 'XY' }).applyToString('abcdef'), 'aXYef')
  assert.equal(d('setContents', { data: 'new\nline' }).applyToString('old'), 'new\nline')
})

test('delta: ranges and predicates', () => {
  assert.deepEqual(d('insertDataSingleLine', { startLine: 1, startChar: 1, data: 'X' }).range(b('ab\ncd')), [4, 4])
  assert.deepEqual(d('deleteDataMultiLine', { startLine: 0, startChar: 1, endLine: 1, endChar: 1 }).range(b('ab\ncd')), [1, 4])
  assert.ok(d('deleteDataSingleLine', {}).isDeletion())
  assert.ok(d('insertDataSingleLine', {}).isInsertion())
  assert.ok(d('replaceDataSingleLine', {}).isReplacement())
  assert.ok(d('setContents', {}).isSetContents())
  assert.throws(() => d('writeBinary', {}).range(b('')), /unknown delta type/)
})

test('delta: validateAgainst refuses out-of-range and inverted coordinates', () => {
  const x = b('ab\ncd')
  assert.throws(() => d('insertDataSingleLine', { startLine: 2, startChar: 0, data: 'q' }).validateAgainst(x), RangeError)
  assert.throws(() => d('deleteDataSingleLine', { startLine: 0, startChar: 1, endChar: 3 }).validateAgainst(x), RangeError)
  assert.throws(() => d('deleteDataMultiLine', { startLine: 1, startChar: 1, endLine: 0, endChar: 0 }).validateAgainst(x), /before start/)
  assert.throws(() => d('pcreReplaceSingleLine', { pattern: '(', replacement: '' }).validateAgainst(x))
  assert.throws(() => d('pcreReplaceSingleLine', { pattern: 'a', replacement: '${nope}' }).validateAgainst(x), /undefined group/)
  d('replaceDataMultiLine', { startLine: 0, startChar: 2, endLine: 1, endChar: 2, data: 'z' }).validateAgainst(x)
})

test('delta: wire spellings round-trip and agree with textChanges', () => {
  const change = { change_type: 'replaceDataMultiLine', change_data: JSON.stringify({ startLine: 0, startChar: 1, endLine: 1, endChar: 1, data: '-' }) }
  const x = Delta.fromChange(change)
  assert.deepEqual(Delta.fromChange(x.toChange()).toHash(), x.toHash())
  assert.deepEqual(Delta.from(x.toHash()).toHash(), x.toHash())
  assert.equal(x.applyToString('ab\ncd'), applyChange('ab\ncd', change.change_type, change.change_data))
})

test('delta: fallback priority is the server\'s SHA-1 of type|payload JSON', () => {
  assert.equal(sha1Hex(''), 'da39a3ee5e6b4b0d3255bfef95601890afd80709')
  assert.equal(sha1Hex('abc'), 'a9993e364706816aba3e25717850c26c9cd0d89d')
  // Value produced by DbfsV2::Delta#priority_for for the same delta.
  const x = d('insertDataSingleLine', { startLine: 1, startChar: 3, data: '!' })
  assert.equal(x.priorityFor(null), 'fdafc65bf4e9cce469451f8ed3de873bf0cf86d1')
})

// --- pcre ---------------------------------------------------------------------
const pcre = (base, payload, multi = false) =>
  d(multi ? 'pcreReplaceMultiLine' : 'pcreReplaceSingleLine', payload).applyToString(base)

test('pcre: all, limit, backreferences', () => {
  assert.equal(pcre('foo bar foo', { pattern: 'foo', replacement: 'X' }), 'X bar X')
  assert.equal(pcre('foo foo foo', { pattern: 'foo', replacement: 'X', limit: 2 }), 'X X foo')
  assert.equal(pcre('a a a a', { pattern: 'a', replacement: 'b', limit: 0 }), 'b b b b')
  assert.equal(pcre('hello world', { pattern: '(\\w+) (\\w+)', replacement: '\\2 \\1' }), 'world hello')
  assert.equal(pcre('hello world', { pattern: '(\\w+) (\\w+)', replacement: '$2 $1' }), 'world hello')
  assert.equal(pcre('abc', { pattern: '(?<x>a)', replacement: '\\k<x>\\k<x>' }), 'aabc')
  assert.equal(pcre('abc', { pattern: '(?<x>a)', replacement: '${x}$$\\\\' }), 'a$\\bc')
})

test('pcre: single-line matches never span a newline; multi-line may', () => {
  assert.equal(pcre('foo\nbar\nfoo\nbar', { pattern: 'foo\\nbar', replacement: 'Z' }, true), 'Z\nZ')
  assert.equal(pcre('foo\nbar', { pattern: 'foo\\nbar', replacement: 'Z' }), 'foo\nbar')
  assert.equal(pcre('a\nb', { pattern: 'a.b', replacement: 'Z' }), 'a\nb')
  assert.equal(pcre('a\nb', { pattern: 'a.b', replacement: 'Z' }, true), 'Z')
})

test('pcre: Ruby syntax (\\A \\z \\Z \\h, ^/$ per line, named groups make (...) non-capturing)', () => {
  assert.equal(pcre('aa\naa', { pattern: '\\Aa', replacement: 'X' }), 'Xa\naa')
  assert.equal(pcre('aa\naa', { pattern: '^a', replacement: 'X' }), 'Xa\nXa')
  assert.equal(pcre('aa\naa', { pattern: 'a$', replacement: 'X' }), 'aX\naX')
  assert.equal(pcre('aa\naa', { pattern: 'a\\z', replacement: 'X' }), 'aa\naX')
  assert.equal(pcre('ab\n', { pattern: 'b\\Z', replacement: 'X' }), 'aX\n')
  assert.equal(pcre('0xfG', { pattern: '\\h+', replacement: '#' }), '#x#G')
  assert.equal(pcre('ab', { pattern: '(?<x>a)(b)', replacement: '[$1|$2]' }), '[a|]')
})

test('pcre: zero-width matches stop at the end of the text', () => {
  const m = d('pcreReplaceSingleLine', { pattern: 'x*', replacement: '-' }).matches(b('ab'))
  assert.deepEqual(m.map(([s, e]) => [s, e]), [[0, 0], [1, 1], [2, 2]])
  assert.equal(pcre('ab', { pattern: '$', replacement: '!' }), 'ab!')
})

// --- transform ----------------------------------------------------------------
function converge(base, a, x) {
  const [a2, x2] = Transform.transform(a, x, b(base))
  const left = applyHashes(a.applyToString(base), x2)
  const right = applyHashes(x.applyToString(base), a2)
  assert.equal(left, right, `diverged: ${JSON.stringify(left)} vs ${JSON.stringify(right)}`)
  return left
}

test('transform: inserts, deletes, multi-line', () => {
  assert.equal(converge('X', d('insertDataSingleLine', { startLine: 0, startChar: 0, data: 'A' }, 'a'),
    d('insertDataSingleLine', { startLine: 0, startChar: 0, data: 'B' }, 'b')), 'ABX')
  assert.equal(converge('X', d('insertDataSingleLine', { startLine: 0, startChar: 0, data: 'A' }, 'a'),
    d('insertDataSingleLine', { startLine: 0, startChar: 1, data: 'B' }, 'b')), 'AXB')
  converge('XYZ', d('deleteDataSingleLine', { startLine: 0, startChar: 0, endChar: 1 }, 'a'),
    d('insertDataSingleLine', { startLine: 0, startChar: 2, data: 'B' }, 'b'))
  assert.equal(converge('XYZ', d('deleteDataSingleLine', { startLine: 0, startChar: 0, endChar: 3 }, 'a'),
    d('insertDataSingleLine', { startLine: 0, startChar: 1, data: 'B' }, 'b')), 'B')
  assert.equal(converge('XYZ', d('deleteDataSingleLine', { startLine: 0, startChar: 0, endChar: 2 }, 'a'),
    d('deleteDataSingleLine', { startLine: 0, startChar: 1, endChar: 3 }, 'b')), '')
  assert.equal(converge('XYZ', d('deleteDataSingleLine', { startLine: 0, startChar: 0, endChar: 1 }, 'a'),
    d('deleteDataSingleLine', { startLine: 0, startChar: 2, endChar: 3 }, 'b')), 'Y')
  converge('x\ny\n', d('insertDataMultiLine', { startLine: 0, startChar: 0, data: 'A\n' }, 'a'),
    d('insertDataSingleLine', { startLine: 1, startChar: 0, data: 'B' }, 'b'))
})

test('transform: an insert inside a concurrent replace is ambiguous (snapshot, not a split)', () => {
  const base = 'abcdef'
  const r = d('replaceDataSingleLine', { startLine: 0, startChar: 1, endChar: 4, data: 'XYZ' }, 'a')
  const i = d('insertDataSingleLine', { startLine: 0, startChar: 2, data: 'q' }, 'b')
  assert.ok(Transform.isAmbiguous(Transform.toPrims(r, b(base)), Transform.toPrims(i, b(base))))
  const [r2] = Transform.transform(r, i, b(base))
  assert.equal(r2[0].type, 'setContents')
  converge(base, r, i)
})

test('transformList folds same-space prims right to left', () => {
  // The merge regression that motivated the server fix: an insert at the start
  // of line 0 must not be shifted past a later same-space prim on line 2.
  const P = (s, f, t, p) => new Transform.Prim(s, f, t, p)
  const ops = [P(1, 1, 'Z', 't')]
  const others = [P(0, 0, 'XXXX', 'o'), P(4, 4, 'Y', 'o')]
  assert.deepEqual(Transform.transformList(ops, others).map(p => p.toArray()), [[5, 5, 'Z', 't', null]])
})

// --- diff ---------------------------------------------------------------------
const dPrims = (o, n) => Transform.diffPrims(o, n, 'p')
const applyPrims = (o, prims) => Merge.applyPrims(b(o), prims).toString()

test('diff: exact shapes', () => {
  const header = dPrims('hello\nworld', '# header\nhello\nworld')
  assert.deepEqual(header.map(p => p.toArray()), [[0, 0, '# header\n', 'p', 'before']])
  const del = dPrims('a\nb\nc\n', 'a\nb\n')
  assert.equal(del.length, 1)
  assert.ok(del[0].isDelete())
  assert.deepEqual(dPrims('same\ntext', 'same\ntext'), [])
})

function seeded(seed) {
  let x = seed >>> 0 || 1
  return () => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x / 4294967296 }
}

test('diff: random round-trip', () => {
  const r = seeded(1234)
  const alphabet = ['a', 'b', 'c', 'd', '\n']
  const str = () => Array.from({ length: Math.floor(r() * 31) }, () => alphabet[Math.floor(r() * 5)]).join('')
  for (let i = 0; i < 2000; i++) {
    const o = str()
    const n = str()
    assert.equal(applyPrims(o, dPrims(o, n)), n, `old=${JSON.stringify(o)} new=${JSON.stringify(n)}`)
  }
})

test('myers: minimal, with the pinned tie-break', () => {
  const r = seeded(99)
  const lcs = (a, c) => {
    const dp = Array.from({ length: a.length + 1 }, () => new Array(c.length + 1).fill(0))
    for (let i = a.length - 1; i >= 0; i--) {
      for (let j = c.length - 1; j >= 0; j--) {
        dp[i][j] = a[i] === c[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
      }
    }
    return dp[0][0]
  }
  for (let i = 0; i < 500; i++) {
    const a = Array.from({ length: Math.floor(r() * 17) }, () => 'abc'[Math.floor(r() * 3)])
    const c = Array.from({ length: Math.floor(r() * 17) }, () => 'abc'[Math.floor(r() * 3)])
    const hs = Myers.hunks(a, c)
    const cost = hs.reduce((s, [os, oe, ns, ne]) => s + (oe - os) + (ne - ns), 0)
    assert.equal(cost, a.length + c.length - 2 * lcs(a, c))
  }
  assert.deepEqual(Myers.hunks(['a', 'a'], ['a', 'a', 'a']), [[2, 2, 2, 3]])
})

test('diff: large file, small edit stays minimal and fast; full rewrite stays bounded', () => {
  const n = 20000
  const base = Array.from({ length: n }, (_, i) => `line${i}`).join('\n')
  const changed = base.replace('line1\n', 'line1 CHANGED\n').replace(`line${n - 2}\n`, `line${n - 2} CHANGED\n`)
  let t = Date.now()
  const prims = dPrims(base, changed)
  assert.ok(Date.now() - t < 5000)
  assert.equal(prims.length, 2)
  assert.equal(applyPrims(base, prims), changed)

  const rewritten = Array.from({ length: n }, (_, i) => `LINE${i}`).join('\n')
  t = Date.now()
  const coarse = dPrims(base, rewritten)
  assert.ok(Date.now() - t < 5000)
  assert.equal(applyPrims(base, coarse), rewritten)
})

// --- merge / rebase examples ------------------------------------------------------
test('merge by replay: the same-space regression merges to the right lines', () => {
  const ins = (line, char, data, priority) => d('insertDataSingleLine', { startLine: line, startChar: char, data }, priority)
  const res = rebase({ base: 'a\nm\nb', deltas: [ins(0, 1, 'Z', 't1')], concurrent: [ins(0, 0, 'XXXX', 'o1'), ins(2, 0, 'Y', 'o2')] })
  assert.equal(res.content, 'XXXXaZ\nm\nYb')
})

// --- same-line rule (server decisions #29) ----------------------------------------
test('same-line rule: snapshot diffs claim whole lines', () => {
  assert.deepEqual(dPrims('a\nbXc\nd', 'a\nbYc\nd').map(p => p.toArray()), [[2, 6, 'bYc\n', 'p', 'lines']])
  assert.deepEqual(dPrims('a\nb', 'a\nbc').map(p => p.toArray()), [[2, 3, 'bc', 'p', 'lines_eof']])
  assert.deepEqual(dPrims('a\nb', 'a\nnew\nb').map(p => p.toArray()), [[2, 2, 'new\n', 'p', 'before']])

  const snap = Transform.diffPrims('one\ntwo\nthree', 'one\nTWO\nthree', 's') // claims [4, 8)
  const at = (o, text = 'x') => [new Transform.Prim(o, o, text, 'e')]
  const del = (st, f) => [new Transform.Prim(st, f, '', 'e')]
  assert.ok(Transform.isAmbiguous(snap, at(5)))
  assert.ok(Transform.isAmbiguous(snap, at(4)))
  assert.ok(Transform.isAmbiguous(snap, del(2, 5)))
  assert.ok(Transform.isAmbiguous(at(6), snap))
  assert.ok(!Transform.isAmbiguous(snap, at(8)))
  assert.ok(!Transform.isAmbiguous(snap, at(3)))
  assert.ok(!Transform.isAmbiguous(snap, at(4, 'new\n')))
  assert.ok(!Transform.isAmbiguous(snap, del(9, 12)))
})

test('same-line rule: added lines go before a plain insert at the same point', () => {
  const added = Transform.diffPrims('a\nb', 'a\nnew\nb', 's')
  const typed = [new Transform.Prim(2, 2, 'X', 'a')]
  for (const [first, second] of [[added, typed], [typed, added]]) {
    const buf = b('a\nb')
    Merge.applyPrims(buf, first)
    Merge.applyPrims(buf, Transform.transformList(second, first))
    assert.equal(buf.toString(), 'a\nnew\nXb')
  }
})

test('same-line rule: the two garbling cases conflict', () => {
  assert.equal(Merge.mergeContents('<b.1><b.2><b.3>\n<c.1>', '<o.1><b.2><b.3>\n<c.1>', '<b.2><b.3>\n<c.1>').merged, false)
  assert.equal(Merge.mergeContents('\n<c.1><c.2><c.3>', '\n<c.1><c.2><o.1><c.3>', '<t.2>\n<c.1><c.2><t.1><t.3>\n\n<c.3>').merged, false)
  const external = d('setContents', { data: '<t.2>\n<c.1><c.2><t.1><t.3>\n\n<c.3>' }, 'r')
  assert.throws(() => rebase({ base: '\n<c.1><c.2><c.3>', deltas: [{ type: 'insertDataSingleLine', startLine: 1, startChar: 10, data: '<o.1>' }], concurrent: [external] }),
    e => e instanceof OverlapConflict && e.regions.length === 1)
  // the same edits replayed merge: rename b.1 -> o.1 on one side, delete b.1 on the other
  const res = rebase({
    base: '<b.1><b.2><b.3>\n<c.1>',
    deltas: [{ type: 'deleteDataSingleLine', startLine: 0, startChar: 0, endChar: 5 }],
    concurrent: [d('insertDataSingleLine', { startLine: 0, startChar: 0, data: '<o.1>' }, 'o1'),
      d('deleteDataSingleLine', { startLine: 0, startChar: 5, endChar: 10 }, 'o2')],
  })
  assert.equal(res.content, '<o.1><b.2><b.3>\n<c.1>')
})

test('same-line rule: an edit on another line than an external rewrite merges', () => {
  const external = d('setContents', { data: 'one\nTWO\nthree\n' }, 'r')
  const res = rebase({ base: 'one\ntwo\nthree\n', deltas: [{ type: 'insertDataSingleLine', startLine: 2, startChar: 5, data: '!' }, { type: 'insertDataSingleLine', startLine: 0, startChar: 0, data: '>' }], concurrent: [external] })
  assert.equal(res.content, '>one\nTWO\nthree!\n')
})

test('merge: overlapping writes are a conflict', () => {
  const res = Merge.mergeContents('hello\nworld', 'HELLO\nworld', 'help\nworld')
  assert.equal(res.merged, false)
  assert.equal(res.reason, 'conflict')
  assert.throws(() => Merge.autoMergeContent('hello\nworld', 'HELLO\nworld', 'help\nworld'), ConflictError)
})

test('rebase: edits past a concurrent insert, with a bridge back to the head', () => {
  const ins = (line, char, data) => ({ type: 'insertDataSingleLine', startLine: line, startChar: char, data })
  const res = rebase({ base: 'one\ntwo\n', deltas: [ins(1, 3, '!'), ins(1, 4, '?')], concurrent: [d('insertDataSingleLine', { startLine: 0, startChar: 0, data: 'X' }, 'rev1')] })
  assert.equal(res.content, 'Xone\ntwo!?\n')
  assert.equal(res.local, 'one\ntwo!?\n')
  assert.equal(applyHashes(res.local, res.bridge), res.content)
  assert.equal(res.deltas.reduce((t, x) => x.applyToString(t), 'Xone\ntwo\n'), res.content)
})

test('rebase: an edit inside a concurrent replace is refused; out-of-range is a RangeError', () => {
  const rep = d('replaceDataSingleLine', { startLine: 0, startChar: 1, endChar: 4, data: 'XYZ' }, 'rev1')
  assert.throws(() => rebase({ base: 'abcdef\n', deltas: [{ type: 'insertDataSingleLine', startLine: 0, startChar: 2, data: 'q' }], concurrent: [rep] }), ConflictError)
  assert.throws(() => rebase({ base: 'abc', deltas: [{ type: 'insertDataSingleLine', startLine: 3, startChar: 0, data: 'q' }] }), RangeError)
})
