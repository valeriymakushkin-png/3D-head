import "server-only";
import { db } from "@/server/db";
import { env, features } from "@/server/env";
import { HttpError } from "@/server/http";
import type { Session } from "@/server/session";

export type MeterType = "glow_up" | "stylist" | "look";

/**
 * Atomically records a metered transformation and enforces the free quota
 * (Postgres `consume_transformation`, serialised per user). Returns remaining
 * free uses, or null when unlimited.
 */
export async function meter(
  session: Session,
  input: { type: MeterType; avatarId: string | null; settings: unknown; source?: "manual" | "stylist" | "glow_up" },
): Promise<{ remaining: number | null }> {
  if (!features.backend()) {
    if (env().NODE_ENV === "production") throw new HttpError(503, "backend_unavailable");
    return { remaining: null }; // local dev: unmetered
  }
  const { data, error } = await db().rpc("consume_transformation", {
    p_user: session.userId,
    p_type: input.type,
    p_avatar: input.avatarId,
    p_settings: input.settings ?? {},
    p_source: input.source ?? (input.type === "look" ? "manual" : input.type),
    p_free_limit: env().FREE_TRANSFORMATIONS,
  });
  if (error) {
    if (error.code === "P0402") throw new HttpError(402, "quota_exceeded", "Free transformations used — upgrade to Pro for unlimited.");
    if (error.code === "P0404") throw new HttpError(401, "unauthorized");
    throw new Error(error.message);
  }
  const remaining = data as number;
  return { remaining: remaining < 0 ? null : remaining };
}

export async function recordAiUsage(
  userId: string,
  feature: "stylist" | "glow_up",
  model: string,
  usage: { input_tokens?: number | null; output_tokens?: number | null; cache_read_input_tokens?: number | null },
) {
  if (!features.backend()) return;
  const { error } = await db()
    .from("ai_usage")
    .insert({
      user_id: userId,
      feature,
      model,
      input_tokens: usage.input_tokens ?? 0,
      output_tokens: usage.output_tokens ?? 0,
      cache_read: usage.cache_read_input_tokens ?? 0,
    });
  if (error) console.warn("[ai_usage]", error.message);
}
