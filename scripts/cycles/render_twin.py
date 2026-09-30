"""
Photoreal offline renders of the TwinMe template twin with Blender Cycles.

Used for the landing page hero video and the look stills: the same head and
the same procedural strands the web engine grows (exported by
/lab?mode=export), rendered with random-walk subsurface skin and the
Principled Hair BSDF.

    pip install bpy==5.0.1 imageio-ffmpeg numpy pillow   # Python 3.11
    python scripts/cycles/render_twin.py --export look.json --out frames/ \
        --mode video --frames 72 --res 1080x1350 --samples 96

Coordinates: the web engine uses metres, +Y up, +Z out of the face; Blender
is Z-up, so a point (x, y, z) maps to (x, -z, y) and the face looks down -Y.
"""

from __future__ import annotations

import argparse
import base64
import json
import math
import os
import sys

import bpy
import numpy as np
from mathutils import Euler, Vector

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
TEMPLATE = os.path.join(ROOT, "public", "models", "template")

# Melanin parametrisation of the Principled Hair BSDF per web colour id.
HAIR_MELANIN = {
    "black": (0.97, 0.15),
    "dark_brown": (0.86, 0.35),
    "brown": (0.72, 0.45),
    "blonde": (0.32, 0.55),
    "platinum": (0.06, 0.2),
    "ginger": (0.55, 0.95),
    "grey": (0.12, 0.05),
}


def b64(s: str, dtype) -> np.ndarray:
    return np.frombuffer(base64.b64decode(s), dtype=dtype)


def to_blender(p: np.ndarray) -> np.ndarray:
    """Engine (x, y, z) → Blender (x, -z, y)."""
    return np.stack([p[:, 0], -p[:, 2], p[:, 1]], axis=1)


def reset_scene(res: tuple[int, int], samples: int):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    sc.cycles.device = "CPU"
    sc.cycles.samples = samples
    sc.cycles.use_adaptive_sampling = True
    sc.cycles.adaptive_threshold = 0.02
    sc.cycles.use_denoising = True
    sc.cycles.denoiser = "OPENIMAGEDENOISE"
    sc.cycles.max_bounces = 8
    sc.cycles.transparent_max_bounces = 16
    sc.render.resolution_x, sc.render.resolution_y = res
    sc.render.resolution_percentage = 100
    sc.render.film_transparent = False
    sc.render.use_persistent_data = True
    if os.environ.get("CYCLES_THREADS"):
        sc.render.threads_mode = "FIXED"
        sc.render.threads = int(os.environ["CYCLES_THREADS"])
    sc.render.image_settings.file_format = "PNG"
    sc.render.image_settings.color_depth = "8"
    sc.view_settings.view_transform = "AgX"
    sc.view_settings.look = "AgX - Medium High Contrast"
    sc.view_settings.exposure = 0.0
    sc.cycles_curves.shape = "THICK"
    sc.cycles_curves.subdivisions = 2
    # A dark, warm studio: the subject is lit by the area lights, not the world.
    world = bpy.data.worlds.new("Studio")
    world.use_nodes = True
    bg = world.node_tree.nodes["Background"]
    bg.inputs["Color"].default_value = (0.004, 0.0035, 0.003, 1)
    bg.inputs["Strength"].default_value = 1.0
    sc.world = world
    return sc


def image_node(nt, path: str, colorspace: str):
    n = nt.nodes.new("ShaderNodeTexImage")
    n.image = bpy.data.images.load(path)
    n.image.colorspace_settings.name = colorspace
    n.interpolation = "Cubic"
    return n


