import type { CaptureFrame, FrameQuality, PoseBinId } from "@/lib/recon/types";

/**
 * Capture plan. Yaw > 0 = the subject turned towards THEIR left. The Instant
 * Twin needs the 7 core views; the two profiles feed the HD (server) twin.
 */
export interface PoseTarget {
  id: PoseBinId;
  yaw: number;
  pitch: number;
  tolerance: number;
  required: boolean;
  instruction: string;
}

export const POSE_TARGETS: PoseTarget[] = [
  { id: "front", yaw: 0, pitch: 0, tolerance: 8, required: true, instruction: "Look straight at the camera" },
  { id: "left30", yaw: 28, pitch: 0, tolerance: 9, required: true, instruction: "Slowly turn to your left" },
  { id: "left55", yaw: 52, pitch: 0, tolerance: 10, required: true, instruction: "A little further left" },
  { id: "right30", yaw: -28, pitch: 0, tolerance: 9, required: true, instruction: "Now slowly turn to your right" },
  { id: "right55", yaw: -52, pitch: 0, tolerance: 10, required: true, instruction: "A little further right" },
  { id: "up", yaw: 0, pitch: -16, tolerance: 8, required: true, instruction: "Tilt your chin up" },
  { id: "down", yaw: 0, pitch: 16, tolerance: 8, required: true, instruction: "Tilt your chin down" },
  { id: "left80", yaw: 72, pitch: 0, tolerance: 12, required: false, instruction: "Show your left profile" },
  { id: "right80", yaw: -72, pitch: 0, tolerance: 12, required: false, instruction: "Show your right profile" },
];

export const REQUIRED_BINS = POSE_TARGETS.filter((p) => p.required).map((p) => p.id);

/** Nearest pose bin within tolerance, or null. */
export function binForPose(yaw: number, pitch: number): PoseTarget | null {
  let best: PoseTarget | null = null;
  let bestD = Infinity;
  for (const t of POSE_TARGETS) {
    const dy = Math.abs(yaw - t.yaw),
      dp = Math.abs(pitch - t.pitch);
    if (dy > t.tolerance || dp > t.tolerance * 1.3) continue;
    const d = dy * dy + dp * dp;
    if (d < bestD) {
      bestD = d;
      best = t;
    }
  }
  return best;
}

/** Keeps the best frame per bin. */
export function mergeFrame(bins: Map<PoseBinId, CaptureFrame>, f: CaptureFrame): boolean {
  const cur = bins.get(f.bin);
  if (!cur || f.quality.score > cur.quality.score + 0.02) {
    bins.set(f.bin, f);
    return true;
  }
  return false;
}

export function scoreQuality(q: Omit<FrameQuality, "score" | "issues">, poseError: number): FrameQuality {
  const issues: FrameQuality["issues"] = [];
  if (q.sharpness < 35) issues.push("blurry");
  if (q.brightness < 55) issues.push("dark");
  if (q.brightness > 215) issues.push("bright");
  if (q.faceScale < 0.22) issues.push("small");
  if (poseError > 12) issues.push("far-angle");
  const sharp = Math.min(1, q.sharpness / 160);
  const light = 1 - Math.min(1, Math.abs(q.brightness - 135) / 110);
  const size = Math.min(1, q.faceScale / 0.45);
  const pose = 1 - Math.min(1, poseError / 15);
  const score = 0.4 * sharp + 0.2 * light + 0.15 * size + 0.25 * pose;
  return { ...q, score, issues };
}

/** Measures sharpness & exposure on the face crop (downscaled for speed). */
export function measureFrame(source: CanvasImageSource, width: number, height: number, lm: ArrayLike<number>) {
  let minX = 1,
    minY = 1,
    maxX = 0,
    maxY = 0;
  for (let i = 0; i < 468; i++) {
    const x = lm[i * 3],
      y = lm[i * 3 + 1];
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const sx = Math.max(0, minX * width),
    sy = Math.max(0, minY * height);
  const sw = Math.max(8, (maxX - minX) * width),
    sh = Math.max(8, (maxY - minY) * height);
  const W = 128,
    H = Math.max(8, Math.round((128 * sh) / sw));
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(source, sx, sy, sw, sh, 0, 0, W, H);
  const d = ctx.getImageData(0, 0, W, H).data;
  const g = new Float32Array(W * H);
  let sum = 0;
  for (let i = 0; i < W * H; i++) {
    g[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
    sum += g[i];
  }
  let lapSum = 0,
    lapSq = 0,
    n = 0;
  for (let y = 1; y < H - 1; y++)
    for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      const l = g[i - 1] + g[i + 1] + g[i - W] + g[i + W] - 4 * g[i];
      lapSum += l;
      lapSq += l * l;
      n++;
    }
  const mean = lapSum / n;
  return { sharpness: lapSq / n - mean * mean, brightness: sum / (W * H), faceScale: maxY - minY };
}
