// src/ot properties: TP1 over every op-type pair (exhaustive on small bases),
// argument-order independence, and content-checked random merges and rebases
// (every inserted token survives exactly once, unsplit). Ported from the
// server's tp1_test, merge_property_test and rebase_test.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isDeepStrictEqual } from 'node:util'
import { TextBuffer, Delta, Transform, Merge, ConflictError, rebase } from '../../src/ot/index.js'

const applyHashes = (text, hashes) => hashes.reduce((t, h) => Delta.fromHash(h).applyToString(t), text)
const mk = (type, payload, priority) => {
  const x = new Delta(type, payload)
  if (priority != null) x.priority = priority
  return x
}

// --- TP1 ------------------------------------------------------------------------
const BASES = ['abc', 'ab', 'abcd', 'ab\ncd', 'a\nb']

function converge(base, a, b) {
  const [a2, b2] = Transform.transform(a, b, new TextBuffer(base))
  return [applyHashes(a.applyToString(base), b2), applyHashes(b.applyToString(base), a2)]
}

function ranges(base) {
  const buf = new TextBuffer(base)
  const out = []
  for (let s = 0; s <= base.length; s++) {
    for (let e = s + 1; e <= base.length; e++) {
      const [sl, sc] = buf.position(s)
      const [el, ec] = buf.position(e)
      out.push({ startLine: sl, startChar: sc, endLine: el, endChar: ec })
    }
  }
  return out
}

const GEN = {
  insert: (base, pri) => {
    const buf = new TextBuffer(base)
    const out = []
    for (let o = 0; o <= base.length; o++) {
      const [l, c] = buf.position(o)
      out.push(mk('insertDataMultiLine', { startLine: l, startChar: c, data: 'Z' }, pri))
      out.push(mk('insertDataMultiLine', { startLine: l, startChar: c, data: 'Z\nW' }, pri))
    }
    return out
  },
  delete: (base, pri) => ranges(base).map(r => mk('deleteDataMultiLine', r, pri)),
  replace: (base, pri) => ranges(base).map(r => mk('replaceDataMultiLine', { ...r, data: 'R' }, pri)),
  setContents: (_base, pri) => [mk('setContents', { data: 'P' }, pri), mk('setContents', { data: 'Q\nZ' }, pri)],
  pcre: (_base, pri) => [
    mk('pcreReplaceSingleLine', { pattern: 'a', replacement: 'X' }, pri),
    mk('pcreReplaceSingleLine', { pattern: 'b', replacement: 'Y', limit: 1 }, pri),
  ],
}

const PAIRS = [
  ['insert', 'insert'], ['insert', 'delete'], ['delete', 'insert'], ['delete', 'delete'],
  ['insert', 'replace'], ['delete', 'replace'], ['replace', 'replace'],
  ['setContents', 'insert'], ['setContents', 'delete'], ['setContents', 'replace'], ['setContents', 'setContents'],
  ['pcre', 'insert'], ['pcre', 'replace'], ['pcre', 'pcre'],
]

for (const [x, y] of PAIRS) {
  test(`TP1: ${x} x ${y}`, () => {
    let checked = 0
    const failures = []
    for (const base of BASES) {
      for (const a of GEN[x](base, 'a')) {
        for (const b of GEN[y](base, 'b')) {
          checked++
          const [l, r] = converge(base, a, b)
          if (l !== r) failures.push({ base, a: a.toHash(), b: b.toHash(), l, r })
        }
      }
    }
    assert.ok(checked > 0)
    assert.deepEqual(failures.slice(0, 3), [], `${failures.length}/${checked} diverged`)
  })
}

test('transform(a, b) and transform(b, a) converge to the same document', () => {
  const all = (base, pri) => Object.values(GEN).flatMap(g => g(base, pri))
  let checked = 0
  for (const base of BASES) {
    for (const a of all(base, 'a')) {
      for (const b of all(base, 'b')) {
        checked++
        assert.equal(converge(base, a, b)[0], converge(base, b, a)[0])
      }
    }
  }
  assert.ok(checked > 0)
})

