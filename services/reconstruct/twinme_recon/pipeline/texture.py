"""Texture baking: multi-view projection → delighting → multi-band blending → fill.

CPU/NumPy + OpenCV so it is testable without a GPU:
  * texel map: every atlas texel → (face, barycentrics), rasterised once per topology
  * visibility: vertex-splat z-buffer per view (FLAME is dense enough at 5k verts)
  * weights:   facing³ × skin mask × image-edge falloff × view quality
  * delight:   divide by the fitted SH irradiance so the albedo is light-neutral
  * blending:  Laplacian-pyramid (multi-band) — low bands averaged, high bands
               from the most frontal view → sharp pores, no seams
  * fill:      unseen texels from the fitted per-vertex albedo, island padding
"""

from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache

import cv2
import numpy as np

SKIN = (2, 3)


@dataclass
class View:
    image: np.ndarray  # H×W×3 uint8 sRGB
    skin: np.ndarray  # H×W float 0..1
    R: np.ndarray
    t: np.ndarray
    K: np.ndarray
    vertices: np.ndarray  # posed V×3
    sh: np.ndarray | None = None  # 9×3
    quality: float = 1.0


def srgb_to_linear(x: np.ndarray) -> np.ndarray:
    return np.where(x <= 0.04045, x / 12.92, ((x + 0.055) / 1.055) ** 2.4)


def linear_to_srgb(x: np.ndarray) -> np.ndarray:
    x = np.clip(x, 0, 1)
    return np.where(x <= 0.0031308, x * 12.92, 1.055 * np.power(x, 1 / 2.4) - 0.055)


def rasterize_uv(vt: np.ndarray, ft: np.ndarray, size: int) -> tuple[np.ndarray, np.ndarray]:
    """Returns face index (S×S, −1 = empty) and barycentrics (S×S×3). Row 0 = v=1."""
    face = np.full((size, size), -1, dtype=np.int32)
    bary = np.zeros((size, size, 3), dtype=np.float32)
    px = np.stack([vt[:, 0] * size - 0.5, (1 - vt[:, 1]) * size - 0.5], axis=1)
    for fi, (a, b, c) in enumerate(ft):
        pa, pb, pc = px[a], px[b], px[c]
        x0 = int(max(0, np.floor(min(pa[0], pb[0], pc[0]))))
        x1 = int(min(size - 1, np.ceil(max(pa[0], pb[0], pc[0]))))
        y0 = int(max(0, np.floor(min(pa[1], pb[1], pc[1]))))
        y1 = int(min(size - 1, np.ceil(max(pa[1], pb[1], pc[1]))))
        if x1 < x0 or y1 < y0:
            continue
        xs, ys = np.meshgrid(np.arange(x0, x1 + 1), np.arange(y0, y1 + 1))
        d = (pb[1] - pc[1]) * (pa[0] - pc[0]) + (pc[0] - pb[0]) * (pa[1] - pc[1])
        if abs(d) < 1e-12:
            continue
        w0 = ((pb[1] - pc[1]) * (xs - pc[0]) + (pc[0] - pb[0]) * (ys - pc[1])) / d
        w1 = ((pc[1] - pa[1]) * (xs - pc[0]) + (pa[0] - pc[0]) * (ys - pc[1])) / d
        w2 = 1 - w0 - w1
        inside = (w0 >= -1e-4) & (w1 >= -1e-4) & (w2 >= -1e-4)
        yy, xx = ys[inside], xs[inside]
        face[yy, xx] = fi
        bary[yy, xx] = np.stack([w0[inside], w1[inside], w2[inside]], axis=-1)
    return face, bary


@lru_cache(maxsize=4)
def _cached_texels(vt_key: bytes, ft_key: bytes, size: int, vt_shape: tuple, ft_shape: tuple):
    vt = np.frombuffer(vt_key, dtype=np.float32).reshape(vt_shape)
    ft = np.frombuffer(ft_key, dtype=np.int64).reshape(ft_shape)
    return rasterize_uv(vt, ft, size)


