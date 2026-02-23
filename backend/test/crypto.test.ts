import { describe, expect, it } from 'vitest'
import { sha256Hex } from '../src/lib/crypto'

describe('crypto utility', () => {
  it('generates deterministic SHA-256 hash', async () => {
    const digest = await sha256Hex('smartlamp')
    expect(digest).toBe('1abf8ac5fe4d449a2dbe858d6b9654c827e2353a35515569d9b2041097810235')
  })
})
