import "server-only";
import Stripe from "stripe";
import { db, must } from "@/server/db";
import { env } from "@/server/env";
import type { Plan } from "@/server/users";

let stripeClient: Stripe | null = null;
export function stripe(): Stripe {
  stripeClient ??= new Stripe(env().STRIPE_SECRET_KEY!, { maxNetworkRetries: 2, appInfo: { name: "TwinMe AI" } });
  return stripeClient;
}

export type PaidPlan = Exclude<Plan, "free">;

export function priceFor(plan: PaidPlan): string {
  const id = { pro: env().STRIPE_PRICE_PRO, barber: env().STRIPE_PRICE_BARBER, clinic: env().STRIPE_PRICE_CLINIC }[plan];
  if (!id) throw new Error(`No Stripe price configured for ${plan}`);
  return id;
}

export function planForPrice(priceId: string): PaidPlan | null {
  const e = env();
  if (priceId === e.STRIPE_PRICE_PRO) return "pro";
  if (priceId === e.STRIPE_PRICE_BARBER) return "barber";
  if (priceId === e.STRIPE_PRICE_CLINIC) return "clinic";
  return null;
}

type SubStatus = "trialing" | "active" | "past_due" | "canceled";

export function mapStripeStatus(s: Stripe.Subscription.Status): SubStatus {
  switch (s) {
    case "trialing":
      return "trialing";
    case "active":
      return "active";
    case "past_due":
    case "unpaid":
    case "incomplete":
      return "past_due";
    default:
      return "canceled";
  }
}

/** Idempotency: returns false if this provider event was already processed. */
export async function claimEvent(id: string, provider: "stripe" | "telegram_stars", type: string, payload: unknown): Promise<boolean> {
  const { error } = await db().from("billing_events").insert({ id, provider, type, payload });
  if (error?.code === "23505") return false;
  if (error) throw new Error(error.message);
  return true;
}

export async function upsertSubscription(s: {
  userId: string;
  plan: PaidPlan;
  status: SubStatus;
  provider: "stripe" | "telegram_stars";
  providerSubscriptionId: string;
  providerCustomerId?: string | null;
  periodStart?: Date | null;
  expiresAt: Date;
  cancelAtPeriodEnd?: boolean;
}) {
  must(
    await db()
      .from("subscriptions")
      .upsert(
        {
          user_id: s.userId,
          plan: s.plan,
          status: s.status,
          provider: s.provider,
          provider_subscription_id: s.providerSubscriptionId,
          provider_customer_id: s.providerCustomerId ?? null,
          current_period_start: s.periodStart?.toISOString() ?? null,
          expires_at: s.expiresAt.toISOString(),
          cancel_at_period_end: s.cancelAtPeriodEnd ?? false,
        },
        { onConflict: "provider,provider_subscription_id" },
      )
      .select("id"),
  );
  must(await db().rpc("refresh_user_plan", { p_user: s.userId }));
}

/** Syncs one Stripe subscription object into our tables. */
export async function syncStripeSubscription(sub: Stripe.Subscription) {
  const item = sub.items.data[0];
  const plan = item ? planForPrice(item.price.id) : null;
  const userId = (sub.metadata?.userId as string | undefined) ?? null;
  if (!plan || !userId) {
    console.warn("[stripe] subscription without plan/user metadata", sub.id);
    return;
  }
  // API ≥ 2025-03 moved the billing period to subscription items.
  const periodEnd = (item as Stripe.SubscriptionItem & { current_period_end?: number }).current_period_end ?? (sub as unknown as { current_period_end?: number }).current_period_end;
  const periodStart = (item as Stripe.SubscriptionItem & { current_period_start?: number }).current_period_start ?? null;
  await upsertSubscription({
    userId,
    plan,
    status: mapStripeStatus(sub.status),
    provider: "stripe",
    providerSubscriptionId: sub.id,
    providerCustomerId: typeof sub.customer === "string" ? sub.customer : sub.customer.id,
    periodStart: periodStart ? new Date(periodStart * 1000) : null,
    expiresAt: new Date((periodEnd ?? Math.floor(Date.now() / 1000)) * 1000),
    cancelAtPeriodEnd: sub.cancel_at_period_end,
  });
}
