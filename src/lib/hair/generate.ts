/**
 * Procedural strand hair.
 *
 * Every strand is grown from a root on the real scalp surface of the head
 * (found by ray casting the reconstructed mesh), steered by a per-style flow
 * field, constrained to a volumetric "hair shell" around the head through a
 * signed distance field, curled, and finally clumped towards guide strands —
 * the same guide/child model used by offline groomers (XGen, Ornatrix), cut
 * down to what a phone can regenerate in ~50 ms inside a Web Worker.
 *
 * Output is a ribbon mesh (two vertices per point); the vertex shader expands
 * ribbons towards the camera so strands stay sub-pixel-accurate at any zoom.
 */
import type { BeardParams, HairParams } from "@/lib/hair/params";
import { beardFlow, beardMask, hairLengthAt, scalpZones, zoneHeight } from "@/lib/hair/regions";
import { type SdfGrid, sampleSdf, sdfGradient } from "@/lib/hair/sdf";
import {
  type HeadRig,
  type Vec3,
  clamp,
  cross,
  dot,
  hairlineAt,
  normalize,
  smoothstep,
} from "@/lib/head/rig";

export interface SurfaceSamples {
  count: number;
  pos: Float32Array;
  nrm: Float32Array;
  /** Stable per-sample random in [0,1), used for acceptance so styles share roots. */
  rnd: Float32Array;
}

export interface StrandMeshData {
  position: Float32Array;
  tangent: Int16Array;
  /** Per vertex: t along strand, side (0|255), strand random, occlusion (baked AO). Normalised u8. */
  attr: Uint8Array;
  index: Uint32Array;
  strandCount: number;
  pointsPerStrand: number;
  strandWidth: number;
  /** Per vertex visibility of the four studio lights (baked self-shadowing), u8. */
  shade?: Uint8Array;
  /** Hair only: the head's light visibility / AO with this groom's shadow (per head vertex). */
  skinVis?: Uint8Array;
  skinAO?: Uint8Array;
}

export interface GenerateOptions {
  vertexBudget: number;
  maxStrands: number;
  seed: number;
  /** Strand segment length (m). Real-time uses ~11 mm; offline renders use finer steps. */
  segment?: number;
}

// --- PRNG ------------------------------------------------------------------
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const UP: Vec3 = [0, 1, 0];

function tangentProject(v: Vec3, n: Vec3): Vec3 {
  const d = dot(v, n);
  const t: Vec3 = [v[0] - n[0] * d, v[1] - n[1] * d, v[2] - n[2] * d];
  const l = Math.hypot(t[0], t[1], t[2]);
  if (l < 1e-5) return normalize(cross(n, [1, 0, 0]));
  return [t[0] / l, t[1] / l, t[2] / l];
}

function rotateAround(v: Vec3, axis: Vec3, ang: number): Vec3 {
  const c = Math.cos(ang),
    s = Math.sin(ang);
  const k = axis;
  const kxv = cross(k, v);
  const kdv = dot(k, v);
  return [
    v[0] * c + kxv[0] * s + k[0] * kdv * (1 - c),
    v[1] * c + kxv[1] * s + k[1] * kdv * (1 - c),
    v[2] * c + kxv[2] * s + k[2] * kdv * (1 - c),
  ];
}

function topFlow(p: HairParams, root: Vec3, n: Vec3, rig: HeadRig, frontness: number): Vec3 {
  const sx = root[0] >= 0 ? 1 : -1;
  switch (p.flow) {
    case "forward":
      return [0, -0.25, 1];
    case "back":
      return [0, 0.08, -1];
    case "up":
      return [n[0], n[1], n[2] + 0.15];
    case "down":
      return [n[0] * 0.2, -1, n[2] * 0.2];
    case "side": {
      const partX = p.partX * rig.radii[0];
      const side = root[0] - partX >= 0 ? 1 : -1;
      const near = 1 - smoothstep(0.004, 0.03, Math.abs(root[0] - partX));
      return [side * (0.9 + near * 0.4), -0.2, -0.35 + frontness * 0.2];
    }
    case "middle": {
      // Parted at the front/top only; the back falls straight down.
      const front = smoothstep(0.15, 0.6, frontness);
      return [sx * (0.25 + 0.9 * front), -1 + 0.9 * front, -0.3 - 0.35 * front];
    }
  }
}

