export async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return toHex(new Uint8Array(digest))
}

export async function hmacSha256Hex(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    {
      name: 'HMAC',
      hash: 'SHA-256',
    },
    false,
    ['sign'],
  )

  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload))
  return toHex(new Uint8Array(sig))
}

export function buildCommandSigningPayload(command: {
  deviceId: string
  action: 'ON' | 'OFF'
  requestId: string
  issuedAt: number
  expiresAt: number
  nonce: string
}) {
  return [
    command.deviceId,
    command.action,
    command.requestId,
    command.issuedAt,
    command.expiresAt,
    command.nonce,
  ].join('|')
}

export function isValidTimezone(tz: string) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz }).format(new Date())
    return true
  } catch {
    return false
  }
}

function toHex(data: Uint8Array) {
  return [...data].map((b) => b.toString(16).padStart(2, '0')).join('')
}
