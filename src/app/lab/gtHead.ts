"use client";

import { type BufferGeometry, Mesh, MeshStandardMaterial, SRGBColorSpace, type Texture, TextureLoader } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { HeadAsset } from "@/lib/head/asset";
import { autoRigMesh } from "@/lib/recon/autorig";
import { applySimilarity, similarityAlign } from "@/lib/recon/linalg";

/**
 * A real scanned head as ground truth for likeness tests (e.g. the Lee
 * Perry-Smith scan): rigged with the same landmarker, then moved into the
 * template's frame and scale, so a synthetic "selfie session" of it can be
 * reconstructed and the twin compared with the person it came from.
 */
export interface GtHead {
  mesh: Mesh;
  map: Texture;
  /** Positions in template space (metres). */
  positions: Float32Array;
  /** 478 landmarks in template space. */
  landmarks: Float32Array;
}

/**
 * Identity changes applied to the ground-truth head, so a test can check that
 * a *different* face is recovered (the default scan is the template itself):
 * jaw width, face length below the nose, nose projection and cheek fullness.
 */
export interface GtMorph {
  jaw?: number;
  lower?: number;
  nose?: number;
  cheeks?: number;
}

function morphHead(positions: Float32Array, lm: Float32Array, m: GtMorph) {
  const L = (i: number) => [lm[i * 3], lm[i * 3 + 1], lm[i * 3 + 2]];
  const nose = L(1),
    sub = L(2),
    chin = L(152),
    cheekR = L(234),
    cheekL = L(454);
  const faceW = Math.abs(cheekL[0] - cheekR[0]);
  const smooth = (e0: number, e1: number, x: number) => {
    const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
    return t * t * (3 - 2 * t);
  };
  for (const arr of [positions, lm]) {
    for (let i = 0; i < arr.length / 3; i++) {
      let x = arr[i * 3],
        y = arr[i * 3 + 1],
        z = arr[i * 3 + 2];
      const front = smooth(cheekR[2] - 0.03, cheekR[2] + 0.02, z);
      // wider/narrower jaw: below the nose, growing towards the chin line
      if (m.jaw) x *= 1 + (m.jaw - 1) * smooth(sub[1] + 0.01, sub[1] - 0.04, y) * smooth(chin[1] - 0.05, chin[1] + 0.01, y);
      // longer/shorter lower face
      if (m.lower && y < sub[1]) y = sub[1] + (y - sub[1]) * m.lower;
      // nose projection
      if (m.nose) {
        const d = Math.hypot(x - nose[0], (y - nose[1]) * 0.7) / (faceW * 0.16);
        z += (m.nose - 1) * 0.02 * Math.exp(-d * d) * front;
      }
      // cheek fullness
      if (m.cheeks) {
        const cy = (nose[1] + sub[1]) / 2;
        const d = Math.hypot((Math.abs(x) - faceW * 0.32) / (faceW * 0.14), (y - cy) / 0.03);
        const out = (m.cheeks - 1) * 0.012 * Math.exp(-d * d) * front;
        x += Math.sign(x) * out * 0.6;
        z += out;
      }
      arr[i * 3] = x;
      arr[i * 3 + 1] = y;
      arr[i * 3 + 2] = z;
    }
  }
}

export async function loadGtHead(glbUrl: string, texUrl: string, template: HeadAsset, morph: GtMorph = {}): Promise<GtHead> {
  const gltf = await new GLTFLoader().loadAsync(glbUrl);
  let src: Mesh | null = null;
  gltf.scene.traverse((o) => {
    if (!src && (o as Mesh).isMesh) src = o as Mesh;
  });
  if (!src) throw new Error("no mesh in the ground-truth file");
  const geometry = (src as Mesh).geometry.clone() as BufferGeometry;
  geometry.computeVertexNormals();
  const map = await new TextureLoader().loadAsync(texUrl);
  map.colorSpace = SRGBColorSpace;

  // Rig it the way templates are rigged, then align those landmarks to the template's.
  const lm = await autoRigMesh(geometry, map);
  const T = template.rig.landmarks;
  const sim = similarityAlign(lm.subarray(0, 468 * 3), Float64Array.from({ length: 468 * 3 }, (_, i) => T[i]));
  const pos = geometry.getAttribute("position");
  const moved = applySimilarity(sim, pos.array as ArrayLike<number>);
  const positions = Float32Array.from(moved);
  const landmarks = Float32Array.from(applySimilarity(sim, lm));
  morphHead(positions, landmarks, morph);
  pos.array.set(positions);
  pos.needsUpdate = true;
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  const mesh = new Mesh(geometry, new MeshStandardMaterial({ map, roughness: 0.55 }));
  return { mesh, map, positions, landmarks };
}

