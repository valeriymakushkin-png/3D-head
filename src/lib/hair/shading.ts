import { type SdfGrid, sampleSdf } from "@/lib/hair/sdf";
import type { StrandMeshData } from "@/lib/hair/generate";
import type { Vec3 } from "@/lib/head/rig";

/**
 * Baked light visibility for a static groom under the fixed studio rig.
 *
 * The head never moves relative to the lights (the camera orbits), so the
 * expensive part of realistic hair — self-shadowing — can be precomputed per
 * strand point like a deep opacity map: splat the groom into a density grid,
 * then march towards each light. The same grid shadows the skin (the fringe
 * on the forehead, the scalp under a crop), and a soft SDF march adds the
 * head's own occlusion (eye sockets, under the chin, behind the ears).
 */
export interface DensityGrid {
  min: Vec3;
  cell: number;
  dims: [number, number, number];
  /** Optical depth per cell (fraction of a ray blocked while crossing one cell). */
  data: Float32Array;
}

const KAPPA = 0.9;

export function emptyDensity(): DensityGrid {
  return { min: [0, 0, 0], cell: 1, dims: [1, 1, 1], data: new Float32Array(1) };
}

/** Splats ribbon centre-line points (two vertices per point) into a density grid. */
export function buildDensity(d: StrandMeshData, cell = 0.0032): DensityGrid {
  const S = d.strandCount,
    K = d.pointsPerStrand,
    P = d.position;
  if (!S) return emptyDensity();
  let x0 = Infinity,
    y0 = Infinity,
    z0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity,
    z1 = -Infinity;
  for (let v = 0; v < P.length; v += 6) {
    const x = P[v],
      y = P[v + 1],
      z = P[v + 2];
    if (x < x0) x0 = x;
    if (y < y0) y0 = y;
    if (z < z0) z0 = z;
    if (x > x1) x1 = x;
    if (y > y1) y1 = y;
    if (z > z1) z1 = z;
  }
  const pad = 2 * cell;
  const min: Vec3 = [x0 - pad, y0 - pad, z0 - pad];
  const dims: [number, number, number] = [
    Math.ceil((x1 - x0 + 2 * pad) / cell) + 1,
    Math.ceil((y1 - y0 + 2 * pad) / cell) + 1,
    Math.ceil((z1 - z0 + 2 * pad) / cell) + 1,
  ];
  const [nx, ny] = dims;
  const data = new Float32Array(dims[0] * dims[1] * dims[2]);
  const inv = 1 / cell;
  const area = 1 / (cell * cell);
  for (let s = 0; s < S; s++) {
    for (let k = 0; k < K; k++) {
      const v = (s * K + k) * 6;
      const n = (s * K + Math.min(K - 1, k + 1)) * 6;
      const p = (s * K + Math.max(0, k - 1)) * 6;
      const ds = 0.5 * Math.hypot(P[n] - P[p], P[n + 1] - P[p + 1], P[n + 2] - P[p + 2]);
      const t = k / (K - 1);
      const w = d.strandWidth * (1 - 0.82 * Math.pow(t, 1.5)) * 0.9;
      const c = w * ds * area;
      // trilinear splat
      const fx = (P[v] - min[0]) * inv - 0.5,
        fy = (P[v + 1] - min[1]) * inv - 0.5,
        fz = (P[v + 2] - min[2]) * inv - 0.5;
      const i = fx | 0,
        j = fy | 0,
        l = fz | 0;
      const tx = fx - i,
        ty = fy - j,
        tz = fz - l;
      const o = i + nx * (j + ny * l);
      const sy = nx,
        sz = nx * ny;
      data[o] += c * (1 - tx) * (1 - ty) * (1 - tz);
      data[o + 1] += c * tx * (1 - ty) * (1 - tz);
      data[o + sy] += c * (1 - tx) * ty * (1 - tz);
      data[o + sy + 1] += c * tx * ty * (1 - tz);
      data[o + sz] += c * (1 - tx) * (1 - ty) * tz;
      data[o + sz + 1] += c * tx * (1 - ty) * tz;
      data[o + sz + sy] += c * (1 - tx) * ty * tz;
      data[o + sz + sy + 1] += c * tx * ty * tz;
    }
  }
  return { min, cell, dims, data };
}

function density(g: DensityGrid, x: number, y: number, z: number): number {
  const i = ((x - g.min[0]) / g.cell) | 0,
    j = ((y - g.min[1]) / g.cell) | 0,
    k = ((z - g.min[2]) / g.cell) | 0;
  if (i < 0 || j < 0 || k < 0 || i >= g.dims[0] || j >= g.dims[1] || k >= g.dims[2]) return 0;
  return g.data[i + g.dims[0] * (j + g.dims[1] * k)];
}

/** exp(−optical depth) through the groom from p towards direction L. */
function hairTransmittance(
  g: DensityGrid,
  x: number,
  y: number,
  z: number,
  lx: number,
  ly: number,
  lz: number,
  maxDist: number,
  /** In cells. Strands start past their own splat footprint (no self-shadow bias); skin starts close. */
  start = 1.5,
): number {
  if (g.data.length === 1) return 1;
  const step = g.cell * 1.4;
  let tau = 0;
  for (let t = g.cell * start; t < maxDist; t += step) {
    tau += density(g, x + lx * t, y + ly * t, z + lz * t) * 1.4;
    if (tau * KAPPA > 7) return 0;
  }
  return Math.exp(-tau * KAPPA);
}

