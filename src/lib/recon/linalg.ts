/**
 * Small, dependency-free linear algebra for on-device reconstruction.
 * Point sets are flat Float64Array/number[] of xyz triplets.
 */

export type Mat3 = [number, number, number, number, number, number, number, number, number]; // row-major

export interface Similarity {
  s: number;
  R: Mat3;
  t: [number, number, number];
}

/** Jacobi eigen-decomposition of a symmetric 3×3 (or 4×4) matrix. */
export function jacobiEigen(A: number[][], iters = 60): { values: number[]; vectors: number[][] } {
  const n = A.length;
  const a = A.map((r) => r.slice());
  const v: number[][] = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)));
  for (let it = 0; it < iters; it++) {
    let p = 0,
      q = 1,
      max = 0;
    for (let i = 0; i < n; i++)
      for (let j = i + 1; j < n; j++)
        if (Math.abs(a[i][j]) > max) {
          max = Math.abs(a[i][j]);
          p = i;
          q = j;
        }
    if (max < 1e-15) break;
    const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
    const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
    const c = 1 / Math.sqrt(t * t + 1),
      s = t * c;
    for (let k = 0; k < n; k++) {
      const akp = a[k][p],
        akq = a[k][q];
      a[k][p] = c * akp - s * akq;
      a[k][q] = s * akp + c * akq;
    }
    for (let k = 0; k < n; k++) {
      const apk = a[p][k],
        aqk = a[q][k];
      a[p][k] = c * apk - s * aqk;
      a[q][k] = s * apk + c * aqk;
    }
    for (let k = 0; k < n; k++) {
      const vkp = v[k][p],
        vkq = v[k][q];
      v[k][p] = c * vkp - s * vkq;
      v[k][q] = s * vkp + c * vkq;
    }
  }
  return { values: a.map((r, i) => r[i]), vectors: v };
}

/**
 * Weighted Umeyama / Horn similarity: finds s, R, t minimising
 * Σ wᵢ ‖s·R·srcᵢ + t − dstᵢ‖². Uses Horn's quaternion method (always a proper
 * rotation, no SVD needed).
 */
export function similarityAlign(src: ArrayLike<number>, dst: ArrayLike<number>, w?: ArrayLike<number>): Similarity {
  const n = src.length / 3;
  let W = 0;
  const cs = [0, 0, 0],
    cd = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    const wi = w ? w[i] : 1;
    W += wi;
    for (let k = 0; k < 3; k++) {
      cs[k] += wi * src[i * 3 + k];
      cd[k] += wi * dst[i * 3 + k];
    }
  }
  for (let k = 0; k < 3; k++) {
    cs[k] /= W;
    cd[k] /= W;
  }
  const S = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  let varS = 0;
  for (let i = 0; i < n; i++) {
    const wi = w ? w[i] : 1;
    const a = [src[i * 3] - cs[0], src[i * 3 + 1] - cs[1], src[i * 3 + 2] - cs[2]];
    const b = [dst[i * 3] - cd[0], dst[i * 3 + 1] - cd[1], dst[i * 3 + 2] - cd[2]];
    varS += wi * (a[0] * a[0] + a[1] * a[1] + a[2] * a[2]);
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) S[r][c] += wi * a[r] * b[c];
  }
  const [Sxx, Sxy, Sxz] = S[0];
  const [Syx, Syy, Syz] = S[1];
  const [Szx, Szy, Szz] = S[2];
  const N = [
    [Sxx + Syy + Szz, Syz - Szy, Szx - Sxz, Sxy - Syx],
    [Syz - Szy, Sxx - Syy - Szz, Sxy + Syx, Szx + Sxz],
    [Szx - Sxz, Sxy + Syx, -Sxx + Syy - Szz, Syz + Szy],
    [Sxy - Syx, Szx + Sxz, Syz + Szy, -Sxx - Syy + Szz],
  ];
  const { values, vectors } = jacobiEigen(N);
  let best = 0;
  for (let i = 1; i < 4; i++) if (values[i] > values[best]) best = i;
  const [q0, qx, qy, qz] = [vectors[0][best], vectors[1][best], vectors[2][best], vectors[3][best]];
  const R: Mat3 = [
    q0 * q0 + qx * qx - qy * qy - qz * qz,
    2 * (qx * qy - q0 * qz),
    2 * (qx * qz + q0 * qy),
    2 * (qy * qx + q0 * qz),
    q0 * q0 - qx * qx + qy * qy - qz * qz,
    2 * (qy * qz - q0 * qx),
    2 * (qz * qx - q0 * qy),
    2 * (qz * qy + q0 * qx),
    q0 * q0 - qx * qx - qy * qy + qz * qz,
  ];
  // scale = Σ w bᵀ R a / Σ w |a|²
  let num = 0;
  for (let i = 0; i < n; i++) {
    const wi = w ? w[i] : 1;
    const a = [src[i * 3] - cs[0], src[i * 3 + 1] - cs[1], src[i * 3 + 2] - cs[2]];
    const b = [dst[i * 3] - cd[0], dst[i * 3 + 1] - cd[1], dst[i * 3 + 2] - cd[2]];
    const ra = [R[0] * a[0] + R[1] * a[1] + R[2] * a[2], R[3] * a[0] + R[4] * a[1] + R[5] * a[2], R[6] * a[0] + R[7] * a[1] + R[8] * a[2]];
    num += wi * (ra[0] * b[0] + ra[1] * b[1] + ra[2] * b[2]);
  }
  const s = num / varS;
  const t: [number, number, number] = [
    cd[0] - s * (R[0] * cs[0] + R[1] * cs[1] + R[2] * cs[2]),
    cd[1] - s * (R[3] * cs[0] + R[4] * cs[1] + R[5] * cs[2]),
    cd[2] - s * (R[6] * cs[0] + R[7] * cs[1] + R[8] * cs[2]),
  ];
  return { s, R, t };
}

