"use client";

import type { BufferGeometry } from "three";
import { Float32BufferAttribute } from "three";
import { type HeadAsset, buildAnalysis, loadTemplateHead } from "@/lib/head/asset";
import { FACE_OVAL, buildRig } from "@/lib/head/rig";
import { type SegmentedFrame, estimateHairAndBeard, linearOf, meanSkinRgb, sampleIrisColor, segmentFrame } from "@/lib/recon/analyze";
import { bakeTexture, type BakeView } from "@/lib/recon/bake";
import { PHONE_FOCAL, fuseLandmarks, toImageSpace } from "@/lib/recon/fusion";
import { applyAffine, fitAffine, fitRbf } from "@/lib/recon/linalg";
import { type InstantTwinRecord, avatarVault } from "@/lib/recon/storage";
import type { CaptureFrame, ReconProgress } from "@/lib/recon/types";
import { warpTemplate } from "@/lib/recon/warp";
import { expressionMask, faceOvalMask } from "@/lib/three/masks";
import { fitShading } from "@/lib/recon/delight";
import { fitFaceOutline } from "@/lib/recon/silhouette";

/**
 * Instant Twin — fully on-device reconstruction (~5–15 s on a phone):
 *
 *   segment → fuse 478 landmarks across views → sculpt template (affine +
 *   RBF) → fit a camera per photo → project & blend photos into the UV atlas
 *   → read hair/beard/skin → persist to the on-device vault.
 *
 * Photos never leave the device unless the user opts into the HD Twin.
 */
