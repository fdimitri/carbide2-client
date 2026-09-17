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
// Two sides edit a multi-line base: token inserts at token boundaries and maybe
// one base token deleted. Merged three ways, as the server does (decisions #29):
//   edits    replay one side's edits past the other's (rebase)
//   snapshot replay, but one side is a single setContents (diffed, same-line rule)
//   content  three-way content merge of the two results (same-line rule)
// A merge reported clean must hold every surviving token exactly once, unsplit.
function randomMerges(seed) {
  const r = seeded(seed)
  const counts = {}
  const failures = []
  for (let t = 0; t < 300; t++) {
    const lines = 2 + Math.floor(r() * 5)
    const base = Array.from({ length: lines }, (_, l) =>
      Array.from({ length: Math.floor(r() * 4) }, (_, i) => `<b${l}.${i + 1}>`).join('')).join('\n')
    const expected = tokens(base)
    const sides = {}
    for (const side of ['o', 't']) {
      let text = base
      const edits = []
      for (let i = 1, n = 1 + Math.floor(r() * 4); i <= n; i++) {
        const [, tok, edit] = randomEdit(text, r, `<${side}.${i}>`, [])
        text = edit.applyToString(text)
        edits.push(edit)
        expected.push(tok)
      }
      if (r() < 0.5) {
        const present = tokens(base).filter(x => text.includes(x))
        if (present.length) {
          const tok = present[Math.floor(r() * present.length)]
          const [, , edit] = randomEdit(text, () => 0, 'unused', [tok])
          text = edit.applyToString(text)
          edits.push(edit)
          const idx = expected.indexOf(tok)
          if (idx >= 0) expected.splice(idx, 1)
        }
      }
      edits.forEach((e, i) => { e.priority = `${side}${i}` })
      sides[side] = { text, edits }
    }
    const mode = ['edits', 'snapshot', 'content'][Math.floor(r() * 3)]
    let content = null
    try {
      if (mode === 'edits') {
        content = rebase({ base, deltas: sides.t.edits, concurrent: sides.o.edits }).content
      } else if (mode === 'snapshot') {
        const snap = mk('setContents', { data: sides.o.text }, 'o-snap')
        content = rebase({ base, deltas: sides.t.edits, concurrent: [snap] }).content
      } else {
        const res = Merge.mergeContents(base, sides.o.text, sides.t.text)
        if (res.merged) content = res.content
      }
    } catch (e) {
      if (!(e instanceof ConflictError)) throw e
    }
    const key = `${mode}:${content === null ? 'conflict' : 'merged'}`
    counts[key] = (counts[key] || 0) + 1
    if (content === null) continue
    const split = (content.match(/</g) || []).length !== tokens(content).length
    if (split || !isDeepStrictEqual(tally(tokens(content)), tally(expected))) {
      failures.push({ mode, base, o: sides.o.text, t: sides.t.text, merged: content })
    }
  }
  return { counts, failures }
}

test('random merges keep every token exactly once (replay, snapshot, content)', () => {
  for (const seed of [Number(process.env.MERGE_PROPERTY_SEED ?? 20260915), 1, 2, 3, 4, 5]) {
    const { counts, failures } = randomMerges(seed)
    assert.deepEqual(failures.slice(0, 2), [], `seed ${seed}: ${failures.length} clean merges lost or split a token`)
    assert.ok((counts['edits:merged'] || 0) > 60, `seed ${seed}: ${JSON.stringify(counts)}`)
    assert.ok((counts['snapshot:merged'] || 0) + (counts['content:merged'] || 0) > 20, `seed ${seed}: ${JSON.stringify(counts)}`)
  }
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
