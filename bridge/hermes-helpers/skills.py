"""Read and manage Hermes skills through Hermes' own skill tooling.

Run with the Hermes virtualenv and the hermes-agent checkout on sys.path.
Reads one JSON request from stdin and writes one JSON response to stdout.
"""

import json
import mimetypes
import os
import sys

sys.path.insert(0, os.getcwd())

from agent.skill_utils import extract_skill_description, is_excluded_skill_path, parse_frontmatter  # noqa: E402
from hermes_cli.config import load_config  # noqa: E402
from hermes_cli.skills_config import get_disabled_skills, save_disabled_skills  # noqa: E402
from tools.skill_usage import (  # noqa: E402
    _archive_dir,
    _find_skill_dir,
    is_bundled,
    is_hub_installed,
    restore_skill,
)
from tools.skills_tool import _find_all_skills  # noqa: E402

FILE_LIMIT = 200
CONTENT_LIMIT = 512 * 1024


def archived_skill_dirs():
    root = _archive_dir()
    if not root.is_dir():
        return {}
    found = {}
    for skill_md in root.rglob("SKILL.md"):
        frontmatter, _ = parse_frontmatter(skill_md.read_text(encoding="utf-8", errors="replace"))
        name = str(frontmatter.get("name") or skill_md.parent.name)
        found.setdefault(name, (skill_md.parent, frontmatter))
    return found


def bundled_categories():
    root = os.path.join(os.getcwd(), "skills")
    categories = {}
    for current, _dirs, files in os.walk(root):
        if "SKILL.md" in files:
            relative = os.path.relpath(current, root).split(os.sep)
            if len(relative) >= 2:
                categories[relative[-1]] = relative[0]
    return categories


def provenance(name):
    if is_hub_installed(name):
        return "hub"
    if is_bundled(name):
        return "bundled"
    return "local"


def list_skills():
    disabled = get_disabled_skills(load_config())
    active = [
        {
            "name": skill["name"],
            "description": skill.get("description") or "",
            "category": skill.get("category") or "uncategorized",
            "provenance": provenance(skill["name"]),
            "state": "disabled" if skill["name"] in disabled else "enabled",
        }
        for skill in _find_all_skills(skip_disabled=True)
    ]
    active_names = {skill["name"] for skill in active}
    categories = bundled_categories()
    archived = [
        {
            "name": name,
            "description": extract_skill_description(frontmatter),
            "category": categories.get(directory.name, "uncategorized"),
            "provenance": provenance(name),
            "state": "archived",
        }
        for name, (directory, frontmatter) in archived_skill_dirs().items()
        if name not in active_names
    ]
    return {"success": True, "skills": active + archived}


def skill_dir(name):
    found = _find_skill_dir(name)
    if found is not None:
        return found
    archived = archived_skill_dirs().get(name)
    return archived[0] if archived else None


def list_files(name):
    root = skill_dir(name)
    if root is None:
        return {"success": False, "error": "not_found"}
    files = []
    for path in sorted(root.rglob("*")):
        if not path.is_file() or is_excluded_skill_path(path) or any(part.startswith(".") for part in path.relative_to(root).parts):
            continue
        files.append(read_file(name, path.relative_to(root).as_posix(), root))
        if len(files) >= FILE_LIMIT:
            break
    return {"success": True, "files": files}


def read_file(name, relative, root=None):
    root = root or skill_dir(name)
    if root is None:
        return {"success": False, "error": "not_found"}
    target = (root / relative).resolve()
    if root.resolve() not in target.parents or not target.is_file():
        return {"success": False, "error": "not_found"}
    raw = target.read_bytes()
    mime = mimetypes.guess_type(target.name)[0] or "text/plain"
    try:
        content = raw[:CONTENT_LIMIT].decode("utf-8")
        binary = False
    except UnicodeDecodeError:
        content = None
        binary = True
    return {
        "path": relative,
        "name": target.name,
        "size": len(raw),
        "mime_type": mime,
        "is_binary": binary,
        "content": content,
    }


def set_disabled(name, disabled):
    config = load_config()
    names = get_disabled_skills(config)
    if disabled:
        names.add(name)
    else:
        names.discard(name)
    save_disabled_skills(config, names)


def install(name):
    if name in get_disabled_skills(load_config()):
        set_disabled(name, False)
        return {"success": True, "error": None}
    ok, message = restore_skill(name)
    return {"success": ok, "error": None if ok else message}


def remove(name):
    set_disabled(name, True)
    return {"success": True, "error": None}


def main():
    request = json.loads(sys.stdin.read() or "{}")
    action = request.get("action")
    name = str(request.get("name") or "")
    if action == "list":
        result = list_skills()
    elif action == "files":
        result = list_files(name)
    elif action == "file":
        file = read_file(name, str(request.get("path") or "SKILL.md"))
        result = file if "error" in file else {"success": True, **file}
    elif action == "install":
        result = install(name)
    elif action == "remove":
        result = remove(name)
    else:
        result = {"success": False, "error": f"unknown action {action!r}"}
    sys.stdout.write(json.dumps(result, default=str))


if __name__ == "__main__":
    main()
