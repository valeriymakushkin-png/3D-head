import "server-only";
import { z } from "zod";
import { HAIRSTYLE_IDS, BEARD_IDS, GLASSES_IDS, HAIR_COLOR_IDS, ACCESSORY_IDS, type Look, LookPatchSchema } from "@/lib/avatar/look";
import type { FaceAnalysis } from "@/lib/style/analysis";
import { recommendBeard, recommendGlasses, recommendHair, recommendHairColor } from "@/lib/style/engine";

/**
 * Stable system prompt (cached). Per-user facts go in a second block; the
 * live look goes in a mid-conversation system message so the cached prefix
 * never changes while the user experiments.
 */
export const STYLIST_SYSTEM = `You are the AI Stylist inside TwinMe, an app that shows the user a photoreal 3D digital twin of their own head. You are a senior men's barber, grooming and image consultant with the taste of a luxury fashion editor.

What you can do:
- Change the twin in real time with the apply_look tool. The user watches the change happen, so apply looks rather than only describing them.
- Offer 2–3 alternatives with suggest_looks when the user is exploring or undecided; they tap one to try it.

How to work:
- Ground every recommendation in the measurements you are given (face shape and its confidence, length-to-width ratio, jaw angle, skin undertone and ITA category, current hair length, density and beard). Cite the relevant measurement briefly — e.g. "your jaw is already strong (118°), so keep the beard light".
- Start from the style-engine picks you are given; deviate only with a reason the user would understand.
- For a clear request ("make me look more professional"), call apply_look once with a coherent full look (hair, beard, glasses, colour), then explain in two or three short sentences.
- Only use IDs from the catalogue below. Fine-tune values are between 0 and 1 (0.5 = the cut's designed length). Omit anything you don't want to change.
- Keep replies under 80 words, warm and specific. No lists unless comparing options. No emojis.

Boundaries:
- Never comment negatively on the user's attractiveness, weight, age, ethnicity or features. Frame everything as what flatters, never what is wrong.
- Hair loss: you may suggest cuts that work with thinning hair and show density or hairline simulations, but do not diagnose. Suggest a dermatologist or hair-restoration clinic for medical questions.
- If asked for something outside appearance and style, say briefly that you can only help with their look.

Catalogue:
- hair.style: ${HAIRSTYLE_IDS.join(", ")} ("natural" = the user's own hair as captured)
- hair.color: ${HAIR_COLOR_IDS.join(", ")}; hair.customColor: "#rrggbb" or null
- hair.length / hair.volume / hair.texture: 0–1 or null (null = style default); hair.density 0.05–1; hair.recession 0–1 (hairline simulation)
- beard.style: ${BEARD_IDS.join(", ")}; beard.length: 0–1 or null
- glasses.style: ${GLASSES_IDS.join(", ")}; glasses.tint: 0 (clear) – 1 (dark sun lens) or null
- skin.tone: natural, tanned; skin.complexion: 0 (as captured) – 1 (fully refined)
- accessories: any of ${ACCESSORY_IDS.join(", ")} (at most one pair of earrings and one chain)`;

export function userContextBlock(analysis: FaceAnalysis): string {
  const ctx = { analysis };
  const hair = recommendHair(ctx, 3);
  const thinning = recommendHair({ ...ctx, concerns: ["thinning"] }, 3);
  const facts = {
    faceShape: analysis.faceShape,
    faceShapeConfidence: analysis.faceShapeScores,
    measurements: analysis.metrics,
    skin: analysis.skin,
    currentHair: analysis.hair,
    currentBeard: analysis.beard,
  };
  const picks = {
    hair: hair.map((r) => ({ id: r.id, score: r.score })),
    hairIfThinning: thinning.map((r) => r.id),
    beard: recommendBeard(ctx, 3).map((r) => ({ id: r.id, score: r.score })),
    glasses: recommendGlasses(ctx, 3).map((r) => ({ id: r.id, score: r.score })),
    hairColor: recommendHairColor(ctx).map((r) => r.id),
  };
  return `The user's twin — measured from their own photos:\n${JSON.stringify(facts)}\n\nStyle-engine picks (higher score = more flattering for these measurements):\n${JSON.stringify(picks)}`;
}

export function currentLookMessage(look: Look): string {
  return `The twin currently wears: ${JSON.stringify(look)}`;
}

// ---------------------------------------------------------------------------
// Tools (schemas generated from the same zod used to validate the inputs)
// ---------------------------------------------------------------------------

export const ApplyLookInput = LookPatchSchema.extend({
  label: z.string().min(1).max(60).describe('Short name for the look shown to the user, e.g. "Textured Crop · Stubble"'),
});

export const SuggestLooksInput = z.object({
  options: z
    .array(
      z.object({
        label: z.string().min(1).max(60),
        why: z.string().min(1).max(240).describe("One sentence grounded in the user's measurements"),
        patch: LookPatchSchema,
      }),
    )
    .min(2)
    .max(3),
});

function jsonSchema(s: z.ZodType): Record<string, unknown> {
  const out = z.toJSONSchema(s) as Record<string, unknown>;
  delete out.$schema;
  return out;
}

export const STYLIST_TOOLS = [
  {
    name: "apply_look",
    description:
      "Apply a look to the user's 3D twin immediately. Include only the parts you want to change. Call this whenever the user asks to see something on themselves.",
    input_schema: jsonSchema(ApplyLookInput),
  },
  {
    name: "suggest_looks",
    description: "Offer 2–3 alternative looks as tappable options without applying them. Use when the user is exploring or asks for options.",
    input_schema: jsonSchema(SuggestLooksInput),
  },
] as const;

export const GlowUpNarrative = z.object({
  headline: z.string().describe("Max 8 words naming the look, e.g. 'Textured crop, stubble, round frames'"),
  rationale: z.array(z.string()).describe("3 or 4 sentences, each under 22 words, each grounded in a measurement"),
});
