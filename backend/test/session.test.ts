import { describe, expect, it } from 'vitest'
import { createOpaqueRefreshToken, parsePositiveInt } from '../src/lib/session'

describe('session token helpers', () => {
  it('creates opaque refresh token with expected hex length', () => {
    const token = createOpaqueRefreshToken(48)
    expect(token).toMatch(/^[a-f0-9]+$/)
    expect(token.length).toBe(96)
  })

  it('parses positive int with fallback for invalid values', () => {
    expect(parsePositiveInt('900', 10)).toBe(900)
    expect(parsePositiveInt('0', 10)).toBe(10)
    expect(parsePositiveInt('-1', 10)).toBe(10)
    expect(parsePositiveInt('abc', 10)).toBe(10)
  })
})