def skin_material(scalp_tint=(0.09, 0.07, 0.055)) -> bpy.types.Material:
    m = bpy.data.materials.new("Skin")
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    albedo = image_node(nt, os.path.join(TEMPLATE, "albedo.jpg"), "sRGB")
    normal = image_node(nt, os.path.join(TEMPLATE, "normal.jpg"), "Non-Color")

    # Slight warmth/saturation lift: the scan albedo is a little grey.
    hsv = nt.nodes.new("ShaderNodeHueSaturation")
    hsv.inputs["Saturation"].default_value = 1.14
    hsv.inputs["Value"].default_value = 0.92
    nt.links.new(albedo.outputs["Color"], hsv.inputs["Color"])
    # Scalp under hair reads darker (roots, shadow) — the same mask the web engine uses.
    attr = nt.nodes.new("ShaderNodeVertexColor")
    attr.layer_name = "mask"
    sep = nt.nodes.new("ShaderNodeSeparateColor")
    nt.links.new(attr.outputs["Color"], sep.inputs["Color"])
    k = nt.nodes.new("ShaderNodeMath")
    k.operation = "MULTIPLY"
    k.inputs[1].default_value = 0.88
    nt.links.new(sep.outputs["Blue"], k.inputs[0])
    tint = nt.nodes.new("ShaderNodeMix")
    tint.data_type = "RGBA"
    tint.blend_type = "MULTIPLY"
    tint.inputs["B"].default_value = (*scalp_tint, 1)
    nt.links.new(k.outputs["Value"], tint.inputs["Factor"])
    nt.links.new(hsv.outputs["Color"], tint.inputs["A"])
    nt.links.new(tint.outputs["Result"], bsdf.inputs["Base Color"])

    bsdf.subsurface_method = "RANDOM_WALK_SKIN"
    bsdf.inputs["Subsurface Weight"].default_value = 1.0
    bsdf.inputs["Subsurface Radius"].default_value = (1.0, 0.38, 0.2)
    bsdf.inputs["Subsurface Scale"].default_value = 0.0042
    bsdf.inputs["Subsurface IOR"].default_value = 1.4
    bsdf.inputs["Subsurface Anisotropy"].default_value = 0.8
    bsdf.inputs["IOR"].default_value = 1.4
    bsdf.inputs["Sheen Weight"].default_value = 0.12  # vellus hair
    bsdf.inputs["Sheen Roughness"].default_value = 0.35
    bsdf.inputs["Coat Weight"].default_value = 0.06  # skin oil
    bsdf.inputs["Coat Roughness"].default_value = 0.32

    # Roughness breaks up across the face (pores, T-zone).
    tc = nt.nodes.new("ShaderNodeTexCoord")
    noise = nt.nodes.new("ShaderNodeTexNoise")
    noise.inputs["Scale"].default_value = 180.0
    noise.inputs["Detail"].default_value = 6.0
    nt.links.new(tc.outputs["Object"], noise.inputs["Vector"])
    rough = nt.nodes.new("ShaderNodeMapRange")
    rough.inputs["To Min"].default_value = 0.36
    rough.inputs["To Max"].default_value = 0.5
    nt.links.new(noise.outputs["Fac"], rough.inputs["Value"])
    nt.links.new(rough.outputs["Result"], bsdf.inputs["Roughness"])

    # Scan normal map + fine pore bump.
    nmap = nt.nodes.new("ShaderNodeNormalMap")
    nmap.inputs["Strength"].default_value = 1.0
    nt.links.new(normal.outputs["Color"], nmap.inputs["Color"])
    pores = nt.nodes.new("ShaderNodeTexVoronoi")
    pores.inputs["Scale"].default_value = 2600.0
    nt.links.new(tc.outputs["Object"], pores.inputs["Vector"])
    bump = nt.nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.08
    bump.inputs["Distance"].default_value = 0.00012
    nt.links.new(pores.outputs["Distance"], bump.inputs["Height"])
    nt.links.new(nmap.outputs["Normal"], bump.inputs["Normal"])
    nt.links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
    return m


def cloth_material() -> bpy.types.Material:
    m = bpy.data.materials.new("Cotton")
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (0.006, 0.006, 0.0065, 1)
    bsdf.inputs["Roughness"].default_value = 0.85
    bsdf.inputs["Sheen Weight"].default_value = 0.18
    bsdf.inputs["Sheen Roughness"].default_value = 0.45
    bsdf.inputs["Sheen Tint"].default_value = (0.3, 0.3, 0.32, 1)
    tc = nt.nodes.new("ShaderNodeTexCoord")
    weave = nt.nodes.new("ShaderNodeTexWave")
    weave.inputs["Scale"].default_value = 900.0
    weave.inputs["Distortion"].default_value = 2.0
    nt.links.new(tc.outputs["Object"], weave.inputs["Vector"])
    bump = nt.nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.15
    nt.links.new(weave.outputs["Fac"], bump.inputs["Height"])
    nt.links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
    return m