test('fallback priorities make insert ties deterministic', () => {
  const outcomes = new Set()
  for (let i = 0; i < 50; i++) {
    const a = mk('insertDataMultiLine', { startLine: 0, startChar: 0, data: 'I' })
    const b = mk('insertDataMultiLine', { startLine: 0, startChar: 0, data: 'C' })
    a.priorityFor(null)
    b.priorityFor(null)
    outcomes.add(converge('abc', a, b)[0])
  }
  assert.equal(outcomes.size, 1)
})

// --- token helpers ------------------------------------------------------------------
function seeded(seed) {
  let x = seed >>> 0 || 1
  return () => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x / 4294967296 }
}

const TOKEN = /<[a-z]\d*\.\d+>/g
const tokens = s => s.match(TOKEN) || []
const tally = list => list.reduce((m, t) => ({ ...m, [t]: (m[t] || 0) + 1 }), {})

function boundaries(line) {
  const out = []
  let depth = 0
  for (let i = 0; i <= line.length; i++) {
    if (depth === 0) out.push(i)
    if (line[i] === '<') depth++
    else if (line[i] === '>') depth = Math.max(0, depth - 1)
  }
  return out
}

function randomEdit(text, r, token, deletable) {
  if (r() < 0.35) {
    const present = deletable.filter(t => text.includes(t))
    if (present.length) {
      const tok = present[Math.floor(r() * present.length)]
      const buf = new TextBuffer(text)
      const off = text.indexOf(tok)
      const [sl, sc] = buf.position(off)
      const [el, ec] = buf.position(off + tok.length)
      return ['delete', tok, mk('deleteDataMultiLine', { startLine: sl, startChar: sc, endLine: el, endChar: ec })]
    }
  }
  const lines = text.split('\n')
  const l = Math.floor(r() * lines.length)
  const spots = boundaries(lines[l])
  const data = r() < 0.2 ? `${token}\n` : token
  return ['insert', token, mk(data.includes('\n') ? 'insertDataMultiLine' : 'insertDataSingleLine',
    { startLine: l, startChar: spots[Math.floor(r() * spots.length)], data })]
}

const initialText = r => {
  const n1 = Math.floor(r() * 7)
  const n2 = Math.floor(r() * 5)
  return Array.from({ length: n1 }, (_, i) => `<b.${i + 1}>`).join('') + '\n' + Array.from({ length: n2 }, (_, i) => `<c.${i + 1}>`).join('')
}

// --- merge ------------------------------------------------------------------------
// Each side inserts tokens at token boundaries, and optionally deletes a base
// token; a merge reported clean must hold every surviving token exactly once.
function randomMerges(seed, { deletes }) {
  const r = seeded(seed)
  let merged = 0
  const failures = []
  for (let t = 0; t < 300; t++) {
    const base = initialText(r)
    const expected = tokens(base)
    const sides = {}
    for (const side of ['o', 't']) {
      let text = base
      for (let i = 1, n = 1 + Math.floor(r() * 4); i <= n; i++) {
        const [, tok, edit] = randomEdit(text, r, `<${side}.${i}>`, [])
        text = edit.applyToString(text)
        expected.push(tok)
      }
      if (deletes && r() < 0.5) {
        const [kind, tok, edit] = randomEdit(text, () => 0, 'unused', tokens(base))
        if (kind === 'delete') {
          text = edit.applyToString(text)
          const idx = expected.indexOf(tok)
          if (idx >= 0) expected.splice(idx, 1)
        }
      }
      sides[side] = text
    }
    const res = Merge.mergeContents(base, sides.o, sides.t)
    if (!res.merged) continue
    merged++
    const split = (res.content.match(/</g) || []).length !== tokens(res.content).length
    if (split || !isDeepStrictEqual(tally(tokens(res.content)), tally(expected))) {
      failures.push({ base, ...sides, merged: res.content })
    }
  }
  return { merged, failures }
}