function lowFlow(p: HairParams): Vec3 {
  if (p.flow === "forward") return [0, -1, 0.2];
  if (p.gravity > 0.6) return [0, -1, -0.05];
  return [0, -1, -0.4];
}

interface GrowContext {
  rig: HeadRig;
  sdf: SdfGrid;
  K: number;
  tmp: Vec3;
}

/** Grows one scalp strand into `out[off .. off + K*3)`. */
function growScalpStrand(
  ctx: GrowContext,
  p: HairParams,
  out: Float32Array,
  off: number,
  root: Vec3,
  n: Vec3,
  az: number,
  h: number,
  L: number,
  layer: number,
  rng: () => number,
  /** Lock-level randomness: guides get more, so neighbouring locks read apart. */
  variation = 1,
) {
  const { K, sdf, rig } = ctx;
  const zones = scalpZones(p, az, h);
  const tf = topFlow(p, root, n, rig, zones.f);
  const lf = lowFlow(p);
  let flow = normalize([
    lf[0] + (tf[0] - lf[0]) * zones.wTop,
    lf[1] + (tf[1] - lf[1]) * zones.wTop,
    lf[2] + (tf[2] - lf[2]) * zones.wTop,
  ]);
  flow = tangentProject(flow, n);
  flow = rotateAround(flow, n, (rng() - 0.5) * (p.messiness * 1.3 + 0.12) * variation);

  const shortStand = 1 - smoothstep(0.004, 0.028, L);
  let lift = clamp(p.lift * (0.55 + 0.45 * zones.wTop), 0, 0.95);
  lift = clamp(
    Math.max(lift, 0.62 * shortStand) + (rng() - 0.5) * 0.35 * smoothstep(0.03, 0.008, L) + (rng() - 0.5) * 0.16 * p.messiness * (variation - 0.6),
    0,
    0.95,
  );
  let d = normalize([flow[0] * (1 - lift) + n[0] * lift, flow[1] * (1 - lift) + n[1] * lift, flow[2] * (1 - lift) + n[2] * lift]);
  const fl = p.frontLift * zones.frontW;
  if (fl > 0) {
    const upDir = normalize([n[0] * 0.8, n[1] + 0.9, n[2] + 0.35]);
    d = normalize([d[0] + (upDir[0] - d[0]) * fl * 0.9, d[1] + (upDir[1] - d[1]) * fl * 0.9, d[2] + (upDir[2] - d[2]) * fl * 0.9]);
  }

  const ds = L / (K - 1);
  // A few flyaways break the silhouette the way real hair does.
  const fly = L > 0.02 && rng() < 0.02 + 0.03 * p.messiness;
  const volumeShell = (0.0008 + p.volume * 0.02 * layer * smoothstep(0.008, 0.06, L)) * (fly ? 1.8 : 1);
  const slack = 0.0015 + p.volume * 0.012 + p.curl * 0.008 + fl * 0.05 + (fly ? 0.01 : 0);
  const attract = fly ? 0 : (0.55 - p.volume * 0.25) * (1 - fl);

  let px = root[0] + n[0] * 0.0002,
    py = root[1] + n[1] * 0.0002,
    pz = root[2] + n[2] * 0.0002;
  out[off] = px;
  out[off + 1] = py;
  out[off + 2] = pz;
  const g = ctx.tmp;
  for (let k = 1; k < K; k++) {
    const t = k / (K - 1);
    const steer = (0.22 + 0.22 * (1 - fl)) * (k === 1 ? 0.5 : 1);
    d[0] += (flow[0] - d[0]) * steer;
    d[1] += (flow[1] - d[1]) * steer;
    d[2] += (flow[2] - d[2]) * steer;
    const clearFace = p.flow === "middle" ? 1 - zones.frontW * (1 - smoothstep(0.25, 0.55, t)) : 1;
    d[1] -= p.gravity * smoothstep(0.03, 0.22, L) * (0.05 + 0.62 * Math.pow(t, 1.4)) * clearFace;
    const noise = p.messiness * 0.32 * (fly ? 3 : 1) + (fly ? 0.15 : 0) + 0.18 * smoothstep(0.03, 0.01, L);
    d[0] += (rng() - 0.5) * noise;
    d[1] += (rng() - 0.5) * noise;
    d[2] += (rng() - 0.5) * noise;
    d = normalize(d);
    px += d[0] * ds;
    py += d[1] * ds;
    pz += d[2] * ds;

    // Hair shell constraint: stay outside the scalp, hug it unless volume/lift.
    const clear = 0.0005 + volumeShell * smoothstep(0, 0.45, t);
    const dist = sampleSdf(sdf, px, py, pz);
    if (dist < clear) {
      sdfGradient(sdf, px, py, pz, g);
      const push = clear - dist;
      px += g[0] * push;
      py += g[1] * push;
      pz += g[2] * push;
      const inward = Math.min(0, dot(d, g));
      d = normalize([d[0] - g[0] * inward, d[1] - g[1] * inward, d[2] - g[2] * inward]);
    } else if (attract > 0 && dist < 0.08 && dist > clear + slack) {
      const a = attract * (1 - 0.85 * p.gravity * t);
      if (a > 0) {
        sdfGradient(sdf, px, py, pz, g);
        const pull = (dist - clear - slack) * a;
        px -= g[0] * pull;
        py -= g[1] * pull;
        pz -= g[2] * pull;
      }
    }
    const o = off + k * 3;
    out[o] = px;
    out[o + 1] = py;
    out[o + 2] = pz;
  }

  applyCurl(ctx, out, off, K, L, p.curl, p.curlFreq, rng() * Math.PI * 2, rig.center);
}

