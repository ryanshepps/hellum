"""Read Hermes' model providers and manage their API keys.

Run with the Hermes virtualenv and the hermes-agent checkout on sys.path.
Reads one JSON request from stdin and writes one JSON response to stdout.
API keys are written to Hermes' .env and never echoed back.
"""

import json
import os
import sys

sys.path.insert(0, os.getcwd())

from hermes_cli.auth import PROVIDER_REGISTRY, clear_provider_auth  # noqa: E402
from hermes_cli.config import get_compatible_custom_providers, load_config, remove_env_value, save_env_value  # noqa: E402
from hermes_cli.model_switch import persist_model_selection, switch_model  # noqa: E402
from hermes_cli.inventory import build_models_payload, load_picker_context  # noqa: E402

BUILT_IN_KEY_ENV = {"openrouter": ["OPENROUTER_API_KEY"]}


def key_env_vars(slug):
    if slug in BUILT_IN_KEY_ENV:
        return BUILT_IN_KEY_ENV[slug]
    provider = PROVIDER_REGISTRY.get(slug)
    if provider is None or provider.auth_type != "api_key":
        return []
    return list(provider.api_key_env_vars or [])


def provider_view(row):
    return {
        "slug": row["slug"],
        "name": row.get("name") or row["slug"],
        "authenticated": bool(row.get("authenticated")),
        "key_managed": bool(key_env_vars(row["slug"])),
        "virtual": row.get("source") == "virtual",
        "models": [str(model) for model in row.get("models") or []],
    }


def status():
    payload = build_models_payload(load_picker_context(), picker_hints=True, canonical_order=True, include_unconfigured=True)
    return {
        "success": True,
        "model": payload.get("model") or "",
        "provider": payload.get("provider") or "",
        "providers": [provider_view(row) for row in payload.get("providers", [])],
    }


def save_key(slug, api_key):
    env_vars = key_env_vars(slug)
    if not env_vars:
        return {"success": False, "error": f"Hermes does not take an API key for {slug}"}
    if not api_key.strip():
        return {"success": False, "error": "API key is empty"}
    save_env_value(env_vars[0], api_key.strip())
    return {"success": True, "error": None}


def disconnect(slug):
    removed = any([remove_env_value(env_var) for env_var in key_env_vars(slug)])
    cleared = bool(clear_provider_auth(slug))
    if not removed and not cleared:
        return {"success": False, "error": f"No credentials found for {slug}"}
    return {"success": True, "error": None}


def set_default(slug, model):
    from tui_gateway.model_switch import _current_model_runtime

    current_provider, current_model, current_base_url, current_api_key = _current_model_runtime(None, slug)
    config = load_config()
    result = switch_model(
        raw_input=model,
        current_provider=current_provider,
        current_model=current_model,
        current_base_url=current_base_url,
        current_api_key=current_api_key,
        is_global=True,
        explicit_provider=slug,
        user_providers=config.get("providers"),
        custom_providers=get_compatible_custom_providers(config),
    )
    if not result.success:
        return {"success": False, "error": result.error_message or "Hermes rejected the model"}
    persist_model_selection(result)
    return {"success": True, "error": None}


def main():
    request = json.loads(sys.stdin.read() or "{}")
    action = request.get("action")
    slug = str(request.get("provider") or "")
    if action == "status":
        result = status()
    elif action == "save_key":
        result = save_key(slug, str(request.get("api_key") or ""))
    elif action == "disconnect":
        result = disconnect(slug)
    elif action == "set_default":
        result = set_default(slug, str(request.get("model") or ""))
    else:
        result = {"success": False, "error": f"unknown action {action!r}"}
    sys.stdout.write(json.dumps(result, default=str))


if __name__ == "__main__":
    main()
