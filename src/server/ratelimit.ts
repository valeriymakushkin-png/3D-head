import "server-only";
import { db } from "@/server/db";
import { features } from "@/server/env";
import { HttpError } from "@/server/http";

/** Per-instance fallback for local development without a database. */
const memory = new Map<string, { start: number; count: number }>();

/**
 * Fixed-window limiter backed by Postgres (`hit_rate_limit`), so limits hold
 * across every serverless instance without extra infrastructure.
 */
export async function rateLimit(key: string, limit: number, windowSeconds: number): Promise<void> {
  let ok: boolean;
  if (features.backend()) {
    const { data, error } = await db().rpc("hit_rate_limit", { p_key: key, p_limit: limit, p_window_seconds: windowSeconds });
    // Fail open on limiter outages — availability over strictness; quotas are enforced separately.
    ok = error ? true : data === true;
    if (error) console.warn("[ratelimit] degraded", error.message);
  } else {
    const now = Date.now();
    const cur = memory.get(key);
    if (!cur || now - cur.start > windowSeconds * 1000) {
      memory.set(key, { start: now, count: 1 });
      ok = true;
    } else {
      cur.count++;
      ok = cur.count <= limit;
    }
  }
  if (!ok) throw new HttpError(429, "rate_limited", "Too many requests");
}
