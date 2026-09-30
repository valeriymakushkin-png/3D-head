"""
Encodes rendered frames (f_0001.png …) into the landing hero loop.

The head turns one way in the render; the loop plays it forward then back
(ping-pong), so N rendered frames give a seamless ~2N-frame loop.

    python scripts/cycles/encode_hero.py frames/ public/hero --fps 20

Writes twin.webm (VP9), twin.mp4 (H.264, iOS/Safari) and twin-poster.jpg.
Uses the ffmpeg binary bundled with `imageio-ffmpeg`.
"""

from __future__ import annotations

import argparse
import glob
import os
import shutil
import subprocess
import tempfile

import imageio_ffmpeg
from PIL import Image


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("frames")
    ap.add_argument("out")
    ap.add_argument("--fps", type=int, default=20)
    ap.add_argument("--width", type=int, default=864)
    a = ap.parse_args()

    frames = sorted(glob.glob(os.path.join(a.frames, "f_*.png")))
    if len(frames) < 2:
        raise SystemExit("no frames")
    order = frames + frames[-2:0:-1]  # forward, then back (without repeating the ends)
    os.makedirs(a.out, exist_ok=True)
    ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
    with tempfile.TemporaryDirectory() as tmp:
        for i, f in enumerate(order):
            shutil.copy(f, os.path.join(tmp, f"s_{i:04d}.png"))
        src = ["-framerate", str(a.fps), "-i", os.path.join(tmp, "s_%04d.png")]
        scale = ["-vf", f"scale={a.width}:-2:flags=lanczos"]
        subprocess.run(
            [ffmpeg, "-y", *src, *scale, "-c:v", "libx264", "-preset", "slow", "-crf", "22", "-profile:v", "high",
             "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-an", os.path.join(a.out, "twin.mp4")],
            check=True,
        )
        subprocess.run(
            [ffmpeg, "-y", *src, *scale, "-c:v", "libvpx-vp9", "-b:v", "0", "-crf", "34", "-row-mt", "1",
             "-pix_fmt", "yuv420p", "-an", os.path.join(a.out, "twin.webm")],
            check=True,
        )
    poster = Image.open(frames[len(frames) // 2]).convert("RGB")
    w = a.width
    poster = poster.resize((w, round(poster.height * w / poster.width)), Image.LANCZOS)
    poster.save(os.path.join(a.out, "twin-poster.jpg"), quality=82, optimize=True, progressive=True)
    for f in ("twin.mp4", "twin.webm", "twin-poster.jpg"):
        p = os.path.join(a.out, f)
        print(f"{f}: {os.path.getsize(p) / 1024:.0f} KB")


if __name__ == "__main__":
    main()
