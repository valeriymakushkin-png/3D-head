# Self-hosted GPU worker (RunPod / GKE / bare metal). Modal users: see modal_app.py.
FROM nvidia/cuda:12.4.1-cudnn-devel-ubuntu22.04

ENV DEBIAN_FRONTEND=noninteractive PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 FORCE_CUDA=1 \
    TORCH_CUDA_ARCH_LIST="8.0;8.6;8.9;9.0"
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3.11 python3.11-dev python3-pip git ffmpeg libgl1 libglib2.0-0 curl \
    && rm -rf /var/lib/apt/lists/* && ln -sf /usr/bin/python3.11 /usr/local/bin/python

WORKDIR /app
RUN python -m pip install --upgrade pip && \
    python -m pip install torch==2.4.1 torchvision==0.19.1 --index-url https://download.pytorch.org/whl/cu124 && \
    python -m pip install fvcore iopath && \
    python -m pip install --no-build-isolation "git+https://github.com/facebookresearch/pytorch3d.git@v0.7.8"

COPY pyproject.toml ./
COPY twinme_recon ./twinme_recon
COPY scripts ./scripts
RUN python -m pip install . && bash scripts/fetch_models.sh

# FLAME assets are licensed separately: mount them read-only at /models/flame.
VOLUME ["/models/flame"]
USER 10001
CMD ["python", "-m", "twinme_recon.worker"]
