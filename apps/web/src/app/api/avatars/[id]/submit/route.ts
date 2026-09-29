import { db, must } from "@/server/db";
import { env, features } from "@/server/env";
import { HttpError, json, route } from "@/server/http";
import { getSession } from "@/server/session";

export const runtime = "nodejs";

/** After the browser finished the signed uploads: verify files exist, then enqueue the GPU job. */
export const POST = route(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const session = await getSession();
  if (!session) throw new HttpError(401, "unauthorized");
  if (!features.backend()) throw new HttpError(503, "backend_unavailable");
  const id = (await ctx.params).id;
  const { data: avatar } = await db().from("avatars").select("id, status, capture_count").eq("id", id).eq("user_id", session.userId).maybeSingle();
  if (!avatar) throw new HttpError(404, "not_found");
  const a = avatar as { id: string; status: string; capture_count: number };
  if (a.status !== "uploading") return json({ status: a.status });

  const prefix = `${session.userId}/${a.id}`;
  const { data: files } = await db().storage.from("captures").list(prefix, { limit: 100 });
  if ((files?.length ?? 0) < Math.min(3, a.capture_count)) throw new HttpError(409, "uploads_incomplete", "Some photos did not finish uploading");

  must(await db().from("avatars").update({ status: "queued" }).eq("id", a.id).select("id"));
  must(await db().from("reconstruction_jobs").upsert({ avatar_id: a.id, status: "queued" }, { onConflict: "avatar_id" }).select("id"));
  const { RECON_TRIGGER_URL: url, RECON_TRIGGER_TOKEN: token } = env();
  if (url && token) {
    // Best effort: the dispatcher cron picks the job up within a minute anyway.
    await fetch(url, { method: "POST", headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(3000) }).catch(() => undefined);
  }
  return json({ status: "queued" });
});
