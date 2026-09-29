"""MediaPipe face landmarks, head pose and multiclass segmentation (server side)."""

from __future__ import annotations

import math
from functools import lru_cache
from pathlib import Path

import mediapipe as mp
import numpy as np
from mediapipe.tasks import python as mp_tasks
from mediapipe.tasks.python import vision

from twinme_recon.pipeline.frames import Frame

MODELS = Path(__file__).resolve().parents[2] / "models"

# (yaw, pitch) bins — must match src/lib/recon/poses.ts
POSE_BINS = {
    "front": (0, 0),
    "left30": (28, 0),
    "left55": (52, 0),
    "right30": (-28, 0),
    "right55": (-52, 0),
    "up": (0, -16),
    "down": (0, 16),
    "left80": (72, 0),
    "right80": (-72, 0),
}


@lru_cache
def _landmarker() -> vision.FaceLandmarker:
    opts = vision.FaceLandmarkerOptions(
        base_options=mp_tasks.BaseOptions(model_asset_path=str(MODELS / "face_landmarker.task")),
        running_mode=vision.RunningMode.IMAGE,
        num_faces=1,
        output_facial_transformation_matrixes=True,
    )
    return vision.FaceLandmarker.create_from_options(opts)


@lru_cache
def _segmenter() -> vision.ImageSegmenter:
    opts = vision.ImageSegmenterOptions(
        base_options=mp_tasks.BaseOptions(model_asset_path=str(MODELS / "selfie_multiclass_256x256.tflite")),
        running_mode=vision.RunningMode.IMAGE,
        output_category_mask=True,
    )
    return vision.ImageSegmenter.create_from_options(opts)


def pose_from_matrix(m: np.ndarray) -> tuple[float, float, float]:
    """Same convention as the web (poseFromMatrix): yaw > 0 = subject turned to their left."""
    r = m[:3, :3]
    yaw = math.atan2(-r[2, 0], math.hypot(r[0, 0], r[1, 0]))
    pitch = math.atan2(r[2, 1], r[2, 2])
    roll = math.atan2(r[1, 0], r[0, 0])
    return math.degrees(yaw), math.degrees(pitch), math.degrees(roll)


def detect(frame: Frame) -> bool:
    img = mp.Image(image_format=mp.ImageFormat.SRGB, data=np.ascontiguousarray(frame.image))
    res = _landmarker().detect(img)
    if not res.face_landmarks:
        return False
    h, w = frame.hw
    lm = np.array([[p.x * w, p.y * h, -p.z * w] for p in res.face_landmarks[0]], dtype=np.float32)
    frame.landmarks = lm
    frame.pose = pose_from_matrix(np.asarray(res.facial_transformation_matrixes[0]))
    seg = _segmenter().segment(img)
    frame.categories = seg.category_mask.numpy_view().copy()
    return True


def select_views(frames: list[Frame], max_views: int = 12) -> list[Frame]:
    """Best frame per pose bin (sharpness-weighted), then fill with the sharpest leftovers."""
    chosen: dict[str, Frame] = {}
    for f in frames:
        if f.pose is None:
            continue
        yaw, pitch, _ = f.pose
        name, (ty, tp) = min(POSE_BINS.items(), key=lambda kv: (yaw - kv[1][0]) ** 2 + (pitch - kv[1][1]) ** 2)
        err = math.hypot(yaw - ty, pitch - tp)
        if err > 14:
            continue
        score = f.sharpness / (1 + err / 6)
        if name not in chosen or score > chosen[name].meta.get("score", 0):
            f.meta.update(bin=name, score=score)
            chosen[name] = f
    views = list(chosen.values())
    rest = sorted((f for f in frames if f.pose is not None and f not in views), key=lambda f: -f.sharpness)
    return (views + rest)[:max_views]
