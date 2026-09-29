"""HMAC-signed webhook to the web app (user notifications only)."""

from __future__ import annotations

import hashlib
import hmac
import json
import time

import httpx

from twinme_recon.config import settings


def sign(body: bytes, secret: str, ts: int | None = None) -> str:
    ts = ts or int(time.time())
    mac = hmac.new(secret.encode(), f"{ts}.".encode() + body, hashlib.sha256).hexdigest()
    return f"t={ts},v1={mac}"


def notify(avatar_id: str, status: str, error: str | None = None) -> None:
    body = json.dumps({"avatarId": avatar_id, "status": status, **({"error": error} if error else {})}).encode()
    try:
        httpx.post(
            f"{settings().web_url}/api/webhooks/reconstruct",
            content=body,
            headers={"content-type": "application/json", "x-twinme-signature": sign(body, settings().recon_webhook_secret.get_secret_value())},
            timeout=10,
        )
    except httpx.HTTPError:
        pass  # notifications are best-effort; the studio polls status too
