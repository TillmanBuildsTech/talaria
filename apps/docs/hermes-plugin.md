# Hermes Plugin — talaria-transfer

The **talaria-transfer** Hermes agent plugin lets you share a desktop Hermes
session to the Talaria PWA in place: pin the session so Talaria's discovery
adopts it and continues on the **same** session id (no copy — the desktop and
Talaria surfaces stay in sync). Only sessions you explicitly share ever appear
in Talaria.

This plugin's source of truth lives in this monorepo at
[`packages/hermes-plugin/`](../../packages/hermes-plugin/) and installs from
that subdirectory.

## Install

From any Hermes profile (the plugin registers on the profile it's installed
on):

```bash
hermes plugins install TillmanBuildsTech/talaria/packages/hermes-plugin
```

The installer resolves the monorepo, clones it, and installs the plugin found
at the `packages/hermes-plugin` subdirectory. Install a specific pinned commit
with `--ref <sha>`:

```bash
hermes plugins install --ref <40-char-commit-sha> \
  TillmanBuildsTech/talaria/packages/hermes-plugin
```

After install, restart the gateway for the slash command to take effect:

```bash
hermes gateway restart
```

## Usage

| Command | What it does |
|---|---|
| `/talaria` | Share the **current** session so it appears in Talaria |
| `/talaria unpin [id]` | Stop sharing (default: current session) |
| `/talaria list` | List sessions currently shared to Talaria |
| `/talaria help` | This help |

## How it works

`/talaria` pins the target session via `SessionDB.set_session_pinned`. The
gateway surfaces pinned sessions in `GET /api/sessions` (`include_pinned=True`),
and the Talaria PWA's discovery adopts them and continues the SAME session in
place. See the plugin [`README`](../../packages/hermes-plugin/README.md) for
implementation details.
