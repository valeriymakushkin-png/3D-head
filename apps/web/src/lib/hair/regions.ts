import type { BeardParams, HairParams } from "@/lib/hair/params";
import {
  type HeadRig,
  type Vec3,
  JAW_LINE,
  LIPS_OUTER,
  LM,
  clamp,
  hairlineAt,
  lmk,
  mix,
  smoothstep,
  sphericalOf,
} from "@/lib/head/rig";

/**
 * Style-zone height: like `scalpHeight`, but measured from a reference that
 * is constant around the sides (sideburn bottom) and drops to the nape at the
 * back. Fade lines and undercut disconnects are therefore horizontal around
 * the head — as a barber cuts them — instead of following the hairline.
 */
export function zoneHeight(rig: Pick<HeadRig, "hairline">, az: number, el: number): number {
  const side = hairlineAt(rig, (88 * Math.PI) / 180, 0);
  const nape = hairlineAt(rig, Math.PI, 0);
  const b = Math.max(0, -Math.cos(az));
  const ref = mix(side, nape, smoothstep(0.2, 0.9, b));
  return clamp((el - ref) / (Math.PI / 2 - ref), 0, 1);
}

/** Region weights on the scalp for a given azimuth / scalp height. */
export function scalpZones(p: HairParams, az: number, h: number) {
  const f = Math.max(0, Math.cos(az));
  const b = Math.max(0, -Math.cos(az));
  // The top zone reaches down to the hairline at the front (fringe).
  const topZone = mix(p.topZone, 0, Math.pow(f, 1.5));
  const wTop = smoothstep(topZone - p.topBlend, topZone + p.topBlend + 1e-3, h);
  const frontW = smoothstep(0.25, 0.92, f) * (1 - smoothstep(0.3, 0.85, h));
  const napeW = smoothstep(0.45, 1, b) * (1 - smoothstep(0, 0.4, h));
  return { f, b, wTop, frontW, napeW };
}

/** Hair length (metres) at a scalp location for a style. */
export function hairLengthAt(p: HairParams, az: number, h: number): number {
  const z = scalpZones(p, az, h);
  const top = mix(p.topLength, p.frontLength, z.frontW);
  let low = mix(p.sideLength, p.backLength, smoothstep(0.1, 0.9, z.b));
  low = mix(low, p.napeLength, z.napeW);
  if (p.fade > 0) {
    const fadeAmount = p.fade * mix(1, p.backFade, smoothstep(0.2, 0.9, z.b));
    const ramp = smoothstep(p.fadeLow, p.fadeHigh, h);
    low = mix(low, low * ramp, fadeAmount);
  }
  return mix(low, top, z.wTop);
}

/** Hair presence 0..1 at a head-space point (soft hairline, density). */
export function hairPresence(rig: HeadRig, p: HairParams, pt: Vec3): { m: number; az: number; h: number; el: number } {
  const s = sphericalOf(pt, rig.center);
  const hl = hairlineAt(rig, s.az, p.recession);
  const m = smoothstep(hl - 0.025, hl + 0.045, s.el);
  return { m, az: s.az, h: zoneHeight(rig, s.az, s.el), el: s.el };
}

/**
 * Scalp tint coverage for the skin shader: how much the scalp under the hair
 * should be darkened towards the hair colour (fills gaps between strands the
 * way real dense hair does).
 */
export function scalpCoverage(rig: HeadRig, p: HairParams, pt: Vec3): number {
  const { m, az, h } = hairPresence(rig, p, pt);
  if (m <= 0) return 0;
  const L = hairLengthAt(p, az, h);
  const byLength = smoothstep(0, 0.006, L);
  return clamp(m * byLength * p.density, 0, 1);
}

// ---------------------------------------------------------------------------
// Beard
// ---------------------------------------------------------------------------

interface BeardFrame {
  jaw: Vec3[];
  lipsPoly: Array<[number, number]>;
  subnasaleY: number;
  lowerLipY: number;
  mouthHalfW: number;
  mouthY: number;
  chin: Vec3;
  cheekR: Vec3;
  cheekL: Vec3;
  noseTipY: number;
}

const frames = new WeakMap<HeadRig, BeardFrame>();

