import { describe, expect, it } from 'vitest'
import { buildCommandSigningPayload, hmacSha256Hex } from '../src/lib/crypto'

describe('command signing', () => {
  it('builds deterministic payload and signature', async () => {
    const payload = buildCommandSigningPayload({
      deviceId: 'lampu-1',
      action: 'ON',
      requestId: 'req-1',
      issuedAt: 1000,
      expiresAt: 2000,
      nonce: 'nonce-1',
    })

    expect(payload).toBe('lampu-1|ON|req-1|1000|2000|nonce-1')

    const sig = await hmacSha256Hex('secret', payload)
    expect(sig).toHaveLength(64)
  })
})
