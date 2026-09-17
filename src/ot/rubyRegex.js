// The server runs pcreReplace* patterns through Ruby's Regexp (Onigmo). This
// maps the common Ruby-only syntax onto a JS RegExp with the same meaning, and
// expands replacement strings the way DbfsV2::Delta#expand_replacement does.
//
// Ruby semantics carried over:
//   ^ $        always line anchors                      -> flag 'm'
//   Regexp::MULTILINE (pcreReplaceMultiLine): . matches \n -> flag 's'
//   \A \z \Z   string start / end / end-before-final-newline
//   \h \H      hex digit / non-hex digit
//   (...)      does not capture when the pattern has a named group (Onigmo),
//              so $1 means the first NAMED group there
//
// Not translated (a JS SyntaxError, reported like a bad pattern): atomic groups
// (?>...), possessive quantifiers, inline option groups on older engines,
// class intersections [a&&b], \G.

export function compileRubyRegex(pattern, multiline) {
  return new RegExp(translatePattern(String(pattern)), multiline ? 'gms' : 'gm')
}

export function translatePattern(p) {
  const named = hasNamedGroup(p)
  let out = ''
  let inClass = false
  for (let i = 0; i < p.length;) {
    const ch = p[i]
    if (ch === '\\') {
      const nxt = p[i + 1]
      if (nxt === undefined) { out += '\\'; i += 1; continue }
      if (!inClass && nxt === 'A') out += '(?<![\\s\\S])'
      else if (!inClass && nxt === 'z') out += '(?![\\s\\S])'
      else if (!inClass && nxt === 'Z') out += '(?=\\n?(?![\\s\\S]))'
      else if (nxt === 'h') out += inClass ? '0-9a-fA-F' : '[0-9a-fA-F]'
      else if (!inClass && nxt === 'H') out += '[^0-9a-fA-F]'
      else out += '\\' + nxt
      i += 2
      continue
    }
    if (named && ch === '(' && !inClass && p[i + 1] !== '?') {
      out += '(?:'
      i += 1
      continue
    }
    if (ch === '[' && !inClass) inClass = true
    else if (ch === ']' && inClass) inClass = false
    out += ch
    i += 1
  }
  return out
}

// A (?<name>...) group outside a character class.
function hasNamedGroup(p) {
  let inClass = false
  for (let i = 0; i < p.length; i++) {
    const ch = p[i]
    if (ch === '\\') { i++; continue }
    if (inClass) { if (ch === ']') inClass = false; continue }
    if (ch === '[') { inClass = true; continue }
    if (ch === '(' && p[i + 1] === '?' && p[i + 2] === '<' && p[i + 3] !== '=' && p[i + 3] !== '!') return true
  }
  return false
}

function group(m, name) {
  if (!m.groups || !Object.prototype.hasOwnProperty.call(m.groups, name)) {
    throw new Error(`undefined group name reference: ${name}`)
  }
  return m.groups[name] ?? ''
}

// Ruby-style (\0 \& \1..\9 \k<name> \\) and PHP/preg-style ($0 $1..$9 ${name}
// $$) backreferences. An unknown named group throws, as on the server.
export function expandReplacement(replacement, m) {
  const r = String(replacement)
  let out = ''
  let i = 0
  const digit = c => c >= '1' && c <= '9'
  while (i < r.length) {
    const ch = r[i]
    if (ch === '\\' && i + 1 < r.length) {
      const nxt = r[i + 1]
      if (nxt === '\\') { out += '\\'; i += 2 }
      else if (nxt === '0' || nxt === '&') { out += m[0] ?? ''; i += 2 }
      else if (nxt === 'k') {
        if (r[i + 2] === '<') {
          const close = r.indexOf('>', i + 3)
          out += close >= 0 ? group(m, r.slice(i + 3, close)) : ''
          i = close >= 0 ? close + 1 : i + 2
        } else { out += nxt; i += 2 }
      }
      else if (digit(nxt)) { out += m[Number(nxt)] ?? ''; i += 2 }
      else { out += nxt; i += 2 }
    } else if (ch === '$' && i + 1 < r.length) {
      const nxt = r[i + 1]
      if (nxt === '$') { out += '$'; i += 2 }
      else if (nxt === '0') { out += m[0] ?? ''; i += 2 }
      else if (digit(nxt)) { out += m[Number(nxt)] ?? ''; i += 2 }
      else if (nxt === '{') {
        const close = r.indexOf('}', i + 2)
        out += close >= 0 ? group(m, r.slice(i + 2, close)) : ''
        i = close >= 0 ? close + 1 : i + 2
      }
      else { out += ch; i += 1 }
    } else {
      out += ch
      i += 1
    }
  }
  return out
}
