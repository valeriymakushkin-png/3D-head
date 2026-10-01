import type { SegmentedFrame } from "@/lib/recon/analyze";
import { SEG_CLASSES } from "@/lib/recon/mediapipe";

/**
 * Jaw outline from the frontal photo's segmentation.
 *
 * The tracker's 478 landmarks describe the face's *features* well but its
 * *outline* poorly: its contour points are regressed towards an average face,
 * so a wide jaw, full cheeks or a narrow chin barely move them (in tests, a
 * jaw 14 mm wider moved them by < 1 mm). The segmentation, though, sees the
 * actual edge of the face against the background or the neck. Per image row,
 * from the mouth corners to the chin, we compare that edge with the edge of
 * the sculpted head projected through the same camera, and widen or narrow
 * the jaw to match — conservatively (gated against the tracker's contour,
 * limited to −7…+8 %, smoothed), because a misread edge (an ear, a beard, a
 * collar) must never balloon a face.
 */
export interface OutlineFit {
  positions: Float32Array;
  /** Rows used / rows considered, and the mean width ratio (for logs). */
  used: number;
  rows: number;
  meanRatio: number;
}

/**
 * The segmentation's face region runs ~5 % wider than the true outline (its
 * 256² mask is soft at the edges): measured by fitting the template to renders
 * of itself, where the answer is known. Divided out like the landmark bias.
 */
const OUTLINE_BIAS = 1.085;

const OUTSIDE = new Set<number>([SEG_CLASSES.background, SEG_CLASSES.clothes, SEG_CLASSES.other, SEG_CLASSES.bodySkin]);

