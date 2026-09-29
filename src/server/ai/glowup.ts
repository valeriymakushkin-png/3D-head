import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod";
import type { Look, LookPatch } from "@/lib/avatar/look";
import type { FaceAnalysis } from "@/lib/style/analysis";
import { env } from "@/server/env";
import { GlowUpNarrative, STYLIST_SYSTEM, userContextBlock } from "@/server/ai/prompts";

let client: Anthropic | null = null;

/**
 * Rewrites the deterministic Glow Up rationale in natural, personal language.
 * The look itself is chosen by the style engine (offline, explainable); the
 * model only explains it — so a model outage never blocks the feature.
 */
export async function narrateGlowUp(input: { analysis: FaceAnalysis; before: Look; after: Look; patch: LookPatch }): Promise<{
  narrative: z.infer<typeof GlowUpNarrative>;
  usage: Anthropic.Beta.BetaUsage;
} | null> {
  client ??= new Anthropic({ apiKey: env().ANTHROPIC_API_KEY, maxRetries: 1, timeout: 20_000 });
  const res = await client.beta.messages.parse({
    model: env().STYLIST_MODEL,
    max_tokens: 2000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "low", format: zodOutputFormat(GlowUpNarrative) },
    system: [
      { type: "text", text: STYLIST_SYSTEM, cache_control: { type: "ephemeral" } },
      { type: "text", text: userContextBlock(input.analysis) },
    ],
    messages: [
      {
        role: "user",
        content: `Explain this Glow Up to the user in second person. Before: ${JSON.stringify(input.before)}\nAfter: ${JSON.stringify(input.after)}\nChanges: ${JSON.stringify(input.patch)}`,
      },
    ],
  });
  if (res.stop_reason === "refusal" || !res.parsed_output) return null;
  return { narrative: res.parsed_output, usage: res.usage };
}
