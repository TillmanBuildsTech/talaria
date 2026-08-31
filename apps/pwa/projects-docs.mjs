// Shared project-docs handler — serves per-project markdown docs on BOTH paths
// the app actually uses:
//   - serve.mjs (production/static host)                          → handleProjectsDocs
//   - the Vite dev server (talaria-dev.service → Caddy)           → handleProjectsDocs
// via a middleware plugin in vite.config.ts.
//
// Contract (mirrors GatewayDocsTransport in
// packages/talaria-ui/src/services/docs.ts):
//   GET    /api/v1/projects/<slug>/docs              → [{ name, path, updatedAt? }]
//   GET    /api/v1/projects/<slug>/docs/<path>       → { name, path, content }
//   PUT    /api/v1/projects/<slug>/docs/<path>       body { content } → 204
//   DELETE /api/v1/projects/<slug>/docs/<path>                        → 204
//
// Docs are stored on the Hermes server at
//   ~/.hermes/projects/<slug>/docs/*.md   (PROJECTS_ROOT in services/docs.ts)
// OUTSIDE the repo. The transport sends these under /api/v1/projects/... which
// previously fell through to the Hermes gateway (no such route) and 404'd —
// that was the "Creating a doc doesn't work" S1. Intercepting them here keeps
// them local-first: the server this binary runs on IS the user's Hermes host.

import { existsSync } from 'node:fs'
import { readdir, readFile, writeFile, mkdir, rm } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { hermesHomeRoot } from './talaria-config.mjs'

// Matches /api/v1/projects/<slug>/docs[optional /docpath].
export const PROJECTS_DOCS_RE = /^\/api\/v1\/projects\/([^/]+)\/docs(?:\/(.+))?$/

// Slug must be a safe single path segment (same rule as kanban board slugs),
// so a hostile slug can't escape the projects root.
const SLUG_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/

export function isProjectsDocsPath(pathname) {
  return PROJECTS_DOCS_RE.test(pathname)
}

// A project's docs directory under the Hermes home.
export function projectsDocsDir(home, slug) {
  return join(home, 'projects', slug, 'docs')
}

// Resolve a doc path to an absolute file under the project's docs dir, or null
// when the slug is invalid or the path would escape the docs dir (traversal).
export function resolveDocFile(home, slug, docPath) {
  if (!SLUG_RE.test(slug)) return null
  if (!docPath) return null
  const base = resolve(projectsDocsDir(home, slug))
  const target = resolve(join(base, docPath))
  if (target !== base && !target.startsWith(base + '/')) return null
  return target
}

// Read and JSON-parse a request body (client sends { content } for PUT).
// Never throws on malformed JSON — returns {} so a bad payload is handled by
// the route (empty doc), not by crashing the server. Caps the body so a huge
// upload can't exhaust memory.
export function readJsonBody(req, cap = 10 * 1024 * 1024) {
  return new Promise((resolveBody) => {
    let data = ''
    req.on('data', (chunk) => {
      data += chunk
      if (data.length > cap) {
        req.destroy()
        resolveBody({})
      }
    })
    req.on('end', () => {
      if (!data) return resolveBody({})
      try {
        resolveBody(JSON.parse(data))
      } catch {
        resolveBody({})
      }
    })
    req.on('error', () => resolveBody({}))
  })
}

// Perform a project-docs REST operation. `pathname` is the full request path
// (e.g. /api/v1/projects/talaria/docs/plan.md). Returns
//   { status, body? }   body is the JSON payload (omitted for 204)
// or null when the path is not a docs route (caller should fall through).
export async function handleProjectsDocs({ method, pathname, body = {} }, home) {
  const m = PROJECTS_DOCS_RE.exec(pathname)
  if (!m) return null
  const slug = decodeURIComponent(m[1])
  const docPath = m[2] ? decodeURIComponent(m[2]) : null

  // Reject a hostile slug (e.g. "..%2F..") before it can drive any filesystem
  // path — every branch below joins it into the projects root.
  if (!SLUG_RE.test(slug)) {
    return { status: 403, body: { error: 'invalid project slug' } }
  }

  const dir = projectsDocsDir(home, slug)

  try {
    // List the project's markdown docs. A missing docs dir is a valid empty set.
    if (method === 'GET' && docPath == null) {
      let names = []
      if (existsSync(dir)) {
        const entries = await readdir(dir, { withFileTypes: true })
        names = entries
          .filter((e) => e.isFile() && e.name.endsWith('.md'))
          .map((e) => e.name)
          .sort()
      }
      return { status: 200, body: names.map((name) => ({ name, path: name })) }
    }

    if (method === 'GET') {
      const file = resolveDocFile(home, slug, docPath)
      if (!file) return { status: 403, body: { error: 'invalid doc path' } }
      let content
      try {
        content = await readFile(file, 'utf8')
      } catch {
        return { status: 404, body: { error: 'doc not found' } }
      }
      return {
        status: 200,
        body: { name: docPath.split('/').pop(), path: docPath, content },
      }
    }

    if (method === 'PUT') {
      const file = resolveDocFile(home, slug, docPath)
      if (!file) return { status: 403, body: { error: 'invalid doc path' } }
      const content = body && body.content != null ? String(body.content) : ''
      await mkdir(dirname(file), { recursive: true })
      await writeFile(file, content, 'utf8')
      return { status: 204 }
    }

    if (method === 'DELETE') {
      const file = resolveDocFile(home, slug, docPath)
      if (!file) return { status: 403, body: { error: 'invalid doc path' } }
      await rm(file, { force: true })
      return { status: 204 }
    }

    return { status: 405, body: { error: 'method not allowed' } }
  } catch (err) {
    return { status: 500, body: { error: err.message } }
  }
}

// Write a handleProjectsDocs result to a node http ServerResponse. Returns
// true when it handled the response (so the caller returns), false otherwise.
export function sendProjectsDocsResult(res, result) {
  if (!result) return false
  if (result.status === 204) {
    res.writeHead(204).end()
    return true
  }
  res.writeHead(result.status, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
  })
  res.end(JSON.stringify(result.body ?? {}))
  return true
}

// Convenience for a default HERMES_HOME (used by the Vite dev middleware).
export function projectsDocsHome(env = process.env) {
  return hermesHomeRoot(env)
}
