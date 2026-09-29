#!/usr/bin/env bash
# MediaPipe models (Apache-2.0) used by the worker — same files as the web app.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p models
curl -fsSL -o models/face_landmarker.task \
  https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task
curl -fsSL -o models/selfie_multiclass_256x256.tflite \
  https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_multiclass_256x256/float32/latest/selfie_multiclass_256x256.tflite
echo "models ready"
