// Shared Talaria config builder — real per-profile API keys + model metadata.
//
// The app auto-provisions every agent's API key from GET /talaria-config
// (see applyServerConfig() in packages/talaria-ui/src/stores/chat.ts). This
// endpoint must be served on EVERY path the app actually uses:
//   - serve.mjs (production/static host + the :8643 bridge)  → serveTalariaConfig
//   - the Vite dev server (talaria-dev.service → Caddy)       → buildTalariaConfig
//   via a middleware plugin in vite.config.ts.
//
// Keys are read at runtime from the host's Hermes env files (never fabricated,
// never committed). Only meaningful on a local host; remote/public hosts simply
// get an empty agents map and fall back to whatever the app already knows.

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

// Resolve the REAL Hermes home root. HERMES_HOME may point at a single profile
// dir (…/profiles/<name>) when the process was launched from a profile-scoped
// context — unwrap it to the parent root so profile discovery finds every
// profile, not just the launching one. Mirrors serve.mjs's kanbanHome().
export function hermesHomeRoot(env = process.env) {
  const home = env.HERMES_HOME || ''
  const m = home.match(/^(.+)\/profiles\/[^/]+\/?$/)
  return (m ? m[1] : home) || '/root/.hermes'
}

// Read API_SERVER_KEY from an env file (quotes trimmed).
export function readApiServerKey(envPath) {
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
// explicit context_length override.
export function readProfileModel(profileDir) {
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

// Scan the host's Hermes env files (.env + every profile/.env) for a provider
// credential variable. A key "present" means that provider's models are
// actually usable — the honest gate for which models to offer.
function envKeyPresent(home, varName) {
  const files = [join(home, '.env')]
  try {
    const profilesDir = join(home, 'profiles')
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
export function modelProvidersAvailable(home = hermesHomeRoot()) {
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
    if (vars.some(v => envKeyPresent(home, v))) present.push(provider)
  }
  return present
}

// Build the full config payload: base key + per-profile keys/models +
// available model providers. Reads the real host Hermes config.
export function buildTalariaConfig({ home = hermesHomeRoot(), env = process.env } = {}) {
  let base = readApiServerKey(join(home, '.env'))
  const agents = {}
  const models = {}
  try {
    const profilesDir = join(home, 'profiles')
    if (existsSync(profilesDir)) {
      for (const name of readdirSync(profilesDir)) {
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
  if (!base && env.TALARIA_BASE_KEY) base = env.TALARIA_BASE_KEY
  if (Object.keys(agents).length === 0 && env.TALARIA_AGENT_KEYS) {
    try {
      const parsed = JSON.parse(env.TALARIA_AGENT_KEYS)
      for (const [name, key] of Object.entries(parsed)) {
        if (name && key) agents[name] = key
      }
    } catch { /* ignore */ }
  }
  return { base, agents, models, modelProviders: modelProvidersAvailable(home) }
}

// Serve the config as a JSON HTTP response (used by serve.mjs and the Vite
// dev middleware). Accepts a node http ServerResponse.
export function serveTalariaConfig(res, opts) {
  const body = JSON.stringify(buildTalariaConfig(opts))
  res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
  res.end(body)
}