def texel_map(vt: np.ndarray, ft: np.ndarray, size: int):
    vt32 = np.ascontiguousarray(vt, dtype=np.float32)
    ft64 = np.ascontiguousarray(ft, dtype=np.int64)
    return _cached_texels(vt32.tobytes(), ft64.tobytes(), size, vt32.shape, ft64.shape)


def vertex_normals(v: np.ndarray, f: np.ndarray) -> np.ndarray:
    n = np.zeros_like(v)
    fn = np.cross(v[f[:, 1]] - v[f[:, 0]], v[f[:, 2]] - v[f[:, 0]])
    for k in range(3):
        np.add.at(n, f[:, k], fn)
    return n / np.linalg.norm(n, axis=1, keepdims=True).clip(1e-9)


def sh_irradiance(n: np.ndarray, sh: np.ndarray) -> np.ndarray:
    x, y, z = n[..., 0], n[..., 1], n[..., 2]
    basis = np.stack(
        [np.full_like(x, 0.282095), 0.488603 * y, 0.488603 * z, 0.488603 * x, 1.092548 * x * y, 1.092548 * y * z, 0.315392 * (3 * z * z - 1), 1.092548 * x * z, 0.546274 * (x * x - y * y)],
        axis=-1,
    )
    return np.clip(basis @ sh, 0.15, 3.0)


def _zbuffer(uv: np.ndarray, z: np.ndarray, h: int, w: int, grid: int = 256, dilate: int = 2) -> tuple[np.ndarray, float]:
    s = grid / max(h, w)
    gx = np.clip((uv[:, 0] * s).astype(int), 0, grid - 1)
    gy = np.clip((uv[:, 1] * s).astype(int), 0, grid - 1)
    zb = np.full((grid, grid), np.inf, dtype=np.float32)
    np.minimum.at(zb, (gy, gx), z.astype(np.float32))
    zb = cv2.erode(zb, np.ones((2 * dilate + 1, 2 * dilate + 1), np.uint8))  # erode = min filter
    return zb, s


def _pyramid(img: np.ndarray, levels: int) -> list[np.ndarray]:
    g = [img]
    for _ in range(levels):
        g.append(cv2.pyrDown(g[-1]))
    lap = [g[i] - cv2.pyrUp(g[i + 1], dstsize=(g[i].shape[1], g[i].shape[0])) for i in range(levels)]
    return lap + [g[-1]]


def _gauss(img: np.ndarray, levels: int) -> list[np.ndarray]:
    g = [img]
    for _ in range(levels):
        g.append(cv2.pyrDown(g[-1]))
    return g


