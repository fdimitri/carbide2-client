// TextBuffer — the in-memory text document (port of DbfsV2::Buffer).
//
// Content is an array of lines, each WITHOUT its trailing newline. An empty
// document is ['']. Line/char coordinates are 0-based and address positions
// BETWEEN characters; a flat offset counts '\n' as one character.
//
// Characters are UTF-16 code units (JS string indices, as Monaco reports
// columns). The server indexes Ruby characters (code points), so the two agree
// for all text except characters outside the Basic Multilingual Plane (emoji
// and the like), which are two units here and one there.

import { toI } from './util.js'

export class TextBuffer {
  constructor(content = '') {
    this.setContents(content)
  }

  setContents(content) {
    const str = content == null ? '' : String(content)
    this.lines = str === '' ? [''] : str.split('\n')
    return this
  }

  toString() {
    return this.lines.join('\n')
  }

  get content() {
    return this.toString()
  }

  get lineCount() {
    return this.lines.length
  }

  line(n) {
    return this.lines[n] ?? ''
  }

  // (line, char) -> flat offset, both clamped into range.
  offset(line, char) {
    const l = Math.min(Math.max(toI(line), 0), this.lines.length - 1)
    const c = Math.min(Math.max(toI(char), 0), this.lines[l].length)
    let off = 0
    for (let i = 0; i < l; i++) off += this.lines[i].length + 1
    return off + c
  }

  // Inverse of offset: flat offset -> [line, char]. Past the end clamps to the
  // end of the last line.
  position(offset) {
    const o = Math.max(toI(offset), 0)
    let acc = 0
    for (let i = 0; i < this.lines.length; i++) {
      const len = this.lines[i].length
      if (o <= acc + len) return [i, o - acc]
      acc += len + 1
    }
    const last = this.lines.length - 1
    return [last, this.lines[last].length]
  }

  apply(delta) {
    return delta.applyTo(this)
  }
}
