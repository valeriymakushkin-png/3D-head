# twinme-recon — HD Twin GPU worker

Consumes `reconstruction_jobs` from Postgres, reconstructs a FLAME head from
the user's captures, bakes a delit 2K texture, and writes a GLB + rig +
analysis the web studio loads exactly like an on-device Instant Twin.

```
claim (SKIP LOCKED) → download captures → frames (EXIF/HEIC/video) → MediaPipe
→ FLAME fit (landmarks → silhouette → photometric, PyTorch3D) → 478-landmark rig
→ texture (visibility · facing³ · skin · SH delight · multi-band) → GLB/thumbnail
→ upload → complete → HMAC notify web (Telegram message to the user)
```

| Module | Role |
|---|---|
| `queue.py` | claim / heartbeat / complete / fail (retry with backoff via re-queue) |
| `pipeline/frames.py` | decoding, sharpness |
| `pipeline/landmarks.py` | MediaPipe landmarks, pose, segmentation, view selection |
| `pipeline/flame.py` | differentiable FLAME (LBS) + MediaPipe landmark embedding |
| `pipeline/fitting.py` | multi-view optimisation |
| `pipeline/texture.py` | CPU texture baking (tested) |
| `pipeline/rig.py`, `analysis.py` | ports of the web rig/analysis contracts (tested) |
| `pipeline/export.py` | UV-seam split, PBR GLB, WebP thumbnail |
| `worker.py` | job runner; `modal_app.py` scale-to-zero L4 deployment |

Env: `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `WEB_URL`,
`RECON_WEBHOOK_SECRET`, `FLAME_DIR` (default `/models/flame`), `DEVICE`,
`ATLAS_SIZE`, `FIT_RESOLUTION`; Modal trigger: `RECON_TRIGGER_TOKEN`.

**Licensing:** FLAME requires a commercial licence for commercial use; this
repo does not include FLAME assets. See `scripts/convert_flame.py`.

Tests (CPU only): `pip install -e .[dev] && pytest -q`.
