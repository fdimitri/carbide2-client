// Delta — one edit operation (port of DbfsV2::Delta).
//
// Line/char coordinates are the wire and replay format; a delta normalizes to
// a flat character range [start, end] plus inserted text, which is the shape
// the transform reasons about.
//
// Three interchangeable spellings:
//   new Delta('insertDataSingleLine', { startLine, startChar, data })
//   Delta.fromHash({ type: 'insertDataSingleLine', startLine, startChar, data })
//   Delta.fromChange({ change_type, change_data })   // worker frame / fileSync spec

import { TextBuffer } from './buffer.js'
import { compileRubyRegex, expandReplacement } from './rubyRegex.js'
import { sha1Hex } from './sha1.js'
import { toI, toS } from './util.js'

export const CHANGE_TYPES = Object.freeze([
  'setContents',
  'insertDataSingleLine',
  'deleteDataSingleLine',
  'insertDataMultiLine',
  'deleteDataMultiLine',
  'replaceDataSingleLine',
  'replaceDataMultiLine',
  'pcreReplaceSingleLine',
  'pcreReplaceMultiLine',
  'writeBinary',
])

export class Delta {
  constructor(type, payload = {}) {
    this.type = String(type)
    this.payload = { ...(payload || {}) }
    // Deterministic OT tie-break. Callers SHOULD set the revision id (or the
    // revision's stored priority); priorityFor falls back to a content hash.
    this.priority = null
  }

  static parse(type, data) {
    const payload = data && typeof data === 'object' ? data : JSON.parse(toS(data))
    return new Delta(type, payload)
  }

  static fromHash(h) {
    const { type, ...rest } = h
    return new Delta(type, rest)
  }

  static fromChange({ change_type, change_data }) {
    return Delta.parse(change_type, change_data)
  }

  // Accepts a Delta, a { type, ... } hash, or a { change_type, change_data } spec.
  static from(x) {
    if (x instanceof Delta) return x
    if (x && x.change_type !== undefined) return Delta.fromChange(x)
    return Delta.fromHash(x)
  }

  // --- wire coords -------------------------------------------------------
  get startLine() { return toI(this.payload.startLine) }
  get startChar() { return toI(this.payload.startChar) }
  get endLine() { return toI(this.payload.endLine) }
  get endChar() { return toI(this.payload.endChar) }
  get data() { return toS(this.payload.data) }

  // --- PCRE replace: { pattern, replacement, limit } (limit 0 = unlimited)
  get pattern() { return toS(this.payload.pattern) }
  get replacement() { return toS(this.payload.replacement) }
  get limit() { return toI(this.payload.limit ?? 0) }

  // --- classification ----------------------------------------------------
  isDeletion() { return this.type === 'deleteDataSingleLine' || this.type === 'deleteDataMultiLine' }
  isInsertion() { return this.type === 'insertDataSingleLine' || this.type === 'insertDataMultiLine' }
  isReplacement() { return this.type === 'replaceDataSingleLine' || this.type === 'replaceDataMultiLine' }
  isSetContents() { return this.type === 'setContents' }
  isPcreReplace() { return this.type === 'pcreReplaceSingleLine' || this.type === 'pcreReplaceMultiLine' }
  isPcreMultiline() { return this.type === 'pcreReplaceMultiLine' }

  // [start, end] flat offsets over the joined string.
  range(buffer) {
    switch (this.type) {
      case 'setContents':
        return [0, buffer.toString().length]
      case 'insertDataSingleLine':
      case 'insertDataMultiLine': {
        const o = buffer.offset(this.startLine, this.startChar)
        return [o, o]
      }
      case 'deleteDataSingleLine':
      case 'replaceDataSingleLine':
        return [buffer.offset(this.startLine, this.startChar), buffer.offset(this.startLine, this.endChar)]
      case 'deleteDataMultiLine':
      case 'replaceDataMultiLine':
        return [buffer.offset(this.startLine, this.startChar), buffer.offset(this.endLine, this.endChar)]
      default:
        throw new Error(`unknown delta type ${this.type}`)
    }
  }