/** Soft shadow of the head itself (sphere-traced SDF, penumbra ~ k·d/t). */
function headVisibility(sdf: SdfGrid, x: number, y: number, z: number, lx: number, ly: number, lz: number, start: number): number {
  let vis = 1;
  let t = start;
  for (let i = 0; i < 28 && t < 0.3; i++) {
    const d = sampleSdf(sdf, x + lx * t, y + ly * t, z + lz * t);
    if (d < 0.0004) return 0;
    if (d > 0.5) break; // left the grid: nothing else to hit
    vis = Math.min(vis, (10 * d) / t);
    t += Math.max(0.004, d * 0.9);
  }
  return Math.max(0, Math.min(1, vis));
}

const to8 = (v: number) => Math.max(0, Math.min(255, Math.round(v * 255)));

/**
 * Per-vertex light visibility (vec4 → the four studio lights) and ambient
 * occlusion for a groom. AO replaces attr.w (the old "layer" heuristic).
 */
export function shadeStrands(d: StrandMeshData, self: DensityGrid, sdf: SdfGrid, lights: Vec3[], center: Vec3): Uint8Array {
  const S = d.strandCount,
    K = d.pointsPerStrand,
    P = d.position;
  const shade = new Uint8Array(S * K * 2 * 4);
  // Shadows vary slowly along a strand (the grid is 3 mm): evaluate ~5 points
  // per strand and interpolate between them.
  const stride = Math.max(1, Math.floor((K - 1) / 4));
  const samples: number[] = [];
  for (let k = 0; k < K; k += stride) samples.push(k);
  if (samples[samples.length - 1] !== K - 1) samples.push(K - 1);
  const val = new Float32Array(samples.length * 5);
  for (let s = 0; s < S; s++) {
    for (let si = 0; si < samples.length; si++) {
      const v = (s * K + samples[si]) * 6;
      const x = P[v],
        y = P[v + 1],
        z = P[v + 2];
      let ox = x - center[0],
        oy = y - center[1],
        oz = z - center[2];
      const ol = Math.hypot(ox, oy, oz) || 1;
      ox /= ol;
      oy /= ol;
      oz /= ol;
      for (let l = 0; l < 4; l++) {
        const [lx, ly, lz] = lights[l];
        const th = hairTransmittance(self, x, y, z, lx, ly, lz, 0.09);
        // The skull can only block lights that are behind this point.
        const behind = ox * lx + oy * ly + oz * lz < 0.35;
        val[si * 5 + l] = th > 0.01 && behind ? th * headVisibility(sdf, x, y, z, lx, ly, lz, 0.004) : th;
      }
      // AO: how deep the point sits in the groom (outwards from the skull centre).
      val[si * 5 + 4] = 0.25 + 0.75 * hairTransmittance(self, x, y, z, ox, oy + 0.3, oz, 0.05);
    }
    for (let k = 0; k < K; k++) {
      let si = 0;
      while (si < samples.length - 2 && samples[si + 1] <= k) si++;
      const k0 = samples[si],
        k1 = samples[Math.min(samples.length - 1, si + 1)];
      const f = k1 > k0 ? (k - k0) / (k1 - k0) : 0;
      const pi = s * K + k;
      for (let side = 0; side < 2; side++) {
        const o = (pi * 2 + side) * 4;
        for (let c = 0; c < 4; c++) shade[o + c] = to8(val[si * 5 + c] + (val[(si + 1 < samples.length ? si + 1 : si) * 5 + c] - val[si * 5 + c]) * f);
        d.attr[o + 3] = to8(val[si * 5 + 4] + (val[(si + 1 < samples.length ? si + 1 : si) * 5 + 4] - val[si * 5 + 4]) * f);
      }
    }
  }
  return shade;
}

/**
 * Skin: visibility of each studio light (groom shadow × soft head shadow)
 * and ambient occlusion (SDF cavities × groom cover).
 */
export function shadeSkin(
  positions: Float32Array,
  normals: Float32Array,
  hair: DensityGrid,
  sdf: SdfGrid,
  lights: Vec3[],
): { vis: Uint8Array; ao: Uint8Array } {
  const n = positions.length / 3;
  const vis = new Uint8Array(n * 4);
  const ao = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const nx = normals[i * 3],
      ny = normals[i * 3 + 1],
      nz = normals[i * 3 + 2];
    const x = positions[i * 3] + nx * 0.0012,
      y = positions[i * 3 + 1] + ny * 0.0012,
      z = positions[i * 3 + 2] + nz * 0.0012;
    for (let l = 0; l < 4; l++) {
      const [lx, ly, lz] = lights[l];
      const facing = nx * lx + ny * ly + nz * lz;
      const th = hairTransmittance(hair, x, y, z, lx, ly, lz, 0.1, 0.3);
      // Back-facing skin keeps only the groom term so wrapped (SSS) light still fades naturally.
      vis[i * 4 + l] = to8(facing > 0.05 ? th * headVisibility(sdf, x, y, z, lx, ly, lz, 0.006) : th);
    }
    // SDF ambient occlusion (Quilez), sampled along the normal.
    let occ = 0;
    let w = 1;
    for (const h of [0.004, 0.009, 0.016, 0.026, 0.04]) {
      const dd = sampleSdf(sdf, x + nx * h, y + ny * h, z + nz * h);
      occ += w * Math.max(0, h - dd);
      w *= 0.62;
    }
    const cav = Math.max(0, Math.min(1, 1 - 9 * occ));
    const cover = hairTransmittance(hair, x, y, z, nx, ny, nz, 0.06, 0.3);
    ao[i] = to8(cav * (0.35 + 0.65 * cover));
  }
  return { vis, ao };
}
