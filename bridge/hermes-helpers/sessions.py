"""Read Hermes sessions for Hellum: the conversation list, finished replies in
sessions Hellum did not start, and when each turn of a session happened.

Run with the Hermes virtualenv and the hermes-agent checkout on sys.path.
Reads one JSON request from stdin and writes one JSON response to stdout.
Uses Hermes' own SessionDB read-only, and Hermes' cron silence rule so a
run that answered [SILENT] stays quiet here too.
"""

import json
import os
import sys

sys.path.insert(0, os.getcwd())

from cron.scheduler import _is_cron_silence_response  # noqa: E402
from hermes_state import SessionDB  # noqa: E402
from hermes_state_sessions import INTERNAL_LISTING_SOURCES  # noqa: E402

SCAN_LIMIT = 100
LISTED_FIELDS = ("id", "title", "preview", "started_at", "message_count", "source", "runtime_revision", "runtime_generation")
CONVERSATION_ROLES = {"user", "assistant"}


def text_of(content):
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "\n".join(part.get("text", "") for part in content if isinstance(part, dict) and part.get("type") == "text")
    return ""


def list_sessions(limit):
    db = SessionDB(read_only=True)
    rows = db.list_sessions_rich(limit=limit, exclude_sources=list(INTERNAL_LISTING_SOURCES), order_by_last_active=True)
    return [{field: row.get(field) for field in LISTED_FIELDS} for row in rows]


def finished_reply(db, session):
    messages = [message for message in db.get_messages(session["id"]) if message.get("role") in CONVERSATION_ROLES]
    if not messages:
        return None
    last = messages[-1]
    text = text_of(last.get("content")).strip()
    if last.get("role") != "assistant" or last.get("tool_calls") or not text:
        return None
    return {
        "id": session["id"],
        "source": session.get("source") or "",
        "title": session.get("title") or "",
        "started_at": session.get("started_at") or 0,
        "message_id": str(last.get("id")),
        "replied_at": last.get("timestamp") or 0,
        "text": text,
        "silent": session.get("source") == "cron" and _is_cron_silence_response(text),
    }


def finished_replies(sources, since):
    db = SessionDB(read_only=True)
    sessions = db.list_sessions_rich(limit=SCAN_LIMIT, order_by_last_active=True)
    replies = []
    for session in sessions:
        if session.get("source") not in sources or (session.get("last_active") or 0) <= since:
            continue
        reply = finished_reply(db, session)
        if reply and reply["replied_at"] > since:
            replies.append(reply)
    return replies


def row_key(message):
    return (
        message.get("role"),
        json.dumps(message.get("content"), default=str),
        json.dumps(message.get("tool_calls"), default=str),
        message.get("tool_call_id"),
    )


def active_row_times(rows):
    retired = {}
    times = []
    for row in rows:
        stamp = row.get("timestamp") or 0
        if not row.get("active"):
            retired.setdefault(row_key(row), []).append(stamp)
            continue
        earlier = retired.get(row_key(row))
        times.append((row, earlier.pop(0) if earlier else stamp))
    return times


def message_times(session_id):
    db = SessionDB(read_only=True)
    turns = []
    for row, at in active_row_times(db.get_messages(session_id, include_inactive=True)):
        if row.get("role") == "user":
            turns.append({"user_at": at, "last_at": at})
        elif row.get("role") == "assistant" and turns:
            turns[-1]["last_at"] = max(turns[-1]["last_at"], at)
    return turns


def main():
    request = json.loads(sys.stdin.read() or "{}")
    action = request.get("action")
    if action == "finished_replies":
        result = {
            "success": True,
            "replies": finished_replies(set(request.get("sources") or []), float(request.get("since") or 0)),
        }
    elif action == "list_sessions":
        result = {"success": True, "sessions": list_sessions(int(request.get("limit") or 500))}
    elif action == "message_times":
        result = {"success": True, "turns": message_times(str(request.get("session_id") or ""))}
    else:
        result = {"success": False, "error": f"unknown action {action!r}"}
    sys.stdout.write(json.dumps(result, default=str))


if __name__ == "__main__":
    main()
