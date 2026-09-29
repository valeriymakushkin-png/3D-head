"""Modal deployment: scale-to-zero L4 GPUs fed by the Postgres queue.

  modal deploy modal_app.py

- `dispatch` runs every minute and spawns one GPU container per queued job
  (capped), so cost is strictly per reconstruction (~40–90 GPU-seconds).
- `trigger` is an HTTPS endpoint the web app calls right after enqueueing for
  sub-second pickup; the cron is the safety net.
"""

from __future__ import annotations

import hmac
import os

import modal
from fastapi import Header

image = (
    modal.Image.from_registry("nvidia/cuda:12.4.1-cudnn-devel-ubuntu22.04", add_python="3.11")
    .apt_install("git", "ffmpeg", "libgl1", "libglib2.0-0")
    .pip_install("torch==2.4.1", "torchvision==0.19.1", index_url="https://download.pytorch.org/whl/cu124")
    .pip_install("fvcore", "iopath")
    .run_commands("pip install --no-build-isolation 'git+https://github.com/facebookresearch/pytorch3d.git@v0.7.8'", gpu="L4")
    .pip_install_from_pyproject("pyproject.toml")
    .pip_install("fastapi[standard]")
    .add_local_dir("models", "/root/models")
    .add_local_python_source("twinme_recon")
)

app = modal.App("twinme-recon", image=image)
secrets = [modal.Secret.from_name("twinme-recon")]
flame_volume = modal.Volume.from_name("twinme-flame", create_if_missing=False)
MAX_PARALLEL = int(os.environ.get("MAX_PARALLEL", "20"))


@app.function(gpu="L4", secrets=secrets, volumes={"/models/flame": flame_volume}, timeout=900, max_containers=MAX_PARALLEL)
def process() -> bool:
    from twinme_recon.worker import process_one

    return process_one()


@app.function(secrets=secrets, schedule=modal.Period(minutes=1))
def dispatch() -> int:
    from twinme_recon.queue import queued_count

    n = min(queued_count(), MAX_PARALLEL)
    for _ in range(n):
        process.spawn()
    return n


@app.function(secrets=secrets)
@modal.fastapi_endpoint(method="POST")
def trigger(authorization: str | None = Header(default=None)) -> dict:
    expected = f"Bearer {os.environ['RECON_TRIGGER_TOKEN']}"
    if not authorization or not hmac.compare_digest(authorization, expected):
        return {"ok": False}
    process.spawn()
    return {"ok": True}
