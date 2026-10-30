"""Hellum platform for Hermes: send-only delivery to the user's Hellum devices.

Hermes hands a message to this platform (``deliver: hellum`` on a scheduled job,
or ``send_message`` to ``hellum``) and the plugin posts it to the Hellum bridge's
admin socket, which pushes it to the paired iPhone and open browser tabs.
Hellum chats themselves reach Hermes over the gateway WebSocket, not through here.
"""

import os
import re
from typing import Any, Optional

import httpx

from gateway.config import Platform, PlatformConfig
from gateway.platforms._shared import extra_or_secret, get_scoped_secret, seed_extra_from_env, send_error
from gateway.platforms.base import BasePlatformAdapter, SendResult

DEFAULT_ADMIN_SOCKET = os.path.expanduser("~/.hellum/admin.sock")
HOME_CHAT_ID = "devices"
SEND_TIMEOUT_SECONDS = 15.0
CRON_WRAPPED = re.compile(
    r"\ACronjob Response: (?P<name>.*)\n\(job_id: (?P<job_id>[^)]*)\)\n-+\n\n(?P<body>.*?)"
    r"(?:\n\nTo stop or manage this job, send me a new message \(e\.g\. \"stop reminder .*\"\)\.)?\Z",
    re.DOTALL,
)


def admin_socket(extra: Optional[dict]) -> str:
    return extra_or_secret(extra or {}, "admin_socket", "HELLUM_ADMIN_SOCKET") or DEFAULT_ADMIN_SOCKET


def bridge_running(config: Any = None) -> bool:
    return os.path.exists(admin_socket(getattr(config, "extra", None)))


def latest_job_session(job_id: str) -> Optional[str]:
    try:
        from hermes_state import SessionDB

        rows = SessionDB(read_only=True).list_sessions_rich(
            source="cron", id_query=f"cron_{job_id}_", limit=1, order_by_last_active=True
        )
    except Exception:
        return None
    return rows[0]["id"] if rows else None


def delivery_body(content: str) -> dict:
    wrapped = CRON_WRAPPED.match(content)
    if not wrapped:
        return {"message": content}
    job_id = wrapped["job_id"].strip()
    body = {"message": wrapped["body"], "jobId": job_id, "jobName": wrapped["name"].strip()}
    session_id = latest_job_session(job_id)
    return {**body, "sessionId": session_id} if session_id else body


async def deliver(socket_path: str, content: str) -> dict:
    transport = httpx.AsyncHTTPTransport(uds=socket_path)
    async with httpx.AsyncClient(transport=transport, timeout=SEND_TIMEOUT_SECONDS) as client:
        response = await client.post("http://hellum/deliveries", json=delivery_body(content))
    if response.status_code >= 300:
        raise RuntimeError(f"Hellum bridge HTTP {response.status_code}: {response.text[:200]}")
    return response.json()


class HellumAdapter(BasePlatformAdapter):
    def __init__(self, config: PlatformConfig):
        super().__init__(config=config, platform=Platform("hellum"))
        self._socket = admin_socket(config.extra)

    async def connect(self, *, is_reconnect: bool = False) -> bool:
        self._mark_connected()
        return True

    async def disconnect(self) -> None:
        self._mark_disconnected()

    async def send(self, chat_id: str, content: str, reply_to: Optional[str] = None, metadata: Optional[dict] = None) -> SendResult:
        try:
            result = await deliver(self._socket, content)
        except Exception as error:
            return SendResult(success=False, error=str(error))
        return SendResult(success=bool(result.get("ok")), message_id=chat_id)

    async def get_chat_info(self, chat_id: str) -> dict:
        return {"name": "Your Hellum devices", "type": "dm"}


async def standalone_send(pconfig, chat_id: str, message: str, *, thread_id=None, media_files=None, force_document=False) -> dict:
    try:
        result = await deliver(admin_socket(getattr(pconfig, "extra", None)), message)
    except Exception as error:
        return send_error(f"Hellum delivery failed: {error}")
    return {"success": bool(result.get("ok")), "platform": "hellum", "chat_id": chat_id, "message_id": chat_id}


def env_enablement() -> Optional[dict]:
    seed = seed_extra_from_env((("HELLUM_ADMIN_SOCKET", "admin_socket", None),), home_env="HELLUM_HOME_CHANNEL", home_default=HOME_CHAT_ID)
    return seed if os.path.exists(seed.get("admin_socket", DEFAULT_ADMIN_SOCKET)) else None


def register(ctx) -> None:
    ctx.register_platform(
        name="hellum",
        label="Hellum",
        adapter_factory=HellumAdapter,
        check_fn=lambda: bool(get_scoped_secret("HELLUM_ADMIN_SOCKET", "")) or os.path.exists(DEFAULT_ADMIN_SOCKET),
        validate_config=bridge_running,
        is_connected=bridge_running,
        config_connected_fn=bridge_running,
        env_enablement_fn=env_enablement,
        cron_deliver_env_var="HELLUM_HOME_CHANNEL",
        standalone_sender_fn=standalone_send,
        allow_update_command=False,
        emoji="📱",
        platform_hint=(
            "Messages on this platform are push notifications to the user's Hellum devices "
            "(their iPhone and open browser tabs). Keep them short; the user replies in a Hellum chat."
        ),
    )
