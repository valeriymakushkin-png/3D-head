import { describe, expect, it } from "vitest";
import { applyAffine, applySimilarity, choleskySolve, fitAffine, fitRbf, normalMatrixOf, similarityAlign, type Similarity } from "./linalg";

function rotY(a: number): Similarity["R"] {
  const c = Math.cos(a),
    s = Math.sin(a);
  return [c, 0, s, 0, 1, 0, -s, 0, c];
}

function randomCloud(n: number, seed = 1) {
  let x = seed;
  const rnd = () => ((x = (x * 16807) % 2147483647) / 2147483647) - 0.5;
  return Float64Array.from({ length: n * 3 }, rnd);
}

describe("similarityAlign", () => {
  it("recovers a known similarity transform", () => {
    const src = randomCloud(60);
    const T: Similarity = { s: 1.7, R: rotY(0.6), t: [0.3, -0.2, 1.1] };
    const dst = applySimilarity(T, src);
    const est = similarityAlign(src, dst);
    expect(est.s).toBeCloseTo(1.7, 6);
    est.R.forEach((v, i) => expect(v).toBeCloseTo(T.R[i], 6));
    est.t.forEach((v, i) => expect(v).toBeCloseTo(T.t[i], 6));
  });

  it("ignores zero-weight outliers", () => {
    const src = randomCloud(40, 7);
    const T: Similarity = { s: 0.5, R: rotY(-1.1), t: [0, 0.5, 0] };
    const dst = applySimilarity(T, src);
    const w = new Float64Array(40).fill(1);
    for (let i = 0; i < 5; i++) {
      dst[i * 3] += 10;
      w[i] = 0;
    }
    const est = similarityAlign(src, dst, w);
    expect(est.s).toBeCloseTo(0.5, 6);
  });
});

describe("fitAffine", () => {
  it("fits an exact affine map", () => {
    const src = randomCloud(30, 3);
    const M = [1.2, 0.1, 0, 0.5, -0.1, 0.9, 0.2, -1, 0, 0.05, 1.1, 2];
    const dst = new Float64Array(90);
    for (let i = 0; i < 30; i++) dst.set(applyAffine(M, src[i * 3], src[i * 3 + 1], src[i * 3 + 2]), i * 3);
    const est = fitAffine(src, dst);
    est.forEach((v, i) => expect(v).toBeCloseTo(M[i], 6));
  });

  it("normal matrix is the inverse transpose", () => {
    const M = [2, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0.5, 0];
    const N = normalMatrixOf(M);
    expect(N[0]).toBeCloseTo(0.5);
    expect(N[4]).toBeCloseTo(1);
    expect(N[8]).toBeCloseTo(2);
  });
});

describe("cholesky & rbf", () => {
  it("solves an SPD system", () => {
    const A = Float64Array.from([4, 1, 1, 3]);
    const [x] = choleskySolve(A, 2, [Float64Array.from([1, 2])]);
    expect(4 * x[0] + x[1]).toBeCloseTo(1);
    expect(x[0] + 3 * x[1]).toBeCloseTo(2);
  });

  it("interpolates data at the centres and decays far away", () => {
    const c = Float64Array.from([0, 0, 0, 0.02, 0, 0, 0, 0.02, 0]);
    const v = Float64Array.from([1, -1, 0.5]);
    const f = fitRbf(c, v, 1, 0.02, 1e-9);
    const out = [0];
    expect(f(0, 0, 0, out)[0]).toBeCloseTo(1, 4);
    expect(f(0.02, 0, 0, out)[0]).toBeCloseTo(-1, 4);
    expect(Math.abs(f(1, 1, 1, out)[0])).toBeLessThan(1e-6);
  });
});