function applyCurl(
  ctx: GrowContext,
  out: Float32Array,
  off: number,
  K: number,
  L: number,
  curl: number,
  freq: number,
  phase: number,
  center: Vec3,
) {
  if (curl <= 0.01 || K < 3) return;
  const amp = curl * Math.min(0.011, 0.11 * L);
  let s = 0;
  const pts: Vec3[] = [];
  for (let k = 0; k < K; k++) pts.push([out[off + k * 3], out[off + k * 3 + 1], out[off + k * 3 + 2]]);
  for (let k = 1; k < K; k++) {
    const a = pts[k - 1],
      b = pts[k];
    s += Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const next = pts[Math.min(K - 1, k + 1)];
    const T = normalize([next[0] - a[0], next[1] - a[1], next[2] - a[2]]);
    const radial = normalize([b[0] - center[0], b[1] - center[1], b[2] - center[2]]);
    let B1 = cross(T, radial);
    if (Math.hypot(B1[0], B1[1], B1[2]) < 1e-4) B1 = cross(T, UP);
    B1 = normalize(B1);
    const B2 = cross(T, B1);
    const t = k / (K - 1);
    const ang = phase + 2 * Math.PI * freq * s;
    const A = amp * Math.pow(t, 0.6);
    let x = b[0] + (Math.cos(ang) * B1[0] + Math.sin(ang) * B2[0]) * A;
    let y = b[1] + (Math.cos(ang) * B1[1] + Math.sin(ang) * B2[1]) * A;
    let z = b[2] + (Math.cos(ang) * B1[2] + Math.sin(ang) * B2[2]) * A;
    const dist = sampleSdf(ctx.sdf, x, y, z);
    if (dist < 0.0005) {
      const g = sdfGradient(ctx.sdf, x, y, z, ctx.tmp);
      x += g[0] * (0.0005 - dist);
      y += g[1] * (0.0005 - dist);
      z += g[2] * (0.0005 - dist);
    }
    const o = off + k * 3;
    out[o] = x;
    out[o + 1] = y;
    out[o + 2] = z;
  }
}

/** Spatial hash of guide roots for nearest-guide lookup. */
class GuideGrid {
  private cells = new Map<number, number[]>();
  constructor(
    private cell: number,
    private roots: Float32Array,
  ) {}
  private key(i: number, j: number, k: number) {
    return ((i + 512) * 1024 + (j + 512)) * 1024 + (k + 512);
  }
  add(g: number) {
    const r = this.roots;
    const i = Math.floor(r[g * 3] / this.cell),
      j = Math.floor(r[g * 3 + 1] / this.cell),
      k = Math.floor(r[g * 3 + 2] / this.cell);
    const key = this.key(i, j, k);
    const list = this.cells.get(key);
    if (list) list.push(g);
    else this.cells.set(key, [g]);
  }
  nearest(x: number, y: number, z: number): number {
    const i0 = Math.floor(x / this.cell),
      j0 = Math.floor(y / this.cell),
      k0 = Math.floor(z / this.cell);
    let best = -1,
      bestD = Infinity;
    const r = this.roots;
    for (let di = -1; di <= 1; di++)
      for (let dj = -1; dj <= 1; dj++)
        for (let dk = -1; dk <= 1; dk++) {
          const list = this.cells.get(this.key(i0 + di, j0 + dj, k0 + dk));
          if (!list) continue;
          for (const g of list) {
            const d = (r[g * 3] - x) ** 2 + (r[g * 3 + 1] - y) ** 2 + (r[g * 3 + 2] - z) ** 2;
            if (d < bestD) {
              bestD = d;
              best = g;
            }
          }
        }
    return best;
  }
}

