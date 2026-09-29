/**
 * Head rig: anatomical frame + landmark set for a head mesh.
 *
 * Coordinate convention (all heads, all pipelines): metres, +Y up, +Z out of
 * the face, +X towards the subject's LEFT (i.e. screen-right when looking at
 * the face). Origin = cranium centre. This is what lets a single procedural
 * hairstyle, beard or pair of glasses fit any reconstructed head.
 *
 * This module is pure math (no three.js) so it runs in workers and tests.
 */

export type Vec3 = [number, number, number];

/** MediaPipe Face Mesh landmark indices we rely on. */
export const LM = {
  foreheadTop: 10,
  glabella: 9,
  sellion: 168,
  noseBridge: 6,
  noseTip: 1,
  subnasale: 2,
  upperLip: 0,
  lowerLip: 17,
  mouthR: 61, // subject's right corner (screen-left)
  mouthL: 291,
  chin: 152,
  cheekR: 234, // face edge near right ear (screen-left)
  cheekL: 454,
  templeR: 127,
  templeL: 356,
  foreheadR: 54,
  foreheadL: 284,
  eyeROuter: 33,
  eyeRInner: 133,
  eyeLOuter: 263,
  eyeLInner: 362,
  eyeRUpper: 159,
  eyeRLower: 145,
  eyeLUpper: 386,
  eyeLLower: 374,
  irisR: 468,
  irisL: 473,
  browR: 105,
  browL: 334,
  jawR: 172,
  jawL: 397,
} as const;

export const FACE_OVAL = [
  10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136,
  172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109,
];
/** Lower half of the oval, ear to ear through the chin. */
export const JAW_LINE = [234, 93, 132, 58, 172, 136, 150, 149, 176, 148, 152, 377, 400, 378, 379, 365, 397, 288, 361, 323, 454];
export const LIPS_OUTER = [61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291, 409, 270, 269, 267, 0, 37, 39, 40, 185];
export const EYE_R = [33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246];
export const EYE_L = [263, 249, 390, 373, 374, 380, 381, 382, 362, 398, 384, 385, 386, 387, 388, 466];
export const BROW_R = [46, 53, 52, 65, 55, 70, 63, 105, 66, 107];
export const BROW_L = [276, 283, 282, 295, 285, 300, 293, 334, 296, 336];

/** Azimuths (radians) of the hairline control points, 0 = front, +π/2 = subject's left. */
export const HAIRLINE_AZIMUTHS_DEG = [0, 30, 50, 75, 88, 102, 122, 150, 180] as const;

export interface HeadRig {
  version: 1;
  /** 478 × 3 landmark positions in head space (metres). */
  landmarks: number[];
  /** Cranium ellipsoid centre (origin of the head frame, so ~[0,0,0]). */
  center: Vec3;
  radii: Vec3;
  /** Hairline elevation (radians) at HAIRLINE_AZIMUTHS_DEG, mirrored for −azimuths. */
  hairline: number[];
  /** Mesh-space → head-space transform used when the rig was built (column-major 4×4). */
  meshToHead: number[];
}

export function lmk(rig: Pick<HeadRig, "landmarks">, i: number): Vec3 {
  const l = rig.landmarks;
  return [l[i * 3], l[i * 3 + 1], l[i * 3 + 2]];
}

// --- tiny vector helpers (allocation-light, worker safe) ---------------------
export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const len = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
export const mid = (a: Vec3, b: Vec3): Vec3 => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
export const lerp3 = (a: Vec3, b: Vec3, t: number): Vec3 => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];
export const normalize = (a: Vec3): Vec3 => {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
export const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

export const clamp = (x: number, a: number, b: number) => (x < a ? a : x > b ? b : x);
export const smoothstep = (e0: number, e1: number, x: number) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};
export const mix = (a: number, b: number, t: number) => a + (b - a) * t;

/** Azimuth/elevation of a head-space point relative to the cranium centre. */
export function sphericalOf(p: Vec3, center: Vec3): { az: number; el: number; r: number } {
  const d = sub(p, center);
  const r = len(d) || 1e-9;
  return { az: Math.atan2(d[0], d[2]), el: Math.asin(clamp(d[1] / r, -1, 1)), r };
}

/** Periodic Catmull-Rom interpolation of the hairline at azimuth `az`. */
export function hairlineAt(rig: Pick<HeadRig, "hairline">, az: number, recession = 0): number {
  const knotsDeg = HAIRLINE_AZIMUTHS_DEG;
  const a = Math.abs((az * 180) / Math.PI); // symmetric
  let i = 0;
  while (i < knotsDeg.length - 2 && a > knotsDeg[i + 1]) i++;
  const a0 = knotsDeg[i];
  const a1 = knotsDeg[i + 1];
  const t = clamp((a - a0) / (a1 - a0), 0, 1);
  const v = (k: number) => {
    // mirror across 0 and 180 to keep the curve periodic & symmetric
    if (k < 0) return rig.hairline[-k];
    if (k >= knotsDeg.length) return rig.hairline[2 * (knotsDeg.length - 1) - k];
    return rig.hairline[k];
  };
  const p0 = v(i - 1),
    p1 = v(i),
    p2 = v(i + 1),
    p3 = v(i + 2);
  const t2 = t * t,
    t3 = t2 * t;
  let el = 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
  if (recession > 0) {
    // Norwood-style: temples recede first, then the front line.
    const temple = Math.exp(-Math.pow((a - 38) / 18, 2));
    const front = Math.exp(-Math.pow(a / 30, 2));
    el += recession * (0.34 * temple + 0.16 * front);
  }
  return el;
}

