import { z } from "zod";
import { db } from "@/server/db";
import { features } from "@/server/env";
import { HttpError, body, json, route } from "@/server/http";
import { meter } from "@/server/metering";
import { rateLimit } from "@/server/ratelimit";
import { ensureSession, getSession } from "@/server/session";

export const runtime = "nodejs";

const Input = z.object({
  type: z.enum(["glow_up", "stylist", "look"]),
  avatarId: z.string().uuid().nullable(),
  settings: z.unknown(),
});

/** POST: meter + record a transformation (402 when the free quota is spent). */
export const POST = route(async (req: Request) => {
  const session = await ensureSession();
  await rateLimit(`tx:${session.userId}`, 30, 60);
  const input = await body(req, Input, 16_000);
  const settings = JSON.stringify(input.settings ?? {}).length > 8_000 ? {} : input.settings;
  const r = await meter(session, { type: input.type, avatarId: input.avatarId, settings });
  return json(r);
});

/** GET: the user's saved looks (lookbook), newest first. */
export const GET = route(async () => {
  const session = await getSession();
  if (!session) throw new HttpError(401, "unauthorized");
  if (!features.backend()) return json({ items: [] });
  const { data, error } = await db()
    .from("transformations")
    .select("id, avatar_id, type, source, settings, created_at")
    .eq("user_id", session.userId)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw new Error(error.message);
  return json({ items: data });
});
