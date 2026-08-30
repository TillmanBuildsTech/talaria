# Hermes Chat — Multi-Agent Setup Guide

Talaria can talk to **every Hermes profile you run** as a separate **Agent**
(contact): message any profile directly, or add several to a group chat and
`@`-mention them. This is built on the Hermes gateway's native *profile
multiplexing* — one gateway on one port serves every profile, addressed by a
`/p/<profile>/` URL prefix.

> **The one thing you must do to make this work is enable multiplexing on the
> gateway.** Everything else below is key setup and usage. Without it, direct
> messages to profiles other than the default fail with `404` and groups can't
> reach their members.

---

## A. Enable multiplexing (required once)

The gateway API Server must serve multiple profiles. Add this to the **gateway
profile's** `config.yaml`:

```yaml
# config.yaml of the profile that OWNS the api_server gateway
# (on this host that is the DEFAULT profile: /root/.hermes/config.yaml)
gateway:
  multiplex_profiles: true
```

### Gotcha — make sure you edit the *right* config

`hermes config set gateway.multiplex_profiles true` writes to the **active**
profile (e.g. `developer`), which is usually **not** the profile running the
gateway. The gateway reads the default/owning profile's config. To target it
explicitly:

```bash
hermes -p default config set gateway.multiplex_profiles true
```

Confirm the right file changed:

```bash
grep -n 'multiplex_profiles' ~/.hermes/config.yaml
# →  2:  multiplex_profiles: true      ✓ (this is the DEFAULT profile file)
```

> You may see `⚠ 'gateway.multiplex_profiles' is not a recognized config key`.
> That warning is from CLI schema validation only — the gateway loader
> explicitly honors the key. Ignore it.

Then restart the gateway:

```bash
# systemd (this host)
systemctl restart hermes-gateway
# or, if running as a managed service:
hermes gateway restart
```

### Verify

```bash
KEY=$(grep -m1 '^API_SERVER_KEY=' ~/.hermes/.env | cut -d= -f2- | tr -d '"')

# default profile route
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8642/v1/models -H "Authorization: Bearer $KEY"          # → 200

# a specific profile's route (use THAT profile's key)
PKEY=$(grep -m1 '^API_SERVER_KEY=' ~/.hermes/profiles/researcher/.env | cut -d= -f2- | tr -d '"')
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8642/p/researcher/v1/models -H "Authorization: Bearer $PKEY"  # → 200
```

- `404` on `/p/<profile>/…` → multiplexing is still off (or the profile name is
  misspelled / not under `profiles/`).
- `401` on `/p/<profile>/…` → you're using the wrong key for that profile (see B).

---

## B. Per-profile API keys

Multiplexing **scopes the API key per profile**: each profile authenticates
with *its own* `API_SERVER_KEY` (from that profile's `.env`). The default
profile's key does **not** work for other profiles.

1. **Default / legacy chat** → uses the default profile's key (the global key
   you put in Talaria **Settings → API Key**).
2. **Each additional profile** needs its key stored on that agent. In Talaria
   **Settings → Agents → Edit** an agent → paste that profile's
   `API_SERVER_KEY` (e.g. from `~/.hermes/profiles/researcher/.env`).
   An agent with a blank key falls back to the global/default key.

   - `comedian` currently shares the default key, so it works with no extra
     setup; the others each have a unique key.

3. **Model provider credentials** are also scoped per profile. A profile with
   no working model key in its own `.env` will route fine but its reply will
   fail with `Provider authentication failed: No usable credentials found for
   provider '<name>'`. Give each profile the model/API keys it needs in its own
   `.env`, then `hermes gateway restart`.

---

## C. Using the app

- **Direct message an agent** — open the sidebar, tap an agent chip (or
  **New DM**).
- **Group chat** — sidebar → **New group chat** → select 2+ agents.
- **@-mentions** in a group:
  - `@researcher` → routed **only to that agent**.
  - `@all` → fanned out to **every member** (N profiles = N replies, N ×
    tokens — use deliberately).
  - no mention → routed to the group's **primary (first) member**.

Replies are labeled with the author agent; user messages show the `@`-targets.

---

## D. How routing maps to HTTP

| Chat | Request |
|---|---|
| Default / legacy conversation | `POST /api/v1/chat/completions` → gateway default profile |
| DM to `researcher` | `POST /api/v1/p/researcher/v1/chat/completions` |
| Group member | interpolated `/p/<member>/…` per target |

The app inserts `/p/<profile>/` between the base URL and `/chat/completions`;
the dev proxy strips `/api`, leaving `/p/<profile>/v1/chat/completions`.

---

## E. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| DM/group to a profile → no reply, `404 unknown profile` from gateway | Multiplexing off → recheck section A (right config file + restart) |
| `401` from a profile's route | Wrong key → set that agent's own `API_SERVER_KEY` in Settings (section B) |
| Reply is `Provider authentication failed` | That profile has no model credential in its own `.env` |
| Everything works yesterday, broken today | Another agent/tool may have reset `config.yaml` — re-verify `grep multiplex_profiles ~/.hermes/config.yaml` |