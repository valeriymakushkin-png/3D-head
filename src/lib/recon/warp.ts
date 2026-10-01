import { type Similarity, applyAffine, fitRbf, similarityAlign } from "@/lib/recon/linalg";

/**
 * Sculpts the template into the user's head:
 *   1. the head's proportions: a similarity plus a scale per axis (width,
 *      height, depth) — no shear, so the head can't tilt,
 *   2. a Gaussian RBF displacement field through the 468 face landmarks
 *      (nose, lips, eyelids, jaw…), which decays to zero ~6 cm away so the
 *      skull and neck stay smooth.
 * Returns new vertex positions (same topology & UVs as the template).
 */
export function warpTemplate(
  templatePositions: ArrayLike<number>,
  templateLandmarks: ArrayLike<number>,
  target: ArrayLike<number>,
  opts: { sigma?: number; lambda?: number } = {},
): { positions: Float32Array; affine: number[]; residualRms: number } {
  const N = 468; // iris points live inside the eye and would over-constrain
  const T = Float64Array.from({ length: N * 3 }, (_, i) => templateLandmarks[i]);
  const F = Float64Array.from({ length: N * 3 }, (_, i) => target[i]);

  // Proportions without shear: the similarity's rotation, plus one scale per
  // axis of the template's own frame (width, height, depth). A general affine
  // can also shear, which tilts the whole head (a face "looking down") when
  // the fused depth is noisy.
  const sim = similarityAlign(T, F);
  const lab = (globalThis as unknown as { __RECON_LAB__?: { similarityOnly?: boolean } }).__RECON_LAB__ ?? {};
  const affine = lab.similarityOnly
    ? (() => {
        const { s, R, t } = sim;
        return [s * R[0], s * R[1], s * R[2], t[0], s * R[3], s * R[4], s * R[5], t[1], s * R[6], s * R[7], s * R[8], t[2]];
      })()
    : axisScaledSimilarity(T, F, sim);

  const resid = new Float64Array(N * 3);
  let rss = 0;
  const maxR = 0.009;
  for (let i = 0; i < N; i++) {
    const a = applyAffine(affine, T[i * 3], T[i * 3 + 1], T[i * 3 + 2]);
    // MediaPipe depth is regressed, not observed: trust it half as much as x/y.
    let dx = F[i * 3] - a[0],
      dy = F[i * 3 + 1] - a[1],
      dz = (F[i * 3 + 2] - a[2]) * 0.5;
    const m = Math.hypot(dx, dy, dz);
    if (m > maxR) {
      dx *= maxR / m;
      dy *= maxR / m;
      dz *= maxR / m;
    }
    resid[i * 3] = dx;
    resid[i * 3 + 1] = dy;
    resid[i * 3 + 2] = dz;
    rss += dx * dx + dy * dy + dz * dz;
  }
  const field = fitRbf(T, resid, 3, opts.sigma ?? 0.03, opts.lambda ?? 1.5e-2);

  const n = templatePositions.length / 3;
  const out = new Float32Array(n * 3);
  const d = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    const x = templatePositions[i * 3],
      y = templatePositions[i * 3 + 1],
      z = templatePositions[i * 3 + 2];
    const a = applyAffine(affine, x, y, z);
    field(x, y, z, d);
    out[i * 3] = a[0] + d[0];
    out[i * 3 + 1] = a[1] + d[1];
    out[i * 3 + 2] = a[2] + d[2];
  }
  return { positions: out, affine, residualRms: Math.sqrt(rss / N) };
}

/**
 * F ≈ s·R·diag(k)·(T − c) + …: maps F back into the template's frame with the
 * similarity, then fits one scale per axis about the landmarks' centroid.
 * Width and height are trusted (clamped to a human range); depth, regressed
 * by the tracker, only a little.
 */
export function axisScaledSimilarity(T: ArrayLike<number>, F: ArrayLike<number>, sim: Similarity): number[] {
  const { s, R, t } = sim;
  const n = T.length / 3;
  const cT = [0, 0, 0],
    cU = [0, 0, 0];
  const U = new Float64Array(n * 3);
  for (let i = 0; i < n; i++) {
    const dx = F[i * 3] - t[0],
      dy = F[i * 3 + 1] - t[1],
      dz = F[i * 3 + 2] - t[2];
    // Rᵀ (F − t) / s
    U[i * 3] = (R[0] * dx + R[3] * dy + R[6] * dz) / s;
    U[i * 3 + 1] = (R[1] * dx + R[4] * dy + R[7] * dz) / s;
    U[i * 3 + 2] = (R[2] * dx + R[5] * dy + R[8] * dz) / s;
    for (let a = 0; a < 3; a++) {
      cT[a] += T[i * 3 + a] / n;
      cU[a] += U[i * 3 + a] / n;
    }
  }
  const k = [0, 1, 2].map((a) => {
    let num = 0,
      den = 0;
    for (let i = 0; i < n; i++) {
      const p = T[i * 3 + a] - cT[a];
      num += p * (U[i * 3 + a] - cU[a]);
      den += p * p;
    }
    const raw = den > 0 ? num / den : 1;
    return a === 2 ? 1 + (Math.min(1.12, Math.max(0.9, raw)) - 1) * 0.5 : Math.min(1.18, Math.max(0.85, raw));
  });
  // x' = s R (diag(k)(x − cT) + cU) + t
  const M: number[] = [];
  for (let r = 0; r < 3; r++) {
    const row = [R[r * 3] * s * k[0], R[r * 3 + 1] * s * k[1], R[r * 3 + 2] * s * k[2]];
    const off = [cU[0] - k[0] * cT[0], cU[1] - k[1] * cT[1], cU[2] - k[2] * cT[2]];
    const tr = s * (R[r * 3] * off[0] + R[r * 3 + 1] * off[1] + R[r * 3 + 2] * off[2]) + t[r];
    M.push(row[0], row[1], row[2], tr);
  }
  return M;
}
