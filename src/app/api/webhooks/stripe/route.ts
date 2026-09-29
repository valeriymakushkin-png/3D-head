import type Stripe from "stripe";
import { claimEvent, stripe, syncStripeSubscription } from "@/server/billing";
import { env, features } from "@/server/env";
import { json } from "@/server/http";

export const runtime = "nodejs";

/**
 * Stripe webhooks: signature-verified on the raw body, idempotent per event
 * id, and state is always re-read from Stripe (events can arrive out of
 * order, so we never trust the event payload's snapshot for status).
 */
export async function POST(req: Request) {
  if (!features.stripe() || !features.backend() || !env().STRIPE_WEBHOOK_SECRET) return json({ error: "unavailable" }, { status: 503 });
  const sig = req.headers.get("stripe-signature");
  const raw = await req.text();
  let event: Stripe.Event;
  try {
    event = await stripe().webhooks.constructEventAsync(raw, sig ?? "", env().STRIPE_WEBHOOK_SECRET!);
  } catch {
    return json({ error: "bad_signature" }, { status: 400 });
  }
  try {
    if (!(await claimEvent(event.id, "stripe", event.type, { id: event.id, type: event.type }))) return json({ received: true, duplicate: true });
    switch (event.type) {
      case "checkout.session.completed": {
        const s = event.data.object;
        if (s.mode === "subscription" && s.subscription) {
          const sub = await stripe().subscriptions.retrieve(typeof s.subscription === "string" ? s.subscription : s.subscription.id);
          await syncStripeSubscription(sub);
        }
        break;
      }
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted":
      case "customer.subscription.paused":
      case "customer.subscription.resumed": {
        const sub = await stripe().subscriptions.retrieve(event.data.object.id);
        await syncStripeSubscription(sub);
        break;
      }
      default:
        break;
    }
    return json({ received: true });
  } catch (e) {
    console.error("[stripe webhook]", event.type, e);
    // 500 → Stripe retries with backoff; the idempotency row is removed so the retry re-processes.
    const { db } = await import("@/server/db");
    await db().from("billing_events").delete().eq("id", event.id);
    return json({ error: "processing_failed" }, { status: 500 });
  }
}
