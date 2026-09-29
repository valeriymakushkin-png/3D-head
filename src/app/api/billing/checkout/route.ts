import { z } from "zod";
import { priceFor, stripe } from "@/server/billing";
import { db, must } from "@/server/db";
import { env, features } from "@/server/env";
import { HttpError, body, json, route } from "@/server/http";
import { rateLimit } from "@/server/ratelimit";
import { getSession } from "@/server/session";
import { getUser } from "@/server/users";

export const runtime = "nodejs";

const Input = z.object({ plan: z.enum(["pro", "barber", "clinic"]), returnTo: z.string().max(200).optional() });

/** Creates a Stripe Checkout session for a subscription (web only). */
export const POST = route(async (req: Request) => {
  if (!features.stripe() || !features.backend()) throw new HttpError(503, "billing_unavailable", "Billing is not configured");
  const session = await getSession();
  if (!session || session.anonymous) throw new HttpError(401, "unauthorized", "Sign in to subscribe");
  await rateLimit(`checkout:${session.userId}`, 10, 300);
  const { plan, returnTo } = await body(req, Input);
  const user = await getUser(session.userId);
  if (!user) throw new HttpError(401, "unauthorized");

  let customer = user.stripe_customer_id;
  if (!customer) {
    const c = await stripe().customers.create(
      { email: user.email ?? undefined, name: user.display_name ?? undefined, metadata: { userId: user.id, telegramId: String(user.telegram_id ?? "") } },
      { idempotencyKey: `customer-${user.id}` },
    );
    customer = c.id;
    must(await db().from("users").update({ stripe_customer_id: customer }).eq("id", user.id).select("id"));
  }
  const back = returnTo?.startsWith("/") && !returnTo.startsWith("//") ? returnTo : "/studio";
  const site = env().NEXT_PUBLIC_SITE_URL;
  const checkout = await stripe().checkout.sessions.create({
    mode: "subscription",
    customer,
    client_reference_id: user.id,
    line_items: [{ price: priceFor(plan), quantity: 1 }],
    allow_promotion_codes: true,
    subscription_data: { metadata: { userId: user.id, plan } },
    metadata: { userId: user.id, plan },
    success_url: `${site}${back}?upgraded=${plan}`,
    cancel_url: `${site}${back}`,
  });
  return json({ url: checkout.url });
});