def hair_material(color_id: str, name: str) -> bpy.types.Material:
    melanin, redness = HAIR_MELANIN.get(color_id, HAIR_MELANIN["dark_brown"])
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    hair = nt.nodes.new("ShaderNodeBsdfHairPrincipled")
    hair.model = "CHIANG"
    hair.parametrization = "MELANIN"
    hair.inputs["Melanin"].default_value = melanin
    hair.inputs["Melanin Redness"].default_value = redness
    hair.inputs["Roughness"].default_value = 0.28
    hair.inputs["Radial Roughness"].default_value = 0.32
    hair.inputs["Coat"].default_value = 0.0
    hair.inputs["IOR"].default_value = 1.55
    hair.inputs["Random Color"].default_value = 0.12
    hair.inputs["Random Roughness"].default_value = 0.15
    info = nt.nodes.new("ShaderNodeHairInfo")
    nt.links.new(info.outputs["Random"], hair.inputs["Random"])
    nt.links.new(hair.outputs["BSDF"], out.inputs["Surface"])
    return m


def build_head(ex: dict, parent) -> tuple[bpy.types.Object, np.ndarray]:
    pos = to_blender(b64(ex["head"]["position"], np.float32).reshape(-1, 3).astype(np.float64))
    uv = b64(ex["head"]["uv"], np.float32).reshape(-1, 2)
    idx = b64(ex["head"]["index"], np.uint32).reshape(-1, 3)
    me = bpy.data.meshes.new("Head")
    me.from_pydata(pos.tolist(), [], idx.tolist())
    uvl = me.uv_layers.new(name="UVMap")
    loops = np.empty(len(me.loops), dtype=np.int32)
    me.loops.foreach_get("vertex_index", loops)
    uvl.data.foreach_set("uv", uv[loops].ravel())
    me.shade_smooth()
    if "mask" in ex["head"]:
        mask = b64(ex["head"]["mask"], np.float32).reshape(-1, 4).copy()
        # channels: r beard shadow, g beard zone, b scalp coverage, a → whole-scalp area
        mask[:, 3] = b64(ex["head"]["scalp"], np.float32) if "scalp" in ex["head"] else 0.0
        # Grow the scalp masks a few vertex rings: the scan's temples are pale where
        # the hairline estimate stops short of the sideburns.
        edges = np.empty(len(me.edges) * 2, dtype=np.int32)
        me.edges.foreach_get("vertices", edges)
        e = edges.reshape(-1, 2)
        for ch, rings in ((2, 1), (3, 2)):
            m = mask[:, ch].copy()
            for _ in range(rings):
                g = m.copy()
                np.maximum.at(g, e[:, 0], m[e[:, 1]] * 0.92)
                np.maximum.at(g, e[:, 1], m[e[:, 0]] * 0.92)
                m = g
            mask[:, ch] = m
        ca = me.color_attributes.new("mask", "FLOAT_COLOR", "POINT")
        ca.data.foreach_set("color", mask.ravel())
    me.materials.append(skin_material())
    ob = bpy.data.objects.new("Head", me)
    bpy.context.collection.objects.link(ob)
    ob.parent = parent
    return ob, pos


