import { applyAffine, fitAffine, fitRbf, similarityAlign, similarityToAffine } from "@/lib/recon/linalg";

/**
 * Sculpts the template into the user's head:
 *   1. a ridge-regularised affine (head width / height / depth proportions),
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

  const sim = similarityAlign(T, F);
  const prior = similarityToAffine(sim);
  const affine = fitAffine(T, F, undefined, N * 0.0025, prior);

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
