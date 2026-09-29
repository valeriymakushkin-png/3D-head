import { type Similarity, applySimilarity, similarityAlign } from "@/lib/recon/linalg";

/**
 * Multi-view landmark fusion.
 *
 * Each view gives 478 landmarks as a weak-perspective 3D shape in image
 * units. We remove pose and scale per view with a weighted similarity
 * (Horn), weight every landmark by how squarely it faces that camera
 * (occluded / grazing landmarks are regressed, not observed), and average in
 * a generalised-Procrustes loop. Side views contribute depth (nose
 * projection, jaw, cheekbones); the frontal view contributes width.
 */

/** Landmarks used for the first, pose-only alignment (rigid & well defined). */
const STABLE = [1, 4, 6, 168, 197, 33, 133, 263, 362, 61, 291, 152, 10, 199, 2, 98, 327];
const N_LM = 478;
const IRIS_DIAMETER_M = 0.0117;

export interface ViewLandmarks {
  /** 478 × 3 normalised (x, y, z) from MediaPipe. */
  landmarks: ArrayLike<number>;
  width: number;
  height: number;
  yaw: number;
}

export interface FusionResult {
  fused: Float64Array;
  views: Array<{ sim: Similarity; weights: Float64Array; points: Float64Array }>;
  metricScale: number;
  rmsError: number;
}

/** Image-space 3D points: x right, y up, z towards the camera (pixels). */
export function toImageSpace(v: Pick<ViewLandmarks, "landmarks" | "width" | "height">): Float64Array {
  const out = new Float64Array(N_LM * 3);
  for (let i = 0; i < N_LM; i++) {
    out[i * 3] = v.landmarks[i * 3] * v.width;
    out[i * 3 + 1] = -v.landmarks[i * 3 + 1] * v.height;
    out[i * 3 + 2] = -v.landmarks[i * 3 + 2] * v.width;
  }
  return out;
}

function subset(pts: ArrayLike<number>, idx: number[]) {
  const out = new Float64Array(idx.length * 3);
  idx.forEach((i, k) => {
    out[k * 3] = pts[i * 3];
    out[k * 3 + 1] = pts[i * 3 + 1];
    out[k * 3 + 2] = pts[i * 3 + 2];
  });
  return out;
}

/** Visibility weight of each landmark given the view rotation (camera→template). */
function visibilityWeights(sim: Similarity, templateNormals: ArrayLike<number>, frontal: boolean): Float64Array {
  const R = sim.R;
  const w = new Float64Array(N_LM);
  for (let i = 0; i < N_LM; i++) {
    const nx = templateNormals[i * 3],
      ny = templateNormals[i * 3 + 1],
      nz = templateNormals[i * 3 + 2];
    // camera-frame normal = Rᵀ n ; we need its z component (towards camera)
    const zc = R[2] * nx + R[5] * ny + R[8] * nz;
    const v = Math.max(0, zc);
    w[i] = (Math.pow(v, 1.5) + 0.02) * (frontal ? 1.5 : 1);
  }
  return w;
}

export function fuseLandmarks(
  views: ViewLandmarks[],
  template: ArrayLike<number>,
  templateNormals: ArrayLike<number>,
): FusionResult {
  if (!views.length) throw new Error("no views to fuse");
  const pts = views.map(toImageSpace);
  const tStable = subset(template, STABLE);
  const fIdx = frontalIndex(views);
  const perView = pts.map((p, k) => {
    const sim = similarityAlign(subset(p, STABLE), tStable);
    return { sim, weights: visibilityWeights(sim, templateNormals, k === fIdx), points: p };
  });

  let mean: Float64Array = Float64Array.from(template);
  for (let iter = 0; iter < 4; iter++) {
    const acc = new Float64Array(N_LM * 3);
    const wsum = new Float64Array(N_LM);
    for (const [k, v] of perView.entries()) {
      v.sim = similarityAlign(v.points, mean, v.weights);
      v.weights = visibilityWeights(v.sim, templateNormals, k === fIdx);
      const aligned = applySimilarity(v.sim, v.points);
      for (let i = 0; i < N_LM; i++) {
        const w = v.weights[i];
        wsum[i] += w;
        acc[i * 3] += w * aligned[i * 3];
        acc[i * 3 + 1] += w * aligned[i * 3 + 1];
        acc[i * 3 + 2] += w * aligned[i * 3 + 2];
      }
    }
    const next = new Float64Array(N_LM * 3);
    for (let i = 0; i < N_LM; i++) {
      const w = wsum[i] || 1;
      next[i * 3] = acc[i * 3] / w;
      next[i * 3 + 1] = acc[i * 3 + 1] / w;
      next[i * 3 + 2] = acc[i * 3 + 2] / w;
    }
    // keep the mean anchored in the template frame (no drift in pose/scale)
    mean = applySimilarity(similarityAlign(next, template), next);
  }

  // Metric scale from the iris (≈ 11.7 mm across adults), clamped.
  let irisSum = 0,
    irisN = 0;
  perView.forEach((v, k) => {
    if (Math.abs(views[k].yaw) > 20) return;
    for (const [a, b] of [
      [469, 471],
      [474, 476],
    ]) {
      const dx = v.points[a * 3] - v.points[b * 3],
        dy = v.points[a * 3 + 1] - v.points[b * 3 + 1];
      irisSum += Math.hypot(dx, dy) * v.sim.s;
      irisN++;
    }
  });
  // Implausible estimates (closed eyes, glasses glare) fall back to the template scale.
  const rawScale = irisN ? IRIS_DIAMETER_M / (irisSum / irisN) : 1;
  const metricScale = rawScale < 0.85 || rawScale > 1.15 ? 1 : Math.min(1.08, Math.max(0.92, rawScale));

  let err = 0,
    errW = 0;
  for (const v of perView) {
    const aligned = applySimilarity(v.sim, v.points);
    for (let i = 0; i < N_LM; i++) {
      const d = Math.hypot(aligned[i * 3] - mean[i * 3], aligned[i * 3 + 1] - mean[i * 3 + 1], aligned[i * 3 + 2] - mean[i * 3 + 2]);
      err += v.weights[i] * d * d;
      errW += v.weights[i];
    }
  }
  return { fused: mean, views: perView, metricScale, rmsError: Math.sqrt(err / errW) };
}

function frontalIndex(views: ViewLandmarks[]) {
  let best = 0;
  views.forEach((v, i) => {
    if (Math.abs(v.yaw) < Math.abs(views[best].yaw)) best = i;
  });
  return best;
}
