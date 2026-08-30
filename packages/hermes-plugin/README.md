# hermes-plugin — talaria-transfer

Source of truth for the **talaria-transfer** Hermes agent plugin: share a
desktop Hermes session to the Talaria PWA by pinning it, so Talaria adopts it
and continues the **same** session in place (no copy).

Adds these slash commands to the Hermes profile it's installed on:

| Command | What it does |
|---|---|
| `/talaria` | Share the current session so it appears in Talaria |
| `/talaria unpin [id]` | Stop sharing (default: current session) |
| `/talaria list` | List sessions currently shared to Talaria |
| `/talaria help` | This help |

## Install

This plugin lives in the Talaria monorepo and installs from this subdirectory:

```bash
hermes plugins install TillmanBuildsTech/talaria/packages/hermes-plugin
```

That resolves the repo, clones it, and installs the plugin found at the
`packages/hermes-plugin` subdirectory (the CLI's subdir support — see
`hermes plugins install --help`).

## Files

- `plugin.yaml` — manifest (`name`, `version`, `description`, `author`).
- `__init__.py` — plugin entrypoint; `register(ctx)` wires the `/talaria`
  command.
- `talaria_transfer.py` — implementation: pins/unpins the active session via
  `SessionDB.set_session_pinned` so the gateway's `GET /api/sessions`
  (`include_pinned=True`) and Talaria's discovery adopt it in place.

## Versioning

`version` in `plugin.yaml` and `__version__` in `__init__.py` are kept in sync;
both are currently `0.1.0`, aligned with the monorepo's package versioning.