export function applySimilarity(T: Similarity, pts: ArrayLike<number>): Float64Array {
  const n = pts.length / 3;
  const out = new Float64Array(n * 3);
  const { s, R, t } = T;
  for (let i = 0; i < n; i++) {
    const x = pts[i * 3],
      y = pts[i * 3 + 1],
      z = pts[i * 3 + 2];
    out[i * 3] = s * (R[0] * x + R[1] * y + R[2] * z) + t[0];
    out[i * 3 + 1] = s * (R[3] * x + R[4] * y + R[5] * z) + t[1];
    out[i * 3 + 2] = s * (R[6] * x + R[7] * y + R[8] * z) + t[2];
  }
  return out;
}

/** Solves the SPD system A x = b in place via Cholesky (A is n×n row-major). */
export function choleskySolve(A: Float64Array, n: number, rhs: Float64Array[]): Float64Array[] {
  const L = new Float64Array(n * n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let sum = A[i * n + j];
      for (let k = 0; k < j; k++) sum -= L[i * n + k] * L[j * n + k];
      if (i === j) {
        if (sum <= 0) throw new Error("matrix not positive definite");
        L[i * n + i] = Math.sqrt(sum);
      } else L[i * n + j] = sum / L[j * n + j];
    }
  }
  return rhs.map((b) => {
    const y = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      let sum = b[i];
      for (let k = 0; k < i; k++) sum -= L[i * n + k] * y[k];
      y[i] = sum / L[i * n + i];
    }
    const x = new Float64Array(n);
    for (let i = n - 1; i >= 0; i--) {
      let sum = y[i];
      for (let k = i + 1; k < n; k++) sum -= L[k * n + i] * x[k];
      x[i] = sum / L[i * n + i];
    }
    return x;
  });
}

/**
 * Weighted least-squares affine map dst ≈ M·[src;1], M is 3×4 (row-major).
 * `ridge` pulls the solution towards `prior` (e.g. a similarity) to keep it
 * well conditioned on shallow point sets such as a face.
 */
