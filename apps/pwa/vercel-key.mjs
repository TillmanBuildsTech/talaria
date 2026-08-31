// Shared Vercel API-key store — server-side, encrypted at rest.
//
// The deployments tab needs a default Vercel API key to trigger deployments.
// That key is a credential, so it must NEVER reach the browser, and must not
// sit in plaintext on disk. This module owns the whole lifecycle:
//
//   - setVercelApiKey(apiKey)  — encrypt + persist the key (AES-256-GCM)
//   - getVercelApiKey()        — SERVER-ONLY read (decrypts) for deployment code
//   - vercelKeyConfigured()    — cheap boolean gate (no decrypt needed)
//   - serveVercelKey(req,res)  — HTTP surface for the browser:
//                                  GET /api/deployments/vercel-key
//                                    -> { configured: true|false }  (never the key)
//                                  PUT /api/deployments/vercel-key  { apiKey }
//                                    -> { configured: true }        (never echoes)
//
// Encryption: AES-256-GCM, key derived from a host secret. The master key comes
// from env TALARIA_MASTER_KEY (or TALARIA_SECRET) when present; otherwise a
// random 32-byte key is generated once and persisted at
// <home>/talaria/.master.key (mode 0600). The ciphertext + IV + auth tag live
// at <home>/talaria/vercel-key.json (mode 0600). At rest the file alone cannot
// be read without the master key, and the browser never receives either.
//
// Served on EVERY path the app actually uses (same rule as talaria-config.mjs):
//   - serve.mjs (production/static host + the :8643 bridge) → serveVercelKey
//   - the Vite dev server (talaria-dev.service → Caddy)     → serveVercelKey
// via a middleware plugin in vite.config.ts.

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'

// Resolve the REAL Hermes home root (unwraps a profile-scoped HERMES_HOME to
// the parent root, mirroring talaria-config.mjs / serve.mjs kanbanHome()).
export function hermesHomeRoot(env = process.env) {
  const home = env.HERMES_HOME || ''
  const m = home.match(/^(.+)\/profiles\/[^/]+\/?$/)
  return (m ? m[1] : home) || '/root/.hermes'
}

// ── Storage paths ───────────────────────────────────────────────────────────

function secretsDir(home) {
  return join(home, 'talaria')
}
function masterKeyPath(home) {
  return join(secretsDir(home), '.master.key')
}
function payloadPath(home) {
  return join(secretsDir(home), 'vercel-key.json')
}

// Load the 32-byte AES master key. Env secret (hex or raw) wins; otherwise a
// random key is generated once and persisted at mode 0600 so subsequent runs
// can decrypt what they encrypted before.
function loadOrCreateMasterKey(home, env) {
  const fromEnv = env.TALARIA_MASTER_KEY || env.TALARIA_SECRET
  if (fromEnv) {
    // Deterministic 32-byte derivation from the env secret.
    return createHash('sha256').update(String(fromEnv)).digest()
  }
  const p = masterKeyPath(home)
  if (existsSync(p)) {
    const hex = readFileSync(p, 'utf8').trim()
    if (hex) return Buffer.from(hex, 'hex')
  }
  mkdirSync(secretsDir(home), { recursive: true })
  const key = randomBytes(32)
  writeFileSync(p, key.toString('hex'), { mode: 0o600 })
  chmodSync(p, 0o600)
  return key
}

// ── Primitives (unit-testable, pure) ────────────────────────────────────────

// Encrypt a plaintext string with AES-256-GCM. Returns the components needed
// to decrypt (base64). Never stores or returns the raw plaintext.
export function encryptSecret(key, plaintext) {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const enc = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()
  return {
    iv: iv.toString('base64'),
    authTag: authTag.toString('base64'),
    data: enc.toString('base64'),
  }
}

// Decrypt an { iv, authTag, data } bundle. Throws on tampering (GCM auth tag
// mismatch) or bad keys — callers treat a throw as "unreadable".
export function decryptSecret(key, bundle) {
  const iv = Buffer.from(bundle.iv, 'base64')
  const authTag = Buffer.from(bundle.authTag, 'base64')
  const data = Buffer.from(bundle.data, 'base64')
  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(authTag)
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8')
}

// ── Persistence ─────────────────────────────────────────────────────────────

function readBundle(home) {
  const p = payloadPath(home)
  if (!existsSync(p)) return null
  try {
    return JSON.parse(readFileSync(p, 'utf8'))
  } catch {
    return null
  }
}

function writeBundle(home, bundle) {
  mkdirSync(secretsDir(home), { recursive: true })
  writeFileSync(payloadPath(home), JSON.stringify(bundle), { mode: 0o600 })
  chmodSync(payloadPath(home), 0o600)
}

// ── Public API (server-side) ────────────────────────────────────────────────

// Replace the default Vercel API key. Returns { configured: true } once stored.
export function setVercelApiKey(apiKey, opts = {}) {
  const home = opts.home || hermesHomeRoot(opts.env || process.env)
  const env = opts.env || process.env
  const trimmed = String(apiKey || '').trim()
  if (!trimmed) throw new Error('apiKey is required')
  const key = loadOrCreateMasterKey(home, env)
  writeBundle(home, { enc: encryptSecret(key, trimmed) })
  return { configured: true }
}

// SERVER-ONLY read: decrypt and return the full key for deployment code. Never
// called from the browser path — only from server-side deployment logic.
export function getVercelApiKey(opts = {}) {
  const home = opts.home || hermesHomeRoot(opts.env || process.env)
  const env = opts.env || process.env
  const bundle = readBundle(home)
  if (!bundle || !bundle.enc) return null
  try {
    return decryptSecret(loadOrCreateMasterKey(home, env), bundle.enc)
  } catch {
    // Unreadable (tampered / wrong master key) — treat as not configured.
    return null
  }
}

// Cheap boolean gate for the browser-facing endpoint. Returns only whether a
// key is configured — never the key itself.
export function vercelKeyConfigured(opts = {}) {
  return !!getVercelApiKey(opts)
}

function sendJson(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
  res.end(JSON.stringify(obj))
}

// HTTP surface for the browser (used by serve.mjs AND the Vite dev middleware):
//   GET /api/deployments/vercel-key  -> { configured: true|false }
//   PUT /api/deployments/vercel-key  body { apiKey }  -> { configured: true }
// The full key is never present in any response. OPTIONS is answered for CORS.
export async function serveVercelKey(req, res) {
  const method = req.method
  if (method === 'OPTIONS') {
    res.writeHead(204).end()
    return
  }
  if (method === 'GET') {
    sendJson(res, 200, { configured: vercelKeyConfigured() })
    return
  }
  if (method === 'PUT') {
    let body = ''
    try {
      for await (const chunk of req) body += chunk
    } catch (err) {
      return sendJson(res, 400, { error: 'could not read request body' })
    }
    let parsed
    try {
      parsed = JSON.parse(body || '{}')
    } catch {
      return sendJson(res, 400, { error: 'invalid JSON body' })
    }
    const apiKey = parsed?.apiKey
    if (typeof apiKey !== 'string' || !apiKey.trim()) {
      return sendJson(res, 400, { error: 'apiKey is required' })
    }
    try {
      setVercelApiKey(apiKey)
    } catch (err) {
      return sendJson(res, 500, { error: err instanceof Error ? err.message : 'could not store key' })
    }
    // Never echo the key back.
    return sendJson(res, 200, { configured: true })
  }
  return sendJson(res, 405, { error: 'method not allowed' })
}