function beardFrame(rig: HeadRig): BeardFrame {
  let f = frames.get(rig);
  if (f) return f;
  const lipsPoly = LIPS_OUTER.map((i) => {
    const q = lmk(rig, i);
    return [q[0], q[1]] as [number, number];
  });
  const mR = lmk(rig, LM.mouthR);
  const mL = lmk(rig, LM.mouthL);
  f = {
    jaw: JAW_LINE.map((i) => lmk(rig, i)),
    lipsPoly,
    subnasaleY: lmk(rig, LM.subnasale)[1],
    lowerLipY: lmk(rig, LM.lowerLip)[1],
    mouthHalfW: Math.abs(mL[0] - mR[0]) / 2,
    mouthY: (mR[1] + mL[1]) / 2,
    chin: lmk(rig, LM.chin),
    cheekR: lmk(rig, LM.cheekR),
    cheekL: lmk(rig, LM.cheekL),
    noseTipY: lmk(rig, LM.noseTip)[1],
  };
  frames.set(rig, f);
  return f;
}

function pointInPoly(x: number, y: number, poly: Array<[number, number]>): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi + 1e-12) + xi) inside = !inside;
  }
  return inside;
}

/**
 * Beard density 0..1 at a head-space surface point.
 * Upper boundary: a cheek line from the sideburn (at the ear, nose-tip
 * height) curving down to just outside the mouth corners.
 * Lower boundary: the jaw line, extended `neckDrop` metres under the jaw.
 */
export function beardMask(rig: HeadRig, bp: Pick<BeardParams, "region" | "neckDrop">, pt: Vec3): number {
  const f = beardFrame(rig);
  const [x, y, z] = pt;
  if (z < f.cheekR[2] - 0.035) return 0; // behind the ears
  // Lips are never covered.
  if (pointInPoly(x, y, f.lipsPoly)) return 0;

  // Distance below the jaw line (positive when under the jaw).
  let nearest = Infinity;
  let nearestJaw: Vec3 = f.jaw[0];
  for (const j of f.jaw) {
    const d = (j[0] - x) ** 2 + (j[2] - z) ** 2 * 0.6;
    if (d < nearest) {
      nearest = d;
      nearestJaw = j;
    }
  }
  const below = nearestJaw[1] - y;

  const ax = Math.abs(x);
  const cheekHalfW = Math.abs(f.cheekL[0] - f.cheekR[0]) / 2;
  // Cheek line: y_line(ax) from the mouth corner (ax = mouthHalfW*1.3) to the ear.
  const u = clamp((ax - f.mouthHalfW * 1.25) / (cheekHalfW - f.mouthHalfW * 1.25), 0, 1);
  const cheekLineY = mix(f.mouthY + 0.006, f.noseTipY - 0.004, Math.pow(u, 0.7));
  const upper = smoothstep(cheekLineY + 0.004, cheekLineY - 0.006, y);

  // Mustache: between the nose base and the upper lip.
  const inMustache = ax < f.mouthHalfW * 1.25 && y < f.subnasaleY - 0.002 && y > f.mouthY - 0.004;
  const mustache = inMustache ? smoothstep(f.subnasaleY - 0.002, f.subnasaleY - 0.006, y) : 0;

  const neck = bp.neckDrop > 0 ? 1 - smoothstep(bp.neckDrop * 0.6, bp.neckDrop, below) : below > 0.002 ? 0 : 1;

  let m = Math.max(upper, mustache) * neck;

  if (bp.region === "goatee") {
    const w = f.mouthHalfW * 1.28;
    const centre = 1 - smoothstep(w * 0.85, w * 1.05, ax);
    const chinZone = y < f.lowerLipY + 0.002 && below < 0.012;
    m = Math.max(mustache, chinZone ? 1 : 0) * centre;
    // circle beard: connect mustache to chin around the mouth corners
    if (ax > f.mouthHalfW * 0.9 && ax < w && y < f.mouthY + 0.004 && y > f.lowerLipY - 0.02) m = Math.max(m, centre);
  }
  return clamp(m, 0, 1);
}

/** Growth direction for beard hair at a point (tangent-ish, head space). */
export function beardFlow(rig: HeadRig, pt: Vec3): Vec3 {
  const f = beardFrame(rig);
  const [x, y] = pt;
  if (y < f.subnasaleY && y > f.mouthY - 0.004 && Math.abs(x) < f.mouthHalfW * 1.25) {
    // mustache grows down and outward
    return [Math.sign(x) * 0.55, -1, 0.1];
  }
  if (y < f.chin[1] + 0.01) return [0, -0.6, 0.8]; // under the chin: forward/down
  return [Math.sign(x) * 0.12, -1, 0.15];
}
