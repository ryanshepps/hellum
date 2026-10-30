"""Read token use and estimated cost per Hermes session.

Run with the Hermes virtualenv and the hermes-agent checkout on sys.path.
Reads one JSON request from stdin and writes one JSON response to stdout.
Uses Hermes' SessionDB read-only and its own pricing for sessions that have
no recorded cost.
"""

import json
import os
import sys

sys.path.insert(0, os.getcwd())

from agent.insights import _estimate_cost  # noqa: E402
from hermes_state import SessionDB  # noqa: E402

FIELDS = (
    "id", "source", "model", "started_at", "input_tokens", "output_tokens", "cache_read_tokens", "cache_write_tokens",
    "billing_provider", "billing_base_url", "estimated_cost_usd", "actual_cost_usd",
)


def session_view(row):
    session = dict(zip(FIELDS, row))
    recorded = session["actual_cost_usd"] if session["actual_cost_usd"] is not None else session["estimated_cost_usd"]
    cost, status = (recorded, "recorded") if recorded else _estimate_cost(session)
    return {
        "id": session["id"],
        "source": session["source"] or "",
        "model": session["model"] or "",
        "provider": session["billing_provider"] or "",
        "started_at": session["started_at"],
        "input_tokens": session["input_tokens"] or 0,
        "output_tokens": session["output_tokens"] or 0,
        "cache_read_tokens": session["cache_read_tokens"] or 0,
        "cache_write_tokens": session["cache_write_tokens"] or 0,
        "cost_usd": cost,
        "priced": status != "unknown",
    }


def sessions(start, end):
    db = SessionDB(read_only=True)
    rows = db._conn.execute(
        f"SELECT {', '.join(FIELDS)} FROM sessions WHERE started_at >= ? AND started_at < ? ORDER BY started_at",
        (start, end),
    ).fetchall()
    return {"success": True, "sessions": [session_view(tuple(row)) for row in rows]}


def main():
    request = json.loads(sys.stdin.read() or "{}")
    if request.get("action") == "sessions":
        result = sessions(float(request.get("from") or 0), float(request.get("to") or 0))
    else:
        result = {"success": False, "error": f"unknown action {request.get('action')!r}"}
    sys.stdout.write(json.dumps(result, default=str))


if __name__ == "__main__":
    main()
