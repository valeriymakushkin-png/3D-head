"use client";

import {
  AmbientLight,
  Color,
  DirectionalLight,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  WebGLRenderer,
} from "three";
import type { HeadAsset } from "@/lib/head/asset";
import { getFaceLandmarker, poseFromMatrix } from "@/lib/recon/mediapipe";
import { binForPose, measureFrame, scoreQuality } from "@/lib/recon/poses";
import type { CaptureFrame } from "@/lib/recon/types";

/** The synthetic person: the template made narrower and longer (ground truth for recon tests). */
export const SYNTH_SCALE = [0.93, 1.04, 1] as const;

/**
 * Synthetic selfie session for pipeline QA: renders a *reshaped* copy of the
 * template (narrower, longer face) from the capture poses, then runs the
 * production landmarker on each render. Reconstruction must recover the
 * reshaped proportions, not the template's.
 */
/** Reshaped template head in a neutral "selfie" setup (720×960, 50° FOV). */
function syntheticRig(template: HeadAsset) {
  const W = 720,
    H = 960;
  const renderer = new WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(W, H, false);
  renderer.outputColorSpace = SRGBColorSpace;
  const scene = new Scene();
  scene.background = new Color("#6d7278");
  const geo = template.geometry.clone();
  const pos = geo.getAttribute("position");
  for (let i = 0; i < pos.count; i++) {
    pos.setX(i, pos.getX(i) * SYNTH_SCALE[0]);
    pos.setY(i, pos.getY(i) * SYNTH_SCALE[1]);
  }
  geo.computeVertexNormals();
  const mesh = new Mesh(geo, new MeshStandardMaterial({ map: template.albedo, roughness: 0.6 }));
  scene.add(mesh);
  scene.add(new AmbientLight(0xffffff, 1.1));
  const key = new DirectionalLight(0xffffff, 1.8);
  key.position.set(0.3, 0.4, 1);
  scene.add(key);
  // A phone front camera at arm's length (focal ≈ 0.75 × the long side).
  const camera = new PerspectiveCamera(67.4, W / H, 0.01, 10);
  camera.position.set(0, -0.02, 0.3);
  camera.lookAt(0, -0.03, 0);
  const render = (yaw: number, pitch: number) => {
    mesh.rotation.set((pitch * Math.PI) / 180, (yaw * Math.PI) / 180, 0, "YXZ");
    renderer.render(scene, camera);
    return renderer.domElement;
  };
  const dispose = () => {
    renderer.dispose();
    renderer.forceContextLoss();
  };
  return { W, H, render, dispose };
}

/**
 * A scripted head turn (front → left → right → up → down) at `fps`, as JPEG
 * data URLs — fed to Chromium's fake camera to test the live guided scan.
 */
export function syntheticScanVideo(template: HeadAsset, fps = 15): { width: number; height: number; frames: string[] } {
  const { W, H, render, dispose } = syntheticRig(template);
  // [yaw, pitch, seconds to get there, seconds to hold]
  const path: Array<[number, number, number, number]> = [
    [0, 0, 0, 1.2],
    [28, 0, 1.2, 0.8],
    [52, 0, 1, 0.8],
    [0, 0, 1.6, 0.3],
    [-28, 0, 1.2, 0.8],
    [-52, 0, 1, 0.8],
    [0, 0, 1.6, 0.3],
    [0, -16, 1, 0.8],
    [0, 16, 1.6, 0.8],
    [0, 0, 1, 1],
  ];
  const frames: string[] = [];
  let [py, pp] = [0, 0];
  for (const [yaw, pitch, move, hold] of path) {
    const n = Math.round(move * fps);
    for (let i = 1; i <= n; i++) {
      const t = 0.5 - 0.5 * Math.cos((Math.PI * i) / n);
      frames.push(render(py + (yaw - py) * t, pp + (pitch - pp) * t).toDataURL("image/jpeg", 0.9));
    }
    for (let i = 0; i < Math.round(hold * fps); i++) frames.push(render(yaw, pitch).toDataURL("image/jpeg", 0.9));
    [py, pp] = [yaw, pitch];
  }
  dispose();
  return { width: W, height: H, frames };
}

export async function syntheticCapture(template: HeadAsset): Promise<{ frames: CaptureFrame[]; log: string[] }> {
  const { W, H, render, dispose } = syntheticRig(template);
  const detector = await getFaceLandmarker("IMAGE");
  const poses: Array<[number, number]> = [
    [0, 0],
    [28, 0],
    [52, 0],
    [-28, 0],
    [-52, 0],
    [0, -16],
    [0, 16],
  ];
  const frames: CaptureFrame[] = [];
  const log: string[] = [];
  for (const [yaw, pitch] of poses) {
    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    canvas.getContext("2d")!.drawImage(render(yaw, pitch), 0, 0);
    const res = detector.detect(canvas);
    if (!res.faceLandmarks.length) {
      log.push(`yaw ${yaw} pitch ${pitch}: no face`);
      continue;
    }
    const lm = new Float32Array(res.faceLandmarks[0].flatMap((l) => [l.x, l.y, l.z]));
    const matrix = new Float32Array(res.facialTransformationMatrixes[0].data);
    const pose = poseFromMatrix(matrix);
    const bin = binForPose(pose.yaw, pose.pitch);
    const q = measureFrame(canvas, W, H, lm);
    log.push(`rendered yaw ${yaw} pitch ${pitch} → measured yaw ${pose.yaw.toFixed(1)} pitch ${pose.pitch.toFixed(1)} bin ${bin?.id ?? "-"}`);
    frames.push({
      id: crypto.randomUUID(),
      image: canvas,
      width: W,
      height: H,
      landmarks: lm,
      matrix,
      pose,
      quality: scoreQuality(q, 0),
      source: "upload",
      bin: bin?.id ?? "front",
    });
  }
  dispose();
  return { frames, log };
}
