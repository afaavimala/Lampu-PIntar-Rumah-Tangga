import { compare, hash } from 'bcryptjs'
import { sha256Hex } from './crypto'

const BCRYPT_COST = 12

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

function bcryptHash(password: string): Promise<string> {
  return new Promise((resolve, reject) => {
    hash(password, BCRYPT_COST, (error, value) => {
      if (error || !value) {
        reject(error ?? new Error('Failed to hash password'))
        return
      }
      resolve(value)
    })
  })
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
  return bcryptHash(password)
}

export async function verifyPassword(password: string, storedHash: string): Promise<VerificationResult> {
  if (isBcryptHash(storedHash)) {
    const ok = await bcryptCompare(password, storedHash)
    return { ok, needsRehash: false, upgradedHash: null }
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
