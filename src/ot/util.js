// Small helpers shared by the OT modules.

// Ruby's #to_i for the values a JSON payload can carry: integers truncate,
// numeric strings parse their leading integer, everything else is 0.
export function toI(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? Math.trunc(v) : 0
  if (typeof v === 'string') {
    const n = parseInt(v, 10)
    return Number.isNaN(n) ? 0 : n
  }
  return 0
}

// Ruby's #to_s for a payload value ('' for nil).
export function toS(v) {
  return v == null ? '' : String(v)
}

// Ruby String/Array <=> for the values priorities and sort keys hold.
export function cmp(a, b) {
  if (a < b) return -1
  if (a > b) return 1
  return 0
}

// Lexicographic compare of two equal-length key arrays.
export function cmpKeys(a, b) {
  for (let i = 0; i < a.length; i++) {
    const c = cmp(a[i], b[i])
    if (c !== 0) return c
  }
  return 0
}

// Stable sort by a key array (Ruby's `each_with_index.sort_by { [key..., i] }`).
export function sortByKeys(list, keyFn) {
  return list
    .map((item, i) => ({ item, key: [...keyFn(item), i] }))
    .sort((x, y) => cmpKeys(x.key, y.key))
    .map(e => e.item)
}
