/// <reference lib="webworker" />
/**
 * Avatar worker: owns the per-head acceleration structures (BVH, scalp roots,
 * signed distance field) and regenerates hair/beard geometry off the main
 * thread, so switching styles never drops a frame.
 */
import { BufferAttribute, BufferGeometry, DoubleSide, Ray, Triangle, Vector3 } from "three";
import { MeshBVH } from "three-mesh-bvh";
import { generateBeard, generateHair, mulberry32, type SurfaceSamples } from "@/lib/hair/generate";
import type { SdfGrid } from "@/lib/hair/sdf";
import { type HeadRig, LM, clamp, hairlineAt, lmk } from "@/lib/head/rig";
import { QUALITY_BUDGETS, type QualityTier, type WorkerRequest, type WorkerResponse } from "@/lib/engine/protocol";

interface HeadState {
  rig: HeadRig;
  sdf: SdfGrid;
  scalp: SurfaceSamples;
  face: SurfaceSamples;
}

const heads = new Map<string, HeadState>();
const ctx = self as unknown as DedicatedWorkerGlobalScope;

function post(msg: WorkerResponse, transfer: Transferable[] = []) {
  ctx.postMessage(msg, transfer);
}

ctx.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const msg = e.data;
  try {
    if (msg.type === "prepare") {
      const t0 = performance.now();
      const state = prepare(msg.positions, msg.normals, msg.index, msg.rig, msg.quality);
      heads.set(msg.headId, state);
      post({
        type: "prepared",
        headId: msg.headId,
        ms: performance.now() - t0,
        scalpRoots: state.scalp.count,
        faceSamples: state.face.count,
      });
    } else if (msg.type === "hair" || msg.type === "beard") {
      const head = heads.get(msg.headId);
      if (!head) throw new Error(`head ${msg.headId} not prepared`);
      const t0 = performance.now();
      const b = QUALITY_BUDGETS[msg.quality];
      const data =
        msg.type === "hair"
          ? generateHair(head.rig, head.sdf, head.scalp, msg.params, {
              vertexBudget: b.hairVerts,
              maxStrands: b.hairStrands,
              seed: msg.seed,
            })
          : generateBeard(head.rig, head.sdf, head.face, msg.params, {
              vertexBudget: b.beardVerts,
              maxStrands: b.beardVerts / 4,
              seed: msg.seed,
            });
      post(
        { type: "strands", headId: msg.headId, reqId: msg.reqId, kind: msg.type, data, ms: performance.now() - t0 },
        [data.position.buffer, data.tangent.buffer, data.attr.buffer, data.index.buffer],
      );
    } else if (msg.type === "dispose") {
      heads.delete(msg.headId);
    }
  } catch (err) {
    post({
      type: "error",
      headId: msg.headId,
      reqId: "reqId" in msg ? msg.reqId : undefined,
      message: err instanceof Error ? err.message : String(err),
    });
  }
};

function prepare(
  positions: Float32Array,
  normals: Float32Array,
  index: Uint32Array,
  rig: HeadRig,
  quality: QualityTier,
): HeadState {
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new BufferAttribute(normals, 3));
  geometry.setIndex(new BufferAttribute(index, 1));
  const bvh = new MeshBVH(geometry);
  const idx = geometry.index!.array as Uint32Array;
  const budget = QUALITY_BUDGETS[quality];
  const rng = mulberry32(0x7717);

  const scalp = sampleScalp(bvh, positions, normals, idx, rig, budget.scalpCandidates, rng);
  const face = sampleFace(positions, normals, idx, rig, budget.faceCandidates, rng);
  const sdf = buildSdf(bvh, positions, idx, rig);
  return { rig, sdf, scalp, face };
}

