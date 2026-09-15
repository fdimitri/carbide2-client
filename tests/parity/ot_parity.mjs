// Differential test: src/ot (JS) against the server's DbfsV2 (Ruby) on random
// cases. Needs `ruby` and a carbide2-server checkout (default: the sibling
// directory in the meta repo).
//
//   node tests/parity/ot_parity.mjs [--seed N] [--cases N] [--server DIR]
//   npm run test:ot-parity
//
// Every case runs through both implementations; any difference in result
// (content, emitted deltas, prims, hunks, priorities, error kind) is a failure.
// Text includes a BMP non-ASCII character, quotes and backslashes; characters
// outside the BMP are left out on purpose (see src/ot/index.js).
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { isDeepStrictEqual, inspect } from 'node:util'
import { TextBuffer, Delta, Transform, Merge, Myers, ConflictError, rebase } from '../../src/ot/index.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => {
  if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1]])
  return acc
}, []))
const SEED = Number(args.seed ?? process.env.OT_PARITY_SEED ?? 20260915)
const CASES = Number(args.cases ?? process.env.OT_PARITY_CASES ?? 400)
const SERVER = path.resolve(args.server ?? process.env.CARBIDE_SERVER_DIR ?? path.join(here, '../../../carbide2-server'))

if (!existsSync(path.join(SERVER, 'lib/dbfs_v2/transform.rb'))) {
  console.error(`carbide2-server not found at ${SERVER} (pass --server DIR)`)
  process.exit(2)
}

// --- random ---------------------------------------------------------------
function rng(seed) {
  let x = seed >>> 0 || 1
  return () => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x / 4294967296 }
}
const R = rng(SEED)
const int = (lo, hi) => lo + Math.floor(R() * (hi - lo + 1))
const pick = list => list[Math.floor(R() * list.length)]
const chance = p => R() < p

const ALPHABET = ['a', 'a', 'b', 'b', 'c', '\n', '\n', ' ', 'é', '"', '\\', '<', '>']
const text = (lo = 0, hi = 16) => Array.from({ length: int(lo, hi) }, () => pick(ALPHABET)).join('')

const PATTERNS = ['a', 'b+', '(a)(b)?', '^a', 'b$', '\\Aa', 'a\\z', 'c\\Z', '(?<x>a)b', '(?<x>a)(b)', '\\h', '[\\h ]',
  '.', 'a.b', 'a\\nb', '', 'x*', '$', 'a*', '(', 'é', '"', '\\\\', '\\s+']
const REPLACEMENTS = ['X', '', '\\1\\1', '$1', '\\k<x>', '${x}', '$$', '\\0-', '\\&!', '$9', 'a\nb', '\\\\', '$2', '\\k<nope>']

function spanOnLine(buf) {
  const line = int(0, buf.lineCount - 1)
  const len = buf.line(line).length
  const s = int(0, len)
  return [line, s, int(s, len)]
}

function spanFlat(buf) {
  const len = buf.toString().length
  const s = int(0, len)
  const e = int(s, len)
  const [sl, sc] = buf.position(s)
  const [el, ec] = buf.position(e)
  return { startLine: sl, startChar: sc, endLine: el, endChar: ec }
}

function insertText() {
  return chance(0.25) ? text(1, 3) + '\n' + text(0, 3) : text(1, 4).replace(/\n/g, '') || 'Z'
}

// A random valid edit of `content`, as { type, payload }.
function randomEdit(content, { pcre = true, set = true, replace = true } = {}) {
  const buf = new TextBuffer(content)
  const roll = R()
  if (set && roll < 0.06) {
    return { type: 'setContents', payload: { data: chance(0.5) ? text() : content.slice(0, int(0, content.length)) + text(0, 3) } }
  }
  if (pcre && roll < 0.12) {
    const payload = { pattern: pick(PATTERNS), replacement: pick(REPLACEMENTS) }
    if (chance(0.5)) payload.limit = int(0, 2)
    return { type: chance(0.5) ? 'pcreReplaceSingleLine' : 'pcreReplaceMultiLine', payload }
  }
  const kind = replace ? pick(['insert', 'insert', 'delete', 'replace']) : pick(['insert', 'insert', 'delete'])
  if (kind === 'insert') {
    const [l, c] = buf.position(int(0, content.length))
    const data = insertText()
    return { type: data.includes('\n') || chance(0.3) ? 'insertDataMultiLine' : 'insertDataSingleLine', payload: { startLine: l, startChar: c, data } }
  }
  const multi = chance(0.5)
  let payload
  if (multi) payload = spanFlat(buf)
  else {
    const [l, s, e] = spanOnLine(buf)
    payload = { startLine: l, startChar: s, endChar: e }
  }
  if (kind === 'delete') return { type: multi ? 'deleteDataMultiLine' : 'deleteDataSingleLine', payload }
  payload.data = chance(0.15) ? '' : insertText()
  return { type: multi ? 'replaceDataMultiLine' : 'replaceDataSingleLine', payload }
}

