# Offline renders (Blender Cycles)

The landing hero video and the look strip are path-traced renders of the same
template twin and the same procedural grooms the web engine grows — not stock
footage. Skin uses random-walk subsurface scattering; hair uses the Principled
Hair BSDF on the exported strands; eyebrows and eyelashes are real strands.

```bash
# 1. Tooling (Python 3.11): Blender as a module + ffmpeg
python3.11 -m venv .venv-cycles && . .venv-cycles/bin/activate
pip install bpy==5.0.1 imageio-ffmpeg numpy pillow

# 2. Export head + strands from the running app (dev server on :3000)
#    /lab?mode=export&hair=textured_crop&len=0.6&tex=0.42&vol=0.45&q=offline
#    exposes window.__EXPORT__; any headless browser can save it as JSON.

# 3. Render
python scripts/cycles/render_twin.py --export look.json --out out/still --mode still \
    --res 540x660 --samples 80 --distance 1.22 --yaw 20
python scripts/cycles/render_twin.py --export look.json --out out/video --mode video \
    --frames 50 --res 864x1080 --samples 64 --distance 1.32 --yaw 14

# 4. Encode the ping-pong loop + poster into public/hero
python scripts/cycles/encode_hero.py out/video public/hero --fps 20
```

`CYCLES_THREADS=3` limits the render to three cores. A 864×1080 frame takes
~3–4 minutes on 4 CPU cores. The `offline` quality tier (finer 3.5 mm strand
segments, 160k strands) exists only for these renders.