def bake(
    views: list[View],
    faces: np.ndarray,
    vt: np.ndarray,
    ft: np.ndarray,
    fallback_vertex_albedo: np.ndarray,
    size: int = 2048,
    levels: int = 5,
) -> tuple[np.ndarray, float]:
    """Returns (S×S×3 uint8 sRGB atlas, coverage 0..1)."""
    face_idx, bary = texel_map(vt, ft, size)
    valid = face_idx >= 0
    fi = face_idx[valid]
    b = bary[valid]
    tri = faces[fi]  # T×3 vertex ids

    lap_acc = None
    w_acc = None
    total_w = np.zeros((size, size), np.float32)
    for view in views:
        v = view.vertices
        n = vertex_normals(v, faces)
        p = (v[tri] * b[..., None]).sum(1)
        nt = (n[tri] * b[..., None]).sum(1)
        nt /= np.linalg.norm(nt, axis=1, keepdims=True).clip(1e-9)
        pc = p @ view.R.T + view.t
        nc = nt @ view.R.T
        uvw = pc @ view.K.T
        uv = uvw[:, :2] / uvw[:, 2:3].clip(1e-6)
        h, w = view.image.shape[:2]

        vc = v @ view.R.T + view.t
        vuv = (vc @ view.K.T)[:, :2] / (vc @ view.K.T)[:, 2:3].clip(1e-6)
        zb, s = _zbuffer(vuv, vc[:, 2], h, w)
        gx = np.clip((uv[:, 0] * s).astype(int), 0, zb.shape[1] - 1)
        gy = np.clip((uv[:, 1] * s).astype(int), 0, zb.shape[0] - 1)
        vis = pc[:, 2] <= zb[gy, gx] + 0.006

        view_dir = -pc / np.linalg.norm(pc, axis=1, keepdims=True).clip(1e-9)
        facing = np.clip((nc * view_dir).sum(1), 0, 1)
        inside = (uv[:, 0] > 1) & (uv[:, 1] > 1) & (uv[:, 0] < w - 2) & (uv[:, 1] < h - 2)
        mx = np.clip(uv[:, 0], 0, w - 1).astype(np.float32)
        my = np.clip(uv[:, 1], 0, h - 1).astype(np.float32)
        color = cv2.remap(view.image, mx[None], my[None], cv2.INTER_LINEAR)[0].astype(np.float32) / 255.0
        skin = cv2.remap(view.skin.astype(np.float32), mx[None], my[None], cv2.INTER_LINEAR)[0]
        edge = np.clip(np.minimum.reduce([uv[:, 0], uv[:, 1], w - uv[:, 0], h - uv[:, 1]]) / (0.04 * max(h, w)), 0, 1)
        weight = vis * inside * facing**3 * skin * edge * view.quality

        lin = srgb_to_linear(color)
        if view.sh is not None:
            lin = lin / sh_irradiance(nc, view.sh)  # delight
        tex = np.zeros((size, size, 3), np.float32)
        wt = np.zeros((size, size), np.float32)
        tex[valid] = np.clip(lin, 0, 1.5)
        wt[valid] = weight
        total_w += wt

        lap = _pyramid(tex, levels)
        gw = _gauss(wt, levels)
        if lap_acc is None:
            lap_acc = [np.zeros_like(l) for l in lap]
            w_acc = [np.zeros_like(g) for g in gw]
        for lvl in range(levels + 1):
            # sharper selection in high bands (powers), smooth averaging in low bands
            pw = 4.0 if lvl < 2 else (2.0 if lvl < 4 else 1.0)
            wl = gw[lvl] ** pw
            lap_acc[lvl] += lap[lvl] * wl[..., None]
            w_acc[lvl] += wl

    assert lap_acc is not None and w_acc is not None
    bands = [lap_acc[l] / np.maximum(w_acc[l], 1e-6)[..., None] for l in range(levels + 1)]
    img = bands[-1]
    for lvl in range(levels - 1, -1, -1):
        img = cv2.pyrUp(img, dstsize=(bands[lvl].shape[1], bands[lvl].shape[0])) + bands[lvl]

    # Fill: per-vertex albedo interpolated over texels where no view saw skin.
    fb = np.zeros((size, size, 3), np.float32)
    fb[valid] = (fallback_vertex_albedo[tri] * b[..., None]).sum(1)
    k = np.clip(total_w / 0.25, 0, 1)[..., None]
    img = img * k + fb * (1 - k)

    out = (linear_to_srgb(img) * 255).astype(np.uint8)
    # Pad UV islands so mip-mapping never samples background at seams.
    mask = valid.astype(np.uint8)
    for _ in range(8):
        grown = cv2.dilate(out, np.ones((3, 3), np.uint8))
        mask_g = cv2.dilate(mask, np.ones((3, 3), np.uint8))
        edge = (mask_g > 0) & (mask == 0)
        out[edge] = grown[edge]
        mask = mask_g
    coverage = float((total_w[valid] > 0.1).mean()) if valid.any() else 0.0
    return out, coverage