function invalidEdit(content) {
  const buf = new TextBuffer(content)
  const type = pick(['insertDataSingleLine', 'deleteDataSingleLine', 'deleteDataMultiLine', 'replaceDataMultiLine', 'bogusType'])
  const coord = () => pick([-1, 0, 1, 2, buf.lineCount, buf.lineCount + 3, 50])
  return { type, payload: { startLine: coord(), startChar: coord(), endLine: coord(), endChar: coord(), data: 'Q' } }
}

const withPriority = (e, priority) => ({ ...e, priority })
const applyEdit = (content, e) => new Delta(e.type, e.payload).applyToString(content)

// A random edit that applies cleanly (a bad pattern or unknown group would be
// refused by the server before it could be part of a history).
function goodEdit(content, opts) {
  for (;;) {
    const e = randomEdit(content, opts)
    try { return [e, applyEdit(content, e)] } catch { /* draw again */ }
  }
}

// --- case generation -----------------------------------------------------
function makeCases() {
  const cases = []
  for (let i = 0; i < CASES; i++) {
    const base = text()
    const buf = new TextBuffer(base)

    cases.push({
      kind: 'buffer', base,
      offsets: Array.from({ length: 4 }, () => [pick([-2, 0, 1, int(0, buf.lineCount), 99, 2.7, '1']), pick([-3, 0, 1, 2, int(0, 6), 99, 1.5, '2'])]),
      positions: Array.from({ length: 4 }, () => pick([-1, 0, int(0, base.length), base.length, base.length + 5, 3.9])),
    })

    const e = chance(0.2) ? invalidEdit(base) : randomEdit(base)
    cases.push({ kind: 'apply', base, delta: withPriority(e, null) })

    cases.push({ kind: 'pcre', base: base + text(0, 6), delta: withPriority(randomEditPcre(), null) })

    const ta = Array.from({ length: int(0, 16) }, () => pick(['a', 'b', 'c']))
    const tb = Array.from({ length: int(0, 16) }, () => pick(['a', 'b', 'c']))
    cases.push({ kind: 'myers', a: ta, b: tb })

    cases.push({ kind: 'diff', old: base, new: chance(0.5) ? text() : applyEdit(base, randomEdit(base, { pcre: false })) })

    const pa = chance(0.2) ? null : pick(['a', 'b', 'p1', 'p2'])
    const pb = chance(0.2) ? null : pick(['a', 'b', 'p1', 'p2'])
    cases.push({ kind: 'transform', base, a: withPriority(randomEdit(base), pa), b: withPriority(randomEdit(base), pb) })

    const L = base.length
    const prim = () => {
      const s = int(0, L)
      const f = chance(0.4) ? s : int(s, L)
      return [s, f, chance(0.5) ? '' : text(1, 3), pick(['a', 'b'])]
    }
    cases.push({ kind: 'transform_list', ops: Array.from({ length: int(1, 3) }, prim), others: Array.from({ length: int(0, 3) }, prim) })

    let ours = base
    let theirs = base
    for (let k = int(1, 3); k > 0; k--) ours = applyEdit(ours, randomEdit(ours, { pcre: false, set: false }))
    for (let k = int(1, 3); k > 0; k--) theirs = applyEdit(theirs, randomEdit(theirs, { pcre: false, set: false }))
    cases.push({ kind: 'merge', base, ours, theirs })

    const concurrent = []
    let c = base
    for (let k = int(0, 4); k > 0; k--) {
      const [ed, next] = goodEdit(c, { pcre: chance(0.3), replace: chance(0.5), set: chance(0.2) })
      concurrent.push(withPriority(ed, `rev-${k}-${int(0, 9)}`))
      c = next
    }
    const deltas = []
    let l = base
    for (let k = int(1, 4); k > 0; k--) {
      const [ed, next] = goodEdit(l, { pcre: chance(0.2), replace: chance(0.5), set: chance(0.1) })
      deltas.push(withPriority(ed, chance(0.5) ? null : `mine-${k}`))
      l = next
    }
    cases.push({ kind: 'rebase', base, concurrent, deltas })
  }
  return cases
}

function randomEditPcre() {
  const payload = { pattern: pick(PATTERNS), replacement: pick(REPLACEMENTS) }
  if (chance(0.5)) payload.limit = int(0, 3)
  return { type: chance(0.5) ? 'pcreReplaceSingleLine' : 'pcreReplaceMultiLine', payload }
}

// --- JS side ----------------------------------------------------------------
function errKind(e) {
  if (e instanceof ConflictError) return 'conflict'
  if (String(e?.message).startsWith('unknown delta type')) return 'unknown'
  if (e instanceof RangeError) return 'range'
  return 'error'
}

function delta(h) {
  const d = new Delta(h.type, h.payload)
  if (h.priority != null) d.priority = h.priority
  return d
}

