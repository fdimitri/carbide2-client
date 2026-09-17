// Synchronous SHA-1 over the UTF-8 bytes of a string, as lowercase hex.
//
// Only used for the fallback OT tie-break priority (Delta#priorityFor), which
// must match the server's Digest::SHA1.hexdigest so both sides break an
// insert-vs-insert tie the same way. Not for anything security related.
// (SubtleCrypto is async, which the transform cannot be.)

const encoder = new TextEncoder()

function rotl(x, n) {
  return (x << n) | (x >>> (32 - n))
}

export function sha1Hex(str) {
  const bytes = encoder.encode(str)
  const bitLen = bytes.length * 8
  const total = (((bytes.length + 9) + 63) >> 6) << 6
  const msg = new Uint8Array(total)
  msg.set(bytes)
  msg[bytes.length] = 0x80
  const view = new DataView(msg.buffer)
  view.setUint32(total - 8, Math.floor(bitLen / 0x100000000))
  view.setUint32(total - 4, bitLen >>> 0)

  let h0 = 0x67452301, h1 = 0xefcdab89, h2 = 0x98badcfe, h3 = 0x10325476, h4 = 0xc3d2e1f0
  const w = new Int32Array(80)
  for (let off = 0; off < total; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getInt32(off + i * 4)
    for (let i = 16; i < 80; i++) w[i] = rotl(w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16], 1)
    let a = h0, b = h1, c = h2, d = h3, e = h4
    for (let i = 0; i < 80; i++) {
      let f, k
      if (i < 20) { f = (b & c) | (~b & d); k = 0x5a827999 }
      else if (i < 40) { f = b ^ c ^ d; k = 0x6ed9eba1 }
      else if (i < 60) { f = (b & c) | (b & d) | (c & d); k = 0x8f1bbcdc }
      else { f = b ^ c ^ d; k = 0xca62c1d6 }
      const t = (rotl(a, 5) + f + e + k + w[i]) | 0
      e = d; d = c; c = rotl(b, 30); b = a; a = t
    }
    h0 = (h0 + a) | 0; h1 = (h1 + b) | 0; h2 = (h2 + c) | 0; h3 = (h3 + d) | 0; h4 = (h4 + e) | 0
  }
  return [h0, h1, h2, h3, h4].map(h => (h >>> 0).toString(16).padStart(8, '0')).join('')
}
