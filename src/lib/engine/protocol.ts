import type { StrandMeshData } from "@/lib/hair/generate";
import type { BeardParams, HairParams } from "@/lib/hair/params";
import type { HeadRig } from "@/lib/head/rig";

/** Messages between the main thread and the avatar worker. */
export type WorkerRequest =
  | {
      type: "prepare";
      headId: string;
      positions: Float32Array;
      normals: Float32Array;
      index: Uint32Array;
      rig: HeadRig;
      quality: QualityTier;
    }
  | { type: "hair"; headId: string; reqId: number; params: HairParams; seed: number; quality: QualityTier }
  | { type: "beard"; headId: string; reqId: number; params: BeardParams; seed: number; quality: QualityTier }
  | { type: "dispose"; headId: string };

export type WorkerResponse =
  | { type: "prepared"; headId: string; ms: number; scalpRoots: number; faceSamples: number; skinVis: Uint8Array; skinAO: Uint8Array }
  | { type: "strands"; headId: string; reqId: number; kind: "hair" | "beard"; data: StrandMeshData; ms: number }
  | { type: "error"; headId: string; reqId?: number; message: string };

export type QualityTier = "ultra" | "high" | "medium" | "low" | "offline";

export const QUALITY_BUDGETS: Record<
  QualityTier,
  { hairVerts: number; hairStrands: number; beardVerts: number; scalpCandidates: number; faceCandidates: number; segment?: number }
> = {
  ultra: { hairVerts: 1_400_000, hairStrands: 150_000, beardVerts: 260_000, scalpCandidates: 200_000, faceCandidates: 140_000 },
  high: { hairVerts: 900_000, hairStrands: 110_000, beardVerts: 180_000, scalpCandidates: 160_000, faceCandidates: 110_000 },
  medium: { hairVerts: 480_000, hairStrands: 70_000, beardVerts: 110_000, scalpCandidates: 110_000, faceCandidates: 80_000 },
  low: { hairVerts: 220_000, hairStrands: 38_000, beardVerts: 60_000, scalpCandidates: 60_000, faceCandidates: 50_000 },
  /** Offline path-traced renders only (scripts/cycles) — never used for real-time. */
  offline: { hairVerts: 16_000_000, hairStrands: 160_000, beardVerts: 1_600_000, scalpCandidates: 420_000, faceCandidates: 320_000, segment: 0.0035 },
};

/** Thumbnails use a fixed small budget so the carousel stays cheap. */
export const THUMBNAIL_QUALITY: QualityTier = "low";
