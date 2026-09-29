import {
  type BeardId,
  type GlassesId,
  type HairColorId,
  type HairstyleId,
  type Look,
  type LookPatch,
  applyLookPatch,
} from "@/lib/avatar/look";
import type { FaceAnalysis, FaceShape } from "@/lib/style/analysis";

/**
 * Style intelligence: a deterministic, explainable recommender encoding
 * barbering / optical-styling heuristics. The AI Stylist is grounded on its
 * output (it can explain and deviate, but starts from these scores), and
 * Glow Up works fully offline with it.
 */

type Scores<K extends string> = Partial<Record<K, number>>;

/** How flattering each cut is per face shape (0..1). */
const HAIR_BY_SHAPE: Record<FaceShape, Scores<HairstyleId>> = {
  oval: { quiff: 0.9, textured_crop: 0.85, pompadour: 0.85, taper_fade: 0.85, undercut: 0.8, french_crop: 0.8, curtains: 0.8, fade: 0.8, buzz_cut: 0.75, long: 0.75, mullet: 0.6 },
  round: { quiff: 0.95, pompadour: 0.9, undercut: 0.85, taper_fade: 0.8, textured_crop: 0.7, fade: 0.75, french_crop: 0.45, curtains: 0.5, buzz_cut: 0.35, long: 0.4, mullet: 0.45 },
  square: { textured_crop: 0.9, french_crop: 0.85, curtains: 0.85, taper_fade: 0.85, buzz_cut: 0.85, fade: 0.8, quiff: 0.75, undercut: 0.7, pompadour: 0.65, long: 0.7, mullet: 0.55 },
  oblong: { french_crop: 0.9, curtains: 0.85, textured_crop: 0.85, taper_fade: 0.75, fade: 0.65, long: 0.7, buzz_cut: 0.55, quiff: 0.45, undercut: 0.5, pompadour: 0.35, mullet: 0.5 },
  heart: { curtains: 0.9, textured_crop: 0.85, french_crop: 0.8, taper_fade: 0.8, long: 0.8, fade: 0.65, quiff: 0.6, undercut: 0.55, buzz_cut: 0.5, pompadour: 0.5, mullet: 0.6 },
  diamond: { curtains: 0.9, textured_crop: 0.85, french_crop: 0.85, quiff: 0.75, taper_fade: 0.8, long: 0.75, fade: 0.7, undercut: 0.65, buzz_cut: 0.5, pompadour: 0.6, mullet: 0.55 },
};

const BEARD_BY_SHAPE: Record<FaceShape, Scores<BeardId>> = {
  oval: { stubble: 0.9, short: 0.85, clean: 0.8, full: 0.75, goatee: 0.6 },
  round: { goatee: 0.9, short: 0.85, stubble: 0.7, full: 0.6, clean: 0.45 },
  square: { stubble: 0.9, clean: 0.85, short: 0.8, goatee: 0.6, full: 0.55 },
  oblong: { full: 0.85, short: 0.85, stubble: 0.8, clean: 0.6, goatee: 0.35 },
  heart: { full: 0.9, short: 0.85, stubble: 0.8, goatee: 0.6, clean: 0.55 },
  diamond: { short: 0.85, full: 0.85, stubble: 0.8, goatee: 0.7, clean: 0.6 },
};

const GLASSES_BY_SHAPE: Record<FaceShape, Scores<GlassesId>> = {
  oval: { aviator: 0.85, rectangle: 0.85, round: 0.8, luxury: 0.85, minimal: 0.8 },
  round: { rectangle: 0.95, luxury: 0.85, aviator: 0.7, minimal: 0.7, round: 0.35 },
  square: { round: 0.9, aviator: 0.85, minimal: 0.8, luxury: 0.6, rectangle: 0.45 },
  oblong: { aviator: 0.85, luxury: 0.85, round: 0.75, rectangle: 0.65, minimal: 0.6 },
  heart: { aviator: 0.85, minimal: 0.85, round: 0.8, rectangle: 0.7, luxury: 0.6 },
  diamond: { round: 0.85, minimal: 0.8, aviator: 0.75, rectangle: 0.75, luxury: 0.7 },
};

export const GOALS = ["balanced", "professional", "date_night", "luxury", "casual", "bold", "low_maintenance"] as const;
export type StyleGoal = (typeof GOALS)[number];

const HAIR_BY_GOAL: Record<StyleGoal, Scores<HairstyleId>> = {
  balanced: {},
  professional: { taper_fade: 0.25, french_crop: 0.15, quiff: 0.1, textured_crop: 0.05, pompadour: 0.05, mullet: -0.4, long: -0.15, buzz_cut: -0.05 },
  date_night: { textured_crop: 0.2, curtains: 0.15, quiff: 0.2, fade: 0.1, mullet: -0.2 },
  luxury: { pompadour: 0.25, undercut: 0.2, quiff: 0.15, taper_fade: 0.1, mullet: -0.4, buzz_cut: -0.2 },
  casual: { textured_crop: 0.2, curtains: 0.15, french_crop: 0.1, long: 0.1 },
  bold: { mullet: 0.35, undercut: 0.25, buzz_cut: 0.2, fade: 0.1 },
  low_maintenance: { buzz_cut: 0.35, french_crop: 0.2, textured_crop: 0.15, fade: 0.1, pompadour: -0.3, long: -0.2, quiff: -0.15 },
};

