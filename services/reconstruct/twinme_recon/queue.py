"""Postgres job queue (FOR UPDATE SKIP LOCKED via claim_reconstruction_job)."""

from __future__ import annotations

import json
import threading
from contextlib import contextmanager
from dataclasses import dataclass
from typing import Any, Iterator

import psycopg
from psycopg.rows import dict_row

from twinme_recon.config import settings


@dataclass
class Job:
    id: str
    avatar_id: str
    attempts: int
    max_attempts: int
    user_id: str


@contextmanager
def connect() -> Iterator[psycopg.Connection]:
    with psycopg.connect(settings().database_url.get_secret_value(), row_factory=dict_row, autocommit=True) as conn:
        yield conn


def claim() -> Job | None:
    with connect() as c:
        row = c.execute("select * from claim_reconstruction_job(%s)", (settings().worker_id,)).fetchone()
        if not row:
            return None
        avatar = c.execute("select user_id from avatars where id = %s", (row["avatar_id"],)).fetchone()
        c.execute("update avatars set status = 'processing' where id = %s", (row["avatar_id"],))
        return Job(id=str(row["id"]), avatar_id=str(row["avatar_id"]), attempts=row["attempts"], max_attempts=row["max_attempts"], user_id=str(avatar["user_id"]))


def queued_count() -> int:
    with connect() as c:
        return int(c.execute("select count(*) as n from reconstruction_jobs where status = 'queued'").fetchone()["n"])


def captures(avatar_id: str) -> list[dict[str, Any]]:
    with connect() as c:
        return list(c.execute("select storage_path, kind, pose from captures where avatar_id = %s and purged_at is null order by storage_path", (avatar_id,)).fetchall())


def complete(job: Job, *, model_path: str, thumb_path: str, rig: dict, analysis: dict, natural_hair: dict, metrics: dict) -> None:
    with connect() as c, c.transaction():
        c.execute(
            """update avatars set status = 'ready', model_url = %s, thumbnail = %s, rig = %s, analysis = %s, natural_hair = %s, error = null
               where id = %s""",
            (model_path, thumb_path, json.dumps(rig), json.dumps(analysis), json.dumps(natural_hair), job.avatar_id),
        )
        c.execute(
            "update reconstruction_jobs set status = 'succeeded', finished_at = now(), metrics = %s, error = null where id = %s",
            (json.dumps(metrics), job.id),
        )


def fail(job: Job, user_message: str, detail: str) -> bool:
    """Marks the attempt failed. Returns True when the job will be retried."""
    retry = job.attempts < job.max_attempts
    with connect() as c, c.transaction():
        c.execute(
            "update reconstruction_jobs set status = %s, error = %s, locked_at = null, worker_id = null, finished_at = case when %s then null else now() end where id = %s",
            ("queued" if retry else "failed", detail[:2000], retry, job.id),
        )
        if not retry:
            c.execute("update avatars set status = 'failed', error = %s where id = %s", (user_message[:500], job.avatar_id))
    return retry


class Heartbeat:
    """Keeps the job lease alive while a long GPU stage runs."""

    def __init__(self, job: Job):
        self.job = job
        self._stop = threading.Event()
        self._t = threading.Thread(target=self._run, daemon=True)

    def _run(self) -> None:
        while not self._stop.wait(settings().heartbeat_seconds):
            try:
                with connect() as c:
                    c.execute("select heartbeat_reconstruction_job(%s, %s)", (self.job.id, settings().worker_id))
            except Exception:  # noqa: BLE001 — a missed beat is retried next tick
                pass

    def __enter__(self) -> "Heartbeat":
        self._t.start()
        return self

    def __exit__(self, *exc: object) -> None:
        self._stop.set()
