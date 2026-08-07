import { afterEach, describe, expect, it, vi } from 'vitest'
import { uid } from '@/lib/uid'

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('uid', () => {
  it('returns a v4 UUID when crypto.randomUUID is available', () => {
    expect(uid()).toMatch(UUID_V4)
  })

  it('still returns a v4 UUID in an insecure context, where randomUUID is undefined', () => {
    // Browsers gate randomUUID (and subtle) behind secure contexts, but leave
    // getRandomValues in place — this is the shape of `crypto` over plain http.
    vi.stubGlobal('crypto', { getRandomValues: crypto.getRandomValues.bind(crypto) })
    expect(uid()).toMatch(UUID_V4)
  })

  it('returns a v4 UUID even with no Web Crypto at all', () => {
    vi.stubGlobal('crypto', undefined)
    expect(uid()).toMatch(UUID_V4)
  })

  it('does not collide across calls', () => {
    vi.stubGlobal('crypto', { getRandomValues: crypto.getRandomValues.bind(crypto) })
    const ids = new Set(Array.from({ length: 1000 }, () => uid()))
    expect(ids.size).toBe(1000)
  })
})