const BEARD_BY_GOAL: Record<StyleGoal, Scores<BeardId>> = {
  balanced: {},
  professional: { clean: 0.15, stubble: 0.1, short: 0.1, full: -0.1 },
  date_night: { stubble: 0.2, short: 0.1 },
  luxury: { short: 0.15, clean: 0.1, stubble: 0.05 },
  casual: { stubble: 0.15, full: 0.05 },
  bold: { full: 0.2, goatee: 0.1 },
  low_maintenance: { stubble: 0.1, clean: 0.1, full: -0.05 },
};

const GLASSES_BY_GOAL: Record<StyleGoal, Scores<GlassesId>> = {
  balanced: {},
  professional: { rectangle: 0.15, minimal: 0.15 },
  date_night: { none: 0.2 },
  luxury: { luxury: 0.25, aviator: 0.1 },
  casual: { round: 0.1, none: 0.15 },
  bold: { aviator: 0.15, luxury: 0.1 },
  low_maintenance: { none: 0.2 },
};

export interface Recommendation<K extends string> {
  id: K;
  score: number;
  reasons: string[];
}

const SHAPE_NOTES: Record<FaceShape, { hair: string; beard: string; glasses: string }> = {
  oval: {
    hair: "Balanced proportions carry almost any cut — keep some height to show them off.",
    beard: "Short, even facial hair keeps the natural balance.",
    glasses: "Frames about as wide as your cheekbones work in any shape.",
  },
  round: {
    hair: "Height on top and tight sides lengthen a round face.",
    beard: "A beard shaped longer at the chin adds definition to the jaw.",
    glasses: "Angular frames add structure; round frames echo the roundness.",
  },
  square: {
    hair: "Soft, textured tops balance a strong jaw without adding width.",
    beard: "Keep it light — your jaw already does the work.",
    glasses: "Round or aviator frames soften strong angles.",
  },
  oblong: {
    hair: "Avoid extra height; a fringe or side volume shortens the face.",
    beard: "Fuller sides add width and balance length.",
    glasses: "Deeper frames break up the vertical line.",
  },
  heart: {
    hair: "Medium length with a soft fringe balances a wider forehead.",
    beard: "A fuller chin area balances a narrower jaw.",
    glasses: "Light or bottom-heavy frames balance the brow line.",
  },
  diamond: {
    hair: "Width at the forehead and chin balances prominent cheekbones.",
    beard: "Fullness at the chin balances the cheekbones.",
    glasses: "Oval or rimless frames soften the cheekbones.",
  },
};

function blend<K extends string>(
  goal: Scores<K>,
  scoresByShape: FaceAnalysis["faceShapeScores"],
  table: Record<FaceShape, Scores<K>>,
  ids: readonly K[],
): Map<K, number> {
  const out = new Map<K, number>();
  for (const id of ids) {
    // expectation over the soft face-shape distribution
    let s = 0;
    for (const [fs, p] of Object.entries(scoresByShape) as Array<[FaceShape, number]>) s += p * (table[fs][id] ?? 0.5);
    out.set(id, s + (goal[id] ?? 0));
  }
  return out;
}

export interface StyleContext {
  analysis: FaceAnalysis;
  goal?: StyleGoal;
  /** e.g. "thinning" — biases towards shorter, textured cuts. */
  concerns?: Array<"thinning" | "receding" | "grey" | "fine_hair" | "curly_hair">;
}

export function recommendHair(ctx: StyleContext, top = 3): Recommendation<HairstyleId>[] {
  const { analysis } = ctx;
  const goal = ctx.goal ?? "balanced";
  const ids = ["buzz_cut", "fade", "taper_fade", "textured_crop", "french_crop", "curtains", "quiff", "pompadour", "undercut", "long", "mullet"] as const;
  const s = blend(HAIR_BY_GOAL[goal], analysis.faceShapeScores, HAIR_BY_SHAPE, ids);
  const thinning = ctx.concerns?.includes("thinning") || ctx.concerns?.includes("receding") || analysis.hair.density < 0.6 || analysis.hair.recession > 0.3;
  if (thinning) {
    // Shorter, textured tops hide density loss; slick or long styles expose it.
    for (const [id, d] of Object.entries({ buzz_cut: 0.3, textured_crop: 0.25, french_crop: 0.25, fade: 0.1, pompadour: -0.35, undercut: -0.25, long: -0.3, curtains: -0.2, quiff: -0.15 }))
      s.set(id as (typeof ids)[number], (s.get(id as (typeof ids)[number]) ?? 0) + d);
  }
  return [...s.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, top)
    .map(([id, score]) => ({
      id,
      score: +score.toFixed(3),
      reasons: [SHAPE_NOTES[analysis.faceShape].hair, ...(thinning && ["buzz_cut", "textured_crop", "french_crop"].includes(id) ? ["Texture on top disguises thinning."] : [])],
    }));
}