  // Text this delta introduces at its range ('' for pure deletes).
  get text() {
    return this.isInsertion() || this.isReplacement() ? this.data : ''
  }

  // All matches of a PCRE delta against buffer: [[begin, end, replacement], ...].
  matches(buffer) {
    const content = buffer.toString()
    const multiline = this.isPcreMultiline()
    const re = compileRubyRegex(this.pattern, multiline)
    const out = []
    let pos = 0
    let n = 0
    const limit = this.limit
    for (;;) {
      if (pos > content.length) break
      re.lastIndex = pos
      const m = re.exec(content)
      if (!m) break
      const b = m.index
      const e = b + m[0].length
      pos = e > b ? e : e + 1
      if (!multiline && content.slice(b, e).includes('\n')) continue
      out.push([b, e, expandReplacement(this.replacement, m)])
      n += 1
      if (limit > 0 && n >= limit) break
    }
    return out
  }

  // --- apply -------------------------------------------------------------
  applyTo(buffer) {
    switch (this.type) {
      case 'setContents':
        buffer.setContents(this.data)
        break
      case 'insertDataSingleLine':
      case 'insertDataMultiLine':
        bufferInsert(buffer, this.startLine, this.startChar, this.data)
        break
      case 'deleteDataSingleLine':
        bufferDelete(buffer, this.startLine, this.startChar, this.startLine, this.endChar)
        break
      case 'deleteDataMultiLine':
        bufferDelete(buffer, this.startLine, this.startChar, this.endLine, this.endChar)
        break
      case 'replaceDataSingleLine':
        bufferDelete(buffer, this.startLine, this.startChar, this.startLine, this.endChar)
        bufferInsert(buffer, this.startLine, this.startChar, this.data)
        break
      case 'replaceDataMultiLine':
        bufferDelete(buffer, this.startLine, this.startChar, this.endLine, this.endChar)
        bufferInsert(buffer, this.startLine, this.startChar, this.data)
        break
      case 'pcreReplaceSingleLine':
      case 'pcreReplaceMultiLine':
        applyPcre(this, buffer)
        break
      default:
        break
    }
    return buffer
  }

  // Apply to a string, returning the new string.
  applyToString(text) {
    return this.applyTo(new TextBuffer(text)).toString()
  }

  priorityFor(_base) {
    this.priority ??= sha1Hex(this.type + '|' + JSON.stringify(this.payload))
    return this.priority
  }

  // Fail closed on an incoming edit whose coordinates are out of range for
  // buffer (the server rejects these at its write boundary rather than
  // clamping). Throws RangeError; PCRE deltas are compiled and expanded.
  validateAgainst(buffer) {
    if (this.isPcreReplace()) {
      this.matches(buffer)
      return this
    }
    if (this.type === 'setContents' || this.type === 'writeBinary') return this

    const check = (line, char, label) => {
      const maxLine = buffer.lineCount - 1
      if (line < 0 || line > maxLine) {
        throw new RangeError(`${this.type}: ${label} line ${line} out of range (0..${maxLine})`)
      }
      const len = buffer.line(line).length
      if (char < 0 || char > len) {
        throw new RangeError(`${this.type}: ${label} char ${char} out of range on line ${line} (0..${len})`)
      }
    }

    switch (this.type) {
      case 'insertDataSingleLine':
      case 'insertDataMultiLine':
        check(this.startLine, this.startChar, 'start')
        break
      case 'deleteDataSingleLine':
      case 'replaceDataSingleLine':
        check(this.startLine, this.startChar, 'start')
        check(this.startLine, this.endChar, 'end')
        break
      case 'deleteDataMultiLine':
      case 'replaceDataMultiLine':
        check(this.startLine, this.startChar, 'start')
        check(this.endLine, this.endChar, 'end')
        break
      default:
        break
    }
    if ((this.type === 'deleteDataMultiLine' || this.type === 'replaceDataMultiLine') && this.orderedBefore()) {
      throw new RangeError(`${this.type}: end (${this.endLine},${this.endChar}) is before start (${this.startLine},${this.startChar})`)
    }
    return this
  }

