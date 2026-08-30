"""talaria-transfer — share a desktop Hermes session into the Talaria PWA.

Slash command:

  /talaria                  share the CURRENT session so it appears in Talaria
  /talaria unpin [id]       stop sharing (default: current session)
  /talaria list             list sessions currently shared to Talaria
  /talaria help             this help

How it works: the Talaria PWA only adopts sessions whose id is `talaria-*`
(parseTalariaSession) OR that are pinned. This command pins the target
session on the server via SessionDB.set_session_pinned; the gateway surfaces
pinned sessions in GET /api/sessions (include_pinned=True) and the Talaria
discovery change adopts them, continuing on the SAME session id in place
(no copy, so the desktop and Talaria surfaces stay in sync). Only sessions
explicitly shared here ever appear in Talaria.
"""

from __future__ import annotations

# Keep in sync with plugin.yaml `version`.
__version__ = "0.1.0"


def register(ctx) -> None:
    from . import talaria_transfer as tt

    ctx.register_command(
        "talaria",
        handler=tt.handle,
        description="Share the current session to Talaria (pin) so it appears there; unpin or list shared sessions.",
        args_hint="[unpin|list]",
    )
