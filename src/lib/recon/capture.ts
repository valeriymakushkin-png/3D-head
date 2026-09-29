"use client";

import type { FaceLandmarkerResult } from "@mediapipe/tasks-vision";
import { getFaceLandmarker, poseFromMatrix } from "@/lib/recon/mediapipe";
import { POSE_TARGETS, binForPose, measureFrame, scoreQuality } from "@/lib/recon/poses";
import type { CaptureFrame } from "@/lib/recon/types";

const MAX_SIDE = 1600;

/** Copies a source into a canvas capped at MAX_SIDE (keeps texture detail, bounds memory). */
export function snapshot(source: CanvasImageSource, w: number, h: number): HTMLCanvasElement {
  const k = Math.min(1, MAX_SIDE / Math.max(w, h));
  const c = document.createElement("canvas");
  c.width = Math.round(w * k);
  c.height = Math.round(h * k);
  c.getContext("2d", { willReadFrequently: true })!.drawImage(source, 0, 0, c.width, c.height);
  return c;
}

/** Turns a landmarker result + image into a CaptureFrame (or null if unusable). */
export function toFrame(res: FaceLandmarkerResult, image: HTMLCanvasElement, source: CaptureFrame["source"]): CaptureFrame | null {
  if (!res.faceLandmarks.length || !res.facialTransformationMatrixes?.length) return null;
  const landmarks = new Float32Array(res.faceLandmarks[0].flatMap((l) => [l.x, l.y, l.z]));
  const matrix = new Float32Array(res.facialTransformationMatrixes[0].data);
  const pose = poseFromMatrix(matrix);
  const target = binForPose(pose.yaw, pose.pitch);
  const nearest = target ?? nearestTarget(pose.yaw, pose.pitch);
  const err = Math.hypot(pose.yaw - nearest.yaw, pose.pitch - nearest.pitch);
  const q = measureFrame(image, image.width, image.height, landmarks);
  return {
    id: crypto.randomUUID(),
    image,
    width: image.width,
    height: image.height,
    landmarks,
    matrix,
    pose,
    quality: scoreQuality(q, err),
    source,
    bin: nearest.id,
  };
}

function nearestTarget(yaw: number, pitch: number) {
  return POSE_TARGETS.reduce((b, t) => (Math.hypot(yaw - t.yaw, pitch - t.pitch) < Math.hypot(yaw - b.yaw, pitch - b.pitch) ? t : b));
}

/** Uploaded photos: honours EXIF orientation, one face per photo. */
export async function framesFromPhotos(files: File[], onEach?: (done: number, total: number) => void): Promise<{ frames: CaptureFrame[]; rejected: string[] }> {
  const detector = await getFaceLandmarker("IMAGE");
  const frames: CaptureFrame[] = [];
  const rejected: string[] = [];
  for (const [i, file] of files.entries()) {
    try {
      const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
      const canvas = snapshot(bmp, bmp.width, bmp.height);
      bmp.close();
      const f = toFrame(detector.detect(canvas), canvas, "upload");
      if (f) frames.push(f);
      else rejected.push(file.name);
    } catch {
      rejected.push(file.name);
    }
    onEach?.(i + 1, files.length);
  }
  return { frames, rejected };
}

/** A 15-second selfie video: sample frames every 150 ms and keep the best per pose. */
export async function framesFromVideo(file: File, onProgress?: (p: number) => void): Promise<CaptureFrame[]> {
  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.src = url;
  video.muted = true;
  video.playsInline = true;
  await new Promise<void>((res, rej) => {
    video.onloadedmetadata = () => res();
    video.onerror = () => rej(new Error("Unsupported video"));
  });
  const detector = await getFaceLandmarker("VIDEO");
  const duration = Math.min(video.duration, 30);
  const out: CaptureFrame[] = [];
  let ts = 0;
  for (let t = 0.05; t < duration; t += 0.15) {
    video.currentTime = t;
    await new Promise<void>((res) => (video.onseeked = () => res()));
    const canvas = snapshot(video, video.videoWidth, video.videoHeight);
    ts += 150;
    const f = toFrame(detector.detectForVideo(canvas, ts), canvas, "video");
    if (f) out.push(f);
    onProgress?.(t / duration);
  }
  URL.revokeObjectURL(url);
  return out;
}
