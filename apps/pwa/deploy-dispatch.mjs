// Shared server-side deployment dispatch — injects the stored Vercel API key
// into a GitHub Actions workflow_dispatch so the deploy workflow actually
// consumes it (QA FUNC-F1).
//
// The Vercel key lives server-side (encrypted at rest, see vercel-key.mjs) and
// MUST never reach the browser. The dispatch is therefore performed server-side:
// this module reads the stored key, merges it into the workflow inputs as
// `vercel_token`, and forwards the workflow_dispatch to GitHub through the same
// gateway GitHub proxy the browser would otherwise use (the gateway holds the
// GitHub token; this server never sees it).
//
//   POST /api/deployments/dispatch
//     body: { owner, repo, workflowId, ref, inputs }
//     auth: forwarded to the gateway proxy (Bearer <API_SERVER_KEY>)
//     -> GitHub's dispatch response (204) or its 4xx/5xx surfaced verbatim.
//
// IMPORTANT — GitHub rejects unknown workflow_dispatch inputs with 422, so the
// key is only injected when the target workflow actually DECLARES a
// `vercel_token` input in its YAML. Workflows that don't declare it are
// dispatched unchanged (no breakage), matching the operator's "a missing input
// does not break existing workflows".

import { getVercelApiKey } from './vercel-key.mjs'

// ── Workflow-input detection (pure, unit-tested) ─────────────────────────────
//
// Given a workflow YAML file's text, return the set of input names declared
// under `on: workflow_dispatch: inputs:`. This is a lightweight, indentation-
// aware scan (no YAML dependency in this zero-dep server). It handles the
// common shapes:
//   on: workflow_dispatch
//   on:
//     workflow_dispatch:
//       inputs:
//         vercel_token:
//           description: ...
// and returns [] when there are no dispatch inputs.

// Split YAML into lines with (indent, trimmed) — ignore blanks/comments.
function yamlLines(text) {
  const lines = []
  for (const raw of String(text || '').split(/\r?\n/)) {
    const trimmed = raw.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const indent = raw.length - raw.replace(/^\s*/, '').length
    lines.push({ indent, trimmed })
  }
  return lines
}

// Collect the mapping keys under a `workflow_dispatch:` -> `inputs:` block.
// `on:` may be written as `on:` or `on: workflow_dispatch` (inline). Returns an
// array of input key names declared for workflow_dispatch.
export function declaredDispatchInputs(yamlText) {
  const lines = yamlLines(yamlText)
  // Locate the `workflow_dispatch` mapping key, which sits inside `on:` (or is
  // the inline value of `on: workflow_dispatch`).
  let wd = -1
  for (let i = 0; i < lines.length; i++) {
    const { indent, trimmed } = lines[i]
    if (trimmed !== 'workflow_dispatch' && !trimmed.startsWith('workflow_dispatch:')) continue
    const prev = i > 0 ? lines[i - 1] : null
    // Accept: `on:` directly above (child), or `on: workflow_dispatch` inline.
    const isOnChild = prev !== null && (prev.trimmed === 'on:' || prev.trimmed === 'on')
    const isInlineValue = prev !== null && /^on:\s+workflow_dispatch/.test(prev.trimmed)
    if (isOnChild || isInlineValue) {
      wd = i
      break
    }
    // Fallback: the very first `workflow_dispatch:` at any indent, but only if
    // an `on`/`on:` key appears somewhere before it (top-level triggers).
    if (i > 0 && lines.slice(0, i).some((l) => l.trimmed === 'on:' || l.trimmed === 'on')) {
      wd = i
      break
    }
  }
  if (wd === -1) return []
  const wdIndent = lines[wd].indent

  // Find `inputs:` under workflow_dispatch (indent > wdIndent).
  let inputs = -1
  for (let i = wd + 1; i < lines.length; i++) {
    const { indent, trimmed } = lines[i]
    if (indent <= wdIndent) break // left the workflow_dispatch block
    if (trimmed === 'inputs:' || trimmed.startsWith('inputs:')) {
      inputs = i
      break
    }
  }
  if (inputs === -1) return []
  const inputsIndent = lines[inputs].indent

  // Collect top-level keys under inputs (indent == inputsIndent + 2).
  const names = []
  for (let i = inputs + 1; i < lines.length; i++) {
    const { indent, trimmed } = lines[i]
    if (indent <= inputsIndent) break
    if (indent === inputsIndent + 2 && /^[A-Za-z0-9_.-]+\s*:/.test(trimmed) && !trimmed.startsWith('- ')) {
      names.push(trimmed.split(':')[0].trim())
    }
  }
  return names
}

