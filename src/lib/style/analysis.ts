import { z } from "zod";
import { type HeadRig, LM, type Vec3, lmk, len, mid, sub } from "@/lib/head/rig";

/**
 * Face analysis from 478 fused landmarks + sampled colours.
 * Everything here is deterministic geometry — the AI Stylist is *grounded*
 * on these numbers rather than guessing from pixels.
 */

export const FACE_SHAPES = ["oval", "round", "square", "oblong", "heart", "diamond"] as const;
export type FaceShape = (typeof FACE_SHAPES)[number];

export const FaceAnalysisSchema = z.object({
  faceShape: z.enum(FACE_SHAPES),
  faceShapeScores: z.record(z.enum(FACE_SHAPES), z.number()),
  metrics: z.object({
    faceLength: z.number(),
    cheekboneWidth: z.number(),
    jawWidth: z.number(),
    foreheadWidth: z.number(),
    chinWidth: z.number(),
    jawAngleDeg: z.number(),
    lengthToWidth: z.number(),
    ipdMm: z.number(),
  }),
  skin: z.object({
    hex: z.string(),
    ita: z.number(),
    category: z.enum(["very_light", "light", "intermediate", "tan", "brown", "dark"]),
    undertone: z.enum(["cool", "neutral", "warm"]),
  }),
  hair: z.object({
    color: z.string(),
    lengthClass: z.enum(["bald", "buzz", "short", "medium", "long"]),
    density: z.number(),
    recession: z.number(),
  }),
  beard: z.object({
    detected: z.enum(["clean", "stubble", "short", "full", "goatee"]),
    coverage: z.number(),
  }),
  /** Iris colour sampled from the front photo (absent for the closed-eyed template). */
  eyeColor: z.string().optional(),
});
export type FaceAnalysis = z.infer<typeof FaceAnalysisSchema>;

function dist(rig: HeadRig, a: number, b: number) {
  return len(sub(lmk(rig, a), lmk(rig, b)));
}

function angleAt(a: Vec3, b: Vec3, c: Vec3) {
  const u = sub(a, b),
    v = sub(c, b);
  const cos = (u[0] * v[0] + u[1] * v[1] + u[2] * v[2]) / (len(u) * len(v));
  return (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI;
}

/**
 * Soft face-shape classification. Landmark 10 sits ~1.5 cm under the
 * hairline, so "faceLength" is trichion-corrected by +8 %. Thresholds are
 * the barbering heuristics (length/width ≈ 1.5 oval, >1.6 oblong, <1.3
 * round/square; jaw ≈ cheekbones → square; forehead ≫ jaw → heart;
 * cheekbones ≫ forehead & jaw → diamond) expressed as Gaussian memberships.
 */
export function classifyFaceShape(rig: HeadRig) {
  const faceLength = dist(rig, LM.foreheadTop, LM.chin) * 1.08;
  const cheekboneWidth = dist(rig, LM.cheekR, LM.cheekL);
  const jawWidth = dist(rig, 58, 288);
  const foreheadWidth = dist(rig, LM.foreheadR, LM.foreheadL);
  const chinWidth = dist(rig, 148, 377);
  const jawAngleDeg = (angleAt(lmk(rig, LM.cheekR), lmk(rig, 58), lmk(rig, LM.chin)) + angleAt(lmk(rig, LM.cheekL), lmk(rig, 288), lmk(rig, LM.chin))) / 2;
  const ipdMm = len(sub(mid(lmk(rig, LM.eyeLOuter), lmk(rig, LM.eyeLInner)), mid(lmk(rig, LM.eyeROuter), lmk(rig, LM.eyeRInner)))) * 1000;

  const R = faceLength / cheekboneWidth;
  const jawRatio = jawWidth / cheekboneWidth;
  const foreheadRatio = foreheadWidth / cheekboneWidth;
  const g = (x: number, mu: number, s: number) => Math.exp(-(((x - mu) / s) ** 2));
  const angular = 1 - Math.min(1, Math.max(0, (jawAngleDeg - 118) / 22)); // 1 = sharp jaw

  const raw: Record<FaceShape, number> = {
    oval: g(R, 1.42, 0.1) * g(jawRatio, 0.8, 0.08) * g(foreheadRatio, 0.86, 0.1),
    round: g(R, 1.22, 0.1) * g(jawRatio, 0.82, 0.09) * (1 - angular * 0.7),
    square: g(R, 1.28, 0.12) * g(jawRatio, 0.92, 0.06) * (0.3 + angular * 0.7),
    oblong: g(R, 1.62, 0.12) * g(jawRatio, 0.84, 0.1),
    heart: g(R, 1.4, 0.15) * g(foreheadRatio - jawRatio, 0.16, 0.07) * g(chinWidth / jawWidth, 0.33, 0.1),
    diamond: g(R, 1.42, 0.15) * g(foreheadRatio, 0.72, 0.07) * g(jawRatio, 0.72, 0.07),
  };
  const total = Object.values(raw).reduce((a, b) => a + b, 0) || 1;
  const scores = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, +(v / total).toFixed(3)])) as Record<FaceShape, number>;
  const faceShape = (Object.entries(scores) as Array<[FaceShape, number]>).sort((a, b) => b[1] - a[1])[0][0];
  return {
    faceShape,
    scores,
    metrics: {
      faceLength: +faceLength.toFixed(4),
      cheekboneWidth: +cheekboneWidth.toFixed(4),
      jawWidth: +jawWidth.toFixed(4),
      foreheadWidth: +foreheadWidth.toFixed(4),
      chinWidth: +chinWidth.toFixed(4),
      jawAngleDeg: +jawAngleDeg.toFixed(1),
      lengthToWidth: +R.toFixed(3),
      ipdMm: +ipdMm.toFixed(1),
    },
  };
}

// --- colour science ---------------------------------------------------------

export function srgbToLinear(c: number) {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

export function rgbToLab(r: number, g: number, b: number): [number, number, number] {
  const R = srgbToLinear(r),
    G = srgbToLinear(g),
    B = srgbToLinear(b);
  const X = (0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047;
  const Y = 0.2126 * R + 0.7152 * G + 0.0722 * B;
  const Z = (0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883;
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
  const fx = f(X),
    fy = f(Y),
    fz = f(Z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/**
 * Individual Typology Angle (Chardon et al.) — the dermatology standard for
 * constitutive skin colour — plus an undertone from the Lab hue angle.
 */
export function skinTone(rgb: [number, number, number]): FaceAnalysis["skin"] {
  const [L, a, b] = rgbToLab(...rgb);
  const ita = (Math.atan2(L - 50, b) * 180) / Math.PI;
  const category: FaceAnalysis["skin"]["category"] =
    ita > 55 ? "very_light" : ita > 41 ? "light" : ita > 28 ? "intermediate" : ita > 10 ? "tan" : ita > -30 ? "brown" : "dark";
  const hue = (Math.atan2(b, a) * 180) / Math.PI;
  const undertone: FaceAnalysis["skin"]["undertone"] = hue > 60 ? "warm" : hue < 48 ? "cool" : "neutral";
  const hex = `#${rgb.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;
  return { hex, ita: +ita.toFixed(1), category, undertone };
}
