# Workflow Spec — M2: GitHub Connection, Repos, PRs, CI, Deployments

> Status: **Plan — M2 of the roadmap**. Implementation-ready contract for the
> GitHub workflow-integration slice. A developer can build M2 directly from this
> document.
>
> Grounding docs (read these first): [`architecture.md`](architecture.md) —
> "Connecting to GitHub" (auth decision); [`roadmap.md`](roadmap.md) — M2;
> [`product-principles.md`](product-principles.md) — **P1** (repo-gate mirroring),
> P3 (verifiable artifacts), P5 (local-first), P6 (shared brain), P8 (no ceremony),
> P9 (project scope).
>
> This spec lands M2 in `@talaria/ui` and both shells (`apps/pwa`, `apps/desktop`).

---

## 1. What the user gets (the "why")

By the end of M2, from one screen in the portal the user can:

- **Connect GitHub** with a "Login with GitHub" button (OAuth Device Flow, public
  Client ID only — no secret, no central server) or paste a **fine-grained PAT**
  as a fallback.
- **Browse repos** they have access to — branches, recent commits.
- **Review and ship PRs** — list, view the diff, approve / request changes /
  merge — while the portal **honors the repo's real enforced gates exactly** (P1).
- **See CI status** — checks and workflow runs surfaced per branch and PR.
- **Trigger and watch deployments** — via `workflow_dispatch`, with live status.

This removes the "review and ship" loop from GitHub without relaxing any of the
repo's own constraints. Per M2 acceptance:

- PR actions respect the repo's enforced gates exactly.
- A deployment can be triggered and its status observed from the app.
- Every artifact shown is linkable back to the source of truth.

---

## 2. Scope boundaries

**In scope (M2):**
- GitHub connection (device flow + PAT fallback, token lifecycle).
- Repo browser (read-only metadata, branches, commits).
- PR list / detail / diff / review / merge.
- CI checks & workflow-run surfacing.
- `workflow_dispatch` deployments + status watch.
- Local-first caching of all of the above (Dexie), scoped per project (P9).

**Out of scope (M2) — do not build:**
- Code editor / file editing (M3).
- Org/service-catalog, RBAC, multi-user (explicitly forever out of scope).
- Cross-repo orchestration (M5+).
- A hosted OAuth broker or secret-holding GitHub App server — **explicitly
  avoided** (see architecture auth decision).

---

## 3. Auth — GitHub connection (the decision, restated concretely)

### 3.1 The two supported mechanisms

1. **OAuth Device Flow (default, the "Login with GitHub" button).**
   - Talaria registers **one** GitHub App (an OAuth App) and embeds only its
     **public Client ID**. No Client Secret ships in the product, so no central
     secret-holding server is required.
   - The flow is the same mechanism as the GitHub CLI (`gh`): the app requests a
     device + user code, the user visits `https://github.com/login/device`,
     enters the code, approves, and the app polls the token endpoint until the
     user authorizes.
   - **Desktop (Tauri):** the exchange runs **natively** — the desktop app makes
     the HTTP calls itself (no CORS restriction). Token lives in the OS keychain.
   - **Web (PWA):** the browser **cannot** poll GitHub's OAuth token endpoint
     directly (GitHub sends no CORS headers on it). The token exchange is routed
     through the **user's own Hermes gateway** — the gateway (which the PWA
     already talks to) performs the device-flow exchange on the user's behalf.
     Because that's *their* machine/server, it stays local-first (P5) — no
     Talaria-hosted cloud, just a local proxy for a call the browser sandbox
     can't make.
   - The resulting token lives on the user's machine (desktop keychain) or in
     their local gateway/browser store (web) — **never on a Talaria-hosted
     server**.

2. **Fine-grained PAT (fallback).**
   - User pastes a token (fine-grained PAT scoped to `Contents: Read/Write`,
     `Pull requests: Read/Write`, `Actions: Read/Write`, `Administration: Read`
     for branch-protection reads; or a classic token with `repo` + `workflow`
     scopes) in **Settings** — zero product infrastructure, matching the existing
     API-key pattern. Supported alongside device flow; the user picks per
     connection.

