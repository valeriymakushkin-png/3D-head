import { applyAffine, choleskySolve, normalMatrixOf } from "@/lib/recon/linalg";

/**
 * Photo de-lighting. A phone photo is albedo × the room's light: a lamp to
 * one side, a window behind, a ceiling light that leaves the lower face dark.
 * Baked as-is, that shading fights the studio's own light and reads as dirty,
 * blotchy skin. Skin albedo is roughly uniform across a face, so the smooth
 * part of the shading can be recovered as a function of the surface normal —
 * 2nd-order spherical harmonics fitted to the photographed skin — and divided
 * back out in the bake.
 */
export interface Shading {
  /** 9 SH coefficients (luminance, linear), in the view's camera frame. */
  sh: number[];
  /** Shading level on surfaces facing the camera: the de-lit colour keeps this brightness. */
  ref: number;
}

/** Real SH basis up to order 2 (constants folded into the coefficients). */
export function shBasis(x: number, y: number, z: number, out: number[] = new Array(9)): number[] {
  out[0] = 1;
  out[1] = y;
  out[2] = z;
  out[3] = x;
  out[4] = x * y;
  out[5] = y * z;
  out[6] = 3 * z * z - 1;
  out[7] = x * z;
  out[8] = x * x - y * y;
  return out;
}

const srgbToLin = (v: number) => {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
};

export function fitShading(v: {
  positions: ArrayLike<number>;
  normals: ArrayLike<number>;
  /** Eyes/brows/lips mask per vertex: not skin albedo, left out of the fit. */
  feat: ArrayLike<number>;
  /** Head → image (x right, y up/negative, z towards the camera), 3×4 row-major. */
  affine: number[];
  residual: ArrayLike<number>;
  skinMask: Uint8Array;
  pixels: Uint8ClampedArray;
  width: number;
  height: number;
}): Shading | null {
  const N = normalMatrixOf(v.affine);
  const n = v.positions.length / 3;
  const Y: number[][] = [];
  const L: number[] = [];
  const facing: number[] = [];
  const stride = Math.max(1, Math.floor(n / 6000));
  for (let i = 0; i < n; i += stride) {
    if (v.feat[i] > 0.3) continue;
    const nx0 = v.normals[i * 3],
      ny0 = v.normals[i * 3 + 1],
      nz0 = v.normals[i * 3 + 2];
    let nx = N[0] * nx0 + N[1] * ny0 + N[2] * nz0,
      ny = N[3] * nx0 + N[4] * ny0 + N[5] * nz0,
      nz = N[6] * nx0 + N[7] * ny0 + N[8] * nz0;
    const nl = Math.hypot(nx, ny, nz) || 1;
    nx /= nl;
    ny /= nl;
    nz /= nl;
    if (nz < 0.3) continue;
    const q = applyAffine(v.affine, v.positions[i * 3], v.positions[i * 3 + 1], v.positions[i * 3 + 2]);
    const px = Math.round(q[0] + v.residual[i * 2]),
      py = Math.round(-(q[1] + v.residual[i * 2 + 1]));
    if (px < 2 || py < 2 || px >= v.width - 2 || py >= v.height - 2) continue;
    const o = py * v.width + px;
    if (v.skinMask[o] < 200) continue;
    const lum = 0.2126 * srgbToLin(v.pixels[o * 4]) + 0.7152 * srgbToLin(v.pixels[o * 4 + 1]) + 0.0722 * srgbToLin(v.pixels[o * 4 + 2]);
    if (lum < 0.002 || lum > 0.92) continue; // crushed or clipped: no shading information
    Y.push(shBasis(nx, ny, nz));
    L.push(lum);
    facing.push(nz);
  }
  if (L.length < 150) return null;

  // Least squares with a light ridge; then refit without outliers (moles,
  // stubble, a stray lock of hair, specular highlights).
  let keep = L.map(() => true);
  let sh = new Array(9).fill(0);
  for (let pass = 0; pass < 3; pass++) {
    const A = new Float64Array(81);
    const b = new Float64Array(9);
    let used = 0;
    for (let s = 0; s < L.length; s++) {
      if (!keep[s]) continue;
      used++;
      const y = Y[s];
      for (let r = 0; r < 9; r++) {
        b[r] += y[r] * L[s];
        for (let c = 0; c < 9; c++) A[r * 9 + c] += y[r] * y[c];
      }
    }
    if (used < 100) return null;
    const mean = b[0] / used;
    // Ridge on the higher bands only: a sparse fit must not invent lighting.
    for (let r = 1; r < 9; r++) A[r * 9 + r] += used * (r < 4 ? 0.01 : 0.04);
    sh = Array.from(choleskySolve(A, 9, [b])[0]);
    const res = L.map((l, s) => l - dotY(sh, Y[s]));
    const abs = res.filter((_, s) => keep[s]).map(Math.abs).sort((p, q) => p - q);
    const mad = abs[abs.length >> 1] || mean * 0.1;
    keep = res.map((r) => Math.abs(r) < 3 * mad);
  }
  const front: number[] = [];
  for (let s = 0; s < L.length; s++) if (facing[s] > 0.8) front.push(dotY(sh, Y[s]));
  front.sort((p, q) => p - q);
  const ref = front.length ? front[front.length >> 1] : dotY(sh, shBasis(0, 0, 1));
  if (!(ref > 1e-4)) return null;
  return { sh, ref };
}

function dotY(sh: number[], y: number[]) {
  let s = 0;
  for (let k = 0; k < 9; k++) s += sh[k] * y[k];
  return s;
}
