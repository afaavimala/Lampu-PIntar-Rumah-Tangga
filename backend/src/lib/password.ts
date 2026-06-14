import { compare } from 'bcryptjs'
import { sha256Hex } from './crypto'

const PBKDF2_ITERATIONS = 100_000
const PBKDF2_SALT_BYTES = 16
const PBKDF2_HASH_BYTES = 32
const PBKDF2_PREFIX = 'pbkdf2-sha256'

type VerificationResult = {
  ok: boolean
  needsRehash: boolean
  upgradedHash: string | null
}

function isBcryptHash(storedHash: string) {
  return storedHash.startsWith('$2a$') || storedHash.startsWith('$2b$') || storedHash.startsWith('$2y$')
}

function isLegacySha256Hash(storedHash: string) {
  return /^[a-f0-9]{64}$/i.test(storedHash)
}

function bytesToHex(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function hexToBytes(hex: string) {
  if (hex.length % 2 !== 0 || !/^[a-f0-9]+$/i.test(hex)) {
    return null
  }

  const bytes = new Uint8Array(hex.length / 2)
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16)
  }
  return bytes
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array) {
  if (a.length !== b.length) {
    return false
  }

  let diff = 0
  for (let index = 0; index < a.length; index += 1) {
    diff |= a[index] ^ b[index]
  }
  return diff === 0
}

export function isPreferredPasswordHash(storedHash: string) {
  return storedHash.startsWith(`${PBKDF2_PREFIX}$`)
}

function toArrayBuffer(bytes: Uint8Array) {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

async function derivePbkdf2(password: string, salt: Uint8Array, iterations: number) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  )
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt: toArrayBuffer(salt),
      iterations,
    },
    key,
    PBKDF2_HASH_BYTES * 8,
  )
  return new Uint8Array(bits)
}

async function pbkdf2Hash(password: string) {
  const salt = new Uint8Array(PBKDF2_SALT_BYTES)
  crypto.getRandomValues(salt)
  const derived = await derivePbkdf2(password, salt, PBKDF2_ITERATIONS)
  return `${PBKDF2_PREFIX}$${PBKDF2_ITERATIONS}$${bytesToHex(salt)}$${bytesToHex(derived)}`
}

async function verifyPbkdf2(password: string, storedHash: string) {
  const parts = storedHash.split('$')
  if (parts.length !== 4 || parts[0] !== PBKDF2_PREFIX) {
    return false
  }

  const iterations = Number(parts[1])
  const salt = hexToBytes(parts[2] ?? '')
  const expected = hexToBytes(parts[3] ?? '')
  if (!Number.isInteger(iterations) || iterations < 1 || !salt || !expected) {
    return false
  }

  const actual = await derivePbkdf2(password, salt, iterations)
  return timingSafeEqual(actual, expected)
}

function bcryptCompare(password: string, storedHash: string): Promise<boolean> {
  return new Promise((resolve, reject) => {
    compare(password, storedHash, (error, same) => {
      if (error) {
        reject(error)
        return
      }
      resolve(!!same)
    })
  })
}

export async function hashPassword(password: string) {
  return pbkdf2Hash(password)
}

export async function verifyPassword(password: string, storedHash: string): Promise<VerificationResult> {
  if (isPreferredPasswordHash(storedHash)) {
    const ok = await verifyPbkdf2(password, storedHash)
    return { ok, needsRehash: false, upgradedHash: null }
  }

  if (isBcryptHash(storedHash)) {
    const ok = await bcryptCompare(password, storedHash)
    return {
      ok,
      needsRehash: ok,
      upgradedHash: ok ? await hashPassword(password) : null,
    }
  }

  if (!isLegacySha256Hash(storedHash)) {
    return { ok: false, needsRehash: false, upgradedHash: null }
  }

  const providedPasswordHash = await sha256Hex(password)
  if (providedPasswordHash !== storedHash) {
    return { ok: false, needsRehash: false, upgradedHash: null }
  }

  const upgradedHash = await hashPassword(password)
  return { ok: true, needsRehash: true, upgradedHash }
}