function pointsPerStrandFor(maxLen: number, segment = 0.011) {
  return clamp(Math.round(maxLen / segment) + 3, 3, segment < 0.011 ? 48 : 18);
}

/**
 * Scalp hair. `scalp` are candidate roots on the head surface (pre-shuffled).
 */
export function generateHair(
  rig: HeadRig,
  sdf: SdfGrid,
  scalp: SurfaceSamples,
  p: HairParams,
  opt: GenerateOptions,
): StrandMeshData {
  const maxLen = Math.max(p.topLength, p.frontLength, p.sideLength, p.backLength, p.napeLength);
  const K = pointsPerStrandFor(maxLen, opt.segment);
  const target = Math.min(opt.maxStrands, Math.floor(opt.vertexBudget / (2 * K)));

  // 1) Root selection — stable across styles thanks to per-sample randoms.
  const sel: number[] = [];
  const selAz: number[] = [];
  const selH: number[] = [];
  const selL: number[] = [];
  const sp: Vec3 = [0, 0, 0];
  const c = rig.center;
  for (let i = 0; i < scalp.count && sel.length < target; i++) {
    sp[0] = scalp.pos[i * 3] - c[0];
    sp[1] = scalp.pos[i * 3 + 1] - c[1];
    sp[2] = scalp.pos[i * 3 + 2] - c[2];
    const r = Math.hypot(sp[0], sp[1], sp[2]);
    const az = Math.atan2(sp[0], sp[2]);
    const el = Math.asin(clamp(sp[1] / r, -1, 1));
    const hl = hairlineAt(rig, az, p.recession);
    // ~1 cm soft transition (a real hairline thins out; it never ends like a helmet).
    const m = smoothstep(hl - 0.06, hl + 0.1, el);
    // Crown thinning follows recession for the clinic simulation.
    const crown = p.recession > 0 ? 1 - p.recession * 0.55 * Math.exp(-(((Math.abs(az) - Math.PI) / 0.6) ** 2 + ((el - 1.05) / 0.3) ** 2)) : 1;
    const prob = m * p.density * crown;
    if (scalp.rnd[i] >= prob) continue;
    const h = zoneHeight(rig, az, el);
    // Real hairlines are soft: the outermost hairs are shorter and sparser, never a helmet edge.
    const edge = 0.35 + 0.65 * smoothstep(0.08, 0.85, m);
    const L = hairLengthAt(p, az, h) * (0.88 + 0.24 * ((scalp.rnd[i] * 7.31) % 1)) * edge;
    if (L < 0.0006) continue;
    sel.push(i);
    selAz.push(az);
    selH.push(h);
    selL.push(L);
  }
  const S = sel.length;
  const points = new Float32Array(S * K * 3);
  const ctx: GrowContext = { rig, sdf, K, tmp: [0, 0, 0] };

  // 2) Guides: every 24th strand. Grow them first.
  // One guide per lock; dense offline grooms get bigger, more legible locks.
  const GUIDE_EVERY = S > 150_000 ? 40 : 24;
  const guideRoots = new Float32Array(Math.ceil(S / GUIDE_EVERY) * 3);
  const guideOf: number[] = [];
  const grid = new GuideGrid(0.012, guideRoots);
  const layers = new Float32Array(S);
  const rnds = new Float32Array(S);
  const grow = (s: number, variation: number) => {
    const i = sel[s];
    const rng = mulberry32(opt.seed ^ Math.imul(i + 1, 0x9e3779b1));
    const root: Vec3 = [scalp.pos[i * 3], scalp.pos[i * 3 + 1], scalp.pos[i * 3 + 2]];
    const n: Vec3 = [scalp.nrm[i * 3], scalp.nrm[i * 3 + 1], scalp.nrm[i * 3 + 2]];
    // Short hair sits in the scalp's shadow; long top layers catch the light.
    const layer = clamp(0.35 * rng() + 0.65 * selH[s], 0, 1) * (0.35 + 0.65 * smoothstep(0.004, 0.03, selL[s]));
    layers[s] = layer;
    rnds[s] = scalp.rnd[i];
    growScalpStrand(ctx, p, points, s * K * 3, root, n, selAz[s], selH[s], selL[s], layer, rng, variation);
  };
  for (let s = 0; s < S; s += GUIDE_EVERY) {
    grow(s, 1.5);
    const g = s / GUIDE_EVERY;
    guideRoots[g * 3] = points[s * K * 3];
    guideRoots[g * 3 + 1] = points[s * K * 3 + 1];
    guideRoots[g * 3 + 2] = points[s * K * 3 + 2];
    grid.add(g);
    guideOf[g] = s;
  }
  // 3) Children, clumped towards their nearest guide.
  for (let s = 0; s < S; s++) {
    if (s % GUIDE_EVERY === 0) continue;
    grow(s, 0.75);
    if (p.clump <= 0.01) continue;
    const o = s * K * 3;
    const g = grid.nearest(points[o], points[o + 1], points[o + 2]);
    if (g < 0) continue;
    const gs = guideOf[g];
    if (Math.abs(selL[gs] - selL[s]) > 0.35 * selL[s]) continue;
    const go = gs * K * 3;
    const dx = points[o] - points[go],
      dy = points[o + 1] - points[go + 1],
      dz = points[o + 2] - points[go + 2];
    const c0 = p.clump * (0.55 + 0.45 * rnds[s]) * smoothstep(0.006, 0.03, selL[s]);
    rnds[s] = rnds[s] * 0.4 + rnds[gs] * 0.6; // clumps share a tone
    for (let k = 1; k < K; k++) {
      const t = k / (K - 1);
      const w = c0 * Math.pow(t, 0.65);
      // Tips gather towards the lock but keep ~30 % of their spread, so locks have body.
      const keep = 1 - 0.7 * t;
      const ox = points[go + k * 3] + dx * keep;
      const oy = points[go + k * 3 + 1] + dy * keep;
      const oz = points[go + k * 3 + 2] + dz * keep;
      points[o + k * 3] += (ox - points[o + k * 3]) * w;
      points[o + k * 3 + 1] += (oy - points[o + k * 3 + 1]) * w;
      points[o + k * 3 + 2] += (oz - points[o + k * 3 + 2]) * w;
    }
  }
  // When the vertex budget caps the strand count (long hair on low tiers),
  // widen strands to keep the same visual coverage.
  const coverage = Math.min(2.4, Math.max(1, Math.sqrt(30000 / Math.max(1, S))));
  return buildRibbons(points, S, K, rnds, layers, p.strandWidth * coverage);
}