// Decide the final inputs to send on dispatch. If a stored key is configured
// AND the target workflow declares a `vercel_token` input, inject the key.
// Otherwise return inputs unchanged (never break a workflow that doesn't want
// the key). Pure + unit-tested.
export function buildDispatchInputs({ inputs, yamlText, key, inputName = 'vercel_token' }) {
  const merged = { ...(inputs || {}) }
  if (!key) return merged
  const declared = declaredDispatchInputs(yamlText)
  if (declared.includes(inputName)) {
    merged[inputName] = key
  }
  return merged
}

// ── HTTP surface (serve.mjs + Vite dev) ──────────────────────────────────────

function sendJson(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
  res.end(JSON.stringify(obj))
}

// Resolve a workflow's YAML text through the gateway proxy. First GET the
// workflow metadata (id -> path), then GET the file content (base64). Returns
// null on any failure — a failed read just means "don't inject" (safe default).
async function fetchWorkflowYaml(githubProxy, owner, repo, workflowId) {
  try {
    const meta = await githubProxy({
      method: 'GET',
      path: `/repos/${owner}/${repo}/actions/workflows/${workflowId}`,
    })
    if (!meta.ok || !meta.data?.path) return null
    const res = await githubProxy({
      method: 'GET',
      path: `/repos/${owner}/${repo}/contents/${meta.data.path}`,
    })
    if (!res.ok) return null
    const b64 = res.data?.content
    if (!b64) return null
    return Buffer.from(b64, 'base64').toString('utf8')
  } catch {
    return null
  }
}

// POST /api/deployments/dispatch — the server-side deployment path. Reads the
// stored Vercel key, injects it into the workflow inputs if the workflow
// declares a `vercel_token` input, and forwards the dispatch to GitHub through
// the gateway proxy (which attaches the GitHub token).
//
// deps.githubProxy(method, path, body) -> { ok, status, data } — the gateway
// GitHub-proxy call. serve.mjs/vite inject the real one (which forwards the
// browser's Authorization header so the gateway can attach the GitHub token);
// tests inject a mock.
export async function serveDeployDispatch(req, res, deps) {
  const githubProxy = deps?.githubProxy
  if (typeof githubProxy !== 'function') {
    return sendJson(res, 500, { error: 'dispatch backend not configured' })
  }

  // Read + parse the JSON body.
  let body = ''
  try {
    for await (const chunk of req) body += chunk
  } catch {
    return sendJson(res, 400, { error: 'could not read request body' })
  }
  let parsed
  try {
    parsed = JSON.parse(body || '{}')
  } catch {
    return sendJson(res, 400, { error: 'invalid JSON body' })
  }
  const { owner, repo, workflowId, ref, inputs } = parsed || {}
  if (!owner || !repo || !workflowId || !ref) {
    return sendJson(res, 400, { error: 'owner, repo, workflowId and ref are required' })
  }

  // The stored Vercel key (server-side; never returned to the browser). Allow a
  // test/sandbox override via deps.getKey; default reads the shared store.
  const getKey = deps?.getKey || getVercelApiKey
  const key = getKey()

  // Determine final inputs: inject the key only when the workflow declares it.
  const yamlText = key ? await fetchWorkflowYaml(githubProxy, owner, repo, workflowId) : null
  const finalInputs = buildDispatchInputs({ inputs, yamlText, key })

  // Forward the dispatch to GitHub through the gateway proxy. Returns 204 on
  // success (no body); GitHub 4xx/5xx surfaced verbatim.
  const dispatch = await githubProxy({
    method: 'POST',
    path: `/repos/${owner}/${repo}/actions/workflows/${workflowId}/dispatches`,
    body: { ref, inputs: finalInputs },
  })
  if (dispatch.ok) {
    res.writeHead(dispatch.status || 204, { 'Cache-Control': 'no-store' })
    res.end()
    return
  }
  const msg =
    (dispatch.data && (dispatch.data.message || dispatch.data.error)) ||
    `GitHub HTTP ${dispatch.status}`
  return sendJson(res, dispatch.status || 502, { error: msg })
}
