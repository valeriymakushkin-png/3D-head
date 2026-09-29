import type { Vec3 } from "@/lib/head/rig";

/** Dense signed-distance grid of the head surface (metres, positive outside). */
export interface SdfGrid {
  min: Vec3;
  cell: number;
  dims: [number, number, number];
  data: Float32Array;
}

export function sdfIndex(g: SdfGrid, i: number, j: number, k: number): number {
  return i + g.dims[0] * (j + g.dims[1] * k);
}

/** Trilinear sample; points outside the grid return a large positive distance. */
export function sampleSdf(g: SdfGrid, x: number, y: number, z: number): number {
  const fx = (x - g.min[0]) / g.cell;
  const fy = (y - g.min[1]) / g.cell;
  const fz = (z - g.min[2]) / g.cell;
  const [nx, ny, nz] = g.dims;
  if (fx < 0 || fy < 0 || fz < 0 || fx >= nx - 1 || fy >= ny - 1 || fz >= nz - 1) return 1;
  const i = fx | 0,
    j = fy | 0,
    k = fz | 0;
  const tx = fx - i,
    ty = fy - j,
    tz = fz - k;
  const d = g.data;
  const sx = 1,
    sy = nx,
    sz = nx * ny;
  const o = i + j * sy + k * sz;
  const c00 = d[o] * (1 - tx) + d[o + sx] * tx;
  const c10 = d[o + sy] * (1 - tx) + d[o + sy + sx] * tx;
  const c01 = d[o + sz] * (1 - tx) + d[o + sz + sx] * tx;
  const c11 = d[o + sz + sy] * (1 - tx) + d[o + sz + sy + sx] * tx;
  const c0 = c00 * (1 - ty) + c10 * ty;
  const c1 = c01 * (1 - ty) + c11 * ty;
  return c0 * (1 - tz) + c1 * tz;
}

/** Normalised gradient by central differences (outward surface normal). */
export function sdfGradient(g: SdfGrid, x: number, y: number, z: number, out: Vec3): Vec3 {
  const h = g.cell * 0.5;
  const gx = sampleSdf(g, x + h, y, z) - sampleSdf(g, x - h, y, z);
  const gy = sampleSdf(g, x, y + h, z) - sampleSdf(g, x, y - h, z);
  const gz = sampleSdf(g, x, y, z + h) - sampleSdf(g, x, y, z - h);
  const l = Math.hypot(gx, gy, gz) || 1;
  out[0] = gx / l;
  out[1] = gy / l;
  out[2] = gz / l;
  return out;
}