def build_shirt(head_pos: np.ndarray, idx: np.ndarray, rig: dict, parent):
    """A dark crew-neck: the bust below a collar line, pushed out along normals."""
    chin_y = rig["landmarks"][152 * 3 + 1]  # engine y == Blender z
    collar_front = chin_y - 0.075  # a hand below the chin
    me = bpy.data.meshes.new("ShirtSrc")
    me.from_pydata(head_pos.tolist(), [], idx.tolist())
    import bmesh

    bm = bmesh.new()
    bm.from_mesh(me)
    # A clean collar: cut along a plane that rises towards the back of the neck.
    geom = bm.verts[:] + bm.edges[:] + bm.faces[:]
    bmesh.ops.bisect_plane(bm, geom=geom, plane_co=(0.0, -0.08, collar_front), plane_no=(0.0, -0.2, 1.0), clear_outer=True)
    bm.normal_update()
    for v in bm.verts:
        v.co += v.normal * 0.0065
    bm.to_mesh(me)
    bm.free()
    me.shade_smooth()
    me.materials.append(cloth_material())
    ob = bpy.data.objects.new("Shirt", me)
    bpy.context.collection.objects.link(ob)
    mod = ob.modifiers.new("Thickness", "SOLIDIFY")
    mod.thickness = 0.004
    mod.offset = 1.0
    sub = ob.modifiers.new("Smooth", "SUBSURF")
    sub.levels = 1
    sub.render_levels = 2
    ob.parent = parent
    return ob


def build_strands(data: dict | None, name: str, color_id: str, root_radius: float, parent, tip_ratio=0.25):
    if not data:
        return None
    S, K = data["S"], data["K"]
    pts = to_blender(b64(data["points"], np.float32).reshape(-1, 3).astype(np.float64)).astype(np.float32)
    rnd = b64(data["rnd"], np.uint8).astype(np.float32) / 255.0
    cv = bpy.data.hair_curves.new(name)
    cv.add_curves([K] * S)
    cv.attributes["position"].data.foreach_set("vector", pts.ravel())
    t = np.tile(np.linspace(0.0, 1.0, K, dtype=np.float32), S)
    per_strand = np.repeat(0.8 + 0.4 * rnd, K)
    radius = root_radius * per_strand * (1.0 - (1.0 - tip_ratio) * t**1.5)
    if "radius" not in cv.attributes:
        cv.attributes.new("radius", "FLOAT", "POINT")
    cv.attributes["radius"].data.foreach_set("value", radius.astype(np.float32))
    cv.materials.append(hair_material(color_id, f"{name}Mat"))
    ob = bpy.data.objects.new(name, cv)
    bpy.context.collection.objects.link(ob)
    ob.parent = parent
    return ob



# MediaPipe landmark sets (same as src/lib/head/rig.ts)
EYE_R = [33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246]
EYE_L = [263, 249, 390, 373, 374, 380, 381, 382, 362, 398, 384, 385, 386, 387, 388, 466]
BROW_R = [46, 53, 52, 65, 55, 70, 63, 105, 66, 107]
BROW_L = [276, 283, 282, 295, 285, 300, 293, 334, 296, 336]


def _surface(bvh, x: float, z_up: float, y_front: float = -1.0):
    """Ray from in front of the face (Blender -Y) onto the skin; returns (co, normal)."""
    hit = bvh.ray_cast(Vector((x, y_front, z_up)), Vector((0.0, 1.0, 0.0)), 2.0)
    return (hit[0], hit[1]) if hit[0] is not None else (None, None)


def _grow_on_skin(bvh, root, normal, direction, length, K, lift, curl, rng):
    """A short hair that lies along the skin: step, re-project to the surface, lift."""
    pts = [root + normal * 0.00015]
    d = (direction - normal * direction.dot(normal)).normalized()
    p = Vector(root)
    ds = length / (K - 1)
    for k in range(1, K):
        t = k / (K - 1)
        d = (d + Vector((rng.normal(0, 0.12), rng.normal(0, 0.12), rng.normal(0, 0.12)))).normalized()
        d = (d + normal * (lift * (1.0 - t)) + Vector((0, 0, -curl * t))).normalized()
        p = p + d * ds
        loc, nrm, _, dist = bvh.find_nearest(p)
        if loc is not None:
            off = 0.00025 + lift * 0.0025 * t
            p = loc + nrm * off
            normal = nrm
        pts.append(Vector(p))
    return pts


