// Myers O(ND) shortest-edit-script diff over token arrays (port of
// DbfsV2::Myers), returning replacement hunks.
//
// hunks(a, b) -> [[oldStart, oldEnd, newStart, newEnd], ...] such that applying
// them left to right to `a` yields `b`, or null when the edit distance exceeds
// MAX_D (the caller falls back to one coarse hunk). Tokens compare with ===.

export const MAX_D = 2048

export function hunks(a, b) {
  const n = a.length
  const m = b.length
  if (n === 0 && m === 0) return []
  if (n === 0 || m === 0) return [[0, n, 0, m]]

  // Trim the common prefix and suffix; only the middle can hold hunks.
  let pre = 0
  while (pre < n && pre < m && a[pre] === b[pre]) pre++
  let suf = 0
  while (suf < n - pre && suf < m - pre && a[n - 1 - suf] === b[m - 1 - suf]) suf++
  if (pre === n && pre === m) return []

  const middle = diffMiddle(a.slice(pre, n - suf), b.slice(pre, m - suf))
  if (middle === null) return null
  return middle.map(([os, oe, ns, ne]) => [os + pre, oe + pre, ns + pre, ne + pre])
}

export function diffMiddle(a, b) {
  const n = a.length
  const m = b.length
  if (n === 0 && m === 0) return []
  if (n === 0 || m === 0) return [[0, n, 0, m]]

  let v = new Map([[1, 0]])
  const trace = []
  for (let d = 0; d <= n + m; d++) {
    if (d > MAX_D) return null
    trace.push(new Map(v))
    for (let k = -d; k <= d; k += 2) {
      let x
      if (k === -d || (k !== d && (v.get(k - 1) ?? -1) < (v.get(k + 1) ?? -1))) {
        x = v.get(k + 1) ?? 0
      } else {
        x = (v.get(k - 1) ?? 0) + 1
      }
      let y = x - k
      while (x < n && y < m && a[x] === b[y]) { x++; y++ }
      v.set(k, x)
      if (x >= n && y >= m) return hunksFromMatches(backtrack(trace, n, m), n, m)
    }
  }
  return null
}

function backtrack(trace, n, m) {
  let x = n
  let y = m
  const matches = []
  for (let d = trace.length - 1; d >= 0; d--) {
    const v = trace[d]
    const k = x - y
    const prevK = (k === -d || (k !== d && (v.get(k - 1) ?? -1) < (v.get(k + 1) ?? -1))) ? k + 1 : k - 1
    const prevX = v.get(prevK) ?? 0
    const prevY = prevX - prevK
    while (x > prevX && y > prevY) {
      matches.push([x - 1, y - 1])
      x--
      y--
    }
    x = prevX
    y = prevY
  }
  return matches.reverse()
}

function hunksFromMatches(matches, n, m) {
  const out = []
  let ai = 0
  let bi = 0
  for (const [ma, mb] of matches) {
    if (ma > ai || mb > bi) out.push([ai, ma, bi, mb])
    ai = ma + 1
    bi = mb + 1
  }
  if (ai < n || bi < m) out.push([ai, n, bi, m])
  return out
}
