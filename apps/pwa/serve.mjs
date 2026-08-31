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

import { createServer, request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { serveTalariaConfig } from './talaria-config.mjs'

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
// Upstream scheme: TLS gateway (e.g. https://hermes.tillmanbuildstech.com) is
// reached over https on the default 443; plain http on 80. Node's url.port is
// empty when a default port is implied, so derive it explicitly per scheme.
const GATEWAY_IS_HTTPS = GATEWAY.protocol === 'https:'
const GATEWAY_PORT = GATEWAY.port || (GATEWAY_IS_HTTPS ? 443 : 80)
const gatewayRequest = GATEWAY_IS_HTTPS ? httpsRequest : httpRequest

// Console path families the app addresses on the gateway (forwarded verbatim).
function isGatewayPath(path) {
  return (
    path === '/api' || path.startsWith('/api/') ||
    path === '/v1' || path.startsWith('/v1/') ||
    path.startsWith('/p/')
  )
}

// Serve the REAL per-profile API keys so the app can auto-provision every agent
// (never fabricated, never committed to the repo — read at runtime from the
// host's Hermes profile env files). Only enabled on this local host. Logic
// lives in the shared talaria-config.mjs so the Vite dev server (the live path
// the app actually uses) can serve the exact same payload.
async function serveConfig(res) {
  serveTalariaConfig(res)
}

// ───────────────────────────────────────────────────────────────────────────
// Kanban bridge — reads the REAL Hermes kanban board (per-project SQLite) so
// the Command Center renders live dispatcher state, never a forked board.
//   GET  /kanban-api/board?board=<slug>         → full board grouped by column
//   GET  /kanban-api/tasks/:id?board=<slug>     → task detail (deps, comments,
//                                                 runs, attachments)
//   POST /kanban-api/tasks/:id/archive          → archive a task (zombie-kill)
//   POST /kanban-api/tasks/:id/unblock          → unblock a stale-blocked task
//
// Board resolution mirrors hermes_cli.kanban_db: the default board lives at
// <home>/kanban.db; named boards (one per project, keyed by project slug) live
// at <home>/kanban/boards/<slug>/kanban.db. Reads go straight to SQLite (fast,
// WAL-safe); writes shell the `hermes kanban` CLI so mutations share the exact
// code path as the dispatcher/CLI — no drift between surfaces.
// ───────────────────────────────────────────────────────────────────────────

const KANBAN_BOARD_SLUG_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/

// Resolve the shared kanban home the way hermes_cli.kanban_db does: the board
// is shared across profiles, so a HERMES_HOME pointing at a profile dir
// (…/profiles/<name>) anchors to the parent root, not the profile subdir.
function kanbanHome() {
  const home = process.env.HERMES_HOME || ''
  const m = home.match(/^(.+)\/profiles\/[^/]+\/?$/)
  return (m ? m[1] : home) || HERMES_HOME
}

function kanbanBoardPath(board) {
  // board: project slug, "default", or "" (empty = default board).
  const slug = (board || '').trim().toLowerCase()
  if (slug === '' || slug === 'default') return join(kanbanHome(), 'kanban.db')
  if (!KANBAN_BOARD_SLUG_RE.test(slug)) throw new Error(`invalid board slug: ${slug}`)
  return join(kanbanHome(), 'kanban', 'boards', slug, 'kanban.db')
}

function openBoard(board) {
  const path = kanbanBoardPath(board)
  if (!existsSync(path)) return null // project with no board yet → empty board
  return new DatabaseSync(path, { readOnly: true })
}

const BOARD_COLUMNS = ['triage', 'todo', 'scheduled', 'ready', 'running', 'blocked', 'review', 'done']

function rowTaskDict(row) {
  // Surface the fields the Command Center card + detail need; body stays short
  // on the board (full body comes from /kanban-api/tasks/:id).
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    priority: row.priority ?? 0,
    assignee: row.assignee ?? null,
    created_by: row.created_by ?? null,
    created_at: row.created_at ?? null,
    started_at: row.started_at ?? null,
    completed_at: row.completed_at ?? null,
    body: row.body ?? null,
    branch_name: row.branch_name ?? null,
    workspace_kind: row.workspace_kind ?? null,
    workspace_path: row.workspace_path ?? null,
    model_override: row.model_override ?? null,
    project_id: row.project_id ?? null,
    block_kind: row.block_kind ?? null,
  }
}

