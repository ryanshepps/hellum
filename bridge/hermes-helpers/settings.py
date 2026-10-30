"""Read and change the Hermes settings Hellum's Settings pages manage.

Run with the Hermes virtualenv and the hermes-agent checkout on sys.path.
Reads one JSON request from stdin and writes one JSON response to stdout.
Config keys come from config.yaml. Environment values are written to Hermes'
.env. Only whether each one is set is reported back, except for the
non-secret names a request lists under "reveal", such as a server URL.
"""

import contextlib
import io
import json
import os
import sys

sys.path.insert(0, os.getcwd())

from hermes_cli.config import get_env_value, load_config, remove_env_value, save_env_value, set_config_value, unset_config_value  # noqa: E402

MISSING = object()


def lookup(config, dotted_key):
    node = config
    for part in dotted_key.split("."):
        if not isinstance(node, dict) or part not in node:
            return MISSING
        node = node[part]
    return node


def read(keys, env_names, reveal):
    config = load_config()
    values = {}
    for key in keys:
        value = lookup(config, key)
        values[key] = None if value is MISSING else value
    return {
        "success": True,
        "values": values,
        "env": {name: bool(get_env_value(name)) for name in env_names},
        "revealed": {name: get_env_value(name) or "" for name in reveal},
    }


def quietly(change):
    printed = io.StringIO()
    with contextlib.redirect_stdout(printed), contextlib.redirect_stderr(printed):
        try:
            change()
        except SystemExit:
            return (printed.getvalue().strip().splitlines() or ["Hermes refused the change"])[-1]
    return None


def write(set_values, unset_keys, env_values, env_unset):
    for key, value in set_values.items():
        refused = quietly(lambda key=key, value=value: set_config_value(key, str(value)))
        if refused:
            return {"success": False, "error": f"{key}: {refused}"}
    for key in unset_keys:
        refused = quietly(lambda key=key: unset_config_value(key))
        if refused and not refused.startswith("Config key not set"):
            return {"success": False, "error": f"{key}: {refused}"}
    for name, value in env_values.items():
        if not value.strip():
            return {"success": False, "error": f"{name} is empty"}
        save_env_value(name, value.strip())
    for name in env_unset:
        remove_env_value(name)
    return {"success": True, "error": None}


def main():
    request = json.loads(sys.stdin.read() or "{}")
    action = request.get("action")
    if action == "read":
        result = read(list(request.get("keys") or []), list(request.get("env") or []), list(request.get("reveal") or []))
    elif action == "write":
        result = write(
            dict(request.get("set") or {}),
            list(request.get("unset") or []),
            dict(request.get("env") or {}),
            list(request.get("env_unset") or []),
        )
    else:
        result = {"success": False, "error": f"unknown action {action!r}"}
    sys.stdout.write(json.dumps(result, default=str))


if __name__ == "__main__":
    main()
