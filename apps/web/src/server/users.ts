import "server-only";
import { db, must } from "@/server/db";
import { env, features } from "@/server/env";
import type { Session } from "@/server/session";
import type { TelegramUser } from "@/server/telegram";

export type Plan = "free" | "pro" | "barber" | "clinic";

export interface UserRow {
  id: string;
  telegram_id: number | null;
  email: string | null;
  display_name: string | null;
  photo_url: string | null;
  is_anonymous: boolean;
  plan: Plan;
  subscription_status: "none" | "trialing" | "active" | "past_due" | "canceled";
  stripe_customer_id: string | null;
}

const COLUMNS = "id, telegram_id, email, display_name, photo_url, is_anonymous, plan, subscription_status, stripe_customer_id";

export async function getUser(id: string): Promise<UserRow | null> {
  if (!features.backend()) return null;
  const { data } = await db().from("users").select(COLUMNS).eq("id", id).is("deleted_at", null).maybeSingle();
  return (data as UserRow | null) ?? null;
}

/** Effective plan (honours expiry even if a webhook was missed). */
export async function effectivePlan(userId: string): Promise<Plan> {
  if (!features.backend()) return "free";
  const { data } = await db().from("user_entitlements").select("plan").eq("user_id", userId).maybeSingle();
  return ((data as { plan: Plan } | null)?.plan ?? "free") as Plan;
}

/**
 * Finds or creates the account for a Telegram identity; if the caller had an
 * anonymous session, its avatars and looks are merged into the account.
 */
export async function upsertTelegramUser(tg: TelegramUser, current: Session | null): Promise<UserRow> {
  const name = [tg.first_name, tg.last_name].filter(Boolean).join(" ") || tg.username || null;
  const existing = must(await db().from("users").select(COLUMNS).eq("telegram_id", tg.id).maybeSingle()) as UserRow | null;
  let user: UserRow;
  if (existing) {
    user = must(
      await db().from("users").update({ display_name: name, photo_url: tg.photo_url ?? null, locale: tg.language_code ?? null, deleted_at: null }).eq("id", existing.id).select(COLUMNS).single(),
    ) as UserRow;
  } else if (current?.anonymous) {
    // Upgrade the anonymous row in place: keeps ids stable, nothing to merge.
    user = must(
      await db()
        .from("users")
        .update({ telegram_id: tg.id, display_name: name, photo_url: tg.photo_url ?? null, locale: tg.language_code ?? null, is_anonymous: false })
        .eq("id", current.userId)
        .select(COLUMNS)
        .single(),
    ) as UserRow;
  } else {
    user = must(
      await db().from("users").insert({ telegram_id: tg.id, display_name: name, photo_url: tg.photo_url ?? null, locale: tg.language_code ?? null }).select(COLUMNS).single(),
    ) as UserRow;
  }
  if (current?.anonymous && current.userId !== user.id) {
    await db().rpc("merge_users", { p_from: current.userId, p_into: user.id });
  }
  return user;
}

export async function audit(userId: string | null, action: string, target?: string, meta?: Record<string, unknown>, ip?: string) {
  if (!features.backend()) return;
  await db()
    .from("audit_log")
    .insert({ user_id: userId, action, target, meta, ip })
    .then(({ error }) => error && console.warn("[audit]", error.message));
}

export const freeLimit = () => env().FREE_TRANSFORMATIONS;