// Read the REAL board for a project slug. Returns { board, columns } where
// columns maps each status name to its task cards. Falls back to an empty
// board when the project has no DB yet (so the UI shows a clean "no board").
function readBoard(board) {
  const db = openBoard(board)
  const columns = {}
  for (const c of BOARD_COLUMNS) columns[c] = []
  if (!db) return { board: board || 'default', columns, exists: false }
  try {
    const tasks = db.prepare(
      `SELECT id,title,body,status,priority,assignee,created_by,created_at,started_at,completed_at,
              branch_name,workspace_kind,workspace_path,model_override,project_id,block_kind
         FROM tasks WHERE status != 'archived' ORDER BY priority DESC, created_at ASC`
    ).all()
    // Link + comment counts (one pass each).
    const linkCounts = {}
    for (const r of db.prepare('SELECT parent_id, child_id FROM task_links').all()) {
      linkCounts[r.parent_id] ??= { parents: 0, children: 0 }
      linkCounts[r.parent_id].children++
      linkCounts[r.child_id] ??= { parents: 0, children: 0 }
      linkCounts[r.child_id].parents++
    }
    const commentCounts = {}
    for (const r of db.prepare('SELECT task_id, COUNT(*) AS n FROM task_comments GROUP BY task_id').all()) {
      commentCounts[r.task_id] = r.n
    }
    const runs = db.prepare(
      `SELECT r.task_id, r.summary, r.outcome, r.status, r.ended_at
         FROM task_runs r
         JOIN (SELECT task_id, MAX(id) AS mid FROM task_runs GROUP BY task_id) m
           ON m.mid = r.id`
    ).all()
    const latestSummary = {}
    for (const r of runs) if (r.summary) latestSummary[r.task_id] = r.summary

    for (const t of tasks) {
      const d = rowTaskDict(t)
      d.link_counts = linkCounts[t.id] || { parents: 0, children: 0 }
      d.comment_count = commentCounts[t.id] || 0
      d.latest_summary = latestSummary[t.id] || null
      const col = d.status in columns ? d.status : 'todo'
      columns[col].push(d)
    }
    return { board: board || 'default', columns, exists: true }
  } finally {
    db.close()
  }
}

// Full task detail: deps, comments, runs, attachments, plus the task row.
function readTask(board, taskId) {
  const db = openBoard(board)
  if (!db) return null
  try {
    const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId)
    if (!task) return null
    const parents = db.prepare('SELECT parent_id AS id FROM task_links WHERE child_id = ? ORDER BY parent_id').all(taskId).map(r => r.id)
    const children = db.prepare('SELECT child_id AS id FROM task_links WHERE parent_id = ? ORDER BY child_id').all(taskId).map(r => r.id)
    const comments = db.prepare('SELECT id, author, body, created_at FROM task_comments WHERE task_id = ? ORDER BY created_at').all(taskId)
    const runs = db.prepare(
      `SELECT id, profile, status, outcome, summary, metadata, error, started_at, ended_at, worker_pid
         FROM task_runs WHERE task_id = ? ORDER BY id`
    ).all(taskId)
    const attachments = db.prepare(
      `SELECT id, filename, content_type, size, uploaded_by, created_at, stored_path
         FROM task_attachments WHERE task_id = ? ORDER BY created_at`
    ).all(taskId)
    return { task: rowTaskDict(task), parents, children, comments, runs, attachments }
  } finally {
    db.close()
  }
}

// Writes shell the CLI so mutations share the dispatcher/CLI code path.
function runKanbanCli(board, args) {
  const cmd = ['kanban']
  const slug = (board || '').trim().toLowerCase()
  if (slug && slug !== 'default') cmd.push('--board', slug)
  cmd.push(...args)
  try {
    const out = execFileSync('hermes', cmd, { encoding: 'utf8', timeout: 30000 })
    return { ok: true, out }
  } catch (err) {
    return { ok: false, error: String(err.stderr || err.message || err) }
  }
}

function sendJson(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
  res.end(JSON.stringify(obj))
}

