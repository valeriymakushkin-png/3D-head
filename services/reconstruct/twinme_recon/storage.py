"""Minimal Supabase Storage client (service role, server-side only)."""

from __future__ import annotations

import httpx

from twinme_recon.config import settings


def _client() -> httpx.Client:
    key = settings().supabase_service_role_key.get_secret_value()
    return httpx.Client(
        base_url=f"{settings().supabase_url}/storage/v1",
        headers={"authorization": f"Bearer {key}", "apikey": key},
        timeout=httpx.Timeout(60.0, connect=10.0),
    )


def download(bucket: str, path: str) -> bytes:
    with _client() as c:
        r = c.get(f"/object/{bucket}/{path}")
        r.raise_for_status()
        return r.content


def upload(bucket: str, path: str, data: bytes, content_type: str) -> str:
    with _client() as c:
        r = c.post(f"/object/{bucket}/{path}", content=data, headers={"content-type": content_type, "x-upsert": "true", "cache-control": "private, max-age=31536000"})
        r.raise_for_status()
    return path