### 3.2 GitHub App registration (one-time, by the maintainer — not per-user)

- Create an **OAuth App** (not a GitHub App) in the GitHub org/settings.
- Capture its **Client ID**. It is public and safe to embed.
- **No Client Secret** is ever stored or shipped. Device flow does not require
  one.
- Homepage URL / callback URL are not exercised by device flow (no redirect);
  still set them to the portal's own surface for hygiene.
- Users never need to set up their own app unless they specifically want org
  installs (out of scope here).

> **Design rule (P5 / architecture):** the product registers exactly one app
> and embeds only the public Client ID. Reject any design that adds a central
> token-brokering server or a secret-holding backend.

### 3.3 Token lifecycle

- **Acquire** — via device flow (below) or pasted PAT.
- **Store**
  - Desktop: OS keychain via Tauri (Stronghold or `keyring`-style secure store).
  - Web: the gateway holds the token (in the gateway's own secrets/state store)
    and the PWA references it; the browser never needs the raw token. If a
    browser-local store is used instead, persist in the `settings` Dexie table
    and clearly label it non-keychain.
- **Validate** — on connect, call `GET /user` (or `/user` fine-grained check) to
  confirm the token is live; surface the account login + scopes.
- **Refresh** — fine-grained PATs and device-flow OAuth access tokens do not
  auto-refresh the way the CLI's does; treat the token as valid until a `401`.
  On `401`, mark the connection as needing re-auth and surface a
  "Reconnect GitHub" affordance (never silently fail).
- **Revoke / disconnect** — user-initiated: delete the stored token (desktop
  keychain / gateway store), clear cached repo/PR data, drop the connection row.

### 3.4 Connection state model (Dexie)

New `connections` table (Dexie v3):

| Field | Type | Notes |
|---|---|---|
| `id` | string | `owner` GitHub account (login) — one connection per account |
| `owner` | string | GitHub login (e.g. `tillmanbuildstech`) |
| `type` | `'device' \| 'pat'` | how it was authorized |
| `status` | `'connected' \| 'reconnecting' \| 'revoked'` | drives UI banner |
| `scopes` | string[] | granted scopes (from `/user` or device response) |
| `tokenRef` | string | opaque ref — desktop keychain key, or gateway-store key for web; **never store the raw token here** |
| `gatewayOrigin` | string | which gateway holds the web-side token |
| `lastVerifiedAt` | number | last successful `GET /user` |
| `connectedAt` | number | |

### 3.5 Device-flow exchange — exact HTTP contract

**Desktop (native, no CORS):**

```
POST https://github.com/login/device/code
  form: client_id=<PUBLIC_CLIENT_ID>&scope=repo%20workflow
  → { device_code, user_code, verification_uri, expires_in, interval }

GET https://github.com/login/oauth/access_token  (poll, every `interval`s)
  form: client_id=<PUBLIC_CLIENT_ID>&device_code=<device_code>&grant_type=urn:ietf:params:oauth:grant-type:device_code
  → 200 { access_token, token_type: "bearer", scope }   (when user authorizes)
  → 400 { error: "authorization_pending" } → keep polling
  → 400 { error: "slow_down" } → increase interval
  → 400 { error: "expired_token" | "access_denied" } → abort, surface error
```

**Web (PWA) — routed through the user's own Hermes gateway.**

The browser cannot call GitHub's token endpoint (no CORS headers). The PWA
instead calls **the gateway**, which performs the exchange on the user's behalf.
Required gateway surface (implemented on the user's own machine, P5):

```
POST <gatewayOrigin>/api/v1/github/device/start
  body: { clientId }                    → { device_code, user_code, verification_uri, expires_in, interval }

POST <gatewayOrigin>/api/v1/github/device/poll
  body: { clientId, device_code }       → { status: "pending" } | { status: "success", token_ref } | { status: "denied" | "expired" }
```

The gateway stores the returned access token in its own local state store and
returns only an opaque `token_ref`. The PWA never sees the raw token on the web
path. (This is the only gateway addition M2 needs; everything else is the
user's gateway proxying GitHub's REST API, §5.)

> **Auth of these gateway calls:** reuse the existing `API_SERVER_KEY` /
> per-agent key pattern already used for chat (`Authorization: Bearer …`), so
> device flow rides the same trust the PWA already has with the gateway.

### 3.6 GitHub REST proxy contract (shared by both surfaces)

Rather than re-implement each GitHub REST call in two places, the GitHub client
goes through one **transport abstraction** (P6 — shared brain):

- **Desktop** → `directTransport`: calls `https://api.github.com` directly with
  `Authorization: Bearer <keychain token>`. No CORS issue.
- **Web** → `gatewayTransport`: the gateway proxies GitHub's REST API
  (server-side, no CORS), attaching the stored token:

  ```
  POST <gatewayOrigin>/api/v1/github/proxy
    body: { method: "GET"|"POST"|"PATCH"|"PUT"|"DELETE",
            path: "/repos/{owner}/{repo}/pulls/123",   // GitHub API path, always starts with "/"
            body?: object }
    → GitHub's response (status + JSON) forwarded verbatim.
  ```

  The gateway validates `path` against an allowlist prefix (`/repos/`, `/user`,
  `/orgs/`, `/repos/{o}/{r}/actions/…`, etc.) so it stays a narrow proxy, not an
  open relay.

This mirrors how the existing `services/hermes.ts` client centralizes transport
and keeps desktop/web behavior identical (P6).

---

## 4. Data model & caching (local-first, P5, P9)

### 4.1 Dexie schema additions (db.ts → version 3)

```ts
// connections — §3.4 (above)

// repos — cached repo metadata, scoped per project
type Repo = {
  id: string;              // `${owner}/${name}`
  owner: string;
  name: string;
  fullName: string;
  defaultBranch: string;
  isPrivate: boolean;
  project: string;         // P9 scope — which project this repo is attached to
  gates: RepoGates;        // §6.1 — fetched repo/branch protection
  lastFetchedAt: number;
};

// prs — cached pull requests (open by default)
type PullRequest = {
  id: number;
  repoId: string;          // FK → repos
  number: number;
  title: string;
  author: string;
  base: string;
  head: string;            // head branch (the change branch)
  headSha: string;
  state: "open" | "closed" | "merged";
  mergeableState: "clean" | "dirty" | "blocked" | "unknown" | "draft";
  draft: boolean;
  checks: ChecksSummary;   // §7
  reviewState: ReviewState; // §6.4
  url: string;             // linkable artifact (P3)
  updatedAt: number;
};

// deployments — workflow_dispatch runs we triggered / are watching
type Deployment = {
  id: string;              // GitHub run id
  repoId: string;
  workflow: string;        // workflow file path
  workflowDisplay: string;
  ref: string;             // branch/ref dispatched on
  inputs: Record<string, string>;
  headSha: string;
  status: "queued" | "in_progress" | "completed";
  conclusion?: string | null; // success | failure | cancelled | …
  triggeredAt: number;
  url: string;             // linkable artifact
  project: string;         // P9 scope
};
```

Caching rule: **repos / PRs / deployments are cached locally for offline read;
every action (merge, review, dispatch) always hits the live API and refreshes
the cache** — cache is never a source of truth for gates (P1).

---

## 5. GitHub client service

New file: `@talaria/ui/src/services/github.ts` (sibling of `hermes.ts`).

### 5.1 Shape

```ts
type GitHubTransport = {
  request<T>(opts: { method; path; body? }): Promise<GitHubResponse<T>>;
};

class GitHubClient {
  transport: GitHubTransport;          // direct (desktop) | gateway (web)
  tokenRef?: string;

  // Auth
  connectDeviceFlow(): Promise<DeviceFlowHandle>;
  verifyConnection(): Promise<{ login; scopes }>;
  disconnect(): Promise<void>;

  // Repos
  listRepos(): Promise<RepoMeta[]>;                 // GET /user/repos?per_page=100
  listBranches(repo): Promise<Branch[]>;
  listCommits(repo, branch): Promise<Commit[]>;

  // PRs
  listPullRequests(repo, state = "open"): Promise<PullRequest[]>;
  getPullRequest(repo, number): Promise<PullRequestDetail>;
  getPullRequestFiles(repo, number): Promise<DiffFile[]>;
  submitReview(repo, number, opts): Promise<void>;  // approve | request_changes | comment
  mergePullRequest(repo, number, opts): Promise<void>; // only when gates pass (§6)

  // CI
  getCheckRuns(repo, ref): Promise<CheckRun[]>;     // commits/{sha}/check-runs
  getWorkflowRuns(repo, opts): Promise<WorkflowRun[]>;

  // Deployments
  dispatchWorkflow(repo, workflow, { ref, inputs }): Promise<void>;
  getWorkflowRun(repo, runId): Promise<WorkflowRun>;
}

export const githubClient = new GitHubClient();
```

### 5.2 GitHub REST endpoints used (for reference)

| Purpose | Endpoint |
|---|---|
| Verify token / scopes | `GET /user` |
| List accessible repos | `GET /user/repos?per_page=100&affiliation=owner,collaborator` |
| List branches | `GET /repos/{o}/{r}/branches` |
| List commits | `GET /repos/{o}/{r}/commits?sha={branch}&per_page=50` |
| List PRs | `GET /repos/{o}/{r}/pulls?state=open&per_page=100` |
| PR detail | `GET /repos/{o}/{r}/pulls/{n}` |
| PR files/diff | `GET /repos/{o}/{r}/pulls/{n}/files` |
| Submit review | `POST /repos/{o}/{r}/pulls/{n}/reviews` `{ event: APPROVE|REQUEST_CHANGES|COMMENT, body }` |
| Merge PR | `PUT /repos/{o}/{r}/pulls/{n}/merge` `{ merge_method }` |
| Check runs | `GET /repos/{o}/{r}/commits/{sha}/check-runs` |
| Workflow runs | `GET /repos/{o}/{r}/actions/runs?head_sha={sha}` |
| Dispatch workflow | `POST /repos/{o}/{r}/actions/workflows/{wf}/dispatches` `{ ref, inputs }` |
| Branch protection | `GET /repos/{o}/{r}/branches/{branch}/protection` |
| Repo settings | `GET /repos/{o}/{r}` (for merge/allow settings) |

---

## 6. PR review/merge honoring repo gates (P1 — the critical module)

### 6.1 What "the repo's real gates" are (discover, don't assume)

On connect to a repo, fetch and cache `RepoGates`:

```ts
type RepoGates = {
  branchProtected: boolean;           // branch protection on defaultBranch
  requiredChecks: string[];           // required status checks (contexts/check names)
  requiredReviewers: number;          // required approving reviews (0 = none)
  enforceAdmins: boolean;
  squashOnly: boolean;                // merge_commit allowed? allow_squash_merge only
  allowMergeCommit: boolean;
  allowRebaseMerge: boolean;
  directPushAllowed: boolean;         // if branch NOT protected → users may push directly
};
```

Sources:
- `GET /repos/{o}/{r}/branches/{defaultBranch}/protection` → branch-protection
  rules (may 404 when unprotected — that is *meaningful*, P1: an unprotected
  branch means **no PR ceremony is imposed**).
- `GET /repos/{o}/{r}` → `allow_squash_merge`, `allow_merge_commit`,
  `allow_rebase_merge` → determine the merge method the repo actually permits.

### 6.2 P1 mirroring rules (behavior contract)

- **If the default branch is NOT protected** (`branchProtected === false`):
  the portal does **not** impose PR ceremony. "Merge" surfaces the repo's real
  options; agents may push straight to the branch the same way the user does.
- **If the default branch IS protected** (like `serv`): the portal **surfaces and
  honors** the gates:
  - Show required checks and their status.
  - The **Merge** control is **disabled** until:
    - `mergeable_state === "clean"` (no merge conflict, no pending required
      review), AND
    - every `requiredChecks` is passing, AND
    - `reviewState` meets `requiredReviewers` (e.g. ≥1 approving review when
      required), AND
    - merge method matches the repo's allowed set (squash-only repos → squash).
- **The portal is never more or less permissive than the repo.** If GitHub would
  reject the merge, the portal disables it and tells the user why (P1
  acceptance). It does not pre-approve, skip checks, or bypass `enforce_admins`.

### 6.3 Merge method selection

- Derive the default merge method from `RepoGates`: squash-only → `squash`;
  merge-commit-only → `merge`; rebase-only → `rebase`; multiple allowed → default
  to squash (GitHub's modern default), offer alternatives in a dropdown.
- Send exactly one `merge_method` in `PUT …/merge`. Surface the method chosen in
  the merge confirmation.

### 6.4 Review state

```ts
type ReviewState =
  | "none"            // no review yet
  | "pending"        // changes requested
  | "approved"        // approved, meets requiredReviewers
  | "changes_requested";
```

`reviewState` derives from `GET ‾/pulls/{n}/reviews` (latest review per
reviewer) combined with `requiredReviewers`. The **Approve / Request changes**
buttons call `POST …/reviews` with `{ event, body }` and refresh the PR.

### 6.5 UX (P8 — no ceremony)

- PR row shows: title, author, branch `head → base`, check dots, review badge.
- PR detail: diff (files changed, rendered), required-check list with pass/fail,
  review state, and a **Merge** button that is disabled-with-reason until gates
  pass. When disabled, the tooltip states exactly which gate is unmet.
- Link icon on every PR to `{url}` (P3 — linkable to source of truth).

---

## 7. CI status surfacing

- **Per PR:** map `headSha` → check runs
  (`GET …/commits/{headSha}/check-runs`) → render a compact status (e.g.
  `✓ 3/3 passing · ✕ CodeQL failing`) on the PR row and in PR detail.
- **Per branch:** `GET ‾/actions/runs?head_sha={sha}` for the branch head →
  show workflow runs (name, status, conclusion).
- **Live refresh:** re-fetch on PR view open and on a manual refresh; a light
  auto-poll (every 30°–ps) while a PR/run is `ins_progress` (matching the chat
  health-check cadence pattern in `hermes.ts`).
- **Linkable:** each check/run links to its GitHub URL (P3).

---

## 8. Deployments via workflow_dispatch

- **Trigger:** pick a connected repo → pick a `workflow_dispatch`-enabled
  workflow (`GET …/actions/workflows` filtered to those with
  `state: active` and dispatchable) → set `ref` + any `workflow_inputs` →
  `POST …/actions/workflows/{wf}/dispatches`.
- **Watch:** poll `GET …/actions/runs?head_sha={sha}` (or by the run created for
  that dispatch) → live status `queued → in_progress → completed` + conclusion.
- **Surface:** a Deployments panel per project (P9), each row linkable to its
  GitHub run URL (P3). Optionally surface into the observability artifacts feed
  (M1) as a `deployment` artifact.
- **Gates:** only allow dispatch on branches the user can (repo branch
  protection may restrict); surface the dispatch target ref clearly.

---

## 9. UI — module wiring (P6, P4)

### 9.1 Module registration

All modules go **into `@talaria/ui` ** (shared brain, P6) and mount from both
shells via the existing module switcher that M1 adds (`App` gains a
Command-Center module switcher: Chat / Projects / Kanban / … / **Repos** / 
**PRs** / **Deployments**). Both PWA and desktop inherit them automatically.

Suggested component set (all in `@talaria/ui/src/components/` or a new
`src/modules/github/`):

```
src/modules/github/
  github-connect.tsx      // Login with GitHub button / PAT paste / reconnect / disconnect
  repo-browser.tsx        // connected repos, branches, recent commits
  pull-request-list.tsx   // PRs for a repo/project
  pull-request-detail.tsx // diff, checks, review buttons, merge control (gated)
  ci-status.tsx           // checks/run badges
  deployments.tsx         // trigger + watch
  diff-viewer.tsx         // rendered file diff (shared; reused by observability/M3)
```

### 9.2 Zustand store

New store `src/stores/github.ts` (sibling of `chat.ts`): holds connections,
active repo, PRs, deployments, and a `fetch** / `act*` action layer that calls
`githubClient` and refreshes Dexie caches. Same pattern as `chat.ts`
(store ↔ service ↔ Dexie).

### 9.3 Desktop-only vs web affordance

- Auth: desktop does device flow natively; web routes through the gateway
  (`gatewayTransport`). The **connection surface is identical**; only the
  transport differs (P6). If the gateway proxy isn't reachable on web, show the
  standard ConnectionBanner-style affordance (mirror `connection-banner.tsx`).
- No M2 capability is desktop-only — both shells are equal for repos/PRs/CI/
  deploys. (The editor is M3 and desktop-only.)

---

## 10. Settings surface

Add to `SettingsModal` (or a new GitHub section in Settings):

- **Connected accounts:** list `connections`, show login + scopes, "Disconnect".
- **Connect via Device Flow:** "Login with GitHub" button → device code screen
  (code + `github.com/login/device` link + poll progress).
- **Add fine-grained PAT:** token paste + "Verify" (`GET /user`), on success
  create a `pat` connection.
- **Reconnect** affordance when a connection 401s.
- **Per-project repo association** (P9): which repos are attached to the active
  project (so the Repos/PRs/Deployments modules are project-scoped).

---

## 11. Errors & edge cases (P8 — fail with a reason, never silently)

| Case | Behavior |
|---|---|
| Token 401 on any call | Mark connection `reconnecting`; surface "Reconnect GitHub"; keep cached data readable (offline) but disable actions. |
| Repo has no protection | Don't impose PR ceremony (P1). Merge control reflects the repo's real permissiveness. |
| PR not mergeable / checks failing | Merge disabled with an explicit unmet-gate reason. |
| Device flow expires / denied | Surface the exact GitHub error, allow restart. |
| Gateway proxy unreachable (web) | ConnectionBanner-style "gateway offline" affordance; retry on reconnect (mirror `hermes.ts` health-check). |
| workflow_dispatch 422 (no dispatchable workflow / bad ref) | Surface GitHub's message verbatim. |
| Merge 405/409 (repo rejects) | Show GitHub's message; refresh gates (repo may have changed since cache). |

---

## 12. Verification / acceptance checklist (how a dev proves it done)

A developer implementing M2 must demonstrate, against **two real repos — one
with protected `main` (e.g. `serv`) and one unprotected**:

1. **Auth:** "Login with GitHub" (device flow) completes on **both** desktop and
   web (web via the gateway proxy). Fine-grained PAT fallback connects. A bad/revoked
   token surfaces "Reconnect GitHub", not a crash.
2. **P1 mirroring:** On the protected repo, the Merge button is disabled when
   required checks fail or a review is pending, and enabled only when all gates
   pass; the merge method honors squash-only. On the unprotected repo, no PR
   ceremony is imposed.
3. **PR flow:** list → open detail → view diff → approve → (gates pass) merge.
   Every action verifiable in GitHub and every PR/check/run links back to its
   GitHub URL.
4. **CI:** checks surface per branch and PR, with live status while in_progress.
5. **Deploy:** trigger a `workflow_dispatch` deployment from the app and watch it
   reach a terminal conclusion.
6. **Local-first (P5/P9):** repos/PRs/deployments are cached per project and
   readable offline; actions always hit live API and refresh the cache.
7. **Both shells (P6):** the modules render and function identically in
   `apps/pwa` and `apps/desktop` (only the transport differs).

---

## 13. Delivery / sequencing note

M2 depends on M1's Command Center module switcher (the Repos/PRs/Deployments
modules mount into it) and on the observability artifacts feed (M1) for linking
PR/deploy artifacts to tasks. The **one new server-side piece** is the small
gateway device-flow + REST-proxy surface (§3.5, §3.6) — implemented on the
user's own gateway, local-first (P5). Everything else is shared-frontend work in
`@talaria/ui`.

## 14. Related docs

- [`architecture.md`](architecture.md) — "Connecting to GitHub" (auth decision),
  module/client table.
- [`roadmap.md`](roadmap.md) — M2.
- [`product-principles.md`](product-principles.md) — P1 (gates), P3 (artifacts),
  P5 (local-first), P6 (shared brain), P8 (no ceremony), P9 (project scope).
- [`agent-observability.md`](agent-observability.md) — where PR/deploy artifacts
  surface for review.