export async function reconstructInstantTwin(
  frames: CaptureFrame[],
  onProgress: (p: ReconProgress) => void = () => {},
  opts: { atlasSize?: number; persist?: boolean; name?: string } = {},
): Promise<InstantTwinRecord> {
  if (frames.length < 3) throw new Error("At least 3 views are needed (front + both sides).");
  const report = (stage: ReconProgress["stage"], progress: number, message: string) => onProgress({ stage, progress, message });
  const yield_ = () => new Promise((r) => setTimeout(r, 0));

  report("segment", 0.02, "Preparing your scan");
  const template = await loadTemplateHead();
  // Compare like with like: the template's landmarks as this pipeline measures them.
  const T = template.rig.fitLandmarks ?? template.rig.landmarks;
  const templatePositions = template.geometry.getAttribute("position").array as Float32Array;
  const templateNormals = templateLandmarkNormals(template);

  // 1) segmentation
  const segs: SegmentedFrame[] = [];
  for (const [i, f] of frames.entries()) {
    segs.push(await segmentFrame(f));
    report("segment", 0.05 + (0.2 * (i + 1)) / frames.length, `Separating skin and hair · ${i + 1}/${frames.length}`);
    await yield_();
  }
  const frontIdx = frames.reduce((b, f, i) => (Math.abs(f.pose.yaw) + Math.abs(f.pose.pitch) < Math.abs(frames[b].pose.yaw) + Math.abs(frames[b].pose.pitch) ? i : b), 0);

  // 2) landmark fusion
  report("fuse", 0.3, `Fusing ${frames.length} viewpoints · 478 landmarks each`);
  await yield_();
  const fusion = fuseLandmarks(
    frames.map((f) => ({ landmarks: f.landmarks, width: f.width, height: f.height, yaw: f.pose.yaw })),
    T,
    templateNormals,
  );
  const m = fusion.metricScale;
  const F = fusion.fused.map((v) => v * m);

  // 3) sculpt
  report("sculpt", 0.42, "Sculpting your head geometry");
  await yield_();
  // The template's landmarks *on its surface* ride along with the vertices: the
  // cameras are fitted to these, not to the fused landmarks, whose depth is the
  // tracker's (compressed ~0.6×). Fitted to that, a side view's camera
  // over-weights depth and throws the ears and the back of the head ~2 cm off
  // (a "ghost ear" baked onto the cheek).
  const nv = templatePositions.length / 3;
  const withLm = new Float32Array((nv + 478) * 3);
  withLm.set(templatePositions);
  withLm.set(Float32Array.from(template.rig.landmarks), nv * 3);
  const warped = warpTemplate(withLm, T, F);
  let all = warped.positions;
  const surfaceLm = () => all.slice(nv * 3);
  let cams = frames.map((f, k) => fitViewCamera(f, surfaceLm(), fusion.views[k], m));
  // The landmarks barely see the face's outline (jaw, cheeks): fit it to the
  // frontal photo's segmentation edge.
  let outline: ReturnType<typeof fitFaceOutline> = null;
  for (let pass = 0; pass < 2; pass++) {
    const front = cams[frontIdx];
    const o = fitFaceOutline({
      positions: all,
      index: template.geometry.index!.array,
      project: (x, y, z) => {
        const q = front.project(x, y, z);
        return [q[0], -q[1]];
      },
      seg: segs[frontIdx],
      F,
      ears: template.rig.ears,
    });
    if (!o) break;
    all = o.positions;
    outline = o;
    cams = frames.map((f, k) => fitViewCamera(f, surfaceLm(), fusion.views[k], m));
  }
  const warp = { positions: all.slice(0, nv * 3), affine: warped.affine, residualRms: warped.residualRms };
  const geometry: BufferGeometry = template.geometry.clone();
  geometry.setAttribute("position", new Float32BufferAttribute(warp.positions, 3));
  geometry.computeVertexNormals();
  geometry.setAttribute("aFeat", new Float32BufferAttribute(expressionMask(warp.positions, F), 1));
  geometry.setAttribute("aOval", new Float32BufferAttribute(faceOvalMask(warp.positions, F), 1));

  // 4) cameras + per-view landmark residual fields
  report("texture", 0.55, "Projecting your photos onto the surface");
  await yield_();
  const measuredSkin = meanSkinRgb(segs[frontIdx]) ?? template.skinRgb;
  // Photos carry the room's exposure and colour cast, and the studio brings
  // its own light: used raw, a dim warm room bakes in as dark orange skin.
  // Bring the skin into the template's albedo range — exposure only part-way
  // (darker skin must stay darker) — and ease an extreme cast towards it.
  const albedoGain = skinCalibration(linearOf(measuredSkin), linearOf(template.skinRgb));
  const frontLin = linearOf(measuredSkin).map((c, i) => c * albedoGain[i]) as [number, number, number];
  const frontSkin = frontLin.map((c) => 255 * linearToSrgb(c)) as [number, number, number];
  const n = warp.positions.length / 3;
  const views: BakeView[] = frames.map((f, k) => {
    const { P, Fl, Pl, wl, affine, focal, project } = cams[k];
    // residuals at confident landmarks
    const faceW = Math.abs(P[454 * 3] - P[234 * 3]);
    const cap = faceW * 0.04;
    const centres: number[] = [];
    const vals: number[] = [];
    const wts: number[] = [];
    for (let i = 0; i < 468; i++) {
      // Outline points slide around the face with the head's rotation (they
      // mark the silhouette, not a fixed spot on the skin): pulling the photo
      // onto them shifts everything near the ears. Features only.
      if (wl[i] < 0.08 || OVAL_SET.has(i)) continue;
      const q = project(Fl[i * 3], Fl[i * 3 + 1], Fl[i * 3 + 2]);
      let dx = Pl[i * 3] - q[0],
        dy = Pl[i * 3 + 1] - q[1];
      const mag = Math.hypot(dx, dy);
      if (mag > cap) {
        dx *= cap / mag;
        dy *= cap / mag;
      }
      centres.push(Fl[i * 3], Fl[i * 3 + 1], Fl[i * 3 + 2]);
      vals.push(dx, dy);
      wts.push(wl[i]);
    }
    if (process.env.NODE_ENV !== "production" && vals.length) {
      let sx = 0,
        sy = 0,
        sm = 0;
      for (let q = 0; q < vals.length; q += 2) {
        sx += vals[q];
        sy += vals[q + 1];
        sm += Math.hypot(vals[q], vals[q + 1]);
      }
      const nn = vals.length / 2;
      console.info(`[likeness] view ${k} yaw ${f.pose.yaw.toFixed(0)} resid mean (${(sx / nn).toFixed(1)}, ${(sy / nn).toFixed(1)}) |r| ${(sm / nn).toFixed(1)}px`);
    }
    const residual = new Float32Array(n * 2);
    if (centres.length > 10) {
      const field = fitRbf(centres, vals, 2, 0.02, 5e-2, wts);
      const out = [0, 0];
      for (let i = 0; i < n; i++) {
        field(warp.positions[i * 3], warp.positions[i * 3 + 1], warp.positions[i * 3 + 2], out);
        residual[i * 2] = out[0];
        residual[i * 2 + 1] = out[1];
      }
    }
    const shading = fitShading({
      positions: warp.positions,
      normals: geometry.getAttribute("normal").array as Float32Array,
      feat: geometry.getAttribute("aFeat").array as Float32Array,
      affine,
      focal,
      residual,
      skinMask: segs[k].skinMask,
      pixels: segs[k].pixels,
      width: f.width,
      height: f.height,
    });
    const viewSkin = meanSkinRgb(segs[k]);
    const vl = viewSkin ? linearOf(viewSkin) : linearOf(measuredSkin);
    const frontRaw = linearOf(measuredSkin);
    const gain = [0, 1, 2].map((c) => albedoGain[c] * Math.min(1.4, Math.max(0.7, frontRaw[c] / Math.max(1e-4, vl[c])))) as [number, number, number];
    return {
      image: f.image,
      width: f.width,
      height: f.height,
      affine,
      focal,
      residual,
      skinMask: segs[k].skinMask,
      gain,
      shading,
      // The front photo owns the face; the others fill the sides and under the chin.
      weight: k === frontIdx ? 2.5 : Math.max(0.35, f.quality.score),
      featureKeep: k === frontIdx ? 1 : 0.02,
      // side photos: the face only (see the bake), ~1.5 cm in front of the tragus and forward
      reachZ: k === frontIdx ? undefined : Math.max(F[234 * 3 + 2], F[454 * 3 + 2]) + 0.012,
    };
  });

  // Lab: projections of the head into each photo, to check registration by eye.
  const dbg = (globalThis as unknown as { __DEBUG_PROJ__?: unknown[] }).__DEBUG_PROJ__;
  if (dbg && process.env.NODE_ENV !== "production") {
    const ears = new Set(template.rig.ears ?? []);
    views.forEach((v, k) => {
      const pts: number[] = [];
      for (let i = 0; i < n; i += 3) {
        const q = cams[k].project(warp.positions[i * 3], warp.positions[i * 3 + 1], warp.positions[i * 3 + 2]);
        pts.push(q[0] + v.residual[i * 2], -(q[1] + v.residual[i * 2 + 1]), ears.has(i) ? 1 : 0);
      }
      const A = cams[k].affine;
      const rn = (r: number) => Math.hypot(A[r * 4], A[r * 4 + 1], A[r * 4 + 2]).toFixed(0);
      console.info(`[likeness] cam ${k} rows ${rn(0)} ${rn(1)} ${rn(2)} focal ${cams[k].focal.toFixed(0)} zEar ${(A[8] * warp.positions[(template.rig.ears?.[0] ?? 0) * 3] + A[9] * warp.positions[(template.rig.ears?.[0] ?? 0) * 3 + 1] + A[10] * warp.positions[(template.rig.ears?.[0] ?? 0) * 3 + 2] + A[11]).toFixed(0)}`);
      dbg.push({ img: frames[k].image.toDataURL("image/jpeg", 0.8), w: frames[k].width, h: frames[k].height, pts });
    });
  }

  report("texture", 0.7, "Baking a 2K skin texture");
  await yield_();
  const tl = linearOf(template.skinRgb);
  const skinRatio = [0, 1, 2].map((c) => Math.min(2.5, Math.max(0.3, frontLin[c] / Math.max(1e-4, tl[c])))) as [number, number, number];
  const bake = bakeTexture(geometry, views, template.albedo, skinRatio, opts.atlasSize ?? 2048, jawPlane(F), frontLin);

  // 5) analysis + rig in the new head's own frame
  report("analyze", 0.86, "Reading your hair, beard and skin tone");
  await yield_();
  const sides = segs.filter((_, i) => i !== frontIdx && Math.abs(frames[i].pose.yaw) > 20);
  const hb = estimateHairAndBeard(segs[frontIdx], sides);
  const rig = buildRig(F, warp.positions, { scale: 1 });
  rig.ears = template.rig.ears;
  const positions = new Float32Array(warp.positions.length);
  const M = rig.meshToHead;
  for (let i = 0; i < n; i++) {
    positions[i * 3] = warp.positions[i * 3] + M[12];
    positions[i * 3 + 1] = warp.positions[i * 3 + 1] + M[13];
    positions[i * 3 + 2] = warp.positions[i * 3 + 2] + M[14];
  }
  rig.meshToHead = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const analysis = buildAnalysis(rig, frontSkin, hb.natural, hb.beard);
  analysis.hair.lengthClass = hb.lengthClass;
  analysis.eyeColor = sampleIrisColor(frames[frontIdx]);

  report("finish", 0.95, "Finishing your twin");
  const albedo = await new Promise<Blob>((res, rej) => bake.canvas.toBlob((b) => (b ? res(b) : rej(new Error("encode failed"))), "image/jpeg", 0.92));
  const thumbnail = await faceThumbnail(frames[frontIdx]).catch(() => null);
  const record: InstantTwinRecord = {
    id: crypto.randomUUID(),
    createdAt: Date.now(),
    name: opts.name ?? "My twin",
    positions,
    albedo,
    thumbnail,
    rig,
    analysis,
    natural: hb.natural,
    skinRgb: frontSkin,
    bakedBeard: hb.bakedBeard,
    coverage: bake.coverage,
    remoteId: null,
  };
  if (opts.persist !== false) await avatarVault.put(record);
  geometry.dispose();
  report("finish", 1, "Your twin is ready");
  if (process.env.NODE_ENV !== "production") {
    console.info("[recon]", JSON.stringify({ rms: fusion.rmsError, metric: m, warpResidual: warp.residualRms, affine: warp.affine.map((v) => +v.toFixed(3)), coverage: bake.coverage, gains: views.map((v) => v.gain), shading: views.map((v) => v.shading && { ref: +v.shading.ref.toFixed(4), sh: v.shading.sh.map((c) => +(c / v.shading!.ref).toFixed(2)) }) }));
    console.info("[likeness] outline", JSON.stringify(outline && { used: outline.used, rows: outline.rows, ratio: +outline.meanRatio.toFixed(3) }));
    console.info("[likeness] skin", JSON.stringify({ measured: measuredSkin.map(Math.round), template: template.skinRgb.map(Math.round), albedoGain, frontSkin: frontSkin.map(Math.round) }));
  }
  return record;
}

