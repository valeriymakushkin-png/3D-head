"""CPU-only tests for the deterministic stages (no GPU, no FLAME assets)."""

import hashlib
import hmac
import math

import numpy as np
import pytest

from twinme_recon.notify import sign
from twinme_recon.pipeline import analysis, export, rig, texture


def test_rasterize_uv_covers_triangle_area():
    vt = np.array([[0.1, 0.1], [0.9, 0.1], [0.1, 0.9]], np.float32)
    ft = np.array([[0, 1, 2]])
    face, bary = texture.rasterize_uv(vt, ft, 128)
    covered = (face >= 0).mean()
    assert abs(covered - 0.32) < 0.03  # triangle area = 0.8·0.8/2
    b = bary[face >= 0]
    assert np.allclose(b.sum(1), 1, atol=1e-4)


def test_split_uv_seams_duplicates_only_seam_vertices():
    v = np.random.rand(4, 3)
    f = np.array([[0, 1, 2], [0, 2, 3]])
    vt = np.random.rand(5, 2)
    ft = np.array([[0, 1, 2], [4, 2, 3]])  # vertex 0 has two UVs
    nv, nf, nuv = export.split_uv_seams(v, f, vt, ft)
    assert len(nv) == 5 and nf.shape == (2, 3)
    assert np.allclose(nv[nf[1, 0]], v[0]) and np.allclose(nuv[nf[1, 0]], vt[4])


def test_srgb_roundtrip():
    x = np.linspace(0, 1, 50)
    assert np.allclose(texture.linear_to_srgb(texture.srgb_to_linear(x)), x, atol=1e-6)


def test_bake_single_view_reproduces_plane_colour():
    # A plane facing the camera, textured by a flat-coloured photo.
    v = np.array([[-0.1, -0.1, 0], [0.1, -0.1, 0], [0.1, 0.1, 0], [-0.1, 0.1, 0]], np.float64)
    f = np.array([[0, 1, 2], [0, 2, 3]])
    vt = np.array([[0.05, 0.05], [0.95, 0.05], [0.95, 0.95], [0.05, 0.95]], np.float32)
    img = np.full((200, 200, 3), (180, 120, 90), np.uint8)
    K = np.array([[400.0, 0, 100], [0, 400, 100], [0, 0, 1]])
    # camera looks down +Z at the plane 0.5 m away; flip so the plane faces it
    R = np.diag([1.0, -1.0, -1.0])
    t = np.array([0, 0, 0.5])
    view = texture.View(image=img, skin=np.ones((200, 200), np.float32), R=R, t=t, K=K, vertices=v)
    atlas, cov = texture.bake([view], f, vt, f, np.full((4, 3), 0.2), size=64, levels=3)
    centre = atlas[28:36, 28:36].reshape(-1, 3).mean(0)
    assert cov > 0.8
    assert np.allclose(centre, (180, 120, 90), atol=6)


def _synthetic_landmarks(width=0.14, length=0.19):
    L = np.zeros((478, 3))
    L[10] = [0, 0.02, 0.1]
    L[152] = [0, 0.02 - length / 1.08, 0.1]
    L[234], L[454] = [-width / 2, -0.05, 0.05], [width / 2, -0.05, 0.05]
    L[58], L[288] = [-0.055, -0.1, 0.07], [0.055, -0.1, 0.07]
    L[54], L[284] = [-0.06, 0.0, 0.09], [0.06, 0.0, 0.09]
    L[148], L[377] = [-0.02, -0.15, 0.1], [0.02, -0.15, 0.1]
    L[33], L[133], L[263], L[362] = [-0.045, -0.035, 0.09], [-0.018, -0.035, 0.09], [0.045, -0.035, 0.09], [0.018, -0.035, 0.09]
    return L


def test_face_shape_scores_are_a_distribution():
    r = analysis.classify_face_shape(_synthetic_landmarks())
    assert math.isclose(sum(r["faceShapeScores"].values()), 1.0, abs_tol=0.01)
    assert r["faceShape"] in r["faceShapeScores"]
    assert 60 < r["metrics"]["ipdMm"] < 64


def test_long_face_classifies_oblong():
    assert analysis.classify_face_shape(_synthetic_landmarks(width=0.12, length=0.2))["faceShape"] == "oblong"


def test_skin_tone_categories():
    assert analysis.skin_tone(np.array([235, 200, 180]))["category"] in {"very_light", "light"}
    assert analysis.skin_tone(np.array([90, 60, 45]))["category"] in {"brown", "dark", "tan"}


def test_rig_matches_web_contract():
    L = _synthetic_landmarks()
    L[105], L[334], L[127], L[356], L[0] = [-0.03, -0.012, 0.1], [0.03, -0.012, 0.1], [-0.07, -0.03, 0.05], [0.07, -0.03, 0.05], [0, -0.09, 0.11]
    # sphere-ish cranium point cloud
    rng = np.random.default_rng(0)
    d = rng.normal(size=(4000, 3))
    d /= np.linalg.norm(d, axis=1, keepdims=True)
    pts = d * np.array([0.08, 0.09, 0.1]) + np.array([0, 0.0, 0.0])
    r, pos = rig.build_rig(L, pts, scale=1.0)
    assert len(r["landmarks"]) == 478 * 3 and len(r["hairline"]) == 9
    assert r["meshToHead"][0] == 1 and pos.shape == pts.shape


def test_webhook_signature_matches_web_verifier():
    body = b'{"avatarId":"x","status":"ready"}'
    header = sign(body, "s" * 40, ts=1700000000)
    t, v1 = (kv.split("=")[1] for kv in header.split(","))
    assert v1 == hmac.new(b"s" * 40, f"{t}.".encode() + body, hashlib.sha256).hexdigest()


@pytest.mark.parametrize("levels", [2, 4])
def test_pyramid_reconstructs(levels):
    img = np.random.rand(64, 64, 3).astype(np.float32)
    lap = texture._pyramid(img, levels)
    out = lap[-1]
    import cv2

    for lvl in range(levels - 1, -1, -1):
        out = cv2.pyrUp(out, dstsize=(lap[lvl].shape[1], lap[lvl].shape[0])) + lap[lvl]
    assert np.allclose(out, img, atol=1e-5)