/** Facial hair. `face` are candidate surface samples on the lower face/neck. */
export function generateBeard(
  rig: HeadRig,
  sdf: SdfGrid,
  face: SurfaceSamples,
  bp: BeardParams,
  opt: GenerateOptions,
): StrandMeshData {
  const K = bp.length < 0.004 ? 2 : bp.length < 0.012 ? 3 : 6;
  const target = Math.min(opt.maxStrands, Math.floor(opt.vertexBudget / (2 * K)));
  const points = new Float32Array(target * K * 3);
  const rnds = new Float32Array(target);
  const layers = new Float32Array(target);
  const ctx: GrowContext = { rig, sdf, K, tmp: [0, 0, 0] };
  let S = 0;
  const pt: Vec3 = [0, 0, 0];
  for (let i = 0; i < face.count && S < target; i++) {
    pt[0] = face.pos[i * 3];
    pt[1] = face.pos[i * 3 + 1];
    pt[2] = face.pos[i * 3 + 2];
    const m = beardMask(rig, bp, pt);
    if (face.rnd[i] >= m * bp.density) continue;
    const rng = mulberry32(opt.seed ^ Math.imul(i + 7, 0x85ebca6b));
    const n: Vec3 = [face.nrm[i * 3], face.nrm[i * 3 + 1], face.nrm[i * 3 + 2]];
    const flow = tangentProject(beardFlow(rig, pt), n);
    const L = bp.length * (0.75 + 0.5 * rng()) * (0.55 + 0.45 * m);
    const lift = bp.length < 0.004 ? 0.55 : 0.32;
    let d = normalize([flow[0] * (1 - lift) + n[0] * lift, flow[1] * (1 - lift) + n[1] * lift, flow[2] * (1 - lift) + n[2] * lift]);
    const ds = L / (K - 1);
    const o = S * K * 3;
    let px = pt[0],
      py = pt[1],
      pz = pt[2];
    points[o] = px;
    points[o + 1] = py;
    points[o + 2] = pz;
    for (let k = 1; k < K; k++) {
      d[0] += (flow[0] - d[0]) * 0.3 + (rng() - 0.5) * 0.25;
      d[1] += (flow[1] - d[1]) * 0.3 - (bp.length > 0.015 ? 0.15 : 0) + (rng() - 0.5) * 0.25;
      d[2] += (flow[2] - d[2]) * 0.3 + (rng() - 0.5) * 0.25;
      d = normalize(d);
      px += d[0] * ds;
      py += d[1] * ds;
      pz += d[2] * ds;
      const dist = sampleSdf(sdf, px, py, pz);
      const clear = 0.0004 + bp.length * 0.15 * (k / (K - 1));
      if (dist < clear) {
        const g = sdfGradient(sdf, px, py, pz, ctx.tmp);
        px += g[0] * (clear - dist);
        py += g[1] * (clear - dist);
        pz += g[2] * (clear - dist);
      }
      points[o + k * 3] = px;
      points[o + k * 3 + 1] = py;
      points[o + k * 3 + 2] = pz;
    }
    if (bp.curl > 0 && K > 2) applyCurl(ctx, points, o, K, L, bp.curl, 160, rng() * 6.28, rig.center);
    rnds[S] = face.rnd[i];
    layers[S] = m;
    S++;
  }
  return buildRibbons(points.subarray(0, S * K * 3), S, K, rnds, layers, bp.strandWidth);
}

