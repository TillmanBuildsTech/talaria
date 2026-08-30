"""Implementation of the /talaria command.

Pins (or unpins) a Hermes session so the Talaria PWA's discovery adopts it
and continues it in place. Runs inside the profile's own process, so
``get_hermes_home()`` resolves to the active profile — the same store the
gateway's ``/p/<profile>/api/sessions`` reads.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any, Dict, List, Optional

# Path to the active profile's session store, resolved lazily so the plugin
# never hardcodes a home or profile.
def _home() -> Path:
    try:
        from hermes_constants import get_hermes_home
        return Path(get_hermes_home())
    except Exception:
        val = (os.environ.get("HERMES_HOME") or "").strip()
        return Path(val).resolve() if val else (Path.home() / ".hermes").resolve()


_HELP = """\
/talaria — share the current Hermes session so it appears in the Talaria PWA

The session is pinned server-side; Talaria's discovery adopts pinned sessions
and continues them IN PLACE on the same session id (no copy, so the desktop
and Talaria surfaces stay in sync). Only sessions you explicitly share here
ever appear in Talaria.

  /talaria             share the current session
  /talaria unpin [id]  stop sharing (default: current session)
  /talaria list        list sessions currently shared to Talaria
  /talaria help        this help
"""


# ---------------------------------------------------------------------------
# Session store access
# ---------------------------------------------------------------------------

def _db():
    from hermes_state import SessionDB
    return SessionDB(db_path=_home() / "state.db")


def _current_session_id() -> Optional[str]:
    """Resolve the active session id (the desktop CLI exports HERMES_SESSION_ID)."""
    try:
        from gateway.session_context import get_session_env
        sid = (get_session_env("HERMES_SESSION_ID") or "").strip()
        if sid:
            return sid
    except Exception:
        pass
    sid = (os.environ.get("HERMES_SESSION_ID") or "").strip()
    if sid:
        return sid
    return None


def _most_recent_session_id() -> Optional[str]:
    """Last-resort fallback: the most recently active session in this profile."""
    try:
        import sqlite3
        con = sqlite3.connect(f"file:{_home() / 'state.db'}?mode=ro", uri=True)
        row = con.execute(
            "SELECT id FROM sessions ORDER BY COALESCE(last_active, 0) DESC, rowid DESC LIMIT 1"
        ).fetchone()
        con.close()
        return row[0] if row else None
    except Exception:
        return None


def _set_pinned(sid: str, value: bool) -> None:
    db = _db()
    try:
        db.set_session_pinned(sid, value)
    except Exception:
        _direct_set_pinned(sid, value)
    finally:
        db.close()


def _direct_set_pinned(sid: str, value: bool) -> None:
    import sqlite3
    con = sqlite3.connect(str(_home() / "state.db"))
    con.execute("PRAGMA busy_timeout=8000")
    con.execute("UPDATE sessions SET pinned=? WHERE id=?", (1 if value else 0, sid))
    con.commit()
    con.close()


def _profile_name() -> Optional[str]:
    """Current profile id (agent name used by Talaria), or None for the default profile."""
    p = _home()
    if p.parent.name == "profiles":
        return p.name
    return None


def _describe(db, sid: str, verb: str) -> str:
    info = db.get_session(sid) or {}
    title = info.get("title") or _title_from_sql(sid) or "(untitled)"
    agent = _profile_name()  # or 'default'
    location = f"the {agent} agent" if agent else "the default chat"
    return (
        f"/talaria {verb}: session `{sid}` — {title}\n"
        f"Open Talaria → {location}; it will appear there (refresh if the app "
        f"is already open). Continuing there stays on the SAME session."
    )


def _title_from_sql(sid: str) -> Optional[str]:
    try:
        import sqlite3
        con = sqlite3.connect(f"file:{_home() / 'state.db'}?mode=ro", uri=True)
        row = con.execute("SELECT title FROM sessions WHERE id=?", (sid,)).fetchone()
        con.close()
        return row[0] if row and row[0] else None
    except Exception:
        return None


def _pinned_rows(db) -> List[Dict[str, Any]]:
    try:
        rows = db.list_sessions_rich(
            limit=500, order_by_last_active=True, include_pinned=True
        )
        return [x for x in rows if x.get("pinned")]
    except Exception:
        pass
    try:
        import sqlite3
        con = sqlite3.connect(f"file:{_home() / 'state.db'}?mode=ro", uri=True)
        rows = con.execute(
            "SELECT id, title FROM sessions WHERE pinned=1 "
            "ORDER BY COALESCE(last_active, 0) DESC"
        ).fetchall()
        con.close()
        return [{"id": r[0], "title": r[1] or ""} for r in rows]
    except Exception:
        return []


def _format_list(db) -> str:
    rows = _pinned_rows(db)
    if not rows:
        return "No sessions are currently shared to Talaria (nothing pinned)."
    lines = ["Sessions shared to Talaria (pinned):"]
    for x in rows:
        lines.append(f"  {x.get('id')}  {x.get('title') or '(untitled)'}")
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Command handler
# ---------------------------------------------------------------------------

def handle(raw_args: str) -> Optional[str]:
    argv = (raw_args or "").strip().split()
    sub = argv[0] if argv else ""
    if sub in ("help", "-h", "--help"):
        return _HELP

    db = _db()
    try:
        if sub == "list":
            return _format_list(db)

        if sub == "unpin":
            sid = argv[1] if len(argv) > 1 else _current_session_id()
            if not sid:
                return "/talaria: couldn't determine the current session id."
            _set_pinned(sid, False)
            return _describe(db, sid, "unpinned")

        if sub:
            return f"Unknown subcommand: {sub}\n\n{_HELP}"

        # default: share the current session
        sid = _current_session_id() or _most_recent_session_id()
        if not sid:
            return "/talaria: couldn't determine the current session id."
        _set_pinned(sid, True)
        return _describe(db, sid, "shared")
    finally:
        db.close()