/** Candidate hair roots: rays from the cranium centre to the scalp. */
function sampleScalp(
  bvh: MeshBVH,
  positions: Float32Array,
  normals: Float32Array,
  idx: Uint32Array,
  rig: HeadRig,
  count: number,
  rng: () => number,
): SurfaceSamples {
  // Fibonacci sphere over the region above the lowest plausible hairline.
  // Sweep the whole sphere (not "until full") so the nape gets roots too; the
  // hair region is roughly 55–65 % of the sphere.
  const golden = Math.PI * (3 - Math.sqrt(5));
  const total = Math.round(count * 1.7);
  const cap = total;
  const pos = new Float32Array(cap * 3);
  const nrm = new Float32Array(cap * 3);
  const ray = new Ray();
  const c = new Vector3(...rig.center);
  const tri = new Triangle();
  const a = new Vector3(),
    b = new Vector3(),
    cc = new Vector3(),
    bary = new Vector3();
  let n = 0;
  for (let i = 0; i < total; i++) {
    const y = 1 - (2 * (i + 0.5)) / total;
    const r = Math.sqrt(1 - y * y);
    const phi = i * golden + (rng() - 0.5) * 0.002;
    const dir = new Vector3(Math.cos(phi) * r, y, Math.sin(phi) * r);
    const el = Math.asin(y);
    const az = Math.atan2(dir.x, dir.z);
    // generous margin: recession can only shrink the region later
    if (el < hairlineAt(rig, az, 0) - 0.09) continue;
    ray.origin.copy(c);
    ray.direction.copy(dir);
    const hit = bvh.raycastFirst(ray, DoubleSide);
    if (!hit || hit.faceIndex == null) continue;
    const f = hit.faceIndex;
    const ia = idx[f * 3],
      ib = idx[f * 3 + 1],
      ic = idx[f * 3 + 2];
    a.fromArray(positions, ia * 3);
    b.fromArray(positions, ib * 3);
    cc.fromArray(positions, ic * 3);
    tri.set(a, b, cc);
    tri.getBarycoord(hit.point, bary);
    const nx = normals[ia * 3] * bary.x + normals[ib * 3] * bary.y + normals[ic * 3] * bary.z;
    const ny = normals[ia * 3 + 1] * bary.x + normals[ib * 3 + 1] * bary.y + normals[ic * 3 + 1] * bary.z;
    const nz = normals[ia * 3 + 2] * bary.x + normals[ib * 3 + 2] * bary.y + normals[ic * 3 + 2] * bary.z;
    const nl = Math.hypot(nx, ny, nz) || 1;
    pos[n * 3] = hit.point.x;
    pos[n * 3 + 1] = hit.point.y;
    pos[n * 3 + 2] = hit.point.z;
    nrm[n * 3] = nx / nl;
    nrm[n * 3 + 1] = ny / nl;
    nrm[n * 3 + 2] = nz / nl;
    n++;
  }
  return shuffleSamples(pos, nrm, n, rng);
}

/** Area-weighted samples on the lower face and neck for facial hair. */
function sampleFace(
  positions: Float32Array,
  normals: Float32Array,
  idx: Uint32Array,
  rig: HeadRig,
  count: number,
  rng: () => number,
): SurfaceSamples {
  const noseTip = lmk(rig, LM.noseTip);
  const chin = lmk(rig, LM.chin);
  const cheekR = lmk(rig, LM.cheekR);
  const cheekL = lmk(rig, LM.cheekL);
  const halfW = Math.abs(cheekL[0] - cheekR[0]) / 2 + 0.012;
  const yMax = noseTip[1] + 0.012;
  const yMin = chin[1] - 0.075;
  const zMin = Math.min(cheekR[2], cheekL[2]) - 0.035;

  const tris: number[] = [];
  const areas: number[] = [];
  let totalArea = 0;
  const A = new Vector3(),
    B = new Vector3(),
    C = new Vector3(),
    e1 = new Vector3(),
    e2 = new Vector3();
  for (let f = 0; f < idx.length / 3; f++) {
    A.fromArray(positions, idx[f * 3] * 3);
    B.fromArray(positions, idx[f * 3 + 1] * 3);
    C.fromArray(positions, idx[f * 3 + 2] * 3);
    const cy = (A.y + B.y + C.y) / 3,
      cx = (A.x + B.x + C.x) / 3,
      cz = (A.z + B.z + C.z) / 3;
    if (cy > yMax || cy < yMin || Math.abs(cx) > halfW || cz < zMin) continue;
    const area = e1.subVectors(B, A).cross(e2.subVectors(C, A)).length() / 2;
    tris.push(f);
    totalArea += area;
    areas.push(totalArea);
  }
  const pos = new Float32Array(count * 3);
  const nrm = new Float32Array(count * 3);
  if (tris.length === 0) return { count: 0, pos, nrm, rnd: new Float32Array(0) };
  for (let s = 0; s < count; s++) {
    const r = rng() * totalArea;
    let lo = 0,
      hi = areas.length - 1;
    while (lo < hi) {
      const m = (lo + hi) >> 1;
      if (areas[m] < r) lo = m + 1;
      else hi = m;
    }
    const f = tris[lo];
    let u = rng(),
      v = rng();
    if (u + v > 1) {
      u = 1 - u;
      v = 1 - v;
    }
    const w = 1 - u - v;
    const ia = idx[f * 3],
      ib = idx[f * 3 + 1],
      ic = idx[f * 3 + 2];
    for (let k = 0; k < 3; k++) {
      pos[s * 3 + k] = positions[ia * 3 + k] * w + positions[ib * 3 + k] * u + positions[ic * 3 + k] * v;
      nrm[s * 3 + k] = normals[ia * 3 + k] * w + normals[ib * 3 + k] * u + normals[ic * 3 + k] * v;
    }
    const nl = Math.hypot(nrm[s * 3], nrm[s * 3 + 1], nrm[s * 3 + 2]) || 1;
    nrm[s * 3] /= nl;
    nrm[s * 3 + 1] /= nl;
    nrm[s * 3 + 2] /= nl;
  }
  return shuffleSamples(pos, nrm, count, rng);
}

