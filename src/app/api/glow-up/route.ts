import { z } from "zod";
import { LookPatchSchema, LookSchema } from "@/lib/avatar/look";
import { FaceAnalysisSchema } from "@/lib/style/analysis";
import { narrateGlowUp } from "@/server/ai/glowup";
import { env } from "@/server/env";
import { HttpError, body, json, route } from "@/server/http";
import { recordAiUsage } from "@/server/metering";
import { rateLimit } from "@/server/ratelimit";
import { getSession } from "@/server/session";

export const runtime = "nodejs";
export const maxDuration = 30;

const Input = z.object({ analysis: FaceAnalysisSchema, before: LookSchema, after: LookSchema, patch: LookPatchSchema });

/** Natural-language rationale for a Glow Up (the look itself is metered in /api/transformations). */
export const POST = route(async (req: Request) => {
  // AI not configured: the deterministic Glow Up stands on its own.
  if (!env().ANTHROPIC_API_KEY) return new Response(null, { status: 204 });
  const session = await getSession();
  if (!session) throw new HttpError(401, "unauthorized");
  await rateLimit(`glowup:${session.userId}`, 10, 60);
  const input = await body(req, Input, 32_000);
  const res = await narrateGlowUp(input);
  if (!res) throw new HttpError(422, "no_narrative");
  await recordAiUsage(session.userId, "glow_up", env().STYLIST_MODEL, res.usage);
  return json(res.narrative);
});
