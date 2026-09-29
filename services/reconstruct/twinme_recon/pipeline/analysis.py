"""Face analysis — ports of apps/web/src/lib/style/analysis.ts and the
segmentation-based hair/beard reader in lib/recon/analyze.ts. Output matches
the web's FaceAnalysisSchema exactly."""

from __future__ import annotations

import math

import numpy as np

from twinme_recon.pipeline.frames import Frame

HAIR, BODY_SKIN, FACE_SKIN = 1, 2, 3


def _dist(L: np.ndarray, a: int, b: int) -> float:
    return float(np.linalg.norm(L[a] - L[b]))


def _angle(a: np.ndarray, b: np.ndarray, c: np.ndarray) -> float:
    u, v = a - b, c - b
    return math.degrees(math.acos(float(np.clip(u @ v / (np.linalg.norm(u) * np.linalg.norm(v)), -1, 1))))


def classify_face_shape(L: np.ndarray) -> dict:
    face_length = _dist(L, 10, 152) * 1.08
    cheek = _dist(L, 234, 454)
    jaw = _dist(L, 58, 288)
    forehead = _dist(L, 54, 284)
    chin = _dist(L, 148, 377)
    jaw_angle = (_angle(L[234], L[58], L[152]) + _angle(L[454], L[288], L[152])) / 2
    ipd = float(np.linalg.norm((L[263] + L[362]) / 2 - (L[33] + L[133]) / 2)) * 1000
    R, jr, fr = face_length / cheek, jaw / cheek, forehead / cheek
    g = lambda x, mu, s: math.exp(-(((x - mu) / s) ** 2))  # noqa: E731
    angular = 1 - min(1.0, max(0.0, (jaw_angle - 118) / 22))
    raw = {
        "oval": g(R, 1.42, 0.1) * g(jr, 0.8, 0.08) * g(fr, 0.86, 0.1),
        "round": g(R, 1.22, 0.1) * g(jr, 0.82, 0.09) * (1 - angular * 0.7),
        "square": g(R, 1.28, 0.12) * g(jr, 0.92, 0.06) * (0.3 + angular * 0.7),
        "oblong": g(R, 1.62, 0.12) * g(jr, 0.84, 0.1),
        "heart": g(R, 1.4, 0.15) * g(fr - jr, 0.16, 0.07) * g(chin / jaw, 0.33, 0.1),
        "diamond": g(R, 1.42, 0.15) * g(fr, 0.72, 0.07) * g(jr, 0.72, 0.07),
    }
    total = sum(raw.values()) or 1.0
    scores = {k: round(v / total, 3) for k, v in raw.items()}
    return {
        "faceShape": max(scores, key=scores.get),
        "faceShapeScores": scores,
        "metrics": {
            "faceLength": round(face_length, 4),
            "cheekboneWidth": round(cheek, 4),
            "jawWidth": round(jaw, 4),
            "foreheadWidth": round(forehead, 4),
            "chinWidth": round(chin, 4),
            "jawAngleDeg": round(jaw_angle, 1),
            "lengthToWidth": round(R, 3),
            "ipdMm": round(ipd, 1),
        },
    }


def rgb_to_lab(rgb: np.ndarray) -> np.ndarray:
    c = rgb / 255.0
    lin = np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
    M = np.array([[0.4124, 0.3576, 0.1805], [0.2126, 0.7152, 0.0722], [0.0193, 0.1192, 0.9505]])
    xyz = lin @ M.T / np.array([0.95047, 1.0, 1.08883])
    f = np.where(xyz > 216 / 24389, np.cbrt(xyz), (24389 / 27 * xyz + 16) / 116)
    return np.stack([116 * f[..., 1] - 16, 500 * (f[..., 0] - f[..., 1]), 200 * (f[..., 1] - f[..., 2])], axis=-1)


def skin_tone(rgb: np.ndarray) -> dict:
    L, a, b = rgb_to_lab(np.asarray(rgb, dtype=np.float64))
    ita = math.degrees(math.atan2(L - 50, b))
    cat = "very_light" if ita > 55 else "light" if ita > 41 else "intermediate" if ita > 28 else "tan" if ita > 10 else "brown" if ita > -30 else "dark"
    hue = math.degrees(math.atan2(b, a))
    undertone = "warm" if hue > 60 else "cool" if hue < 48 else "neutral"
    return {"hex": "#" + "".join(f"{int(round(v)):02x}" for v in rgb), "ita": round(ita, 1), "category": cat, "undertone": undertone}


def mean_skin_rgb(frame: Frame, ids=(50, 280, 101, 330, 151, 9)) -> np.ndarray | None:
    L, img, cat = frame.landmarks, frame.image, frame.categories
    r = max(3, int((L[152, 1] - L[10, 1]) * 0.03))
    px = []
    for i in ids:
        x, y = int(L[i, 0]), int(L[i, 1])
        patch = img[max(0, y - r) : y + r + 1, max(0, x - r) : x + r + 1]
        m = cat[max(0, y - r) : y + r + 1, max(0, x - r) : x + r + 1] == FACE_SKIN
        px.append(patch[m])
    allpx = np.concatenate(px) if px else np.zeros((0, 3))
    return allpx.mean(0) if len(allpx) > 20 else None


