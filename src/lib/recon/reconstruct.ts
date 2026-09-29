"use client";

import type { BufferGeometry } from "three";
import { Float32BufferAttribute } from "three";
import { type HeadAsset, buildAnalysis, loadTemplateHead } from "@/lib/head/asset";
import { buildRig } from "@/lib/head/rig";
import { type SegmentedFrame, estimateHairAndBeard, linearOf, meanSkinRgb, segmentFrame } from "@/lib/recon/analyze";
import { bakeTexture, type BakeView } from "@/lib/recon/bake";
import { fuseLandmarks, toImageSpace } from "@/lib/recon/fusion";
import { applyAffine, fitAffine, fitRbf } from "@/lib/recon/linalg";
import { type InstantTwinRecord, avatarVault } from "@/lib/recon/storage";
import type { CaptureFrame, ReconProgress } from "@/lib/recon/types";
import { warpTemplate } from "@/lib/recon/warp";

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
  const T = template.rig.landmarks;
  const templatePositions = template.geometry.getAttribute("position").array as Float32Array;
  const templateNormals = landmarkNormals(template);

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
  const warp = warpTemplate(templatePositions, T, F);
  const geometry: BufferGeometry = template.geometry.clone();
  geometry.setAttribute("position", new Float32BufferAttribute(warp.positions, 3));
  geometry.computeVertexNormals();

  // 4) cameras + per-view landmark residual fields
  report("texture", 0.55, "Projecting your photos onto the surface");
  await yield_();
  const frontSkin = meanSkinRgb(segs[frontIdx]) ?? template.skinRgb;
  const frontLin = linearOf(frontSkin);
  const n = warp.positions.length / 3;
  const views: BakeView[] = frames.map((f, k) => {
    const P = toImageSpace(f);
    const w = fusion.views[k].weights;
    const { s, R, t } = fusion.views[k].sim;
    // prior camera from the fusion similarity: P ≈ (1/(s·m)) Rᵀ F − (1/s) Rᵀ t
    const inv = 1 / (s * m);
    const prior = [
      inv * R[0], inv * R[3], inv * R[6], -(R[0] * t[0] + R[3] * t[1] + R[6] * t[2]) / s,
      inv * R[1], inv * R[4], inv * R[7], -(R[1] * t[0] + R[4] * t[1] + R[7] * t[2]) / s,
      inv * R[2], inv * R[5], inv * R[8], -(R[2] * t[0] + R[5] * t[1] + R[8] * t[2]) / s,
    ];
    const Fl = F.subarray(0, 468 * 3);
    const Pl = P.subarray(0, 468 * 3);
    const wl = w.subarray(0, 468);
    const affine = fitAffine(Fl, Pl, wl, 468 * 2e-4, prior);

    // residuals at confident landmarks
    const faceW = Math.abs(P[454 * 3] - P[234 * 3]);
    const cap = faceW * 0.04;
    const centres: number[] = [];
    const vals: number[] = [];
    const wts: number[] = [];
    for (let i = 0; i < 468; i++) {
      if (wl[i] < 0.08) continue;
      const q = applyAffine(affine, Fl[i * 3], Fl[i * 3 + 1], Fl[i * 3 + 2]);
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
    const viewSkin = meanSkinRgb(segs[k]);
    const vl = viewSkin ? linearOf(viewSkin) : frontLin;
    const gain = [0, 1, 2].map((c) => Math.min(1.4, Math.max(0.7, frontLin[c] / Math.max(1e-4, vl[c])))) as [number, number, number];
    return {
      image: f.image,
      width: f.width,
      height: f.height,
      affine,
      residual,
      skinMask: segs[k].skinMask,
      gain,
      weight: k === frontIdx ? 1.4 : Math.max(0.35, f.quality.score),
    };
  });

  report("texture", 0.7, "Baking a 2K skin texture");
  await yield_();
  const tl = linearOf(template.skinRgb);
  const skinRatio = [0, 1, 2].map((c) => Math.min(2.5, Math.max(0.3, frontLin[c] / Math.max(1e-4, tl[c])))) as [number, number, number];
  const bake = bakeTexture(geometry, views, template.albedo, skinRatio, opts.atlasSize ?? 2048);

  // 5) analysis + rig in the new head's own frame
  report("analyze", 0.86, "Reading your hair, beard and skin tone");
  await yield_();
  const sides = segs.filter((_, i) => i !== frontIdx && Math.abs(frames[i].pose.yaw) > 20);
  const hb = estimateHairAndBeard(segs[frontIdx], sides);
  const rig = buildRig(F, warp.positions, { scale: 1 });
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

  report("finish", 0.95, "Finishing your twin");
  const albedo = await new Promise<Blob>((res, rej) => bake.canvas.toBlob((b) => (b ? res(b) : rej(new Error("encode failed"))), "image/jpeg", 0.92));
  const record: InstantTwinRecord = {
    id: crypto.randomUUID(),
    createdAt: Date.now(),
    name: opts.name ?? "My twin",
    positions,
    albedo,
    thumbnail: null,
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
    console.info("[recon]", { rms: fusion.rmsError, metric: m, warpResidual: warp.residualRms, coverage: bake.coverage, analysis });
  }
  return record;
}

/** Template vertex normal nearest to each landmark (for visibility weights). */
function landmarkNormals(t: HeadAsset): Float32Array {
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
