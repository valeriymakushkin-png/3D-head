"""End-to-end HD Twin reconstruction for one avatar."""

from __future__ import annotations

import time
from dataclasses import dataclass

import numpy as np
import trimesh

from twinme_recon.config import settings
from twinme_recon.pipeline import analysis, export, frames, landmarks, rig, texture
from twinme_recon.pipeline.fitting import fit
from twinme_recon.pipeline.flame import Flame


class ReconError(Exception):
    """Failure with a user-facing message."""

    def __init__(self, user_message: str, detail: str | None = None):
        super().__init__(detail or user_message)
        self.user_message = user_message


@dataclass
class ReconOutput:
    glb: bytes
    thumbnail: bytes
    rig: dict
    analysis: dict
    natural_hair: dict
    metrics: dict


_flame: Flame | None = None


def _get_flame() -> Flame:
    global _flame
    if _flame is None:
        _flame = Flame(settings().flame_dir)
    return _flame


def landmarks_on_mesh(view: frames.Frame, cam: dict, posed: np.ndarray, neutral: np.ndarray, faces: np.ndarray) -> np.ndarray:
    """All 478 MediaPipe landmarks on the neutral mesh: cast rays from the
    fitted camera through each 2D landmark into the posed mesh, then carry
    the hit's barycentrics over to the neutral mesh (same topology)."""
    R, t, K = cam["R"], cam["t"], cam["K"]
    origin_world = -R.T @ t
    px = np.c_[view.landmarks[:, :2], np.ones(len(view.landmarks))]
    dirs_cam = (np.linalg.inv(K) @ px.T).T
    dirs = dirs_cam @ R  # R^T applied row-wise
    dirs /= np.linalg.norm(dirs, axis=1, keepdims=True)
    mesh = trimesh.Trimesh(vertices=posed, faces=faces, process=False)
    locs, idx_ray, idx_tri = mesh.ray.intersects_location(np.repeat(origin_world[None], len(dirs), 0), dirs, multiple_hits=False)
    out = np.full((len(dirs), 3), np.nan)
    for loc, r, tri in zip(locs, idx_ray, idx_tri):
        a, b, c = posed[faces[tri]]
        bary = trimesh.triangles.points_to_barycentric(np.array([[a, b, c]]), loc[None])[0]
        out[r] = bary @ neutral[faces[tri]]
    # misses (silhouette): nearest mesh point to the ray at the depth of its nearest hit neighbour
    miss = np.isnan(out[:, 0])
    if miss.any() and (~miss).any():
        hit_pts = view.landmarks[~miss, :2]
        for i in np.where(miss)[0]:
            j = np.argmin(((hit_pts - view.landmarks[i, :2]) ** 2).sum(1))
            out[i] = out[np.where(~miss)[0][j]]
    return out.astype(np.float32)


def reconstruct(captures: list[tuple[str, bytes, str]]) -> ReconOutput:
    """captures: (name, bytes, kind) — kind 'photo' | 'video'."""
    t0 = time.time()
    all_frames: list[frames.Frame] = []
    for name, data, kind in captures:
        if kind == "video":
            all_frames += frames.decode_video(data, name)
        else:
            all_frames.append(frames.decode_photo(data, name))
    detected = [f for f in all_frames if landmarks.detect(f)]
    views = landmarks.select_views(detected)
    bins = {f.meta.get("bin") for f in views}
    if not {"front"} <= bins or not ({"left30", "left55"} & bins) or not ({"right30", "right55"} & bins):
        raise ReconError("We need a clear front photo and both sides. Please rescan turning your head slowly.", f"bins={sorted(b for b in bins if b)}")
    t_detect = time.time()

    flame = _get_flame()
    fitres = fit(views, flame, device=settings().device, res=settings().fit_resolution)
    if fitres.metrics["landmark_rms_px"] > 0.06 * settings().fit_resolution:
        raise ReconError("Your photos didn't line up well enough. Try brighter, even light and hold still.", f"rms={fitres.metrics['landmark_rms_px']:.1f}")
    t_fit = time.time()

    front_i = min(range(len(views)), key=lambda i: abs(views[i].pose[0]) + abs(views[i].pose[1]))
    front = views[front_i]
    tex_views = [
        texture.View(
            image=v.image,
            skin=np.isin(v.categories, texture.SKIN).astype(np.float32),
            R=fitres.cameras[i]["R"],
            t=fitres.cameras[i]["t"],
            K=fitres.cameras[i]["K"],
            vertices=fitres.posed_vertices[i],
            sh=fitres.sh[i],
            quality=1.4 if i == front_i else 1.0,
        )
        for i, v in enumerate(views)
    ]
    vt = flame.vt.cpu().numpy()
    ft = flame.ft.cpu().numpy()
    atlas, coverage = texture.bake(tex_views, fitres.faces, vt, ft, fitres.albedo_vertex, size=settings().atlas_size)
    t_tex = time.time()

    lms = landmarks_on_mesh(front, fitres.cameras[front_i], fitres.posed_vertices[front_i], fitres.vertices, fitres.faces)
    rig_dict, head_vertices = rig.build_rig(lms, fitres.vertices, scale=1.0)
    head_landmarks = np.asarray(rig_dict["landmarks"], dtype=np.float64).reshape(-1, 3)
    skin_rgb = analysis.mean_skin_rgb(front)
    if skin_rgb is None:
        raise ReconError("We couldn't see enough skin in the front photo. Remove hats or glasses and try again.")
    natural, beard, baked_beard, length_class = analysis.hair_and_beard(front)
    face = analysis.build_analysis(head_landmarks, skin_rgb, natural, beard, length_class)

    glb = export.to_glb(head_vertices, fitres.faces, vt, ft, atlas)
    thumb = export.thumbnail(front.image, front.landmarks)
    return ReconOutput(
        glb=glb,
        thumbnail=thumb,
        rig=rig_dict,
        analysis=face,
        natural_hair={**natural, "bakedBeard": round(baked_beard, 3), "skinRgb": [round(float(c), 1) for c in skin_rgb]},
        metrics={
            **fitres.metrics,
            "coverage": round(coverage, 3),
            "frames_in": len(all_frames),
            "frames_detected": len(detected),
            "views": len(views),
            "t_detect_s": round(t_detect - t0, 2),
            "t_fit_s": round(t_fit - t_detect, 2),
            "t_texture_s": round(t_tex - t_fit, 2),
            "t_total_s": round(time.time() - t0, 2),
        },
    )