export function recommendBeard(ctx: StyleContext, top = 2): Recommendation<BeardId>[] {
  const goal = ctx.goal ?? "balanced";
  const ids = ["clean", "stubble", "short", "full", "goatee"] as const;
  const s = blend(BEARD_BY_GOAL[goal], ctx.analysis.faceShapeScores, BEARD_BY_SHAPE, ids);
  return [...s.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, top)
    .map(([id, score]) => ({ id, score: +score.toFixed(3), reasons: [SHAPE_NOTES[ctx.analysis.faceShape].beard] }));
}

export function recommendGlasses(ctx: StyleContext, top = 2): Recommendation<GlassesId>[] {
  const goal = ctx.goal ?? "balanced";
  const ids = ["none", "aviator", "round", "rectangle", "luxury", "minimal"] as const;
  const table = Object.fromEntries(Object.entries(GLASSES_BY_SHAPE).map(([k, v]) => [k, { none: 0.72, ...v }])) as Record<FaceShape, Scores<GlassesId>>;
  const s = blend(GLASSES_BY_GOAL[goal], ctx.analysis.faceShapeScores, table, ids);
  return [...s.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, top)
    .map(([id, score]) => ({ id, score: +score.toFixed(3), reasons: [SHAPE_NOTES[ctx.analysis.faceShape].glasses] }));
}

/**
 * Colour harmony from skin undertone and contrast (ITA). Warm undertones
 * carry golden browns and copper; cool undertones ash, black and platinum;
 * high-contrast (light skin, dark natural hair) keeps depth.
 */
export function recommendHairColor(ctx: StyleContext): Recommendation<HairColorId>[] {
  const { skin } = ctx.analysis;
  const table: Record<string, Array<[HairColorId, string]>> = {
    warm: [
      ["natural", "Your natural shade already harmonises with your warm undertone."],
      ["brown", "Golden-brown warmth echoes your skin's undertone."],
      ["ginger", "Copper tones glow against warm skin."],
    ],
    cool: [
      ["natural", "Your natural shade suits your cool undertone."],
      ["black", "Deep, cool shades sharpen contrast with cool skin."],
      ["platinum", "Icy platinum is a high-impact match for cool undertones."],
    ],
    neutral: [
      ["natural", "Neutral undertones carry your natural colour best."],
      ["dark_brown", "Rich dark brown adds depth without clashing."],
      ["blonde", "A soft blonde works with a neutral base."],
    ],
  };
  if (ctx.concerns?.includes("grey")) table[skin.undertone].unshift(["grey", "Owning the grey reads confident and distinguished."]);
  return table[skin.undertone].map(([id, reason], i) => ({ id, score: 1 - i * 0.1, reasons: [reason] }));
}

export interface GlowUpResult {
  look: Look;
  patch: LookPatch;
  headline: string;
  rationale: string[];
}

/** One-click "best version": the top recommendation on every dimension. */
export function glowUp(current: Look, ctx: StyleContext): GlowUpResult {
  const hair = recommendHair(ctx, 1)[0];
  const beard = recommendBeard(ctx, 1)[0];
  const glasses = recommendGlasses(ctx, 1)[0];
  const color = recommendHairColor(ctx)[0];
  const tone = ctx.analysis.skin.category;
  const patch: LookPatch = {
    hair: { style: hair.id, color: color.id, volume: null, length: null, texture: null },
    beard: { style: beard.id },
    glasses: { style: glasses.id },
    skin: { complexion: 0.45, tone: ["very_light", "light"].includes(tone) && ctx.goal === "date_night" ? "tanned" : current.skin.tone },
  };
  const look = applyLookPatch(current, patch);
  const shape = ctx.analysis.faceShape;
  return {
    look,
    patch,
    headline: `Your best version: ${label(hair.id)} · ${label(beard.id)}${glasses.id !== "none" ? ` · ${label(glasses.id)} frames` : ""}`,
    rationale: [
      `Face shape: ${shape} (${Math.round((ctx.analysis.faceShapeScores[shape] ?? 0) * 100)}% match). ${hair.reasons[0]}`,
      beard.reasons[0],
      glasses.id === "none" ? "Your features read best without frames." : glasses.reasons[0],
      color.reasons[0],
      "Complexion evened slightly — the way good lighting and skincare would.",
    ],
  };
}

export function label(id: string): string {
  const special: Record<string, string> = { clean: "Clean shave", short: "Short beard", full: "Full beard", long: "Long hair" };
  return special[id] ?? id.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