def build_brows_and_lashes(head_ob, lm: np.ndarray, color_id: str, parent, seed=7):
    """Real eyebrow and eyelash strands (the scan only has them painted on)."""
    from mathutils.bvhtree import BVHTree

    dg = bpy.context.evaluated_depsgraph_get()
    bvh = BVHTree.FromObject(head_ob, dg)
    rng = np.random.default_rng(seed)
    strands: list[list[Vector]] = []
    radii: list[float] = []

    for brow, side in ((BROW_R, -1.0), (BROW_L, 1.0)):
        P = to_blender(lm[brow].copy())
        lower, upper = P[:5], P[5:]
        # brow runs from the lateral tail (index 0) to the medial head (index 4)
        for _ in range(900):
            u = rng.random() ** 0.85  # 0 = tail, 1 = head (denser towards the head)
            v = rng.random()
            a = np.array([np.interp(u * 4, range(5), lower[:, j]) for j in range(3)])
            b = np.array([np.interp(u * 4, range(5), upper[:, j]) for j in range(3)])
            q = a + (b - a) * v
            co, nrm = _surface(bvh, float(q[0]), float(q[2]))
            if co is None:
                continue
            lateral = Vector((side * 1.0, 0.0, 0.0))
            up = Vector((0.0, 0.0, 1.0))
            # medial hairs stand up, lateral hairs sweep outwards and slightly down
            w_up = max(0.0, 1.0 - (1.0 - u) * 2.2) * 0.9 + 0.15 * (v - 0.5)
            direction = lateral * (1.0 - w_up) + up * (w_up + 0.25 * v) - Vector((0, 0, 0.35 * (1.0 - v) * (1.0 - u)))
            length = (0.0055 + 0.0045 * rng.random()) * (0.75 + 0.35 * u)
            strands.append(_grow_on_skin(bvh, co, nrm, direction, length, 5, 0.35, 0.08, rng))
            radii.append(3.2e-5)

    for eye in (EYE_R, EYE_L):
        P = to_blender(lm[eye].copy())
        lower, upper = P[:9], np.vstack([P[8:9], P[9:], P[0:1]])[::-1]  # both outer → inner
        seam = (lower + np.array([np.interp(np.linspace(0, len(upper) - 1, 9), range(len(upper)), upper[:, j]) for j in range(3)]).T) / 2
        for i in range(110):
            u = rng.random()
            q = np.array([np.interp(u * 8, range(9), seam[:, j]) for j in range(3)])
            co, nrm = _surface(bvh, float(q[0]), float(q[2]) + 0.0006)
            if co is None:
                continue
            centre = 1.0 - abs(u - 0.5) * 1.4
            length = 0.0055 + 0.004 * centre + 0.0015 * rng.random()
            # closed lids: lashes fall down and forward, curling up at the tip
            pts = [co + nrm * 0.0002]
            d = (Vector((0, -0.55, -1.0)) + nrm * 0.4).normalized()
            p = Vector(pts[0])
            for k in range(1, 5):
                t = k / 4
                d = (d + Vector((0, -0.35 * t, 0.45 * t))).normalized()
                p = p + d * (length / 4)
                pts.append(Vector(p))
            strands.append(pts)
            radii.append(4.2e-5)

    if not strands:
        return None
    K = 5
    cv = bpy.data.hair_curves.new("BrowsLashes")
    cv.add_curves([K] * len(strands))
    arr = np.array([[c.x, c.y, c.z] for st in strands for c in st], dtype=np.float32)
    cv.attributes["position"].data.foreach_set("vector", arr.ravel())
    t = np.tile(np.linspace(0, 1, K, dtype=np.float32), len(strands))
    r = np.repeat(np.array(radii, dtype=np.float32), K) * (1.0 - 0.7 * t)
    if "radius" not in cv.attributes:
        cv.attributes.new("radius", "FLOAT", "POINT")
    cv.attributes["radius"].data.foreach_set("value", r)
    darker = {"platinum": "blonde", "grey": "brown", "blonde": "brown"}.get(color_id, color_id)
    cv.materials.append(hair_material(darker if darker != "natural" else "dark_brown", "BrowMat"))
    ob = bpy.data.objects.new("BrowsLashes", cv)
    bpy.context.collection.objects.link(ob)
    ob.parent = parent
    return ob


