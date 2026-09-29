import { db } from "@/server/db";
import { env, features } from "@/server/env";
import { json, route } from "@/server/http";
import { getSession } from "@/server/session";
import { effectivePlan, getUser } from "@/server/users";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Current account, plan and remaining free transformations. */
export const GET = route(async () => {
  const session = await getSession();
  const free = env().FREE_TRANSFORMATIONS;
  if (!session || !features.backend()) {
    return json({ user: null, plan: "free", status: "none", remainingTransformations: free, backend: features.backend() });
  }
  const [user, plan] = await Promise.all([getUser(session.userId), effectivePlan(session.userId)]);
  let remaining: number | null = null;
  if (plan === "free") {
    const { count } = await db().from("transformations").select("id", { count: "exact", head: true }).eq("user_id", session.userId).eq("metered", true);
    remaining = Math.max(0, free - (count ?? 0));
  }
  return json({
    user: user
      ? { id: user.id, name: user.display_name, telegramId: user.telegram_id, email: user.email, anonymous: user.is_anonymous }
      : null,
    plan,
    status: user?.subscription_status ?? "none",
    remainingTransformations: remaining,
    backend: true,
  });
});