const lum = (c: ArrayLike<number>) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
const linearToSrgb = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(Math.max(0, c), 1 / 2.4) - 0.055);

/**
 * Per-channel gain (linear) from the photographed skin to an albedo: exposure
 * 75 % of the way (in log) to the template's skin brightness — a dim room and
 * darker skin look alike to a camera, so never all the way — and chroma 35 %
 * of the way to the template's hue.
 */
export function skinCalibration(skin: [number, number, number], template: [number, number, number]): [number, number, number] {
  const Lu = Math.max(1e-4, lum(skin)),
    Lt = Math.max(1e-4, lum(template));
  const expo = Math.min(2.8, Math.max(0.85, Math.pow(Lt / Lu, 0.75)));
  const g = [0, 1, 2].map((c) => {
    const cu = skin[c] / Lu,
      ct = template[c] / Lt;
    return (cu + (ct - cu) * 0.35) / Math.max(1e-4, cu);
  });
  // keep the chroma change luminance-neutral
  const Lg = lum([skin[0] * g[0], skin[1] * g[1], skin[2] * g[2]]) / Lu;
  return [0, 1, 2].map((c) => (g[c] / Lg) * expo) as [number, number, number];
}

const OVAL_SET = new Set(FACE_OVAL);
const CAM_RIDGE = () => (globalThis as unknown as { __CAMRIDGE__?: number }).__CAMRIDGE__ ?? 468 * 2e-4;

