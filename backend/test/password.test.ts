import { describe, expect, it } from 'vitest'
import { hashPassword, verifyPassword } from '../src/lib/password'

describe('password hardening', () => {
  it('hashes password using bcrypt format', async () => {
    const hashed = await hashPassword('admin12345')
    expect(hashed.startsWith('$2')).toBe(true)
  })

  it('verifies and upgrades legacy sha256 hash', async () => {
    const legacySha256 = '41e5653fc7aeb894026d6bb7b2db7f65902b454945fa8fd65a6327047b5277fb'
    const result = await verifyPassword('admin12345', legacySha256)
    expect(result.ok).toBe(true)
    expect(result.needsRehash).toBe(true)
    expect(result.upgradedHash?.startsWith('$2')).toBe(true)
  })
})
