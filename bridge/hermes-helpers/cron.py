"""Read and manage Hermes cron jobs through Hermes' own cron tooling.

Run with the Hermes virtualenv and the hermes-agent checkout on sys.path.
Reads one JSON request from stdin and writes one JSON response to stdout.
"""

import json
import os
import sys
from datetime import datetime, timezone

sys.path.insert(0, os.getcwd())

from cron.jobs import _job_output_dir, load_jobs  # noqa: E402
from hermes_time import get_timezone  # noqa: E402
from tools.cronjob_tools import cronjob  # noqa: E402

JOB_FIELDS = (
    "id",
    "name",
    "prompt",
    "schedule",
    "schedule_display",
    "enabled",
    "state",
    "next_run_at",
    "last_run_at",
    "last_status",
    "last_error",
    "created_at",
    "script",
    "no_agent",
    "deliver",
)


def job_view(job):
    return {field: job.get(field) for field in JOB_FIELDS}


RUN_OUTPUT_LIMIT = 20_000


def configured_timezone():
    zone = get_timezone()
    return getattr(zone, "key", None)


def run_view(path):
    local = datetime.strptime(path.stem, "%Y-%m-%d_%H-%M-%S")
    zone = get_timezone()
    finished_at = (local.replace(tzinfo=zone) if zone else local.astimezone()).astimezone(timezone.utc)
    return {
        "id": path.stem,
        "finished_at": finished_at.isoformat(),
        "output": path.read_text(encoding="utf-8", errors="replace")[:RUN_OUTPUT_LIMIT],
    }


def job_runs(job_id, limit):
    directory = _job_output_dir(job_id)
    if not directory.is_dir():
        return []
    paths = sorted(directory.glob("*.md"), key=lambda path: path.stem, reverse=True)
    return [run_view(path) for path in paths[:limit]]


def main():
    request = json.loads(sys.stdin.read() or "{}")
    action = request.get("action")
    if action == "list":
        result = {
            "success": True,
            "timezone": configured_timezone(),
            "jobs": [job_view(job) for job in load_jobs()],
        }
    elif action == "runs":
        result = {"success": True, "runs": job_runs(request.get("job_id"), int(request.get("limit", 25)))}
    elif action == "create":
        result = json.loads(
            cronjob(
                action="create",
                name=request.get("name"),
                schedule=request.get("schedule"),
                prompt=request.get("prompt"),
                deliver="local",
            )
        )
    elif action == "update":
        result = json.loads(
            cronjob(
                action="update",
                job_id=request.get("job_id"),
                name=request.get("name"),
                schedule=request.get("schedule"),
                prompt=request.get("prompt"),
            )
        )
    elif action in {"pause", "resume", "remove", "run"}:
        result = json.loads(cronjob(action=action, job_id=request.get("job_id")))
    else:
        result = {"success": False, "error": f"unknown action {action!r}"}
    sys.stdout.write(json.dumps(result, default=str))


if __name__ == "__main__":
    main()
