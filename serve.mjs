// Local static + gateway-proxy server for Talaria.
//
// Serves the production build (dist/) AND proxies /api/* to the Hermes gateway
// so the app's default baseUrl (/api/v1) works same-origin — no CORS, and the
// browser never needs direct access to the loopback gateway (127.0.0.1:8642).
//
//   PORT=8643 GATEWAY_URL=http://127.0.0.1:8642 node serve.mjs
//
// The /api prefix is stripped before forwarding (like the Vite dev proxy), and
// Origin/Referer headers are removed (the gateway rejects browser origins).

import { createServer, request } from 'node:http'
import { readFile, readdir } from 'node:fs/promises'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DIST = join(__dirname, 'dist')
const PORT = Number(process.env.PORT || 8643)
const GATEWAY = new URL(process.env.GATEWAY_URL || 'http://127.0.0.1:8642')
const HERMES_HOME = process.env.HERMES_HOME || '/root/.hermes'

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8'
}

// Headers we never forward upstream.
const HOP = new Set([
  'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
  'te', 'trailer', 'transfer-encoding', 'upgrade', 'host', 'content-length'
])
const GATEWAY_HOST = `${GATEWAY.hostname}${GATEWAY.port ? ':' + GATEWAY.port : ''}`

// Console path families the app addresses on the gateway (forwarded verbatim).
function isGatewayPath(path) {
  return (
    path === '/api' || path.startsWith('/api/') ||
    path === '/v1' || path.startsWith('/v1/') ||
    path.startsWith('/p/')
  )
}

// Read API_SERVER_KEY from an env file (quotes trimmed).
function readApiServerKey(envPath) {
  if (!existsSync(envPath)) return ''
  try {
    for (const line of readFileSync(envPath, 'utf8').split('\n')) {
      const t = line.trim()
      if (t.startsWith('API_SERVER_KEY=')) {
        return t.slice('API_SERVER_KEY='.length).trim().replace(/^"|"$/g, '')
      }
    }
  } catch { /* ignore */ }
  return ''
}

