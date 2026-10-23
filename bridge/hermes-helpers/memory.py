"""Read and edit Hermes' built-in memory through its own MemoryStore.

Run with the Hermes virtualenv and the hermes-agent checkout on sys.path.
Reads one JSON request from stdin and writes one JSON response to stdout.
Using MemoryStore keeps Hermes' file locking, size limits, and content
scanning in force for edits made from Hellum.
"""

import json
import os
import sys
from pathlib import Path

sys.path.insert(0, os.getcwd())

from tools.memory_tool import get_memory_dir, load_on_disk_store  # noqa: E402

TARGET_FILES = {"memory": "MEMORY.md", "user": "USER.md"}


def modified_at(target):
    path = Path(get_memory_dir()) / TARGET_FILES[target]
    return path.stat().st_mtime if path.exists() else None


def main():
    request = json.loads(sys.stdin.read() or "{}")
    store = load_on_disk_store()
    action = request.get("action")
    target = request.get("target")
    if action == "list":
        result = {
            "success": True,
            "memory": list(store.memory_entries),
            "user": list(store.user_entries),
            "limits": {"memory": store.memory_char_limit, "user": store.user_char_limit},
            "modified": {"memory": modified_at("memory"), "user": modified_at("user")},
        }
    elif target not in TARGET_FILES:
        result = {"success": False, "error": f"unknown target {target!r}"}
    elif action == "add":
        result = store.add(target, request.get("content", ""))
    elif action == "replace":
        result = store.replace(target, request.get("old_text", ""), request.get("content", ""))
    elif action == "remove":
        result = store.remove(target, request.get("old_text", ""))
    else:
        result = {"success": False, "error": f"unknown action {action!r}"}
    sys.stdout.write(json.dumps(result))


if __name__ == "__main__":
    main()