export function fitAffine(
  src: ArrayLike<number>,
  dst: ArrayLike<number>,
  w?: ArrayLike<number>,
  ridge = 0,
  prior?: number[],
): number[] {
  const n = src.length / 3;
  const AtA = new Float64Array(16);
  const Atb = [new Float64Array(4), new Float64Array(4), new Float64Array(4)];
  for (let i = 0; i < n; i++) {
    const wi = w ? w[i] : 1;
    if (wi <= 0) continue;
    const x = [src[i * 3], src[i * 3 + 1], src[i * 3 + 2], 1];
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 4; c++) AtA[r * 4 + c] += wi * x[r] * x[c];
      for (let k = 0; k < 3; k++) Atb[k][r] += wi * x[r] * dst[i * 3 + k];
    }
  }
  if (ridge > 0) {
    for (let d = 0; d < 3; d++) AtA[d * 4 + d] += ridge;
    if (prior) for (let k = 0; k < 3; k++) for (let d = 0; d < 3; d++) Atb[k][d] += ridge * prior[k * 4 + d];
  }
  const sol = choleskySolve(AtA, 4, Atb);
  return [...sol[0], ...sol[1], ...sol[2]];
}

export function applyAffine(M: number[], x: number, y: number, z: number): [number, number, number] {
  return [
    M[0] * x + M[1] * y + M[2] * z + M[3],
    M[4] * x + M[5] * y + M[6] * z + M[7],
    M[8] * x + M[9] * y + M[10] * z + M[11],
  ];
}

export function similarityToAffine(T: Similarity): number[] {
  const { s, R, t } = T;
  return [s * R[0], s * R[1], s * R[2], t[0], s * R[3], s * R[4], s * R[5], t[1], s * R[6], s * R[7], s * R[8], t[2]];
}

/** Inverse-transpose of the 3×3 part of a 3×4 affine (for normals), row-major 3×3. */
export function normalMatrixOf(M: number[]): Mat3 {
  const a = M[0],
    b = M[1],
    c = M[2],
    d = M[4],
    e = M[5],
    f = M[6],
    g = M[8],
    h = M[9],
    i = M[10];
  const A = e * i - f * h,
    B = -(d * i - f * g),
    C = d * h - e * g;
  const det = a * A + b * B + c * C;
  // inverse transpose = cofactor matrix / det
  return [
    A / det,
    B / det,
    C / det,
    -(b * i - c * h) / det,
    (a * i - c * g) / det,
    -(a * h - b * g) / det,
    (b * f - c * e) / det,
    -(a * f - c * d) / det,
    (a * e - b * d) / det,
  ];
}

/**
 * Gaussian RBF interpolation of vector-valued data on 3D centres.
 * Returns an evaluator f(x,y,z) → value[dim].
 */
export function fitRbf(centres: ArrayLike<number>, values: ArrayLike<number>, dim: number, sigma: number, lambda: number, w?: ArrayLike<number>) {
  const n = centres.length / 3;
  const K = new Float64Array(n * n);
  const inv = 1 / (sigma * sigma);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      const dx = centres[i * 3] - centres[j * 3],
        dy = centres[i * 3 + 1] - centres[j * 3 + 1],
        dz = centres[i * 3 + 2] - centres[j * 3 + 2];
      const k = Math.exp(-(dx * dx + dy * dy + dz * dz) * inv);
      K[i * n + j] = k;
      K[j * n + i] = k;
    }
    // Low-confidence samples get more smoothing.
    const wi = w ? Math.max(w[i], 1e-3) : 1;
    K[i * n + i] += lambda / wi;
  }
  const rhs = Array.from({ length: dim }, (_, d) => {
    const b = new Float64Array(n);
    for (let i = 0; i < n; i++) b[i] = values[i * dim + d];
    return b;
  });
  const weights = choleskySolve(K, n, rhs);
  return (x: number, y: number, z: number, out: number[]) => {
    for (let d = 0; d < dim; d++) out[d] = 0;
    for (let j = 0; j < n; j++) {
      const dx = x - centres[j * 3],
        dy = y - centres[j * 3 + 1],
        dz = z - centres[j * 3 + 2];
      const r2 = (dx * dx + dy * dy + dz * dz) * inv;
      if (r2 > 16) continue;
      const k = Math.exp(-r2);
      for (let d = 0; d < dim; d++) out[d] += weights[d][j] * k;
    }
    return out;
  };
}
