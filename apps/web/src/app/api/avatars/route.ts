import { z } from "zod";
import { db, must } from "@/server/db";
import { features } from "@/server/env";
import { HttpError, body, json, route } from "@/server/http";
import { rateLimit } from "@/server/ratelimit";
import { getSession } from "@/server/session";
import { effectivePlan } from "@/server/users";

export const runtime = "nodejs";

const Input = z.object({
  source: z.enum(["photos", "video", "guided"]),
  captures: z
    .array(
      z.object({
        kind: z.enum(["photo", "video"]),
        contentType: z.enum(["image/jpeg", "image/png", "image/webp", "image/heic", "video/mp4", "video/quicktime"]),
        pose: z.object({ yaw: z.number(), pitch: z.number(), roll: z.number() }).optional(),
      }),
    )
    .min(3)
    .max(15),
  /** Optional on-device analysis to seed the HD pipeline. */
  analysis: z.record(z.string(), z.unknown()).optional(),
});

const EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/heic": "heic", "video/mp4": "mp4", "video/quicktime": "mov" };

/**
 * POST: starts an HD twin (Pro+). Creates the avatar + capture rows and
 * returns one signed upload URL per capture (direct browser → storage, the
 * app server never proxies face data). Photos are purged after 24 h.
 */
export const POST = route(async (req: Request) => {
  const session = await getSession();
  if (!session || session.anonymous) throw new HttpError(401, "unauthorized");
  if (!features.backend()) throw new HttpError(503, "backend_unavailable");
  if ((await effectivePlan(session.userId)) === "free") throw new HttpError(402, "pro_required", "HD twins are part of Pro");
  await rateLimit(`hd-avatar:${session.userId}`, 5, 3600);
  const input = await body(req, Input, 32_000);

  const avatar = must(
    await db()
      .from("avatars")
      .insert({ user_id: session.userId, tier: "hd", status: "uploading", source: input.source, capture_count: input.captures.length, analysis: input.analysis ?? null })
      .select("id")
      .single(),
  ) as { id: string };

  const uploads = await Promise.all(
    input.captures.map(async (c, i) => {
      const path = `${session.userId}/${avatar.id}/${String(i).padStart(2, "0")}.${EXT[c.contentType]}`;
      const signed = must(await db().storage.from("captures").createSignedUploadUrl(path)) as { signedUrl: string; token: string; path: string };
      return { index: i, path, url: signed.signedUrl, token: signed.token, contentType: c.contentType, kind: c.kind, pose: c.pose ?? null };
    }),
  );
  must(
    await db()
      .from("captures")
      .insert(uploads.map((u) => ({ avatar_id: avatar.id, user_id: session.userId, storage_path: u.path, kind: u.kind, pose: u.pose })))
      .select("id"),
  );
  return json({ avatarId: avatar.id, uploads: uploads.map(({ index, url, contentType }) => ({ index, url, contentType })) });
});

/** GET: the user's cloud avatars. */
export const GET = route(async () => {
  const session = await getSession();
  if (!session) throw new HttpError(401, "unauthorized");
  if (!features.backend()) return json({ items: [] });
  const { data, error } = await db()
    .from("avatars")
    .select("id, tier, status, thumbnail, created_at, error")
    .eq("user_id", session.userId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw new Error(error.message);
  return json({ items: data });
});