def hair_and_beard(front: Frame) -> tuple[dict, dict, float, str]:
    """Returns (natural_hair, beard, baked_beard, length_class) from the frontal segmentation."""
    L, cat, img = front.landmarks, front.categories, front.image
    h, w = cat.shape
    fh = L[152, 1] - L[10, 1]
    fw = L[454, 0] - L[234, 0]
    cx, top = L[10, 0], L[10, 1]
    xs = np.clip(np.arange(int(cx - fw * 0.15), int(cx + fw * 0.15)), 0, w - 1)
    hair_top = top
    for y in range(int(top), max(0, int(top - fh * 0.8)), -2):
        if (cat[y, xs] == HAIR).sum() > 2:
            hair_top = y
    hair_height = max(0.0, (top - hair_top) / fh)
    y0, y1 = int(max(0, top - fh * 0.3)), int(max(0, top - fh * 0.04))
    x0, x1 = int(max(0, cx - fw * 0.3)), int(min(w, cx + fw * 0.3))
    band = cat[y0:y1, x0:x1]
    hair_px = (band == HAIR).sum()
    skin_px = np.isin(band, (FACE_SKIN, BODY_SKIN)).sum()
    coverage = hair_px / max(1, hair_px + skin_px)
    fringe_band = cat[int(top) : int(top + fh * 0.16), int(cx - fw * 0.25) : int(cx + fw * 0.25)]
    fringe = float((fringe_band == HAIR).mean()) if fringe_band.size else 0.0
    hair_pixels = img[int(max(0, hair_top)) : int(top), x0:x1][cat[int(max(0, hair_top)) : int(top), x0:x1] == HAIR]
    if len(hair_pixels) > 50:
        lab = rgb_to_lab(hair_pixels.astype(np.float64))
        L_, a_, b_ = np.percentile(lab[:, 0], 60), np.median(lab[:, 1]), np.median(lab[:, 2])
        color = _lab_to_hex(L_, a_, b_)
    else:
        color = "#2a211b"

    # lowest hair beside the face (long hair falls past the jaw)
    side_bottom = 0.0
    left = np.arange(int(L[234, 0] - fh * 0.25), int(L[234, 0]))
    right = np.arange(int(L[454, 0]), int(L[454, 0] + fh * 0.25))
    cols = np.clip(np.concatenate([left, right]), 0, w - 1)
    for y in range(int(top), int(min(h, L[152, 1] + fh * 0.6)), 3):
        if (cat[y, cols] == HAIR).sum() > 3:
            side_bottom = (y - top) / fh

    base, length_class, scale = "textured_crop", "short", 1.0
    if coverage < 0.25:
        base, length_class, scale = "buzz_cut", "bald", 0.35
    elif side_bottom > 1.05:
        base, length_class, scale = "long", "long", min(1.6, max(0.6, (side_bottom - 0.6) / 0.7))
    elif side_bottom > 0.7 and fringe > 0.25:
        base, length_class = "curtains", "medium"
    elif hair_height < 0.06:
        base, length_class, scale = "buzz_cut", "buzz", max(0.5, hair_height / 0.04)
    elif fringe > 0.35:
        base = "curtains" if hair_height > 0.16 else "french_crop"
    elif hair_height > 0.2:
        base, length_class, scale = "quiff", "medium", min(1.5, hair_height / 0.22)
    else:
        scale = min(1.4, max(0.7, hair_height / 0.12))
    natural = {"base": base, "lengthScale": round(scale, 3), "volume": round(min(0.9, max(0.08, hair_height * 3)), 3), "curl": 0.2, "color": color, "density": round(min(1.0, max(0.1, coverage * 1.1)), 3)}

    # beard: hair share below the nose inside the jaw
    yn, yc = int(L[2, 1]), int(L[152, 1])
    xa, xb = int(L[172, 0]), int(L[397, 0])
    region = cat[yn:yc, xa:xb]
    cov = float((region == HAIR).mean()) if region.size else 0.0
    centre = cat[yn:yc, int(cx - fw * 0.14) : int(cx + fw * 0.14)]
    ccov = float((centre == HAIR).mean()) if centre.size else 0.0
    cheek = mean_skin_rgb(front, (50, 280, 101, 330))
    low = img[yn:yc, xa:xb][region != HAIR]
    lum = lambda p: (p @ np.array([0.299, 0.587, 0.114])).mean()  # noqa: E731
    darkness = (lum(low) / lum(cheek[None])) if (cheek is not None and len(low)) else 1.0
    detected = "clean"
    if cov > 0.45:
        detected = "full"
    elif cov > 0.2:
        detected = "goatee" if ccov > cov * 2 else "short"
    elif ccov > 0.3:
        detected = "goatee"
    elif darkness < 0.86:
        detected = "stubble"
    baked = min(1.0, cov * 1.6 + max(0.0, 1 - darkness) * 2.5)
    return natural, {"detected": detected, "coverage": round(cov, 3)}, baked, length_class


def _lab_to_hex(L: float, a: float, b: float) -> str:
    fy = (L + 16) / 116
    fx, fz = fy + a / 500, fy - b / 200
    inv = lambda t: t**3 if t**3 > 216 / 24389 else (116 * t - 16) / (24389 / 27)  # noqa: E731
    X, Y, Z = inv(fx) * 0.95047, inv(fy), inv(fz) * 1.08883
    rgb = np.array([3.2406 * X - 1.5372 * Y - 0.4986 * Z, -0.9689 * X + 1.8758 * Y + 0.0415 * Z, 0.0557 * X - 0.204 * Y + 1.057 * Z])
    enc = np.where(rgb <= 0.0031308, 12.92 * rgb, 1.055 * np.power(np.clip(rgb, 0, None), 1 / 2.4) - 0.055)
    return "#" + "".join(f"{int(np.clip(round(v * 255), 0, 255)):02x}" for v in enc)


def build_analysis(rig_landmarks: np.ndarray, skin_rgb: np.ndarray, natural: dict, beard: dict, length_class: str) -> dict:
    shape = classify_face_shape(rig_landmarks)
    return {
        **shape,
        "skin": skin_tone(skin_rgb),
        "hair": {"color": natural["color"], "lengthClass": length_class, "density": natural["density"], "recession": 0},
        "beard": beard,
    }