  // True when (endLine, endChar) < (startLine, startChar).
  orderedBefore() {
    return this.endLine < this.startLine || (this.endLine === this.startLine && this.endChar < this.startChar)
  }

  toHash() {
    return { type: this.type, ...this.payload }
  }

  toChange() {
    return { change_type: this.type, change_data: JSON.stringify(this.payload) }
  }

  toJSON() {
    return this.toHash()
  }
}

// Insert text at (line, char); text may contain newlines. The line clamps into
// range. Out-of-range coordinates are refused by validateAgainst before an
// incoming edit is applied; for the ones that still get here (the opaque
// snapshot path applies edits to a document they were not authored against)
// the slicing follows Ruby's String/Array rules, so the result matches the
// server's byte for byte.
function bufferInsert(buffer, line, char, text) {
  if (text === '') return
  const lines = buffer.lines
  const l = Math.min(Math.max(line, 0), lines.length - 1)
  lines[l] ??= ''
  const c = Math.min(char, lines[l].length)
  const parts = text.split('\n')
  const head = rbHead(lines[l], c)
  const tail = rbTail(lines[l], c)
  if (parts.length === 1) {
    lines[l] = head + parts[0] + tail
  } else {
    lines[l] = head + parts[0]
    lines.splice(l + 1, 0, ...parts.slice(1))
    lines[l + parts.length - 1] += tail
  }
}

function bufferDelete(buffer, sl, sc, el, ec) {
  if (sl > el || (sl === el && sc >= ec)) return
  const lines = buffer.lines
  const first = rbAt(lines, sl) ?? ''
  const last = rbAt(lines, el) ?? ''
  const left = rbHead(first, sc)
  const right = sl === el ? rbTail(first, ec) : rbTail(last, ec)
  rbSliceBang(lines, sl, el - sl + 1)
  rbInsert(lines, sl, left + right)
}

// Ruby arr[i]
function rbAt(arr, i) {
  const j = i < 0 ? i + arr.length : i
  return j >= 0 && j < arr.length ? arr[j] : undefined
}

// Ruby str[0...n].to_s
function rbHead(str, n) {
  const e = n < 0 ? n + str.length : n
  return str.slice(0, Math.min(Math.max(e, 0), str.length))
}

// Ruby str[n..].to_s
function rbTail(str, n) {
  const s = n < 0 ? n + str.length : n
  return s >= 0 && s <= str.length ? str.slice(s) : ''
}

// Ruby arr.slice!(start, length)
function rbSliceBang(arr, start, length) {
  const s = start < 0 ? start + arr.length : start
  if (s < 0 || s > arr.length || length < 0) return
  arr.splice(s, length)
}

// Ruby arr.insert(index, value); a gap past the end fills with '' (Ruby: nil,
// which joins the same).
function rbInsert(arr, index, value) {
  let i = index
  if (i < 0) {
    i = arr.length + i + 1
    if (i < 0) throw new Error(`index ${index} too small for array; minimum: -${arr.length + 1}`)
  }
  while (arr.length < i) arr.push('')
  arr.splice(i, 0, value)
}

// Splice each match's replacement in right-to-left so offsets stay valid.
function applyPcre(delta, buffer) {
  let content = buffer.toString()
  const ms = delta.matches(buffer)
  for (let i = ms.length - 1; i >= 0; i--) {
    const [b, e, rep] = ms[i]
    content = content.slice(0, b) + rep + content.slice(e)
  }
  buffer.setContents(content)
  return buffer
}
