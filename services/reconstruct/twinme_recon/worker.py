"""Job runner: claim → download captures → reconstruct → upload → complete."""

from __future__ import annotations

import time
import traceback

import structlog

from twinme_recon import queue, storage
from twinme_recon.notify import notify
from twinme_recon.pipeline.run import ReconError, reconstruct

log = structlog.get_logger()


def process_one() -> bool:
    """Processes at most one job. Returns False when the queue is empty."""
    job = queue.claim()
    if not job:
        return False
    log.info("job.claimed", job=job.id, avatar=job.avatar_id, attempt=job.attempts)
    try:
        with queue.Heartbeat(job):
            caps = queue.captures(job.avatar_id)
            if not caps:
                raise ReconError("Your photos expired before processing. Please scan again.", "no captures")
            blobs = [(c["storage_path"], storage.download("captures", c["storage_path"]), c["kind"]) for c in caps]
            out = reconstruct(blobs)
            prefix = f"{job.user_id}/{job.avatar_id}"
            model_path = storage.upload("avatars", f"{prefix}/model.glb", out.glb, "model/gltf-binary")
            thumb_path = storage.upload("thumbnails", f"{prefix}/thumb.webp", out.thumbnail, "image/webp")
            queue.complete(job, model_path=model_path, thumb_path=thumb_path, rig=out.rig, analysis=out.analysis, natural_hair=out.natural_hair, metrics=out.metrics)
        log.info("job.succeeded", job=job.id, **out.metrics)
        notify(job.avatar_id, "ready")
    except ReconError as e:
        # User-actionable (bad input): no retry.
        job.attempts = job.max_attempts
        queue.fail(job, e.user_message, str(e))
        log.warning("job.rejected", job=job.id, reason=str(e))
        notify(job.avatar_id, "failed", e.user_message)
    except Exception as e:  # noqa: BLE001 — infrastructure failures are retried
        retry = queue.fail(job, "Something went wrong building your HD twin. We'll retry automatically.", traceback.format_exc())
        log.error("job.error", job=job.id, retry=retry, error=repr(e))
        if not retry:
            notify(job.avatar_id, "failed", "Processing failed")
    return True


def run_forever(idle_sleep: float = 5.0) -> None:
    """Long-running mode (self-hosted GPU box)."""
    while True:
        if not process_one():
            time.sleep(idle_sleep)


if __name__ == "__main__":
    run_forever()
