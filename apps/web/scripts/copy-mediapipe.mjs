// Self-hosts the MediaPipe WASM runtime and models under /public/mediapipe so
// the capture flow never depends on a third-party CDN at runtime (privacy,
// Telegram WebView CSP, and China/Iran reachability for Telegram users).
import { createWriteStream, existsSync, mkdirSync, cpSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "public", "mediapipe");
const wasmSrc = join(root, "node_modules", "@mediapipe", "tasks-vision", "wasm");

const MODELS = {
  "face_landmarker.task":
    "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
  "selfie_multiclass_256x256.tflite":
    "https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_multiclass_256x256/float32/latest/selfie_multiclass_256x256.tflite",
};

mkdirSync(join(out, "models"), { recursive: true });
cpSync(wasmSrc, join(out, "wasm"), { recursive: true });

for (const [name, url] of Object.entries(MODELS)) {
  const dest = join(out, "models", name);
  if (existsSync(dest) && statSync(dest).size > 0) continue;
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`Failed to download ${url}: ${res.status}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(dest));
  console.log(`[mediapipe] downloaded ${name}`);
}
console.log("[mediapipe] assets ready in public/mediapipe");
