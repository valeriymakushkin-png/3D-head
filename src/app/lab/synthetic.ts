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
/** The reshaped template (narrower, longer face) as a textured mesh. */
function reshapedTemplate(template: HeadAsset) {
  const geo = template.geometry.clone();
  const pos = geo.getAttribute("position");
  for (let i = 0; i < pos.count; i++) {
    pos.setX(i, pos.getX(i) * SYNTH_SCALE[0]);
    pos.setY(i, pos.getY(i) * SYNTH_SCALE[1]);
  }
  geo.computeVertexNormals();
  return new Mesh(geo, new MeshStandardMaterial({ map: template.albedo, roughness: 0.6 }));
}

/** A head mesh (template space, metres) in a neutral "selfie" setup: 720×960, phone-like camera. */
function syntheticRig(template: HeadAsset, head?: Mesh, distance = 0.34) {
  const W = 720,
    H = 960;
  const renderer = new WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(W, H, false);
  renderer.outputColorSpace = SRGBColorSpace;
  const scene = new Scene();
  scene.background = new Color("#6d7278");
  const mesh = head ?? reshapedTemplate(template);
  scene.add(mesh);
  scene.add(new AmbientLight(0xffffff, 1.1));
  const key = new DirectionalLight(0xffffff, 1.8);
  key.position.set(0.3, 0.4, 1);
  scene.add(key);
  // A phone front camera at arm's length (focal ≈ 0.75 × the long side).
  const camera = new PerspectiveCamera(67.4, W / H, 0.01, 10);
  camera.position.set(0, -0.045, distance);
  camera.lookAt(0, -0.045, 0);
  const render = (yaw: number, pitch: number) => {
    mesh.rotation.set((pitch * Math.PI) / 180, (yaw * Math.PI) / 180, 0, "YXZ");
    renderer.render(scene, camera);
    return renderer.domElement;
  };
  const dispose = () => {
    scene.remove(mesh);
    mesh.rotation.set(0, 0, 0);
    renderer.dispose();
    renderer.forceContextLoss();
  };
  return { W, H, render, dispose };
}

/**
 * A scripted scan at `fps` — look straight, then roll the head in a slow
 * circle (as the guided scan asks) — as JPEG data URLs, fed to Chromium's
 * fake camera to test the live guided scan.
 */
export function syntheticScanVideo(template: HeadAsset, fps = 15, head?: Mesh): { width: number; height: number; frames: string[] } {
  const { W, H, render, dispose } = syntheticRig(template, head);
  const frames: string[] = [];
  const shot = (yaw: number, pitch: number) => frames.push(render(yaw, pitch).toDataURL("image/jpeg", 0.9));
  const A = 50,
    P = 18;
  for (let i = 0; i < 2 * fps; i++) shot(0, 0); // look straight
  for (let i = 1; i <= fps; i++) shot(A * (0.5 - 0.5 * Math.cos((Math.PI * i) / fps)), 0); // ease out to the left
  const loop = 12 * fps; // one slow circle: left → up → right → down → left
  for (let i = 1; i <= loop; i++) {
    const th = (2 * Math.PI * i) / loop;
    shot(A * Math.cos(th), -P * Math.sin(th));
  }
  for (let i = 1; i <= fps; i++) shot(A * (0.5 + 0.5 * Math.cos((Math.PI * i) / fps)), 0);
  for (let i = 0; i < fps; i++) shot(0, 0);
  dispose();
  return { width: W, height: H, frames };
}

export async function syntheticCapture(template: HeadAsset, head?: Mesh, distance?: number): Promise<{ frames: CaptureFrame[]; log: string[] }> {
  const { W, H, render, dispose } = syntheticRig(template, head, distance);
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