// Known server behavior, reproduced faithfully (tests/parity checks the Ruby
// merge returns the same content): the three-way merge diffs each side against
// the base, and a diff can align differently from what the author did, so two
// non-overlapping splices can still garble text. Two shapes seen here:
//   * each line hunk is refined to a common prefix/suffix splice. Base
//     "<b.1><b.2>": ours renames b.1 -> o.1 (replace "b"), theirs deletes
//     "<b.1>" (diffed as delete "1><b."); clean merge, content "<o.2>".
//   * Myers matches a moved blank line, so theirs' insert before "<c.3>" diffs
//     as delete "1><c.2><c." + reinsert; ours' insert lands inside the delete
//     and survives as "<c.o.1><3>".
// Seed 20260915 happens to pass with inserts only; seed 3 does not.
test('random three-way merges keep every token exactly once', {
  todo: 'server Merge#auto_merge_content can garble text on a clean merge (diff alignment differs from the edits)',
}, () => {
  const report = []
  for (const seed of [20260915, 1, 2, 3, 4, 5]) {
    for (const deletes of [false, true]) {
      const { merged, failures } = randomMerges(seed, { deletes })
      if (failures.length) report.push({ seed, deletes, merged, failed: failures.length, first: failures[0] })
    }
  }
  assert.deepEqual(report, [])
})

// --- rebase -----------------------------------------------------------------------
// Others edit the head; each round the author rebases a batch based on its own
// previous state. What the author has not seen yet is the previous bridge plus
// the others' edits since (the server's concurrent_since, bridge path).
test('random rebase rounds keep every token exactly once and the bridge reaches the head', () => {
  const r = seeded(Number(process.env.REBASE_PROPERTY_SEED ?? 915))
  let rounds = 0
  let refusedTotal = 0
  for (let run = 0; run < 60; run++) {
    const initial = initialText(r)
    let head = initial
    let alive = tokens(initial)
    let authorView = initial
    let unseen = []
    let refused = 0
    let rev = 0

    for (let round = 0; round < 6; round++) {
      for (let k = 0, n = Math.floor(r() * 4); k < n; k++) {
        const [kind, tok, edit] = randomEdit(head, r, `<o${round}.${k}>`, alive)
        edit.priority = `rev-${String(++rev).padStart(4, '0')}`
        head = edit.applyToString(head)
        unseen.push(edit)
        if (kind === 'insert') alive.push(tok)
        else alive.splice(alive.indexOf(tok), 1)
      }
      const batch = []
      let view = authorView
      for (let k = 0, n = 1 + Math.floor(r() * 3); k < n; k++) {
        const e = randomEdit(view, r, `<a${round}.${k}>`, tokens(authorView))
        batch.push(e)
        view = e[2].applyToString(view)
      }
      let res
      try {
        res = rebase({ base: authorView, deltas: batch.map(([, , e]) => e.toHash()), concurrent: unseen })
      } catch (e) {
        if (!(e instanceof ConflictError)) throw e
        refused++
        authorView = head
        unseen = []
        continue
      }
      rounds++
      assert.equal(res.content, res.deltas.reduce((t, x) => x.applyToString(t), head), 'deltas do not apply on the head')
      head = res.content
      assert.equal(res.local, view)
      assert.equal(applyHashes(view, res.bridge), head, `run ${run} round ${round}: bridge does not reach the head`)
      const local = [...alive]
      for (const [kind, tok] of batch) {
        if (kind === 'insert') local.push(tok)
        else if (local.includes(tok)) local.splice(local.indexOf(tok), 1) // others may have deleted it already
      }
      alive = local
      authorView = view
      unseen = res.bridge.map((h, i) => { const x = Delta.fromHash(h); x.priority = `bridge-${run}-${round}-${i}`; return x })
      assert.deepEqual(tally(tokens(head)), tally(alive), `run ${run} round ${round}: ${JSON.stringify(head)}`)
      assert.equal((head.match(/</g) || []).length, tokens(head).length, `run ${run} round ${round}: a token was split`)
    }
    refusedTotal += refused
    assert.ok(refused < 6, `run ${run}: every round conflicted`)
  }
  assert.ok(rounds > 200, `only ${rounds} rounds rebased (${refusedTotal} refused)`)
})
