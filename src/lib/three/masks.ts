import type { BufferAttribute } from "three";
import type { BeardParams, HairParams } from "@/lib/hair/params";
import { beardMask, scalpCoverage } from "@/lib/hair/regions";
import { BROW_L, BROW_R, EYE_L, EYE_R, type HeadRig, LIPS_OUTER, LM, type Vec3, lmk, smoothstep } from "@/lib/head/rig";

type Poly = Array<[number, number]>;

function poly(rig: HeadRig, ids: number[]): Poly {
  return ids.map((i) => {
    const p = lmk(rig, i);
    return [p[0], p[1]];
  });
}

function inside(x: number, y: number, pts: Poly) {
  let c = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi + 1e-12) + xi) c = !c;
  }
  return c;
}

function distToPoly(x: number, y: number, pts: Poly) {
  let d = Infinity;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [ax, ay] = pts[j];
    const [bx, by] = pts[i];
    const vx = bx - ax,
      vy = by - ay;
    const t = Math.max(0, Math.min(1, ((x - ax) * vx + (y - ay) * vy) / (vx * vx + vy * vy + 1e-12)));
    d = Math.min(d, Math.hypot(x - ax - vx * t, y - ay - vy * t));
  }
  return inside(x, y, pts) ? 0 : d;
}

/**
 * Eyes (with lids and lashes) and mouth, for the texture bake: these change
 * between photos (blinks, smiles), so they are taken from the front photo only.
 */
export function expressionMask(positions: ArrayLike<number>, landmarks: ArrayLike<number>): Float32Array {
  const n = positions.length / 3;
  const out = new Float32Array(n);
  const rig = { landmarks } as Pick<HeadRig, "landmarks">;
  const eyes = [poly(rig as HeadRig, EYE_R), poly(rig as HeadRig, EYE_L)];
  const lips = poly(rig as HeadRig, LIPS_OUTER);
  const frontZ = lmk(rig, LM.cheekR)[2] - 0.01;
  for (let i = 0; i < n; i++) {
    const x = positions[i * 3],
      y = positions[i * 3 + 1],
      z = positions[i * 3 + 2];
    if (z < frontZ) continue;
    const de = Math.min(distToPoly(x, y, eyes[0]), distToPoly(x, y, eyes[1]));
    const dm = distToPoly(x, y, lips);
    out[i] = Math.max(1 - smoothstep(0.004, 0.011, de), 1 - smoothstep(0.003, 0.01, dm));
  }
  return out;
}

export interface StaticMasks {
  beardZone: Float32Array;
  features: Float32Array;
}

/** Masks that depend only on the head, computed once per avatar. */
export function computeStaticMasks(positions: ArrayLike<number>, rig: HeadRig): StaticMasks {
  const n = positions.length / 3;
  const beardZone = new Float32Array(n);
  const features = new Float32Array(n);
  const polys = [poly(rig, EYE_R), poly(rig, EYE_L), poly(rig, BROW_R), poly(rig, BROW_L), poly(rig, LIPS_OUTER)];
  const frontZ = lmk(rig, LM.cheekR)[2] - 0.01;
  const zone: BeardParams = {
    region: "full",
    length: 0.02,
    density: 1,
    shadow: 1,
    curl: 0,
    neckDrop: 0.03,
    strandWidth: 0,
  };
  const p: Vec3 = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    p[0] = positions[i * 3];
    p[1] = positions[i * 3 + 1];
    p[2] = positions[i * 3 + 2];
    beardZone[i] = beardMask(rig, zone, p);
    if (p[2] > frontZ) {
      let d = Infinity;
      for (const pl of polys) d = Math.min(d, distToPoly(p[0], p[1], pl));
      features[i] = 1 - smoothstep(0.0015, 0.006, d);
    }
  }
  return { beardZone, features };
}

/** Writes the dynamic masks for the current hairstyle and beard. */
export function writeMasks(
  attr: BufferAttribute,
  positions: ArrayLike<number>,
  rig: HeadRig,
  statics: StaticMasks,
  hair: HairParams | null,
  beard: BeardParams | null,
) {
  const n = positions.length / 3;
  const arr = attr.array as Float32Array;
  const p: Vec3 = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    p[0] = positions[i * 3];
    p[1] = positions[i * 3 + 1];
    p[2] = positions[i * 3 + 2];
    arr[i * 4] = beard ? beardMask(rig, beard, p) : 0;
    arr[i * 4 + 1] = statics.beardZone[i];
    arr[i * 4 + 2] = hair ? scalpCoverage(rig, hair, p) : 0;
    arr[i * 4 + 3] = statics.features[i];
  }
  attr.needsUpdate = true;
}
