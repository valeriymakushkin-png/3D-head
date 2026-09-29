import { db, must } from "@/server/db";
import { features } from "@/server/env";
import { HttpError, json, route } from "@/server/http";
import { getSession } from "@/server/session";
import { audit } from "@/server/users";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };
const UUID = /^[0-9a-f-]{36}$/;

async function owned(id: string) {
  const session = await getSession();
  if (!session) throw new HttpError(401, "unauthorized");
  if (!features.backend()) throw new HttpError(503, "backend_unavailable");
  if (!UUID.test(id)) throw new HttpError(404, "not_found");
  const { data } = await db()
    .from("avatars")
    .select("id, user_id, tier, status, model_url, thumbnail, rig, analysis, natural_hair, error, created_at, updated_at")
    .eq("id", id)
    .eq("user_id", session.userId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!data) throw new HttpError(404, "not_found");
  return { session, avatar: data as Record<string, unknown> & { model_url: string | null; thumbnail: string | null; status: string } };
}

/** GET: status; when ready, short-lived signed URLs for the GLB and thumbnail. */
export const GET = route(async (_req: Request, ctx: Ctx) => {
  const { avatar } = await owned((await ctx.params).id);
  const sign = async (bucket: string, path: string | null) => (path ? ((await db().storage.from(bucket).createSignedUrl(path, 600)).data?.signedUrl ?? null) : null);
  const { data: job } = await db().from("reconstruction_jobs").select("status, attempts, started_at, finished_at").eq("avatar_id", avatar.id as string).maybeSingle();
  return json({
    ...avatar,
    model_url: avatar.status === "ready" ? await sign("avatars", avatar.model_url) : null,
    thumbnail: await sign("thumbnails", avatar.thumbnail),
    job,
  });
});

/** DELETE: soft-deletes the avatar and hard-deletes its files (GDPR erasure). */
export const DELETE = route(async (_req: Request, ctx: Ctx) => {
  const { session, avatar } = await owned((await ctx.params).id);
  const prefix = `${session.userId}/${avatar.id}`;
  for (const bucket of ["captures", "avatars", "thumbnails"]) {
    const { data: files } = await db().storage.from(bucket).list(prefix, { limit: 100 });
    if (files?.length) await db().storage.from(bucket).remove(files.map((f) => `${prefix}/${f.name}`));
  }
  must(await db().from("avatars").update({ deleted_at: new Date().toISOString(), model_url: null, thumbnail: null, rig: null, analysis: null }).eq("id", avatar.id as string).select("id"));
  await audit(session.userId, "avatar.delete", avatar.id as string);
  return json({ ok: true });
});
