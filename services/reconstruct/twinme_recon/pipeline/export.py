"""GLB export (UV-seam split, PBR material, embedded 2K albedo) + thumbnail."""

from __future__ import annotations

import io

import numpy as np
import trimesh
from PIL import Image
from trimesh.visual.material import PBRMaterial
from trimesh.visual.texture import TextureVisuals


def split_uv_seams(vertices: np.ndarray, faces: np.ndarray, vt: np.ndarray, ft: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """glTF needs one UV per vertex: duplicate vertices along UV seams."""
    pairs = np.stack([faces.reshape(-1), ft.reshape(-1)], axis=1)
    uniq, inverse = np.unique(pairs, axis=0, return_inverse=True)
    new_v = vertices[uniq[:, 0]]
    new_uv = vt[uniq[:, 1]]
    new_f = inverse.reshape(-1, 3)
    return new_v.astype(np.float32), new_f.astype(np.int32), new_uv.astype(np.float32)


def to_glb(vertices: np.ndarray, faces: np.ndarray, vt: np.ndarray, ft: np.ndarray, albedo: np.ndarray) -> bytes:
    v, f, uv = split_uv_seams(vertices, faces, vt, ft)
    image = Image.fromarray(albedo)
    material = PBRMaterial(baseColorTexture=image, metallicFactor=0.0, roughnessFactor=0.55, name="skin")
    mesh = trimesh.Trimesh(vertices=v, faces=f, visual=TextureVisuals(uv=uv, material=material), process=False)
    mesh.fix_normals()
    return mesh.export(file_type="glb")


def thumbnail(front_image: np.ndarray, landmarks: np.ndarray, size: int = 384) -> bytes:
    """Square crop around the face from the frontal capture (webp)."""
    x0, y0 = landmarks[:, :2].min(0)
    x1, y1 = landmarks[:, :2].max(0)
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2 - 0.1 * (y1 - y0)
    half = 0.85 * max(x1 - x0, y1 - y0)
    h, w = front_image.shape[:2]
    box = (int(max(0, cx - half)), int(max(0, cy - half)), int(min(w, cx + half)), int(min(h, cy + half)))
    im = Image.fromarray(front_image).crop(box).resize((size, size), Image.LANCZOS)
    buf = io.BytesIO()
    im.save(buf, format="WEBP", quality=86)
    return buf.getvalue()
