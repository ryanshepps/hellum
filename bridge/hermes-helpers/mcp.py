"""List and change the MCP servers in Hermes' config.

Run with the Hermes virtualenv and the hermes-agent checkout on sys.path.
Reads one JSON request from stdin and writes one JSON response to stdout.
Header values can hold credentials, so only their names are ever reported.
"""

import contextlib
import io
import json
import os
import sys

sys.path.insert(0, os.getcwd())

from hermes_cli.mcp_config import _get_mcp_servers, _remove_mcp_server, _save_mcp_server  # noqa: E402


def server_view(name, config):
    headers = config.get("headers") or {}
    return {
        "name": name,
        "enabled": config.get("enabled", True) is not False,
        "url": config.get("url"),
        "command": config.get("command"),
        "args": [str(arg) for arg in config.get("args") or []],
        "transport": config.get("transport"),
        "oauth": config.get("auth") == "oauth",
        "header_names": [str(header) for header in headers],
    }


def list_servers():
    return {"success": True, "servers": [server_view(name, config) for name, config in _get_mcp_servers().items()]}


def tools():
    from tools.mcp_tool_discovery import probe_mcp_server_tools

    with contextlib.redirect_stdout(io.StringIO()):
        probed = probe_mcp_server_tools()
    return {
        "success": True,
        "servers": {name: [{"name": tool, "description": description} for tool, description in listed] for name, listed in probed.items()},
    }


def saved(name, config):
    with contextlib.redirect_stdout(io.StringIO()):
        accepted = _save_mcp_server(name, config)
    return {"success": True, "error": None} if accepted else {"success": False, "error": f"Hermes refused to run {name}"}


def add(request):
    name = str(request.get("name") or "")
    if name in _get_mcp_servers():
        return {"success": False, "error": f"{name} already exists"}
    config = {"enabled": True}
    for field in ("url", "command", "args", "headers"):
        if request.get(field):
            config[field] = request[field]
    return saved(name, config)


def update(request):
    name = str(request.get("name") or "")
    config = dict(_get_mcp_servers().get(name) or {})
    if not config:
        return {"success": False, "error": f"No server {name}"}
    if request.get("headers"):
        config["headers"] = request["headers"]
    elif "headers" in request:
        config.pop("headers", None)
    return saved(name, config)


def remove(request):
    name = str(request.get("name") or "")
    with contextlib.redirect_stdout(io.StringIO()):
        removed = _remove_mcp_server(name)
    return {"success": True, "error": None} if removed else {"success": False, "error": f"No server {name}"}


def main():
    request = json.loads(sys.stdin.read() or "{}")
    action = request.get("action")
    if action == "list":
        result = list_servers()
    elif action == "tools":
        result = tools()
    elif action == "add":
        result = add(request)
    elif action == "update":
        result = update(request)
    elif action == "remove":
        result = remove(request)
    else:
        result = {"success": False, "error": f"unknown action {action!r}"}
    sys.stdout.write(json.dumps(result, default=str))


if __name__ == "__main__":
    main()
