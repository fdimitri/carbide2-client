// Apply DBFS change specs to a plain string, with the same semantics as the
// server's DbfsV2::Buffer / Delta (0-based line/char, '\n' line separator,
// coordinates clamped into range). Used where there is no Monaco model to
// apply them to (an editor not mounted yet) and by the unit tests.
//
// A change spec is { change_type, change_data } where change_data is the JSON
// string (or object) of { startLine, startChar, endLine?, endChar?, data? }.

function parseData(changeData) {
  if (changeData && typeof changeData === 'object') return changeData
  try { return JSON.parse(changeData) } catch { return null }
}

function offsetOf(lines, line, char) {
  const l = Math.min(Math.max(line | 0, 0), lines.length - 1)
  const c = Math.min(Math.max(char | 0, 0), lines[l].length)
  let off = 0
  for (let i = 0; i < l; i++) off += lines[i].length + 1
  return off + c
}

export function applyChange(text, changeType, changeData) {
  if (changeType === 'setContents') {
    const d = parseData(changeData)
    return d && typeof d.data === 'string' ? d.data : String(changeData ?? '')
  }
  const d = parseData(changeData)
  if (!d) return text
  const lines = text.split('\n')
  const single = /SingleLine$/.test(changeType)
  const start = offsetOf(lines, d.startLine, d.startChar)
  const endLine = single ? d.startLine : (d.endLine ?? d.startLine)
  const data = Array.isArray(d.data) ? d.data.join('\n') : String(d.data ?? '')

  if (changeType.startsWith('insertData')) {
    return text.slice(0, start) + data + text.slice(start)
  }
  const end = offsetOf(lines, endLine, d.endChar ?? d.startChar)
  if (end < start) return text
  if (changeType.startsWith('deleteData')) {
    return text.slice(0, start) + text.slice(end)
  }
  if (changeType.startsWith('replaceData')) {
    return text.slice(0, start) + data + text.slice(end)
  }
  return text
}

export function applyChanges(text, changes) {
  return (changes || []).reduce((t, c) => applyChange(t, c.change_type, c.change_data), text)
}

// The single edit that turns `from` into `to`: [startOffset, endOffset, text],
// trimming the common prefix and suffix. null when they are equal.
export function minimalEdit(from, to) {
  if (from === to) return null
  let p = 0
  const max = Math.min(from.length, to.length)
  while (p < max && from.charCodeAt(p) === to.charCodeAt(p)) p++
  let s = 0
  while (s < max - p && from.charCodeAt(from.length - 1 - s) === to.charCodeAt(to.length - 1 - s)) s++
  return [p, from.length - s, to.slice(p, to.length - s)]
}