def area_light(name, loc, target, size, power, color, size_y=None):
    ld = bpy.data.lights.new(name, "AREA")
    ld.shape = "RECTANGLE" if size_y else "SQUARE"
    ld.size = size
    if size_y:
        ld.size_y = size_y
    ld.energy = power
    ld.color = color
    ob = bpy.data.objects.new(name, ld)
    bpy.context.collection.objects.link(ob)
    ob.location = loc
    direction = Vector(target) - Vector(loc)
    ob.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
    return ob


def studio_lights(target, rim=1.0):
    tx, ty, tz = target
    # key: big warm softbox, front-left and above
    area_light("Key", (tx - 1.1, ty - 0.95, tz + 0.8), target, 1.0, 46.0, (1.0, 0.89, 0.78))
    # fill: dim, cool, front-right, low
    area_light("Fill", (tx + 1.2, ty - 0.9, tz - 0.1), target, 1.4, 9.0, (0.86, 0.9, 1.0))
    # rims: strip boxes behind on both sides, separate hair from the background
    area_light("RimL", (tx - 0.85, ty + 0.95, tz + 0.35), target, 0.25, 45.0 * rim, (0.95, 0.96, 1.0), size_y=1.2)
    area_light("RimR", (tx + 0.9, ty + 0.85, tz + 0.45), target, 0.25, 36.0 * rim, (1.0, 0.88, 0.76), size_y=1.2)
    # top: a small hair light
    area_light("Top", (tx + 0.1, ty + 0.35, tz + 1.1), target, 0.5, 14.0, (1.0, 0.97, 0.93))
    # background glow behind the subject
    area_light("Back", (tx + 0.1, ty + 2.2, tz + 0.1), (tx, ty + 4.0, tz), 2.5, 6.0, (1.0, 0.8, 0.62))
    wall = bpy.data.meshes.new("Backdrop")
    wall.from_pydata([(-4, 3.2, -3), (4, 3.2, -3), (4, 3.2, 4), (-4, 3.2, 4)], [], [(0, 1, 2, 3)])
    m = bpy.data.materials.new("Backdrop")
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (0.03, 0.026, 0.022, 1)
    b.inputs["Roughness"].default_value = 1.0
    wall.materials.append(m)
    ob = bpy.data.objects.new("Backdrop", wall)
    bpy.context.collection.objects.link(ob)


def camera(target, distance: float, elevation_deg: float, azimuth_deg: float, focal: float, fstop: float):
    cd = bpy.data.cameras.new("Cam")
    cd.lens = focal
    cd.sensor_fit = "VERTICAL"
    cd.sensor_height = 24.0
    cd.dof.use_dof = True
    cd.dof.aperture_fstop = fstop
    cd.dof.aperture_blades = 9
    ob = bpy.data.objects.new("Cam", cd)
    bpy.context.collection.objects.link(ob)
    el, az = math.radians(elevation_deg), math.radians(azimuth_deg)
    t = Vector(target)
    ob.location = t + Vector((math.sin(az) * math.cos(el), -math.cos(az) * math.cos(el), math.sin(el))) * distance
    ob.rotation_euler = (t - ob.location).to_track_quat("-Z", "Y").to_euler()
    bpy.context.scene.camera = ob
    return ob


