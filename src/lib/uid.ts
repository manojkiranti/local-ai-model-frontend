/**
 * Client-side ID generator for optimistic chat bubbles and similar local keys.
 *
 * `crypto.randomUUID()` is a secure-context-only API: it is undefined when the
 * built app is served over plain http:// from anything other than localhost
 * (a LAN IP, an internal hostname), which is exactly how this frontend gets
 * deployed next to the gateway. `crypto.getRandomValues()` is *not* gated that
 * way, so it stays available and we build the v4 UUID ourselves.
 */
export function uid(): string {
  const webCrypto: Crypto | undefined = globalThis.crypto
  if (typeof webCrypto?.randomUUID === 'function') return webCrypto.randomUUID()

  const bytes = new Uint8Array(16)
  if (typeof webCrypto?.getRandomValues === 'function') {
    webCrypto.getRandomValues(bytes)
  } else {
    // No Web Crypto at all. These IDs are local render keys, never secrets.
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256)
  }
  // RFC 4122 §4.4: pin the version (4) and variant (10xx) bits.
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80

  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