// Read the top-level `model:` block from a profile's config.yaml — the real
// model + provider Hermes is configured to run for that profile, plus any
// explicit context_length (context window) override.
function readProfileModel(profileDir) {
  const cfgPath = join(profileDir, 'config.yaml')
  if (!existsSync(cfgPath)) return {}
  try {
    const lines = readFileSync(cfgPath, 'utf8').split('\n')
    let inModel = false
    let model = '', provider = '', contextLength = null
    for (const raw of lines) {
      if (!inModel) {
        if (/^model:\s*$/.test(raw)) { inModel = true; continue }
        continue
      }
      const m = raw.match(/^(\s+)(\S+):\s*(.*)$/)
      if (!m) break // left the model block (top-level key)
      const k = m[2]
      const v = m[3].trim().replace(/^['"]|['"]$/g, '')
      if (k === 'provider') provider = v
      else if (k === 'default') model = v
      else if (k === 'context_length') {
        const n = Number.parseInt(v, 10)
        if (Number.isFinite(n)) contextLength = n
      }
    }
    return { model, provider, contextLength }
  } catch { return {} }
}

// Scan the host's Hermes env files (.env + every profile/.env) for a
// provider credential variable. A key "present" means that provider's models
// are actually usable — the honest gate for which models to offer.
function envKeyPresent(varName) {
  const files = [join(HERMES_HOME, '.env')]
  try {
    const profilesDir = join(HERMES_HOME, 'profiles')
    if (existsSync(profilesDir)) {
      for (const name of readdirSync(profilesDir)) files.push(join(profilesDir, name, '.env'))
    }
  } catch { /* ignore */ }
  const prefix = varName + '='
  for (const f of files) {
    if (!existsSync(f)) continue
    try {
      for (const line of readFileSync(f, 'utf8').split('\n')) {
        const t = line.trim()
        if (t.startsWith(prefix)) {
          const v = t.slice(prefix.length).trim().replace(/^['"]|['"]$/g, '')
          if (v) return true
        }
      }
    } catch { /* ignore */ }
  }
  return false
}

// Model providers the host has credentials for. Only these providers' models
// will actually run, so only their models are shown in the dropdown.
function modelProvidersAvailable() {
  const map = {
    openrouter: ['OPENROUTER_API_KEY'],
    'opencode-go': ['OPENCODE_GO_API_KEY'],
    anthropic: ['ANTHROPIC_API_KEY'],
    openai: ['OPENAI_API_KEY'],
    gemini: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'],
    deepseek: ['DEEPSEEK_API_KEY'],
    'x-ai': ['XAI_API_KEY', 'GROK_API_KEY'],
    groq: ['GROQ_API_KEY'],
    mistral: ['MISTRAL_API_KEY'],
    nvidia: ['NVIDIA_API_KEY'],
    minimax: ['MINIMAX_API_KEY'],
    moonshot: ['MOONSHOT_API_KEY'],
    'z-ai': ['ZAI_API_KEY', 'GLM_API_KEY']
  }
  const present = []
  for (const [provider, vars] of Object.entries(map)) {
    if (vars.some(v => envKeyPresent(v))) present.push(provider)
  }
  return present
}

// Serve the REAL per-profile API keys so the app can auto-provision every agent
// (never fabricated, never committed to the repo — read at runtime from the
// host's Hermes profile env files). Only enabled on this local host.
async function serveConfig(res) {
  let base = readApiServerKey(join(HERMES_HOME, '.env'))
  const agents = {}
  const models = {}
  try {
    const profilesDir = join(HERMES_HOME, 'profiles')
    if (existsSync(profilesDir)) {
      for (const name of await readdir(profilesDir)) {
        const dir = join(profilesDir, name)
        const key = readApiServerKey(join(dir, '.env'))
        if (key) agents[name] = key
        const m = readProfileModel(dir)
        if (m.model) models[name] = { model: m.model, provider: m.provider || '', contextLength: m.contextLength || null }
      }
    }
  } catch { /* ignore */ }
  // Container deployment fallback: when the host's profile dirs aren't
  // present (Coolify), keys come from env secrets instead.
  if (!base && process.env.TALARIA_BASE_KEY) base = process.env.TALARIA_BASE_KEY
  if (Object.keys(agents).length === 0 && process.env.TALARIA_AGENT_KEYS) {
    try {
      const parsed = JSON.parse(process.env.TALARIA_AGENT_KEYS)
      for (const [name, key] of Object.entries(parsed)) {
        if (name && key) agents[name] = key
      }
    } catch { /* ignore */ }
  }
  const body = JSON.stringify({ base, agents, models, modelProviders: modelProvidersAvailable() })
  res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
  res.end(body)
}

// Forward a gateway-path request upstream, dropping browser origins the
// gateway rejects. A leading "/api/v1" (the pre-sync app path) is rewritten to
// "/v1" for backward compat with service-worker-cached bundles.
function forwardGateway(req, res, path) {
  const upstream = path.startsWith('/api/v1') ? path.slice('/api'.length) : path
  const headers = {}
  for (const [k, v] of Object.entries(req.headers)) {
    if (HOP.has(k)) continue
    if (k === 'origin' || k === 'referer') continue
    headers[k] = v
  }
  headers['host'] = GATEWAY_HOST

  const upReq = request(
    { host: GATEWAY.hostname, port: GATEWAY.port, path: upstream, method: req.method, headers },
    (upRes) => {
      res.writeHead(upRes.statusCode || 502, upRes.headers)
      upRes.pipe(res)
    }
  )
  upReq.on('error', () => {
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'text/plain' })
      res.end('Gateway unavailable')
    } else {
      res.end()
    }
  })
  req.pipe(upReq)
}

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x')

    // 0) Local config endpoint: real per-profile API keys for auto-provisioning
    if (url.pathname === '/talaria-config') {
      await serveConfig(res)
      return
    }

    // 1) Gateway API path (chat /v1, sessions /api, multiplex /p) → proxy
    if (isGatewayPath(url.pathname)) {
      if (req.method === 'OPTIONS') {
        res.writeHead(204).end()
        return
      }
      forwardGateway(req, res, url.pathname)
      return
    }

    // 2) Static files (GET/HEAD only)
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405).end()
      return
    }

    let pathname
    try {
      pathname = decodeURIComponent(url.pathname)
    } catch {
      pathname = url.pathname
    }
    let file = join(DIST, normalize(pathname))
    if (file !== DIST && !file.startsWith(DIST + '/')) {
      res.writeHead(403).end('Forbidden')
      return
    }

    let body
    try {
      body = await readFile(file)
    } catch {
      // SPA fallback → index.html
      file = join(DIST, 'index.html')
      body = await readFile(file)
    }
    // Service worker + workbox must never be HTTP-cached, or the browser keeps
    // serving a stale SW (and its cached bundle) for the cache lifetime.
    const name = pathname.split('/').pop() || ''
    const isSw = name === 'sw.js' || name.startsWith('workbox-')
    const cacheControl = extname(file) === '.html' || isSw
      ? 'no-cache, no-store, must-revalidate'
      : 'public, max-age=86400'
    res.writeHead(200, {
      'Content-Type': MIME[extname(file)] || 'application/octet-stream',
      'Content-Length': body.length,
      'Cache-Control': cacheControl
    })
    res.end(body)
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'text/plain' })
    res.end('Server error: ' + err.message)
  }
}).listen(PORT, '0.0.0.0', () => {
  console.log(`Talaria → http://0.0.0.0:${PORT}  (dist=${DIST}, gateway=${GATEWAY_HOST})`)
})