/** Per-photo camera: weak perspective fitted to the landmarks, then perspective-corrected. */
function fitViewCamera(f: CaptureFrame, X: Float64Array | Float32Array, fusionView: { weights: Float64Array; sim: { s: number; R: number[]; t: number[] } }, m: number) {
  const P = toImageSpace(f);
  const { s, R, t } = fusionView.sim;
  // prior camera from the fusion similarity: P ≈ (1/(s·m)) Rᵀ F − (1/s) Rᵀ t
  const inv = 1 / (s * m);
  const prior = [
    inv * R[0], inv * R[3], inv * R[6], -(R[0] * t[0] + R[3] * t[1] + R[6] * t[2]) / s,
    inv * R[1], inv * R[4], inv * R[7], -(R[1] * t[0] + R[4] * t[1] + R[7] * t[2]) / s,
    inv * R[2], inv * R[5], inv * R[8], -(R[2] * t[0] + R[5] * t[1] + R[8] * t[2]) / s,
  ];
  const Fl = X.subarray(0, 468 * 3);
  const Pl = P.subarray(0, 468 * 3);
  // Features only: the outline points mark the silhouette of each view, not a
  // fixed spot on the skin.
  const wl = Float64Array.from(fusionView.weights.subarray(0, 468), (v, i) => (OVAL_SET.has(i) ? 0 : v));
  // Perspective camera: a selfie is taken from ~30 cm, where ears and the back
  // of the head sit several cm further away than the face and are imaged
  // smaller. Fit a weak-perspective camera to perspective-undone landmarks,
  // re-derive their depths from it, repeat. Projection:
  //   image = c + (A·x − c) / (1 − z/f),  z = camera depth of x (px).
  // Depth comes from the camera's own rotation (the tracker's depth is
  // compressed), with z = 0 at the landmarks' centroid, where the scale holds.
  const focal = ((globalThis as unknown as { __FOCAL__?: number }).__FOCAL__ ?? PHONE_FOCAL) * Math.max(f.width, f.height);
  const cx = f.width / 2,
    cy = -f.height / 2;
  let wsum = 0;
  const cen = [0, 0, 0];
  for (let i = 0; i < 468; i++) {
    wsum += wl[i];
    for (let a = 0; a < 3; a++) cen[a] += wl[i] * Fl[i * 3 + a];
  }
  for (let a = 0; a < 3; a++) cen[a] /= wsum || 1;
  const rigidDepth = (A: number[]) => {
    const r0 = [A[0], A[1], A[2]],
      r1 = [A[4], A[5], A[6]];
    const n0 = Math.hypot(r0[0], r0[1], r0[2]) || 1,
      n1 = Math.hypot(r1[0], r1[1], r1[2]) || 1;
    const sc = (n0 + n1) / 2;
    let z = [(r0[1] * r1[2] - r0[2] * r1[1]) / (n0 * n1), (r0[2] * r1[0] - r0[0] * r1[2]) / (n0 * n1), (r0[0] * r1[1] - r0[1] * r1[0]) / (n0 * n1)];
    const zl = Math.hypot(z[0], z[1], z[2]) || 1;
    z = z.map((v) => (v / zl) * sc);
    A[8] = z[0];
    A[9] = z[1];
    A[10] = z[2];
    A[11] = -(z[0] * cen[0] + z[1] * cen[1] + z[2] * cen[2]);
    return A;
  };
  let affine = rigidDepth(fitAffine(Fl, Pl, wl, CAM_RIDGE(), prior));
  const Pc = Float64Array.from(Pl);
  for (let it = 0; it < 5; it++) {
    for (let i = 0; i < 468; i++) {
      const z = affine[8] * Fl[i * 3] + affine[9] * Fl[i * 3 + 1] + affine[10] * Fl[i * 3 + 2] + affine[11];
      const w = Math.max(0.5, 1 - z / focal);
      Pc[i * 3] = cx + (Pl[i * 3] - cx) * w;
      Pc[i * 3 + 1] = cy + (Pl[i * 3 + 1] - cy) * w;
    }
    affine = rigidDepth(fitAffine(Fl, Pc, wl, CAM_RIDGE(), prior));
  }
  const project = (x: number, y: number, z: number) => {
    const q = applyAffine(affine, x, y, z);
    const w = Math.max(0.5, 1 - q[2] / focal);
    return [cx + (q[0] - cx) / w, cy + (q[1] - cy) / w];
  };

  return { P, Fl, Pl, wl, affine, focal, project };
}

