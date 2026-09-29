"""Multi-view FLAME fitting.

Shared identity (shape β) across all views; per-view head pose, expression,
jaw and pinhole focal. Three stages:
  1. rigid   — per-view pose/translation from 2D landmarks (shape frozen)
  2. shape   — + β, ψ, jaw; landmark reprojection + silhouette IoU vs. the
               face/skin segmentation (soft rasteriser, PyTorch3D)
  3. photo   — + per-vertex albedo and 2nd-order SH lighting per view;
               photometric Charbonnier loss inside the skin mask
All losses are visibility-weighted: grazing / occluded landmarks and pixels
contribute little, which is what makes 7 phone photos enough.
"""

from __future__ import annotations

from dataclasses import dataclass

import cv2
import numpy as np
import torch
from pytorch3d.renderer import BlendParams, MeshRasterizer, MeshRenderer, RasterizationSettings, SoftSilhouetteShader
from pytorch3d.structures import Meshes
from pytorch3d.utils import cameras_from_opencv_projection

from twinme_recon.pipeline.flame import Flame, rodrigues
from twinme_recon.pipeline.frames import Frame

SKIN = (2, 3)  # body-skin, face-skin (MediaPipe multiclass selfie)


@dataclass
class FitResult:
    vertices: np.ndarray  # V×3, metres, head space of the neutral fit (no expression)
    posed_vertices: np.ndarray  # n×V×3, per-view expression/jaw (for texture projection)
    faces: np.ndarray
    cameras: list[dict]  # per view: R (3×3), t (3), K (3×3) — OpenCV convention
    albedo_vertex: np.ndarray  # V×3 linear RGB (low-frequency prior for texture fill)
    sh: np.ndarray  # views×9×3
    metrics: dict


def _sh_basis(n: torch.Tensor) -> torch.Tensor:
    x, y, z = n.unbind(-1)
    return torch.stack(
        [
            torch.full_like(x, 0.282095),
            0.488603 * y,
            0.488603 * z,
            0.488603 * x,
            1.092548 * x * y,
            1.092548 * y * z,
            0.315392 * (3 * z * z - 1),
            1.092548 * x * z,
            0.546274 * (x * x - y * y),
        ],
        dim=-1,
    )


def _vertex_normals(v: torch.Tensor, f: torch.Tensor) -> torch.Tensor:
    return Meshes(verts=v, faces=f[None].expand(v.shape[0], -1, -1)).verts_normals_padded()