function shuffleSamples(pos: Float32Array, nrm: Float32Array, n: number, rng: () => number): SurfaceSamples {
  const order = new Uint32Array(n);
  for (let i = 0; i < n; i++) order[i] = i;
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = order[i];
    order[i] = order[j];
    order[j] = t;
  }
  const p2 = new Float32Array(n * 3);
  const n2 = new Float32Array(n * 3);
  const rnd = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const o = order[i];
    p2.set(pos.subarray(o * 3, o * 3 + 3), i * 3);
    n2.set(nrm.subarray(o * 3, o * 3 + 3), i * 3);
    rnd[i] = rng();
  }
  return { count: n, pos: p2, nrm: n2, rnd };
}

/** Signed distance grid around the head (8 mm cells). */
function buildSdf(bvh: MeshBVH, positions: Float32Array, idx: Uint32Array, rig: HeadRig): SdfGrid {
  const cell = 0.008;
  const pad = 0.06;
  const min: [number, number, number] = [
    -rig.radii[0] - pad - 0.04,
    rig.center[1] - 0.33,
    -rig.radii[2] - pad - 0.03,
  ];
  const max: [number, number, number] = [rig.radii[0] + pad + 0.04, rig.center[1] + rig.radii[1] + pad, rig.radii[2] + pad + 0.05];
  const dims: [number, number, number] = [
    Math.ceil((max[0] - min[0]) / cell) + 1,
    Math.ceil((max[1] - min[1]) / cell) + 1,
    Math.ceil((max[2] - min[2]) / cell) + 1,
  ];
  const data = new Float32Array(dims[0] * dims[1] * dims[2]);

  // Precompute face normals for the inside/outside test.
  const nf = idx.length / 3;
  const fn = new Float32Array(nf * 3);
  const A = new Vector3(),
    B = new Vector3(),
    C = new Vector3(),
    e1 = new Vector3(),
    e2 = new Vector3();
  for (let f = 0; f < nf; f++) {
    A.fromArray(positions, idx[f * 3] * 3);
    B.fromArray(positions, idx[f * 3 + 1] * 3);
    C.fromArray(positions, idx[f * 3 + 2] * 3);
    e1.subVectors(B, A).cross(e2.subVectors(C, A)).normalize();
    fn[f * 3] = e1.x;
    fn[f * 3 + 1] = e1.y;
    fn[f * 3 + 2] = e1.z;
  }
  const p = new Vector3();
  const hit = { point: new Vector3(), distance: 0, faceIndex: 0 };
  const far = 0.12;
  let o = 0;
  for (let k = 0; k < dims[2]; k++)
    for (let j = 0; j < dims[1]; j++)
      for (let i = 0; i < dims[0]; i++, o++) {
        p.set(min[0] + i * cell, min[1] + j * cell, min[2] + k * cell);
        const res = bvh.closestPointToPoint(p, hit, 0, far);
        if (!res) {
          data[o] = far;
          continue;
        }
        const f = res.faceIndex;
        const sx = p.x - res.point.x,
          sy = p.y - res.point.y,
          sz = p.z - res.point.z;
        const sign = sx * fn[f * 3] + sy * fn[f * 3 + 1] + sz * fn[f * 3 + 2] >= 0 ? 1 : -1;
        data[o] = clamp(res.distance, 0, far) * sign;
      }
  return { min, cell, dims, data };
}
