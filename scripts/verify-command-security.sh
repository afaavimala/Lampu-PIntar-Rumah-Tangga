#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$ROOT_DIR/scripts/lib/root-env.sh"

load_root_env "verify-security" || true

HMAC_SECRET="${VERIFY_HMAC_SECRET:-${BACKEND_SEED_SAMPLE_DEVICE_HMAC_SECRET:-${BACKEND_HMAC_GLOBAL_FALLBACK_SECRET:-}}}"
DEVICE_ID="${VERIFY_DEVICE_ID:-${BACKEND_SEED_SAMPLE_DEVICE_ID:-lampu-ruang-tamu}}"

if [[ -z "$HMAC_SECRET" ]]; then
  echo "[verify-security] Missing HMAC secret (VERIFY_HMAC_SECRET / BACKEND_SEED_SAMPLE_DEVICE_HMAC_SECRET / BACKEND_HMAC_GLOBAL_FALLBACK_SECRET)"
  exit 1
fi

echo "[verify-security] Device ID: $DEVICE_ID"

export HMAC_SECRET
export DEVICE_ID

node <<'NODE'
const crypto = await import('node:crypto')

const hmacSecret = process.env.HMAC_SECRET
const deviceId = process.env.DEVICE_ID

if (!hmacSecret || !deviceId) {
  console.error('[verify-security] Missing HMAC_SECRET or DEVICE_ID')
  process.exit(1)
}

const nonceCache = new Map()

function canonicalPayload(input) {
  return `${input.deviceId}|${input.action}|${input.requestId}|${input.issuedAt}|${input.expiresAt}|${input.nonce}`
}

function signEnvelope(input) {
  const payload = canonicalPayload(input)
  return crypto.createHmac('sha256', hmacSecret).update(payload).digest('hex')
}

function verifyEnvelope(envelope, nowMs = Date.now()) {
  if (envelope.deviceId !== deviceId) return false
  if (envelope.expiresAt <= nowMs) return false

  for (const [nonce, expiresAt] of nonceCache.entries()) {
    if (expiresAt <= nowMs) nonceCache.delete(nonce)
  }

  if (nonceCache.has(envelope.nonce)) return false

  const expected = signEnvelope(envelope)
  if (expected !== envelope.sig) return false

  nonceCache.set(envelope.nonce, envelope.expiresAt)
  return true
}

const now = Date.now()
const base = {
  deviceId,
  action: 'ON',
  requestId: `verify-${now}`,
  issuedAt: now,
  expiresAt: now + 60_000,
  nonce: crypto.randomUUID(),
}

const validEnvelope = { ...base, sig: signEnvelope(base) }
if (!verifyEnvelope(validEnvelope, now)) {
  console.error('[verify-security] FAIL: valid envelope rejected')
  process.exit(1)
}

const tamperedEnvelope = { ...base, sig: 'deadbeef' + validEnvelope.sig.slice(8) }
if (verifyEnvelope(tamperedEnvelope, now)) {
  console.error('[verify-security] FAIL: tampered signature accepted')
  process.exit(1)
}

if (verifyEnvelope(validEnvelope, now + 1000)) {
  console.error('[verify-security] FAIL: replay nonce accepted')
  process.exit(1)
}

const expiredBase = {
  ...base,
  requestId: `verify-expired-${now}`,
  nonce: crypto.randomUUID(),
  issuedAt: now - 120_000,
  expiresAt: now - 60_000,
}
const expiredEnvelope = { ...expiredBase, sig: signEnvelope(expiredBase) }
if (verifyEnvelope(expiredEnvelope, now)) {
  console.error('[verify-security] FAIL: expired envelope accepted')
  process.exit(1)
}

console.log('[verify-security] PASS: tampered/replay/expired command rejected by verifier simulation')
NODE
