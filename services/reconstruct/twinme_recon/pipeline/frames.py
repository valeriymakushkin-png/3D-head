"""Capture decoding: EXIF-correct photos, video frame sampling, sharpness."""

from __future__ import annotations

import io
from dataclasses import dataclass, field

import av
import cv2
import numpy as np
from PIL import Image, ImageOps

try:  # HEIC from iPhones
    from pillow_heif import register_heif_opener

    register_heif_opener()
except ImportError:  # pragma: no cover
    pass

MAX_SIDE = 1600


@dataclass
class Frame:
    image: np.ndarray  # H×W×3 uint8 RGB
    source: str
    landmarks: np.ndarray | None = None  # 478×3, pixel x/y, z in pixel units (towards camera = +)
    pose: tuple[float, float, float] | None = None  # yaw, pitch, roll (deg)
    categories: np.ndarray | None = None  # H×W uint8 segmentation classes
    sharpness: float = 0.0
    meta: dict = field(default_factory=dict)

    @property
    def hw(self) -> tuple[int, int]:
        return self.image.shape[0], self.image.shape[1]


def _cap(img: np.ndarray) -> np.ndarray:
    h, w = img.shape[:2]
    k = min(1.0, MAX_SIDE / max(h, w))
    return cv2.resize(img, (round(w * k), round(h * k)), interpolation=cv2.INTER_AREA) if k < 1 else img


def sharpness(img: np.ndarray) -> float:
    g = cv2.cvtColor(img, cv2.COLOR_RGB2GRAY)
    g = cv2.resize(g, (256, round(256 * g.shape[0] / g.shape[1])))
    return float(cv2.Laplacian(g, cv2.CV_64F).var())


def decode_photo(data: bytes, name: str) -> Frame:
    im = ImageOps.exif_transpose(Image.open(io.BytesIO(data))).convert("RGB")
    arr = _cap(np.asarray(im))
    return Frame(image=arr, source=name, sharpness=sharpness(arr))


def decode_video(data: bytes, name: str, step_s: float = 0.15, max_frames: int = 160) -> list[Frame]:
    out: list[Frame] = []
    with av.open(io.BytesIO(data)) as container:
        stream = container.streams.video[0]
        next_t = 0.0
        for frame in container.decode(stream):
            t = float(frame.time or 0.0)
            if t + 1e-6 < next_t:
                continue
            next_t = t + step_s
            arr = _cap(frame.to_ndarray(format="rgb24"))
            out.append(Frame(image=arr, source=f"{name}@{t:.2f}", sharpness=sharpness(arr)))
            if len(out) >= max_frames:
                break
    return out