const primsOut = prims => prims.map(p => p.toArray())
const attempt = (fn, onErr) => { try { return fn() } catch (e) { return onErr(e) } }

function runJs(c) {
  switch (c.kind) {
    case 'buffer': {
      const b = new TextBuffer(c.base)
      return { offsets: c.offsets.map(([l, ch]) => b.offset(l, ch)), positions: c.positions.map(o => b.position(o)) }
    }
    case 'apply': {
      const buf = new TextBuffer(c.base)
      const d = delta(c.delta)
      const valid = attempt(() => { d.validateAgainst(buf); return true }, errKind)
      const content = attempt(() => d.applyToString(c.base), e => `!${errKind(e)}`)
      const range = attempt(() => d.range(buf), e => `!${errKind(e)}`)
      return { valid, content, range, priority: new Delta(c.delta.type, c.delta.payload).priorityFor(null) }
    }
    case 'pcre':
      return attempt(() => ({ matches: delta(c.delta).matches(new TextBuffer(c.base)) }), e => ({ error: errKind(e) }))
    case 'myers':
      return { hunks: Myers.hunks(c.a, c.b) }
    case 'diff':
      return { prims: primsOut(Transform.diffPrims(c.old, c.new, 'p')) }
    case 'transform':
      return attempt(() => {
        const [a, b] = Transform.transform(delta(c.a), delta(c.b), new TextBuffer(c.base))
        return { a, b }
      }, e => ({ error: errKind(e), message: e.message }))
    case 'transform_list': {
      const mk = ([s, f, t, p]) => new Transform.Prim(s, f, t, p)
      return attempt(() => ({ prims: primsOut(Transform.transformList(c.ops.map(mk), c.others.map(mk))) }), e => ({ error: errKind(e) }))
    }
    case 'merge': {
      const confs = Merge.conflicts(c.base, c.ours, c.theirs)
      const content = attempt(() => Merge.autoMergeContent(c.base, c.ours, c.theirs), e => {
        if (e instanceof ConflictError) return null
        throw e
      })
      return { conflicts: confs, content }
    }
    case 'rebase':
      return attempt(() => {
        const res = rebase({ base: c.base, concurrent: c.concurrent.map(delta), deltas: c.deltas.map(delta) })
        return { deltas: res.deltas.map(d => ({ ...d.toHash(), priority: d.priority })), bridge: res.bridge }
      }, e => ({ error: errKind(e) }))
    default:
      return { error: `unknown kind ${c.kind}` }
  }
}

// --- run --------------------------------------------------------------------
const cases = makeCases()
const ruby = spawn('ruby', [path.join(here, 'ot_parity.rb'), SERVER], { stdio: ['pipe', 'pipe', 'inherit'] })
let buffered = ''
const rubyOut = []
ruby.stdout.on('data', chunk => {
  buffered += chunk
  let nl
  while ((nl = buffered.indexOf('\n')) >= 0) {
    rubyOut.push(JSON.parse(buffered.slice(0, nl)))
    buffered = buffered.slice(nl + 1)
  }
})
for (const c of cases) ruby.stdin.write(JSON.stringify(c) + '\n')
ruby.stdin.end()
const code = await new Promise(resolve => ruby.on('close', resolve))
if (code !== 0 || rubyOut.length !== cases.length) {
  console.error(`ruby exited ${code} after ${rubyOut.length}/${cases.length} results`)
  process.exit(2)
}

const normalize = v => JSON.parse(JSON.stringify(v))
const tally = {}
const failures = []
cases.forEach((c, i) => {
  const r = rubyOut[i]
  const t = (tally[c.kind] ??= { cases: 0, failed: 0, errors: 0 })
  t.cases++
  if (r.crash) {
    t.failed++
    failures.push({ c, ruby: r, js: null })
    return
  }
  const js = normalize(attempt(() => runJs(c), e => ({ crash: `${e.name}: ${e.message}`, stack: e.stack })))
  if (r.error || (r.valid !== undefined && r.valid !== true)) t.errors++
  // Ruby and JS error messages differ in wording; compare kinds only.
  delete r.message
  delete js.message
  if (!isDeepStrictEqual(r, js)) {
    t.failed++
    failures.push({ c, ruby: r, js })
  }
})

console.log(`seed ${SEED}, ${cases.length} cases`)
for (const [kind, t] of Object.entries(tally)) {
  console.log(`  ${kind.padEnd(15)} ${String(t.cases).padStart(5)} cases  ${String(t.errors).padStart(4)} refused/invalid on both  ${t.failed} differ`)
}
if (failures.length) {
  for (const f of failures.slice(0, 5)) console.log(inspect(f, { depth: 6, breakLength: 140 }))
  console.log(`${failures.length} case(s) differ`)
  process.exit(1)
}
console.log('JS and Ruby agree on every case')
