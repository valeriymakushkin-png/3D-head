"""One-time conversion of the official FLAME 2023 release into plain NumPy
archives (no chumpy at runtime). Run in a throwaway env with chumpy:

    pip install chumpy numpy==1.23.5
    python scripts/convert_flame.py --flame FLAME2023/flame2023.pkl \
        --uv FLAME_texture/head_template_mesh.obj \
        --mediapipe mediapipe_landmark_embedding/mediapipe_landmark_embedding.npz \
        --out /models/flame

FLAME is © Max Planck Institute for Intelligent Systems. Download it yourself
from https://flame.is.tue.mpg.de after accepting the licence; commercial use
requires a separate licence (via Meshcapade).
"""

from __future__ import annotations

import argparse
import pickle
from pathlib import Path

import numpy as np


def to_np(x):
    return np.asarray(getattr(x, "r", x))


def read_obj_uv(path: Path) -> tuple[np.ndarray, np.ndarray]:
    vt, ft = [], []
    for line in path.read_text().splitlines():
        if line.startswith("vt "):
            vt.append([float(v) for v in line.split()[1:3]])
        elif line.startswith("f "):
            ft.append([int(tok.split("/")[1]) - 1 for tok in line.split()[1:4]])
    return np.asarray(vt, np.float32), np.asarray(ft, np.int64)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--flame", type=Path, required=True)
    ap.add_argument("--uv", type=Path, required=True)
    ap.add_argument("--mediapipe", type=Path, required=True)
    ap.add_argument("--out", type=Path, required=True)
    a = ap.parse_args()
    a.out.mkdir(parents=True, exist_ok=True)

    with a.flame.open("rb") as fh:
        m = pickle.load(fh, encoding="latin1")
    posedirs = to_np(m["posedirs"])  # V×3×36
    np.savez_compressed(
        a.out / "flame.npz",
        v_template=to_np(m["v_template"]).astype(np.float32),
        shapedirs=to_np(m["shapedirs"]).astype(np.float32),
        posedirs=posedirs.reshape(-1, posedirs.shape[-1]).T.astype(np.float32),
        J_regressor=np.asarray(m["J_regressor"].todense() if hasattr(m["J_regressor"], "todense") else m["J_regressor"], np.float32),
        weights=to_np(m["weights"]).astype(np.float32),
        kintree_table=np.asarray(m["kintree_table"], np.int64),
        f=np.asarray(m["f"], np.int64),
    )
    vt, ft = read_obj_uv(a.uv)
    np.savez_compressed(a.out / "flame_uv.npz", vt=vt, ft=ft)
    emb = np.load(a.mediapipe)
    np.savez_compressed(a.out / "mediapipe_embedding.npz", lmk_face_idx=emb["lmk_face_idx"], lmk_b_coords=emb["lmk_b_coords"], landmark_indices=emb["landmark_indices"])
    print(f"wrote {a.out}")


if __name__ == "__main__":
    main()