/** Normalised scalp height: 0 at the hairline, 1 at the crown. */
export function scalpHeight(el: number, hairlineEl: number): number {
  return clamp((el - hairlineEl) / (Math.PI / 2 - hairlineEl), 0, 1);
}

/**
 * Builds a rig from mesh-space landmarks and the mesh vertices.
 * Returns the rig in head space plus the mesh→head similarity transform.
 */
export function buildRig(
  meshLandmarks: ArrayLike<number>,
  meshPositions: ArrayLike<number>,
  opts: { scale?: number } = {},
): HeadRig {
  const L = (i: number): Vec3 => [meshLandmarks[i * 3], meshLandmarks[i * 3 + 1], meshLandmarks[i * 3 + 2]];

  // 1) Metric scale: given (already-metric reconstructions) or from the
  //    inter-pupillary distance (eye-corner midpoints are robust to closed
  //    eyes; adult mean IPD ≈ 63 mm) for arbitrary-unit templates.
  const eyeR = mid(L(LM.eyeROuter), L(LM.eyeRInner));
  const eyeL = mid(L(LM.eyeLOuter), L(LM.eyeLInner));
  const s = opts.scale ?? 0.063 / len(sub(eyeL, eyeR));

  // 2) Cranium centre: x between the face edges, y slightly above brow line,
  //    z halfway between forehead and back of skull at that height.
  const faceR = L(LM.cheekR);
  const faceL = L(LM.cheekL);
  const brow = mid(L(LM.browR), L(LM.browL));
  const cx = (faceR[0] + faceL[0]) / 2;
  const cy = brow[1] + 0.012 / s;
  const slab = 0.012 / s;
  let zMin = Infinity,
    zMax = -Infinity,
    xAbs = 0,
    yTop = -Infinity;
  const n = meshPositions.length / 3;
  for (let i = 0; i < n; i++) {
    const x = meshPositions[i * 3],
      y = meshPositions[i * 3 + 1],
      z = meshPositions[i * 3 + 2];
    if (Math.abs(x - cx) < 0.03 / s && y > yTop) yTop = y;
    if (Math.abs(y - (cy + 0.03 / s)) < slab) {
      if (Math.abs(x - cx) < 0.02 / s) {
        zMin = Math.min(zMin, z);
        zMax = Math.max(zMax, z);
      }
      xAbs = Math.max(xAbs, Math.abs(x - cx));
    }
  }
  const cz = (zMin + zMax) / 2;
  const centerMesh: Vec3 = [cx, cy, cz];
  const radii: Vec3 = [xAbs * s, (yTop - cy) * s, ((zMax - zMin) / 2) * s];

  // meshToHead: p_head = s * (p_mesh - centerMesh)
  const meshToHead = [s, 0, 0, 0, 0, s, 0, 0, 0, 0, s, 0, -s * cx, -s * cy, -s * cz, 1];
  const toHead = (p: Vec3): Vec3 => scale(sub(p, centerMesh), s);

  const landmarks: number[] = new Array(meshLandmarks.length);
  for (let i = 0; i < meshLandmarks.length / 3; i++) {
    const p = toHead(L(i));
    landmarks[i * 3] = p[0];
    landmarks[i * 3 + 1] = p[1];
    landmarks[i * 3 + 2] = p[2];
  }

  const rig: HeadRig = {
    version: 1,
    landmarks,
    center: [0, 0, 0],
    radii,
    hairline: [],
    meshToHead,
  };
  rig.hairline = estimateHairline(rig);
  return rig;
}

/**
 * Anatomical hairline from landmarks. Values are elevations (radians) at
 * HAIRLINE_AZIMUTHS_DEG. The rules follow average male hairline anatomy:
 * frontal line ~1.5 cm above landmark 10, higher at the temples, sideburns
 * down to mid-ear, clearing the ear, then dropping to the nape at mouth level.
 */
export function estimateHairline(rig: Pick<HeadRig, "landmarks" | "center" | "radii">): number[] {
  const c = rig.center;
  const el = (p: Vec3) => sphericalOf(p, c).el;
  const top = el(lmk(rig, LM.foreheadTop));
  const forehead = el(mid(lmk(rig, LM.foreheadR), lmk(rig, LM.foreheadL)));
  const temple = el(mid(lmk(rig, LM.templeR), lmk(rig, LM.templeL)));
  const brow = el(mid(lmk(rig, LM.browR), lmk(rig, LM.browL)));
  const mouthY = lmk(rig, LM.upperLip)[1];
  const nape = Math.asin(clamp((mouthY - c[1] + 0.012) / (rig.radii[2] * 1.05), -1, 1));
  return [
    top + 0.16, // 0°   frontal hairline ~2 cm above landmark 10
    top + 0.2, // 30°  mild temple recession (M-shape)
    forehead + 0.2, // 50°  temple, sloping down towards the sideburn
    temple + 0.1, // 75°  sideburn
    temple + 0.02, // 88°  sideburn bottom, just in front of the ear
    brow + 0.22, // 102° clears the top of the ear
    temple + 0.05, // 122° descends behind the ear
    nape + 0.08, // 150°
    nape, // 180°  nape at mouth height
  ];
}
