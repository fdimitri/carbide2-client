// WebAuthn client-side helpers (ADR-021).
//
// The server returns PublicKeyCredential options whose challenge/user.id are
// base64url strings (the standard JSON serialization). navigator.credentials
// expects ArrayBuffers, so we decode those fields before calling create/get.

function b64urlToBuf(b64) {
  if (typeof b64 !== 'string') return b64
  const base64 = b64.replace(/-/g, '+').replace(/_/g, '/').padEnd(b64.length + ((4 - (b64.length % 4)) % 4), '=')
  const bin = atob(base64)
  const buf = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i)
  return buf.buffer
}

function decodeOptions(options) {
  const o = { ...options }
  o.challenge = b64urlToBuf(o.challenge)
  if (o.user && o.user.id != null) o.user = { ...o.user, id: b64urlToBuf(o.user.id) }
  if (Array.isArray(o.excludeCredentials)) {
    o.excludeCredentials = o.excludeCredentials.map((c) => ({ ...c, id: b64urlToBuf(c.id) }))
  }
  if (Array.isArray(o.allowCredentials)) {
    o.allowCredentials = o.allowCredentials.map((c) => ({ ...c, id: b64urlToBuf(c.id) }))
  }
  return o
}

// Serialize the credential for POST back to the server. We send the raw-ish
// shape the server expects (the webauthn-ruby gem accepts a JSON credential
// with base64url-encoded id/rawId and the authenticatorData/signature/etc as
// base64url strings).
function credentialToJSON(credential) {
  const c = credential
  const toB64url = (buf) => {
    const bytes = new Uint8Array(buf)
    let s = ''
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i])
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  }

  const out = {
    id: c.id,
    rawId: toB64url(c.rawId),
    type: c.type,
    response: {
      clientDataJSON: toB64url(c.response.clientDataJSON),
      attestationObject: toB64url(c.response.attestationObject)
    }
  }
  return out
}

// Register a new passkey. Returns the server's response.
export async function registerPasskey(nickname) {
  const { challenge, options } = await (await import('./controlService')).beginPasskeyRegistration()
  const publicKey = decodeOptions(options)
  const credential = await navigator.credentials.create({ publicKey })
  return (await import('./controlService')).completePasskeyRegistration(
    challenge,
    credentialToJSON(credential),
    nickname
  )
}
