"""FLAME head model (Li et al. 2017) as a differentiable PyTorch layer.

Assets are licensed by the Max Planck Institute (commercial use requires a
licence via Meshcapade) and are NOT shipped in this repo. Convert the
official release once with scripts/convert_flame.py into `flame.npz`
(+ `flame_uv.npz`, `mediapipe_embedding.npz`) and mount them at FLAME_DIR.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import numpy as np
import torch
import torch.nn.functional as F

N_SHAPE = 300
N_EXPR = 100


def rodrigues(aa: torch.Tensor) -> torch.Tensor:
    """Axis-angle (…,3) → rotation matrices (…,3,3)."""
    angle = aa.norm(dim=-1, keepdim=True).clamp_min(1e-8)
    axis = aa / angle
    x, y, z = axis.unbind(-1)
    zero = torch.zeros_like(x)
    k = torch.stack([zero, -z, y, z, zero, -x, -y, x, zero], dim=-1).reshape(*aa.shape[:-1], 3, 3)
    eye = torch.eye(3, device=aa.device, dtype=aa.dtype).expand_as(k)
    s = torch.sin(angle)[..., None]
    c = torch.cos(angle)[..., None]
    return eye + s * k + (1 - c) * (k @ k)


@dataclass
class FlameOutput:
    vertices: torch.Tensor  # B×V×3 (metres)
    joints: torch.Tensor  # B×5×3


class Flame(torch.nn.Module):
    def __init__(self, flame_dir: Path, n_shape: int = 100, n_expr: int = 50):
        super().__init__()
        d = np.load(flame_dir / "flame.npz")
        self.n_shape, self.n_expr = n_shape, n_expr
        f32 = lambda a: torch.from_numpy(np.asarray(a, dtype=np.float32))  # noqa: E731
        self.register_buffer("v_template", f32(d["v_template"]))  # V×3
        sd = f32(d["shapedirs"])  # V×3×400
        self.register_buffer("shapedirs", torch.cat([sd[..., :n_shape], sd[..., N_SHAPE : N_SHAPE + n_expr]], dim=-1))
        self.register_buffer("posedirs", f32(d["posedirs"]))  # 36×(V·3)
        self.register_buffer("J_regressor", f32(d["J_regressor"]))  # 5×V
        self.register_buffer("weights", f32(d["weights"]))  # V×5
        self.register_buffer("faces", torch.from_numpy(np.asarray(d["f"], dtype=np.int64)))
        parents = np.asarray(d["kintree_table"])[0].astype(np.int64)
        parents[0] = -1
        self.parents = parents.tolist()

        uv = np.load(flame_dir / "flame_uv.npz")
        self.register_buffer("vt", f32(uv["vt"]))  # T×2
        self.register_buffer("ft", torch.from_numpy(np.asarray(uv["ft"], dtype=np.int64)))  # F×3

        emb = np.load(flame_dir / "mediapipe_embedding.npz")
        self.register_buffer("lmk_faces", torch.from_numpy(np.asarray(emb["lmk_face_idx"], dtype=np.int64)))
        self.register_buffer("lmk_bary", f32(emb["lmk_b_coords"]))
        self.register_buffer("lmk_mp_index", torch.from_numpy(np.asarray(emb["landmark_indices"], dtype=np.int64)))

    def forward(self, shape: torch.Tensor, expr: torch.Tensor, pose: torch.Tensor) -> FlameOutput:
        """shape B×n_shape, expr B×n_expr, pose B×15 (global, neck, jaw, eyeL, eyeR axis-angles)."""
        b = shape.shape[0]
        coeffs = torch.cat([shape, expr], dim=-1)
        v_shaped = self.v_template[None] + torch.einsum("vcl,bl->bvc", self.shapedirs, coeffs)
        joints = torch.einsum("jv,bvc->bjc", self.J_regressor, v_shaped)
        rot = rodrigues(pose.view(b, 5, 3))
        eye = torch.eye(3, device=pose.device)
        pose_feat = (rot[:, 1:] - eye).reshape(b, -1)
        v_posed = v_shaped + (pose_feat @ self.posedirs).view(b, -1, 3)

        # kinematic chain
        rel = joints.clone()
        rel[:, 1:] -= joints[:, self.parents[1:]]
        tf = torch.cat([F.pad(rot, (0, 0, 0, 1)), F.pad(rel[..., None], (0, 0, 0, 1), value=1.0)], dim=-1)  # B×5×4×4
        chain = [tf[:, 0]]
        for i in range(1, 5):
            chain.append(chain[self.parents[i]] @ tf[:, i])
        world = torch.stack(chain, dim=1)
        posed_joints = world[:, :, :3, 3]
        jh = F.pad(joints, (0, 1))[..., None]
        world = world - F.pad(world @ jh, (3, 0))
        T = torch.einsum("vj,bjkl->bvkl", self.weights, world)
        vh = F.pad(v_posed, (0, 1), value=1.0)[..., None]
        verts = (T @ vh)[..., :3, 0]
        return FlameOutput(vertices=verts, joints=posed_joints)

    def landmarks(self, verts: torch.Tensor) -> torch.Tensor:
        """MediaPipe-indexed landmarks on the mesh (B×L×3), L = len(lmk_mp_index)."""
        tri = self.faces[self.lmk_faces]  # L×3
        v = verts[:, tri]  # B×L×3×3
        return (v * self.lmk_bary[None, :, :, None]).sum(dim=2)