/**
 * Surface error of a reconstruction against the ground truth: the twin is
 * aligned by its landmarks, then every face vertex is matched to the nearest
 * ground-truth vertex (grid search). Returns mm statistics and the face's
 * proportions (width/length) on both.
 */
export function gtError(recon: Float32Array, reconLm: ArrayLike<number>, gt: GtHead): string {
  const sim = similarityAlign(
    Float64Array.from({ length: 468 * 3 }, (_, i) => reconLm[i]),
    Float64Array.from({ length: 468 * 3 }, (_, i) => gt.landmarks[i]),
  );
  const al = applySimilarity(sim, recon);
  const cell = 0.006;
  const grid = new Map<string, number[]>();
  const key = (x: number, y: number, z: number) => `${Math.floor(x / cell)},${Math.floor(y / cell)},${Math.floor(z / cell)}`;
  const G = gt.positions;
  for (let i = 0; i < G.length / 3; i++) {
    const k = key(G[i * 3], G[i * 3 + 1], G[i * 3 + 2]);
    const l = grid.get(k);
    if (l) l.push(i);
    else grid.set(k, [i]);
  }
  // face region: in front of the ears, between brow-top and chin (template landmarks)
  const L = gt.landmarks;
  const top = L[10 * 3 + 1] + 0.01,
    chin = L[152 * 3 + 1] - 0.005,
    earZ = Math.min(L[234 * 3 + 2], L[454 * 3 + 2]);
  const ds: number[] = [];
  for (let i = 0; i < al.length / 3; i++) {
    const x = al[i * 3],
      y = al[i * 3 + 1],
      z = al[i * 3 + 2];
    if (y > top || y < chin || z < earZ) continue;
    let best = Infinity;
    const cx = Math.floor(x / cell),
      cy = Math.floor(y / cell),
      cz = Math.floor(z / cell);
    for (let a = -1; a <= 1; a++)
      for (let b = -1; b <= 1; b++)
        for (let c = -1; c <= 1; c++) {
          const l = grid.get(`${cx + a},${cy + b},${cz + c}`);
          if (!l) continue;
          for (const j of l) best = Math.min(best, (G[j * 3] - x) ** 2 + (G[j * 3 + 1] - y) ** 2 + (G[j * 3 + 2] - z) ** 2);
        }
    if (best < Infinity) ds.push(Math.sqrt(best) * 1000);
  }
  ds.sort((p, q) => p - q);
  const mean = ds.reduce((a, b) => a + b, 0) / Math.max(1, ds.length);
  const d = (P: ArrayLike<number>, a: number, b: number) => Math.hypot(P[a * 3] - P[b * 3], P[a * 3 + 1] - P[b * 3 + 1], P[a * 3 + 2] - P[b * 3 + 2]);
  const wl = (P: ArrayLike<number>) => (d(P, 234, 454) / d(P, 10, 152)).toFixed(3);
  const jl = (P: ArrayLike<number>) => (d(P, 172, 397) / d(P, 10, 152)).toFixed(3);
  // Widths of the actual surfaces (not landmark definitions): max |x| in slabs
  // at the jaw-angle and cheekbone heights, in front of the ears.
  const width = (P: ArrayLike<number>, y0: number) => {
    let lo = Infinity,
      hi = -Infinity;
    for (let i = 0; i < P.length / 3; i++) {
      if (Math.abs(P[i * 3 + 1] - y0) > 0.004 || P[i * 3 + 2] < earZ - 0.01) continue;
      lo = Math.min(lo, P[i * 3]);
      hi = Math.max(hi, P[i * 3]);
    }
    return ((hi - lo) * 1000).toFixed(1);
  };
  const jawY = (L[172 * 3 + 1] + L[397 * 3 + 1]) / 2,
    cheekY = (L[234 * 3 + 1] + L[454 * 3 + 1]) / 2;
  const widths = `mesh jaw ${width(al, jawY)} vs ${width(G, jawY)}mm · cheeks ${width(al, cheekY)} vs ${width(G, cheekY)}mm`;
  return `${widths} · GT face ${mean.toFixed(2)}mm mean · p90 ${ds[Math.floor(ds.length * 0.9)]?.toFixed(2)}mm (${ds.length} v) · W/L ${wl(reconLm)} vs ${wl(gt.landmarks)} · jaw/L ${jl(reconLm)} vs ${jl(gt.landmarks)}`;
}