async function serveKanban(req, res, url) {
  const method = req.method
  const pathname = url.pathname
  const board = url.searchParams.get('board') || ''

  // GET /kanban-api/board
  if (method === 'GET' && pathname === '/kanban-api/board') {
    try {
      sendJson(res, 200, readBoard(board))
    } catch (err) {
      sendJson(res, 400, { error: err.message })
    }
    return
  }

  // GET /kanban-api/tasks/:id  |  POST /kanban-api/tasks/:id/{archive,unblock}
  const m = pathname.match(/^\/kanban-api\/tasks\/([^/]+)(?:\/(archive|unblock))?$/)
  if (m) {
    const taskId = decodeURIComponent(m[1])
    const action = m[2]
    if (method === 'GET' && !action) {
      try {
        const detail = readTask(board, taskId)
        if (!detail) return sendJson(res, 404, { error: `task ${taskId} not found` })
        return sendJson(res, 200, detail)
      } catch (err) {
        return sendJson(res, 500, { error: err.message })
      }
    }
    if (method === 'POST' && action === 'archive') {
      const result = runKanbanCli(board, ['archive', taskId])
      return sendJson(res, result.ok ? 200 : 502, result)
    }
    if (method === 'POST' && action === 'unblock') {
      const result = runKanbanCli(board, ['unblock', taskId])
      return sendJson(res, result.ok ? 200 : 502, result)
    }
    return sendJson(res, 405, { error: 'method not allowed' })
  }

  return sendJson(res, 404, { error: 'not found' })
}

// ───────────────────────────────────────────────────────────────────────────
// Host directory listing — lets the web folder picker browse the host
// filesystem to pick a project's folder (project ↔ folder/repo tie, P9).
//   GET /api/v1/host/directory?path=<path> → { path, entries:[{name,isDir,isGitRepo}] }
// Mirrors the desktop native adapter (DocsFileSystem.listDir + git peek) so
// both shells reach the SAME host directory. Runs locally (this server lives
// on the Hermes host) rather than being proxied to the gateway.
// ───────────────────────────────────────────────────────────────────────────

// Expand a picker path into a safe absolute host path. `~` resolves to HOME
// (matches the desktop adapter, which reads relative to the user's home). Path
// traversal (".." segments) is rejected, and the resolved path is constrained
// to within the user's home — the same ceiling the desktop adapter and the
// picker's up-navigation enforce. Returns null for unsafe/invalid input.
function resolveHostDir(path) {
  const raw = (path || '').trim()
  if (!raw) return null
  // Reject traversal on the RAW value first (before ~ expansion, so a crafted
  // "~/../etc" cannot slip through once ".." has been consumed by join).
  if (raw.split('/').includes('..')) return null
  const home = process.env.HOME || (HERMES_HOME && dirname(HERMES_HOME)) || '/root'
  let expanded = raw
  if (expanded === '~') expanded = home
  else if (expanded.startsWith('~/')) expanded = join(home, expanded.slice(2))
  const cleaned = expanded.replace(/\/+/g, '/').replace(/\/$/, '')
  if (!cleaned) return null
  const abs = cleaned.startsWith('/') ? cleaned : join(home, cleaned)
  // Constrain to within the user's home (matches the desktop adapter, which
  // reads relative to BaseDirectory.Home). Prevents escaping the base.
  if (abs !== home && !abs.startsWith(home + '/')) return null
  return abs
}

// List one directory: { name, isDir } per entry, flagging subdirectories that
// are git repo roots (have a .git file or dir). Non-existent / unreadable
// paths yield 404 so the picker surfaces a clean error.
function serveHostDirectory(res, url) {
  const target = resolveHostDir(url.searchParams.get('path'))
  if (!target) return sendJson(res, 400, { error: 'invalid path' })
  let entries
  try {
    const children = readdirSync(target, { withFileTypes: true })
    entries = children.map((e) => {
      if (!e.isDirectory()) return { name: e.name, isDir: false }
      const isGitRepo = existsSync(join(target, e.name, '.git'))
      return { name: e.name, isDir: true, isGitRepo }
    })
  } catch (err) {
    return sendJson(res, 404, { error: err.code === 'ENOENT' ? `no such directory: ${target}` : String(err.message || err) })
  }
  return sendJson(res, 200, { path: target, entries })
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

  const upReq = gatewayRequest(
    { host: GATEWAY.hostname, port: GATEWAY_PORT, path: upstream, method: req.method, headers },
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

    // 0.5) Kanban bridge — live Hermes board reads + hygiene writes
    if (url.pathname === '/kanban-api/board' || url.pathname.startsWith('/kanban-api/tasks/')) {
      if (req.method === 'OPTIONS') {
        res.writeHead(204).end()
        return
      }
      await serveKanban(req, res, url)
      return
    }

    // 0.75) Host directory listing — web folder picker (local, host-fs)
    if (url.pathname === '/api/v1/host/directory') {
      if (req.method === 'OPTIONS') {
        res.writeHead(204).end()
        return
      }
      if (req.method !== 'GET') return sendJson(res, 405, { error: 'method not allowed' })
      serveHostDirectory(res, url)
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