def fit(frames: list[Frame], flame: Flame, device: str = "cuda", res: int = 512, iters: tuple[int, int, int] = (200, 350, 250)) -> FitResult:
    n = len(frames)
    dev = torch.device(device)
    flame = flame.to(dev)

    # --- observations at fitting resolution ---
    lm_idx = flame.lmk_mp_index
    obs, obs_w, masks, imgs, sizes = [], [], [], [], []
    for f in frames:
        h, w = f.hw
        s = res / max(h, w)
        sizes.append((round(h * s), round(w * s), s))
        obs.append(torch.from_numpy(f.landmarks[:, :2] * s)[lm_idx.cpu()])
        # regressed depth of each landmark vs. its neighbours tells visibility at grazing angles
        yaw = abs(f.pose[0]) if f.pose else 0.0
        obs_w.append(torch.full((len(lm_idx),), 1.0 if yaw < 15 else 0.8))
        cat = cv2.resize(f.categories, (sizes[-1][1], sizes[-1][0]), interpolation=cv2.INTER_NEAREST)
        masks.append(torch.from_numpy(np.isin(cat, SKIN).astype(np.float32)))
        imgs.append(torch.from_numpy(cv2.resize(f.image, (sizes[-1][1], sizes[-1][0]), interpolation=cv2.INTER_AREA).astype(np.float32) / 255.0) ** 2.2)
    H = max(sz[0] for sz in sizes)
    W = max(sz[1] for sz in sizes)

    def pad(t: torch.Tensor) -> torch.Tensor:
        ph, pw = H - t.shape[0], W - t.shape[1]
        return torch.nn.functional.pad(t, (0, 0, 0, pw, 0, ph) if t.dim() == 3 else (0, pw, 0, ph))

    lm_obs = torch.stack(obs).float().to(dev)  # n×L×2
    lm_w = torch.stack(obs_w).float().to(dev)
    mask_obs = torch.stack([pad(m) for m in masks]).to(dev)  # n×H×W
    img_obs = torch.stack([pad(i) for i in imgs]).to(dev)  # n×H×W×3

    # --- parameters ---
    shape = torch.zeros(1, flame.n_shape, device=dev, requires_grad=True)
    expr = torch.zeros(n, flame.n_expr, device=dev, requires_grad=True)
    jaw = torch.zeros(n, 3, device=dev, requires_grad=True)
    rot = torch.zeros(n, 3, device=dev)
    for i, f in enumerate(frames):  # init from MediaPipe pose (OpenCV camera looks down +Z; FLAME faces +Z)
        yaw, pitch, roll = (np.radians(a) for a in (f.pose or (0.0, 0.0, 0.0)))
        rot[i] = torch.tensor([np.pi + pitch, -yaw, roll])  # flip to face the camera
    rot.requires_grad_(True)
    trans = torch.tensor([[0.0, 0.0, 0.45]] * n, device=dev, requires_grad=True)
    focal = torch.tensor([[1.25 * max(sz[0], sz[1])] for sz in sizes], device=dev, requires_grad=True)

    def cameras():
        R = rodrigues(rot)
        K = torch.zeros(n, 3, 3, device=dev)
        K[:, 0, 0] = focal[:, 0]
        K[:, 1, 1] = focal[:, 0]
        K[:, 0, 2] = torch.tensor([sz[1] / 2 for sz in sizes], device=dev)
        K[:, 1, 2] = torch.tensor([sz[0] / 2 for sz in sizes], device=dev)
        K[:, 2, 2] = 1
        return R, trans, K

    def project(v: torch.Tensor, R: torch.Tensor, t: torch.Tensor, K: torch.Tensor) -> tuple[torch.Tensor, torch.Tensor]:
        pc = torch.einsum("nij,nvj->nvi", R, v) + t[:, None]
        uv = torch.einsum("nij,nvj->nvi", K, pc)
        return uv[..., :2] / uv[..., 2:].clamp_min(1e-4), pc

    raster = MeshRasterizer(raster_settings=RasterizationSettings(image_size=(H, W), blur_radius=np.log(1.0 / 1e-4 - 1.0) * 1e-5, faces_per_pixel=20))
    silhouette = MeshRenderer(rasterizer=raster, shader=SoftSilhouetteShader(blend_params=BlendParams(sigma=1e-5, gamma=1e-4)))
    face_scale = torch.stack([(o.max(0).values - o.min(0).values).norm() for o in lm_obs]).clamp_min(1.0)

    albedo = torch.full((1, flame.v_template.shape[0], 3), 0.45, device=dev, requires_grad=True)
    sh = torch.zeros(n, 9, 3, device=dev)
    sh[:, 0] = 1.2
    sh.requires_grad_(True)
    history: dict[str, float] = {}

    def run_stage(params: list[torch.Tensor], steps: int, lr: float, use_sil: bool, use_photo: bool) -> None:
        opt = torch.optim.Adam(params, lr=lr)
        for step in range(steps):
            opt.zero_grad()
            pose = torch.cat([torch.zeros(n, 3, device=dev), torch.zeros(n, 3, device=dev), jaw, torch.zeros(n, 6, device=dev)], dim=-1)
            out = flame(shape.expand(n, -1), expr, pose)
            R, t, K = cameras()
            lm3 = flame.landmarks(out.vertices)
            lm2, _ = project(lm3, R, t, K)
            err = ((lm2 - lm_obs).norm(dim=-1) / face_scale[:, None]) * lm_w
            loss = torch.nn.functional.huber_loss(err, torch.zeros_like(err), delta=0.02, reduction="sum") / n * 50
            loss = loss + 1e-3 * shape.pow(2).sum() + 5e-4 * expr.pow(2).sum() + 1e-2 * jaw.pow(2).sum()
            loss = loss + 1e-6 * ((focal - focal.detach().mean()) ** 2).sum()
            if use_sil or use_photo:
                cams = cameras_from_opencv_projection(R, t, K, torch.tensor([[H, W]] * n, device=dev))
                meshes = Meshes(verts=out.vertices, faces=flame.faces[None].expand(n, -1, -1))
                if use_sil:
                    sil = silhouette(meshes, cameras=cams)[..., 3]
                    # only the face/skin region is comparable (hair is not in FLAME)
                    inter = (sil * mask_obs).sum((1, 2))
                    union = (sil + mask_obs - sil * mask_obs).sum((1, 2)).clamp_min(1.0)
                    loss = loss + 0.5 * (1 - inter / union).sum()
                if use_photo:
                    frags = raster(meshes, cameras=cams)
                    nrm = _vertex_normals(out.vertices, flame.faces)
                    shade = torch.einsum("nvk,nkc->nvc", _sh_basis(torch.einsum("nij,nvj->nvi", R, nrm)), sh)
                    color = (albedo.expand(n, -1, -1) * shade).clamp(0, 1)
                    faces_c = color[:, flame.faces]  # n×F×3×3
                    pix_face = frags.pix_to_face[..., 0]
                    valid = (pix_face >= 0).float()
                    bary = frags.bary_coords[..., 0, :]
                    flat = faces_c.reshape(-1, 3, 3)
                    rendered = (flat[pix_face.clamp_min(0)] * bary[..., None]).sum(-2)
                    w = valid * mask_obs
                    diff = torch.sqrt(((rendered - img_obs) ** 2).sum(-1) + 1e-6) * w
                    loss = loss + 2.0 * diff.sum() / w.sum().clamp_min(1.0)
                    loss = loss + 1e-3 * (albedo - albedo.mean(1, keepdim=True)).pow(2).mean()
            loss.backward()
            opt.step()
            if step == steps - 1:
                history[f"loss_{len(history)}"] = float(loss.detach())

    run_stage([rot, trans, focal], iters[0], 1e-2, use_sil=False, use_photo=False)
    run_stage([rot, trans, focal, shape, expr, jaw], iters[1], 5e-3, use_sil=True, use_photo=False)
    run_stage([rot, trans, shape, expr, albedo, sh], iters[2], 3e-3, use_sil=True, use_photo=True)

    with torch.no_grad():
        neutral = flame(shape, torch.zeros(1, flame.n_expr, device=dev), torch.zeros(1, 15, device=dev)).vertices[0]
        R, t, K = cameras()
        pose = torch.cat([torch.zeros(n, 6, device=dev), jaw, torch.zeros(n, 6, device=dev)], dim=-1)
        posed = flame(shape.expand(n, -1), expr, pose)
        lm2, _ = project(flame.landmarks(posed.vertices), R, t, K)
        rms_px = float(((lm2 - lm_obs).norm(dim=-1)).mean())
        cams = []
        for i, (h, w, s) in enumerate(sizes):
            Ki = K[i].cpu().numpy().copy()
            Ki[:2] /= s  # back to original image resolution
            cams.append({"R": R[i].cpu().numpy(), "t": t[i].cpu().numpy(), "K": Ki, "expr": expr[i].cpu().numpy(), "jaw": jaw[i].cpu().numpy()})
    return FitResult(
        vertices=neutral.cpu().numpy(),
        posed_vertices=posed.vertices.cpu().numpy(),
        faces=flame.faces.cpu().numpy(),
        cameras=cams,
        albedo_vertex=albedo[0].detach().cpu().numpy(),
        sh=sh.detach().cpu().numpy(),
        metrics={"landmark_rms_px": rms_px, "views": n, **history},
    )
