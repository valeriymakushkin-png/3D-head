import { db } from "@/server/db";
import { env, features } from "@/server/env";
import { json } from "@/server/http";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Vercel Cron (hourly): enforces the privacy promise — raw capture photos
 * are hard-deleted 24 h after upload — and garbage-collects anonymous users
 * that never came back (30 days, no avatars).
 */
export async function GET(req: Request) {
  if (!features.backend() || !env().CRON_SECRET || req.headers.get("authorization") !== `Bearer ${env().CRON_SECRET}`) {
    return json({ error: "forbidden" }, { status: 403 });
  }
  const { data: due } = await db().from("captures").select("id, storage_path").lt("purge_after", new Date().toISOString()).is("purged_at", null).limit(500);
  let purged = 0;
  if (due?.length) {
    const rows = due as Array<{ id: string; storage_path: string }>;
    const { error } = await db().storage.from("captures").remove(rows.map((r) => r.storage_path));
    if (!error) {
      await db().from("captures").update({ purged_at: new Date().toISOString() }).in("id", rows.map((r) => r.id));
      purged = rows.length;
    }
  }
  const cutoff = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const { data: stale } = await db().from("users").select("id").eq("is_anonymous", true).lt("created_at", cutoff).limit(500);
  let removedUsers = 0;
  for (const u of (stale as Array<{ id: string }> | null) ?? []) {
    const { count } = await db().from("avatars").select("id", { count: "exact", head: true }).eq("user_id", u.id);
    if (!count) {
      await db().from("users").delete().eq("id", u.id);
      removedUsers++;
    }
  }
  return json({ purged, removedUsers });
}