function buildRibbons(
  points: Float32Array,
  S: number,
  K: number,
  rnds: Float32Array,
  layers: Float32Array,
  strandWidth: number,
): StrandMeshData {
  const V = S * K * 2;
  const position = new Float32Array(V * 3);
  const tangent = new Int16Array(V * 3);
  const attr = new Uint8Array(V * 4);
  const index = new Uint32Array(S * (K - 1) * 6);
  let ii = 0;
  for (let s = 0; s < S; s++) {
    const base = s * K;
    for (let k = 0; k < K; k++) {
      const a = Math.max(0, k - 1),
        b = Math.min(K - 1, k + 1);
      const pa = (base + a) * 3,
        pb = (base + b) * 3,
        pk = (base + k) * 3;
      let tx = points[pb] - points[pa],
        ty = points[pb + 1] - points[pa + 1],
        tz = points[pb + 2] - points[pa + 2];
      const tl = Math.hypot(tx, ty, tz) || 1;
      tx /= tl;
      ty /= tl;
      tz /= tl;
      for (let side = 0; side < 2; side++) {
        const v = (base + k) * 2 + side;
        position[v * 3] = points[pk];
        position[v * 3 + 1] = points[pk + 1];
        position[v * 3 + 2] = points[pk + 2];
        tangent[v * 3] = Math.round(tx * 32767);
        tangent[v * 3 + 1] = Math.round(ty * 32767);
        tangent[v * 3 + 2] = Math.round(tz * 32767);
        attr[v * 4] = Math.round((k / (K - 1)) * 255);
        attr[v * 4 + 1] = side * 255;
        attr[v * 4 + 2] = Math.round(rnds[s] * 255);
        attr[v * 4 + 3] = Math.round(clamp(layers[s], 0, 1) * 255);
      }
      if (k < K - 1) {
        const v0 = (base + k) * 2;
        index[ii++] = v0;
        index[ii++] = v0 + 1;
        index[ii++] = v0 + 2;
        index[ii++] = v0 + 1;
        index[ii++] = v0 + 3;
        index[ii++] = v0 + 2;
      }
    }
  }
  return { position, tangent, attr, index, strandCount: S, pointsPerStrand: K, strandWidth };
}

