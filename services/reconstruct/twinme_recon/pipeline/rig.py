"""Head rig — a faithful port of apps/web/src/lib/head/rig.ts (buildRig /
estimateHairline) so HD twins load in the studio exactly like Instant twins.
Convention: metres, +Y up, +Z out of the face, +X subject's left; origin =
cranium centre."""

from __future__ import annotations

import math

import numpy as np

LM = dict(
    foreheadTop=10, noseTip=1, upperLip=0, chin=152, cheekR=234, cheekL=454, templeR=127, templeL=356,
    foreheadR=54, foreheadL=284, eyeROuter=33, eyeRInner=133, eyeLOuter=263, eyeLInner=362, browR=105, browL=334,
)


def _el(p: np.ndarray, c: np.ndarray) -> float:
    d = p - c
    return math.asin(float(np.clip(d[1] / max(np.linalg.norm(d), 1e-9), -1, 1)))


def estimate_hairline(landmarks: np.ndarray, center: np.ndarray, radii: np.ndarray) -> list[float]:
    L = landmarks
    top = _el(L[LM["foreheadTop"]], center)
    forehead = _el((L[LM["foreheadR"]] + L[LM["foreheadL"]]) / 2, center)
    temple = _el((L[LM["templeR"]] + L[LM["templeL"]]) / 2, center)
    brow = _el((L[LM["browR"]] + L[LM["browL"]]) / 2, center)
    mouth_y = L[LM["upperLip"]][1]
    nape = math.asin(float(np.clip((mouth_y - center[1] + 0.012) / (radii[2] * 1.05), -1, 1)))
    return [top + 0.16, top + 0.2, forehead + 0.2, temple + 0.1, temple + 0.02, brow + 0.22, temple + 0.05, nape + 0.08, nape]


def build_rig(landmarks: np.ndarray, positions: np.ndarray, scale: float | None = None) -> tuple[dict, np.ndarray]:
    """Returns (rig dict in head space, positions translated into head space)."""
    L = landmarks.astype(np.float64)
    eye_r = (L[LM["eyeROuter"]] + L[LM["eyeRInner"]]) / 2
    eye_l = (L[LM["eyeLOuter"]] + L[LM["eyeLInner"]]) / 2
    s = scale if scale is not None else 0.063 / float(np.linalg.norm(eye_l - eye_r))
    cx = (L[LM["cheekR"]][0] + L[LM["cheekL"]][0]) / 2
    brow_y = (L[LM["browR"]][1] + L[LM["browL"]][1]) / 2
    cy = brow_y + 0.012 / s
    slab = 0.012 / s
    P = positions.astype(np.float64)
    near_mid = np.abs(P[:, 0] - cx) < 0.03 / s
    y_top = P[near_mid, 1].max()
    in_slab = np.abs(P[:, 1] - (cy + 0.03 / s)) < slab
    mid_slab = in_slab & (np.abs(P[:, 0] - cx) < 0.02 / s)
    z_min, z_max = P[mid_slab, 2].min(), P[mid_slab, 2].max()
    x_abs = np.abs(P[in_slab, 0] - cx).max()
    cz = (z_min + z_max) / 2
    c = np.array([cx, cy, cz])
    radii = np.array([x_abs * s, (y_top - cy) * s, (z_max - z_min) / 2 * s])
    head_lm = (L - c) * s
    head_pos = (P - c) * s
    rig = {
        "version": 1,
        "landmarks": [round(float(v), 5) for v in head_lm.reshape(-1)],
        "center": [0.0, 0.0, 0.0],
        "radii": [float(r) for r in radii],
        "hairline": [round(v, 4) for v in estimate_hairline(head_lm, np.zeros(3), radii)],
        "meshToHead": [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
    }
    return rig, head_pos.astype(np.float32)