/** The jaw line as a plane through the chin and both jaw angles, normal pointing up into the face. */
function jawPlane(F: ArrayLike<number>): [number, number, number, number] {
  const p = (i: number) => [F[i * 3], F[i * 3 + 1], F[i * 3 + 2]];
  const c = p(152),
    a = p(172),
    b = p(397);
  const u = [a[0] - c[0], a[1] - c[1], a[2] - c[2]],
    v = [b[0] - c[0], b[1] - c[1], b[2] - c[2]];
  let n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  const l = Math.hypot(n[0], n[1], n[2]) || 1;
  n = n.map((x) => x / l);
  if (n[1] < 0) n = n.map((x) => -x);
  return [n[0], n[1], n[2], n[0] * c[0] + n[1] * c[1] + n[2] * c[2]];
}

/** Template vertex normal nearest to each landmark (for visibility weights). */
export function templateLandmarkNormals(t: HeadAsset): Float32Array {
  const pos = t.geometry.getAttribute("position");
  const nrm = t.geometry.getAttribute("normal");
  const L = t.rig.landmarks;
  const out = new Float32Array(478 * 3);
  for (let i = 0; i < 478; i++) {
    let best = 0,
      bestD = Infinity;
    for (let v = 0; v < pos.count; v++) {
      const d = (pos.getX(v) - L[i * 3]) ** 2 + (pos.getY(v) - L[i * 3 + 1]) ** 2 + (pos.getZ(v) - L[i * 3 + 2]) ** 2;
      if (d < bestD) {
        bestD = d;
        best = v;
      }
    }
    out[i * 3] = nrm.getX(best);
    out[i * 3 + 1] = nrm.getY(best);
    out[i * 3 + 2] = nrm.getZ(best);
  }
  return out;
}

/** A small square crop of the face from the front photo, for the twin list (stays on the device). */
function faceThumbnail(f: CaptureFrame, size = 160): Promise<Blob | null> {
  const L = f.landmarks;
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity;
  for (let i = 0; i < 468; i++) {
    const x = L[i * 3] * f.width,
      y = L[i * 3 + 1] * f.height;
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  }
  const side = Math.max(x1 - x0, y1 - y0) * 1.35;
  const cx = (x0 + x1) / 2,
    cy = (y0 + y1) / 2 - side * 0.04;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  c.getContext("2d")!.drawImage(f.image, cx - side / 2, cy - side / 2, side, side, 0, 0, size, size);
  return new Promise((res) => c.toBlob(res, "image/jpeg", 0.82));
}
