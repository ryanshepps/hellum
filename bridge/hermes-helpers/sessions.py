"""Read Hermes sessions for Hellum: the conversation list, finished replies in
sessions Hellum did not start, and when each message of a session was first written.

Run with the Hermes virtualenv and the hermes-agent checkout on sys.path.
Reads one JSON request from stdin and writes one JSON response to stdout.
Reads Hermes' session store through its read-only storage interface, and Hermes' cron silence rule so a
run that answered [SILENT] stays quiet here too.
"""

import json
import os
import sys

sys.path.insert(0, os.getcwd())

from cron.scheduler import _is_cron_silence_response  # noqa: E402
from persistence.conversation.messages import TranscriptRead, TranscriptView  # noqa: E402
from persistence.conversation.sessions import (  # noqa: E402
    INTERNAL_LISTING_SOURCES,
    SessionOrder,
    SessionQuery,
    SessionWindow,
)
from persistence_assembly import open_persistence_reader, profile_scope  # noqa: E402

SCAN_LIMIT = 100
LISTED_FIELDS = ("id", "title", "preview", "started_at", "message_count", "source", "runtime_revision", "runtime_generation")
CONVERSATION_ROLES = {"user", "assistant"}


def text_of(content):
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "\n".join(part.get("text", "") for part in content if isinstance(part, dict) and part.get("type") == "text")
    return ""


def open_store():
    return open_persistence_reader(profile_scope().profile_dir)


def recent_sessions(store, limit, exclude_sources=()):
    query = SessionQuery(exclude_sources=tuple(exclude_sources), order=SessionOrder.LAST_ACTIVE)
    return [entry.as_list_row() for entry in store.sessions.list_sessions(query, SessionWindow(limit=limit))]


def transcript(store, session_id, view=TranscriptView.ACTIVE):
    return [row.as_wire_row() for row in store.messages.read_transcript(session_id, TranscriptRead(view=view))]


def list_sessions(limit):
    with open_store() as store:
        rows = recent_sessions(store, limit, INTERNAL_LISTING_SOURCES)
    return [{field: row.get(field) for field in LISTED_FIELDS} for row in rows]


def finished_reply(store, session):
    messages = [message for message in transcript(store, session["id"]) if message.get("role") in CONVERSATION_ROLES]
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
    replies = []
    with open_store() as store:
        for session in recent_sessions(store, SCAN_LIMIT):
            if session.get("source") not in sources or (session.get("last_active") or 0) <= since:
                continue
            reply = finished_reply(store, session)
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
    with open_store() as store:
        rows = transcript(store, session_id, TranscriptView.ALL)
    return {str(row["id"]): at for row, at in active_row_times(rows)}


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
        result = {"success": True, "times": message_times(str(request.get("session_id") or ""))}
    else:
        result = {"success": False, "error": f"unknown action {action!r}"}
    sys.stdout.write(json.dumps(result, default=str))


if __name__ == "__main__":
    main()