def main():
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else sys.argv[1:]
    ap = argparse.ArgumentParser()
    ap.add_argument("--export", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--mode", choices=["still", "video"], default="still")
    ap.add_argument("--res", default="1080x1350")
    ap.add_argument("--samples", type=int, default=96)
    ap.add_argument("--frames", type=int, default=72)
    ap.add_argument("--yaw", type=float, default=24.0, help="still: head yaw; video: +/- sweep")
    ap.add_argument("--pitch", type=float, default=-9.0, help="head pitch (negative = chin down)")
    ap.add_argument("--elevation", type=float, default=11.0)
    ap.add_argument("--distance", type=float, default=1.6)
    ap.add_argument("--focal", type=float, default=85.0)
    ap.add_argument("--fstop", type=float, default=4.0)
    ap.add_argument("--color", default="dark_brown")
    ap.add_argument("--no-shirt", action="store_true")
    ap.add_argument("--no-brows", action="store_true")
    ap.add_argument("--rim", type=float, default=0.6, help="rim light multiplier")
    ap.add_argument("--hide", default="", help="comma list of objects to hide (debug)")
    ap.add_argument("--range", default="", help="video: render frames lo:hi only (1-based, inclusive)")
    a = ap.parse_args(argv)

    with open(a.export) as f:
        ex = json.load(f)
    res = tuple(int(v) for v in a.res.split("x"))
    sc = reset_scene(res, a.samples)

    # Everything that turns with the head hangs off one pivot at the neck.
    pivot = bpy.data.objects.new("Pivot", None)
    bpy.context.collection.objects.link(pivot)
    head_ob, head_pos = build_head(ex, pivot)
    idx = b64(ex["head"]["index"], np.uint32).reshape(-1, 3)
    if not a.no_shirt:
        build_shirt(head_pos, idx, ex["rig"], pivot)
    build_strands(ex.get("hair"), "Hair", a.color, 3.8e-5, pivot)
    build_strands(ex.get("beard"), "Beard", a.color, 3.2e-5, pivot, tip_ratio=0.4)

    # Aim at the eyes: the rig's glabella/sellion area.
    lm = np.array(ex["rig"]["landmarks"], dtype=np.float64).reshape(-1, 3)
    if not a.no_brows:
        build_brows_and_lashes(head_ob, lm, a.color, pivot)
    eyes = to_blender(lm[[33, 263]].copy()).mean(axis=0)
    target = (float(eyes[0]), float(eyes[1]), float(eyes[2]) - 0.02)
    studio_lights(target, a.rim)
    # Rim and top lights only touch hair (light linking), so they sculpt the groom
    # without grazing the skin that shows through short sides.
    hair_col = bpy.data.collections.new("HairOnly")
    for name in ("Hair", "Beard", "BrowsLashes"):
        if name in bpy.data.objects:
            hair_col.objects.link(bpy.data.objects[name])
    for name in ("RimL", "RimR", "Top"):
        bpy.data.objects[name].light_linking.receiver_collection = hair_col
    cam = camera(target, a.distance, a.elevation, 0.0, a.focal, a.fstop)
    focus = bpy.data.objects.new("Focus", None)
    bpy.context.collection.objects.link(focus)
    focus.location = (float(eyes[0]), float(eyes[1]) - 0.01, float(eyes[2]))
    focus.parent = pivot
    cam.data.dof.focus_object = focus

    for name in filter(None, a.hide.split(",")):
        if name in bpy.data.objects:
            bpy.data.objects[name].hide_render = True
    pivot.rotation_mode = "XYZ"
    os.makedirs(a.out, exist_ok=True)
    if a.mode == "still":
        pivot.rotation_euler = Euler((math.radians(-a.pitch), 0.0, math.radians(-a.yaw)), "XYZ")
        sc.render.filepath = os.path.join(a.out, "still.png")
        bpy.ops.render.render(write_still=True)
        return
    sc.frame_start, sc.frame_end = 1, a.frames
    sc.render.fps = 24
    for i in range(a.frames):
        u = i / max(1, a.frames - 1)
        s = 0.5 - 0.5 * math.cos(math.pi * u)  # ease in-out
        yaw = -a.yaw + 2 * a.yaw * s
        pivot.rotation_euler = Euler((math.radians(-a.pitch), 0.0, math.radians(-yaw)), "XYZ")
        pivot.keyframe_insert("rotation_euler", frame=i + 1)
    # Resumable: frames already on disk are skipped; --range renders a slice.
    sc.render.use_overwrite = False
    sc.render.use_placeholder = False
    if a.range:
        lo, hi = (int(v) for v in a.range.split(":"))
        sc.frame_start, sc.frame_end = max(1, lo), min(a.frames, hi)
    sc.render.filepath = os.path.join(a.out, "f_")
    bpy.ops.render.render(animation=True)


if __name__ == "__main__":
    main()
