/** A single accepted capture: a still frame + its face measurement. */
export interface CaptureFrame {
  id: string;
  /** Un-mirrored RGB frame, long side ≤ 1600 px. */
  image: HTMLCanvasElement;
  width: number;
  height: number;
  /** 478 × (x, y, z) normalised MediaPipe landmarks. */
  landmarks: Float32Array;
  /** MediaPipe facial transformation matrix (column-major 4×4). */
  matrix: Float32Array;
  pose: { yaw: number; pitch: number; roll: number };
  quality: FrameQuality;
  source: "guided" | "upload" | "video";
  /** Pose bin this frame fills (see poses.ts). */
  bin: PoseBinId;
}

export interface FrameQuality {
  /** Variance of the Laplacian on the face crop (higher = sharper). */
  sharpness: number;
  /** Mean face luminance 0..255. */
  brightness: number;
  /** Face height / image height. */
  faceScale: number;
  /** Combined 0..1 score used to keep the best frame per bin. */
  score: number;
  issues: Array<"blurry" | "dark" | "bright" | "small" | "far-angle">;
}

export type PoseBinId = "front" | "left30" | "left55" | "right30" | "right55" | "up" | "down" | "left80" | "right80";

export type ReconStage = "segment" | "fuse" | "sculpt" | "texture" | "analyze" | "finish";

export interface ReconProgress {
  stage: ReconStage;
  /** 0..1 overall. */
  progress: number;
  message: string;
}
