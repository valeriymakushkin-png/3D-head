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

/**
 * Synthetic selfie session for pipeline QA: renders a *reshaped* copy of the
 * template (narrower, longer face) from the capture poses, then runs the
 * production landmarker on each render. Reconstruction must recover the
 * reshaped proportions, not the template's.
 */
export async function syntheticCapture(template: HeadAsset): Promise<{ frames: CaptureFrame[]; log: string[] }> {
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
    pos.setX(i, pos.getX(i) * 0.93);
    pos.setY(i, pos.getY(i) * 1.04);
  }
  geo.computeVertexNormals();
  const mesh = new Mesh(geo, new MeshStandardMaterial({ map: template.albedo, roughness: 0.6 }));
  scene.add(mesh);
  scene.add(new AmbientLight(0xffffff, 1.1));
  const key = new DirectionalLight(0xffffff, 1.8);
  key.position.set(0.3, 0.4, 1);
  scene.add(key);
  const camera = new PerspectiveCamera(50, W / H, 0.01, 10);
  camera.position.set(0, -0.02, 0.42);
  camera.lookAt(0, -0.03, 0);

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
    mesh.rotation.set((pitch * Math.PI) / 180, (yaw * Math.PI) / 180, 0, "YXZ");
    renderer.render(scene, camera);
    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    canvas.getContext("2d")!.drawImage(renderer.domElement, 0, 0);
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
  renderer.dispose();
  renderer.forceContextLoss();
  return { frames, log };
}
