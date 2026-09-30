"use client";

import type { FaceLandmarker, ImageSegmenter, NormalizedLandmark } from "@mediapipe/tasks-vision";

/**
 * MediaPipe Tasks, self-hosted under /public/mediapipe (see
 * scripts/copy-mediapipe.mjs). Loaded lazily — the ~12 MB WASM runtime only
 * downloads when a user starts a capture.
 */
const WASM_PATH = "/mediapipe/wasm";
const FACE_MODEL = "/mediapipe/models/face_landmarker.task";
const SEG_MODEL = "/mediapipe/models/selfie_multiclass_256x256.tflite";

type Vision = typeof import("@mediapipe/tasks-vision");
let visionPromise: Promise<Vision> | null = null;
let filesetPromise: Promise<Awaited<ReturnType<Vision["FilesetResolver"]["forVisionTasks"]>>> | null = null;
const landmarkers = new Map<"IMAGE" | "VIDEO", Promise<FaceLandmarker>>();
let segmenter: Promise<ImageSegmenter> | null = null;

/**
 * MediaPipe Tasks reports usage to Google (odml.pa.googleapis.com). Our CSP
 * already blocks it — "nothing leaves your device" — but the blocked request
 * surfaces as console errors, so answer it locally instead.
 */
let telemetryMuted = false;
function muteTelemetry() {
  if (telemetryMuted || typeof window === "undefined") return;
  telemetryMuted = true;
  const real = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.startsWith("https://odml.pa.googleapis.com/")) return Promise.resolve(new Response(null, { status: 204 }));
    return real(input, init);
  };
}

// Failed loads are not cached, so a flaky mobile connection can simply retry.
function vision() {
  muteTelemetry();
  visionPromise ??= import("@mediapipe/tasks-vision").catch((e) => {
    visionPromise = null;
    throw e;
  });
  return visionPromise;
}

async function fileset() {
  const v = await vision();
  filesetPromise ??= v.FilesetResolver.forVisionTasks(WASM_PATH).catch((e) => {
    filesetPromise = null;
    throw e;
  });
  return filesetPromise;
}

/**
 * Every iOS browser is WebKit, whose WebGL path in MediaPipe is unreliable
 * (the GPU delegate can initialise and then silently find no faces). The
 * CPU (XNNPACK) delegate is fast enough there for 30 fps face tracking.
 */
export function isAppleMobile(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

let forceCpu = isAppleMobile();

async function withGpuFallback<T>(make: (delegate: "GPU" | "CPU") => Promise<T>): Promise<T> {
  if (forceCpu) return make("CPU");
  try {
    return await make("GPU");
  } catch (err) {
    console.warn("[mediapipe] GPU delegate unavailable, falling back to CPU", err);
    return make("CPU");
  }
}

/**
 * Drops cached landmarkers and uses the CPU delegate from now on — for when
 * the GPU delegate initialised but fails at inference time.
 */
export function fallBackToCpu() {
  if (forceCpu) return false;
  forceCpu = true;
  for (const p of landmarkers.values()) p.then((l) => l.close()).catch(() => undefined);
  landmarkers.clear();
  return true;
}

/** Downloads the WASM runtime + face model ahead of time (e.g. while the camera starts). */
export function preloadFaceTracking() {
  getFaceLandmarker("VIDEO").catch(() => undefined);
}

export function getFaceLandmarker(mode: "IMAGE" | "VIDEO"): Promise<FaceLandmarker> {
  let p = landmarkers.get(mode);
  if (!p) {
    p = (async () => {
      const [v, fs] = await Promise.all([vision(), fileset()]);
      return withGpuFallback((delegate) =>
        v.FaceLandmarker.createFromOptions(fs, {
          baseOptions: { modelAssetPath: FACE_MODEL, delegate },
          runningMode: mode,
          numFaces: 1,
          outputFacialTransformationMatrixes: true,
          outputFaceBlendshapes: true,
          minFaceDetectionConfidence: 0.5,
          minFacePresenceConfidence: 0.5,
          minTrackingConfidence: 0.5,
        }),
      );
    })();
    landmarkers.set(mode, p);
    p.catch(() => landmarkers.get(mode) === p && landmarkers.delete(mode));
  }
  return p;
}

/** Selfie multiclass: 0 bg, 1 hair, 2 body-skin, 3 face-skin, 4 clothes, 5 other. */
export const SEG_CLASSES = { background: 0, hair: 1, bodySkin: 2, faceSkin: 3, clothes: 4, other: 5 } as const;

export function getSegmenter(): Promise<ImageSegmenter> {
  segmenter ??= (async () => {
    const [v, fs] = await Promise.all([vision(), fileset()]);
    return withGpuFallback((delegate) =>
      v.ImageSegmenter.createFromOptions(fs, {
        baseOptions: { modelAssetPath: SEG_MODEL, delegate },
        runningMode: "IMAGE",
        outputCategoryMask: true,
        outputConfidenceMasks: false,
      }),
    );
  })();
  return segmenter;
}

export type Landmarks = NormalizedLandmark[];

/**
 * Head pose from MediaPipe's facial transformation matrix (column-major 4×4,
 * canonical face → camera). Returns degrees; yaw > 0 = subject turned to
 * THEIR left (face points to screen-right in a non-mirrored image).
 */
export function poseFromMatrix(m: ArrayLike<number>): { yaw: number; pitch: number; roll: number } {
  // rotation part, column-major: r00=m[0], r10=m[1], r20=m[2], r01=m[4] ...
  const r00 = m[0],
    r10 = m[1],
    r20 = m[2],
    r21 = m[6],
    r22 = m[10];
  const yaw = Math.atan2(-r20, Math.hypot(r00, r10));
  const pitch = Math.atan2(r21, r22);
  const roll = Math.atan2(r10, r00);
  const deg = 180 / Math.PI;
  return { yaw: yaw * deg, pitch: pitch * deg, roll: roll * deg };
}