export function fitFaceOutline(opts: {
  positions: Float32Array;
  index: ArrayLike<number>;
  /** Head space → photo pixels (x right, y down). */
  project: (x: number, y: number, z: number) => [number, number];
  seg: SegmentedFrame;
  /** Fused landmarks in head space (same frame as positions). */
  F: ArrayLike<number>;
  ears?: number[];
  /** Per-row correction limits (a refining pass should only nudge). */
  limit?: [number, number];
}): OutlineFit | null {
  const [kMin, kMax] = opts.limit ?? [0.93, 1.08];
  const { positions, index, project, seg, F } = opts;
  const f = seg.frame;
  const W = f.width,
    H = f.height;
  const L = (i: number) => [f.landmarks[i * 3] * W, f.landmarks[i * 3 + 1] * H];
  const [x168, y168] = L(168);
  const [x152, y152] = L(152);
  const faceH = y152 - L(10)[1];
  if (!(faceH > 40)) return null;
  // The jaw: from the mouth corners down to the chin. Higher up the ears
  // (skin in the segmentation; on many faces the lobes reach the mouth) would
  // read as cheek.
  const y0 = Math.round((L(61)[1] + L(291)[1]) / 2),
    y1 = Math.round(y152 - faceH * 0.03);
  const rows = y1 - y0 + 1;
  if (rows < 20) return null;
  const midAt = (y: number) => x168 + ((x152 - x168) * (y - y168)) / Math.max(1, y152 - y168);

  // The tracker's face contour, per side, as a polyline in the image.
  const OVAL_R = [10, 109, 67, 103, 54, 21, 162, 127, 234, 93, 132, 58, 172, 136, 150, 149, 176, 148, 152];
  const OVAL_L = [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152];
  const contourHalfWidth = (dir: number, y: number, mid: number) => {
    let best = -1;
    for (const ids of [OVAL_R, OVAL_L]) {
      for (let k = 0; k + 1 < ids.length; k++) {
        const [xa, ya] = L(ids[k]);
        const [xb, yb] = L(ids[k + 1]);
        if ((ya - y) * (yb - y) > 0 || ya === yb) continue;
        const x = xa + ((xb - xa) * (y - ya)) / (yb - ya);
        if (Math.sign(x - mid) !== dir) continue;
        best = Math.max(best, Math.abs(x - mid));
      }
    }
    return best;
  };

  // 1) observed half-widths per row (left = image left)
  const cat = seg.categories;
  const obsL = new Float32Array(rows).fill(NaN),
    obsR = new Float32Array(rows).fill(NaN);
  const yMouth = L(13)[1];
  for (let r = 0; r < rows; r++) {
    const y = y0 + r;
    if (y < 0 || y >= H) continue;
    const mid = Math.round(midAt(y));
    for (const dir of [-1, 1]) {
      let x = mid,
        run = 0,
        edge = -1,
        blocked = false;
      for (; x >= 0 && x < W && Math.abs(x - mid) < W * 0.45; x += dir) {
        const c = cat[y * W + x];
        if (OUTSIDE.has(c)) {
          if (++run >= 3) {
            edge = x - dir * 3;
            break;
          }
        } else {
          // Hair at the side of the upper face is a sideburn or a lock over
          // the cheek: the true edge is hidden, skip the row.
          if (c === SEG_CLASSES.hair && y < yMouth && Math.abs(x - mid) > faceH * 0.2) {
            blocked = true;
            break;
          }
          run = 0;
        }
      }
      if (blocked || edge < 0) continue;
      // Gate against the tracker's (smoothed, averaged) outline: an edge far
      // beyond it is an ear, a beard or a collar, not the jaw.
      const ref = contourHalfWidth(dir, y, mid);
      const half = Math.abs(edge - mid);
      if (ref > 0 && (half > ref * 1.12 || half < ref * 0.88)) continue;
      (dir < 0 ? obsL : obsR)[r] = half;
    }
  }

  // 2) the sculpted head's projected outline per row (edges rasterised, ears and the back excluded)
  const n = positions.length / 3;
  const ear = new Uint8Array(n);
  for (const v of opts.ears ?? []) if (v < n) ear[v] = 1;
  const zBack = Math.min(F[234 * 3 + 2], F[454 * 3 + 2]) - 0.015;
  let zEarFront = zBack - 0.03,
    yEarLow = Infinity;
  for (const v of opts.ears ?? []) {
    if (v >= n) continue;
    zEarFront = Math.max(zEarFront, positions[v * 3 + 2]);
    yEarLow = Math.min(yEarLow, positions[v * 3 + 1]);
  }
  const yTopHead = F[168 * 3 + 1];
  const px = new Float32Array(n),
    py = new Float32Array(n);
  const inFace = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const p = project(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]);
    px[i] = p[0];
    py[i] = p[1];
    inFace[i] = !ear[i] && positions[i * 3 + 2] > zBack && positions[i * 3 + 1] < yTopHead ? 1 : 0;
  }
  const modL = new Float32Array(rows).fill(0),
    modR = new Float32Array(rows).fill(0);
  const edgeRow = (a: number, b: number) => {
    const ya = py[a],
      yb = py[b];
    const lo = Math.max(y0, Math.ceil(Math.min(ya, yb))),
      hi = Math.min(y1, Math.floor(Math.max(ya, yb)));
    for (let y = lo; y <= hi; y++) {
      const t = yb === ya ? 0 : (y - ya) / (yb - ya);
      const x = px[a] + (px[b] - px[a]) * t;
      const d = x - midAt(y);
      const r = y - y0;
      if (d < 0) modL[r] = Math.max(modL[r], -d);
      else modR[r] = Math.max(modR[r], d);
    }
  };
  for (let t = 0; t < index.length; t += 3) {
    const a = index[t],
      b = index[t + 1],
      c = index[t + 2];
    if (!inFace[a] || !inFace[b] || !inFace[c]) continue;
    edgeRow(a, b);
    edgeRow(b, c);
    edgeRow(c, a);
  }

  // 3) width ratio per row and side, smoothed; gaps filled from neighbours
  const ratio = (obs: Float32Array, mod: Float32Array) => {
    const raw = new Float32Array(rows).fill(NaN);
    for (let r = 0; r < rows; r++) if (obs[r] > 0 && mod[r] > faceH * 0.15) raw[r] = obs[r] / mod[r] / OUTLINE_BIAS;
    const sigma = Math.max(2, faceH * 0.06);
    const out = new Float32Array(rows).fill(NaN);
    let valid = 0;
    for (let r = 0; r < rows; r++) {
      let s = 0,
        w = 0;
      for (let k = Math.max(0, Math.floor(r - 3 * sigma)); k <= Math.min(rows - 1, Math.ceil(r + 3 * sigma)); k++) {
        if (Number.isNaN(raw[k])) continue;
        const g = Math.exp(-(((k - r) / sigma) ** 2) / 2);
        s += raw[k] * g;
        w += g;
      }
      if (w > 0.8) {
        out[r] = Math.min(kMax, Math.max(kMin, s / w));
        valid++;
      }
    }
    return { out, valid };
  };
  const left = ratio(obsL, modL),
    right = ratio(obsR, modR);
  if (left.valid + right.valid < rows * 0.6) return null;
  const at = (arr: Float32Array, other: Float32Array, r: number) => {
    const rr = Math.min(rows - 1, Math.max(0, Math.round(r)));
    const v = arr[rr];
    if (!Number.isNaN(v)) return v;
    const o = other[rr];
    return Number.isNaN(o) ? 1 : o;
  };

  // 4) move the sides of the head (not the features) to the observed outline
  const out = Float32Array.from(positions);
  const xMid = F[168 * 3];
  let sum = 0,
    cnt = 0;
  for (let r = 0; r < rows; r++) {
    for (const v of [left.out[r], right.out[r]]) {
      if (!Number.isNaN(v)) {
        sum += v;
        cnt++;
      }
    }
  }
  const smooth = (e0: number, e1: number, x: number) => {
    const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
    return t * t * (3 - 2 * t);
  };
  for (let i = 0; i < n; i++) {
    if (ear[i]) continue;
    const r = py[i] - y0;
    // taper up towards the cheekbones (which the landmarks already place) and below the chin
    const band = smooth(-faceH * 0.22, 0, r) * (1 - smooth(rows, rows + faceH * 0.15, r));
    if (band <= 0) continue;
    const side = px[i] < midAt(py[i]) ? -1 : 1;
    const k = side < 0 ? at(left.out, right.out, r) : at(right.out, left.out, r);
    const half = Math.max(1, side < 0 ? modL[Math.min(rows - 1, Math.max(0, Math.round(r)))] : modR[Math.min(rows - 1, Math.max(0, Math.round(r)))]);
    // lateral: the cheeks and jaw move, the nose and mouth don't
    const lat = smooth(0.15, 1.0, Math.abs(px[i] - midAt(py[i])) / half);
    // depth: only in front of the ears (they, and the back of the head, stay put;
    // scaling the skin around an ear but not the ear would tear it)
    const z = positions[i * 3 + 2];
    const besideEar = smooth(yEarLow - 0.012, yEarLow, positions[i * 3 + 1]);
    const depth = besideEar * smooth(zEarFront + 0.004, zEarFront + 0.02, z) + (1 - besideEar) * smooth(zBack - 0.05, zBack - 0.01, z);
    const s = 1 + (k - 1) * band * lat * depth;
    out[i * 3] = xMid + (positions[i * 3] - xMid) * s;
  }
  return { positions: out, used: left.valid + right.valid, rows: rows * 2, meanRatio: cnt ? sum / cnt : 1 };
}
